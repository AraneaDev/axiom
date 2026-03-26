import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';

/**
 * Create or update a commit status check.
 * @param repoId
 * @param sha
 * @param data
 * @param data.context
 * @param data.state
 * @param data.targetUrl
 * @param data.description
 */
export async function createOrUpdateStatus(
  repoId: string,
  sha: string,
  data: {
    context: string;
    state: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'ERROR';
    targetUrl?: string;
    description?: string;
  },
) {
  await findOrThrow(
    prisma.repository.findUnique({ where: { id: repoId } }),
    'Repository not found',
  );

  return prisma.commitStatus.upsert({
    where: {
      repoId_sha_context: { repoId, sha, context: data.context },
    },
    create: {
      repoId,
      sha,
      context: data.context,
      state: data.state,
      targetUrl: data.targetUrl,
      description: data.description,
    },
    update: {
      state: data.state,
      targetUrl: data.targetUrl,
      description: data.description,
    },
  });
}

/**
 * List all status checks for a commit.
 * @param repoId
 * @param sha
 */
export async function getStatusesForCommit(repoId: string, sha: string) {
  return prisma.commitStatus.findMany({
    where: { repoId, sha },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get statuses for a PR's head commit (source branch tip).
 * @param repoId
 * @param prNumber
 */
export async function getStatusesForPR(repoId: string, prNumber: number) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );

  // Resolve head SHA from source branch
  const { repoExists } = await import('../../git/repo-manager');
  const { resolveRef } = await import('../../git/git-commands');
  const repo = await findOrThrow(
    prisma.repository.findUnique({ where: { id: repoId } }),
    'Repository not found',
  );
  if (!repo.diskPath) throw new AppError(404, 'Repository not found');
  if (!(await repoExists(repo.diskPath))) throw new AppError(404, 'Repository not on disk');

  let headSha: string;
  try {
    headSha = await resolveRef(repo.diskPath, `refs/heads/${pr.sourceBranch}`);
  } catch {
    throw new AppError(404, 'Source branch not found');
  }

  const statuses = await prisma.commitStatus.findMany({
    where: { repoId, sha: headSha },
    orderBy: { createdAt: 'desc' },
  });

  return { sha: headSha, statuses, combined: computeCombinedState(statuses) };
}

/**
 * Compute the combined status for a commit.
 * @param repoId
 * @param sha
 */
export async function getCombinedStatus(repoId: string, sha: string) {
  const statuses = await prisma.commitStatus.findMany({
    where: { repoId, sha },
  });

  return {
    sha,
    state: computeCombinedState(statuses),
    statuses,
    total: statuses.length,
  };
}

function computeCombinedState(
  statuses: { state: string }[],
): 'success' | 'failure' | 'pending' | 'none' {
  if (statuses.length === 0) return 'none';

  const hasFailure = statuses.some((s) => s.state === 'FAILURE' || s.state === 'ERROR');
  if (hasFailure) return 'failure';

  const hasPending = statuses.some((s) => s.state === 'PENDING');
  if (hasPending) return 'pending';

  const allSuccess = statuses.every((s) => s.state === 'SUCCESS');
  if (allSuccess) return 'success';

  return 'pending';
}
