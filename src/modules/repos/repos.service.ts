import { prisma } from '../../config/database';
import { cacheable } from '../../config/redis';
import * as gitCmd from '../../git/git-commands';
import {
  initBareRepo,
  deleteRepo,
  forkRepo,
  getRepoPath,
  repoExists,
  getRepoSize,
} from '../../git/repo-manager';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';

/**
 * Validate a file path to prevent directory traversal and null byte injection.
 * @param filePath - The file path to validate
 * @throws {AppError} 400 if the path is invalid
 */
function validateFilePath(filePath: string): void {
  if (
    !filePath ||
    filePath.startsWith('/') ||
    filePath.includes('\0') ||
    filePath.split('/').some((seg) => seg === '..')
  ) {
    throw new AppError(400, 'Invalid file path');
  }
}

/**
 * Create a new git repository with a bare repo on disk.
 * @param teamId - The team to create the repository in
 * @param data - Repository creation data including name, slug, description, visibility, and default branch
 * @param data.name
 * @param data.slug
 * @param data.description
 * @param data.visibility
 * @param data.defaultBranch
 * @returns The created repository record
 * @throws {AppError} 409 if repository slug already taken
 * @throws {AppError} 404 if team not found
 */
export async function createRepo(
  teamId: string,
  data: {
    name: string;
    slug: string;
    description?: string;
    visibility?: 'PRIVATE' | 'INTERNAL' | 'PUBLIC';
    defaultBranch?: string;
  },
) {
  const team = await findOrThrow(
    prisma.team.findUnique({
      where: { id: teamId },
      include: { org: { select: { slug: true } } },
    }),
    'Team not found',
  );

  const existing = await prisma.repository.findUnique({
    where: { teamId_slug: { teamId, slug: data.slug } },
  });
  if (existing) throw new AppError(409, 'Repository slug already taken');

  const defaultBranch = data.defaultBranch ?? 'main';
  const diskPath = getRepoPath(team.org.slug, team.slug, data.slug);

  await initBareRepo(diskPath, defaultBranch);

  return prisma.repository.create({
    data: {
      teamId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      visibility: data.visibility ?? 'PRIVATE',
      defaultBranch,
      diskPath,
    },
  });
}

/**
 * Retrieve a repository by ID, including team relation and on-disk size.
 * @param repoId - The repository ID
 * @returns The repository with team details and optional size in bytes
 * @throws {AppError} 404 if repository not found
 */
export async function getRepo(repoId: string) {
  const repo = await findOrThrow(
    prisma.repository.findUnique({
      where: { id: repoId },
      include: {
        team: { select: { id: true, name: true, slug: true, orgId: true } },
      },
    }),
    'Repository not found',
  );

  let size: number | undefined;
  if (repo.diskPath && (await repoExists(repo.diskPath))) {
    try {
      size = await getRepoSize(repo.diskPath);
    } catch (err) {
      logger.error('Failed to get repository size', { repoId }, err as Error);
    }
  }

  return { ...repo, size };
}

/**
 * List repositories for a team with pagination.
 * @param teamId - The team to list repositories for
 * @param opts - Pagination options (limit, offset)
 * @param opts.limit
 * @param opts.offset
 * @returns Paginated list of repositories with total count
 */
export async function listRepos(teamId: string, opts?: { limit?: number; offset?: number }) {
  const limit = Math.min(opts?.limit ?? 25, 100);
  const offset = opts?.offset ?? 0;

  const [repos, total] = await Promise.all([
    prisma.repository.findMany({
      where: { teamId },
      orderBy: { name: 'asc' },
      take: limit,
      skip: offset,
    }),
    prisma.repository.count({ where: { teamId } }),
  ]);

  return { data: repos, total, limit, offset };
}

/**
 * Update repository metadata (name, description, visibility, default branch).
 * @param repoId - The repository ID
 * @param data - Partial update data for the repository
 * @param data.name
 * @param data.description
 * @param data.visibility
 * @param data.defaultBranch
 * @returns The updated repository record
 */
export async function updateRepo(
  repoId: string,
  data: {
    name?: string;
    description?: string;
    visibility?: 'PRIVATE' | 'INTERNAL' | 'PUBLIC';
    defaultBranch?: string;
  },
) {
  return prisma.repository.update({ where: { id: repoId }, data });
}

/**
 * Update repository settings like default merge strategy and code owners toggle.
 * @param repoId - The repository ID
 * @param data - Settings to update (defaultMergeStrategy, codeOwnersEnabled)
 * @param data.defaultMergeStrategy
 * @param data.codeOwnersEnabled
 * @returns The updated repository record
 * @throws {AppError} 404 if repository not found
 * @throws {AppError} 400 if merge strategy is invalid
 */
