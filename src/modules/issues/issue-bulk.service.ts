import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { cacheInvalidate } from '../../config/redis';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

/**
 * Bulk update multiple issues at once with shared field values.
 * @param projectId - The project the issues belong to
 * @param issueIds - Array of issue IDs to update
 * @param updates - Fields to update across all issues (status, assignee, priority, sprint, labels)
 * @param updates.status
 * @param updates.assigneeId
 * @param updates.priority
 * @param updates.sprintId
 * @param updates.labels
 * @param userId - The user performing the bulk update
 * @returns Object with count of updated issues and the updated issue records
 * @throws {AppError} 404 if project not found or no matching issues
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
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), 'Project not found');

  const issues = await prisma.issue.findMany({
    where: { id: { in: issueIds }, projectId },
    select: { id: true },
  });
  if (issues.length === 0) throw new AppError(404, 'No matching issues found');

  const resolvedIds = issues.map((i) => i.id);
  const changedFields = Object.keys(updates).filter(
    (k) => updates[k as keyof typeof updates] !== undefined,
  );

  // Build scalar update payload for updateMany (no relation syntax needed -- use raw FK columns)
  const scalarData: Prisma.IssueUpdateManyMutationInput = {};
  if (updates.priority !== undefined) {
    scalarData.priority = updates.priority;
  }
  if (updates.status !== undefined) {
    // columnId is the raw FK for the column relation
    (scalarData as Record<string, unknown>).columnId = updates.status;
  }
  if (updates.assigneeId !== undefined) {
    (scalarData as Record<string, unknown>).assigneeId = updates.assigneeId ?? null;
  }
  if (updates.sprintId !== undefined) {
    (scalarData as Record<string, unknown>).sprintId = updates.sprintId ?? null;
  }

  const hasScalarUpdates = Object.keys(scalarData).length > 0;
  const hasLabelUpdates = updates.labels !== undefined;

  await prisma.$transaction(async (tx) => {
    // Single updateMany for all scalar/FK fields -- one DB round trip regardless of issue count
    if (hasScalarUpdates) {
      await tx.issue.updateMany({
        where: { id: { in: resolvedIds } },
        data: scalarData,
      });
    }

    // Labels require connectOrCreate so must be handled per-issue, but batched in the transaction
    if (hasLabelUpdates) {
      await Promise.all(
        resolvedIds.map((id) =>
          tx.issue.update({
            where: { id },
            data: {
              labels: {
                set: [],
                connectOrCreate: (updates.labels as string[]).map((name) => ({
                  where: { projectId_name: { projectId, name } },
                  create: { projectId, name },
                })),
              },
            },
          }),
        ),
      );
    }

    // Batch activity log -- single createMany instead of N individual creates
    await tx.activity.createMany({
      data: resolvedIds.map((id) => ({
        resourceType: 'issue' as const,
        resourceId: id,
        action: 'bulk_updated',
        userId,
        details: { fields: changedFields } as Prisma.InputJsonValue,
      })),
    });
  });

  // Fetch updated records for the response
  const results = await prisma.issue.findMany({
    where: { id: { in: resolvedIds } },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      labels: true,
      column: true,
    },
  });

  await cacheInvalidate(`issues:${projectId}:*`, `board:${projectId}`);
  return { updated: results.length, issues: results };
}
