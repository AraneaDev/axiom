import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import { CommitRefType } from '@prisma/client';

import { prisma } from '../../config/database';
import * as gitCmd from '../../git/git-commands';
import { repoExists } from '../../git/repo-manager';
import { AppError } from '../../middleware/errorHandler';
import { broadcastToRoom } from '../../realtime/broadcast';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';
import { parseServicePagination } from '../../utils/pagination';
import { logActivity } from '../activity/activity.service';
import { enforceMergeProtection } from '../repos/protection.service';

// Re-export from sub-modules for backwards compatibility
export { submitReview, listReviews } from './pull-reviews.service';
export {
  addPRComment,
  listPRComments,
  updatePRComment,
  deletePRComment,
  applySuggestion,
  batchApplySuggestions,
} from './pull-comments.service';

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
      ? CommitRefType.CLOSES
      : keyword?.startsWith('fix')
        ? CommitRefType.FIXES
        : CommitRefType.REFS;

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
  const repo = await findOrThrow(
    prisma.repository.findUnique({ where: { id: repoId } }),
    'Repository not found',
  );
  if (!repo.diskPath) throw new AppError(404, 'Repository not found');
  if (!(await repoExists(repo.diskPath))) throw new AppError(404, 'Repository not on disk');
  return { diskPath: repo.diskPath, defaultBranch: repo.defaultBranch };
}

/**
 * Create a new pull request, validating branches exist and have diverging commits.
 * @param repoId - The repository to create the PR in
 * @param authorId - The user creating the PR
 * @param data - PR creation data including title, body, source and target branches
 * @param data.title
 * @param data.body
 * @param data.sourceBranch
 * @param data.targetBranch
 * @returns The created pull request record
 * @throws {AppError} 400 if branches are invalid, identical, or have no new commits
 * @throws {AppError} 404 if repository not found
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
  await logActivity('pull_request', pr.id, 'created', authorId, { title: data.title, number });

  broadcastToRoom(`repo:${repoId}`, { type: 'pr:updated', repoId, prId: pr.id });

  return pr;
}

/**
 * Retrieve a pull request by repo and PR number, including reviews, comments, and merge status.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @returns The PR with reviews, comments, and mergeable status
 * @throws {AppError} 404 if PR not found
 */
export async function getPR(repoId: string, prNumber: number) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
      include: {
        reviews: { orderBy: { createdAt: 'desc' } },
        comments: { orderBy: { createdAt: 'asc' } },
      },
    }),
    'Pull request not found',
  );

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
 * List pull requests for a repository with optional status filter and pagination.
 * @param repoId - The repository to list PRs for
 * @param status - Optional filter by PR status (OPEN, MERGED, CLOSED)
 * @param opts - Pagination options (limit, offset)
 * @param opts.limit
 * @param opts.offset
 * @param opts.reviewerId
 * @returns Paginated list of PRs with review and comment counts
 */
export async function listPRs(
  repoId: string,
  status?: 'OPEN' | 'MERGED' | 'CLOSED',
  opts?: { limit?: number; offset?: number; reviewerId?: string },
) {
  const where: Record<string, unknown> = { repoId };
  if (status) where.status = status;
  if (opts?.reviewerId) {
    where.reviews = { some: { reviewerId: opts.reviewerId } };
  }

  const { take, skip } = parseServicePagination(opts);

  const [prs, total] = await Promise.all([
    prisma.pullRequest.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { reviews: true, comments: true } },
      },
      take,
      skip,
    }),
    prisma.pullRequest.count({ where }),
  ]);

  // Manually join author info (no relation on PullRequest model)
  const authorIds = [...new Set(prs.map((pr: { authorId: string }) => pr.authorId))];
  const authors = authorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, username: true, displayName: true },
      })
    : [];
  const authorMap = new Map(
    authors.map((a: { id: string; username: string; displayName: string }) => [a.id, a]),
  );

  const data = prs.map((pr: (typeof prs)[number]) => ({
    ...pr,
    author: authorMap.get(pr.authorId) ?? null,
  }));

  return { data, total, limit: take, offset: skip };
}

/**
 * Update an open pull request's title or body, re-parsing issue references.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @param data - Partial update data for title and/or body
 * @param data.title
 * @param data.body
 * @returns The updated pull request record
 * @throws {AppError} 404 if PR not found
 * @throws {AppError} 400 if PR is not open
 */
export async function updatePR(
  repoId: string,
  prNumber: number,
  data: {
    title?: string;
    body?: string;
  },
) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );
  if (pr.status !== 'OPEN') throw new AppError(400, 'Can only edit open PRs');

  const updatedPr = await prisma.pullRequest.update({
    where: { id: pr.id },
    data,
  });

  await parseAndLinkIssues(pr.id, pr.repoId, `${updatedPr.title}\n${updatedPr.body ?? ''}`);

  broadcastToRoom(`repo:${repoId}`, { type: 'pr:updated', repoId, prId: pr.id });

  return updatedPr;
}

/**
 * Close an open pull request without merging.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @returns The closed pull request record
 * @throws {AppError} 404 if PR not found
 * @throws {AppError} 400 if PR is not open
 */
export async function closePR(repoId: string, prNumber: number) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );
  if (pr.status !== 'OPEN') throw new AppError(400, 'PR is not open');

  const closed = await prisma.pullRequest.update({
    where: { id: pr.id },
    data: { status: 'CLOSED' },
  });
  await logActivity('pull_request', pr.id, 'closed', pr.authorId, { number: prNumber });

  broadcastToRoom(`repo:${repoId}`, { type: 'pr:updated', repoId, prId: pr.id });

  return closed;
}

