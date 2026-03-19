import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { notifyMentions } from '../../utils/mention-notifier';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';
import { evaluateRules } from '../automation/automation.service';
import { createNotification } from '../notifications/notifications.service';
import { validateTransition } from '../workflows/workflow.service';

/**
 *
 * @param projectId
 * @param creatorId
 * @param data
 * @param data.title
 * @param data.body
 * @param data.type
 * @param data.priority
 * @param data.assigneeId
 * @param data.labels
 * @param data.dueDate
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

  // Get next issue number
  const lastIssue = await prisma.issue.findFirst({
    where: { projectId },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const number = (lastIssue?.number ?? 0) + 1;

  // Find default column
  const defaultColumn = await prisma.boardColumn.findFirst({
    where: { projectId, isDefault: true },
  });

  const issue = await prisma.issue.create({
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

  return { ...issue, key: `${project.prefix}-${number}` };
}

/**
 *
 * @param projectId
 * @param issueNumber
 */
export async function getIssue(projectId: string, issueNumber: number) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
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
 *
 * @param projectId
 * @param filters
 * @param filters.type
 * @param filters.priority
 * @param filters.assigneeId
 * @param filters.columnId
 * @param filters.label
 * @param filters.limit
 * @param filters.offset
 */
export async function listIssues(
  projectId: string,
  filters?: {
    type?: string;
    priority?: string;
    assigneeId?: string;
    columnId?: string;
    label?: string;
    limit?: number;
    offset?: number;
  },
) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

  const where: Prisma.IssueWhereInput = { projectId };
  if (filters?.type) where.type = filters.type as Prisma.IssueWhereInput['type'];
  if (filters?.priority) where.priority = filters.priority as Prisma.IssueWhereInput['priority'];
  if (filters?.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters?.columnId) where.columnId = filters.columnId;
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
      take: filters?.limit ?? 50,
      skip: filters?.offset ?? 0,
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
}

/**
 *
 * @param projectId
 * @param issueNumber
 * @param data
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
 * @param userId
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
    },
  });

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

  return updated;
}

/**
 *
 * @param projectId
 * @param issueNumber
 * @param userId
 */
export async function deleteIssue(projectId: string, issueNumber: number, userId?: string) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');
  await prisma.issue.delete({ where: { id: issue.id } });
  if (userId) {
    await logActivity('issue', issue.id, 'deleted', userId, {
      title: issue.title,
      number: issueNumber,
    });
  }
}

/**
 *
 * @param issueId
 * @param authorId
 * @param body
 */
export async function addComment(issueId: string, authorId: string, body: string) {
  const comment = await prisma.comment.create({
    data: { issueId, authorId, body },
    include: { author: { select: USER_BASIC_SELECT } },
  });

  await logActivity('issue', issueId, 'commented', authorId, { commentId: comment.id });

  // Notify issue assignee about the new comment (if not the commenter)
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { assigneeId: true, title: true },
  });
  if (issue?.assigneeId && issue.assigneeId !== authorId) {
    createNotification(
      issue.assigneeId,
      'issue:commented',
      `New comment on ${issue.title}`,
      body.length > 120 ? body.slice(0, 120) + '...' : body,
      `/issues/${issueId}`,
    ).catch((err) => {
      logger.error('Failed to send comment notification', { issueId }, err as Error);
    });
  }

  // Notify @mentioned users in the comment
  notifyMentions(body, authorId, `/issues/${issueId}`).catch((err) => {
    logger.error('Failed to send mention notifications', { issueId }, err as Error);
  });

  return comment;
}

/**
 *
 * @param commentId
 * @param userId
 * @param body
 */
export async function updateComment(commentId: string, userId: string, body: string) {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) throw new AppError(404, 'Comment not found');
  if (comment.authorId !== userId) throw new AppError(403, 'You can only edit your own comments');

  return prisma.comment.update({
    where: { id: commentId },
    data: { body },
    include: { author: { select: USER_BASIC_SELECT } },
  });
}

/**
 *
 * @param commentId
 * @param userId
 */
export async function deleteComment(commentId: string, userId: string) {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) throw new AppError(404, 'Comment not found');
  if (comment.authorId !== userId) throw new AppError(403, 'You can only delete your own comments');

  await prisma.comment.delete({ where: { id: commentId } });
}

/**
 *
 * @param projectId
 */
export async function getBoard(projectId: string) {
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
      key: `${project!.prefix}-${i.number}`,
    })),
  }));
}

/**
 *
 * @param projectId
 * @param issueNumber
 */
/**
 *
 * @param projectId
 * @param issueNumber
 * @param columnId
 * @param position
 */