export async function updateRepoSettings(
  repoId: string,
  data: {
    defaultMergeStrategy?: string;
    codeOwnersEnabled?: boolean;
  },
) {
  await findOrThrow(
    prisma.repository.findUnique({ where: { id: repoId } }),
    'Repository not found',
  );

  const updateData: Record<string, unknown> = {};
  if (data.defaultMergeStrategy !== undefined) {
    const valid = ['MERGE', 'SQUASH', 'REBASE'];
    if (!valid.includes(data.defaultMergeStrategy)) {
      throw new AppError(400, `Invalid merge strategy. Must be one of: ${valid.join(', ')}`);
    }
    updateData.defaultMergeStrategy = data.defaultMergeStrategy;
  }
  if (data.codeOwnersEnabled !== undefined) {
    updateData.codeOwnersEnabled = data.codeOwnersEnabled;
  }

  return prisma.repository.update({ where: { id: repoId }, data: updateData });
}

/**
 * Delete a repository, removing both the database record and the on-disk bare repo.
 * @param repoId - The repository ID
 * @throws {AppError} 404 if repository not found
 */
export async function deleteRepoById(repoId: string) {
  const repo = await findOrThrow(
    prisma.repository.findUnique({ where: { id: repoId } }),
    'Repository not found',
  );

  // Delete disk first (harder to undo), then DB inside a transaction
  if (repo.diskPath && (await repoExists(repo.diskPath))) {
    await deleteRepo(repo.diskPath);
  }

  await prisma.$transaction(async (tx) => {
    await tx.repository.delete({ where: { id: repoId } });
  });
}

/**
 * Fork a repository into another team, cloning the bare repo on disk.
 * @param repoId - The source repository ID
 * @param targetTeamId - The team to fork into
 * @param newSlug - The slug for the forked repository
 * @returns The newly created forked repository record
 * @throws {AppError} 404 if source repository or target team not found
 */
export async function forkRepoById(repoId: string, targetTeamId: string, newSlug: string) {
  const source = await findOrThrow(
    prisma.repository.findUnique({
      where: { id: repoId },
      include: { team: { include: { org: { select: { slug: true } } } } },
    }),
    'Source repository not found',
  );

  const targetTeam = await findOrThrow(
    prisma.team.findUnique({
      where: { id: targetTeamId },
      include: { org: { select: { slug: true } } },
    }),
    'Target team not found',
  );

  const targetDiskPath = getRepoPath(targetTeam.org.slug, targetTeam.slug, newSlug);

  // DB first inside transaction, then clone on disk
  const forkedRepo = await prisma.$transaction(async (tx) => {
    return tx.repository.create({
      data: {
        teamId: targetTeamId,
        name: source.name,
        slug: newSlug,
        description: `Forked from ${source.team.org.slug}/${source.team.slug}/${source.slug}`,
        visibility: source.visibility,
        defaultBranch: source.defaultBranch,
        diskPath: targetDiskPath,
      },
    });
  });

  try {
    await forkRepo(source.diskPath!, targetDiskPath);
  } catch (err) {
    // Disk clone failed -- roll back the DB record
    await prisma.repository.delete({ where: { id: forkedRepo.id } }).catch((delErr) => {
      logger.error(
        'Failed to clean up forked repo record after disk error',
        { repoId: forkedRepo.id },
        delErr as Error,
      );
    });
    throw err;
  }

  return forkedRepo;
}

// ─── Git operations (proxied through service) ───────────────

async function getRepoDiskPath(repoId: string): Promise<string> {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo || !repo.diskPath) throw new AppError(404, 'Repository not found');
  if (!(await repoExists(repo.diskPath))) throw new AppError(404, 'Repository not found on disk');
  return repo.diskPath;
}

async function getRepoWithDefault(repoId: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo || !repo.diskPath) throw new AppError(404, 'Repository not found');
  return repo;
}

/**
 * List all branches in a repository.
 * @param repoId - The repository ID
 * @returns List of branch objects with name and head info
 * @throws {AppError} 404 if repository not found
 */
export async function getBranches(repoId: string) {
  const repo = await getRepoWithDefault(repoId);
  return gitCmd.listBranches(repo.diskPath!, repo.defaultBranch);
}

/**
 * Get detailed information about a specific branch including latest commit and commit count.
 * @param repoId - The repository ID
 * @param branchName - The branch name to inspect
 * @returns Branch details with name, latest commit, and total commit count
 * @throws {AppError} 404 if repository or branch not found
 */
export async function getBranchDetail(repoId: string, branchName: string) {
  const diskPath = await getRepoDiskPath(repoId);
  const exists = await gitCmd.branchExists(diskPath, branchName);
  if (!exists) throw new AppError(404, 'Branch not found');
  const commits = await gitCmd.log(diskPath, branchName, 1);
  const count = await gitCmd.commitCount(diskPath, branchName);
  return { name: branchName, latestCommit: commits[0] ?? null, commitCount: count };
}

