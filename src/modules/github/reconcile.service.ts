// Reads each linked repository from GitHub every 15 minutes and stores what the webhooks missed
// (a burst answered 429 is never redelivered). Every record goes through the same stores as a
// webhook, so a missed merge still reports `pr_merged` once, and a log that could not be had is
// asked for again within its one-hour limit.
import { z } from 'zod';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

import { storeCheckRun, type CheckRunPayload } from './checks.service';
import { githubPaginate, githubRequest, type GithubAuth } from './github-client';
import { storeBranch, storePullRequest, type PullRequestPayload } from './github-events';
import { extractIssueNumbers } from './issue-keys';

export const RECONCILE_INTERVAL_MS = 15 * 60_000;
export const RECONCILE_CALL_BUDGET = 300;
const LEASE_MS = 10 * 60_000;
const OPEN_PR_PAGES = 5;
const MISSING_PR_LIMIT = 50;
const CHECK_RUN_PAGES = 2;
const BRANCH_PAGES = 10;
const ERROR_MAX = 500;

export type ReconcileResult = {
  pullRequests: number;
  checkRuns: number;
  branches: number;
  calls: number;
  complete: boolean;
};

const branchList = z.array(
  z.object({ name: z.string().min(1), commit: z.object({ sha: z.string().min(1) }) }),
);
const prNumber = z.object({
  number: z.number().int(),
  updated_at: z.string(),
  head: z.object({ sha: z.string() }),
});

/**
 * Claims the right to reconcile a link with one conditional update.
 * @param repoLinkId The link
 * @throws {AppError} 404 when the link is gone, 409 GITHUB_RECONCILE_RUNNING while another run holds the lease
 */
