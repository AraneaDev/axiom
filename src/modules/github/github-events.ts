import { Prisma, type GithubPrState } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

import { resolveGithubActor, type GithubActor } from './github-actor';
import { drivesAutomation } from './issue-keys';
import { syncLinks, type LinkTarget, type SyncResult } from './issue-links.service';
import { findRepoLinkByRepoId } from './repo-link.service';
import { onGithubEvent, type GithubDeliveryContext } from './webhook-dispatch';

// ---- Outcomes

export type GithubTransition =
  | 'pr_opened'
  | 'pr_reopened'
  | 'pr_ready_for_review'
  | 'pr_merged'
  | 'pr_closed'
  | 'reviewers_added'
  | 'review_added'
  | 'branch_created'
  | 'checks_failed'
  | 'checks_passed';

/** What one stored change did, told to every listener once the change is committed */
export type GithubEventOutcome = {
  repoLinkId: string;
  projectId: string;
  event: string;
  action: string | null;
  source: 'webhook' | 'reconcile' | 'action';
  pullRequestId?: string;
  branchId?: string;
  headSha?: string;
  actor: GithubActor;
  /** The issues the changed branch, pull request or commits name now */
  linkedIssueIds: string[];
  /** The issues that stopped being named by this change (their development panel changed too) */
  removedIssueIds: string[];
  /** The linked issues named through a branch name or a PR title */
  drivingIssueIds: string[];
  transitions: GithubTransition[];
  payload: Record<string, unknown>;
};

type OutcomeListener = (outcome: GithubEventOutcome) => Promise<void>;
const listeners: OutcomeListener[] = [];

/**
 * Registers a listener for stored changes. Listeners run in registration order after the change
 * is committed. One that throws is logged (without the payload) and does not fail the delivery.
 * @param listener Told each outcome
 */
export function onGithubOutcome(listener: OutcomeListener): void {
  listeners.push(listener);
}

async function report(outcome: GithubEventOutcome): Promise<void> {
  for (const listener of listeners) {
    try {
      await listener(outcome);
    } catch (err) {
      logger.warn('github outcome listener failed', {
        repoLinkId: outcome.repoLinkId,
        event: outcome.event,
        action: outcome.action,
        error: err instanceof Error ? err.message : 'unknown',
      });
    }
  }
}

/** Where a store call comes from, and what it was told of the event behind it */
export type StoreMeta = {
  event?: string;
  action?: string | null;
  payload?: Record<string, unknown>;
  /** Issues the commits of the same push named: they join the outcome of the branch */
  commitLinks?: Pick<SyncResult, 'linked' | 'removed' | 'driving'>;
};

type Sender = { id: number; login: string } | null;

async function outcomeBase(
  repoLinkId: string,
  sender: Sender,
  source: GithubEventOutcome['source'],
  meta: StoreMeta,
  defaults: { event: string; action: string | null },
): Promise<Omit<GithubEventOutcome, 'transitions'>> {
  const link = await prisma.githubRepoLink.findUnique({
    where: { id: repoLinkId },
    select: { projectId: true },
  });
  return {
    repoLinkId,
    projectId: link?.projectId ?? '',
    event: meta.event ?? defaults.event,
    action: meta.action === undefined ? defaults.action : meta.action,
    source,
    actor: await resolveGithubActor(sender),
    linkedIssueIds: [],
    removedIssueIds: [],
    drivingIssueIds: [],
    payload: meta.payload ?? {},
  };
}

// The issues a target is linked to now, and those linked through a driving source
async function linksOf(repoLinkId: string, target: LinkTarget): Promise<SyncResult> {
  const rows = await prisma.githubIssueLink.findMany({
    where: { repoLinkId, targetType: target.type, targetKey: target.key },
    select: { issueId: true, sources: true },
  });
  return {
    added: [],
    removed: [],
    linked: rows.map((r) => r.issueId),
    driving: rows.filter((r) => drivesAutomation(r.sources)).map((r) => r.issueId),
  };
}

const union = (...lists: string[][]) => [...new Set(lists.flat())];

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

// Runs a store once more when two calls raced to create the same row and the other won
async function retryOnRace<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    return run();
  }
}

// ---- Text

/**
 * Cuts a text to at most a number of bytes of UTF-8 without splitting a character, and drops NUL
 * characters, which the database refuses.
 * @param text The text
 * @param maxBytes The most bytes to keep
 */
