import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { attributionFields } from '../../lib/request-context';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { invalidateIssueCache } from '../../utils/issue-cache';
import { ISSUE_WITH_COLUMN_INCLUDE } from '../../utils/prisma-selects';
import { emitIssueEvents } from '../bot-events/emit';

import {
  assertAssignable,
  assertColumnTransition,
  assertIssueRefsInProject,
} from './issue-references';

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
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

  const issues = await prisma.issue.findMany({
    where: { id: { in: issueIds }, projectId },
    select: {
      id: true,
      columnId: true,
      assigneeId: true,
      priority: true,
      sprintId: true,
      labels: { select: { name: true } },
    },
  });
  if (issues.length === 0) throw new AppError(404, 'No matching issues found');

  await assertIssueRefsInProject(projectId, {
    columnId: updates.status,
    sprintId: updates.sprintId,
  });
  await assertAssignable(projectId, updates.assigneeId);
  // A bulk status change follows the same workflow rules and approval gates as one issue
  if (updates.status !== undefined) {
    for (const issue of issues) {
      await assertColumnTransition(projectId, issue.columnId, updates.status);
    }
  }

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
        ...attributionFields(),
        details: { fields: changedFields } as Prisma.InputJsonValue,
      })),
    });
  });

  // Fetch updated records for the response
  const results = await prisma.issue.findMany({
    where: { id: { in: resolvedIds } },
    include: ISSUE_WITH_COLUMN_INCLUDE,
  });

  await invalidateIssueCache(projectId);

  // One bot event check per issue, each with what changed on that issue
  for (const before of issues) {
    const fields: string[] = [];
    if (updates.priority !== undefined && updates.priority !== before.priority) {
      fields.push('priority');
    }
    if (updates.sprintId !== undefined && (updates.sprintId ?? null) !== before.sprintId) {
      fields.push('sprint');
    }
    if (updates.labels !== undefined) {
      const prev = [...new Set(before.labels.map((l) => l.name))].sort().join('\n');
      if (prev !== [...new Set(updates.labels)].sort().join('\n')) fields.push('labels');
    }
    const assigneeTo = updates.assigneeId === undefined ? undefined : (updates.assigneeId ?? null);
    await emitIssueEvents({
      issueId: before.id,
      actorId: userId,
      assignee:
        assigneeTo !== undefined && assigneeTo !== before.assigneeId
          ? { from: before.assigneeId, to: assigneeTo }
          : undefined,
      status:
        updates.status !== undefined && updates.status !== before.columnId
          ? { fromColumnId: before.columnId, toColumnId: updates.status }
          : undefined,
      changedFields: fields.sort(),
    });
  }

  return { updated: results.length, issues: results };
}
