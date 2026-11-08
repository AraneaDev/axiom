// Imports GitHub Issues into the linked project and keeps them current. What each import wrote is
// remembered per field (title, body hash, labels), so a field changed in Axiom since is recognised
// and kept: an `import_conflict` entry then names the field, and GitHub's value never replaces
// the Axiom edit.
// Nothing goes back to GitHub but one comment per issue, as the App, with the Axiom link. An
// import row whose Axiom issue (or a mirror whose Axiom comment) was deleted stays as a tombstone:
// what Axiom deleted is never imported again.
import { createHash } from 'node:crypto';

import type { GithubIssueImport, GithubRepoLink } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { formatIssueKey } from '../../utils/issue-key';
import { logger } from '../../utils/logger';
import { logActivity } from '../activity/activity.service';
import { addWebLink } from '../issues/issue-web-links.service';
import * as issuesService from '../issues/issues.service';

import { orgActorId, resolveGithubActor } from './github-actor';
import { GITHUB_APP_ROW_ID, instanceOrigin } from './github-app.service';
import {
  githubPaginate,
  githubRequest,
  outsideGithubCallCount,
  type GithubAuth,
} from './github-client';
import { githubUser, text, timestamp } from './github-store';
import {
  ImportCappedError,
  LINK_COMMENT_WINDOWS,
  releaseImportSlot,
  takeImportSlot,
} from './import-cap';
import { isIntegrationUser } from './integration-user';

// Axiom's own limits: the issue title and body (issue-validators.ts), a comment body and a label
// name (common-validators.ts)
const TITLE_MAX = 200;
const BODY_MAX = 100_000;
const COMMENT_MAX = 50_000;
const LABEL_NAME_MAX = 100;
const LABELS_MAX = 20;
/** A claim on the link comment older than this belongs to a run that died: it may be taken */
export const LINK_CLAIM_TTL_MS = 10 * 60_000;
/** Refusals of one link comment after which it is given up */
const LINK_COMMENT_TRIES = 5;
/**
 * GitHub refusing a link comment: a 4xx other than 404 and 410 (given up at once) and 429 (a rate
 * limit). A 5xx, a timeout or an unreachable GitHub (GITHUB_UNAVAILABLE) never counts.
 */
const REFUSALS = new Set([
  'GITHUB_FORBIDDEN',
  'GITHUB_INVALID',
  'GITHUB_CONFLICT',
  'GITHUB_NOT_ALLOWED',
]);
/** How long an import waits for another one of the same issue before it gives up (and retries) */
const LOCK_WAIT_MS = 30_000;
/** How long the database part of one import may hold the issue */
const LOCK_HOLD_MS = 60_000;
/**
 * How many imports of this process may hold an issue lock at once. Each holds one connection for
 * the lock and needs others for its work, so this stays well under the pool (10).
 */
const MAX_LOCK_HOLDERS = 3;
/** Pages of comments since the claim read when looking for a link comment a failed post made */
const LINK_LOOKUP_PAGES = 3;
/** Pages of comments read when an issue is imported */
const COMMENT_PAGES = 3;
/** The start of the link comment, which is how the App's own comment is recognised */
const LINK_COMMENT_PREFIX = 'Tracked in Axiom as [';

const author = githubUser.extend({ type: z.string().optional() }).nullable().catch(null);

/** A GitHub Issue as the REST API and the `issues` webhook give it */
export const githubIssueSchema = z.object({
  id: z.number().int(),
  number: z.number().int().positive(),
  title: text,
  body: text.nullish(),
  state: z.string(),
  user: author,
  labels: z.array(z.union([text, z.object({ name: text })])).catch([]),
  created_at: timestamp,
  updated_at: timestamp,
  /** Present on a pull request: the issues API lists those too, and they are never imported */
  pull_request: z.unknown().optional(),
});
export type GithubIssuePayload = z.input<typeof githubIssueSchema>;
type GithubIssue = z.output<typeof githubIssueSchema>;

/** A comment on a GitHub Issue */
export const githubCommentSchema = z.object({
  id: z.number().int(),
  body: text.nullish(),
  user: author,
  created_at: timestamp,
  updated_at: timestamp,
});
export type GithubCommentPayload = z.input<typeof githubCommentSchema>;

export type ImportConflictField = 'title' | 'body' | 'labels';
export type ImportResult = {
  issueId: string;
  created: boolean;
  conflicts: ImportConflictField[];
};

