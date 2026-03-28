import { prisma } from '../../config/database';
import * as gitCmd from '../../git/git-commands';
import { repoExists } from '../../git/repo-manager';
import { parseServicePagination } from '../../utils/pagination';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

import { generateChangelog, type CommitEntry } from './changelog';

/**
 * List releases for a repository with optional draft/prerelease filters.
 * @param repoId - The repository ID
 * @param opts - Optional filters for draft and prerelease status, plus pagination
 * @param opts.draft
 * @param opts.prerelease
 * @param opts.limit
 * @param opts.offset
 * @returns List of releases with author details
 */
export async function listReleases(
  repoId: string,
  opts: { draft?: boolean; prerelease?: boolean; limit?: number; offset?: number } = {},
) {
  const { take, skip } = parseServicePagination(opts, 20);
  return prisma.release.findMany({
    where: {
      repoId,
      ...(opts.draft !== undefined ? { isDraft: opts.draft } : {}),
      ...(opts.prerelease !== undefined ? { isPrerelease: opts.prerelease } : {}),
    },
    include: { author: { select: USER_BASIC_SELECT } },
    orderBy: { createdAt: 'desc' },
    take,
    skip,
  });
}

/**
 * Get a release by tag name, including commits since the previous release.
 * @param repoId - The repository ID
 * @param tagName - The release tag name
 * @returns The release with author and associated commits, or null if not found
 */
export async function getRelease(repoId: string, tagName: string) {
  const release = await prisma.release.findUnique({
    where: { repoId_tagName: { repoId, tagName } },
    include: { author: { select: USER_BASIC_SELECT } },
  });
  if (!release) return null;

  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  let commits: CommitEntry[] = [];
  if (repo?.diskPath && (await repoExists(repo.diskPath))) {
    try {
      // Get commits between previous release and this tag
      const allTags = await gitCmd.listTags(repo.diskPath);
      const tagNames = allTags.map((t) => t.name).sort();
      const idx = tagNames.indexOf(tagName);
      const base = idx > 0 ? tagNames[idx - 1] : null;
      const rawCommits = await gitCmd.log(repo.diskPath, tagName, 100, 0);
      const baseCommits = base ? await gitCmd.log(repo.diskPath, base, 1000, 0) : [];
      const baseShas = new Set(baseCommits.map((c) => c.sha));
      commits = rawCommits
        .filter((c) => !baseShas.has(c.sha))
        .map((c) => ({
          sha: c.sha,
          shortSha: c.shortSha,
          message: c.message,
          author: c.author,
          date: c.date,
        }));
    } catch {
      /* ignored */
    }
  }

  return { ...release, commits };
}

/**
 * Create a release, optionally creating a git tag on the repository.
 * @param repoId - The repository ID
 * @param userId - The user creating the release
 * @param data - Release creation data including tagName, title, body, draft/prerelease flags, target branch, and optional commit SHA
 * @param data.tagName
 * @param data.title
 * @param data.body
 * @param data.isDraft
 * @param data.isPrerelease
 * @param data.targetBranch
 * @param data.commitSha
 * @returns The created release with author details
 * @throws {Error} 404 if repository not found
 */
