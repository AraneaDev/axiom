import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { cacheable } from '../../config/redis';
import { parse, compileToPrisma, freeTextOf, QueryValueError } from '../../lib/query-engine';
import { issueFieldRegistry } from '../../lib/query-engine/fields/issue-fields';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToRoom } from '../../realtime/broadcast';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { invalidateIssueCache, ISSUE_LIST_TTL } from '../../utils/issue-cache';
import { formatIssueKey } from '../../utils/issue-key';
import { logger } from '../../utils/logger';
import { notifyMentions } from '../../utils/mention-notifier';
import { parseServicePagination } from '../../utils/pagination';
import {
  USER_BASIC_SELECT,
  TEAM_ORG_INCLUDE,
  PROJECT_TEAM_ORG_INCLUDE,
} from '../../utils/prisma-selects';
import { MAX_DB_INT } from '../../utils/validation/common-validators';
import { logActivity } from '../activity/activity.service';
import { bindStagedAttachments } from '../attachments/upload-intents.service';
import { AUTOMATION_ISSUE_INCLUDE, evaluateRules } from '../automation/automation.service';
import { createNotification } from '../notifications/notifications.service';
import { resolveQueryFields } from '../search/query-fields.service';

import {
  assertAssignable,
  assertColumnTransition,
  assertIssueRefsInProject,
  assertNotGatedEntry,
} from './issue-references';

// Re-export from sub-modules for backwards compatibility
export { findIssueOrThrow } from './issue-utils';
export { addComment, updateComment, deleteComment } from './issue-comments.service';
export { logWork, getWorklogs, getTimeReport } from './issue-time.service';
export { setParent, getChildren } from './issue-hierarchy.service';
export { getBoard, moveIssue, columnInOtherProject, getRoadmap } from './issue-board.service';
export { exportIssuesCsv } from './issue-export.service';
export { bulkUpdate } from './issue-bulk.service';

/**
 * Create a new issue in the specified project.
 * @param projectId - The project to create the issue in
 * @param creatorId - The user creating the issue
 * @param data - Issue creation data including title, body, type, priority, assignee, labels, and due date
 * @param data.title
 * @param data.body
 * @param data.type
 * @param data.priority
 * @param data.assigneeId
 * @param data.labels
 * @param data.dueDate
 * @param options
 * @param options.skipAutomation
 * @param options.skipMentions - Notify nobody the body mentions (imported text)
 * @param options.externalAuthorLogin - The GitHub login of an imported issue's author, when the
 *   creator is the integration user
 * @returns The created issue with assignee, creator, labels, column relations and computed key
 * @throws {AppError} 404 if project not found
 */
export async function createIssue(
  projectId: string,
  creatorId: string,
  data: {
    title: string;
    body?: string;
    type?: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
    priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    assigneeId?: string;
    labels?: string[];
    dueDate?: string;
  },
  options?: { skipAutomation?: boolean; skipMentions?: boolean; externalAuthorLogin?: string },
) {
  const project = await findOrThrow(
    prisma.project.findUnique({ where: { id: projectId } }),
    ERR.PROJECT_NOT_FOUND,
  );
  await assertAssignable(projectId, data.assigneeId);

  // Find default column
  const defaultColumn = await prisma.boardColumn.findFirst({
    where: { projectId, isDefault: true },
  });
  await assertNotGatedEntry(projectId, defaultColumn?.id);

  // Get next issue number and create, with retry on unique constraint violation (race condition)
  let retries = 3;
  let issue: Awaited<ReturnType<typeof prisma.issue.create>> | undefined;
  while (retries > 0) {
    try {
      const lastIssue = await prisma.issue.findFirst({
        where: { projectId },
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (lastIssue?.number ?? 0) + 1;

      issue = await prisma.issue.create({
        data: {
          projectId,
          number,
          title: data.title,
          body: data.body ?? '',
          type: data.type ?? 'TASK',
          priority: data.priority ?? 'MEDIUM',
          assigneeId: data.assigneeId,
          creatorId,
          externalAuthorLogin: options?.externalAuthorLogin,
          columnId: defaultColumn?.id,
          dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
          labels: data.labels
            ? {
                connectOrCreate: data.labels.map((name) => ({
                  where: { projectId_name: { projectId, name } },
                  create: { projectId, name },
                })),
              }
            : undefined,
        },
        include: {
          assignee: { select: USER_BASIC_SELECT },
          creator: { select: USER_BASIC_SELECT },
          labels: true,
          column: true,
        },
      });
      break;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err as { code: string }).code === 'P2002'
      ) {
        retries--;
        if (retries === 0) throw err;
        continue;
      }
      throw err;
    }
  }

  if (!issue) throw new AppError(500, 'Failed to create issue');

  await invalidateIssueCache(projectId);
  await logActivity('issue', issue.id, 'created', creatorId, { title: data.title });

  if (data.body) await bindStagedAttachments(data.body, { issueId: issue.id }, creatorId);

  // Notify @mentioned users in the issue body
  if (data.body && !options?.skipMentions) {
    notifyMentions(data.body, creatorId, `/issues/${issue.id}`).catch((err) => {
      logger.error('Failed to send mention notifications', { issueId: issue.id }, err as Error);
    });
  }

  // Fire automation rules (non-blocking)
  if (!options?.skipAutomation) {
    prisma.issue
      .findUnique({ where: { id: issue.id }, include: AUTOMATION_ISSUE_INCLUDE })
      .then((hydrated) => {
        if (hydrated) {
          return evaluateRules(projectId, 'issue:created', {
            issue: hydrated,
            actorId: creatorId,
          });
        }
      })
      .catch((err) => {
        logger.error(
          'Failed to evaluate automation rules for issue:created',
          { projectId },
          err as Error,
        );
      });
  }

  broadcastToRoom(`project:${projectId}`, { type: 'issue:created', projectId, issueId: issue.id });

  return { ...issue, key: formatIssueKey(project.prefix, issue.number) };
}