export type ImportOptions = {
  /** Read the issue's comments from GitHub and import them, once per import */
  withComments: boolean;
  /**
   * Who made the change on GitHub (the event's sender), for the activity of an update; the
   * issue's author when not given
   */
  sender?: { id: number; login: string } | null;
  /**
   * Which writes run the project's automation rules. None by default: a backfill must not set off
   * one rule per old issue.
   */
  runRules?: { created?: boolean; updated?: boolean };
  /**
   * A live event (a webhook, or the reconcile catching one up): new issues and comments count
   * against the link's hourly LIVE_IMPORT_CAP. The backfill leaves it unset.
   */
  live?: boolean;
  /**
   * Post the link comment on GitHub now (the default). The backfill turns it off and posts the
   * link comments itself, at its own pace.
   */
  linkComment?: boolean;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * From when a GitHub Issue is news for the issue:created rules: made after the link, and after
 * import was last switched on. One made before could not have been seen as it was opened.
 * @param link The repository link
 */
export function importNewsSince(link: Pick<GithubRepoLink, 'createdAt' | 'importEnabledAt'>): Date {
  const enabled = link.importEnabledAt;
  return enabled && enabled > link.createdAt ? enabled : link.createdAt;
}

/**
 * Cuts a text to at most `max` UTF-16 units (the unit Axiom's length limits count) without
 * splitting a surrogate pair.
 * @param value The text
 * @param max The most units to keep
 */
function cutText(value: string, max: number): string {
  if (value.length <= max) return value;
  const end = /[\uD800-\uDBFF]/.test(value[max - 1]) ? max - 1 : max;
  return value.slice(0, end);
}

const titleOf = (gh: GithubIssue) =>
  cutText(gh.title.trim(), TITLE_MAX).trim() || `GitHub issue #${gh.number}`;
const bodyOf = (gh: GithubIssue) => cutText(gh.body ?? '', BODY_MAX);
function labelsOf(gh: GithubIssue): string[] {
  const names = gh.labels
    .map((label) =>
      cutText((typeof label === 'string' ? label : label.name).trim(), LABEL_NAME_MAX),
    )
    .filter((name) => name.length > 0);
  return [...new Set(names)].slice(0, LABELS_MAX);
}
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000');

const installation = (link: Pick<GithubRepoLink, 'installationId'>): GithubAuth => ({
  kind: 'installation',
  installationId: Number(link.installationId),
});
// By id: a repository renamed since the link was made (or a new one under the old name) changes
// nothing about where these calls go
const issuePath = (link: Pick<GithubRepoLink, 'repoId'>, number: number) =>
  `/repositories/${link.repoId}/issues/${number}`;
const commentsPath = (link: Pick<GithubRepoLink, 'repoId'>, number: number) =>
  `${issuePath(link, number)}/comments`;
const webUrlOf = (link: Pick<GithubRepoLink, 'htmlUrl'>, number: number) =>
  `${link.htmlUrl}/issues/${number}`;

const findImport = (repoLinkId: string, githubIssueNumber: number) =>
  prisma.githubIssueImport.findUnique({
    where: { repoLinkId_githubIssueNumber: { repoLinkId, githubIssueNumber } },
  });

/** How many lock transactions this process has open, and the most it had at once (for tests) */
export const issueLockStats = { open: 0, peak: 0 };

// The issue locks this process may hold at once, and the imports waiting for a turn
let lockHolders = 0;
const lockQueue: Array<() => void> = [];
async function takeLockSlot(): Promise<void> {
  if (lockHolders < MAX_LOCK_HOLDERS) {
    lockHolders++;
    return;
  }
  // The slot is handed over by the one that frees it, so the count stays as it is
  await new Promise<void>((resolve) => lockQueue.push(resolve));
}
function freeLockSlot(): void {
  const next = lockQueue.shift();
  if (next) next();
  else lockHolders--;
}

/**
 * Runs the database part of an import while no other import of the same GitHub Issue does, so
 * an `opened` and a `labeled` delivery of one new issue make one Axiom issue. The lock is tried
 * rather than waited on, and at most {@link MAX_LOCK_HOLDERS} tries of this process run at once:
 * a waiter holds no connection, so a burst of deliveries cannot take the pool from the work of the
 * imports that hold a lock.
 * @param repoLinkId The repository link
 * @param number The GitHub Issue number
 * @param work The work; it uses the shared client, the transaction only holds the lock
 * @throws {AppError} 503 GITHUB_IMPORT_BUSY when the issue stays taken (the delivery is retried)
 */
async function underIssueLock<T>(
  repoLinkId: string,
  number: number,
  work: () => Promise<T>,
): Promise<T> {
  const key = `github-import:${repoLinkId}:${number}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    await takeLockSlot();
    let attempt: { locked: false } | { locked: true; value: T };
    try {
      attempt = await prisma.$transaction(
        async (tx) => {
          issueLockStats.open++;
          issueLockStats.peak = Math.max(issueLockStats.peak, issueLockStats.open);
          try {
            const [{ locked }] = await tx.$queryRaw<
              { locked: boolean }[]
            >`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
            if (!locked) return { locked: false as const };
            return { locked: true as const, value: await work() };
          } finally {
            issueLockStats.open--;
          }
        },
        { maxWait: 10_000, timeout: LOCK_HOLD_MS },
      );
    } finally {
      freeLockSlot();
    }
    if (attempt.locked) return attempt.value;
    if (Date.now() > deadline) {
      throw new AppError(503, 'The GitHub issue is being imported', 'GITHUB_IMPORT_BUSY');
    }
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));
  }
}

