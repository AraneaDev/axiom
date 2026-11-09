import type { BoardColumn, Issue, Label, Sprint } from '@prisma/client';
import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToRoom } from '../../realtime/broadcast';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { formatIssueKey } from '../../utils/issue-key';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { emitIssueEvents } from '../bot-events/emit';

type BasicUser = { id: string; username: string; displayName: string };
type IssueWithRelations = Issue & {
  assignee: BasicUser | null;
  labels: Label[];
  column: { id: string; name: string } | null;
};
type SprintWithIssues = Sprint & { issues: IssueWithRelations[] };
type IssueWithColumn = Issue & { column: BoardColumn | null };

/**
 * Create a new sprint in PLANNING status.
 * @param projectId - The project to create the sprint in
 * @param data - Sprint creation data including name, optional goal, start date, and end date
 * @param data.name
 * @param data.goal
 * @param data.startDate
 * @param data.endDate
 * @returns The created sprint with issues
 * @throws {AppError} 404 if project not found
 */
export async function createSprint(
  projectId: string,
  data: { name: string; goal?: string; startDate: string; endDate: string },
) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

  return prisma.sprint.create({
    data: {
      projectId,
      name: data.name,
      goal: data.goal,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      status: 'PLANNING',
    },
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * How many sprints a project has, optionally by status.
 * @param projectId - The project
 * @param opts - The filter
 * @param opts.status - The status
 */
export async function countSprints(projectId: string, opts?: { status?: string }) {
  return prisma.sprint.count({
    where: {
      projectId,
      ...(opts?.status ? { status: opts.status as Prisma.EnumSprintStatusFilter } : {}),
    },
  });
}

/**
 * List sprints for a project, optionally filtered by status, with computed story points.
 * @param projectId - The project to list sprints for
 * @param opts - Optional filter and page
 * @param opts.status
 * @param opts.take - The most to return
 * @param opts.skip - How many to pass over
 * @returns List of sprints with issues and computed story point totals
 * @throws {AppError} 404 if project not found
 */
export async function listSprints(
  projectId: string,
  opts?: { status?: string; take?: number; skip?: number },
) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

  const where: Prisma.SprintWhereInput = { projectId };
  if (opts?.status) {
    where.status = opts.status as Prisma.EnumSprintStatusFilter;
  }

  const sprints = await prisma.sprint.findMany({
    where,
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
    // The id keeps pages stable among sprints that start together
    orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
    ...(opts?.take === undefined ? {} : { take: opts.take }),
    ...(opts?.skip ? { skip: opts.skip } : {}),
  });

  return (sprints as SprintWithIssues[]).map((s: SprintWithIssues) => ({
    ...s,
    _storyPoints: s.issues.reduce(
      (sum: number, i: IssueWithRelations) => sum + (i.storyPoints ?? 0),
      0,
    ),
  }));
}

/**
 * Get a single sprint with its issues and computed story points.
 * @param sprintId - The sprint ID
 * @returns The sprint with issues and computed story point total
 * @throws {AppError} 404 if sprint not found
 */
export async function getSprint(sprintId: string) {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        issues: {
          include: {
            assignee: { select: USER_BASIC_SELECT },
            labels: true,
            column: { select: { id: true, name: true } },
          },
        },
      },
    }),
    ERR.SPRINT_NOT_FOUND,
  );

  return {
    ...sprint,
    _storyPoints: (sprint as SprintWithIssues).issues.reduce(
      (sum: number, i: IssueWithRelations) => sum + (i.storyPoints ?? 0),
      0,
    ),
  };
}

/**
 * Update sprint fields (name, goal, start date, end date).
 * @param sprintId - The sprint ID
 * @param data - Partial update data for the sprint
 * @param data.name
 * @param data.goal
 * @param data.startDate
 * @param data.endDate
 * @returns The updated sprint with issues
 * @throws {AppError} 404 if sprint not found
 */
