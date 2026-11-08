// The backfill: once import is switched on for a linked project, every open GitHub Issue of the
// repository is imported, a few at a time, by the worker. A run reads GitHub's open issues oldest
// first, a page of 100 after the other, and stores how far it got, so a worker that dies resumes
// from the stored page; an issue imported before is recognised by its import row and never made
// twice. The link comments go back to GitHub at their own pace (GitHub's secondary limit on
// content creation is what a large backfill runs into), and a rate limit pauses the run until the
// time GitHub gave.
import type { GithubImportRun, GithubRepoLink } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { publishRealtime } from '../../realtime/bridge';
import { logger } from '../../utils/logger';

import { githubRequest, outsideGithubCallCount, type GithubAuth } from './github-client';
import { importCapState } from './import-cap';
import {
  importGithubIssue,
  pendingLinkCommentIds,
  postLinkComment,
  type GithubIssuePayload,
} from './issue-import.service';

/**
 * How fast a backfill goes: new issues imported per tick of the worker (one every 15 s), and link
 * comments posted per minute and link. The live imports of webhooks have their own hourly cap
 * (LIVE_IMPORT_CAP) and do not share this pace.
 */
export const IMPORT_PACE = { issuesPerTick: 25, linkCommentsPerMinute: 20 } as const;

/** The states of a run that is not over: at most one of them per link */
export const ACTIVE_IMPORT_RUN = ['QUEUED', 'RUNNING', 'PAUSED'] as const;

/** How long a tick holds its run; a worker that dies frees it when this runs out */
const LEASE_MS = 2 * 60_000;
const PER_PAGE = 100;
/** The most pages one tick reads; pages of issues imported before cost one call each */
const PAGES_PER_TICK = 5;
/** How long a run waits after GitHub failed in a way that may pass */
const RETRY_AFTER_FAILURE_MS = 60_000;
/** When GitHub's rate limit names no time */
const DEFAULT_RETRY_SECONDS = 60;
const MINUTE_MS = 60_000;

// The passes of a run (GithubImportRun.pass)
const FIRST_PASS = 1;
const SWEEP_PASS = 2;
const PAGES_READ = 3;

const installation = (link: Pick<GithubRepoLink, 'installationId'>): GithubAuth => ({
  kind: 'installation',
  installationId: Number(link.installationId),
});

const isRateLimited = (err: unknown): err is AppError =>
  err instanceof AppError && err.code === 'GITHUB_RATE_LIMITED';

// GitHub will not show this repository's issues to the App again by asking again
const isPermanent = (err: unknown) =>
  err instanceof AppError &&
  (err.code === 'GITHUB_NOT_FOUND' ||
    err.code === 'GITHUB_GONE' ||
    err.code === 'GITHUB_FORBIDDEN');

const retryAfterMs = (err: AppError) => {
  const seconds = Number(err.details?.retryAfterSeconds);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_SECONDS) * 1000;
};

/** A run's progress, as the status action and the settings page show it */
export type ImportRunView = Pick<
  GithubImportRun,
  'status' | 'total' | 'done' | 'failed' | 'startedAt' | 'finishedAt' | 'error'
>;

/**
 * Tells the project room that a run moved on. Sent from the worker through the Redis bridge.
 * @param projectId The project
 * @param runId The run
 */
function broadcastProgress(projectId: string, runId: string): void {
  publishRealtime(`project:${projectId}`, { type: 'github:import-progress', projectId, runId });
}

/** What a tick learned, written to the run when it lets go */
type TickState = {
  total: number | null;
  done: number;
  failed: number;
  nextPage: number;
  pass: number;
  doneBeforePage: number;
  failedNumbers: number[];
};