export async function moveIssue(
  projectId: string,
  issueNumber: number,
  columnId: string,
  position: number,
) {
  const issue = await prisma.issue.findFirst({
    where: { projectId, number: issueNumber },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  // Validate workflow transition
  await validateTransition(projectId, issue.columnId, columnId);

  const updated = await prisma.issue.update({
    where: { id: issue.id },
    data: { columnId, position },
  });

  // Fire automation rules (non-blocking)
  if (columnId !== issue.columnId) {
    evaluateRules(projectId, 'issue:status_changed', {
      issue: updated,
      from: issue.columnId,
      to: columnId,
    }).catch((err) => {
      logger.error(
        'Failed to evaluate automation rules for issue:status_changed',
        { projectId },
        err as Error,
      );
    });
  }

  return updated;
}

/**
 *
 * @param projectId
 * @param issueNumber
 */
export async function getIssuePullRequests(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findFirst({
    where: { projectId, number: issueNumber },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  return prisma.issuePullRequest.findMany({
    where: { issueId: issue.id },
    include: {
      pr: {
        select: { id: true, number: true, title: true, status: true, sourceBranch: true },
      },
    },
  });
}

/**
 * Set the parent of an issue (for epic hierarchy).
 * Validates same project and no circular references.
 * @param projectId
 * @param issueNumber
 * @param parentIssueNumber
 */
export async function setParent(
  projectId: string,
  issueNumber: number,
  parentIssueNumber: number | null,
) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  if (parentIssueNumber === null) {
    return prisma.issue.update({
      where: { id: issue.id },
      data: { parentId: null },
      include: {
        assignee: { select: USER_BASIC_SELECT },
        labels: true,
        column: true,
      },
    });
  }

  const parent = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: parentIssueNumber } },
  });
  if (!parent) throw new AppError(404, 'Parent issue not found');
  if (parent.id === issue.id) throw new AppError(400, 'An issue cannot be its own parent');

  // Check for circular references: walk up from the proposed parent
  let current = parent;
  while (current.parentId) {
    if (current.parentId === issue.id) {
      throw new AppError(400, 'Circular parent reference detected');
    }
    const next = await prisma.issue.findUnique({ where: { id: current.parentId } });
    if (!next) break;
    current = next;
  }

  return prisma.issue.update({
    where: { id: issue.id },
    data: { parentId: parent.id },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      labels: true,
      column: true,
    },
  });
}

/**
 * Get child issues of a given issue.
 * @param projectId
 * @param issueNumber
 */
export async function getChildren(projectId: string, issueNumber: number) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  const children = await prisma.issue.findMany({
    where: { parentId: issue.id },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      labels: true,
      column: { select: { id: true, name: true, isDone: true } },
    },
    orderBy: { number: 'asc' },
  });

  return children.map((c: (typeof children)[number]) => ({
    ...c,
    key: `${project.prefix}-${c.number}`,
  }));
}

/**
 * Get progress stats for an issue's children.
 * @param projectId
 * @param issueNumber
 */
export async function getEpicProgress(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
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

/**
 * Get roadmap data: epics with children, grouped for timeline display.
 * @param projectId
 */
export async function getRoadmap(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

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
      key: `${project.prefix}-${epic.number}`,
      children: children.map((c: (typeof children)[number]) => ({
        ...c,
        key: `${project.prefix}-${c.number}`,
      })),
      progress: { total, completed, percentage },
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    };
  });
}

/**
 * Log work against an issue. Increments timeSpent and records an activity entry.
 * @param projectId
 * @param issueNumber
 * @param userId
 * @param minutes
 * @param description
 */
export async function logWork(
  projectId: string,
  issueNumber: number,
  userId: string,
  minutes: number,
  description?: string,
) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  const updated = await prisma.issue.update({
    where: { id: issue.id },
    data: { timeSpent: (issue.timeSpent ?? 0) + minutes },
  });

  await logActivity('issue', issue.id, 'time_logged', userId, {
    minutes,
    description: description ?? '',
    totalSpent: updated.timeSpent,
  });

  return { timeSpent: updated.timeSpent, logged: minutes };
}

/**
 * Get work log entries for an issue (activity records with action='time_logged').
 * @param projectId
 * @param issueNumber
 */
export async function getWorklogs(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  const activities = await prisma.activity.findMany({
    where: { resourceType: 'issue', resourceId: issue.id, action: 'time_logged' },
    include: { user: { select: USER_BASIC_SELECT } },
    orderBy: { createdAt: 'desc' },
  });

  return activities.map((a: (typeof activities)[number]) => ({
    id: a.id,
    userId: a.userId,
    user: a.user,
    minutes: (a.details as Record<string, unknown>)?.minutes as number,
    description: (a.details as Record<string, unknown>)?.description as string,
    createdAt: a.createdAt,
  }));
}

/**
 * Bulk update multiple issues at once.
 * @param projectId
 * @param issueIds
 * @param updates
 * @param updates.status
 * @param updates.assigneeId
 * @param updates.priority
 * @param updates.sprintId
 * @param updates.labels
 * @param userId
 */
export async function bulkUpdate(
  projectId: string,
  issueIds: string[],
  updates: {
    status?: string;
    assigneeId?: string | null;
    priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    sprintId?: string | null;
    labels?: string[];
  },
  userId: string,
) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

  const issues = await prisma.issue.findMany({
    where: { id: { in: issueIds }, projectId },
  });
  if (issues.length === 0) throw new AppError(404, 'No matching issues found');

  const results = [];
  for (const issue of issues) {
    const updateData: Prisma.IssueUpdateInput = {};

    if (updates.status !== undefined) {
      updateData.column = { connect: { id: updates.status } };
    }
    if (updates.assigneeId !== undefined) {
      updateData.assignee = updates.assigneeId
        ? { connect: { id: updates.assigneeId } }
        : { disconnect: true };
    }
    if (updates.priority !== undefined) {
      updateData.priority = updates.priority;
    }
    if (updates.sprintId !== undefined) {
      updateData.sprint = updates.sprintId
        ? { connect: { id: updates.sprintId } }
        : { disconnect: true };
    }
    if (updates.labels !== undefined) {
      updateData.labels = {
        set: [],
        connectOrCreate: updates.labels.map((name) => ({
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
      },
    });

    const changedFields = Object.keys(updates).filter(
      (k) => updates[k as keyof typeof updates] !== undefined,
    );
    await logActivity('issue', issue.id, 'bulk_updated', userId, {
      fields: changedFields,
    });

    results.push(updated);
  }

  return { updated: results.length, issues: results };
}
