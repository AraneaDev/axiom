import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export async function createIssue(projectId: string, creatorId: string, data: {
  title: string;
  body?: string;
  type?: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  assigneeId?: string;
  labels?: string[];
  dueDate?: string;
}) {
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
      labels: data.labels ? {
        connectOrCreate: data.labels.map((name) => ({
          where: { projectId_name: { projectId, name } },
          create: { projectId, name },
        })),
      } : undefined,
    },
    include: {
      assignee: { select: { id: true, username: true, displayName: true } },
      creator: { select: { id: true, username: true, displayName: true } },
      labels: true,
      column: true,
    },
  });

  return { ...issue, key: `${project.prefix}-${number}` };
}

export async function getIssue(projectId: string, issueNumber: number) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
    include: {
      assignee: { select: { id: true, username: true, displayName: true } },
      creator: { select: { id: true, username: true, displayName: true } },
      labels: true,
      column: true,
      comments: {
        include: { author: { select: { id: true, username: true, displayName: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  return { ...issue, key: `${project.prefix}-${issue.number}` };
}

export async function listIssues(projectId: string, filters?: {
  type?: string;
  priority?: string;
  assigneeId?: string;
  columnId?: string;
  label?: string;
  limit?: number;
  offset?: number;
}) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

  const where: Prisma.IssueWhereInput = { projectId };
  if (filters?.type) (where as any).type = filters.type;
  if (filters?.priority) (where as any).priority = filters.priority;
  if (filters?.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters?.columnId) where.columnId = filters.columnId;
  if (filters?.label) where.labels = { some: { name: filters.label } };

  const [issues, total] = await Promise.all([
    prisma.issue.findMany({
      where,
      include: {
        assignee: { select: { id: true, username: true, displayName: true } },
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
    issues: issues.map((i) => ({ ...i, key: `${project.prefix}-${i.number}` })),
    total,
  };
}

export async function updateIssue(projectId: string, issueNumber: number, data: {
  title?: string;
  body?: string;
  type?: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  assigneeId?: string;
  columnId?: string;
  position?: number;
  dueDate?: string;
  labels?: string[];
}) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  const updateData: Prisma.IssueUpdateInput = {};
  if (data.title !== undefined) updateData.title = data.title;
  if (data.body !== undefined) updateData.body = data.body;
  if (data.type !== undefined) updateData.type = data.type;
  if (data.priority !== undefined) updateData.priority = data.priority;
  if (data.assigneeId !== undefined) updateData.assignee = data.assigneeId ? { connect: { id: data.assigneeId } } : { disconnect: true };
  if (data.columnId !== undefined) updateData.column = { connect: { id: data.columnId } };
  if (data.position !== undefined) updateData.position = data.position;
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;

  if (data.labels !== undefined) {
    updateData.labels = {
      set: [],
      connectOrCreate: data.labels.map((name) => ({
        where: { projectId_name: { projectId, name } },
        create: { projectId, name },
      })),
    };
  }

  return prisma.issue.update({
    where: { id: issue.id },
    data: updateData,
    include: {
      assignee: { select: { id: true, username: true, displayName: true } },
      labels: true,
      column: true,
    },
  });
}

export async function deleteIssue(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');
  await prisma.issue.delete({ where: { id: issue.id } });
}

export async function addComment(issueId: string, authorId: string, body: string) {
  return prisma.comment.create({
    data: { issueId, authorId, body },
    include: { author: { select: { id: true, username: true, displayName: true } } },
  });
}

export async function getBoard(projectId: string) {
  const columns = await prisma.boardColumn.findMany({
    where: { projectId },
    include: {
      issues: {
        include: {
          assignee: { select: { id: true, username: true, displayName: true } },
          labels: true,
        },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { position: 'asc' },
  });

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  return columns.map((col) => ({
    ...col,
    issues: col.issues.map((i) => ({ ...i, key: `${project!.prefix}-${i.number}` })),
  }));
}