/**
 * Who a GitHub user writes as in the project: the connected Axiom user when they are a member of
 * the project's org, else the integration user with the GitHub login kept beside it.
 * @param user The GitHub user, null for a deleted account
 * @param projectId The project
 */
async function writerOf(
  user: { id: number; login: string } | null,
  projectId: string,
): Promise<{ userId: string; externalAuthorLogin?: string }> {
  const actor = await resolveGithubActor(user ? { id: user.id, login: user.login } : null);
  const userId = await orgActorId(actor, projectId);
  return isIntegrationUser(userId) ? { userId, externalAuthorLogin: actor.login } : { userId };
}

type Imported = ImportResult & { importId: string; linkCommentId: string | null };

async function createImported(
  link: GithubRepoLink,
  gh: GithubIssue,
  opts: ImportOptions,
): Promise<Imported> {
  const writer = await writerOf(gh.user, link.projectId);
  const title = titleOf(gh);
  const body = bodyOf(gh);
  const labels = labelsOf(gh);
  // The row is written in the same statement as the issue: there is never an imported issue
  // without its row, and a second run's duplicate fails whole
  const issue = await issuesService.createIssue(
    link.projectId,
    writer.userId,
    { title, body, labels },
    {
      skipAutomation: !opts.runRules?.created,
      skipMentions: true,
      externalAuthorLogin: writer.externalAuthorLogin,
      githubImport: {
        data: {
          repoLink: { connect: { id: link.id } },
          project: { connect: { id: link.projectId } },
          repoId: link.repoId,
          githubIssueNumber: gh.number,
          githubIssueId: String(gh.id),
          mirroredTitle: title,
          mirroredBodyHash: sha256(body),
          mirroredLabels: labels,
          githubUpdatedAt: new Date(gh.updated_at),
          lastImportedAt: new Date(),
        },
        // Either unique can clash: this link's row, or an unadopted row of the same repo here
        isTaken: async () =>
          (await prisma.githubIssueImport.count({
            where: {
              githubIssueNumber: gh.number,
              OR: [{ repoLinkId: link.id }, { projectId: link.projectId, repoId: link.repoId }],
            },
          })) > 0,
      },
    },
  );
  const row = await prisma.githubIssueImport.findUniqueOrThrow({ where: { issueId: issue.id } });
  // Built from the stored repository, not from the payload's URL
  const url = webUrlOf(link, gh.number);
  await addWebLink(link.projectId, issue.number, writer.userId, {
    url,
    title: `GitHub issue #${gh.number}`,
  });
  await logActivity('issue', issue.id, 'imported', writer.userId, {
    githubIssueNumber: gh.number,
    url,
  });
  return { issueId: issue.id, created: true, conflicts: [], importId: row.id, linkCommentId: null };
}

async function updateImported(
  link: GithubRepoLink,
  row: GithubIssueImport & { issueId: string },
  gh: GithubIssue,
  opts: ImportOptions,
): Promise<Imported> {
  const unchanged: Imported = {
    issueId: row.issueId,
    created: false,
    conflicts: [],
    importId: row.id,
    linkCommentId: row.linkCommentId,
  };
  // Deliveries can run late: one older than the last import changes nothing
  const updatedAt = new Date(gh.updated_at);
  if (updatedAt < row.githubUpdatedAt) return unchanged;
  const issue = await prisma.issue.findUnique({
    where: { id: row.issueId },
    include: { labels: { select: { name: true } }, webLinks: { select: { url: true } } },
  });
  // An issue moved to another project is no longer this repository's business
  if (!issue || issue.projectId !== link.projectId) return unchanged;

  const title = titleOf(gh);
  const body = bodyOf(gh);
  const bodyHash = sha256(body);
  const labels = labelsOf(gh);
  const current = issue.labels.map((label) => label.name);
  const data: { title?: string; body?: string; labels?: string[] } = {};
  const mirror: { mirroredTitle?: string; mirroredBodyHash?: string; mirroredLabels?: string[] } =
    {};
  const conflicts: ImportConflictField[] = [];

  // Only what GitHub changed since the last import is looked at. Axiom's value is replaced only
  // while it is still what the import wrote; else it stays and the conflict is noted once, as
  // the mirror then follows GitHub (the next GitHub change is a conflict of its own).
  if (title !== row.mirroredTitle) {
    if (issue.title === row.mirroredTitle) data.title = title;
    else if (issue.title !== title) conflicts.push('title');
    mirror.mirroredTitle = title;
  }
  if (bodyHash !== row.mirroredBodyHash) {
    if (sha256(issue.body) === row.mirroredBodyHash) data.body = body;
    else if (issue.body !== body) conflicts.push('body');
    mirror.mirroredBodyHash = bodyHash;
  }
  if (!sameSet(labels, row.mirroredLabels)) {
    if (sameSet(current, row.mirroredLabels)) data.labels = labels;
    else if (!sameSet(current, labels)) conflicts.push('labels');
    mirror.mirroredLabels = labels;
  }

  const writer = await writerOf(opts.sender === undefined ? gh.user : opts.sender, link.projectId);
  if (Object.keys(data).length > 0) {
    await issuesService.updateIssue(link.projectId, issue.number, data, writer.userId, {
      skipAutomation: !opts.runRules?.updated,
    });
  }
  for (const field of conflicts) {
    await logActivity('issue', issue.id, 'import_conflict', writer.userId, { field });
  }
  // A run that stored the issue but died before its web link adds it now
  const url = webUrlOf(link, gh.number);
  if (!issue.webLinks.some((webLink) => webLink.url === url)) {
    await addWebLink(link.projectId, issue.number, writer.userId, {
      url,
      title: `GitHub issue #${gh.number}`,
    });
  }
  await prisma.githubIssueImport.update({
    where: { id: row.id },
    data: { ...mirror, githubUpdatedAt: updatedAt, lastImportedAt: new Date() },
  });
  return { ...unchanged, conflicts };
}

