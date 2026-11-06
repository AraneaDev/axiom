import type { GithubPrState, Prisma } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/database';

import { resolveGithubActor } from './github-actor';
import { isUniqueViolation } from './github-errors';
import { reportOutcome, type GithubEventOutcome, type GithubTransition } from './github-outcomes';
import { drivesAutomation } from './issue-keys';
import { syncLinks, type LinkTarget, type SyncResult } from './issue-links.service';
import { findRepoLinkByRepoId } from './repo-link.service';
import { onGithubEvent, type GithubDeliveryContext } from './webhook-dispatch';

export { onGithubOutcome } from './github-outcomes';
export type { GithubEventOutcome, GithubTransition } from './github-outcomes';

/** Where a store call comes from, and what it was told of the event behind it */
export type StoreMeta = {
  event?: string;
  action?: string | null;
  payload?: Record<string, unknown>;
  /** Issues the commits of the same push named: they join the outcome of the branch */
  commitLinks?: Pick<SyncResult, 'linked' | 'removed' | 'driving'>;
  /** When GitHub says a push or deletion happened: an older one never overwrites a newer one */
  at?: Date | null;
  /** The head a push moved from: with no (or an equal) time it must be the stored head */
  before?: string | null;
};

type Sender = { id: number; login: string } | null;
type Client = Prisma.TransactionClient;

// Postgres refuses NUL in text, and a delivery that fails on it would fail on every retry
const clean = (text: string) => text.replaceAll('\u0000', '');
const text = z.string().transform(clean);

const FALLBACK_HOST = 'https://github.com/';

// GitHub's link if it is an https one (it ends up in an href), else the one built from the repo
function httpsOr(url: string, fallback: string): string {
  return /^https:\/\/[^\s]+$/i.test(url) ? url : fallback;
}

async function loadLink(repoLinkId: string) {
  return prisma.githubRepoLink.findUnique({
    where: { id: repoLinkId },
    select: { projectId: true, htmlUrl: true },
  });
}