/**
 * Get merge check status for a PR including review requirements, CI status, and merge eligibility.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @returns Merge check status with required/approved reviews, CI pass status, and canMerge flag
 * @throws {AppError} 404 if PR not found
 */
export async function getMergeChecks(repoId: string, prNumber: number) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );

  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  const _protection = await prisma.branchProtection.findFirst({
    where: { repoId: pr.repoId },
  });
  // Find the matching rule for the target branch
  const matchingRule = await (
    await import('../repos/protection.service')
  ).getMatchingRule(repoId, pr.targetBranch);

  const requiredReviews = matchingRule?.requiredReviews ?? 0;
  const approvedCount = await prisma.pRReview.count({
    where: { prId: pr.id, status: 'APPROVED' },
  });

  const requireCI = matchingRule?.requireCI ?? false;
  const ciPassed = !requireCI || pr.ciStatus === 'SUCCESS';

  const reviewsMet = approvedCount >= requiredReviews;

  return {
    requiredReviews,
    approvedReviews: approvedCount,
    reviewsMet,
    requireCI,
    ciPassed,
    canMerge: reviewsMet && ciPassed,
    defaultStrategy: repo?.defaultMergeStrategy ?? 'MERGE',
  };
}

/**
 * Merge a pull request using the specified strategy, enforcing branch protection and CI gates.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @param strategy - Merge strategy (merge, squash, or rebase); defaults to repo setting or 'merge'
 * @returns The merged pull request record
 * @throws {AppError} 404 if PR not found
 * @throws {AppError} 400 if PR is not open or branches no longer exist
 * @throws {AppError} 409 if PR has merge conflicts
 * @throws {AppError} 422 if CI checks have not passed
 */
export async function mergePR(
  repoId: string,
  prNumber: number,
  strategy?: 'merge' | 'squash' | 'rebase',
) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );
  if (pr.status !== 'OPEN') throw new AppError(400, 'PR is not open');

  // Resolve effective strategy: explicit > repo default > 'merge'
  const repo = await prisma.repository.findUnique({ where: { id: repoId } });
  const effectiveStrategy: 'merge' | 'squash' | 'rebase' =
    strategy ??
    (repo?.defaultMergeStrategy?.toLowerCase() as 'merge' | 'squash' | 'rebase') ??
    'merge';

  // CI gate
  const protection = await prisma.branchProtection.findFirst({
    where: { repoId: pr.repoId, pattern: pr.targetBranch },
  });
  if (protection?.requireCI) {
    if (pr.ciStatus !== 'SUCCESS') {
      throw new AppError(422, 'CI checks must pass before merging');
    }
  }

  // Enforce branch protection rules (review requirements)
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

    if (effectiveStrategy === 'merge') {
      await execFileAsync('git', [
        '-C',
        worktreeDir,
        'merge',
        '--no-ff',
        sourceSha,
        '-m',
        `Merge PR #${pr.number}: ${pr.title}`,
      ]);
    } else if (effectiveStrategy === 'squash') {
      await gitCmd.squashMerge(worktreeDir, sourceSha, `${pr.title} (#${pr.number})`);
    } else if (effectiveStrategy === 'rebase') {
      await gitCmd.rebaseMerge(worktreeDir, sourceSha);
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
    }).catch((err) => {
      logger.error('Failed to remove merge worktree', undefined, err as Error);
    });
    await fs.rm(worktreeDir, { recursive: true, force: true }).catch((err) => {
      logger.error('Failed to clean up merge worktree directory', undefined, err as Error);
    });
  }

  // Update PR status and save which strategy was used
  const mergedPr = await prisma.pullRequest.update({
    where: { id: pr.id },
    data: { status: 'MERGED', mergeStrategy: effectiveStrategy.toUpperCase() },
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
        .catch((err) => {
          logger.error(
            'Failed to create issue-closed notification',
            { issueId: link.issue.id },
            err as Error,
          );
        });
    }
  }

  await logActivity('pull_request', pr.id, 'merged', pr.authorId, {
    number: prNumber,
    strategy: effectiveStrategy,
  });

  broadcastToRoom(`repo:${repoId}`, { type: 'pr:merged', repoId, prId: pr.id });

  return mergedPr;
}

/**
 * Get issues linked to a pull request via commit/PR body references.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @returns List of linked issues with project, column, and assignee details
 * @throws {AppError} 404 if PR not found
 */
export async function getLinkedIssues(repoId: string, prNumber: number) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );

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
 * Get the diff output and file stats between a PR's source and target branches.
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @returns Object with raw diff text and per-file stats
 * @throws {AppError} 404 if PR not found
 */
export async function getPRDiff(repoId: string, prNumber: number) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );

  const { diskPath } = await getRepoDisk(repoId);
  const diffOutput = await gitCmd.diff(diskPath, pr.targetBranch, pr.sourceBranch);
  const stats = await gitCmd.diffStat(diskPath, pr.targetBranch, pr.sourceBranch);

  return { diff: diffOutput, stats };
}

/**
 * Get the list of commits in a PR (between merge base and source branch head).
 * @param repoId - The repository the PR belongs to
 * @param prNumber - The PR number within the repository
 * @returns List of commits unique to the source branch
 * @throws {AppError} 404 if PR not found
 */
export async function getPRCommits(repoId: string, prNumber: number) {
  const pr = await findOrThrow(
    prisma.pullRequest.findUnique({
      where: { repoId_number: { repoId, number: prNumber } },
    }),
    'Pull request not found',
  );

  const { diskPath } = await getRepoDisk(repoId);
  const base = await gitCmd.mergeBase(diskPath, pr.targetBranch, pr.sourceBranch);
  return gitCmd.log(diskPath, `${base}..${pr.sourceBranch}`, 100);
}
