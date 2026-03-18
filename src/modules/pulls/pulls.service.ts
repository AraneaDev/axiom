import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { CommitRefType } from '@prisma/client';

import { prisma } from '../../config/database';
import * as gitCmd from '../../git/git-commands';
import { repoExists } from '../../git/repo-manager';
import { AppError } from '../../middleware/errorHandler';
import { enforceMergeProtection } from '../repos/protection.service';

const ISSUE_REF_RE = /(?:(closes?|fixes?)\s+)?#(\d+)/gi;

async function parseAndLinkIssues(prId: string, repoId: string, text: string): Promise<void> {
  // Find team projects for this repo
  const teamProjects = await prisma.project.findMany({
    where: { team: { repos: { some: { id: repoId } } } },
    select: { id: true },
  });

  // Delete existing links for this PR, then re-create
  await prisma.issuePullRequest.deleteMany({ where: { prId } });

  const matches = [...text.matchAll(ISSUE_REF_RE)];
  for (const match of matches) {
    const keyword = match[1]?.toLowerCase();
    const issueNum = parseInt(match[2]);
    const refType: CommitRefType = keyword?.startsWith('clos')
      ? 'CLOSES'
      : keyword?.startsWith('fix')
        ? 'FIXES'
        : 'REFS';

    for (const project of teamProjects) {
      const issue = await prisma.issue.findUnique({
        where: { projectId_number: { projectId: project.id, number: issueNum } },
      });
      if (!issue) continue;

      await prisma.issuePullRequest.upsert({
        where: { issueId_prId: { issueId: issue.id, prId } },
        create: { issueId: issue.id, prId, refType },
        update: { refType },
      });
    }
  }
}

const execFileAsync = promisify(execFile);

async function getRepoDisk(repoId: string): Promise<{ diskPath: string; defaultBranch: string }> {
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  if (!repo || !repo.diskPath) throw new AppError(404, 'Repository not found');
  if (!(await repoExists(repo.diskPath))) throw new AppError(404, 'Repository not on disk');
  return { diskPath: repo.diskPath, defaultBranch: repo.defaultBranch };
}

/**
 *
 * @param repoId
 * @param authorId
 * @param data
 * @param data.title
 * @param data.body
 * @param data.sourceBranch
 * @param data.targetBranch
 */
export async function createPR(
  repoId: string,
  authorId: string,
  data: {
    title: string;
    body?: string;
    sourceBranch: string;
    targetBranch: string;
  },
) {
  const { diskPath, defaultBranch } = await getRepoDisk(repoId);
  const target = data.targetBranch || defaultBranch;

  // Validate branches exist
  if (!(await gitCmd.branchExists(diskPath, data.sourceBranch))) {
    throw new AppError(400, `Source branch '${data.sourceBranch}' not found`);
  }
  if (!(await gitCmd.branchExists(diskPath, target))) {
    throw new AppError(400, `Target branch '${target}' not found`);
  }
  if (data.sourceBranch === target) {
    throw new AppError(400, 'Source and target branches must be different');
  }

  // Check there are actual commits to merge
  const base = await gitCmd.mergeBase(diskPath, target, data.sourceBranch);
  const headSha = await gitCmd.resolveRef(diskPath, `refs/heads/${data.sourceBranch}`);
  if (base === headSha) {
    throw new AppError(400, 'Source branch has no new commits compared to target');
  }

  // Get next PR number
  const lastPR = await prisma.pullRequest.findFirst({
    where: { repoId },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const number = (lastPR?.number ?? 0) + 1;

  const pr = await prisma.pullRequest.create({
    data: {
      repoId,
      number,
      title: data.title,
      body: data.body ?? '',
      authorId,
      sourceBranch: data.sourceBranch,
      targetBranch: target,
      status: 'OPEN',
    },
  });

  await parseAndLinkIssues(pr.id, repoId, `${data.title}\n${data.body ?? ''}`);
  return pr;
}

/**
 *
 * @param repoId
 * @param prNumber
 */
export async function getPR(repoId: string, prNumber: number) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
    include: {
      reviews: { orderBy: { createdAt: 'desc' } },
      comments: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');

  // Add merge status
  const { diskPath } = await getRepoDisk(repoId);
  let mergeable: boolean | null = null;
  if (pr.status === 'OPEN') {
    try {
      const sourceExists = await gitCmd.branchExists(diskPath, pr.sourceBranch);
      const targetExists = await gitCmd.branchExists(diskPath, pr.targetBranch);
      if (sourceExists && targetExists) {
        mergeable = await gitCmd.canMerge(diskPath, pr.sourceBranch, pr.targetBranch);
      }
    } catch {
      mergeable = null;
    }
  }

  return { ...pr, mergeable };
}

/**
 *
 * @param repoId
 * @param status
 */
export async function listPRs(repoId: string, status?: 'OPEN' | 'MERGED' | 'CLOSED') {
  const where: Record<string, unknown> = { repoId };
  if (status) where.status = status;

  return prisma.pullRequest.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      _count: { select: { reviews: true, comments: true } },
    },
  });
}

