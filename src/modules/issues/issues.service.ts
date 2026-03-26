import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { cacheable, cacheInvalidate } from '../../config/redis';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToRoom } from '../../realtime/broadcast';
import { logger } from '../../utils/logger';
import { notifyMentions } from '../../utils/mention-notifier';
import { parseServicePagination } from '../../utils/pagination';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';
import { evaluateRules } from '../automation/automation.service';
import { createNotification } from '../notifications/notifications.service';
import { validateTransition } from '../workflows/workflow.service';

// Re-export from sub-modules for backwards compatibility
export { findIssueOrThrow } from './issue-utils';
export { addComment, updateComment, deleteComment } from './issue-comments.service';
export { logWork, getWorklogs, getTimeReport } from './issue-time.service';
export { setParent, getChildren, getIssuePullRequests } from './issue-hierarchy.service';
export { getBoard, moveIssue, getRoadmap } from './issue-board.service';
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
) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

  // Find default column
  const defaultColumn = await prisma.boardColumn.findFirst({
    where: { projectId, isDefault: true },
  });

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
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        retries--;
        if (retries === 0) throw err;
        continue;
      }
      throw err;
    }
  }

  if (!issue) throw new AppError(500, 'Failed to create issue');

  await cacheInvalidate(`issues:${projectId}:*`, `board:${projectId}`);
  await logActivity('issue', issue.id, 'created', creatorId, { title: data.title });

  // Notify @mentioned users in the issue body
  if (data.body) {
    notifyMentions(data.body, creatorId, `/issues/${issue.id}`).catch((err) => {
      logger.error('Failed to send mention notifications', { issueId: issue.id }, err as Error);
    });
  }

  // Fire automation rules (non-blocking)
  evaluateRules(projectId, 'issue:created', { issue }).catch((err) => {
    logger.error(
      'Failed to evaluate automation rules for issue:created',
      { projectId },
      err as Error,
    );
  });

  broadcastToRoom(`project:${projectId}`, { type: 'issue:created', projectId, issueId: issue.id });

  return { ...issue, key: `${project.prefix}-${issue.number}` };
}

/**
 * Retrieve a single issue by project and issue number, including comments and relations.
 * @param projectId - The project the issue belongs to
 * @param issueNumber - The issue number within the project
 * @returns The issue with assignee, creator, labels, column, sprint, parent, comments, and computed key
 * @throws {AppError} 404 if project or issue not found
 */
export async function getIssue(projectId: string, issueNumber: number) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { org: true } } },
  });
  if (!project) throw new AppError(404, 'Project not found');

  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      creator: { select: USER_BASIC_SELECT },
      labels: true,
      column: true,
      sprint: { select: { id: true, name: true } },
      parent: { select: { id: true, number: true, title: true } },
      project: { include: { team: { include: { org: true } } } },
      comments: {
        include: { author: { select: USER_BASIC_SELECT } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  return {
    ...issue,
    key: `${project.prefix}-${issue.number}`,
    parent: issue.parent
      ? { ...issue.parent, key: `${project.prefix}-${issue.parent.number}` }
      : null,
  };
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
  },
) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

  const cacheKey = `issues:${projectId}:${filters?.offset ?? 0}:${filters?.q || ''}:${filters?.type || ''}:${filters?.priority || ''}:${filters?.assigneeId || ''}:${filters?.columnId || ''}:${filters?.sprintId || ''}:${filters?.label || ''}`;
  return cacheable(cacheKey, 30, async () => {
    const { take, skip } = parseServicePagination(filters, 50);
    const where: Prisma.IssueWhereInput = { projectId };
    if (filters?.q) {
      const q = filters.q;
      // Search by number (if numeric) or title (contains)
      const num = parseInt(q, 10);
      if (!isNaN(num)) {
        where.OR = [{ number: num }, { title: { contains: q, mode: 'insensitive' } }];
      } else {
        where.title = { contains: q, mode: 'insensitive' };
      }
    }
    if (filters?.type) where.type = filters.type as Prisma.IssueWhereInput['type'];
    if (filters?.priority) where.priority = filters.priority as Prisma.IssueWhereInput['priority'];
    if (filters?.assigneeId) where.assigneeId = filters.assigneeId;
    if (filters?.columnId) where.columnId = filters.columnId;
    if (filters?.sprintId === 'none') {
      where.sprintId = null;
    } else if (filters?.sprintId) {
      where.sprintId = filters.sprintId;
    }
    if (filters?.label) where.labels = { some: { name: filters.label } };

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
        orderBy: [{ column: { position: 'asc' } }, { position: 'asc' }],
        take,
        skip,
      }),
      prisma.issue.count({ where }),
    ]);

    return {
      issues: issues.map((i: (typeof issues)[number]) => ({
        ...i,
        key: `${project.prefix}-${i.number}`,
      })),
      total,
    };
  }); // end cacheable
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
) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  // Validate workflow transition before updating column
  if (data.columnId !== undefined && data.columnId !== issue.columnId) {
    await validateTransition(projectId, issue.columnId, data.columnId);
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
      project: { include: { team: { include: { org: true } } } },
    },
  });

  await cacheInvalidate(`issues:${projectId}:*`, `board:${projectId}`);

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
        `/issues/${issue.id}`,
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
  }

  // Fire automation rules (non-blocking)
  if (data.columnId !== undefined && data.columnId !== issue.columnId) {
    evaluateRules(projectId, 'issue:status_changed', {
      issue: updated,
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
    evaluateRules(projectId, 'issue:assigned', { issue: updated }).catch((err) => {
      logger.error(
        'Failed to evaluate automation rules for issue:assigned',
        { projectId },
        err as Error,
      );
    });
  }
  if (data.labels !== undefined) {
    evaluateRules(projectId, 'label:added', { issue: updated }).catch((err) => {
      logger.error(
        'Failed to evaluate automation rules for label:added',
        { projectId },
        err as Error,
      );
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
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');
  await prisma.issue.delete({ where: { id: issue.id } });
  await cacheInvalidate(`issues:${projectId}:*`, `board:${projectId}`);
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
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
    include: { project: { include: { team: { include: { org: true } } } } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

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
