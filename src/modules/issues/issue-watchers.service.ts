import { prisma } from '../../config/database';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';
import { toggleAssociation } from '../../utils/toggle-association';
import { assertPersonTarget } from '../service-accounts/person';

/**
 * Toggle watch status for a user on an issue.
 * If the user is watching, remove; if not, add.
 * @param projectId
 * @param issueNumber
 * @param userId
 */
export async function toggleWatch(projectId: string, issueNumber: number, userId: string) {
  // Only people watch: a watcher is notified, and bots never are
  await assertPersonTarget(
    userId,
    'SERVICE_ACCOUNT_NOT_WATCHER',
    'A service account cannot watch an issue',
  );
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  const watching = await toggleAssociation(
    prisma.issueWatcher as never,
    { issueId_userId: { issueId: issue.id, userId } },
    { issueId: issue.id, userId },
  );
  return { watching };
}

/**
 * Get all watchers for an issue.
 * @param projectId
 * @param issueNumber
 */
export async function getWatchers(projectId: string, issueNumber: number) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { projectId_number: { projectId, number: issueNumber } },
    }),
    ERR.ISSUE_NOT_FOUND,
  );

  return prisma.issueWatcher.findMany({
    where: { issueId: issue.id },
    include: {
      user: { select: USER_WITH_AVATAR_SELECT },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Check if a user is watching an issue.
 * @param projectId
 * @param issueNumber
 * @param userId
 */
export async function isWatching(projectId: string, issueNumber: number, userId: string) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) return false;

  const watcher = await prisma.issueWatcher.findUnique({
    where: { issueId_userId: { issueId: issue.id, userId } },
  });
  return !!watcher;
}
