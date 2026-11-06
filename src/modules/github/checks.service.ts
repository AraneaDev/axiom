import type { GithubCheckRun, Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

import { githubRequest, githubTextTail, type GithubAuth } from './github-client';
import { reportOutcome, type GithubEventOutcome, type GithubTransition } from './github-outcomes';
import {
  clean,
  cutUtf8,
  httpsOr,
  lockLink,
  outcomeBase,
  retryOnRace,
  senderSchema,
  text,
  timestamp,
  touchLinkDelivery,
  type Sender,
} from './github-store';
import { drivesAutomation } from './issue-keys';
import { LOG_TAIL_LIMITS, logTail, plainText } from './log-tail';
import { onGithubEvent } from './webhook-dispatch';

/** The conclusions that make a check run a failure */
export const FAILED_CONCLUSIONS = ['failure', 'timed_out', 'startup_failure'];

/** The conclusions that count as passing: any other finished run keeps the commit pending */
const PASSING_CONCLUSIONS = ['success', 'neutral', 'skipped'];

/** The state of the check runs of a commit */
export type CheckState = 'pending' | 'failed' | 'passed' | 'none';

/** Why a log could not be had. The first two are final, the others are tried again */
export type LogUnavailableReason = 'not_found' | 'gone' | 'forbidden' | 'unavailable';

const ACTIONS_APP = 'github-actions';
const NAME_BYTES = 512;
const SLUG_BYTES = 128;
/** How long a log that could not be had for a passing reason is left alone */
export const LOG_RETRY_MS = 60 * 60_000;

type Client = Prisma.TransactionClient | typeof prisma;

const checkRunSchema = z.object({
  id: z.number().int().positive(),
  name: text,
  head_sha: text.pipe(z.string().min(1)),
  status: text,
  conclusion: text.nullish(),
  started_at: timestamp.nullish(),
  completed_at: timestamp.nullish(),
  html_url: z.string().nullish(),
  output: z
    .object({ title: text.nullish(), summary: text.nullish(), text: text.nullish() })
    .nullish(),
  app: z.object({ slug: text.nullish() }).nullish(),
});

/** GitHub's check run object, as far as it is read */
export type CheckRunPayload = z.input<typeof checkRunSchema>;

const jobSchema = z.object({
  run_id: z.number().int().nullish(),
  steps: z.array(z.object({ name: text, conclusion: z.string().nullish() })).nullish(),
});

type FailureDetails = {
  failedStep: string | null;
  workflowRunId: string | null;
  logTail: string | null;
  logTruncated: boolean;
  logUnavailable: boolean;
  logUnavailableReason: LogUnavailableReason | null;
  logCheckedAt: Date | null;
};

const isFailed = (conclusion: string | null | undefined) =>
  conclusion != null && FAILED_CONCLUSIONS.includes(conclusion);

// GitHub's ids grow with time: a larger one is a newer run (a re-run has a new id)
function newerId(a: string, b: string): boolean {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return BigInt(a) > BigInt(b);
  return a.length === b.length ? a > b : a.length > b.length;
}

type RunRow = {
  id: string;
  appSlug: string;
  name: string;
  status: string;
  conclusion: string | null;
};

/**
 * The state of a set of runs. Only the newest run of each app and name counts, since a re-run
 * replaces the run it repeats. Failed when any of them failed, else pending unless every one
 * has completed as `success`, `neutral` or `skipped`, else passed.
 * @param runs The runs of one commit
 */
function stateOfRuns(runs: RunRow[]): CheckState {
  if (runs.length === 0) return 'none';
  const newest = new Map<string, RunRow>();
  for (const run of runs) {
    const key = `${run.appSlug}\u0000${run.name}`;
    const seen = newest.get(key);
    if (!seen || newerId(run.id, seen.id)) newest.set(key, run);
  }
  const counted = [...newest.values()];
  if (counted.some((run) => isFailed(run.conclusion))) return 'failed';
  const passing = (run: RunRow) =>
    run.status === 'completed' &&
    run.conclusion !== null &&
    PASSING_CONCLUSIONS.includes(run.conclusion);
  return counted.every(passing) ? 'passed' : 'pending';
}

/**
 * The state of the check runs of a commit.
 * @param repoLinkId The repository link
 * @param headSha The commit
 * @param client A transaction, to read the state as that transaction sees it
 * @returns `failed` when the newest run of any app and name has a conclusion in
 *   `FAILED_CONCLUSIONS`; `passed` when every one of those completed as success, neutral or
 *   skipped; `pending` otherwise (a run still going, or cancelled, action_required, stale or a
 *   conclusion not known here); `none` when the commit has no runs
 */
export async function checkStateOf(
  repoLinkId: string,
  headSha: string,
  client: Client = prisma,
): Promise<CheckState> {
  const runs = await client.githubCheckRun.findMany({
    where: { repoLinkId, headSha },
    select: { id: true, appSlug: true, name: true, status: true, conclusion: true },
  });
  return stateOfRuns(runs);
}

// How far a run has come: a late payload for an earlier stage never takes it back
const rankOf = (status: string) => (status === 'completed' ? 2 : status === 'in_progress' ? 1 : 0);

const REASONS: Record<string, LogUnavailableReason> = {
  GITHUB_NOT_FOUND: 'not_found',
  GITHUB_GONE: 'gone',
  GITHUB_FORBIDDEN: 'forbidden',
  GITHUB_UNAVAILABLE: 'unavailable',
};

// Why GitHub cannot give the log, or undefined for an error that is not about the log (a rate
// limit, the App's own credentials): those throw, so the delivery is retried
function reasonOf(err: unknown): LogUnavailableReason | undefined {
  return err instanceof AppError && err.code ? REASONS[err.code] : undefined;
}

/**
 * The failed step and the end of the log of a GitHub Actions job. A check run of Actions has
 * the id of its job. A job or log that GitHub does not have (404, 410), will not give (403) or
 * cannot give now (5xx, timeout) is `logUnavailable` with the reason, not an error.
 * @param link The repository
 * @param link.owner
 * @param link.name
 * @param jobId The check run id, which is the job id
 * @param auth Who asks GitHub
 */
async function actionsDetails(
  link: { owner: string; name: string },
  jobId: number,
  auth: GithubAuth,
): Promise<FailureDetails> {
  const details: FailureDetails = {
    failedStep: null,
    workflowRunId: null,
    logTail: null,
    logTruncated: false,
    logUnavailable: false,
    logUnavailableReason: null,
    logCheckedAt: new Date(),
  };
  const jobPath = `/repos/${encodeURIComponent(link.owner)}/${encodeURIComponent(link.name)}/actions/jobs/${jobId}`;
  try {
    const { data } = await githubRequest<unknown>(auth, 'GET', jobPath);
    const job = jobSchema.safeParse(data);
    if (job.success) {
      const step = job.data.steps?.find((s) => s.conclusion === 'failure');
      details.failedStep = step ? cutUtf8(plainText(step.name), NAME_BYTES) : null;
      details.workflowRunId = job.data.run_id == null ? null : String(job.data.run_id);
    }
    const raw = await githubTextTail(auth, `${jobPath}/logs`, LOG_TAIL_LIMITS.downloadBytes);
    const tail = logTail(raw.text);
    details.logTail = tail.text === '' ? null : clean(tail.text);
    // `raw.truncated` is counted in bytes by the download: the log began before what was kept
    details.logTruncated = tail.truncated || raw.truncated;
  } catch (err) {
    const reason = reasonOf(err);
    if (!reason) throw err;
    details.logUnavailable = true;
    details.logUnavailableReason = reason;
  }
  return details;
}

/**
 * What an app other than Actions wrote: its output title and text stand for step and log.
 * @param run The check run
 */
function outputDetails(run: z.infer<typeof checkRunSchema>): FailureDetails {
  const { title, summary, text: body } = run.output ?? {};
  const tail = logTail(`${summary ?? ''}\n${body ?? ''}`.trim());
  return {
    failedStep: title ? cutUtf8(plainText(title), NAME_BYTES) : null,
    workflowRunId: null,
    logTail: tail.text === '' ? null : clean(tail.text),
    logTruncated: tail.truncated,
    logUnavailable: false,
    logUnavailableReason: null,
    logCheckedAt: null,
  };
}

const hasDetails = (row: GithubCheckRun) =>
  row.failedStep !== null || row.logTail !== null || row.logUnavailable;

// A log that could not be had for a passing reason is asked for again after an hour
function retryable(row: GithubCheckRun, now = Date.now()): boolean {
  if (!row.logUnavailable) return false;
  if (row.logUnavailableReason === 'not_found' || row.logUnavailableReason === 'gone') return false;
  return row.logCheckedAt === null || now - row.logCheckedAt.getTime() >= LOG_RETRY_MS;
}

/** Where a stored check run comes from, and what it was told of the event behind it */
export type CheckRunMeta = {
  action?: string | null;
  payload?: Record<string, unknown>;
  sender?: Sender;
  source?: GithubEventOutcome['source'];
  /** When the delivery arrived: the time of a payload that names none */
  at?: Date;
};

/**
 * Stores a check run and reports the outcome. A payload for a run that is further along, or the
 * same stage and older, changes nothing. The run is written first, and the transitions
 * (`checks_failed`, `checks_passed`) are decided in that transaction, under a lock on the commit,
 * so two runs stored together report a change of state once. For a newly failed run the failed
 * step and the end of the log are then fetched (Actions) and written to that row, only if it is
 * still the row that was stored; other apps' output is read from the payload. A log that could
 * not be had for a passing reason is asked for again by a later event, after an hour. The outcome
 * is reported once the fetch is over, also when it threw, so a retried delivery loses nothing.
 * @param repoLinkId The repository link
 * @param checkRun GitHub's check run object
 * @param auth Who asks GitHub for the job and its log
 * @param meta The event behind the change
 * @returns The stored run (the existing one for a stale payload; null when the link is gone), and the outcome
 */
export async function storeCheckRun(
  repoLinkId: string,
  checkRun: CheckRunPayload,
  auth: GithubAuth,
  meta: CheckRunMeta = {},
): Promise<{ row: GithubCheckRun | null; outcome: GithubEventOutcome; stale: boolean }> {
  const run = checkRunSchema.parse(checkRun);
  const id = String(run.id);
  const link = await prisma.githubRepoLink.findUnique({
    where: { id: repoLinkId },
    select: { projectId: true, owner: true, name: true, htmlUrl: true },
  });
  const base = await outcomeBase(
    repoLinkId,
    link,
    meta.sender ?? null,
    meta.source ?? 'webhook',
    { action: meta.action, payload: meta.payload },
    { event: 'check_run', action: null },
  );
  const gone = {
    row: null,
    stale: true,
    outcome: { ...base, event: 'check_run', transitions: [] as GithubTransition[] },
  };
  if (!link) return gone;

  const conclusion = run.conclusion ?? null;
  const failed = isFailed(conclusion);
  const isActions = (run.app?.slug ?? '') === ACTIONS_APP;
  const at = run.completed_at
    ? new Date(run.completed_at)
    : run.started_at
      ? new Date(run.started_at)
      : (meta.at ?? new Date());
  const superseded = (before: GithubCheckRun | null) =>
    before !== null &&
    (rankOf(run.status) < rankOf(before.status) ||
      (rankOf(run.status) === rankOf(before.status) && at < before.githubUpdatedAt));

  const stored = await retryOnRace(() =>
    prisma.$transaction(async (tx) => {
      if (!(await lockLink(tx, repoLinkId))) return null;
      // Runs of one commit are stored one at a time, so each sees the state the last one left
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${repoLinkId}:${run.head_sha}`}, 0))`;
      const before = await tx.githubCheckRun.findUnique({ where: { id } });
      if (superseded(before)) return { row: before, stale: true, transitions: [], fetch: false };

      // A repeated failure keeps what is stored of its log; another app's output is in the payload
      const same = before && failed && before.conclusion === conclusion ? before : null;
      const own = failed && !isActions ? outputDetails(run) : null;
      const fetch = failed && isActions && (!same || !hasDetails(same) || retryable(same));
      const data = {
        repoLinkId,
        headSha: run.head_sha,
        name: cutUtf8(plainText(run.name), NAME_BYTES),
        appSlug: cutUtf8(plainText(run.app?.slug ?? ''), SLUG_BYTES),
        workflowRunId: own?.workflowRunId ?? same?.workflowRunId ?? null,
        status: run.status,
        conclusion,
        htmlUrl: httpsOr(
          run.html_url ?? '',
          `${httpsOr(link.htmlUrl, `https://github.com/${link.owner}/${link.name}`)}/runs/${id}`,
        ),
        startedAt: run.started_at ? new Date(run.started_at) : null,
        completedAt: run.completed_at ? new Date(run.completed_at) : null,
        failedStep: own ? own.failedStep : (same?.failedStep ?? null),
        logTail: own ? own.logTail : (same?.logTail ?? null),
        logTruncated: own ? own.logTruncated : (same?.logTruncated ?? false),
        logUnavailable: same?.logUnavailable ?? false,
        logUnavailableReason: same?.logUnavailableReason ?? null,
        logCheckedAt: same?.logCheckedAt ?? null,
        githubUpdatedAt: at,
      };
      const stateBefore = await checkStateOf(repoLinkId, run.head_sha, tx);
      const row = await tx.githubCheckRun.upsert({
        where: { id },
        create: { id, ...data },
        update: data,
      });
      const stateAfter = await checkStateOf(repoLinkId, run.head_sha, tx);
      const transitions: GithubTransition[] = [];
      if (stateAfter === 'failed' && stateBefore !== 'failed') transitions.push('checks_failed');
      if (stateAfter === 'passed' && stateBefore !== 'passed') transitions.push('checks_passed');

      // Read with the write, so a failure to read them cannot lose the transition
      const pullRequests = await tx.githubPullRequest.findMany({
        where: { repoLinkId, headSha: run.head_sha },
        select: { id: true },
        orderBy: { number: 'asc' },
      });
      const links =
        pullRequests.length === 0
          ? []
          : await tx.githubIssueLink.findMany({
              where: {
                repoLinkId,
                targetType: 'PULL_REQUEST',
                targetKey: { in: pullRequests.map((pr) => pr.id) },
              },
              select: { issueId: true, sources: true },
            });
      return { row, stale: false, transitions, fetch, pullRequests, links };
    }),
  );
  if (!stored) return gone;

  let row = stored.row;
  let fetchError: unknown = null;
  if (stored.fetch && row) {
    try {
      const details = await actionsDetails(link, run.id, auth);
      // Only if the row is still the one stored above: a newer payload keeps its own state
      const { count } = await prisma.githubCheckRun.updateMany({
        where: { id, conclusion, status: 'completed', githubUpdatedAt: row.githubUpdatedAt },
        data: {
          failedStep: details.failedStep ?? row.failedStep,
          workflowRunId: details.workflowRunId ?? row.workflowRunId,
          logTail: details.logTail,
          logTruncated: details.logTruncated,
          logUnavailable: details.logUnavailable,
          logUnavailableReason: details.logUnavailableReason,
          logCheckedAt: details.logCheckedAt,
        },
      });
      if (count > 0) row = (await prisma.githubCheckRun.findUnique({ where: { id } })) ?? row;
    } catch (err) {
      fetchError = err;
    }
  }

  const links = stored.links ?? [];
  const outcome: GithubEventOutcome = {
    ...base,
    event: 'check_run',
    headSha: run.head_sha,
    pullRequestId: stored.pullRequests?.[0]?.id,
    linkedIssueIds: [...new Set(links.map((l) => l.issueId))],
    drivingIssueIds: [
      ...new Set(links.filter((l) => drivesAutomation(l.sources)).map((l) => l.issueId)),
    ],
    transitions: stored.transitions,
  };
  if (!stored.stale) await reportOutcome(outcome);
  if (fetchError) throw fetchError;
  return { row, outcome, stale: stored.stale };
}

/**
 * Stores a check run with the failed step and the end of its log, and reports it to the listeners.
 * @param repoLinkId The repository link
 * @param run GitHub's check run object
 * @param auth Who asks GitHub for the job and its log
 * @returns The stored run
 * @throws {AppError} 404 when the repository link is gone
 */
export async function recordCheckRun(
  repoLinkId: string,
  run: CheckRunPayload,
  auth: GithubAuth,
): Promise<GithubCheckRun> {
  const { row } = await storeCheckRun(repoLinkId, run, auth);
  if (!row) throw new AppError(404, 'The repository is not linked', 'GITHUB_LINK_GONE');
  return row;
}

const CHECK_ACTIONS = new Set(['created', 'completed', 'rerequested']);
const checkRunEventSchema = z.object({ check_run: checkRunSchema });

onGithubEvent('check_run', async (d) => {
  if (!d.action || !CHECK_ACTIONS.has(d.action)) return 'ignored';
  if (!checkRunEventSchema.safeParse(d.payload).success) return 'ignored';
  const link = await touchLinkDelivery(d);
  if (!link) return 'ignored';
  await storeCheckRun(
    link.id,
    d.payload.check_run as CheckRunPayload,
    { kind: 'installation', installationId: Number(link.installationId) },
    {
      action: d.action,
      payload: d.payload,
      sender: senderSchema.parse(d.payload.sender),
      source: 'webhook',
      at: d.receivedAt,
    },
  );
  return 'processed';
});