export function cutUtf8(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text.replaceAll('\u0000', ''), 'utf8');
  if (bytes.length <= maxBytes) return bytes.toString('utf8');
  let end = maxBytes;
  // A continuation byte (10xxxxxx) at the cut means the character straddles it: leave it out
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

const REVIEW_BODY_BYTES = 4096;
const COMMIT_MESSAGE_BYTES = 2048;

// ---- Payloads

const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'not a date');
const githubUser = z.object({ id: z.number().int(), login: z.string().min(1) });

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().nullish(),
  merged: z.boolean().nullish(),
  user: githubUser.nullish(),
  head: z.object({ ref: z.string(), sha: z.string() }),
  base: z.object({ ref: z.string() }),
  mergeable_state: z.string().nullish(),
  merge_commit_sha: z.string().nullish(),
  requested_reviewers: z.array(githubUser).nullish(),
  html_url: z.string(),
  created_at: timestamp,
  updated_at: timestamp,
  merged_at: timestamp.nullish(),
  closed_at: timestamp.nullish(),
});

/** GitHub's pull request object, as far as it is read */
export type PullRequestPayload = z.input<typeof pullRequestSchema>;

const reviewSchema = z.object({
  id: z.number().int(),
  user: githubUser.nullish(),
  state: z.string(),
  body: z.string().nullish(),
  commit_id: z.string(),
  submitted_at: timestamp.nullish(),
});

/** GitHub's pull request review object, as far as it is read */
export type ReviewPayload = z.input<typeof reviewSchema>;

const commitSchema = z.object({
  id: z.string().min(1),
  message: z.string(),
  timestamp,
  url: z.string(),
  author: z.object({ username: z.string().nullish() }).nullish(),
});

const senderSchema = githubUser.nullable().catch(null);

// ---- Branches

/**
 * Stores a branch: created or moved to a new head, or marked deleted. The branch name is synced
 * as the `BRANCH_NAME` of the branch's issue links, except for a deletion, which keeps them.
 * @param repoLinkId The repository link
 * @param branch The name and the head
 * @param branch.name The branch name
 * @param branch.sha Null marks the branch deleted; empty is a head not known yet (a `create`
 *   event carries none) and keeps the stored one
 * @param sender Who did it on GitHub
 * @param source What brought the change in
 * @param meta The event behind the change
 * @returns The outcome, which listeners were told after the commit
 */
