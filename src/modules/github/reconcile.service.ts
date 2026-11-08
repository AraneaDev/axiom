// Reads each linked repository from GitHub every 15 minutes and stores what the webhooks missed
// (a burst answered 429 is never redelivered). Every record goes through the same stores as a
// webhook, so a missed merge still reports `pr_merged` once, and a log that could not be had is
// asked for again within its one-hour limit.
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

import { isFailed, storeCheckRun, type CheckRunPayload } from './checks.service';
import { repoPath } from './github-actions.helpers';
import {
  GITHUB_CALL_LIMIT,
  countGithubCalls,
  githubPaginate,
  githubRequest,
  outsideGithubCallCount,
  type GithubAuth,
} from './github-client';
import { storeBranch, storePullRequest, type PullRequestPayload } from './github-events';
import { ImportCappedError } from './import-cap';
import {
  importComment,
  importGithubIssue,
  postPendingLinkComments,
  type GithubCommentPayload,
  type GithubIssuePayload,
} from './issue-import.service';
import { extractIssueNumbers } from './issue-keys';

export const RECONCILE_INTERVAL_MS = 15 * 60_000;
const repoFacts = z.object({
  id: z.number(),
  name: z.string().min(1),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
  owner: z.object({ login: z.string().min(1) }),
});

export const RECONCILE_CALL_BUDGET = 300;
const LEASE_MS = 10 * 60_000;
// Inside a long loop the lease is pushed out after this many records or this much time
const LEASE_EVERY_RECORDS = 10;
const LEASE_EVERY_MS = 60_000;
/** Where the import catch-up starts for a link with no cursor yet: an hour of cap pause and more */
const IMPORT_LOOKBACK_FIRST_MS = 2 * 60 * 60_000;
/** The furthest back it reads: GitHub's redelivery window; older belongs to the backfill */
const IMPORT_LOOKBACK_MAX_MS = 72 * 60 * 60_000;
// A pull request GitHub answers 404 this many times in a row is taken for gone
const MISSES_BEFORE_CLOSING = 3;
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
  /** Why not everything was read, or null */
  reason: string | null;
};

const branchList = z.array(
  z.object({ name: z.string().min(1), commit: z.object({ sha: z.string().min(1) }) }),
);
const prHead = z.object({
  number: z.number().int(),
  updated_at: z.string(),
  head: z.object({ sha: z.string() }),
});

const LEASE_LOST = 'GITHUB_RECONCILE_LEASE_LOST';

/**
 * Claims the right to reconcile a link with one conditional update, writing a token that only
 * this run holds.
 * @param repoLinkId The link
 * @param token This run's token
 * @throws {AppError} 404 when the link is gone, 409 GITHUB_RECONCILE_RUNNING while another run holds the lease
 */