/**
 * One tick of a backfill: takes the run's lease (2 minutes, pushed out as it goes), imports up to
 * {@link IMPORT_PACE}.issuesPerTick new open issues from the stored page on, then posts the link
 * comments the link still owes within the pace. A page is left once every issue on it was dealt
 * with. When the pages are read the run reads them once more (issues move to an earlier page when
 * others close), then finishes once no link comment is owed. GitHub's rate limit pauses the run
 * until the time GitHub gave; an issue that fails is counted and passed. Broadcasts the progress
 * to the project room after the tick. Does nothing when the run is not due or another tick holds
 * it.
 * @param runId The run
 */
export async function runImportTick(runId: string): Promise<void> {
  const now = new Date();
  let lease = new Date(now.getTime() + LEASE_MS);
  const { count } = await prisma.githubImportRun.updateMany({
    where: {
      id: runId,
      OR: [
        { status: 'QUEUED' },
        { status: 'RUNNING', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        { status: 'PAUSED', OR: [{ resumeAt: null }, { resumeAt: { lte: now } }] },
      ],
    },
    data: { status: 'RUNNING', leaseUntil: lease, resumeAt: null },
  });
  if (count === 0) return;
  const run = await prisma.githubImportRun.findUniqueOrThrow({
    where: { id: runId },
    include: { repoLink: true },
  });
  const link = run.repoLink;
  const firstStart = run.startedAt === null;
  if (firstStart) {
    await prisma.githubImportRun.update({ where: { id: runId }, data: { startedAt: now } });
  }

  const state: TickState = {
    total: run.total,
    done: run.done,
    failed: run.failed,
    nextPage: run.nextPage,
    pass: run.pass,
    doneBeforePage: run.doneBeforePage,
    failedNumbers: [...run.failedNumbers],
  };
  const progress = () => ({ ...state });

  // Pushes the lease out while it is still this tick's and the run was not cancelled
  const extend = async (): Promise<boolean> => {
    const next = new Date(Date.now() + LEASE_MS);
    const held = await prisma.githubImportRun.updateMany({
      where: { id: runId, status: 'RUNNING', leaseUntil: lease },
      data: { leaseUntil: next },
    });
    if (held.count === 0) return false;
    lease = next;
    return true;
  };
  // Lets go of the run: what the tick learned, and the run's next state when it has one
  const release = async (
    next: Partial<Pick<GithubImportRun, 'status' | 'resumeAt' | 'error' | 'finishedAt'>> = {},
  ) => {
    const data = { ...progress(), leaseUntil: null };
    const moved =
      Object.keys(next).length > 0
        ? await prisma.githubImportRun.updateMany({
            where: { id: runId, status: 'RUNNING', leaseUntil: lease },
            data: { ...data, ...next },
          })
        : { count: 0 };
    // Cancelled meanwhile (or nothing to change): keep the counts, leave the state as it is
    if (moved.count === 0) {
      await prisma.githubImportRun.updateMany({ where: { id: runId, leaseUntil: lease }, data });
    }
    broadcastProgress(link.projectId, runId);
  };

  if (!link.importIssues) {
    await release({ status: 'CANCELLED', finishedAt: new Date() });
    return;
  }

  try {
    const auth = installation(link);
    // Asked for until the first page is behind the run: a paused first tick asks again
    if (state.total === null && state.pass === FIRST_PASS && state.nextPage === 1) {
      state.total = await countOpenIssues(link, auth);
    }
    if (state.pass < PAGES_READ && !(await importPages(link, auth, state, extend))) {
      await release();
      return;
    }
    const posted = await postOwedLinkComments(link.id, extend);
    if (posted === 'lost') {
      await release();
      return;
    }
    if (state.pass === PAGES_READ) {
      const owed = await pendingLinkCommentIds(link.id, 1);
      // Link comments GitHub refused this tick for another reason than its limit are left to
      // the reconcile, which tries them every round: the run does not wait on them
      if (owed.length === 0 || posted === 'all-failed') {
        await release({ status: 'DONE', finishedAt: new Date(), error: null });
        return;
      }
    }
    await release({ error: null });
  } catch (err) {
    if (isRateLimited(err)) {
      await release({ status: 'PAUSED', resumeAt: new Date(Date.now() + retryAfterMs(err)) });
      return;
    }
    const message = err instanceof AppError ? err.message : 'The import failed';
    if (isPermanent(err)) {
      logger.warn('github import run failed', { runId, code: (err as AppError).code });
      await release({ status: 'FAILED', finishedAt: new Date(), error: message });
      return;
    }
    // GitHub away, a timeout, the App's credentials: tried again in a minute
    logger.warn('github import tick failed', {
      runId,
      error: err instanceof AppError ? err.code : 'unknown',
    });
    await release({
      status: 'PAUSED',
      resumeAt: new Date(Date.now() + RETRY_AFTER_FAILURE_MS),
      error: message,
    });
  }
}

/**
 * GitHub's count of the repository's open issues (pull requests left out), for the progress.
 * Search addresses the repository by name; a count that cannot be had is null.
 * @param link The link
 * @param auth The installation
 * @throws {AppError} GITHUB_RATE_LIMITED, which pauses the run
 */
async function countOpenIssues(link: GithubRepoLink, auth: GithubAuth): Promise<number | null> {
  try {
    const { data } = await githubRequest<{ total_count?: unknown }>(auth, 'GET', '/search/issues', {
      query: { q: `repo:${link.fullName} type:issue state:open`, per_page: 1 },
    });
    const total = Number(data?.total_count);
    return Number.isInteger(total) && total >= 0 ? total : null;
  } catch (err) {
    if (isRateLimited(err)) throw err;
    return null;
  }
}

type ListedIssue = GithubIssuePayload & { number?: unknown; pull_request?: unknown };

/**
 * Imports from the stored page on, up to the tick's share of new issues.
 * @param link The link
 * @param auth The installation
 * @param state The run's progress, moved on in place
 * @param extend Pushes the lease out; false when the run was lost or cancelled
 * @returns False when the run was lost or cancelled meanwhile
 */
async function importPages(
  link: GithubRepoLink,
  auth: GithubAuth,
  state: TickState,
  extend: () => Promise<boolean>,
): Promise<boolean> {
  let tried = 0;
  for (let pages = 0; pages < PAGES_PER_TICK && state.pass < PAGES_READ; pages++) {
    const { data, headers } = await githubRequest<unknown>(
      auth,
      'GET',
      `/repositories/${link.repoId}/issues`,
      {
        query: {
          state: 'open',
          per_page: PER_PAGE,
          sort: 'created',
          direction: 'asc',
          page: state.nextPage,
        },
      },
    );
    const listed = (Array.isArray(data) ? data : []) as ListedIssue[];
    const issues = listed.filter(
      (item) =>
        (item.pull_request === undefined || item.pull_request === null) &&
        Number.isInteger(item.number),
    );
    const numbers = issues.map((item) => Number(item.number));
    const known = new Set(
      (
        await prisma.githubIssueImport.findMany({
          where: { repoLinkId: link.id, githubIssueNumber: { in: numbers } },
          select: { githubIssueNumber: true },
        })
      ).map((row) => row.githubIssueNumber),
    );

    let full = false;
    let made = 0;
    for (const item of issues) {
      const number = Number(item.number);
      if (known.has(number) || state.failedNumbers.includes(number)) continue;
      if (tried >= IMPORT_PACE.issuesPerTick) {
        full = true;
        break;
      }
      tried++;
      if (!(await extend())) {
        countPage(state, numbers, known, made);
        return false;
      }
      try {
        // Rules stay off (an old issue sets off nothing), comments are not capped like a
        // stranger's, and the link comment waits for the pace below
        const result = await importGithubIssue(link, item, {
          withComments: true,
          linkComment: false,
        });
        if (result) {
          known.add(number);
          made++;
        }
      } catch (err) {
        if (isRateLimited(err)) {
          // An issue made before its comments were read counts; the reconcile reads the rest
          if (await importedNow(link.id, number)) known.add(number);
          countPage(state, numbers, known, made);
          throw err;
        }
        if (await importedNow(link.id, number)) {
          // Made, but something after it failed: it is in Axiom, and its comments and link
          // comment are finished by the reconcile and below
          known.add(number);
          made++;
        } else {
          state.failedNumbers.push(number);
          state.failed++;
        }
        logger.warn('github backfill issue failed', {
          repoLinkId: link.id,
          githubIssueNumber: number,
          error: err instanceof AppError ? err.code : 'unknown',
        });
      }
    }
    countPage(state, numbers, known, made);
    if (full) return true;

    // Every issue of the page was dealt with
    const last = listed.length < PER_PAGE || !/rel="next"/.test(headers.get('link') ?? '');
    if (state.pass === FIRST_PASS) state.doneBeforePage = state.done;
    // The sweep counts the pages it finished on the side, and that count is `done` at its end
    else state.doneBeforePage += numbers.filter((n) => known.has(n)).length;
    if (!last) {
      state.nextPage++;
    } else if (state.pass === FIRST_PASS && state.nextPage > 1) {
      // Issues that closed on a page read before moved later ones onto it: one more read finds them
      state.pass = SWEEP_PASS;
      state.nextPage = 1;
      state.doneBeforePage = 0;
    } else {
      if (state.pass === SWEEP_PASS) state.done = state.doneBeforePage;
      state.pass = PAGES_READ;
    }
  }
  return true;
}

/**
 * Brings `done` up to date after a page was worked on. In the first pass it is the pages before
 * plus the issues of this page that are in Axiom, counted from the import rows, so a resumed run
 * counts nothing twice. In the sweep the issues it made are added, until its end sets `done` to
 * the open issues it found in Axiom (an issue that moved between pages in the first pass may have
 * been counted on neither).
 * @param state The run's progress
 * @param numbers The page's issue numbers
 * @param known Those that have an import row now
 * @param made How many this tick made on the page
 */
function countPage(state: TickState, numbers: number[], known: Set<number>, made: number): void {
  if (state.pass === FIRST_PASS) {
    state.done = state.doneBeforePage + numbers.filter((n) => known.has(n)).length;
  } else {
    state.done += made;
  }
}

const importedNow = async (repoLinkId: string, githubIssueNumber: number) =>
  (await prisma.githubIssueImport.findUnique({
    where: { repoLinkId_githubIssueNumber: { repoLinkId, githubIssueNumber } },
    select: { id: true },
  })) !== null;

/**
 * Posts the link comments the link owes (the backfill's and any a live import left), within
 * {@link IMPORT_PACE}.linkCommentsPerMinute. A claim made in the last minute, by this run or by a
 * live import, counts against it.
 * @param repoLinkId The link
 * @param extend Pushes the lease out; false when the run was lost or cancelled
 * @returns `lost` when the run was lost or cancelled meanwhile, `all-failed` when every post
 *   tried failed
 * @throws {AppError} GITHUB_RATE_LIMITED, which pauses the run; the comment GitHub refused is
 *   posted on resume, after a look for one that may have been made
 */
async function postOwedLinkComments(
  repoLinkId: string,
  extend: () => Promise<boolean>,
): Promise<'lost' | 'all-failed' | 'ok'> {
  const recent = await prisma.githubIssueImport.count({
    where: { repoLinkId, linkCommentClaimedAt: { gte: new Date(Date.now() - MINUTE_MS) } },
  });
  const ids = await pendingLinkCommentIds(repoLinkId, IMPORT_PACE.linkCommentsPerMinute - recent);
  let failed = 0;
  for (const id of ids) {
    if (!(await extend())) return 'lost';
    try {
      // A system write, as the App: never counted against a run's budget
      await outsideGithubCallCount(() => postLinkComment(id));
    } catch (err) {
      if (isRateLimited(err)) throw err;
      failed++;
      logger.warn('github backfill link comment failed', {
        importId: id,
        error: err instanceof AppError ? err.code : 'unknown',
      });
    }
  }
  return ids.length > 0 && failed === ids.length ? 'all-failed' : 'ok';
}

/**
 * Ticks the runs that are due: queued, running without a live lease (its worker died), or paused
 * past the time it waits for. One after the other; a failure of one is logged and the next goes.
 * @param limit The most runs to tick
 * @returns How many were ticked
 */
export async function runDueImports(limit = 5): Promise<number> {
  const now = new Date();
  const due = await prisma.githubImportRun.findMany({
    where: {
      OR: [
        { status: 'QUEUED' },
        { status: 'RUNNING', OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
        { status: 'PAUSED', OR: [{ resumeAt: null }, { resumeAt: { lte: now } }] },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  for (const { id } of due) {
    try {
      await runImportTick(id);
    } catch (err) {
      logger.error('github import tick failed', { runId: id }, err as Error);
    }
  }
  return due.length;
}

const viewOf = (run: GithubImportRun): ImportRunView => ({
  status: run.status,
  total: run.total,
  done: run.done,
  failed: run.failed,
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  error: run.error,
});

/**
 * Switches the import of a linked project's GitHub Issues on or off. On queues a backfill unless
 * one is under way; off cancels it. Issues imported so far stay either way.
 * @param userId Who switches it
 * @param projectId The project
 * @param enabled On or off
 * @throws {AppError} 404 when the project is not linked to a GitHub repository
 */
export async function configureImport(
  userId: string,
  projectId: string,
  enabled: boolean,
): Promise<{ enabled: boolean; run: ImportRunView | null }> {
  const { linkId, run } = await prisma.$transaction(async (tx) => {
    // The link row is the lock: two calls at once queue one run (imports writing rows that
    // reference the link are not held up by it)
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM github_repo_links WHERE "projectId" = ${projectId} FOR NO KEY UPDATE`;
    if (!locked) {
      throw new AppError(404, 'This project is not linked to a GitHub repository', 'NOT_FOUND');
    }
    await tx.githubRepoLink.update({ where: { id: locked.id }, data: { importIssues: enabled } });
    const active = await tx.githubImportRun.findFirst({
      where: { repoLinkId: locked.id, status: { in: [...ACTIVE_IMPORT_RUN] } },
      orderBy: { createdAt: 'desc' },
    });
    if (enabled) {
      return {
        linkId: locked.id,
        run:
          active ??
          (await tx.githubImportRun.create({
            data: { repoLinkId: locked.id, requestedById: userId },
          })),
      };
    }
    await tx.githubImportRun.updateMany({
      where: { repoLinkId: locked.id, status: { in: [...ACTIVE_IMPORT_RUN] } },
      // The lease stays: a tick under way still writes its counts when it lets go
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    const last = await tx.githubImportRun.findFirst({
      where: { repoLinkId: locked.id },
      orderBy: { createdAt: 'desc' },
    });
    return { linkId: locked.id, run: last };
  });
  if (run) broadcastProgress(projectId, run.id);
  logger.info('github import configured', { repoLinkId: linkId, enabled });
  return { enabled, run: run ? viewOf(run) : null };
}

/**
 * Whether a linked project imports its GitHub Issues, how its latest backfill stands, and whether
 * the hourly cap on live imports holds them back. Not linked: off, with nothing to show.
 * @param projectId The project
 */
export async function importStatus(projectId: string): Promise<{
  enabled: boolean;
  run: ImportRunView | null;
  liveCap: { paused: boolean; resumesAt: Date | null } | null;
}> {
  const link = await prisma.githubRepoLink.findUnique({
    where: { projectId },
    select: { id: true, importIssues: true },
  });
  if (!link) return { enabled: false, run: null, liveCap: null };
  const run = await prisma.githubImportRun.findFirst({
    where: { repoLinkId: link.id },
    orderBy: { createdAt: 'desc' },
  });
  const cap = await importCapState(link.id);
  return {
    enabled: link.importIssues,
    run: run ? viewOf(run) : null,
    liveCap: { paused: cap.paused, resumesAt: cap.resumesAt },
  };
}
