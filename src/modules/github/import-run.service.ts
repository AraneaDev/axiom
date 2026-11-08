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
import { IMPORT_PACE, LINK_COMMENT_WINDOWS, importCapState } from './import-cap';
import {
  importGithubIssue,
  linkCommentWindowOpensAt,
  linkCommentsSince,
  pendingLinkCommentIds,
  postLinkComment,
  type GithubIssuePayload,
} from './issue-import.service';

// The pace lives beside the live cap, which postLinkComment shares the hourly ceiling with
export { IMPORT_PACE } from './import-cap';

/** The states of a run that is not over: at most one of them per link */
export const ACTIVE_IMPORT_RUN = ['QUEUED', 'RUNNING', 'PAUSED'] as const;

/** How long a tick holds its run; a worker that dies frees it when this runs out */
const LEASE_MS = 2 * 60_000;
const PER_PAGE = 100;
/** The most pages one tick reads; pages of issues imported before cost one call each */
const PAGES_PER_TICK = 5;
/** How long a run waits after its first failure that may pass; it doubles with each one after */
const RETRY_AFTER_FAILURE_MS = 60_000;
/** The longest wait after a failure: 10 failing ticks in a row then take hours, not minutes */
const MAX_RETRY_AFTER_FAILURE_MS = 30 * 60_000;
/**
 * The wait after the n-th failing tick in a row: 1, 2, 4, 8, 16, then 30 minutes.
 * @param errorTicks The failing ticks in a row, this one included
 */
const backoffMs = (errorTicks: number) =>
  Math.min(RETRY_AFTER_FAILURE_MS * 2 ** (errorTicks - 1), MAX_RETRY_AFTER_FAILURE_MS);
/** When GitHub's rate limit names no time */
const DEFAULT_RETRY_SECONDS = 60;
/** A window no longer than this only paces the ticks; a longer full one makes the run wait */
const TICK_SCALE_MS = 60_000;
/** Ticks in a row that fail with an error after which the run is FAILED */
const MAX_ERROR_TICKS = 10;
/** How long a run may go without moving on before it is FAILED */
const STALL_MS = 24 * 60 * 60_000;

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
  | 'status'
  | 'total'
  | 'done'
  | 'failed'
  | 'startedAt'
  | 'finishedAt'
  | 'error'
  | 'resumeAt'
  | 'linkCommentsWaitUntil'
>;

/**
 * Tells the project room that a run moved on. Sent from the worker through the Redis bridge.
 * @param projectId The project
 * @param runId The run
 */
function broadcastProgress(projectId: string, runId: string): void {
  publishRealtime(`project:${projectId}`, { type: 'github:import-progress', projectId, runId });
}

/** The state a tick moves a run to when it lets go */
type RunChange = Partial<
  Pick<
    GithubImportRun,
    | 'status'
    | 'resumeAt'
    | 'error'
    | 'finishedAt'
    | 'errorTicks'
    | 'progressAt'
    | 'linkCommentsWaitUntil'
  >
