import { prisma } from '../../config/database';
import { ERR } from '../../utils/error-messages';
import { REPO_URL_SELECT } from '../../utils/prisma-selects';

/**
 *
 * @param projectId
 * @param issueNumber
 */
export async function getCommits(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw Object.assign(new Error(ERR.ISSUE_NOT_FOUND), { status: 404 });

  return prisma.issueCommit.findMany({
    where: { issueId: issue.id },
    include: {
      repo: { select: REPO_URL_SELECT },
    },
    orderBy: { committedAt: 'desc' },
  });
}