// Whether a payload carries something other than what the last import took
const differsFromMirror = (row: GithubIssueImport, gh: GithubIssue) =>
  titleOf(gh) !== row.mirroredTitle ||
  sha256(bodyOf(gh)) !== row.mirroredBodyHash ||
  !sameSet(labelsOf(gh), row.mirroredLabels);

/**
 * The issue as GitHub has it now, for a snapshot that cannot be ordered against the last import.
 * @param link The repository link
 * @param number The GitHub Issue number
 * @returns It, or null when GitHub's answer cannot be read
 */
async function readFresh(link: GithubRepoLink, number: number): Promise<GithubIssue | null> {
  const { data } = await githubRequest<unknown>(installation(link), 'GET', issuePath(link, number));
  const parsed = githubIssueSchema.safeParse(data);
  return parsed.success && parsed.data.number === number ? parsed.data : null;
}

/**
 * Imports one GitHub Issue into the linked project, or brings an imported one up to date. A new
 * one is imported only while open; a pull request never is, and neither is one whose Axiom issue
 * was deleted. Title, body and labels of an imported one take GitHub's value where Axiom's is
 * still what the last import wrote, else they stay and an `import_conflict` activity names the
 * field. Imported text notifies nobody.
 * @param link The repository link
 * @param ghIssue The issue as GitHub gave it
 * @param opts Whether to import the comments, who made the change, and which writes run rules
 * @returns What was done, or null when the issue is not imported (closed, a pull request, deleted
 *   in Axiom, or a payload that cannot be read)
 * @throws {ImportCappedError} When a live import of a new issue finds the hour's cap reached
 */
export async function importGithubIssue(
  link: GithubRepoLink,
  ghIssue: GithubIssuePayload,
  opts: ImportOptions,
): Promise<ImportResult | null> {
  const parsed = githubIssueSchema.safeParse(ghIssue);
  if (!parsed.success) return null;
  let gh = parsed.data;
  if (gh.pull_request !== undefined && gh.pull_request !== null) return null;

  const before = await findImport(link.id, gh.number);
  if (before && !before.issueId) return null;
  // GitHub's times have whole seconds: a snapshot of the same second as the last import but with
  // other content may be the older one of two changes, so GitHub is asked what is current
  if (
    before &&
    new Date(gh.updated_at).getTime() === before.githubUpdatedAt.getTime() &&
    differsFromMirror(before, gh)
  ) {
    const fresh = await readFresh(link, gh.number);
    if (fresh && (fresh.pull_request === undefined || fresh.pull_request === null)) gh = fresh;
  }

  const update = (row: GithubIssueImport) =>
    row.issueId ? updateImported(link, { ...row, issueId: row.issueId }, gh, opts) : null;
  const done = await underIssueLock(link.id, gh.number, async () => {
    const row = await findImport(link.id, gh.number);
    if (row) return update(row);
    if (gh.state !== 'open') return null;
    // Taken under the lock, so a duplicate delivery of the same issue does not use up a slot, and
    // given back when the issue is not made after all
    const slot = opts.live ? await takeImportSlot(link.id, 'issues', gh.number) : null;
    try {
      return await createImported(link, gh, opts);
    } catch (err) {
      const exists = err instanceof AppError && err.code === 'GITHUB_IMPORT_EXISTS';
      // A failure after the issue and its row were written (the web link, say) used its slot. A
      // failure to give it back must not hide the error that matters.
      if (slot) {
        await (async () => {
          if (exists || !(await findImport(link.id, gh.number))) {
            await releaseImportSlot(link.id, 'issues', slot);
          }
        })().catch(() => undefined);
      }
      if (!exists) throw err;
      const taken = await findImport(link.id, gh.number);
      return taken ? update(taken) : null;
    }
  });
  if (!done) return null;

  if (opts.withComments) {
    const row = await prisma.githubIssueImport.findUnique({ where: { id: done.importId } });
    // Once per import: a delivery that failed after the issue was made reads them on its retry.
    // A read the cap or the call budget cuts short is finished by the reconcile.
    if (row?.issueId && !row.commentsImportedAt) {
      await importIssueComments(link, row, { live: opts.live });
    }
  }
  if (!done.linkCommentId && opts.linkComment !== false) await postLinkComment(done.importId);
  return { issueId: done.issueId, created: done.created, conflicts: done.conflicts };
}

