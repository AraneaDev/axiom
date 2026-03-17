import { prisma } from '../../config/database';
import * as gitCmd from '../../git/git-commands';
import { repoExists } from '../../git/repo-manager';
import { generateChangelog, type CommitEntry } from './changelog';

export async function listReleases(repoId: string, opts: { draft?: boolean; prerelease?: boolean }) {
  return prisma.release.findMany({
    where: {
      repoId,
      ...(opts.draft !== undefined ? { isDraft: opts.draft } : {}),
      ...(opts.prerelease !== undefined ? { isPrerelease: opts.prerelease } : {}),
    },
    include: { author: { select: { id: true, username: true, displayName: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getRelease(repoId: string, tagName: string) {
  const release = await prisma.release.findUnique({
    where: { repoId_tagName: { repoId, tagName } },
    include: { author: { select: { id: true, username: true, displayName: true } } },
  });
  if (!release) return null;

  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  let commits: CommitEntry[] = [];
  if (repo?.diskPath && await repoExists(repo.diskPath)) {
    try {
      // Get commits between previous release and this tag
      const allTags = await gitCmd.listTags(repo.diskPath);
      const tagNames = allTags.map(t => t.name).sort();
      const idx = tagNames.indexOf(tagName);
      const base = idx > 0 ? tagNames[idx - 1] : null;
      const rawCommits = await gitCmd.log(repo.diskPath, tagName, 100, 0);
      const baseCommits = base ? await gitCmd.log(repo.diskPath, base, 1000, 0) : [];
      const baseShas = new Set(baseCommits.map(c => c.sha));
      commits = rawCommits
        .filter(c => !baseShas.has(c.sha))
        .map(c => ({ sha: c.sha, shortSha: c.shortSha, message: c.message, author: c.author, date: c.date }));
    } catch {}
  }

  return { ...release, commits };
}

export async function createRelease(repoId: string, userId: string, data: {
  tagName: string;
  title: string;
  body?: string;
  isDraft?: boolean;
  isPrerelease?: boolean;
  targetBranch: string;
  commitSha?: string;
}) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo) throw Object.assign(new Error('Repository not found'), { status: 404 });

  let sha = data.commitSha;
  if (!sha && repo.diskPath && await repoExists(repo.diskPath)) {
    try { sha = await gitCmd.resolveRef(repo.diskPath, data.targetBranch); } catch {}
  }

  if (!data.isDraft && sha && repo.diskPath && await repoExists(repo.diskPath)) {
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
    include: { author: { select: { id: true, username: true, displayName: true } } },
  });
}

export async function updateRelease(repoId: string, tagName: string, data: Partial<{
  title: string; body: string; isDraft: boolean; isPrerelease: boolean;
}>) {
  return prisma.release.update({
    where: { repoId_tagName: { repoId, tagName } },
    data,
    include: { author: { select: { id: true, username: true, displayName: true } } },
  });
}

export async function publishRelease(repoId: string, tagName: string) {
  const release = await prisma.release.findUnique({ where: { repoId_tagName: { repoId, tagName } } });
  if (!release) throw Object.assign(new Error('Release not found'), { status: 404 });

  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (repo?.diskPath && release.commitSha && await repoExists(repo.diskPath)) {
    await gitCmd.createTag(repo.diskPath, tagName, release.commitSha, release.title);
  }

  return prisma.release.update({
    where: { repoId_tagName: { repoId, tagName } },
    data: { isDraft: false, publishedAt: new Date() },
    include: { author: { select: { id: true, username: true, displayName: true } } },
  });
}

export async function deleteRelease(repoId: string, tagName: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (repo?.diskPath && await repoExists(repo.diskPath)) {
    try { await gitCmd.deleteTag(repo.diskPath, tagName); } catch {}
  }
  await prisma.release.delete({ where: { repoId_tagName: { repoId, tagName } } });
}

export async function compareRelease(repoId: string, base: string, head: string) {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo?.diskPath || !await repoExists(repo.diskPath)) return { commits: [], changelog: [] };

  const allCommits = await gitCmd.log(repo.diskPath, head, 200, 0);
  const baseCommits = await gitCmd.log(repo.diskPath, base, 1000, 0);
  const baseShas = new Set(baseCommits.map(c => c.sha));
  const commits: CommitEntry[] = allCommits
    .filter(c => !baseShas.has(c.sha))
    .map(c => ({ sha: c.sha, shortSha: c.shortSha, message: c.message, author: c.author, date: c.date }));

  return { commits, changelog: generateChangelog(commits) };
}