export async function createRelease(
  repoId: string,
  userId: string,
  data: {
    tagName: string;
    title: string;
    body?: string;
    isDraft?: boolean;
    isPrerelease?: boolean;
    targetBranch: string;
    commitSha?: string;
  },
) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) throw Object.assign(new Error('Repository not found'), { status: 404 });

  let sha = data.commitSha;
  if (!sha && repo.diskPath && (await repoExists(repo.diskPath))) {
    try {
      sha = await gitCmd.resolveRef(repo.diskPath, data.targetBranch);
    } catch {
      /* ignored */
    }
  }

  if (!data.isDraft && sha && repo.diskPath && (await repoExists(repo.diskPath))) {
    await gitCmd.createTag(repo.diskPath, data.tagName, sha, data.title);
  }

  return prisma.release.create({
    data: {
      repoId,
      tagName: data.tagName,
      title: data.title,
      body: data.body ?? '',
      isDraft: data.isDraft ?? false,
      isPrerelease: data.isPrerelease ?? false,
      targetBranch: data.targetBranch,
      commitSha: sha,
      authorId: userId,
      publishedAt: data.isDraft ? null : new Date(),
    },
    include: { author: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Update a release's metadata (title, body, draft/prerelease flags).
 * @param repoId - The repository ID
 * @param tagName - The release tag name
 * @param data - Partial update data for the release
 * @returns The updated release with author details
 */
export async function updateRelease(
  repoId: string,
  tagName: string,
  data: Partial<{
    title: string;
    body: string;
    isDraft: boolean;
    isPrerelease: boolean;
  }>,
) {
  return prisma.release.update({
    where: { repoId_tagName: { repoId, tagName } },
    data,
    include: { author: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Publish a draft release by creating the git tag and marking it as published.
 * @param repoId - The repository ID
 * @param tagName - The release tag name
 * @returns The published release with author details
 * @throws {Error} 404 if release not found
 */
export async function publishRelease(repoId: string, tagName: string) {
  const release = await prisma.release.findUnique({
    where: { repoId_tagName: { repoId, tagName } },
  });
  if (!release) throw Object.assign(new Error('Release not found'), { status: 404 });

  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (repo?.diskPath && release.commitSha && (await repoExists(repo.diskPath))) {
    await gitCmd.createTag(repo.diskPath, tagName, release.commitSha, release.title);
  }

  return prisma.release.update({
    where: { repoId_tagName: { repoId, tagName } },
    data: { isDraft: false, publishedAt: new Date() },
    include: { author: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Delete a release and its associated git tag from the repository.
 * @param repoId - The repository ID
 * @param tagName - The release tag name to delete
 */
export async function deleteRelease(repoId: string, tagName: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (repo?.diskPath && (await repoExists(repo.diskPath))) {
    try {
      await gitCmd.deleteTag(repo.diskPath, tagName);
    } catch {
      /* ignored */
    }
  }
  await prisma.release.delete({ where: { repoId_tagName: { repoId, tagName } } });
}

/**
 * Compare two refs and generate a changelog of commits between them.
 * @param repoId - The repository ID
 * @param base - The base ref (tag or branch) to compare from
 * @param head - The head ref (tag or branch) to compare to
 * @returns Object with commits between the refs and generated changelog
 */
export async function compareRelease(repoId: string, base: string, head: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo?.diskPath || !(await repoExists(repo.diskPath))) return { commits: [], changelog: [] };

  const allCommits = await gitCmd.log(repo.diskPath, head, 200, 0);
  const baseCommits = await gitCmd.log(repo.diskPath, base, 1000, 0);
  const baseShas = new Set(baseCommits.map((c) => c.sha));
  const commits: CommitEntry[] = allCommits
    .filter((c) => !baseShas.has(c.sha))
    .map((c) => ({
      sha: c.sha,
      shortSha: c.shortSha,
      message: c.message,
      author: c.author,
      date: c.date,
    }));

  return { commits, changelog: generateChangelog(commits) };
}

/**
 * Deploy a release to an environment.
 * @param repoId - The repository ID
 * @param tagName - The release tag name
 * @param environmentId - The target environment ID
 * @param userId - The user triggering the deployment
 * @returns The created deployment record
 */
export async function deployRelease(
  repoId: string,
  tagName: string,
  environmentId: string,
  userId: string,
) {
  const release = await prisma.release.findUnique({
    where: { repoId_tagName: { repoId, tagName } },
  });
  if (!release) throw Object.assign(new Error('Release not found'), { status: 404 });

  const env = await prisma.deploymentEnvironment.findFirst({
    where: { id: environmentId, repoId },
  });
  if (!env) throw Object.assign(new Error('Environment not found'), { status: 404 });

  const commitSha = release.commitSha ?? '';

  const [deployment] = await prisma.$transaction([
    prisma.deployment.create({
      data: {
        environmentId,
        commitSha,
        releaseId: release.id,
        deployedById: userId,
        status: 'PENDING',
      },
      include: {
        deployedBy: { select: USER_BASIC_SELECT },
        environment: { select: { id: true, name: true, url: true } },
        release: { select: { id: true, tagName: true, title: true } },
      },
    }),
    prisma.deploymentEnvironment.update({
      where: { id: environmentId },
      data: { lastDeployedAt: new Date() },
    }),
  ]);

  return deployment;
}

/**
 * List deployments for a specific release.
 * @param repoId - The repository ID
 * @param tagName - The release tag name
 * @returns List of deployments with environment and user details
 */
export async function listReleaseDeployments(repoId: string, tagName: string) {
  const release = await prisma.release.findUnique({
    where: { repoId_tagName: { repoId, tagName } },
  });
  if (!release) throw Object.assign(new Error('Release not found'), { status: 404 });

  return prisma.deployment.findMany({
    where: { releaseId: release.id },
    include: {
      deployedBy: { select: USER_BASIC_SELECT },
      environment: { select: { id: true, name: true, url: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}