/** How a read of an imported issue's comments ended */
export type CommentReadResult = 'complete' | 'capped' | 'cut';

/**
 * Reads the comments of an imported issue from GitHub (3 pages) and imports them. Only a read that
 * got through notes `commentsImportedAt`; one the hourly cap or the call budget cut short leaves
 * it unset, so the reconcile reads the issue's comments again ({@link pendingCommentImports}).
 * What was imported before is recognised by its mirror, so a second read adds only the rest.
 * @param link The repository link
 * @param row The import of the issue
 * @param opts `live` counts new comments against the link's hourly cap
 * @param opts.live
 * @returns `complete`, `capped` when the hour's comments ran out, or `cut` when the call budget
 *   stopped the pages
 */
export async function importIssueComments(
  link: GithubRepoLink,
  row: GithubIssueImport,
  opts: { live?: boolean } = {},
): Promise<CommentReadResult> {
  // Three pages are all that is ever read: only a read the call budget stopped is unfinished
  const { items, cut } = await githubPaginate<GithubCommentPayload & GithubComment>(
    installation(link),
    commentsPath(link, row.githubIssueNumber),
    { maxPages: COMMENT_PAGES },
  );
  // The App's link comment from an earlier link of the repository (unlinked since, or linked to
  // another project) is stored before anything is posted, so the issue never gets a second one
  let current = row;
  if (!row.linkCommentId) {
    const found = linkCommentAmong(items, await appIdentity());
    if (found) {
      await prisma.githubIssueImport.updateMany({
        where: { id: row.id, linkCommentId: null },
        data: { linkCommentId: found },
      });
      current = { ...row, linkCommentId: found };
    }
  }
  for (const comment of items) {
    try {
      await importComment(current, comment, { live: opts.live });
    } catch (err) {
      if (err instanceof ImportCappedError) return 'capped';
      throw err;
    }
  }
  if (cut) return 'cut';
  await prisma.githubIssueImport.update({
    where: { id: row.id },
    data: { commentsImportedAt: new Date() },
  });
  return 'complete';
}

/**
 * The imports of a link whose comments were never read to the end (the hourly cap, the call
 * budget or GitHub cut the read short), the longest waiting first.
 * @param repoLinkId The link
 * @param limit The most to return
 */