/**
 * Retrieve a single issue by project and issue number, including comments and relations.
 * @param projectId - The project the issue belongs to
 * @param issueNumber - The issue number within the project
 * @returns The issue with assignee, creator, labels, column, sprint, parent, comments, and computed key
 * @throws {AppError} 404 if project or issue not found
 */
export async function getIssue(projectId: string, issueNumber: number) {
  const project = await findOrThrow(
    prisma.project.findUnique({
      where: { id: projectId },
      include: TEAM_ORG_INCLUDE,
    }),
    ERR.PROJECT_NOT_FOUND,
  );

  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
      include: {
        assignee: { select: USER_BASIC_SELECT },
        creator: { select: USER_BASIC_SELECT },
        labels: true,
        column: true,
        sprint: { select: { id: true, name: true } },
        parent: { select: { id: true, number: true, title: true } },
        project: { include: TEAM_ORG_INCLUDE },
        comments: {
          include: { author: { select: USER_BASIC_SELECT } },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  return {
    ...issue,
    key: formatIssueKey(project.prefix, issue.number),
    parent: issue.parent
      ? { ...issue.parent, key: formatIssueKey(project.prefix, issue.parent.number) }
      : null,
  };
}

/**
 * Detect whether a query string uses structured query syntax.
 * Plain text queries (e.g. "login bug") fall through to simple text search.
 * @param q
 */
function isStructuredQuery(q: string): boolean {
  return /[=><!~]|(?:^|\s)(?:AND|OR|NOT|IN)(?:\s|$)|\w+:/.test(q);
}

/**
 * Apply plain-text search to a Prisma WHERE clause (number match OR title contains).
 * @param where
 * @param q
 */
function applyPlainTextSearch(where: Prisma.IssueWhereInput, q: string): void {
  const num = parseInt(q, 10);
  // Digits past the column can't be an issue number, and are still text to find
  if (!isNaN(num) && Math.abs(num) <= MAX_DB_INT) {
    where.OR = [{ number: num }, { title: { contains: q, mode: 'insensitive' } }];
  } else {
    where.title = { contains: q, mode: 'insensitive' };
  }
}

/**
 * List issues in a project with optional filtering and pagination.
 * @param projectId - The project to list issues from
 * @param filters - Optional filters for type, priority, assignee, column, label, and pagination
 * @param filters.q
 * @param filters.type
 * @param filters.priority
 * @param filters.assigneeId
 * @param filters.columnId
 * @param filters.label
 * @param filters.limit
 * @param filters.offset
 * @param filters.currentUserId
 * @param filters.sprintId
 * @returns Paginated list of issues with computed keys and total count
 * @throws {AppError} 404 if project not found
 */
export async function listIssues(
  projectId: string,
  filters?: {
    q?: string;
    type?: string;
    priority?: string;
    assigneeId?: string;
    columnId?: string;
    sprintId?: string;
    label?: string;
    limit?: number;
    offset?: number;
    /** Who asks, for what a structured q says about them: currentUser(), visible issue keys */
    currentUserId?: string;
  },
) {
  const project = await findOrThrow(
    prisma.project.findUnique({ where: { id: projectId } }),
    ERR.PROJECT_NOT_FOUND,
  );

  // Everything that shapes the answer. The caller was authorized on the project, so only a q varies
  // by viewer. JSON, so that text in one filter can't pass for another
  const cacheKey = `issues:${projectId}:${JSON.stringify([
    filters?.limit ?? null,
    filters?.offset ?? 0,
    filters?.q || '',
    filters?.q ? (filters.currentUserId ?? '') : '',
    filters?.type || '',
    filters?.priority || '',
    filters?.assigneeId || '',
    filters?.columnId || '',
    filters?.sprintId || '',
    filters?.label || '',
  ])}`;
  return cacheable(cacheKey, ISSUE_LIST_TTL, async () => {
    const { take, skip } = parseServicePagination(filters, 50);
    const where: Prisma.IssueWhereInput = { projectId };

    if (filters?.q && isStructuredQuery(filters.q)) {
      // Structured query: parse through the query engine
      try {
        const ast = parse(filters.q);
        const currentUserId = filters.currentUserId;
        const scope = currentUserId ? { userId: currentUserId, projectId } : { projectId };
        const engineWhere = compileToPrisma(ast, issueFieldRegistry, {
          projectId,
          currentUserId,
          ...(await resolveQueryFields(ast, scope)),
        });
        // In AND, so that no query can replace the project this list was authorized on
        where.AND = [engineWhere as Prisma.IssueWhereInput];
        const text = freeTextOf(ast);
        if (text) applyPlainTextSearch(where, text);
      } catch (err) {
        if (err instanceof QueryValueError) throw new AppError(400, err.message, 'INVALID_QUERY');
        // If parse fails, fall back to plain text search
        applyPlainTextSearch(where, filters.q);
      }
    } else if (filters?.q) {
      // Plain text: search by number or title
      applyPlainTextSearch(where, filters.q);
    }

    // Individual filter params (backwards compat — only applied when no structured q)
    if (!filters?.q || !isStructuredQuery(filters.q)) {
      if (filters?.type) where.type = filters.type as Prisma.IssueWhereInput['type'];
      if (filters?.priority)
        where.priority = filters.priority as Prisma.IssueWhereInput['priority'];
      if (filters?.assigneeId) where.assigneeId = filters.assigneeId;
      if (filters?.columnId) where.columnId = filters.columnId;
      if (filters?.sprintId === 'none') {
        where.sprintId = null;
      } else if (filters?.sprintId) {
        where.sprintId = filters.sprintId;
      }
      if (filters?.label) where.labels = { some: { name: filters.label } };
    }

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
        // The id keeps pages stable among issues at one position
        orderBy: [{ column: { position: 'asc' } }, { position: 'asc' }, { id: 'asc' }],
        take,
        skip,
      }),
      prisma.issue.count({ where }),
    ]);

    return {
      issues: issues.map((i: (typeof issues)[number]) => ({
        ...i,
        key: formatIssueKey(project.prefix, i.number),
      })),
      total,
    };
  }); // end cacheable
}