/**
 *
 * @param repoId
 * @param prNumber
 * @param data
 * @param data.title
 * @param data.body
 */
export async function updatePR(
  repoId: string,
  prNumber: number,
  data: {
    title?: string;
    body?: string;
  },
) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');
  if (pr.status !== 'OPEN') throw new AppError(400, 'Can only edit open PRs');

  const updatedPr = await prisma.pullRequest.update({
    where: { id: pr.id },
    data,
  });

  await parseAndLinkIssues(pr.id, pr.repoId, `${updatedPr.title}\n${updatedPr.body ?? ''}`);
  return updatedPr;
}

/**
 *
 * @param repoId
 * @param prNumber
 */
export async function closePR(repoId: string, prNumber: number) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');
  if (pr.status !== 'OPEN') throw new AppError(400, 'PR is not open');

  return prisma.pullRequest.update({
    where: { id: pr.id },
    data: { status: 'CLOSED' },
  });
}

/**
 *
 * @param repoId
 * @param prNumber
 * @param strategy
 */
export async function mergePR(
  repoId: string,
  prNumber: number,
  strategy: 'merge' | 'squash' | 'rebase' = 'merge',
) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');
  if (pr.status !== 'OPEN') throw new AppError(400, 'PR is not open');

  // CI gate
  const protection = await prisma.branchProtection.findFirst({
    where: { repoId: pr.repoId, pattern: pr.targetBranch },
  });
  if (protection?.requireCI) {
    if (pr.ciStatus !== 'SUCCESS') {
      throw Object.assign(new Error('CI checks must pass before merging'), {
        status: 422,
        code: 'CI_REQUIRED',
      });
    }
  }

  // Enforce branch protection rules
  await enforceMergeProtection(repoId, pr.targetBranch, pr.id);

  const { diskPath } = await getRepoDisk(repoId);

  // Verify branches still exist
  if (!(await gitCmd.branchExists(diskPath, pr.sourceBranch))) {
    throw new AppError(400, 'Source branch no longer exists');
  }
  if (!(await gitCmd.branchExists(diskPath, pr.targetBranch))) {
    throw new AppError(400, 'Target branch no longer exists');
  }

  // Check for conflicts
  const mergeable = await gitCmd.canMerge(diskPath, pr.sourceBranch, pr.targetBranch);
  if (!mergeable) {
    throw new AppError(409, 'PR has merge conflicts');
  }

  // Resolve the source branch SHA before merge (bare repo has no 'origin' remote)
  const sourceSha = await gitCmd.resolveRef(diskPath, `refs/heads/${pr.sourceBranch}`);

  // Perform merge in a temporary worktree
  const worktreeDir = path.join(diskPath, '..', `_merge_${pr.number}_${Date.now()}`);
  try {
    // Create worktree from target branch
    await execFileAsync('git', ['worktree', 'add', worktreeDir, pr.targetBranch], {
      cwd: diskPath,
    });

    if (strategy === 'merge') {
      await execFileAsync('git', [
        '-C',
        worktreeDir,
        'merge',
        '--no-ff',
        sourceSha,
        '-m',
        `Merge PR #${pr.number}: ${pr.title}`,
      ]);
    } else if (strategy === 'squash') {
      await execFileAsync('git', ['-C', worktreeDir, 'merge', '--squash', sourceSha]);
      await execFileAsync('git', [
        '-C',
        worktreeDir,
        'commit',
        '-m',
        `${pr.title} (#${pr.number})`,
        '--author',
        'Axiom <noreply@axiom.dev>',
      ]);
    } else if (strategy === 'rebase') {
      await execFileAsync('git', ['-C', worktreeDir, 'rebase', sourceSha]);
    }

    // Update the bare repo's target branch ref to the new HEAD
    const newHead = (
      await execFileAsync('git', ['-C', worktreeDir, 'rev-parse', 'HEAD'])
    ).stdout.trim();
    await execFileAsync('git', ['update-ref', `refs/heads/${pr.targetBranch}`, newHead], {
      cwd: diskPath,
    });
  } finally {
    // Clean up worktree
    await execFileAsync('git', ['worktree', 'remove', '--force', worktreeDir], {
      cwd: diskPath,
    }).catch(() => {});
    await fs.rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
  }

  // Update PR status
  const mergedPr = await prisma.pullRequest.update({
    where: { id: pr.id },
    data: { status: 'MERGED' },
  });

  // Auto-close linked issues
  const linkedIssues = await prisma.issuePullRequest.findMany({
    where: { prId: pr.id, refType: { in: ['CLOSES', 'FIXES'] } },
    include: { issue: { include: { project: true } } },
  });

  for (const link of linkedIssues) {
    const doneColumn = await prisma.boardColumn.findFirst({
      where: {
        projectId: link.issue.projectId,
        isDone: true,
      },
    });
    if (doneColumn && link.issue.columnId !== doneColumn.id) {
      await prisma.issue.update({
        where: { id: link.issue.id },
        data: { columnId: doneColumn.id },
      });
      // Notify issue creator
      await prisma.notification
        .create({
          data: {
            userId: link.issue.creatorId,
            type: 'issue:closed',
            title: `Issue closed by merged PR`,
            link: `/issues/${link.issue.id}`,
            read: false,
          },
        })
        .catch(() => {}); // notification creation is non-critical
    }
  }

  return mergedPr;
}