export function pendingCommentImports(
  repoLinkId: string,
  limit: number,
): Promise<GithubIssueImport[]> {
  return prisma.githubIssueImport.findMany({
    where: { repoLinkId, issueId: { not: null }, commentsImportedAt: null },
    orderBy: [{ lastImportedAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });
}

/**
 * Imports one comment of an imported issue, or updates its Axiom copy while that is still what
 * the last import wrote (else the copy stays and an `import_conflict` names the comment). The
 * App's own link comment and every bot's comment are skipped, and so is a comment whose Axiom
 * copy was deleted.
 * @param importRow The import of the issue the comment is on
 * @param ghComment The comment as GitHub gave it
 * @param opts `live` counts a new comment against the link's hourly cap
 * @param opts.live
 * @throws {ImportCappedError} When a live new comment finds the hour's cap reached
 */
export async function importComment(
  importRow: GithubIssueImport,
  ghComment: GithubCommentPayload,
  opts: { live?: boolean } = {},
): Promise<void> {
  const { issueId, repoLinkId } = importRow;
  // A tombstone, or a row whose repository is unlinked: nothing comes in
  if (!issueId || !repoLinkId) return;
  const parsed = githubCommentSchema.safeParse(ghComment);
  if (!parsed.success) return;
  const gh = parsed.data;
  const githubCommentId = String(gh.id);
  if (githubCommentId === importRow.linkCommentId || gh.user?.type === 'Bot') return;
  const body = cutText(gh.body ?? '', COMMENT_MAX);
  if (!body.trim()) return;
  const bodyHash = sha256(body);
  const updatedAt = new Date(gh.updated_at);
  const key = { importId_githubCommentId: { importId: importRow.id, githubCommentId } };

  await underIssueLock(repoLinkId, importRow.githubIssueNumber, async () => {
    const issue = await prisma.issue.findUnique({
      where: { id: issueId },
      select: { id: true, projectId: true },
    });
    // An issue moved to another project is no longer this repository's business
    if (!issue || issue.projectId !== importRow.projectId) return;
    const mirror = await prisma.githubImportedComment.findUnique({
      where: key,
      include: { comment: { select: { body: true, authorId: true } } },
    });
    if (mirror) {
      // Deleted in Axiom: it stays deleted
      if (!mirror.commentId || !mirror.comment) return;
      if (updatedAt < mirror.githubUpdatedAt || bodyHash === mirror.mirroredBodyHash) return;
      if (sha256(mirror.comment.body) === mirror.mirroredBodyHash) {
        await issuesService.updateComment(mirror.commentId, mirror.comment.authorId, body);
      } else {
        const writer = await writerOf(gh.user, issue.projectId);
        await logActivity('issue', issue.id, 'import_conflict', writer.userId, {
          field: 'comment',
          commentId: mirror.commentId,
        });
      }
      await prisma.githubImportedComment.update({
        where: key,
        data: { mirroredBodyHash: bodyHash, githubUpdatedAt: updatedAt },
      });
      return;
    }
    const slot = opts.live ? await takeImportSlot(repoLinkId, 'comments') : null;
    const writer = await writerOf(gh.user, issue.projectId);
    try {
      // The mirror is written in the same statement as the comment: there is never an imported
      // comment without it, so a later read cannot import it a second time
      await issuesService.addComment(issue.id, writer.userId, body, {
        skipMentions: true,
        externalAuthorLogin: writer.externalAuthorLogin,
        githubImport: {
          import: { connect: { id: importRow.id } },
          githubCommentId,
          mirroredBodyHash: bodyHash,
          githubUpdatedAt: updatedAt,
        },
      });
    } catch (err) {
      if (slot) {
        await releaseImportSlot(repoLinkId, 'comments', slot).catch(() => undefined);
      }
      throw err;
    }
  });
}

type GithubComment = {
  id: number;
  body?: string | null;
  user?: { login?: string } | null;
  performed_via_github_app?: { id?: number } | null;
};

type AppIdentity = { appId: string | number | bigint; slug: string } | null;

const appIdentity = (): Promise<AppIdentity> =>
  prisma.githubApp.findUnique({
    where: { id: GITHUB_APP_ROW_ID },
    select: { appId: true, slug: true },
  });

/**
 * The App's link comment among some comments, recognised by the App and the comment's start, so a
 * project or slug renamed since still matches.
 * @param items The comments
 * @param app The App, null when there is none
 * @returns Its id, or null
 */
function linkCommentAmong(items: readonly GithubComment[], app: AppIdentity): string | null {
  if (!app) return null;
  const found = items.find(
    (comment) =>
      typeof comment.body === 'string' &&
      comment.body.startsWith(LINK_COMMENT_PREFIX) &&
      (comment.performed_via_github_app?.id === Number(app.appId) ||
        comment.user?.login === `${app.slug}[bot]`),
  );
  return found ? String(found.id) : null;
}

/**
 * The App's link comment among the comments made or changed since a time: one a run that died
 * may have made before it could store the id.
 * @param auth The installation
 * @param path The issue's comments
 * @param since From when to look
 */
async function findLinkComment(
  auth: GithubAuth,
  path: string,
  since: Date,
): Promise<string | null> {
  const app = await appIdentity();
  if (!app) return null;
  const { items } = await githubPaginate<GithubComment>(auth, path, {
    query: { since: since.toISOString() },
    maxPages: LINK_LOOKUP_PAGES,
  });
  return linkCommentAmong(items, app);
}

// GitHub has no such issue (any more), or no issues: asking again changes nothing
const isPermanent = (err: unknown) =>
  err instanceof AppError && (err.code === 'GITHUB_NOT_FOUND' || err.code === 'GITHUB_GONE');

/**
 * Whose link comments a window counts: one link (the backfill's own pace) or every link of one
 * installation (the shared ceiling, as GitHub's limit on content creation is the installation's).
 */
export type LinkCommentScope = { repoLinkId: string } | { installationId: bigint };

const scopeWhere = (scope: LinkCommentScope) =>
  'repoLinkId' in scope
    ? { repoLinkId: scope.repoLinkId }
    : { repoLink: { installationId: scope.installationId } };

// Posted in the window, or a claim still out (a failed post leaves a stale one, not counted)
const countedSince = (since: Date) => [
  { linkCommentId: { not: null }, linkCommentClaimedAt: { gte: since } },
  {
    linkCommentId: null,
    linkCommentClaimedAt: {
      gte: new Date(Math.max(since.getTime(), Date.now() - LINK_CLAIM_TTL_MS)),
    },
  },
];

/**
 * The link comments posted (or with a live claim out) since a time, by one link or by every link
 * of an installation: what the windows of LINK_COMMENT_WINDOWS count.
 * @param scope The link, or the installation
 * @param since From when
 * @param db The client, or the transaction that holds the installation's comment lock
 */
export function linkCommentsSince(
  scope: LinkCommentScope,
  since: Date,
  db: Pick<typeof prisma, 'githubIssueImport'> = prisma,
): Promise<number> {
  return db.githubIssueImport.count({
    where: { ...scopeWhere(scope), OR: countedSince(since) },
  });
}

/**
 * When a full window frees a place again: an hour (say) after the oldest link comment it counts.
 * @param scope The link, or the installation
 * @param windowMs The window
 */
export async function linkCommentWindowOpensAt(
  scope: LinkCommentScope,
  windowMs: number,
): Promise<Date> {
  const oldest = await prisma.githubIssueImport.findFirst({
    where: { ...scopeWhere(scope), OR: countedSince(new Date(Date.now() - windowMs)) },
    orderBy: { linkCommentClaimedAt: 'asc' },
    select: { linkCommentClaimedAt: true },
  });
  const at = oldest?.linkCommentClaimedAt ?? new Date();
  return new Date(at.getTime() + windowMs);
}

/** How long a link comment waits for the installation's lock before it gives up (and retries) */
const LINK_COMMENT_LOCK_WAIT_MS = 5_000;

// Postgres' lock_timeout (55P03), or Prisma's transaction running out of its time (P2028)
const isLockTimeout = (err: unknown) =>
  !(err instanceof AppError) &&
  err instanceof Error &&
  /55P03|lock timeout|P2028|Transaction (API error|already closed)|timed out|maximum allowed/i.test(
    `${(err as { code?: string }).code ?? ''} ${err.message}`,
  );

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Runs the claim of a link comment in a transaction whose waits fit the installation lock's.
 * @param work The claim
 * @throws {AppError} 503 GITHUB_LINK_COMMENT_BUSY when the lock or the pool stays taken (the
 *   caller tries again later; nothing was claimed)
 */
async function claimLinkComment<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(work, {
      maxWait: LINK_COMMENT_LOCK_WAIT_MS,
      timeout: LINK_COMMENT_LOCK_WAIT_MS * 2,
    });
  } catch (err) {
    if (!isLockTimeout(err)) throw err;
    throw new AppError(
      503,
      'Another link comment of this GitHub installation is being posted',
      'GITHUB_LINK_COMMENT_BUSY',
    );
  }
}