/**
 * The board column a status name stands for within a project, whatever its case.
 * @param projectId - The project
 * @param status - The column's name
 * @throws {AppError} 400 INVALID_STATUS naming the valid statuses, for a name that isn't exactly one column
 */
export async function columnIdForStatus(projectId: string, status: string): Promise<string> {
  const columns = await prisma.boardColumn.findMany({
    where: { projectId },
    select: { id: true, name: true },
    orderBy: { position: 'asc' },
  });
  const wanted = status.toLowerCase();
  const matches = columns.filter((column) => column.name.toLowerCase() === wanted);
  if (matches.length === 1) return matches[0].id;
  const valid = columns.map((column) => column.name).join(', ');
  const problem = matches.length > 1 ? 'Several columns are named' : 'Unknown status';
  throw new AppError(
    400,
    `${problem} "${status}". Valid statuses: ${valid}. Use columnId for a shared name.`,
    'INVALID_STATUS',
  );
}

/**
 * Update an existing issue with partial data, logging granular activity events and firing automation rules.
 * @param projectId - The project the issue belongs to
 * @param issueNumber - The issue number within the project
 * @param data - Partial update data for the issue fields
 * @param data.title
 * @param data.body
 * @param data.type
 * @param data.priority
 * @param data.assigneeId
 * @param data.columnId
 * @param data.position
 * @param data.dueDate
 * @param data.labels
 * @param data.storyPoints
 * @param data.sprintId
 * @param data.timeEstimate
 * @param data.timeSpent
 * @param userId - The user performing the update (used for activity logging)
 * @param options
 * @param options.skipAutomation
 * @returns The updated issue with assignee, labels, column, and sprint relations
 * @throws {AppError} 404 if issue not found
 * @throws {AppError} 400 if workflow transition is invalid
 */