/**
 *
 * @param repoId
 * @param prNumber
 */
export async function getLinkedIssues(repoId: string, prNumber: number) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');

  return prisma.issuePullRequest.findMany({
    where: { prId: pr.id },
    include: {
      issue: {
        include: {
          project: {
            select: {
              prefix: true,
              slug: true,
              team: { select: { slug: true, org: { select: { slug: true } } } },
            },
          },
          column: { select: { name: true } },
          assignee: { select: { id: true, displayName: true } },
        },
      },
    },
  });
}

/**
 *
 * @param repoId
 * @param prNumber
 */
export async function getPRDiff(repoId: string, prNumber: number) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');

  const { diskPath } = await getRepoDisk(repoId);
  const diffOutput = await gitCmd.diff(diskPath, pr.targetBranch, pr.sourceBranch);
  const stats = await gitCmd.diffStat(diskPath, pr.targetBranch, pr.sourceBranch);

  return { diff: diffOutput, stats };
}

/**
 *
 * @param repoId
 * @param prNumber
 */
export async function getPRCommits(repoId: string, prNumber: number) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');

  const { diskPath } = await getRepoDisk(repoId);
  const base = await gitCmd.mergeBase(diskPath, pr.targetBranch, pr.sourceBranch);
  return gitCmd.log(diskPath, `${base}..${pr.sourceBranch}`, 100);
}

// ─── Reviews ────────────────────────────────────────────────

/**
 *
 * @param repoId
 * @param prNumber
 * @param reviewerId
 * @param data
 * @param data.status
 * @param data.body
 */
export async function submitReview(
  repoId: string,
  prNumber: number,
  reviewerId: string,
  data: {
    status: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
    body?: string;
  },
) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');
  if (pr.status !== 'OPEN') throw new AppError(400, 'Can only review open PRs');

  return prisma.pRReview.create({
    data: {
      prId: pr.id,
      reviewerId,
      status: data.status,
      body: data.body ?? '',
    },
  });
}

/**
 *
 * @param repoId
 * @param prNumber
 */
export async function listReviews(repoId: string, prNumber: number) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');

  return prisma.pRReview.findMany({
    where: { prId: pr.id },
    orderBy: { createdAt: 'desc' },
  });
}

// ─── PR Comments ────────────────────────────────────────────

/**
 *
 * @param repoId
 * @param prNumber
 * @param authorId
 * @param data
 * @param data.body
 * @param data.filePath
 * @param data.line
 */
export async function addPRComment(
  repoId: string,
  prNumber: number,
  authorId: string,
  data: {
    body: string;
    filePath?: string;
    line?: number;
  },
) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');

  return prisma.pRComment.create({
    data: {
      prId: pr.id,
      authorId,
      body: data.body,
      filePath: data.filePath,
      line: data.line,
    },
  });
}

/**
 *
 * @param repoId
 * @param prNumber
 */
export async function listPRComments(repoId: string, prNumber: number) {
  const pr = await prisma.pullRequest.findUnique({
    where: { repoId_number: { repoId, number: prNumber } },
  });
  if (!pr) throw new AppError(404, 'Pull request not found');

  return prisma.pRComment.findMany({
    where: { prId: pr.id },
    orderBy: { createdAt: 'asc' },
  });
}