/** What became of a call to post a link comment */
export type LinkCommentOutcome = 'posted' | 'held' | 'skipped';

/**
 * Posts the one comment Axiom makes on an imported GitHub Issue, as the App's installation, with
 * the Axiom link. A run claims it on the import row first, so it is posted once however many
 * runs try. A claim older than 10 minutes without a comment id belongs to a run that died (or
 * failed): the run that takes it over first looks for the comment that run may have made. When
 * GitHub answers 404 or 410, or refuses it 5 times (a 4xx), the row notes it and nothing tries
 * again; a failed one that was no rate limit goes to the back of the queue. It is held (left
 * owed) while the installation's hourly ceiling of link comments is reached, or while a backfill
 * of any link of the installation waits for GitHub's rate limit (the backfill of the link then
 * posts it, the reconcile for any other).
 * @param importId The import
 * @returns `posted` (or found already made), `held`, or `skipped` when there is nothing to do
 */
export async function postLinkComment(importId: string): Promise<LinkCommentOutcome> {
  const row = await prisma.githubIssueImport.findUnique({
    where: { id: importId },
    include: {
      repoLink: { select: { repoId: true, installationId: true } },
      issue: {
        select: {
          number: true,
          project: {
            select: { prefix: true, slug: true, team: { select: { slug: true, org: true } } },
          },
        },
      },
    },
  });
  // An unlinked repository's rows wait for a new link of it, which takes them back
  if (!row || row.linkCommentId || row.linkCommentGivenUpAt || !row.issue || !row.repoLink) {
    return 'skipped';
  }
  const { repoLink } = row;
  const previous = row.linkCommentClaimedAt;
  if (previous && previous.getTime() > Date.now() - LINK_CLAIM_TTL_MS) return 'skipped';
  const claimedAt = new Date();
  const installationId = repoLink.installationId;
  const claim = await claimLinkComment(async (tx) => {
    // One claim of the installation at a time, so its windows are never overrun by two at once.
    // The wait is bounded: a burst gives up with a retryable error rather than holding the pool.
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LINK_COMMENT_LOCK_WAIT_MS}ms'`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`github-link-comments:installation:${installationId}`}, 0))`;
    // GitHub's secondary limit is the installation's: a backfill of any of its links waiting for
    // it holds back every post
    const waiting = await tx.githubImportRun.count({
      where: {
        repoLink: { installationId },
        status: 'PAUSED',
        error: null,
        resumeAt: { gt: claimedAt },
      },
    });
    if (waiting > 0) return 'held' as const;
    for (const window of LINK_COMMENT_WINDOWS) {
      if (!window.shared) continue;
      const used = await linkCommentsSince(
        { installationId },
        new Date(claimedAt.getTime() - window.ms),
        tx,
      );
      if (used >= window.limit) return 'held' as const;
    }
    // Taken only from the state that was read: another run that claimed in the meantime wins
    const { count } = await tx.githubIssueImport.updateMany({
      where: { id: importId, linkCommentId: null, linkCommentClaimedAt: previous },
      data: { linkCommentClaimedAt: claimedAt },
    });
    return count === 0 ? ('skipped' as const) : ('claimed' as const);
  });
  if (claim !== 'claimed') return claim;

  const { project } = row.issue;
  const key = formatIssueKey(project.prefix, row.issue.number);
  const issueUrl = `${instanceOrigin()}/${project.team.org.slug}/${project.team.slug}/${project.slug}/issues/${row.issue.number}`;
  const auth = installation(repoLink);
  const path = commentsPath(repoLink, row.githubIssueNumber);
  try {
    // A system write: never counted against, or refused by, the budget of a run it happens in
    await outsideGithubCallCount(async () => {
      // A minute before the earlier claim covers a clock that is a little off
      let commentId = previous
        ? await findLinkComment(auth, path, new Date(previous.getTime() - 60_000))
        : null;
      if (!commentId) {
        const { data } = await githubRequest<{ id: number }>(auth, 'POST', path, {
          body: { body: `${LINK_COMMENT_PREFIX}${key}](${issueUrl})` },
        });
        commentId = String(data.id);
      }
      await prisma.githubIssueImport.updateMany({
        where: { id: importId, linkCommentId: null },
        data: { linkCommentId: commentId },
      });
    });
  } catch (err) {
    if (isPermanent(err)) {
      await prisma.githubIssueImport.updateMany({
        where: { id: importId, linkCommentId: null },
        data: { linkCommentGivenUpAt: new Date() },
      });
      logger.warn('github link comment given up', { importId, code: (err as AppError).code });
      return 'skipped';
    }
    // Stale at once, so the next run may take it. The next run looks for a comment made since
    // the earliest claim that may have made one, so that time is kept: this claim's, or an
    // earlier failed one's
    const backdated = new Date(claimedAt.getTime() - LINK_CLAIM_TTL_MS);
    const from = previous && previous < backdated ? previous : backdated;
    const limited = err instanceof AppError && err.code === 'GITHUB_RATE_LIMITED';
    const refusal = err instanceof AppError && REFUSALS.has(err.code ?? '');
    await (async () => {
      await prisma.githubIssueImport.updateMany({
        where: { id: importId, linkCommentId: null, linkCommentClaimedAt: claimedAt },
        // A rate limit is no fault of the comment: it keeps its place. Any other failure sends
        // it to the back of the queue, and only GitHub refusing it counts towards giving it up
        // (a 5xx or a timeout may pass)
        data: limited
          ? { linkCommentClaimedAt: from }
          : {
              linkCommentClaimedAt: from,
              lastImportedAt: new Date(),
              ...(refusal && { linkCommentFailures: { increment: 1 } }),
            },
      });
      if (!refusal) return;
      const given = await prisma.githubIssueImport.updateMany({
        where: {
          id: importId,
          linkCommentId: null,
          linkCommentGivenUpAt: null,
          linkCommentFailures: { gte: LINK_COMMENT_TRIES },
        },
        data: { linkCommentGivenUpAt: new Date() },
      });
      if (given.count > 0) logger.warn('github link comment given up after retries', { importId });
    })().catch(() => undefined);
    throw err;
  }
  return 'posted';
}