export async function updateIssue(
  projectId: string,
  issueNumber: number,
  data: {
    title?: string;
    body?: string;
    type?: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
    priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    assigneeId?: string;
    columnId?: string;
    position?: number;
    dueDate?: string;
    labels?: string[];
    storyPoints?: number | null;
    sprintId?: string | null;
    timeEstimate?: number | null;
    timeSpent?: number | null;
  },
  userId?: string,
  options?: { skipAutomation?: boolean },
) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
      include: { labels: { select: { name: true } } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  const previousLabels =
    (issue as unknown as { labels?: { name: string }[] }).labels?.map((l) => l.name) ?? [];

  await assertIssueRefsInProject(projectId, { columnId: data.columnId, sprintId: data.sprintId });
  await assertAssignable(projectId, data.assigneeId);

  // Validate workflow transition before updating column
  if (data.columnId !== undefined && data.columnId !== issue.columnId) {
    await assertColumnTransition(projectId, issue.columnId, data.columnId);
  }

  const updateData: Prisma.IssueUpdateInput = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.body !== undefined) updateData.body = data.body;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.assigneeId !== undefined)
    updateData.assignee = data.assigneeId
      ? { connect: { id: data.assigneeId } }
      : { disconnect: true };
  if (data.columnId !== undefined) updateData.column = { connect: { id: data.columnId } };
  if (data.position !== undefined) updateData.position = data.position;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  if (data.storyPoints !== undefined) updateData.storyPoints = data.storyPoints;
  if (data.timeEstimate !== undefined) updateData.timeEstimate = data.timeEstimate;
  if (data.timeSpent !== undefined) updateData.timeSpent = data.timeSpent;
  if (data.sprintId !== undefined)
    updateData.sprint = data.sprintId ? { connect: { id: data.sprintId } } : { disconnect: true };

  if (data.labels !== undefined) {
    updateData.labels = {
      set: [],
      connectOrCreate: data.labels.map((name) => ({
        where: { projectId_name: { projectId, name } },
        create: { projectId, name },
      })),
    };
  }

  const updated = await prisma.issue.update({
    where: { id: issue.id },
    data: updateData,
    include: {
      assignee: { select: USER_BASIC_SELECT },
      labels: true,
      column: true,
      sprint: { select: { id: true, name: true } },
      project: { include: TEAM_ORG_INCLUDE },
    },
  });

  await invalidateIssueCache(projectId);

  // Log granular activity events
  // We need a userId -- pull it from the issue's last updater context
  // Since service doesn't have userId, we log with a details-based approach
  const actorId = userId ?? issue.creatorId;
  if (data.columnId !== undefined && data.columnId !== issue.columnId) {
    await logActivity('issue', issue.id, 'status_changed', actorId, {
      from: issue.columnId,
      to: data.columnId,
    });
  }
  if (data.priority !== undefined && data.priority !== issue.priority) {
    await logActivity('issue', issue.id, 'priority_changed', actorId, {
      from: issue.priority,
      to: data.priority,
    });
  }
  if (data.assigneeId !== undefined && data.assigneeId !== issue.assigneeId) {
    await logActivity('issue', issue.id, data.assigneeId ? 'assigned' : 'unassigned', actorId, {
      from: issue.assigneeId,
      to: data.assigneeId,
    });
    // Notify the new assignee
    if (data.assigneeId) {
      createNotification(
        data.assigneeId,
        'issue:assigned',
        `You were assigned to ${updated.title}`,
        undefined,
        `/${updated.project.team.org.slug}/${updated.project.team.slug}/${updated.project.slug}/issues/${updated.number}`,
      ).catch((err) => {
        logger.error('Failed to send assignment notification', { issueId: issue.id }, err as Error);
      });
    }
  }
  if (data.labels !== undefined) {
    await logActivity('issue', issue.id, 'labeled', actorId, { labels: data.labels });
  }
  if (data.type !== undefined && data.type !== issue.type) {
    await logActivity('issue', issue.id, 'type_changed', actorId, {
      from: issue.type,
      to: data.type,
    });
  }
  if (data.title !== undefined && data.title !== issue.title) {
    await logActivity('issue', issue.id, 'updated', actorId, { field: 'title' });
  }
  if (data.body !== undefined && data.body !== issue.body) {
    await logActivity('issue', issue.id, 'updated', actorId, { field: 'body' });
    await bindStagedAttachments(data.body, { issueId: issue.id }, actorId);
  }

  // Fire automation rules (non-blocking)
  if (!options?.skipAutomation) {
    prisma.issue
      .findUnique({ where: { id: issue.id }, include: AUTOMATION_ISSUE_INCLUDE })
      .then((hydrated) => {
        if (!hydrated) return;
        const ctx = { issue: hydrated, actorId };

        if (data.columnId !== undefined && data.columnId !== issue.columnId) {
          evaluateRules(projectId, 'issue:status_changed', {
            ...ctx,
            from: issue.columnId,
            to: data.columnId,
          }).catch((err) => {
            logger.error(
              'Failed to evaluate automation rules for issue:status_changed',
              { projectId },
              err as Error,
            );
          });
        }
        if (data.assigneeId !== undefined && data.assigneeId !== issue.assigneeId) {
          evaluateRules(projectId, 'issue:assigned', ctx).catch((err) => {
            logger.error(
              'Failed to evaluate automation rules for issue:assigned',
              { projectId },
              err as Error,
            );
          });
        }
        if (data.labels !== undefined) {
          const currentLabels =
            (hydrated.labels as { name: string }[] | undefined)?.map((l) => l.name) ?? [];
          const addedLabels = currentLabels.filter((l: string) => !previousLabels.includes(l));
          for (const label of addedLabels) {
            evaluateRules(projectId, 'label:added', { ...ctx, label }).catch((err) => {
              logger.error(
                'Failed to evaluate automation rules for label:added',
                { projectId },
                err as Error,
              );
            });
          }
        }
      })
      .catch((err) => {
        logger.error('Failed to hydrate issue for automation rules', { projectId }, err as Error);
      });
  }

  broadcastToRoom(`project:${projectId}`, { type: 'issue:updated', projectId, issueId: issue.id });

  return updated;
}