export async function updateSprint(
  sprintId: string,
  data: { name?: string; goal?: string; startDate?: string; endDate?: string },
) {
  await findOrThrow(prisma.sprint.findUnique({ where: { id: sprintId } }), ERR.SPRINT_NOT_FOUND);

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.goal !== undefined) updateData.goal = data.goal;
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
  if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);

  return prisma.sprint.update({
    where: { id: sprintId },
    data: updateData,
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Start a sprint, transitioning it from PLANNING to ACTIVE. Only one active sprint per project is allowed.
 * @param sprintId - The sprint ID
 * @returns The activated sprint with issues
 * @throws {AppError} 404 if sprint not found
 * @throws {AppError} 400 if sprint is not in PLANNING status
 * @throws {AppError} 409 if another sprint is already active in the project
 */
export async function startSprint(sprintId: string) {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({ where: { id: sprintId } }),
    ERR.SPRINT_NOT_FOUND,
  );
  if (sprint.status !== 'PLANNING') {
    throw new AppError(400, 'Only sprints in PLANNING status can be started');
  }

  // Ensure no other active sprint in the same project
  const activeSprint = await prisma.sprint.findFirst({
    where: { projectId: sprint.projectId, status: 'ACTIVE' },
  });
  if (activeSprint) {
    throw new AppError(409, `Sprint "${activeSprint.name}" is already active. Complete it first.`);
  }

  const started = await prisma.sprint.update({
    where: { id: sprintId },
    data: { status: 'ACTIVE', committedAt: new Date() },
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
  });
  broadcastToRoom(`project:${sprint.projectId}`, {
    type: 'sprint:updated',
    projectId: sprint.projectId,
    sprintId,
  });
  return started;
}

/**
 * Complete a sprint, moving incomplete issues to another sprint or backlog.
 * @param sprintId - The sprint ID to complete
 * @param moveToSprintId - Optional target sprint for incomplete issues (null moves to backlog)
 * @returns The completed sprint with issues
 * @throws {AppError} 404 if sprint or target sprint not found
 * @throws {AppError} 400 if sprint is not active
 */
export async function completeSprint(sprintId: string, moveToSprintId?: string) {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        issues: { include: { column: true } },
      },
    }),
    ERR.SPRINT_NOT_FOUND,
  );
  if (sprint.status !== 'ACTIVE') {
    throw new AppError(400, 'Only active sprints can be completed');
  }

  if (moveToSprintId) {
    const target = await findOrThrow(
      prisma.sprint.findUnique({ where: { id: moveToSprintId } }),
      'Target sprint not found',
    );
    // Unfinished work can only move to a sprint of the same project
    if (target.projectId !== sprint.projectId) {
      throw new AppError(400, 'The target sprint does not belong to this project');
    }
  }

  // Find incomplete issues (not in a "done" column)
  const incompleteIssueIds = (sprint as Sprint & { issues: IssueWithColumn[] }).issues
    .filter((i: IssueWithColumn) => !i.column?.isDone)
    .map((i: IssueWithColumn) => i.id);

  // Record REMOVED events for incomplete issues before moving them
  if (incompleteIssueIds.length > 0) {
    await prisma.sprintIssueHistory.createMany({
      data: incompleteIssueIds.map((issueId) => ({
        sprintId,
        issueId,
        action: 'REMOVED' as const,
      })),
    });

    await prisma.issue.updateMany({
      where: { id: { in: incompleteIssueIds } },
      data: { sprintId: moveToSprintId ?? null },
    });
  }

  const completed = await prisma.sprint.update({
    where: { id: sprintId },
    data: { status: 'COMPLETED' },
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
  });
  broadcastToRoom(`project:${sprint.projectId}`, {
    type: 'sprint:updated',
    projectId: sprint.projectId,
    sprintId,
  });
  return completed;
}