async function outcomeBase(
  repoLinkId: string,
  link: { projectId: string } | null,
  sender: Sender,
  source: GithubEventOutcome['source'],
  meta: StoreMeta,
  defaults: { event: string; action: string | null },
): Promise<Omit<GithubEventOutcome, 'transitions'>> {
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
async function linksOf(
  client: Client | typeof prisma,
  repoLinkId: string,
  target: LinkTarget,
): Promise<SyncResult> {
  const rows = await client.githubIssueLink.findMany({
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

// The first statement of every store transaction. Unlinking deletes the link row and its children
// cascade, so a store takes the link before its own rows, in that order too, and never waits on a
// lock the unlink holds the other way round. False when the link is gone: nothing is stored.
async function lockLink(tx: Client, repoLinkId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM github_repo_links WHERE id = ${repoLinkId} FOR KEY SHARE`;
  return rows.length > 0;
}

const union = (...lists: string[][]) => [...new Set(lists.flat())];

// Runs a store once more when two calls raced to create the same row and the other won; the
// failed attempt rolled back whole, so the second one starts from what the winner stored
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
 * @param value The text
 * @param maxBytes The most bytes to keep
 */
export function cutUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(clean(value), 'utf8');
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
const githubUser = z.object({ id: z.number().int(), login: text.pipe(z.string().min(1)) });

const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  title: text,
  body: text.nullish(),
  state: z.enum(['open', 'closed']),
  draft: z.boolean().nullish(),
  merged: z.boolean().nullish(),
  user: githubUser.nullish(),
  head: z.object({ ref: text, sha: text }),
  base: z.object({ ref: text }),
  mergeable_state: text.nullish(),
  merge_commit_sha: text.nullish(),
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
  state: text,
  body: z.string().nullish(),
  commit_id: text,
  submitted_at: timestamp.nullish(),
});

/** GitHub's pull request review object, as far as it is read */
export type ReviewPayload = z.input<typeof reviewSchema>;

const commitSchema = z.object({
  id: text.pipe(z.string().min(1)),
  message: z.string(),
  timestamp,
  url: z.string(),
  author: z.object({ username: text.nullish() }).nullish(),
});

const senderSchema = githubUser.nullable().catch(null);

// ---- Branches

/**
 * Stores a branch: created or moved to a new head, or marked deleted. The branch name is synced
 * as the `BRANCH_NAME` of the branch's issue links (in the same transaction), except for a
 * deletion, which keeps them. A push or deletion older than the newest one applied (`meta.at`)
 * changes nothing; a `create` event never brings a deleted branch back (a re-created branch
 * also gets a push, which does).
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
  const link = await loadLink(repoLinkId);
  const base = await outcomeBase(repoLinkId, link, sender, source, meta, {
    event: branch.sha === null ? 'delete' : 'push',
    action: null,
  });
  const name = clean(branch.name);
  const at = meta.at ?? null;
  const stored = await retryOnRace(() =>
    prisma.$transaction(async (tx) => {
      if (!(await lockLink(tx, repoLinkId))) {
        return { row: null, created: false, links: null as SyncResult | null, stale: true };
      }
      await tx.$queryRaw`SELECT id FROM github_branches WHERE "repoLinkId" = ${repoLinkId} AND name = ${name} FOR UPDATE`;
      const before = await tx.githubBranch.findUnique({
        where: { repoLinkId_name: { repoLinkId, name } },
      });
      const nothing = { row: before, created: false, links: null as SyncResult | null };
      if (before?.lastPushedAt && at && at < before.lastPushedAt)
        return { ...nothing, stale: true };
      // A delete event names no time: it deletes only a branch no ordered push has touched
      if (branch.sha === null && !at && before?.lastPushedAt) return { ...nothing, stale: true };
      // A push of the same second (or none named) is ordered by the head it moves from
      if (branch.sha && meta.before != null && before?.headSha && !before.deletedAt) {
        const sameTime =
          !at || !before.lastPushedAt || at.getTime() === before.lastPushedAt.getTime();
        if (sameTime && meta.before !== before.headSha) return { ...nothing, stale: true };
      }
      let row = before;
      let created = false;
      if (branch.sha === null) {
        if (!before) return { ...nothing, stale: false };
        row = await tx.githubBranch.update({
          where: { id: before.id },
          data: {
            deletedAt: before.deletedAt ?? new Date(),
            lastPushedAt: at ?? before.lastPushedAt,
          },
        });
      } else if (!before) {
        row = await tx.githubBranch.create({
          data: { repoLinkId, name, headSha: branch.sha, lastPushedAt: at },
        });
        created = true;
      } else if (branch.sha === '') {
        // A create event: it names no head, and a deleted branch stays deleted
        row = before;
      } else {
        row = await tx.githubBranch.update({
          where: { id: before.id },
          data: { headSha: branch.sha, deletedAt: null, lastPushedAt: at ?? before.lastPushedAt },
        });
        created = before.deletedAt !== null;
      }
      const target: LinkTarget = { type: 'BRANCH', key: row.id };
      const links =
        branch.sha === null || row.deletedAt
          ? await linksOf(tx, repoLinkId, target)
          : await syncLinks(repoLinkId, target, { BRANCH_NAME: name }, tx);
      return { row, created, links, stale: false };
    }),
  );

  const commit = meta.commitLinks ?? { linked: [], removed: [], driving: [] };
  const own = stored.links ?? { added: [], removed: [], linked: [], driving: [] };
  const outcome: GithubEventOutcome = {
    ...base,
    branchId: stored.row?.id,
    headSha: stored.row?.headSha || undefined,
    linkedIssueIds: union(own.linked, commit.linked),
    removedIssueIds: union(own.removed, commit.removed),
    drivingIssueIds: union(own.driving, commit.driving),
    transitions: stored.created ? ['branch_created'] : [],
  };
  if (!stored.stale) await reportOutcome(outcome);
  return outcome;
}

// ---- Pull requests

const stateOf = (pr: z.infer<typeof pullRequestSchema>): GithubPrState => {
  if (pr.state === 'open') return 'OPEN';
  return pr.merged || pr.merged_at ? 'MERGED' : 'CLOSED';
};

type StoredReviewer = { login: string; githubId?: number; userId?: string };

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
    return { login: u.login, githubId: u.id, ...(userId ? { userId } : {}) };
  });
}

function prTransitions(
  before: { state: GithubPrState; draft: boolean; requestedReviewers: unknown } | null,
  after: { state: GithubPrState; draft: boolean; requestedReviewers: unknown },
): GithubTransition[] {
  const out: GithubTransition[] = [];
  if (!before) {
    // A row stored for the first time reports the state it is stored in
    out.push(
      after.state === 'OPEN' ? 'pr_opened' : after.state === 'MERGED' ? 'pr_merged' : 'pr_closed',
    );
  } else if (before.state !== after.state) {
    if (after.state === 'MERGED') out.push('pr_merged');
    else if (after.state === 'CLOSED') out.push('pr_closed');
    else out.push('pr_reopened');
  } else if (before.draft && !after.draft && after.state === 'OPEN') {
    out.push('pr_ready_for_review');
  }
  const known = (before?.requestedReviewers as StoredReviewer[] | null) ?? [];
  const knownIds = new Set(known.map((r) => r.githubId).filter((id) => id !== undefined));
  const knownLogins = new Set(known.map((r) => r.login));
  // By GitHub id (a renamed reviewer is the same one), by login for a row stored without ids
  const added = ((after.requestedReviewers as StoredReviewer[] | null) ?? []).some(
    (r) => !(r.githubId !== undefined && knownIds.has(r.githubId)) && !knownLogins.has(r.login),
  );
  if (added) out.push('reviewers_added');
  return out;
}

/**
 * Stores a pull request and syncs its issue links (branch name, title and body) in the same
 * transaction. The row is locked while it is read, written and synced, so the links match the
 * stored row, the transitions come from the row before and after, and two deliveries of the
 * same change report it once. A payload older than the stored `githubUpdatedAt` changes
 * nothing, and a merged PR stays merged: GitHub cannot reopen it, so a payload that says
 * otherwise is an old one (`updated_at` has a resolution of one second). Likewise a closed PR is
 * not reopened by a payload of the same second.
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
  const link = await loadLink(repoLinkId);
  const base = await outcomeBase(repoLinkId, link, sender, source, meta, {
    event: 'pull_request',
    action: null,
  });
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
    mergeCommitSha: pr.merge_commit_sha ?? null,
    requestedReviewers: reviewers,
    htmlUrl: httpsOr(pr.html_url, `${link?.htmlUrl ?? FALLBACK_HOST}/pull/${pr.number}`),
    openedAt: new Date(pr.created_at),
    mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
    githubUpdatedAt: new Date(pr.updated_at),
  };

  const stored = await retryOnRace(() =>
    prisma.$transaction(async (tx) => {
      if (!(await lockLink(tx, repoLinkId))) return null;
      await tx.$queryRaw`SELECT id FROM github_pull_requests WHERE "repoLinkId" = ${repoLinkId} AND number = ${pr.number} FOR UPDATE`;
      const before = await tx.githubPullRequest.findUnique({
        where: { repoLinkId_number: { repoLinkId, number: pr.number } },
      });
      const target = (id: string): LinkTarget => ({ type: 'PULL_REQUEST', key: id });
      const sync = (id: string) =>
        syncLinks(
          repoLinkId,
          target(id),
          { BRANCH_NAME: pr.head.ref, PR_TITLE: pr.title, PR_BODY: pr.body ?? '' },
          tx,
        );
      if (!before) {
        const row = await tx.githubPullRequest.create({
          data: {
            ...data,
            mergeableState: pr.mergeable_state ?? null,
            repoLinkId,
            number: pr.number,
          },
        });
        return {
          row,
          stale: false,
          transitions: prTransitions(null, row),
          links: await sync(row.id),
        };
      }
      const sameSecond = data.githubUpdatedAt.getTime() === before.githubUpdatedAt.getTime();
      const leavesFinal =
        data.state !== before.state &&
        (before.state === 'MERGED' || (before.state === 'CLOSED' && sameSecond));
      // One conditional write: an older payload matches nothing, nor does one that would move a
      // merged PR
      const written = leavesFinal
        ? { count: 0 }
        : await tx.githubPullRequest.updateMany({
            where: {
              id: before.id,
              githubUpdatedAt: { lte: data.githubUpdatedAt },
              ...(data.state === 'MERGED' ? {} : { state: { not: 'MERGED' } }),
            },
            // A payload without a mergeable state (a review's) leaves the stored one alone
            data: { ...data, mergeableState: pr.mergeable_state ?? undefined },
          });
      if (written.count === 0) {
        return {
          row: before,
          stale: true,
          transitions: [] as GithubTransition[],
          links: await linksOf(tx, repoLinkId, target(before.id)),
        };
      }
      const row = await tx.githubPullRequest.findUniqueOrThrow({ where: { id: before.id } });
      return {
        row,
        stale: false,
        transitions: prTransitions(before, row),
        links: await sync(row.id),
      };
    }),
  );

  if (!stored) return { ...base, projectId: '', transitions: [] };
  const outcome: GithubEventOutcome = {
    ...base,
    pullRequestId: stored.row.id,
    headSha: stored.row.headSha,
    linkedIssueIds: stored.links.linked,
    removedIssueIds: stored.links.removed,
    drivingIssueIds: stored.links.driving,
    transitions: stored.transitions,
  };
  if (!stored.stale) await reportOutcome(outcome);
  return outcome;
}

// ---- Reviews

/**
 * Stores a review of a pull request: new, or changed by an edit or a dismissal. The first time a
 * review id is stored it reports `review_added`; the insert decides who was first. An existing
 * review is replaced only by a later `submitted_at`, or at the same time by a state that does not
 * rank lower: a dismissed review is never set back by a `submitted` that arrives late.
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
  const link = await loadLink(pr.repoLinkId);
  const base = await outcomeBase(pr.repoLinkId, link, sender, source, meta, {
    event: 'pull_request_review',
    action: null,
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
  const dismissed = data.state.toLowerCase() === 'dismissed';
  const stored = await prisma.$transaction(async (tx) => {
    if (!(await lockLink(tx, pr.repoLinkId))) return null;
    const created = await tx.githubReview.createMany({
      data: [{ id, pullRequestId, ...data }],
      skipDuplicates: true,
    });
    const links = () => linksOf(tx, pr.repoLinkId, { type: 'PULL_REQUEST', key: pullRequestId });
    if (created.count > 0) return { added: true, links: await links() };
    await tx.githubReview.updateMany({
      where: {
        id,
        pullRequestId,
        OR: [
          { submittedAt: { lt: data.submittedAt } },
          {
            submittedAt: data.submittedAt,
            // Dismissed ranks above every other state
            ...(dismissed ? {} : { NOT: { state: { equals: 'dismissed', mode: 'insensitive' } } }),
          },
        ],
      },
      data: {
        state: data.state,
        body: data.body,
        commitSha: data.commitSha,
        submittedAt: data.submittedAt,
      },
    });
    return { added: false, links: await links() };
  });

  if (!stored) return { ...base, projectId: '', transitions: [] };
  const { added, links } = stored;
  const outcome: GithubEventOutcome = {
    ...base,
    pullRequestId,
    headSha: pr.headSha,
    linkedIssueIds: links.linked,
    drivingIssueIds: links.driving,
    transitions: added ? ['review_added'] : [],
  };
  await reportOutcome(outcome);
  return outcome;
}

// ---- Commits

/**
 * Stores the commits of a push and syncs each new one's issue links from its message. Commits
 * are keyed by sha and never change, so one stored before is left alone (a merge pushes its
 * commits again). A commit and its links are stored in one transaction.
 * @param repoLinkId The repository link
 * @param repoUrl The repository's link on GitHub, for a commit link that is not https
 * @param commits GitHub's `commits` of a push; one that cannot be read is skipped
 * @returns The issues the new commits named, through the `COMMIT_MESSAGE` source
 */
async function storeCommits(
  repoLinkId: string,
  repoUrl: string,
  commits: unknown[],
): Promise<SyncResult> {
  const total: SyncResult = { added: [], removed: [], linked: [], driving: [] };
  const parsedCommits = commits.flatMap((raw) => {
    const parsed = commitSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  // The connected Axiom user of each author login (GitHub logins are case-insensitive)
  const logins = [...new Set(parsedCommits.map((c) => c.author?.username).filter((l) => !!l))];
  const accounts = logins.length
    ? await prisma.githubAccount.findMany({
        where: {
          OR: logins.map((login) => ({ login: { equals: login!, mode: 'insensitive' as const } })),
        },
        select: { login: true, userId: true },
      })
    : [];
  const userByLogin = new Map(accounts.map((a) => [a.login.toLowerCase(), a.userId]));
  for (const commit of parsedCommits) {
    const links = await retryOnRace(() =>
      prisma.$transaction(async (tx) => {
        if (!(await lockLink(tx, repoLinkId))) return null;
        const created = await tx.githubCommit.createMany({
          data: [
            {
              repoLinkId,
              sha: commit.id,
              message: cutUtf8(commit.message, COMMIT_MESSAGE_BYTES),
              authorLogin: commit.author?.username ?? null,
              authorUserId: userByLogin.get((commit.author?.username ?? '').toLowerCase()) ?? null,
              htmlUrl: httpsOr(commit.url, `${repoUrl}/commit/${commit.id}`),
              committedAt: new Date(commit.timestamp),
            },
          ],
          skipDuplicates: true,
        });
        if (created.count === 0) return null;
        return syncLinks(
          repoLinkId,
          { type: 'COMMIT', key: commit.id },
          { COMMIT_MESSAGE: clean(commit.message) },
          tx,
        );
      }),
    );
    if (!links) continue;
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

// `repository.pushed_at` is a unix time in a push event and an ISO text elsewhere
function pushedAt(payload: Record<string, unknown>): Date | null {
  const repository = payload.repository as { pushed_at?: unknown } | undefined;
  const headCommit = payload.head_commit as { timestamp?: unknown } | null | undefined;
  for (const value of [repository?.pushed_at, headCommit?.timestamp]) {
    const date =
      typeof value === 'number'
        ? new Date(value * 1000)
        : typeof value === 'string'
          ? new Date(value)
          : null;
    if (date && !Number.isNaN(date.getTime())) return date;
  }
  return null;
}

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
  const meta: StoreMeta = {
    event: 'push',
    action: d.action,
    payload: d.payload,
    at: pushedAt(d.payload),
    before: typeof d.payload.before === 'string' ? d.payload.before : null,
  };
  const sender = senderSchema.parse(d.payload.sender);
  if (parsed.data.deleted) {
    await storeBranch(link.id, { name, sha: null }, sender, 'webhook', meta);
    return 'processed';
  }
  const commitLinks = await storeCommits(link.id, link.htmlUrl, parsed.data.commits ?? []);
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
      // A delete event names no time: it never writes one, and deletes only a branch no ordered
      // push has touched (a push with `deleted` is the ordered delete)
      { event, action: d.action, payload: d.payload, at: null },
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