export async function storeBranch(
  repoLinkId: string,
  branch: { name: string; sha: string | null },
  sender: Sender,
  source: GithubEventOutcome['source'],
  meta: StoreMeta = {},
): Promise<GithubEventOutcome> {
  const stored = await retryOnRace(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM github_branches WHERE "repoLinkId" = ${repoLinkId} AND name = ${branch.name} FOR UPDATE`;
      const before = await tx.githubBranch.findUnique({
        where: { repoLinkId_name: { repoLinkId, name: branch.name } },
      });
      if (branch.sha === null) {
        if (!before) return { row: null, created: false };
        const row = before.deletedAt
          ? before
          : await tx.githubBranch.update({
              where: { id: before.id },
              data: { deletedAt: new Date() },
            });
        return { row, created: false };
      }
      if (!before) {
        const row = await tx.githubBranch.create({
          data: { repoLinkId, name: branch.name, headSha: branch.sha },
        });
        return { row, created: true };
      }
      const row = await tx.githubBranch.update({
        where: { id: before.id },
        data: { headSha: branch.sha || before.headSha, deletedAt: null },
      });
      return { row, created: before.deletedAt !== null };
    }),
  );

  const base = await outcomeBase(repoLinkId, sender, source, meta, {
    event: branch.sha === null ? 'delete' : 'push',
    action: null,
  });
  const commit = meta.commitLinks ?? { linked: [], removed: [], driving: [] };
  let own: SyncResult = { added: [], removed: [], linked: [], driving: [] };
  if (stored.row) {
    const target: LinkTarget = { type: 'BRANCH', key: stored.row.id };
    own =
      branch.sha === null
        ? await linksOf(repoLinkId, target)
        : await syncLinks(repoLinkId, target, { BRANCH_NAME: branch.name });
  }
  const outcome: GithubEventOutcome = {
    ...base,
    branchId: stored.row?.id,
    headSha: stored.row?.headSha || undefined,
    linkedIssueIds: union(own.linked, commit.linked),
    removedIssueIds: union(own.removed, commit.removed),
    drivingIssueIds: union(own.driving, commit.driving),
    transitions: stored.created ? ['branch_created'] : [],
  };
  await report(outcome);
  return outcome;
}

// ---- Pull requests

const stateOf = (pr: z.infer<typeof pullRequestSchema>): GithubPrState => {
  if (pr.state === 'open') return 'OPEN';
  return pr.merged || pr.merged_at ? 'MERGED' : 'CLOSED';
};

type StoredReviewer = { login: string; userId?: string };

async function reviewersOf(pr: z.infer<typeof pullRequestSchema>): Promise<StoredReviewer[]> {
  const users = pr.requested_reviewers ?? [];
  if (users.length === 0) return [];
  const accounts = await prisma.githubAccount.findMany({
    where: { githubUserId: { in: users.map((u) => u.id) } },
    select: { githubUserId: true, userId: true },
  });
  const byId = new Map(accounts.map((a) => [Number(a.githubUserId), a.userId]));
  return users.map((u) => {
    const userId = byId.get(u.id);
    return userId ? { login: u.login, userId } : { login: u.login };
  });
}

function prTransitions(
  before: { state: GithubPrState; draft: boolean; requestedReviewers: unknown } | null,
  after: { state: GithubPrState; draft: boolean; requestedReviewers: unknown },
): GithubTransition[] {
  const logins = (value: unknown) =>
    new Set(((value as StoredReviewer[] | null) ?? []).map((r) => r.login));
  const out: GithubTransition[] = [];
  if (!before) out.push('pr_opened');
  else if (before.state !== after.state) {
    if (after.state === 'MERGED') out.push('pr_merged');
    else if (after.state === 'CLOSED') out.push('pr_closed');
    else out.push('pr_reopened');
  } else if (before.draft && !after.draft && after.state === 'OPEN') {
    out.push('pr_ready_for_review');
  }
  const known = logins(before?.requestedReviewers);
  if ([...logins(after.requestedReviewers)].some((login) => !known.has(login))) {
    out.push('reviewers_added');
  }
  return out;
}

/**
 * Stores a pull request and syncs its issue links (branch name, title and body). A payload
 * older than the stored `githubUpdatedAt` changes nothing. The row is locked while it is read
 * and written, so the transitions come from the row before and after and two deliveries of the
 * same change report it once.
 * @param repoLinkId The repository link
 * @param pullRequest GitHub's pull request object
 * @param sender Who did it on GitHub
 * @param source What brought the change in
 * @param meta The event behind the change
 * @returns The outcome, which listeners were told after the commit (not for a stale payload)
 */
export async function storePullRequest(
  repoLinkId: string,
  pullRequest: PullRequestPayload,
  sender: Sender,
  source: GithubEventOutcome['source'],
  meta: StoreMeta = {},
): Promise<GithubEventOutcome> {
  const pr = pullRequestSchema.parse(pullRequest);
  const author = await resolveGithubActor(pr.user ?? null);
  const reviewers = await reviewersOf(pr);
  const data = {
    title: pr.title,
    state: stateOf(pr),
    draft: pr.draft ?? false,
    authorLogin: author.login,
    authorUserId: author.userId,
    headRef: pr.head.ref,
    headSha: pr.head.sha,
    baseRef: pr.base.ref,
    mergeableState: pr.mergeable_state ?? null,
    mergeCommitSha: pr.merge_commit_sha ?? null,
    requestedReviewers: reviewers,
    htmlUrl: pr.html_url,
    openedAt: new Date(pr.created_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    githubUpdatedAt: new Date(pr.updated_at),
  };

  const stored = await retryOnRace(() =>
    prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM github_pull_requests WHERE "repoLinkId" = ${repoLinkId} AND number = ${pr.number} FOR UPDATE`;
      const before = await tx.githubPullRequest.findUnique({
        where: { repoLinkId_number: { repoLinkId, number: pr.number } },
      });
      if (!before) {
        const row = await tx.githubPullRequest.create({
          data: { ...data, repoLinkId, number: pr.number },
        });
        return { row, stale: false, transitions: prTransitions(null, row) };
      }
      // One conditional write: an older payload matches nothing
      const written = await tx.githubPullRequest.updateMany({
        where: { id: before.id, githubUpdatedAt: { lte: data.githubUpdatedAt } },
        data,
      });
      if (written.count === 0) return { row: before, stale: true, transitions: [] };
      const row = await tx.githubPullRequest.findUniqueOrThrow({ where: { id: before.id } });
      return { row, stale: false, transitions: prTransitions(before, row) };
    }),
  );

  const base = await outcomeBase(repoLinkId, sender, source, meta, {
    event: 'pull_request',
    action: null,
  });
  const target: LinkTarget = { type: 'PULL_REQUEST', key: stored.row.id };
  const links = stored.stale
    ? await linksOf(repoLinkId, target)
    : await syncLinks(repoLinkId, target, {
        BRANCH_NAME: pr.head.ref,
        PR_TITLE: pr.title,
        PR_BODY: pr.body ?? '',
      });
  const outcome: GithubEventOutcome = {
    ...base,
    pullRequestId: stored.row.id,
    headSha: stored.row.headSha,
    linkedIssueIds: links.linked,
    removedIssueIds: links.removed,
    drivingIssueIds: links.driving,
    transitions: stored.transitions,
  };
  if (!stored.stale) await report(outcome);
  return outcome;
}

