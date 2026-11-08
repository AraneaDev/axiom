// Imports GitHub Issues into the linked project and keeps them current. What each import wrote is
// remembered per field (title, body hash, labels), so a field changed in Axiom since is recognised
// and kept: GitHub's value then goes to an `import_conflict` entry, never over the Axiom edit.
// Nothing goes back to GitHub but one comment per issue, as the App, with the Axiom link.
import { createHash } from 'node:crypto';

import type { GithubIssueImport, GithubRepoLink } from '@prisma/client';
import { z } from 'zod';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { formatIssueKey } from '../../utils/issue-key';
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
import { isIntegrationUser } from './integration-user';

// Axiom's own limits: the issue title and body (issue-validators.ts), a comment body and a label
// name (common-validators.ts)
const TITLE_MAX = 200;
const BODY_MAX = 100_000;
const COMMENT_MAX = 50_000;
const LABEL_NAME_MAX = 100;
const LABELS_MAX = 20;
/** A claim on the link comment older than this belongs to a run that died: it may be taken */
const LINK_CLAIM_TTL_MS = 10 * 60_000;
/** How long an import waits for another one of the same issue before it gives up (and retries) */
const LOCK_WAIT_MS = 30_000;
/** How long the database part of one import may hold the issue */
const LOCK_HOLD_MS = 60_000;
/** Pages of comments read when an issue is imported */
const COMMENT_PAGES = 3;

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
  /** Read the issue's comments from GitHub and import them */
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
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

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
const commentsPath = (link: Pick<GithubRepoLink, 'repoId'>, number: number) =>
  `/repositories/${link.repoId}/issues/${number}/comments`;

/**
 * Runs the database part of an import while no other import of the same GitHub Issue does, so
 * an `opened` and a `labeled` delivery of one new issue make one Axiom issue. The lock is tried
 * rather than waited on: a waiter holds no connection, so a burst of deliveries cannot take the
 * pool from the import that holds the lock.
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
    const attempt = await prisma.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS locked`;
        if (!locked) return { locked: false as const };
        return { locked: true as const, value: await work() };
      },
      { maxWait: 10_000, timeout: LOCK_HOLD_MS },
    );
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
  const issue = await issuesService.createIssue(
    link.projectId,
    writer.userId,
    { title, body, labels },
    {
      skipAutomation: !opts.runRules?.created,
      skipMentions: true,
      externalAuthorLogin: writer.externalAuthorLogin,
    },
  );
  // Built from the stored repository, not from the payload's URL
  const url = `${link.htmlUrl}/issues/${gh.number}`;
  await addWebLink(link.projectId, issue.number, writer.userId, {
    url,
    title: `GitHub issue #${gh.number}`,
  });
  const row = await prisma.githubIssueImport.create({
    data: {
      repoLinkId: link.id,
      githubIssueNumber: gh.number,
      githubIssueId: String(gh.id),
      issueId: issue.id,
      mirroredTitle: title,
      mirroredBodyHash: sha256(body),
      mirroredLabels: labels,
      githubUpdatedAt: new Date(gh.updated_at),
      lastImportedAt: new Date(),
    },
  });
  await logActivity('issue', issue.id, 'imported', writer.userId, {
    githubIssueNumber: gh.number,
    url,
  });
  return {
    issueId: issue.id,
    created: true,
    conflicts: [],
    importId: row.id,
    linkCommentId: null,
  };
}

async function updateImported(
  link: GithubRepoLink,
  row: GithubIssueImport,
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
    include: { labels: { select: { name: true } } },
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
  await prisma.githubIssueImport.update({
    where: { id: row.id },
    data: { ...mirror, githubUpdatedAt: updatedAt, lastImportedAt: new Date() },
  });
  return { ...unchanged, conflicts };
}

/**
 * Imports one GitHub Issue into the linked project, or brings an imported one up to date. A new
 * one is imported only while open; a pull request never is. Title, body and labels of an
 * imported one take GitHub's value where Axiom's is still what the last import wrote, else they
 * stay and an `import_conflict` activity names the field. Imported text notifies nobody.
 * @param link The repository link
 * @param ghIssue The issue as GitHub gave it
 * @param opts Whether to import the comments, who made the change, and which writes run rules
 * @returns What was done, or null when the issue is not imported (closed, a pull request, or a
 *   payload that cannot be read)
 */
export async function importGithubIssue(
  link: GithubRepoLink,
  ghIssue: GithubIssuePayload,
  opts: ImportOptions,
): Promise<ImportResult | null> {
  const parsed = githubIssueSchema.safeParse(ghIssue);
  if (!parsed.success) return null;
  const gh = parsed.data;
  if (gh.pull_request !== undefined && gh.pull_request !== null) return null;

  const done = await underIssueLock(link.id, gh.number, async () => {
    const row = await prisma.githubIssueImport.findUnique({
      where: {
        repoLinkId_githubIssueNumber: { repoLinkId: link.id, githubIssueNumber: gh.number },
      },
    });
    if (row) return updateImported(link, row, gh, opts);
    return gh.state === 'open' ? createImported(link, gh, opts) : null;
  });
  if (!done) return null;

  if (opts.withComments) {
    const row = await prisma.githubIssueImport.findUnique({ where: { id: done.importId } });
    if (row) {
      const { items } = await githubPaginate<GithubCommentPayload>(
        installation(link),
        commentsPath(link, gh.number),
        { maxPages: COMMENT_PAGES },
      );
      for (const comment of items) await importComment(row, comment);
    }
  }
  if (!done.linkCommentId) await postLinkComment(done.importId);
  return { issueId: done.issueId, created: done.created, conflicts: done.conflicts };
}