/**
 * Create a new branch in a repository from a given start point.
 * @param repoId - The repository ID
 * @param name - The new branch name
 * @param startPoint - The ref to branch from (commit SHA or branch name)
 * @returns Object with the branch name and start point
 * @throws {AppError} 404 if repository not found
 */
export async function createRepoBranch(repoId: string, name: string, startPoint: string) {
  const diskPath = await getRepoDiskPath(repoId);
  await gitCmd.createBranch(diskPath, name, startPoint);
  return { name, startPoint };
}

/**
 * Delete a branch from a repository (cannot delete the default branch).
 * @param repoId - The repository ID
 * @param name - The branch name to delete
 * @throws {AppError} 404 if repository not found
 * @throws {AppError} 400 if attempting to delete the default branch
 */
export async function deleteRepoBranch(repoId: string, name: string) {
  const repo = await getRepoWithDefault(repoId);
  if (name === repo.defaultBranch) throw new AppError(400, 'Cannot delete default branch');
  await gitCmd.deleteBranch(repo.diskPath!, name);
}

/**
 * Get commit history for a repository ref, optionally filtered by file path.
 * @param repoId - The repository ID
 * @param ref - The git ref to list commits from (defaults to HEAD)
 * @param limit - Maximum number of commits to return (defaults to 20)
 * @param skip - Number of commits to skip for pagination (defaults to 0)
 * @param filePath - Optional file path to filter commits by
 * @returns List of commit objects
 * @throws {AppError} 404 if repository not found
 */
export async function getCommits(
  repoId: string,
  ref: string = 'HEAD',
  limit: number = 20,
  skip: number = 0,
  filePath?: string,
) {
  const diskPath = await getRepoDiskPath(repoId);
  return gitCmd.log(diskPath, ref, limit, skip, filePath);
}

/**
 * Get detailed commit information including diff output and file stats.
 * @param repoId - The repository ID
 * @param sha - The commit SHA to inspect
 * @returns Commit details with diff and per-file stats
 * @throws {AppError} 404 if repository or commit not found
 */
export async function getCommitDetail(repoId: string, sha: string) {
  const diskPath = await getRepoDiskPath(repoId);
  const commit = await gitCmd.getCommit(diskPath, sha);
  if (!commit) throw new AppError(404, 'Commit not found');
  const diffOutput = await gitCmd.diffCommit(diskPath, sha);
  const stats = await gitCmd.diffStat(diskPath, `${sha}~1`, sha).catch((err) => {
    logger.error('Failed to get diff stats for commit', { repoId, sha }, err as Error);
    return [];
  });
  return { ...commit, diff: diffOutput, stats };
}

/**
 * List the contents of a directory (tree) in the repository at a given ref.
 * @param repoId - The repository ID
 * @param ref - The git ref to read the tree from
 * @param treePath - The path within the repository (defaults to root)
 * @returns List of tree entries (files and directories)
 * @throws {AppError} 404 if repository not found
 */
export async function getTree(repoId: string, ref: string, treePath: string = '') {
  if (treePath) validateFilePath(treePath);
  return cacheable(`repo:${repoId}:tree:${ref}:${treePath}`, 120, async () => {
    const diskPath = await getRepoDiskPath(repoId);
    return gitCmd.lsTree(diskPath, ref, treePath);
  });
}

/**
 * Get the content and size of a file (blob) at a given ref.
 * @param repoId - The repository ID
 * @param ref - The git ref to read the file from
 * @param filePath - The file path within the repository
 * @returns Object with file content, size, and path
 * @throws {AppError} 404 if repository not found
 */
export async function getBlob(repoId: string, ref: string, filePath: string) {
  validateFilePath(filePath);
  const diskPath = await getRepoDiskPath(repoId);
  const content = await gitCmd.showBlob(diskPath, ref, filePath);
  const size = await gitCmd.blobSize(diskPath, ref, filePath);
  return { content, size, path: filePath };
}

/**
 * Get git blame information for a file at a given ref.
 * @param repoId - The repository ID
 * @param ref - The git ref to blame from
 * @param filePath - The file path within the repository
 * @returns Blame data with per-line author and commit information
 * @throws {AppError} 404 if repository not found
 */
export async function getBlame(repoId: string, ref: string, filePath: string) {
  validateFilePath(filePath);
  const diskPath = await getRepoDiskPath(repoId);
  return gitCmd.blame(diskPath, ref, filePath);
}

/**
 * List all tags in a repository.
 * @param repoId - The repository ID
 * @returns List of tag objects
 * @throws {AppError} 404 if repository not found
 */
export async function getTags(repoId: string) {
  const diskPath = await getRepoDiskPath(repoId);
  return gitCmd.listTags(diskPath);
}