// ---- Reviews

/**
 * Stores a review of a pull request: new, or changed by an edit or a dismissal. The first time a
 * review id is stored it reports `review_added`; the insert decides who was first.
 * @param pullRequestId The stored pull request
 * @param review GitHub's review object
 * @param sender Who did it on GitHub
 * @param source What brought the change in
 * @param meta The event behind the change
 * @returns The outcome, which listeners were told after the commit
 */
export async function storeReview(
  pullRequestId: string,
  review: ReviewPayload,
  sender: Sender,
  source: GithubEventOutcome['source'],
  meta: StoreMeta = {},
): Promise<GithubEventOutcome> {
  const parsed = reviewSchema.parse(review);
  const pr = await prisma.githubPullRequest.findUniqueOrThrow({
    where: { id: pullRequestId },
    select: { repoLinkId: true, headSha: true },
  });
  const author = await resolveGithubActor(parsed.user ?? null);
  const data = {
    authorLogin: author.login,
    authorUserId: author.userId,
    state: parsed.state,
    body: cutUtf8(parsed.body ?? '', REVIEW_BODY_BYTES),
    commitSha: parsed.commit_id,
    submittedAt: parsed.submitted_at ? new Date(parsed.submitted_at) : new Date(),
  };
  const id = String(parsed.id);
  const added = await prisma.$transaction(async (tx) => {
    const created = await tx.githubReview.createMany({
      data: [{ id, pullRequestId, ...data }],
      skipDuplicates: true,
    });
    if (created.count > 0) return true;
    await tx.githubReview.updateMany({
      where: { id, pullRequestId },
      data: { state: data.state, body: data.body, commitSha: data.commitSha },
    });
    return false;
  });

  const base = await outcomeBase(pr.repoLinkId, sender, source, meta, {
    event: 'pull_request_review',
    action: null,
  });
  const links = await linksOf(pr.repoLinkId, { type: 'PULL_REQUEST', key: pullRequestId });
  const outcome: GithubEventOutcome = {
    ...base,
    pullRequestId,
    headSha: pr.headSha,
    linkedIssueIds: links.linked,
    drivingIssueIds: links.driving,
    transitions: added ? ['review_added'] : [],
  };
  await report(outcome);
  return outcome;
}

// ---- Commits

/**
 * Stores the commits of a push and syncs each one's issue links from its message. Commits are
 * keyed by sha, so a commit seen again is the same row.
 * @param repoLinkId The repository link
 * @param commits GitHub's `commits` of a push; one that cannot be read is skipped
 * @returns The issues the commits named, were no longer named by, and are named by through a driving source
 */
async function storeCommits(repoLinkId: string, commits: unknown[]): Promise<SyncResult> {
  const total: SyncResult = { added: [], removed: [], linked: [], driving: [] };
  for (const raw of commits) {
    const parsed = commitSchema.safeParse(raw);
    if (!parsed.success) continue;
    const commit = parsed.data;
    const data = {
      message: cutUtf8(commit.message, COMMIT_MESSAGE_BYTES),
      authorLogin: commit.author?.username ?? null,
      htmlUrl: commit.url,
      committedAt: new Date(commit.timestamp),
    };
    await prisma.githubCommit.upsert({
      where: { repoLinkId_sha: { repoLinkId, sha: commit.id } },
      create: { repoLinkId, sha: commit.id, ...data },
      update: data,
    });
    const links = await syncLinks(
      repoLinkId,
      { type: 'COMMIT', key: commit.id },
      { COMMIT_MESSAGE: commit.message },
    );
    total.added = union(total.added, links.added);
    total.removed = union(total.removed, links.removed);
    total.linked = union(total.linked, links.linked);
    total.driving = union(total.driving, links.driving);
  }
  return total;
}

