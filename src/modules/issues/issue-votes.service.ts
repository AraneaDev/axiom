import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/**
 * Toggle a vote on an issue: adds if not present, removes if already voted.
 * @param projectId
 * @param issueNumber
 * @param userId
 */
export async function toggleVote(projectId: string, issueNumber: number, userId: string) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  const existing = await prisma.issueVote.findUnique({
    where: { issueId_userId: { issueId: issue.id, userId } },
  });

  if (existing) {
    await prisma.issueVote.delete({ where: { id: existing.id } });
    return { voted: false };
  }

  await prisma.issueVote.create({
    data: { issueId: issue.id, userId },
  });
  return { voted: true };
}

/**
 * Get vote count and whether the current user has voted.
 * @param projectId
 * @param issueNumber
 * @param userId
 */
export async function getVotes(projectId: string, issueNumber: number, userId: string) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw new AppError(404, 'Issue not found');

  const count = await prisma.issueVote.count({ where: { issueId: issue.id } });
  const userVote = await prisma.issueVote.findUnique({
    where: { issueId_userId: { issueId: issue.id, userId } },
  });

  return { count, voted: !!userVote };
}
