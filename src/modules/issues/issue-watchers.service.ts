import { prisma } from '../../config/database';

/**
 * Toggle watch status for a user on an issue.
 * If the user is watching, remove; if not, add.
 * @param projectId
 * @param issueNumber
 * @param userId
 */
export async function toggleWatch(projectId: string, issueNumber: number, userId: string) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });

  const existing = await prisma.issueWatcher.findUnique({
    where: { issueId_userId: { issueId: issue.id, userId } },
  });

  if (existing) {
    await prisma.issueWatcher.delete({ where: { id: existing.id } });
    return { watching: false };
  }

  await prisma.issueWatcher.create({
    data: { issueId: issue.id, userId },
  });
  return { watching: true };
}

/**
 * Get all watchers for an issue.
 * @param projectId
 * @param issueNumber
 */
export async function getWatchers(projectId: string, issueNumber: number) {
  const issue = await prisma.issue.findUnique({
    where: { projectId_number: { projectId, number: issueNumber } },
  });
  if (!issue) throw Object.assign(new Error('Issue not found'), { status: 404 });

  return prisma.issueWatcher.findMany({
    where: { issueId: issue.id },
    include: {
      user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
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
