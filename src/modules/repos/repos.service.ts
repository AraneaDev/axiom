import { prisma } from '../../config/database';
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

/**
 *
 * @param teamId
 * @param data
 * @param data.name
 * @param data.slug
 * @param data.description
 * @param data.visibility
 * @param data.defaultBranch
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
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { org: { select: { slug: true } } },
  });
  if (!team) throw new AppError(404, 'Team not found');

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
 *
 * @param repoId
 */
export async function getRepo(repoId: string) {
  const repo = await prisma.repository.findUnique({
    where: { id: repoId },
    include: {
      team: { select: { id: true, name: true, slug: true, orgId: true } },
    },
  });
  if (!repo) throw new AppError(404, 'Repository not found');

  let size: number | undefined;
  if (repo.diskPath && (await repoExists(repo.diskPath))) {
    try {
      size = await getRepoSize(repo.diskPath);
    } catch (err) {
      console.error('Failed to get repository size', err);
    }
  }

  return { ...repo, size };
}

/**
 *
 * @param teamId
 * @param opts
 * @param opts.limit
 * @param opts.offset
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
 *
 * @param repoId
 * @param data
 * @param data.name
 * @param data.description
 * @param data.visibility
 * @param data.defaultBranch
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
 * Update repository settings like defaultMergeStrategy and codeOwnersEnabled.
 * @param repoId
 * @param data
 * @param data.defaultMergeStrategy
 * @param data.codeOwnersEnabled
 */
export async function updateRepoSettings(
  repoId: string,
  data: {
    defaultMergeStrategy?: string;
    codeOwnersEnabled?: boolean;
  },
) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) throw new AppError(404, 'Repository not found');

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
 *
 * @param repoId
 */
export async function deleteRepoById(repoId: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) throw new AppError(404, 'Repository not found');

  if (repo.diskPath && (await repoExists(repo.diskPath))) {
    await deleteRepo(repo.diskPath);
  }

  await prisma.repository.delete({ where: { id: repoId } });
}

/**
 *
 * @param repoId
 * @param targetTeamId
 * @param newSlug
 */
export async function forkRepoById(repoId: string, targetTeamId: string, newSlug: string) {
  const source = await prisma.repository.findUnique({
    where: { id: repoId },
    include: { team: { include: { org: { select: { slug: true } } } } },
  });
  if (!source) throw new AppError(404, 'Source repository not found');

  const targetTeam = await prisma.team.findUnique({
    where: { id: targetTeamId },
    include: { org: { select: { slug: true } } },
  });
  if (!targetTeam) throw new AppError(404, 'Target team not found');

  const targetDiskPath = getRepoPath(targetTeam.org.slug, targetTeam.slug, newSlug);
  await forkRepo(source.diskPath!, targetDiskPath);

  return prisma.repository.create({
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
 *
 * @param repoId
 */
export async function getBranches(repoId: string) {
  const repo = await getRepoWithDefault(repoId);
  return gitCmd.listBranches(repo.diskPath!, repo.defaultBranch);
}

/**
 *
 * @param repoId
 * @param branchName
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
 *
 * @param repoId
 * @param name
 * @param startPoint
 */
export async function createRepoBranch(repoId: string, name: string, startPoint: string) {
  const diskPath = await getRepoDiskPath(repoId);
  await gitCmd.createBranch(diskPath, name, startPoint);
  return { name, startPoint };
}

/**
 *
 * @param repoId
 * @param name
 */
export async function deleteRepoBranch(repoId: string, name: string) {
  const repo = await getRepoWithDefault(repoId);
  if (name === repo.defaultBranch) throw new AppError(400, 'Cannot delete default branch');
  await gitCmd.deleteBranch(repo.diskPath!, name);
}

/**
 *
 * @param repoId
 * @param ref
 * @param limit
 * @param skip
 * @param filePath
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
 *
 * @param repoId
 * @param sha
 */
export async function getCommitDetail(repoId: string, sha: string) {
  const diskPath = await getRepoDiskPath(repoId);
  const commit = await gitCmd.getCommit(diskPath, sha);
  if (!commit) throw new AppError(404, 'Commit not found');
  const diffOutput = await gitCmd.diffCommit(diskPath, sha);
  const stats = await gitCmd.diffStat(diskPath, `${sha}~1`, sha).catch((err) => {
    console.error('Failed to get diff stats for commit', err);
    return [];
  });
  return { ...commit, diff: diffOutput, stats };
}

/**
 *
 * @param repoId
 * @param ref
 * @param treePath
 */
export async function getTree(repoId: string, ref: string, treePath: string = '') {
  const diskPath = await getRepoDiskPath(repoId);
  return gitCmd.lsTree(diskPath, ref, treePath);
}

/**
 *
 * @param repoId
 * @param ref
 * @param filePath
 */
export async function getBlob(repoId: string, ref: string, filePath: string) {
  const diskPath = await getRepoDiskPath(repoId);
  const content = await gitCmd.showBlob(diskPath, ref, filePath);
  const size = await gitCmd.blobSize(diskPath, ref, filePath);
  return { content, size, path: filePath };
}

/**
 *
 * @param repoId
 * @param ref
 * @param filePath
 */
export async function getBlame(repoId: string, ref: string, filePath: string) {
  const diskPath = await getRepoDiskPath(repoId);
  return gitCmd.blame(diskPath, ref, filePath);
}

/**
 *
 * @param repoId
 */
export async function getTags(repoId: string) {
  const diskPath = await getRepoDiskPath(repoId);
  return gitCmd.listTags(diskPath);
}
