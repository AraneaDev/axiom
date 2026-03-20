import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/**
 * Find an issue by project ID and issue number, or throw 404.
 * Shared helper used by sub-services to eliminate duplicate lookups.
 * @param projectId - The project the issue belongs to
 * @param issueNumber - The issue number within the project
 * @returns The issue record
 * @throws {AppError} 404 if issue not found
 */
export async function findIssueOrThrow(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');
  return issue;
}
