import { prisma } from '../../config/database';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { toggleAssociation } from '../../utils/toggle-association';

/**
 * Toggle a vote on an issue: adds if not present, removes if already voted.
 * @param projectId
 * @param issueNumber
 * @param userId
 */
export async function toggleVote(projectId: string, issueNumber: number, userId: string) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  const voted = await toggleAssociation(
    prisma.issueVote as never,
    { issueId_userId: { issueId: issue.id, userId } },
    { issueId: issue.id, userId },
  );
  return { voted };
}

/**
 * Get vote count and whether the current user has voted.
 * @param projectId
 * @param issueNumber
 * @param userId
 */
export async function getVotes(projectId: string, issueNumber: number, userId: string) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  const count = await prisma.issueVote.count({ where: { issueId: issue.id } });
  const userVote = await prisma.issueVote.findUnique({
    where: { issueId_userId: { issueId: issue.id, userId } },
  });

  return { count, voted: !!userVote };
}
