import { prisma } from '../config/database';
import { repoExists } from '../git/repo-manager';
import { AppError } from '../middleware/errorHandler';

import { findOrThrow } from './find-or-throw';

/**
 * Resolve a repository's disk path, throwing 404 if not found or missing on disk.
 * @param repoId
 */
export async function getRepoDiskPath(repoId: string): Promise<string> {
  const repo = await findOrThrow(
    prisma.repository.findUnique({ where: { id: repoId } }),
    'Repository not found',
  );
  if (!repo.diskPath) throw new AppError(404, 'Repository not found');
  if (!(await repoExists(repo.diskPath))) throw new AppError(404, 'Repository not found on disk');
  return repo.diskPath;
}

/**
 * Resolve a repository's disk path and default branch.
 * @param repoId
 */
export async function getRepoDisk(
  repoId: string,
): Promise<{ diskPath: string; defaultBranch: string }> {
  const repo = await findOrThrow(
    prisma.repository.findUnique({ where: { id: repoId } }),
    'Repository not found',
  );
  if (!repo.diskPath) throw new AppError(404, 'Repository not found');
  if (!(await repoExists(repo.diskPath))) throw new AppError(404, 'Repository not found on disk');
  return { diskPath: repo.diskPath, defaultBranch: repo.defaultBranch };
}