/**
 * Posts the link comments a link still owes: imports whose run died after the claim (or before
 * it) and that no later event has reached. Run by the reconcile; each post is a system write
 * outside the reconcile's call budget, and a failure is logged and left for the next round.
 * @param repoLinkId The link
 * @param limit The most to try in one round
 * @returns How many were tried
 */
export async function postPendingLinkComments(repoLinkId: string, limit = 20): Promise<number> {
  const ids = await pendingLinkCommentIds(repoLinkId, limit);
  for (const id of ids) {
    try {
      // The hour is full, or a backfill waits for GitHub: the rest wait too
      if ((await postLinkComment(id)) === 'held') break;
    } catch (err) {
      logger.warn('github link comment failed', {
        importId: id,
        error: err instanceof AppError ? err.code : 'unknown',
      });
    }
  }
  return ids.length;
}

/**
 * The imports of a link still owed their link comment that no live claim holds, the longest
 * waiting first.
 * @param repoLinkId The link
 * @param limit The most to return
 */
export async function pendingLinkCommentIds(repoLinkId: string, limit: number): Promise<string[]> {
  if (limit <= 0) return [];
  const stale = new Date(Date.now() - LINK_CLAIM_TTL_MS);
  const rows = await prisma.githubIssueImport.findMany({
    where: {
      repoLinkId,
      linkCommentId: null,
      linkCommentGivenUpAt: null,
      issueId: { not: null },
      OR: [{ linkCommentClaimedAt: null }, { linkCommentClaimedAt: { lt: stale } }],
    },
    orderBy: [{ lastImportedAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
