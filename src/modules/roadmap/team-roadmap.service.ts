import type { z } from 'zod';

import { prisma } from '../../config/database';

import type { teamTimelineQuerySchema } from './team-roadmap.validation';

const ISSUE_SELECT = {
  id: true,
  number: true,
  title: true,
  type: true,
  priority: true,
  startDate: true,
  dueDate: true,
  columnId: true,
  parentId: true,
  assigneeId: true,
  roadmapBucketId: true,
  assignee: {
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
    },
  },
  column: { select: { id: true, name: true, isDone: true } },
  labels: { select: { id: true, name: true, color: true } },
  project: {
    select: {
      id: true,
      name: true,
      prefix: true,
      slug: true,
      team: { select: { slug: true, org: { select: { slug: true } } } },
    },
  },
  _count: { select: { children: true } },
} as const;

const CHILDREN_SELECT = {
  id: true,
  number: true,
  title: true,
  type: true,
  priority: true,
  startDate: true,
  dueDate: true,
  columnId: true,
  parentId: true,
  assigneeId: true,
  roadmapBucketId: true,
  column: { select: { id: true, name: true, isDone: true } },
} as const;

/**
 * Get timeline data across ALL projects in a team.
 * Returns issues grouped by project, plus cross-project dependency links.
 * @param teamId
 * @param filters
 */
export async function getTeamTimelineData(
  teamId: string,
  filters: z.output<typeof teamTimelineQuerySchema>,
) {
  const projectIds = filters.projectId
    ? filters.projectId.split(',').map((id) => id.trim())
    : (
        await prisma.project.findMany({
          where: { teamId },
          select: { id: true },
        })
      ).map((p) => p.id);

  const where: Record<string, unknown> = {
    projectId: { in: projectIds },
    OR: [{ dueDate: { not: null } }, { startDate: { not: null } }],
    parentId: null,
  };

  if (filters.startDate || filters.endDate) {
    where['dueDate'] = {
      ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
      ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
    };
  }

  if (filters.assigneeId) where['assigneeId'] = filters.assigneeId;
  if (filters.type) where['type'] = filters.type;
  if (filters.search) {
    where['title'] = { contains: filters.search, mode: 'insensitive' };
  }

  const issues = await prisma.issue.findMany({
    where,
    select: {
      ...ISSUE_SELECT,
      children: {
        where: { OR: [{ dueDate: { not: null } }, { startDate: { not: null } }] },
        select: CHILDREN_SELECT,
      },
    },
    orderBy: [{ projectId: 'asc' }, { dueDate: 'asc' }],
  });

  const allIds = new Set<string>();
  for (const issue of issues) {
    allIds.add(issue.id);
    for (const child of issue.children) {
      allIds.add(child.id);
    }
  }

  const links =
    allIds.size > 0
      ? await prisma.issueLink.findMany({
          where: {
            type: 'BLOCKS',
            OR: [{ fromId: { in: Array.from(allIds) } }, { toId: { in: Array.from(allIds) } }],
          },
          select: { id: true, fromId: true, toId: true, type: true },
        })
      : [];

  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, name: true, prefix: true, slug: true },
    orderBy: { name: 'asc' },
  });

  return { issues, links, projects };
}