// ---- Handlers

/**
 * The link of a delivery's repository as it is now (a link replaced since the delivery arrived is
 * the new link's business), with its `lastDeliveryAt` set; null when the repository has none.
 * @param d The delivery
 */
async function linkOf(d: GithubDeliveryContext) {
  if (d.repoId === null) return null;
  const link = await findRepoLinkByRepoId(d.repoId);
  if (!link) return null;
  await prisma.githubRepoLink.updateMany({
    where: { id: link.id },
    data: { lastDeliveryAt: new Date() },
  });
  return link;
}

const BRANCH_PREFIX = 'refs/heads/';

const pushSchema = z.object({
  ref: z.string(),
  deleted: z.boolean().nullish(),
  commits: z.array(z.unknown()).nullish(),
});

onGithubEvent('push', async (d) => {
  const parsed = pushSchema.safeParse(d.payload);
  if (!parsed.success || !parsed.data.ref.startsWith(BRANCH_PREFIX)) return 'ignored';
  const link = await linkOf(d);
  if (!link) return 'ignored';
  const name = parsed.data.ref.slice(BRANCH_PREFIX.length);
  const meta: StoreMeta = { event: 'push', action: d.action, payload: d.payload };
  const sender = senderSchema.parse(d.payload.sender);
  if (parsed.data.deleted) {
    await storeBranch(link.id, { name, sha: null }, sender, 'webhook', meta);
    return 'processed';
  }
  const commitLinks = await storeCommits(link.id, parsed.data.commits ?? []);
  const after = z.string().min(1).safeParse(d.payload.after);
  await storeBranch(link.id, { name, sha: after.success ? after.data : '' }, sender, 'webhook', {
    ...meta,
    commitLinks,
  });
  return 'processed';
});

const refEventSchema = z.object({ ref: z.string().min(1), ref_type: z.string() });

for (const event of ['create', 'delete'] as const) {
  onGithubEvent(event, async (d) => {
    const parsed = refEventSchema.safeParse(d.payload);
    if (!parsed.success || parsed.data.ref_type !== 'branch') return 'ignored';
    const link = await linkOf(d);
    if (!link) return 'ignored';
    await storeBranch(
      link.id,
      { name: parsed.data.ref, sha: event === 'create' ? '' : null },
      senderSchema.parse(d.payload.sender),
      'webhook',
      { event, action: d.action, payload: d.payload },
    );
    return 'processed';
  });
}

const pullRequestEventSchema = z.object({ pull_request: pullRequestSchema });

onGithubEvent('pull_request', async (d) => {
  const parsed = pullRequestEventSchema.safeParse(d.payload);
  if (!parsed.success) return 'ignored';
  const link = await linkOf(d);
  if (!link) return 'ignored';
  await storePullRequest(
    link.id,
    d.payload.pull_request as PullRequestPayload,
    senderSchema.parse(d.payload.sender),
    'webhook',
    { event: 'pull_request', action: d.action, payload: d.payload },
  );
  return 'processed';
});

const REVIEW_ACTIONS = new Set(['submitted', 'edited', 'dismissed']);
const reviewEventSchema = z.object({ review: reviewSchema, pull_request: pullRequestSchema });

onGithubEvent('pull_request_review', async (d) => {
  if (!d.action || !REVIEW_ACTIONS.has(d.action)) return 'ignored';
  const parsed = reviewEventSchema.safeParse(d.payload);
  if (!parsed.success) return 'ignored';
  const link = await linkOf(d);
  if (!link) return 'ignored';
  const sender = senderSchema.parse(d.payload.sender);
  const meta: StoreMeta = { event: 'pull_request_review', action: d.action, payload: d.payload };
  // A review can come before the PR's own event: the PR object in the payload makes the row
  // (an older one than the stored state changes nothing)
  await storePullRequest(link.id, d.payload.pull_request as PullRequestPayload, sender, 'webhook', {
    event: 'pull_request',
    action: null,
    payload: d.payload,
  });
  const pr = await prisma.githubPullRequest.findUnique({
    where: { repoLinkId_number: { repoLinkId: link.id, number: parsed.data.pull_request.number } },
    select: { id: true },
  });
  if (!pr) return 'ignored';
  await storeReview(pr.id, d.payload.review as ReviewPayload, sender, 'webhook', meta);
  return 'processed';
});