/**
 * Delete an issue by project and issue number.
 * @param projectId - The project the issue belongs to
 * @param issueNumber - The issue number within the project
 * @param userId - The user performing the deletion (optional, used for activity logging)
 * @throws {AppError} 404 if issue not found
 */
export async function deleteIssue(projectId: string, issueNumber: number, userId?: string) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );
  await prisma.issue.delete({ where: { id: issue.id } });
  await invalidateIssueCache(projectId);
  if (userId) {
    await logActivity('issue', issue.id, 'deleted', userId, {
      title: issue.title,
      number: issueNumber,
    });
  }

  broadcastToRoom(`project:${projectId}`, { type: 'issue:updated', projectId, issueId: issue.id });
}

/**
 * Get progress stats for an epic's child issues (total, completed, in-progress, percentage).
 * @param projectId - The project the epic belongs to
 * @param issueNumber - The epic issue number
 * @returns Progress object with total, completed, inProgress, and percentage fields
 * @throws {AppError} 404 if issue not found
 */
export async function getEpicProgress(projectId: string, issueNumber: number) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
      include: PROJECT_TEAM_ORG_INCLUDE,
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  const children = await prisma.issue.findMany({
    where: { parentId: issue.id },
    include: { column: { select: { isDone: true } } },
  });

  const total = children.length;
  const completed = children.filter((c: (typeof children)[number]) => c.column?.isDone).length;
  const inProgress = children.filter(
    (c: (typeof children)[number]) => c.columnId && !c.column?.isDone,
  ).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { total, completed, inProgress, percentage };
}
