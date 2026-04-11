import type { z } from 'zod';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';

import type {
  createBucketSchema,
  updateBucketSchema,
  timelineQuerySchema,
  bucketsViewQuerySchema,
} from './roadmap.validation';

// ─── Shared selects ───────────────────────────────────────────────────────────

const ISSUE_ROADMAP_SELECT = {
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

// ─── Bucket CRUD ─────────────────────────────────────────────────────────────

/**
 * List all roadmap buckets for a project, ordered by position.
 * @param projectId
 */
export async function listBuckets(projectId: string) {
  return prisma.roadmapBucket.findMany({
    where: { projectId },
    include: { _count: { select: { issues: true } } },
    orderBy: { position: 'asc' },
  });
}

/**
 * Create a new roadmap bucket. Auto-assigns position if not provided.
 * @param projectId
 * @param data
 */
export async function createBucket(projectId: string, data: z.output<typeof createBucketSchema>) {
  let position = data.position;
  if (position === undefined) {
    const last = await prisma.roadmapBucket.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    position = last ? last.position + 1 : 0;
  }

  return prisma.roadmapBucket.create({
    data: { projectId, name: data.name, color: data.color, position },
    include: { _count: { select: { issues: true } } },
  });
}

/**
 * Update a roadmap bucket.
 * @param projectId
 * @param bucketId
 * @param data
 * @throws {AppError} 404 if not found in project
 */
export async function updateBucket(
  projectId: string,
  bucketId: string,
  data: z.output<typeof updateBucketSchema>,
) {
  await findOrThrow(
    prisma.roadmapBucket.findUnique({ where: { id: bucketId, projectId } }),
    'Roadmap bucket not found',
  );

  return prisma.roadmapBucket.update({
    where: { id: bucketId },
    data,
    include: { _count: { select: { issues: true } } },
  });
}

/**
 * Delete a roadmap bucket. Unsets roadmapBucketId on associated issues first.
 * @param projectId
 * @param bucketId
 * @throws {AppError} 404 if not found in project
 */
export async function deleteBucket(projectId: string, bucketId: string) {
  await findOrThrow(
    prisma.roadmapBucket.findUnique({ where: { id: bucketId, projectId } }),
    'Roadmap bucket not found',
  );

  await prisma.issue.updateMany({
    where: { roadmapBucketId: bucketId },
    data: { roadmapBucketId: null },
  });

  await prisma.roadmapBucket.delete({ where: { id: bucketId } });
}

/**
 * Reorder buckets by providing an ordered array of bucket IDs.
 * @param projectId
 * @param bucketIds
 * @throws {AppError} 400 if IDs don't match project buckets
 */
export async function reorderBuckets(projectId: string, bucketIds: string[]) {
  const existing = await prisma.roadmapBucket.findMany({
    where: { projectId },
    select: { id: true },
  });

  const existingIds = new Set(existing.map((b) => b.id));
  for (const id of bucketIds) {
    if (!existingIds.has(id)) {
      throw new AppError(400, `Bucket ${id} does not belong to this project`);
    }
  }

  await prisma.$transaction(
    bucketIds.map((id, index) =>
      prisma.roadmapBucket.update({
        where: { id },
        data: { position: index },
      }),
    ),
  );

  return listBuckets(projectId);
}

/**
 * Create default Now / Next / Later buckets if none exist for the project.
 * @param projectId
 */
export async function createDefaultBuckets(projectId: string) {
  const count = await prisma.roadmapBucket.count({ where: { projectId } });
  if (count > 0) {
    return listBuckets(projectId);
  }

  const defaults = [
    { name: 'Now', color: 'var(--color-success)', position: 0 },
    { name: 'Next', color: 'var(--color-warning)', position: 1 },
    { name: 'Later', color: 'var(--color-text-tertiary)', position: 2 },
  ];

  await prisma.roadmapBucket.createMany({
    data: defaults.map((d) => ({ ...d, projectId })),
  });

  return listBuckets(projectId);
}

// ─── Timeline data ────────────────────────────────────────────────────────────

/**
 * Get timeline data: top-level issues with dueDate, their dated children,
 * and BLOCKS links between all visible issues.
 * @param projectId
 * @param filters
 */
export async function getTimelineData(
  projectId: string,
  filters: z.output<typeof timelineQuerySchema>,
) {
  const where: Record<string, unknown> = {
    projectId,
    dueDate: { not: null },
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
  if (filters.milestoneId) where['milestoneId'] = filters.milestoneId;
  if (filters.sprintId) where['sprintId'] = filters.sprintId;
  if (filters.labelId) {
    where['labels'] = { some: { id: filters.labelId } };
  }
  if (filters.search) {
    where['title'] = { contains: filters.search, mode: 'insensitive' };
  }

  const issues = await prisma.issue.findMany({
    where,
    select: {
      ...ISSUE_ROADMAP_SELECT,
      children: {
        where: { dueDate: { not: null } },
        select: CHILDREN_SELECT,
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  // Collect all visible issue IDs (parents + children)
  const allIds = new Set<string>();
  for (const issue of issues) {
    allIds.add(issue.id);
    for (const child of issue.children) {
      allIds.add(child.id);
    }
  }

  const links = await prisma.issueLink.findMany({
    where: {
      type: 'BLOCKS',
      fromId: { in: Array.from(allIds) },
    },
    select: { id: true, fromId: true, toId: true, type: true },
  });

  return { issues, links };
}

// ─── Buckets view data ────────────────────────────────────────────────────────

/**
 * Get buckets view: issues grouped by bucket, plus unassigned issues
 * that have a startDate or dueDate.
 * @param projectId
 * @param filters
 */
export async function getBucketsViewData(
  projectId: string,
  filters: z.output<typeof bucketsViewQuerySchema>,
) {
  const buckets = await listBuckets(projectId);

  const baseWhere: Record<string, unknown> = {
    projectId,
    parentId: null,
  };

  if (filters.assigneeId) baseWhere['assigneeId'] = filters.assigneeId;
  if (filters.type) baseWhere['type'] = filters.type;
  if (filters.milestoneId) baseWhere['milestoneId'] = filters.milestoneId;
  if (filters.sprintId) baseWhere['sprintId'] = filters.sprintId;
  if (filters.labelId) {
    baseWhere['labels'] = { some: { id: filters.labelId } };
  }
  if (filters.search) {
    baseWhere['title'] = { contains: filters.search, mode: 'insensitive' };
  }

  // Bucketed issues
  const bucketedIssues = await prisma.issue.findMany({
    where: { ...baseWhere, roadmapBucketId: { not: null } },
    select: ISSUE_ROADMAP_SELECT,
    orderBy: { updatedAt: 'desc' },
  });

  // Unassigned issues: no bucket but has a date
  const unassigned = await prisma.issue.findMany({
    where: {
      ...baseWhere,
      roadmapBucketId: null,
      OR: [{ startDate: { not: null } }, { dueDate: { not: null } }],
    },
    select: ISSUE_ROADMAP_SELECT,
    orderBy: { updatedAt: 'desc' },
  });

  // Group bucketed issues by bucket
  const bucketMap = new Map<string, typeof bucketedIssues>();
  for (const issue of bucketedIssues) {
    const bid = issue.roadmapBucketId!;
    if (!bucketMap.has(bid)) bucketMap.set(bid, []);
    bucketMap.get(bid)!.push(issue);
  }

  const bucketsWithIssues = buckets.map((bucket) => ({
    ...bucket,
    issues: bucketMap.get(bucket.id) ?? [],
  }));

  return { buckets: bucketsWithIssues, unassigned };
}