>;

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
  if (run.startedAt === null) {
    await prisma.githubImportRun.update({
      where: { id: runId },
      data: { startedAt: now, progressAt: now },
    });
  }
  const lastProgress = run.progressAt ?? run.startedAt ?? now;

  const state: TickState = {
    total: run.total,
    done: run.done,
    failed: run.failed,
    nextPage: run.nextPage,
    pass: run.pass,
    doneBeforePage: run.doneBeforePage,
    failedNumbers: [...run.failedNumbers],
  };
  const before = { ...state };
  let posted = 0;
  const movedOn = () =>
    posted > 0 ||
    state.done !== before.done ||
    state.nextPage !== before.nextPage ||
    state.pass !== before.pass;

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
  // Lets go of the run: what the tick learned, and the run's next state when it has one. A run
  // that has not moved on for a day is FAILED, whatever it waited for.
  const release = async (next: RunChange = {}) => {
    const data = { ...state, leaseUntil: null, ...(movedOn() && { progressAt: new Date() }) };
    const over = next.status === 'DONE' || next.status === 'FAILED' || next.status === 'CANCELLED';
    if (!over && !movedOn() && Date.now() - lastProgress.getTime() > STALL_MS) {
      next = {
        ...next,
        status: 'FAILED',
        finishedAt: new Date(),
        resumeAt: null,
        error: next.error ?? run.error ?? 'The import did not move on for a day',
      };
    }
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
    // Asked for until the first page is behind the run; never a reason to stop
    if (state.total === null && state.pass === FIRST_PASS && state.nextPage === 1) {
      state.total = await countOpenIssues(link, auth);
    }
    if (state.pass < PAGES_READ && !(await importPages(link, auth, state, extend))) {
      await release();
      return;
    }
    const comments = await postOwedLinkComments(link, extend);
    posted = comments.posted;
    if (comments.outcome === 'lost') {
      await release();
      return;
    }
    // While the link's hourly ceiling is reached only the link comments wait: the run goes on
    const fine = {
      error: null,
      errorTicks: 0,
      linkCommentsWaitUntil: comments.waitUntil,
    };
    if (state.pass === PAGES_READ) {
      // Done once nothing is owed; a comment GitHub refused five times is given up, not owed
      const owed = await pendingLinkCommentIds(link.id, 1);
      if (owed.length === 0) {
        await release({
          ...fine,
          linkCommentsWaitUntil: null,
          status: 'DONE',
          finishedAt: new Date(),
        });
        return;
      }
    }
    await release(fine);
  } catch (err) {
    if (isRateLimited(err)) {
      // A wait GitHub asked for, not a fault: the error of an earlier tick is cleared
      await release({
        status: 'PAUSED',
        resumeAt: new Date(Date.now() + retryAfterMs(err)),
        error: null,
      });
      return;
    }
    const message = err instanceof AppError ? err.message : 'The import failed';
    const errorTicks = run.errorTicks + 1;
    if (isPermanent(err) || errorTicks >= MAX_ERROR_TICKS) {
      logger.warn('github import run failed', {
        runId,
        error: err instanceof AppError ? err.code : 'unknown',
        errorTicks,
      });
      await release({ status: 'FAILED', finishedAt: new Date(), error: message, errorTicks });
      return;
    }
    // GitHub away, a timeout, the App's credentials: tried again later, waiting longer each time
    logger.warn('github import tick failed', {
      runId,
      error: err instanceof AppError ? err.code : 'unknown',
    });
    await release({
      status: 'PAUSED',
      resumeAt: new Date(Date.now() + backoffMs(errorTicks)),
      error: message,
      errorTicks,
    });
  }
}

/**
 * GitHub's count of the repository's open issues (pull requests left out), for the progress.
 * Search addresses the repository by name; a count that cannot be had, its rate limit included,
 * is null and never stops the run.
 * @param link The link
 * @param auth The installation
 */
async function countOpenIssues(link: GithubRepoLink, auth: GithubAuth): Promise<number | null> {
  try {
    const { data } = await githubRequest<{ total_count?: unknown }>(auth, 'GET', '/search/issues', {
      query: { q: `repo:${link.fullName} type:issue state:open`, per_page: 1 },
    });
    const total = Number(data?.total_count);
    return Number.isInteger(total) && total >= 0 ? total : null;
  } catch {
    // Search has limits of its own: the count is asked again on the next tick
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

type LinkCommentRound = {
  outcome: 'lost' | 'ok';
  posted: number;
  /** When the next one may go, while a full window that is longer than a tick holds them */
  waitUntil: Date | null;
};

/**
 * Posts the link comments the link owes (the backfill's and any a live import left), within each
 * window of LINK_COMMENT_WINDOWS: 20 a minute, which only the backfill keeps, and 400 an hour,
 * which every link comment of the installation counts against. A claim made in a window, by this run or
 * by a live import, counts in it. A full minute leaves the rest for a later tick; a full hour
 * holds them until it frees a place, and says when that is. The hour counts every link of the
 * installation.
 * @param link The link and its installation
 * @param extend Pushes the lease out; false when the run was lost or cancelled
 * @returns `lost` when the run was lost or cancelled meanwhile, else `ok`; how many went out, and
 *   until when the rest wait
 * @throws {AppError} GITHUB_RATE_LIMITED, which pauses the run; the comment GitHub refused is
 *   posted on resume, after a look for one that may have been made
 */
async function postOwedLinkComments(
  link: Pick<GithubRepoLink, 'id' | 'installationId'>,
  extend: () => Promise<boolean>,
): Promise<LinkCommentRound> {
  const repoLinkId = link.id;
  // The shared windows count the whole installation, as GitHub's limit does; the rest the link
  const scopeOf = (window: (typeof LINK_COMMENT_WINDOWS)[number]) =>
    window.shared ? { installationId: link.installationId } : { repoLinkId };
  let room = Infinity;
  let fullWindow: number | null = null;
  for (const window of LINK_COMMENT_WINDOWS) {
    const used = await linkCommentsSince(scopeOf(window), new Date(Date.now() - window.ms));
    const left = window.limit - used;
    if (left <= 0 && window.ms > TICK_SCALE_MS) fullWindow = Math.max(fullWindow ?? 0, window.ms);
    room = Math.min(room, Math.max(0, left));
  }
  let posted = 0;
  const owed = await pendingLinkCommentIds(repoLinkId, room === Infinity ? 1 : room);
  const held = async (ms: number): Promise<LinkCommentRound> => ({
    outcome: 'ok',
    posted,
    waitUntil: await linkCommentWindowOpensAt({ installationId: link.installationId }, ms),
  });
  if (fullWindow !== null) {
    return (await pendingLinkCommentIds(repoLinkId, 1)).length > 0
      ? held(fullWindow)
      : { outcome: 'ok', posted, waitUntil: null };
  }
  for (const id of owed) {
    if (!(await extend())) return { outcome: 'lost', posted, waitUntil: null };
    try {
      // A system write, as the App: never counted against a run's budget
      const outcome = await outsideGithubCallCount(() => postLinkComment(id));
      if (outcome === 'posted') posted++;
      // Live imports filled the hour meanwhile
      if (outcome === 'held') return held(longestSharedWindow());
    } catch (err) {
      if (isRateLimited(err)) throw err;
      logger.warn('github backfill link comment failed', {
        importId: id,
        error: err instanceof AppError ? err.code : 'unknown',
      });
    }
  }
  // This round may have filled the hour with more still owed: say until when they wait
  for (const window of LINK_COMMENT_WINDOWS) {
    if (window.ms <= TICK_SCALE_MS) continue;
    const used = await linkCommentsSince(scopeOf(window), new Date(Date.now() - window.ms));
    if (used >= window.limit && (await pendingLinkCommentIds(repoLinkId, 1)).length > 0) {
      return held(window.ms);
    }
  }
  return { outcome: 'ok', posted, waitUntil: null };
}

const longestSharedWindow = () =>
  Math.max(...LINK_COMMENT_WINDOWS.filter((w) => w.shared).map((w) => w.ms));

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
        {
          status: 'RUNNING',
          OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
          // With only link comments left, nothing to do until the hour frees a place
          AND: [
            {
              OR: [
                { pass: { not: PAGES_READ } },
                { linkCommentsWaitUntil: null },
                { linkCommentsWaitUntil: { lte: now } },
              ],
            },
          ],
        },
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
  resumeAt: run.resumeAt,
  linkCommentsWaitUntil: run.linkCommentsWaitUntil,
});