async function claimLease(repoLinkId: string): Promise<void> {
  const now = new Date();
  const claim = await prisma.githubRepoLink.updateMany({
    where: {
      id: repoLinkId,
      OR: [{ reconcileLeaseUntil: null }, { reconcileLeaseUntil: { lt: now } }],
    },
    data: { reconcileLeaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (claim.count > 0) return;
  const exists = await prisma.githubRepoLink.findUnique({
    where: { id: repoLinkId },
    select: { id: true },
  });
  if (!exists) throw new AppError(404, 'The repository is not linked', 'NOT_FOUND');
  throw new AppError(
    409,
    'This repository is being reconciled right now',
    'GITHUB_RECONCILE_RUNNING',
  );
}

/**
 * Reconciles one linked repository with GitHub, as its installation: the open pull requests, the
 * ones stored as open that GitHub no longer lists, the check runs at the head of each open pull
 * request, and the branches. Stops when the call budget is spent. A list that was not read to
 * its end never makes a stored record look gone.
 * @param repoLinkId The link
 * @param opts `callBudget` overrides the default budget
 * @param opts.callBudget
 * @returns What was stored, the GitHub calls made, and whether everything was read
 * @throws {AppError} 404 when the link is gone, 409 GITHUB_RECONCILE_RUNNING while another run holds it; a GitHub failure
 */
export async function reconcileRepo(
  repoLinkId: string,
  opts: { callBudget?: number } = {},
): Promise<ReconcileResult> {
  await claimLease(repoLinkId);
  const budget = opts.callBudget ?? RECONCILE_CALL_BUDGET;
  const result: ReconcileResult = {
    pullRequests: 0,
    checkRuns: 0,
    branches: 0,
    calls: 0,
    complete: true,
  };
  const failure: { message: string | null } = { message: null };
  try {
    const link = await prisma.githubRepoLink.findUnique({
      where: { id: repoLinkId },
      select: {
        owner: true,
        name: true,
        installationId: true,
        project: { select: { prefix: true } },
      },
    });
    if (!link) throw new AppError(404, 'The repository is not linked', 'NOT_FOUND');
    const auth: GithubAuth = { kind: 'installation', installationId: Number(link.installationId) };
    const repoPath = `/repos/${encodeURIComponent(link.owner)}/${encodeURIComponent(link.name)}`;
    const left = () => budget - result.calls;
    const itemFailed = (what: string, err: unknown) => {
      failure.message ??= err instanceof Error ? err.message : `${what} failed`;
      result.complete = false;
      logger.warn('github reconcile item failed', { repoLinkId, what });
    };
    // One list: the pages it may still read, counted as calls
    const list = async <T>(path: string, maxPages: number, itemsKey?: string) => {
      const pages = Math.min(maxPages, left());
      if (pages <= 0) {
        result.complete = false;
        return null;
      }
      const read = await githubPaginate<T>(auth, path, { maxPages: pages, itemsKey });
      result.calls += read.complete ? Math.max(1, Math.ceil(read.items.length / 100)) : pages;
      if (!read.complete) result.complete = false;
      return read;
    };

    // Open pull requests
    const open = await list<PullRequestPayload>(`${repoPath}/pulls`, OPEN_PR_PAGES);
    const returned = open?.items ?? [];
    const stored = new Map(
      (
        await prisma.githubPullRequest.findMany({
          where: { repoLinkId },
          select: { number: true, state: true, headSha: true, githubUpdatedAt: true },
        })
      ).map((row) => [row.number, row]),
    );
    for (const payload of returned) {
      const head = prNumber.safeParse(payload);
      const known = head.success ? stored.get(head.data.number) : undefined;
      if (
        head.success &&
        known?.state === 'OPEN' &&
        known.headSha === head.data.head.sha &&
        known.githubUpdatedAt.getTime() === Date.parse(head.data.updated_at)
      ) {
        continue;
      }
      try {
        await storePullRequest(repoLinkId, payload, null, 'reconcile');
        result.pullRequests++;
      } catch (err) {
        itemFailed('pull request', err);
      }
    }

    // Stored as open, not listed any more: closed or merged while no webhook arrived. Only a
    // list read to its end can say a pull request is missing from it.
    if (open?.items && open.complete) {
      const listed = new Set(
        returned
          .map((p) => prNumber.safeParse(p))
          .flatMap((p) => (p.success ? [p.data.number] : [])),
      );
      const missing = [...stored.entries()]
        .filter(([number, row]) => row.state === 'OPEN' && !listed.has(number))
        .map(([number]) => number)
        .slice(0, MISSING_PR_LIMIT);
      for (const number of missing) {
        if (left() <= 0) {
          result.complete = false;
          break;
        }
        result.calls++;
        try {
          const { data } = await githubRequest<PullRequestPayload>(
            auth,
            'GET',
            `${repoPath}/pulls/${number}`,
          );
          await storePullRequest(repoLinkId, data, null, 'reconcile');
          result.pullRequests++;
        } catch (err) {
          // A pull request GitHub no longer knows stays as it is
          if (err instanceof AppError && err.statusCode === 404) continue;
          itemFailed('pull request', err);
        }
      }
    }

    // Check runs at the head of each open pull request
    const heads = [
      ...new Set(returned.flatMap((p) => (prNumber.safeParse(p).success ? [p.head.sha] : []))),
    ];
    for (const headSha of heads) {
      const runs = await list<CheckRunPayload>(
        `${repoPath}/commits/${encodeURIComponent(headSha)}/check-runs`,
        CHECK_RUN_PAGES,
        'check_runs',
      );
      if (!runs) break;
      for (const run of runs.items) {
        try {
          const { stale } = await storeCheckRun(repoLinkId, run, auth, { source: 'reconcile' });
          if (!stale) result.checkRuns++;
        } catch (err) {
          itemFailed('check run', err);
        }
      }
    }

    // Branches: those that name an issue (or are stored already), and the linked ones GitHub lost
    const branches = await list<unknown>(`${repoPath}/branches`, BRANCH_PAGES);
    if (branches) {
      const parsed = branchList.safeParse(branches.items);
      if (!parsed.success)
        throw new AppError(
          502,
          'GitHub answered a branch list that cannot be read',
          'GITHUB_UNAVAILABLE',
        );
      const rows = await prisma.githubBranch.findMany({ where: { repoLinkId } });
      const byName = new Map(rows.map((row) => [row.name, row]));
      for (const { name, commit } of parsed.data) {
        const known = byName.get(name);
        if (known && !known.deletedAt && known.headSha === commit.sha) continue;
        if (!known && extractIssueNumbers(name, link.project.prefix).length === 0) continue;
        try {
          await storeBranch(repoLinkId, { name, sha: commit.sha }, null, 'reconcile');
          result.branches++;
        } catch (err) {
          itemFailed('branch', err);
        }
      }
      if (branches.complete) {
        const listed = new Set(parsed.data.map((b) => b.name));
        const linked = new Set(
          (
            await prisma.githubIssueLink.findMany({
              where: { repoLinkId, targetType: 'BRANCH' },
              select: { targetKey: true },
            })
          ).map((l) => l.targetKey),
        );
        for (const row of rows) {
          if (row.deletedAt || listed.has(row.name) || !linked.has(row.id)) continue;
          try {
            await storeBranch(repoLinkId, { name: row.name, sha: null }, null, 'reconcile', {
              at: new Date(),
            });
            result.branches++;
          } catch (err) {
            itemFailed('branch', err);
          }
        }
      }
    }
    return result;
  } catch (err) {
    failure.message = err instanceof AppError ? err.message : 'The reconcile failed';
    throw err;
  } finally {
    // The lease is cleared on every exit; a crash leaves it to run out
    await prisma.githubRepoLink.updateMany({
      where: { id: repoLinkId },
      data: {
        lastReconciledAt: new Date(),
        lastReconcileError: failure.message ? failure.message.slice(0, ERROR_MAX) : null,
        reconcileLeaseUntil: null,
      },
    });
  }
}

/**
 * The links that are due: never reconciled or last reconciled over 15 minutes ago, with no live
 * lease. Never-reconciled links come first, then the longest waiting.
 * @param limit The most to return
 */
export async function dueRepoLinkIds(limit: number): Promise<string[]> {
  const now = new Date();
  const rows = await prisma.githubRepoLink.findMany({
    where: {
      OR: [
        { lastReconciledAt: null },
        { lastReconciledAt: { lt: new Date(now.getTime() - RECONCILE_INTERVAL_MS) } },
      ],
      AND: [{ OR: [{ reconcileLeaseUntil: null }, { reconcileLeaseUntil: { lt: now } }] }],
    },
    orderBy: { lastReconciledAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * Reconciles the links that are due, one after the other. A failure is recorded on its link and
 * does not stop the others.
 * @param limit The most links to reconcile in one round
 * @returns How many it reconciled (or tried)
 */
export async function reconcileDueRepos(limit = 5): Promise<number> {
  const ids = await dueRepoLinkIds(limit);
  for (const id of ids) {
    try {
      await reconcileRepo(id);
    } catch (err) {
      // Recorded on the link; another run holding it is not a failure
      if (!(err instanceof AppError && err.statusCode === 409)) {
        logger.warn('github reconcile failed', { repoLinkId: id });
      }
    }
  }
  return ids.length;
}