/**
 * Add issues to a sprint (only issues in the same project are affected).
 * @param sprintId - The sprint ID
 * @param issueIds - Array of issue IDs to add to the sprint
 * @returns The updated sprint with all issues
 * @throws {AppError} 404 if sprint not found
 */
export async function addIssuesToSprint(sprintId: string, issueIds: string[]) {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({ where: { id: sprintId } }),
    ERR.SPRINT_NOT_FOUND,
  );

  // Only the project's own issues: ids from elsewhere are ignored, history included
  const ownIssues = await prisma.issue.findMany({
    where: { id: { in: issueIds }, projectId: sprint.projectId },
    select: { id: true, sprintId: true },
  });
  const ownIds = ownIssues.map((i) => i.id);
  await prisma.issue.updateMany({
    where: { id: { in: ownIds } },
    data: { sprintId },
  });

  // Record ADDED history events
  await prisma.sprintIssueHistory.createMany({
    data: ownIds.map((issueId) => ({ sprintId, issueId, action: 'ADDED' as const })),
  });

  for (const issue of ownIssues) {
    if (issue.sprintId !== sprintId) {
      await emitIssueEvents({ issueId: issue.id, changedFields: ['sprint'] });
    }
  }

  return getSprint(sprintId);
}

/**
 * Remove an issue from its sprint (move to backlog).
 * @param issueId - The issue ID to remove from its sprint
 * @returns The updated issue with sprintId set to null
 * @throws {AppError} 404 if issue not found
 */
export async function removeIssueFromSprint(issueId: string) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({ where: { id: issueId } }),
    ERR.ISSUE_NOT_FOUND,
  );

  // Record REMOVED history event before clearing sprint
  if (issue.sprintId) {
    await prisma.sprintIssueHistory.create({
      data: { sprintId: issue.sprintId, issueId, action: 'REMOVED' },
    });
  }

  const updated = await prisma.issue.update({
    where: { id: issueId },
    data: { sprintId: null },
  });
  if (issue.sprintId) await emitIssueEvents({ issueId, changedFields: ['sprint'] });
  return updated;
}

/**
 * Calculate velocity: story points completed per sprint for the last N completed sprints.
 * @param projectId - The project to calculate velocity for
 * @param sprintCount - Number of recent completed sprints to include (defaults to 5)
 * @returns Chronologically ordered list of sprints with completed points and issue counts
 * @throws {AppError} 404 if project not found
 */
export async function getVelocity(projectId: string, sprintCount = 5) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

  const completedSprints = await prisma.sprint.findMany({
    where: { projectId, status: 'COMPLETED' },
    orderBy: { endDate: 'desc' },
    take: sprintCount,
    include: {
      issues: {
        where: { column: { isDone: true } },
        select: { storyPoints: true },
      },
    },
  });

  type SprintWithPoints = Sprint & { issues: { storyPoints: number | null }[] };
  return (completedSprints as SprintWithPoints[])
    .map((s: SprintWithPoints) => ({
      sprintId: s.id,
      sprintName: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      completedPoints: s.issues.reduce(
        (sum: number, i: { storyPoints: number | null }) => sum + (i.storyPoints ?? 0),
        0,
      ),
      issueCount: s.issues.length,
    }))
    .reverse(); // chronological order
}

/**
 * Get backlog issues (issues with no sprint assigned) for a project.
 * @param projectId - The project to get backlog issues for
 * @returns List of unassigned issues with computed keys
 * @throws {AppError} 404 if project not found
 */
export async function getBacklog(projectId: string) {
  const project = await findOrThrow(
    prisma.project.findUnique({ where: { id: projectId } }),
    ERR.PROJECT_NOT_FOUND,
  );

  const issues = await prisma.issue.findMany({
    where: { projectId, sprintId: null },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      labels: true,
      column: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (issues as IssueWithRelations[]).map((i: IssueWithRelations) => ({
    ...i,
    key: formatIssueKey(project.prefix, i.number),
  }));
}