/**
 * Imports one comment of an imported issue, or updates its Axiom copy while that is still what
 * the last import wrote (else the copy stays and an `import_conflict` names the comment). The
 * App's own link comment and every bot's comment are skipped.
 * @param importRow The import of the issue the comment is on
 * @param ghComment The comment as GitHub gave it
 */
export async function importComment(
  importRow: GithubIssueImport,
  ghComment: GithubCommentPayload,
): Promise<void> {
  const parsed = githubCommentSchema.safeParse(ghComment);
  if (!parsed.success) return;
  const gh = parsed.data;
  const githubCommentId = String(gh.id);
  if (githubCommentId === importRow.linkCommentId || gh.user?.type === 'Bot') return;
  const body = cutText(gh.body ?? '', COMMENT_MAX);
  if (!body.trim()) return;
  const bodyHash = sha256(body);
  const updatedAt = new Date(gh.updated_at);

  await underIssueLock(importRow.repoLinkId, importRow.githubIssueNumber, async () => {
    const issue = await prisma.issue.findUnique({
      where: { id: importRow.issueId },
      select: { id: true, projectId: true },
    });
    if (!issue) return;
    const mirror = await prisma.githubImportedComment.findUnique({
      where: { githubCommentId },
      include: { comment: { select: { body: true, authorId: true } } },
    });
    if (mirror) {
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
        where: { githubCommentId },
        data: { mirroredBodyHash: bodyHash, githubUpdatedAt: updatedAt },
      });
      return;
    }
    const writer = await writerOf(gh.user, issue.projectId);
    const comment = await issuesService.addComment(issue.id, writer.userId, body, {
      skipMentions: true,
      externalAuthorLogin: writer.externalAuthorLogin,
    });
    await prisma.githubImportedComment.create({
      data: {
        githubCommentId,
        importId: importRow.id,
        commentId: comment.id,
        mirroredBodyHash: bodyHash,
        githubUpdatedAt: updatedAt,
      },
    });
  });
}

type GithubComment = {
  id: number;
  body?: string | null;
  user?: { login?: string } | null;
  performed_via_github_app?: { id?: number } | null;
};

/**
 * The App's comment with the Axiom link among the first page of an issue's comments: one a run
 * that died may have made before it could store the id.
 * @param auth The installation
 * @param path The issue's comments
 * @param issueUrl The Axiom link the comment carries
 */
async function findLinkComment(
  auth: GithubAuth,
  path: string,
  issueUrl: string,
): Promise<string | null> {
  const app = await prisma.githubApp.findUnique({
    where: { id: GITHUB_APP_ROW_ID },
    select: { appId: true, slug: true },
  });
  if (!app) return null;
  const { data } = await githubRequest<GithubComment[]>(auth, 'GET', path, {
    query: { per_page: 100 },
  });
  const found = (Array.isArray(data) ? data : []).find(
    (comment) =>
      typeof comment.body === 'string' &&
      comment.body.includes(`](${issueUrl})`) &&
      (comment.performed_via_github_app?.id === Number(app.appId) ||
        comment.user?.login === `${app.slug}[bot]`),
  );
  return found ? String(found.id) : null;
}

/**
 * Posts the one comment Axiom makes on an imported GitHub Issue, as the App's installation, with
 * the Axiom link. A run claims it on the import row first, so it is posted once however many
 * runs try. A claim older than 10 minutes without a comment id belongs to a run that died: the
 * run that takes it over first looks for the comment that run may have made.
 * @param importId The import
 */
export async function postLinkComment(importId: string): Promise<void> {
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
  if (!row || row.linkCommentId) return;
  const previous = row.linkCommentClaimedAt;
  if (previous && previous.getTime() > Date.now() - LINK_CLAIM_TTL_MS) return;
  const claimedAt = new Date();
  // Taken only from the state that was read: another run that claimed in the meantime wins
  const { count } = await prisma.githubIssueImport.updateMany({
    where: { id: importId, linkCommentId: null, linkCommentClaimedAt: previous },
    data: { linkCommentClaimedAt: claimedAt },
  });
  if (count === 0) return;

  const { project } = row.issue;
  const key = formatIssueKey(project.prefix, row.issue.number);
  const issueUrl = `${instanceOrigin()}/${project.team.org.slug}/${project.team.slug}/${project.slug}/issues/${row.issue.number}`;
  const auth = installation(row.repoLink);
  const path = commentsPath(row.repoLink, row.githubIssueNumber);
  try {
    // A system write: never counted against, or refused by, the budget of a run it happens in
    await outsideGithubCallCount(async () => {
      let commentId = previous ? await findLinkComment(auth, path, issueUrl) : null;
      if (!commentId) {
        const { data } = await githubRequest<{ id: number }>(auth, 'POST', path, {
          body: { body: `Tracked in Axiom as [${key}](${issueUrl})` },
        });
        commentId = String(data.id);
      }
      await prisma.githubIssueImport.updateMany({
        where: { id: importId, linkCommentId: null },
        data: { linkCommentId: commentId },
      });
    });
  } catch (err) {
    // Free at once, but as a claim taken over: the next run first looks for a comment this one
    // may have made before it failed
    await prisma.githubIssueImport
      .updateMany({
        where: { id: importId, linkCommentId: null, linkCommentClaimedAt: claimedAt },
        data: { linkCommentClaimedAt: new Date(0) },
      })
      .catch(() => undefined);
    throw err;
  }
}
