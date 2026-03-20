import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { cacheInvalidate } from '../../config/redis';
import { AppError } from '../../middleware/errorHandler';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';

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

  await cacheInvalidate(`issues:${projectId}:*`, `board:${projectId}`);
  return { updated: results.length, issues: results };
}
