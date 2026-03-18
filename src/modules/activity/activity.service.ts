import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';

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
 * Log an activity event.
 * @param resourceType
 * @param resourceId
 * @param action
 * @param userId
 * @param details - Flexible JSON payload for activity metadata. Kept as Record<string, unknown>
 *   because each action type stores a different shape (e.g., { title } for created, { from, to }
 *   for status_changed, { minutes, description } for time_logged). Serialized to Prisma JSON column.
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
 * List activities with filters.
 * @param opts
 * @param opts.resourceType
 * @param opts.resourceId
 * @param opts.projectId
 * @param opts.userId
 * @param opts.limit
 * @param opts.offset
 */
export async function listActivities(opts: {
  resourceType?: ResourceType;
  resourceId?: string;
  projectId?: string;
  userId?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Prisma.ActivityWhereInput = {};

  if (opts.resourceType) where.resourceType = opts.resourceType;
  if (opts.resourceId) where.resourceId = opts.resourceId;
  if (opts.userId) where.userId = opts.userId;

  // If projectId is provided, find all issue IDs in that project and filter
  if (opts.projectId) {
    const issues = await prisma.issue.findMany({
      where: { projectId: opts.projectId },
      select: { id: true },
    });
    const issueIds = issues.map((i) => i.id);

    // Include activities for the project's issues
    where.OR = [
      { resourceType: 'issue', resourceId: { in: issueIds } },
      // Also include any activities directly tied to a projectId in details
    ];
  }

  const [activities, total] = await Promise.all([
    prisma.activity.findMany({
      where,
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: opts.limit ?? 50,
      skip: opts.offset ?? 0,
    }),
    prisma.activity.count({ where }),
  ]);

  return { activities, total };
}