/**
 * Switches the import of a linked project's GitHub Issues on or off. On queues a backfill unless
 * one is under way, or import was on already and its last backfill is done; off cancels it.
 * Issues imported so far stay either way.
 * @param userId Who switches it
 * @param projectId The project
 * @param enabled On or off
 * @returns The state, the latest run, and whether a new run was queued
 * @throws {AppError} 404 when the project is not linked to a GitHub repository
 */
export async function configureImport(
  userId: string,
  projectId: string,
  enabled: boolean,
): Promise<{ enabled: boolean; queued: boolean; run: ImportRunView | null }> {
  const { linkId, run, queued } = await prisma.$transaction(async (tx) => {
    // The link row is the lock: two calls at once queue one run (imports writing rows that
    // reference the link are not held up by it)
    const [locked] = await tx.$queryRaw<{ id: string; importIssues: boolean }[]>`
      SELECT id, "importIssues" FROM github_repo_links WHERE "projectId" = ${projectId}
      FOR NO KEY UPDATE`;
    if (!locked) {
      throw new AppError(404, 'This project is not linked to a GitHub repository', 'NOT_FOUND');
    }
    await tx.githubRepoLink.update({ where: { id: locked.id }, data: { importIssues: enabled } });
    const latest = () =>
      tx.githubImportRun.findFirst({
        where: { repoLinkId: locked.id },
        orderBy: { createdAt: 'desc' },
      });
    if (enabled) {
      const last = await latest();
      const active = last && (ACTIVE_IMPORT_RUN as readonly string[]).includes(last.status);
      // On already, and the backfill went through: new issues come in live, nothing to redo
      if (active || (locked.importIssues && last?.status === 'DONE')) {
        return { linkId: locked.id, run: last, queued: false };
      }
      const created = await tx.githubImportRun.create({
        data: { repoLinkId: locked.id, requestedById: userId },
      });
      return { linkId: locked.id, run: created, queued: true };
    }
    await tx.githubImportRun.updateMany({
      where: { repoLinkId: locked.id, status: { in: [...ACTIVE_IMPORT_RUN] } },
      // The lease stays: a tick under way still writes its counts when it lets go
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
    return { linkId: locked.id, run: await latest(), queued: false };
  });
  if (run) broadcastProgress(projectId, run.id);
  logger.info('github import configured', { repoLinkId: linkId, enabled, queued });
  return { enabled, queued, run: run ? viewOf(run) : null };
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
