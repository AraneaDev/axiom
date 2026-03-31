import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { parseServicePagination } from '../../utils/pagination';
import { USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';

export type ResourceType = 'issue' | 'pull_request' | 'wiki_page' | 'repository';

export type ActivityAction =
  | 'created'
  | 'updated'
  | 'status_changed'
  | 'assigned'
  | 'unassigned'
  | 'commented'
  | 'merged'
  | 'closed'
  | 'labeled'
  | 'unlabeled'
  | 'priority_changed'
  | 'type_changed'
  | 'review_submitted'
  | 'deleted';

/**
 * Log an activity event. Non-critical -- silently catches errors to avoid breaking the main flow.
 * @param resourceType - The type of resource (issue, pull_request, wiki_page, repository)
 * @param resourceId - The ID of the resource
 * @param action - The action performed (created, updated, status_changed, etc.)
 * @param userId - The user who performed the action
 * @param details - Flexible JSON payload for activity metadata, shape varies by action type
 */
export async function logActivity(
  resourceType: ResourceType,
  resourceId: string,
  action: string,
  userId: string,
  details?: Record<string, unknown>,
) {
  try {
    await prisma.activity.create({
      data: {
        resourceType,
        resourceId,
        action,
        userId,
        details: details ? (details as Prisma.InputJsonValue) : Prisma.JsonNull,
      },
    });
  } catch {
    // Activity logging is non-critical -- never break the main flow
  }
}

/**
 * Resolve an issue ID from project and issue number, used by controllers before querying activities.
 * @param projectId - The project ID
 * @param issueNumber - The issue number within the project
 * @returns The issue ID or null if not found
 */
export async function getIssueIdByNumber(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
    select: { id: true },
  });
  return issue?.id ?? null;
}

/**
 * List activity events with optional filters by resource, project, user, and pagination.
 * @param opts - Filter options including resourceType, resourceId, projectId, userId, limit, and offset
 * @param opts.resourceType
 * @param opts.resourceId
 * @param opts.projectId
 * @param opts.userId
 * @param opts.limit
 * @param opts.offset
 * @returns Paginated list of activities with user details and total count
 */
export async function listActivities(opts: {
  resourceType?: ResourceType;
  resourceId?: string;
  projectId?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}) {
  const { take, skip } = parseServicePagination(opts, 50);
  const where: Prisma.ActivityWhereInput = {};

  if (opts.resourceType) where.resourceType = opts.resourceType;
  if (opts.resourceId) where.resourceId = opts.resourceId;
  if (opts.userId) where.userId = opts.userId;

  // If projectId is provided, use a raw SQL EXISTS subquery so Postgres handles
  // the join efficiently instead of fetching all issue IDs into application memory
  if (opts.projectId) {
    where.resourceType = 'issue';

    // Fetch matching activity IDs via a single SQL query with an EXISTS subquery.
    // Postgres uses the issues.projectId index to efficiently filter without
    // materializing all issue IDs in a huge IN clause.
    const matchingIds: { id: string }[] = await prisma.$queryRaw`
      SELECT a.id FROM activities a
      WHERE a."resourceType" = 'issue'
        AND EXISTS (
          SELECT 1 FROM issues i
          WHERE i.id = a."resourceId"
            AND i."projectId" = ${opts.projectId}
        )
      ORDER BY a."createdAt" DESC
      LIMIT ${take} OFFSET ${skip}
    `;

    if (matchingIds.length === 0) {
      return { activities: [], total: 0 };
    }

    const countResult: { count: bigint }[] = await prisma.$queryRaw`
      SELECT COUNT(*)::bigint as count FROM activities a
      WHERE a."resourceType" = 'issue'
        AND EXISTS (
          SELECT 1 FROM issues i
          WHERE i.id = a."resourceId"
            AND i."projectId" = ${opts.projectId}
        )
    `;
    const total = Number(countResult[0]?.count ?? 0);

    const activities = await prisma.activity.findMany({
      where: { id: { in: matchingIds.map((r) => r.id) } },
      include: {
        user: { select: USER_WITH_AVATAR_SELECT },
      },
      orderBy: { createdAt: 'desc' },
    });

    return { activities, total };
  }

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      include: {
        user: { select: USER_WITH_AVATAR_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.activity.count({ where }),
  ]);

  return { activities, total };
}
