import { prisma } from '../../config/database';
import { cacheable } from '../../config/redis';
import { broadcastToRoom } from '../../realtime/broadcast';
import { findOrThrow } from '../../utils/find-or-throw';
import { invalidateIssueCache, BOARD_TTL } from '../../utils/issue-cache';
import { formatIssueKey } from '../../utils/issue-key';
import { logger } from '../../utils/logger';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { AUTOMATION_ISSUE_INCLUDE, evaluateRules } from '../automation/automation.service';
import { validateTransition } from '../workflows/workflows.service';

/**
 * Get the kanban board for a project, returning columns with their issues.
 * @param projectId - The project to get the board for
 * @returns Board columns with issues, each issue having a computed key
 */
export async function getBoard(projectId: string) {
  return cacheable(`board:${projectId}`, BOARD_TTL, async () => {
    const columns = await prisma.boardColumn.findMany({
      where: { projectId },
      include: {
        issues: {
          include: {
            assignee: { select: USER_BASIC_SELECT },
            labels: true,
          },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { position: 'asc' },
    });

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    return columns.map((col: (typeof columns)[number]) => ({
      ...col,
      issues: col.issues.map((i: (typeof col.issues)[number]) => ({
        ...i,
        key: formatIssueKey(project!.prefix, i.number),
      })),
    }));
  }); // end cacheable
}

/**
 * Move an issue to a different board column and position, validating workflow transitions.
 * @param projectId - The project the issue belongs to
 * @param issueNumber - The issue number within the project
 * @param columnId - The target column to move the issue to
 * @param position - The position within the target column
 * @param options
 * @param options.skipAutomation
 * @returns The updated issue
 * @throws {AppError} 404 if issue not found
 * @throws {AppError} 400 if workflow transition is invalid
 */
export async function moveIssue(
  projectId: string,
  issueNumber: number,
  columnId: string,
  position: number,
  options?: { skipAutomation?: boolean },
) {
  const issue = await findOrThrow(
    prisma.issue.findFirst({
      where: { projectId, number: issueNumber },
    }),
    'Issue not found',
  );

  // Validate workflow transition
  await validateTransition(projectId, issue.columnId, columnId);

  const updated = await prisma.issue.update({
    where: { id: issue.id },
    data: { columnId, position },
  });

  await invalidateIssueCache(projectId);

  // Fire automation rules (non-blocking)
  if (columnId !== issue.columnId && !options?.skipAutomation) {
    prisma.issue
      .findUnique({ where: { id: issue.id }, include: AUTOMATION_ISSUE_INCLUDE })
      .then((hydrated) => {
        if (hydrated) {
          return evaluateRules(projectId, 'issue:status_changed', {
            issue: hydrated,
            actorId: issue.creatorId,
            from: issue.columnId,
            to: columnId,
          });
        }
      })
      .catch((err) => {
        logger.error(
          'Failed to evaluate automation rules for issue:status_changed',
          { projectId },
          err as Error,
        );
      });
  }

  broadcastToRoom(`project:${projectId}`, { type: 'board:moved', projectId, issueId: issue.id });

  return updated;
}

/**
 * Get roadmap data: epics with children grouped for timeline display, including progress and date ranges.
 * @param projectId - The project to build the roadmap for
 * @returns List of epics with children, progress stats, and computed start/end dates
 * @throws {AppError} 404 if project not found
 */
export async function getRoadmap(projectId: string) {
  const project = await findOrThrow(
    prisma.project.findUnique({ where: { id: projectId } }),
    'Project not found',
  );

  const epics = await prisma.issue.findMany({
    where: { projectId, type: 'EPIC' },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      labels: true,
      column: { select: { id: true, name: true, isDone: true } },
      children: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true, isDone: true } },
        },
        orderBy: { number: 'asc' },
      },
    },
    orderBy: { number: 'asc' },
  });

  return epics.map((epic: (typeof epics)[number]) => {
    const children = epic.children;
    const total = children.length;
    const completed = children.filter((c: (typeof children)[number]) => c.column?.isDone).length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    const allDates = [
      new Date(epic.createdAt),
      ...children.map((c: (typeof children)[number]) => new Date(c.createdAt)),
    ];
    const allDueDates = [
      ...(epic.dueDate ? [new Date(epic.dueDate)] : []),
      ...children
        .filter((c: (typeof children)[number]) => c.dueDate)
        .map((c: (typeof children)[number]) => new Date(c.dueDate!)),
    ];

    const startDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
    const endDate =
      allDueDates.length > 0
        ? new Date(Math.max(...allDueDates.map((d) => d.getTime())))
        : new Date(
            Math.max(...allDates.map((d) => d.getTime()), startDate.getTime() + 14 * 86400000),
          );

    return {
      ...epic,
      key: formatIssueKey(project.prefix, epic.number),
      children: children.map((c: (typeof children)[number]) => ({
        ...c,
        key: formatIssueKey(project.prefix, c.number),
      })),
      progress: { total, completed, percentage },
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };
  });
}