async function claimLease(repoLinkId: string, token: string): Promise<void> {
  const now = new Date();
  const claim = await prisma.githubRepoLink.updateMany({
    where: {
      id: repoLinkId,
      OR: [{ reconcileLeaseUntil: null }, { reconcileLeaseUntil: { lt: now } }],
    },
    data: {
      reconcileLeaseUntil: new Date(now.getTime() + LEASE_MS),
      reconcileLeaseToken: token,
    },
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
 * Pushes the lease out again, but only while it is still this run's.
 * @param repoLinkId The link
 * @param token This run's token
 * @throws {AppError} 409 GITHUB_RECONCILE_LEASE_LOST when another run has taken the lease over
 */
async function extendLease(repoLinkId: string, token: string): Promise<void> {
  const { count } = await prisma.githubRepoLink.updateMany({
    where: { id: repoLinkId, reconcileLeaseToken: token },
    data: { reconcileLeaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  if (count === 0) {
    throw new AppError(409, 'The reconcile lost its lease to another run', LEASE_LOST);
  }
}

type StoredCheckRun = {
  status: string;
  conclusion: string | null;
  completedAt: Date | null;
  appSlug: string;
  logTail: string | null;
  logUnavailable: boolean;
  logUnavailableReason: string | null;
};

/**
 * Whether a check run is what is stored already, and needs nothing more: no change of status,
 * conclusion or time, and no log that is still to be fetched again.
 * @param stored The stored run
 * @param run GitHub's run
 */
function checkRunUnchanged(stored: StoredCheckRun, run: CheckRunPayload): boolean {
  const completed = run.completed_at ? Date.parse(run.completed_at) : null;
  if (
    stored.status !== run.status ||
    (stored.conclusion ?? null) !== (run.conclusion ?? null) ||
    (stored.completedAt?.getTime() ?? null) !== completed
  ) {
    return false;
  }
  if (
    stored.logUnavailable &&
    ['forbidden', 'unavailable'].includes(stored.logUnavailableReason ?? '')
  ) {
    return false;
  }
  // A failed Actions run whose log fetch never finished is still owed its failure details
  return !(
    isFailed(stored.conclusion) &&
    stored.appSlug === 'github-actions' &&
    stored.logTail === null &&
    !stored.logUnavailable
  );
}

/**
 * Reconciles one linked repository with GitHub, as its installation: the open pull requests, the
 * ones stored as open that GitHub no longer lists, the check runs at the head of each open pull
 * request, and the branches. Each phase has its own share of the call budget (branches always
 * get some), and a phase that fails ends alone. A list that was not read to its end never makes
 * a stored record look gone, and a branch written after its list was asked for is left alone.
 * Every GitHub request of the run counts against the budget, whoever makes it. The lease is
 * extended between phases and released only by the run that holds it.
 * @param repoLinkId The link
 * @param opts `callBudget` overrides the default budget
 * @param opts.callBudget
 * @returns What was stored, the GitHub calls made, and whether everything was read
 * @throws {AppError} 404 when the link is gone, 409 GITHUB_RECONCILE_RUNNING while another run holds it
 */
export async function reconcileRepo(
  repoLinkId: string,
  opts: { callBudget?: number } = {},
): Promise<ReconcileResult> {
  return (await claimReconcile(repoLinkId, opts))();
}

/**
 * Claims the lease of a link now and hands back the run, so a caller can answer 404 or 409 at
 * once and let the run carry on after its response. The returned function must be called: the
 * lease is released only by the run that holds it (or when it runs out).
 * @param repoLinkId The link
 * @param opts `callBudget` overrides the default budget
 * @param opts.callBudget
 * @returns The run, which resolves to what reconcileRepo resolves to
 * @throws {AppError} 404 when the link is gone, 409 GITHUB_RECONCILE_RUNNING while another run holds it
 */
export async function claimReconcile(
  repoLinkId: string,
  opts: { callBudget?: number } = {},
): Promise<() => Promise<ReconcileResult>> {
  const token = randomUUID();
  await claimLease(repoLinkId, token);
  return () => runReconcile(repoLinkId, token, opts);
}

async function runReconcile(
  repoLinkId: string,
  token: string,
  opts: { callBudget?: number },
): Promise<ReconcileResult> {
  const budget = opts.callBudget ?? RECONCILE_CALL_BUDGET;
  // The limit is hard: the client refuses the request that would be the one past the budget
  const counter = { calls: 0, limit: budget };
  const result: ReconcileResult = {
    pullRequests: 0,
    checkRuns: 0,
    branches: 0,
    calls: 0,
    complete: true,
    reason: null,
  };
  const failure: { message: string | null; reasons: string[] } = { message: null, reasons: [] };
  const isLimit = (err: unknown) => err instanceof AppError && err.code === GITHUB_CALL_LIMIT;
  const incomplete = (reason: string) => {
    result.complete = false;
    if (!failure.reasons.includes(reason)) failure.reasons.push(reason);
  };
  try {
    await countGithubCalls(counter, () => run());
    return result;
  } catch (err) {
    failure.message = err instanceof AppError ? err.message : 'The reconcile failed';
    throw err;
  } finally {
    result.calls = counter.calls;
    result.reason = failure.reasons.length ? failure.reasons.join('; ').slice(0, ERROR_MAX) : null;
    // Only the run that holds the lease records and releases it; a crashed run's lease runs out
    await prisma.githubRepoLink.updateMany({
      where: { id: repoLinkId, reconcileLeaseToken: token },
      data: {
        lastReconciledAt: new Date(),
        lastReconcileError: failure.message ? failure.message.slice(0, ERROR_MAX) : null,
        lastReconcileNote: result.reason,
        reconcileLeaseUntil: null,
        reconcileLeaseToken: null,
      },
    });
  }

  async function run(): Promise<void> {
    const link = await prisma.githubRepoLink.findUnique({
      where: { id: repoLinkId },
      select: {
        repoId: true,
        owner: true,
        name: true,
        installationId: true,
        project: { select: { prefix: true } },
      },
    });
    if (!link) throw new AppError(404, 'The repository is not linked', 'NOT_FOUND');
    const auth: GithubAuth = { kind: 'installation', installationId: Number(link.installationId) };
    const apiPath = repoPath(link);
    // The branches keep a share of the budget the earlier phases cannot spend
    const reserve = Math.floor(budget / 30);
    const left = (forBranches = false) => budget - counter.calls - (forBranches ? 0 : reserve);
    const itemFailed = (what: string, err: unknown) => {
      if (isLimit(err)) return incomplete('The call budget ran out');
      failure.message ??= err instanceof Error ? err.message : `${what} failed`;
      incomplete(`A ${what} could not be stored`);
      logger.warn('github reconcile item failed', { repoLinkId, what });
    };
    const phase = async (name: string, work: () => Promise<void>) => {
      await extendLease(repoLinkId, token);
      try {
        await work();
      } catch (err) {
        if (err instanceof AppError && err.code === LEASE_LOST) throw err;
        if (isLimit(err)) return incomplete('The call budget ran out');
        failure.message ??= err instanceof AppError ? err.message : `The ${name} could not be read`;
        incomplete(`The ${name} could not be read`);
        logger.warn('github reconcile phase failed', { repoLinkId, phase: name });
      }
    };
    // Keeps the lease through a long loop: every 10 records or 60 seconds
    const lease = () => {
      let records = 0;
      let last = Date.now();
      return async () => {
        records++;
        if (records < LEASE_EVERY_RECORDS && Date.now() - last < LEASE_EVERY_MS) return;
        records = 0;
        last = Date.now();
        await extendLease(repoLinkId, token);
      };
    };
    // One list: the pages it may still read
    const list = async <T>(
      path: string,
      maxPages: number,
      opts: { itemsKey?: string; forBranches?: boolean; cut: string },
    ) => {
      const pages = Math.min(maxPages, left(opts.forBranches));
      if (pages <= 0) {
        incomplete('The call budget ran out');
        return null;
      }
      const read = await githubPaginate<T>(auth, path, {
        maxPages: pages,
        itemsKey: opts.itemsKey,
      });
      if (!read.complete) incomplete(pages < maxPages ? 'The call budget ran out' : opts.cut);
      return read;
    };

    let returned: PullRequestPayload[] = [];
    let openComplete = false;
    const stored = new Map<number, { state: string; headSha: string; githubUpdatedAt: Date }>();

    await phase('open pull requests', async () => {
      const open = await list<PullRequestPayload>(`${apiPath}/pulls`, OPEN_PR_PAGES, {
        cut: `More than ${OPEN_PR_PAGES * 100} open pull requests: only the first ${OPEN_PR_PAGES * 100} were read`,
      });
      if (!open) return;
      returned = open.items;
      openComplete = open.complete;
      for (const row of await prisma.githubPullRequest.findMany({
        where: { repoLinkId },
        select: { number: true, state: true, headSha: true, githubUpdatedAt: true },
      })) {
        stored.set(row.number, row);
      }
      for (const payload of returned) {
        const head = prHead.safeParse(payload);
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
    });

    // Stored as open, not listed any more: closed or merged while no webhook arrived. Only a
    // list read to its end can say a pull request is missing from it. The ones asked about
    // least recently come first (never asked first), so a pull request that GitHub answers 404
    // goes to the back of the line; after three 404s in a row it is taken for gone and closed
    // quietly (housekeeping: no outcome is reported, nothing automates from it).
    if (openComplete) {
      await phase('closed pull requests', async () => {
        const listed = returned.flatMap((p) => {
          const head = prHead.safeParse(p);
          return head.success ? [head.data.number] : [];
        });
        const missing = await prisma.githubPullRequest.findMany({
          where: { repoLinkId, state: 'OPEN', number: { notIn: listed } },
          orderBy: [
            { reconcileCheckedAt: { sort: 'asc', nulls: 'first' } },
            { githubUpdatedAt: 'asc' },
          ],
          take: MISSING_PR_LIMIT,
          select: { id: true, number: true, reconcileMisses: true },
        });
        const keepLease = lease();
        for (const candidate of missing) {
          if (left() <= 0) {
            incomplete('The call budget ran out');
            break;
          }
          await keepLease();
          try {
            const { data } = await githubRequest<PullRequestPayload>(
              auth,
              'GET',
              `${apiPath}/pulls/${candidate.number}`,
            );
            await storePullRequest(repoLinkId, data, null, 'reconcile');
            await prisma.githubPullRequest.updateMany({
              where: { id: candidate.id },
              data: { reconcileCheckedAt: new Date(), reconcileMisses: 0 },
            });
            result.pullRequests++;
          } catch (err) {
            if (err instanceof AppError && err.statusCode === 404) {
              const misses = candidate.reconcileMisses + 1;
              await prisma.githubPullRequest.updateMany({
                where: { id: candidate.id, state: 'OPEN' },
                data: {
                  reconcileCheckedAt: new Date(),
                  reconcileMisses: misses,
                  ...(misses >= MISSES_BEFORE_CLOSING
                    ? { state: 'CLOSED' as const, closedAt: new Date() }
                    : {}),
                },
              });
              continue;
            }
            itemFailed('pull request', err);
          }
        }
      });
    }

    // Check runs at the head of each open pull request
    await phase('check runs', async () => {
      const heads = [
        ...new Set(returned.flatMap((p) => (prHead.safeParse(p).success ? [p.head.sha] : []))),
      ];
      for (const headSha of heads) {
        await extendLease(repoLinkId, token);
        const runs = await list<CheckRunPayload>(
          `${apiPath}/commits/${encodeURIComponent(headSha)}/check-runs`,
          CHECK_RUN_PAGES,
          { itemsKey: 'check_runs', cut: 'More check runs than were read' },
        );
        if (!runs) break;
        const known = new Map(
          (await prisma.githubCheckRun.findMany({ where: { repoLinkId, headSha } })).map((row) => [
            row.id,
            row,
          ]),
        );
        const keepLease = lease();
        for (const run of runs.items) {
          const row = known.get(String(run.id));
          if (row && checkRunUnchanged(row, run)) continue;
          await keepLease();
          // A failed run costs a job and a log request; stop when the budget cannot pay for it
          if (left() <= 0) {
            incomplete('The call budget ran out');
            return;
          }
          try {
            const { stale } = await storeCheckRun(repoLinkId, run, auth, { source: 'reconcile' });
            if (!stale) result.checkRuns++;
          } catch (err) {
            itemFailed('check run', err);
          }
        }
      }
    });

    // Branches: those that name an issue (or are stored already), and the linked ones GitHub lost
    await phase('branches', async () => {
      // Taken before the list is asked for: a row written later is newer than the list
      const observedAt = new Date();
      const branches = await list<unknown>(`${apiPath}/branches`, BRANCH_PAGES, {
        forBranches: true,
        cut: `More than ${BRANCH_PAGES * 100} branches: only the first ${BRANCH_PAGES * 100} were read`,
      });
      if (!branches) return;
      const parsed = branchList.safeParse(branches.items);
      if (!parsed.success) {
        throw new AppError(
          502,
          'GitHub answered a branch list that cannot be read',
          'GITHUB_UNAVAILABLE',
        );
      }
      const rows = await prisma.githubBranch.findMany({ where: { repoLinkId } });
      const byName = new Map(rows.map((row) => [row.name, row]));
      for (const { name, commit } of parsed.data) {
        const known = byName.get(name);
        if (known && !known.deletedAt && known.headSha === commit.sha) continue;
        if (!known && extractIssueNumbers(name, link.project.prefix).length === 0) continue;
        try {
          await storeBranch(repoLinkId, { name, sha: commit.sha }, null, 'reconcile', {
            observedAt,
          });
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
              observedAt,
            });
            result.branches++;
          } catch (err) {
            itemFailed('branch', err);
          }
        }
      }
    });

    // Live imports that the hourly cap (or an outage) turned away: the open issues and the
    // comments GitHub changed since the link's cursors, oldest first. A cursor moves past each item
    // that was dealt with, and stays where it is when the cap or the budget stops the round, so
    // the next round resumes there. Reads count against the budget (with the usual reserve for
    // the branches); the link comments these imports post are system writes outside it.
    const importing = await prisma.githubRepoLink.findUnique({ where: { id: repoLinkId } });
    if (importing?.importIssues && left() > 0) {
      await phase('GitHub issues', async () => {
        const tick = lease();
        const now = Date.now();
        // A list read to its end leaves its cursor here: a minute back covers a clock a little off
        const readAt = new Date(now - 60_000);
        const sinceOf = (cursor: Date | null) => {
          const floor = now - IMPORT_LOOKBACK_MAX_MS;
          const want = cursor ? cursor.getTime() : now - IMPORT_LOOKBACK_FIRST_MS;
          if (want >= floor) return new Date(want);
          incomplete('Changes older than 72 hours wait for their next update or the backfill');
          return new Date(floor);
        };
        const stopFor = (err: unknown) => {
          if (err instanceof ImportCappedError) incomplete('The hourly import cap was reached');
          else if (isLimit(err)) incomplete('The call budget ran out');
          else return false;
          return true;
        };
        // Reads one list from its cursor and hands each item on, moving the cursor past it;
        // true when it got through the whole list
        const catchUp = async (
          path: string,
          query: Record<string, string>,
          cursor: Date | null,
          field: 'importIssuesSeenAt' | 'importCommentsSeenAt',
          each: (item: Record<string, unknown>) => Promise<void>,
        ): Promise<boolean> => {
          if (left() <= 0) {
            incomplete('The call budget ran out');
            return false;
          }
          const since = sinceOf(cursor).toISOString();
          const list = await githubPaginate<Record<string, unknown>>(auth, path, {
            query: { ...query, sort: 'updated', direction: 'asc', since },
            maxPages: 2,
          });
          let seen = cursor;
          const move = async (to: Date) => {
            if (seen && to <= seen) return;
            seen = to;
            await prisma.githubRepoLink.updateMany({
              where: { id: repoLinkId },
              data: { [field]: to },
            });
          };
          for (const item of list.items) {
            if (left() <= 0) {
              incomplete('The call budget ran out');
              return false;
            }
            await tick();
            try {
              await each(item);
            } catch (err) {
              if (stopFor(err)) return false;
              // Anything else is passed: it comes back on its next update, and does not hold
              // every later item back
              itemFailed('GitHub issue or comment', err);
            }
            const at = Date.parse(String(item.updated_at ?? ''));
            if (!Number.isNaN(at)) await move(new Date(at));
          }
          if (!list.complete) return false;
          await move(readAt);
          return true;
        };

        await catchUp(
          `/repositories/${link.repoId}/issues`,
          { state: 'open' },
          importing.importIssuesSeenAt,
          'importIssuesSeenAt',
          async (item) => {
            if (item.pull_request) return;
            // Made after the link: the `opened` this stands in for would have run the rules
            const createdAt = Date.parse(String(item.created_at ?? ''));
            await importGithubIssue(importing, item as GithubIssuePayload, {
              withComments: true,
              live: true,
              runRules: { created: createdAt >= importing.createdAt.getTime(), updated: true },
            });
          },
        );
        await catchUp(
          `/repositories/${link.repoId}/issues/comments`,
          {},
          importing.importCommentsSeenAt,
          'importCommentsSeenAt',
          async (comment) => {
            const number = /\/issues\/(\d+)$/.exec(String(comment.issue_url ?? ''))?.[1];
            if (!number) return;
            const row = await prisma.githubIssueImport.findUnique({
              where: {
                repoLinkId_githubIssueNumber: { repoLinkId, githubIssueNumber: Number(number) },
              },
            });
            if (!row?.issueId) return;
            await importComment(row, comment as GithubCommentPayload, { live: true });
          },
        );
      });
    }

    // The repository itself, last so it only spends what the lists left: its default branch and
    // names follow a change on GitHub whose webhook was missed. A failure here costs nothing else.
    if (left(true) > 0) {
      try {
        const fresh = await githubRequest<unknown>(auth, 'GET', apiPath);
        const facts = repoFacts.safeParse(fresh.data);
        // Read by name: after a rename or a transfer the name may belong to another repository
        if (facts.success && BigInt(facts.data.id) === link.repoId) {
          await prisma.githubRepoLink.updateMany({
            where: { id: repoLinkId },
            data: {
              defaultBranch: facts.data.default_branch,
              fullName: facts.data.full_name,
              owner: facts.data.owner.login,
              name: facts.data.name,
            },
          });
        }
      } catch (err) {
        if (err instanceof AppError && err.code === LEASE_LOST) throw err;
        if (!isLimit(err))
          logger.warn('github reconcile repository refresh failed', { repoLinkId });
      }
    }

    // Imported issues still owed their link comment (a run died after its claim, and no event
    // came since). System writes, outside the budget: they never use up what the lists need.
    try {
      await outsideGithubCallCount(() => postPendingLinkComments(repoLinkId));
    } catch {
      logger.warn('github reconcile link comments failed', { repoLinkId });
    }
  }
}

/**
 * The links that are due: never reconciled or last reconciled over 15 minutes ago, with no live
 * lease. Never-reconciled links come first, then the longest waiting.
 * @param limit The most to return
 */
export async function dueRepoLinkIds(limit: number): Promise<string[]> {
  const now = new Date();
  // Links whose installation is unknown, removed or suspended would fail every round
  const usable = await prisma.githubInstallation.findMany({
    where: { removedAt: null, suspendedAt: null },
    select: { id: true },
  });
  const rows = await prisma.githubRepoLink.findMany({
    where: {
      installationId: { in: usable.map((i) => i.id) },
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
