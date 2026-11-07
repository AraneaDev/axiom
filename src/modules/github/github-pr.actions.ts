import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';
import { strictInt } from '../../utils/validation/common-validators';

import { isFailed, newestRuns } from './checks.service';
import {
  assertRefName,
  githubWrite,
  issueRepo,
  issueTarget,
  linkedPullRequest,
  namesIssue,
  userAuth,
} from './github-actions.helpers';
import { githubRequest, type GithubAuth } from './github-client';
import { storePullRequest, type PullRequestPayload } from './github-events';
import { loadPullRequestView, type PullRequestView } from './github-reads';

const PULLS = '/api/projects/:projectId/issues/:issueNumber/github/pulls';

/** GitHub's own limit on a pull request body and a comment, in characters */
const MAX_TEXT = 65536;
const MAX_TITLE = 256;
const MAX_REVIEWERS = 15;
// A GitHub login: letters, digits and single hyphens inside, up to 39 characters
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

const NOT_RERUNNABLE = 'only the app that created this check can re-run it';

const pullNumber = strictInt;
const pullTarget = issueTarget.extend({ pullNumber });

/** What a pull request answer of GitHub must hold to be stored as it is, without another GET */
const completePull = z.looseObject({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.enum(['open', 'closed']),
  head: z.looseObject({ ref: z.string(), sha: z.string() }),
  base: z.looseObject({ ref: z.string() }),
  html_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const pullView = z.looseObject({
  number: z.number(),
  title: z.string(),
  state: z.string(),
  url: z.string(),
});

const repoPath = (link: { owner: string; name: string }) =>
  `/repos/${encodeURIComponent(link.owner)}/${encodeURIComponent(link.name)}`;

type Link = Awaited<ReturnType<typeof issueRepo>>['link'] & { orgId: string };

/**
 * The issue and its repository link, with the organization the people resolve in.
 * @param projectId The project
 * @param issueNumber The issue's number
 */
async function prRepo(projectId: string, issueNumber: number) {
  const { issue, link } = await issueRepo(projectId, issueNumber);
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { team: { select: { orgId: true } } },
  });
  return { issue, link: { ...link, orgId: project.team.orgId } as Link };
}

/**
 * Stores the pull request GitHub answered with (or, when that answer is not the whole object,
 * the one it names, fetched now) as the action's own change, so the next read shows it before
 * GitHub's webhook arrives. Never trusts the stored mergeable state for a merge: that is read
 * fresh by the merge itself.
 * @param auth The credential of the call
 * @param link The repository link
 * @param account The caller's GitHub identity, stored as the sender
 * @param account.githubUserId Its GitHub id
 * @param account.login
 * @param number The pull request's number
 * @param answer What GitHub answered with
 * @returns The stored pull request as a view
 */
async function storeAndView(
  auth: GithubAuth,
  link: Link,
  account: { githubUserId: number; login: string },
  number: number,
  answer: unknown,
): Promise<PullRequestView> {
  let payload = completePull.safeParse(answer);
  if (!payload.success) {
    // The write succeeded: a failed GET only costs the stored copy
    const fetched = await githubRequest<unknown>(
      auth,
      'GET',
      `${repoPath(link)}/pulls/${number}`,
    ).catch(() => null);
    if (fetched) payload = completePull.safeParse(fetched.data);
  }
  let storedOk = false;
  if (payload.success) {
    storedOk = await storePullRequest(
      link.id,
      payload.data as PullRequestPayload,
      { id: account.githubUserId, login: account.login },
      'action',
    ).then(
      () => true,
      (err: unknown) => {
        logger.warn('github pull request changed but not stored', {
          repoLinkId: link.id,
          pullRequest: number,
          error: err instanceof Error ? err.message : 'unknown',
        });
        return false;
      },
    );
  }
  // A store that failed leaves the old row (or none): GitHub's own answer is the truth
  const stored = storedOk
    ? await loadPullRequestView(link.id, link.orgId, number).catch(() => null)
    : null;
  if (stored) return stored;
  return viewFromAnswer(link, { number, ...(payload.success ? payload.data : (answer as object)) });
}

/**
 * A pull request view built from GitHub's own object, for when the stored row could not be
 * written. People are not resolved to Axiom users and there are no reviews.
 * @param link The repository link
 * @param raw What GitHub answered with, as far as it is there
 */
function viewFromAnswer(link: Link, raw: Record<string, unknown>): PullRequestView {
  const text = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
  const ref = (v: unknown) => text((v as { ref?: unknown } | null)?.ref);
  const login = (v: unknown) => text((v as { login?: unknown } | null)?.login, 'ghost');
  const number = Number(raw.number);
  const html = text(raw.html_url);
  const reviewers = Array.isArray(raw.requested_reviewers) ? raw.requested_reviewers : [];
  return {
    number,
    title: text(raw.title),
    state:
      raw.merged_at || raw.merged === true ? 'merged' : raw.state === 'closed' ? 'closed' : 'open',
    draft: raw.draft === true,
    url: html.startsWith('https://') ? html : `${link.htmlUrl}/pull/${number}`,
    author: { login: login(raw.user), user: null },
    headRef: ref(raw.head),
    baseRef: ref(raw.base),
    headSha: text((raw.head as { sha?: unknown } | null)?.sha),
    mergeableState: typeof raw.mergeable_state === 'string' ? raw.mergeable_state : null,
    requestedReviewers: reviewers.map((r) => ({ login: login(r), user: null })),
    reviews: [],
  };
}

/**
 * The number of the open pull request for a branch, when GitHub can say.
 * @param auth The credential of the call
 * @param link The repository link
 * @param head The branch
 */
async function openPullOf(auth: GithubAuth, link: Link, head: string): Promise<number | null> {
  try {
    const found = await githubRequest<unknown>(auth, 'GET', `${repoPath(link)}/pulls`, {
      query: { head: `${link.owner}:${head}`, state: 'open', per_page: '1' },
    });
    const first = z.array(z.looseObject({ number: z.number().int() })).safeParse(found.data);
    return first.success && first.data.length ? first.data[0].number : null;
  } catch {
    return null;
  }
}

registerActions([
  defineAction({
    name: 'githubPr.open',
    area: 'github',
    kind: 'write',
    summary:
      'Open a pull request on the linked GitHub repository for an issue, as your own GitHub ' +
      'account. The head branch or the title must contain the issue key.',
    target: issueTarget,
    input: issueTarget.extend({
      head: z.string().min(1).max(200).describe('The branch with the changes'),
      base: z.string().min(1).max(200).optional().describe('Default: the default branch'),
      title: z
        .string()
        .min(1)
        .max(MAX_TITLE)
        .optional()
        .describe('Default: the issue key and title'),
      body: z.string().max(MAX_TEXT).optional(),
      draft: z.boolean().optional(),
    }),
    output: pullView,
    rest: { method: 'POST', path: PULLS },
    authorize: githubWrite,
    handler: async (ctx, { projectId, issueNumber, head, base: givenBase, title, body, draft }) => {
      const { issue, link } = await prRepo(projectId, issueNumber);
      if (head.includes(':')) {
        throw new AppError(
          400,
          `Not a valid branch name: fork branches are not supported. Name a branch of ${link.fullName}, without an owner prefix`,
          'INVALID_BRANCH_NAME',
        );
      }
      assertRefName(head);
      if (givenBase !== undefined) assertRefName(givenBase);
      const finalTitle = title ?? `${issue.key} ${issue.title}`.slice(0, MAX_TITLE);
      if (!namesIssue(head, issue.key) && !namesIssue(finalTitle, issue.key)) {
        throw new AppError(
          400,
          `The head branch or the title must contain the issue key ${issue.key}, so the pull request links to the issue`,
          'PULL_REQUEST_MUST_NAME_ISSUE',
        );
      }
      const { auth, account } = await userAuth(ctx);
      const created = await githubRequest<unknown>(auth, 'POST', `${repoPath(link)}/pulls`, {
        body: {
          title: finalTitle,
          head,
          base: givenBase ?? link.defaultBranch,
          ...(body !== undefined && { body }),
          ...(draft !== undefined && { draft }),
        },
      }).catch(async (err: unknown) => {
        if (
          err instanceof AppError &&
          err.code === 'GITHUB_INVALID' &&
          /pull request already exists/i.test(err.message)
        ) {
          const existing = await openPullOf(auth, link, head);
          throw new AppError(
            409,
            existing
              ? `A pull request for that branch already exists: #${existing}`
              : 'A pull request for that branch already exists',
            'GITHUB_PR_EXISTS',
            existing ? { number: existing } : undefined,
          );
        }
        throw err;
      });
      const number = completePull.shape.number.safeParse(
        (created.data as { number?: unknown } | null)?.number,
      );
      if (!number.success) {
        throw new AppError(
          502,
          'GitHub answered, but not with a pull request.',
          'GITHUB_UNAVAILABLE',
        );
      }
      return storeAndView(auth, link, account, number.data, created.data);
    },
  }),

  defineAction({
    name: 'githubPr.update',
    area: 'github',
    kind: 'write',
    summary:
      'Change the title, body or base branch of a pull request linked to an issue, as your own ' +
      'GitHub account. At least one of them is required.',
    target: pullTarget,
    input: pullTarget.extend({
      title: z.string().min(1).max(MAX_TITLE).optional(),
      body: z.string().max(MAX_TEXT).optional(),
      base: z.string().min(1).max(200).optional(),
    }),
    output: pullView,
    rest: { method: 'PATCH', path: `${PULLS}/:pullNumber` },
    authorize: githubWrite,
    handler: async (ctx, { projectId, issueNumber, pullNumber: number, title, body, base }) => {
      if (title === undefined && body === undefined && base === undefined) {
        throw new AppError(
          400,
          'Give a title, a body or a base branch to change',
          'NOTHING_TO_UPDATE',
        );
      }
      if (base !== undefined) assertRefName(base);
      const { issue, link } = await prRepo(projectId, issueNumber);
      await linkedPullRequest(issue.id, link.id, number);
      const { auth, account } = await userAuth(ctx);
      const updated = await githubRequest<unknown>(
        auth,
        'PATCH',
        `${repoPath(link)}/pulls/${number}`,
        {
          body: {
            ...(title !== undefined && { title }),
            ...(body !== undefined && { body }),
            ...(base !== undefined && { base }),
          },
        },
      );
      return storeAndView(auth, link, account, number, updated.data);
    },
  }),

  defineAction({
    name: 'githubPr.requestReviewers',
    area: 'github',
    kind: 'write',
    summary:
      'Request reviews on a pull request linked to an issue, as your own GitHub account. ' +
      'Name reviewers by GitHub login, or by Axiom user id when they connected GitHub; 1 to 15 together.',
    target: pullTarget,
    input: pullTarget.extend({
      logins: z.array(z.string().min(1).max(100)).max(MAX_REVIEWERS).optional(),
      userIds: z.array(z.string().min(1).max(100)).max(MAX_REVIEWERS).optional(),
    }),
    output: pullView,
    rest: { method: 'POST', path: `${PULLS}/:pullNumber/reviewers` },
    authorize: githubWrite,
    handler: async (ctx, { projectId, issueNumber, pullNumber: number, logins, userIds }) => {
      const total = (logins?.length ?? 0) + (userIds?.length ?? 0);
      if (total < 1 || total > MAX_REVIEWERS) {
        throw new AppError(
          400,
          `Name 1 to ${MAX_REVIEWERS} reviewers, by login or user id`,
          'INVALID_REVIEWERS',
        );
      }
      for (const login of logins ?? []) {
        if (!LOGIN.test(login)) {
          throw new AppError(400, `"${login}" is not a GitHub login`, 'INVALID_REVIEWERS');
        }
      }
      const { issue, link } = await prRepo(projectId, issueNumber);
      await linkedPullRequest(issue.id, link.id, number);
      const mapped = await loginsOfUsers(userIds ?? [], link.orgId);
      const reviewers = [
        ...new Map([...(logins ?? []), ...mapped].map((l) => [l.toLowerCase(), l])).values(),
      ];
      const { auth, account } = await userAuth(ctx);
      const answer = await githubRequest<unknown>(
        auth,
        'POST',
        `${repoPath(link)}/pulls/${number}/requested_reviewers`,
        { body: { reviewers } },
      );
      return storeAndView(auth, link, account, number, answer.data);
    },
  }),

  defineAction({
    name: 'githubPr.comment',
    area: 'github',
    kind: 'write',
    summary: 'Comment on a pull request linked to an issue, as your own GitHub account.',
    target: pullTarget,
    input: pullTarget.extend({ body: z.string().min(1).max(MAX_TEXT) }),
    output: z.looseObject({ id: z.string(), url: z.string() }),
    rest: { method: 'POST', path: `${PULLS}/:pullNumber/comments` },
    authorize: githubWrite,
    handler: async (ctx, { projectId, issueNumber, pullNumber: number, body }) => {
      const { issue, link } = await prRepo(projectId, issueNumber);
      await linkedPullRequest(issue.id, link.id, number);
      const { auth } = await userAuth(ctx);
      const made = await githubRequest<unknown>(
        auth,
        'POST',
        `${repoPath(link)}/issues/${number}/comments`,
        { body: { body } },
      );
      const reply = z
        .looseObject({ id: z.union([z.number(), z.string()]), html_url: z.string() })
        .safeParse(made.data);
      if (!reply.success) {
        throw new AppError(502, 'GitHub answered, but not with a comment.', 'GITHUB_UNAVAILABLE');
      }
      const url = reply.data.html_url.startsWith('https://')
        ? reply.data.html_url
        : `${link.htmlUrl}/pull/${number}`;
      return { id: String(reply.data.id), url };
    },
  }),

  defineAction({
    name: 'githubChecks.rerun',
    area: 'github',
    kind: 'write',
    summary:
      'Re-run the failed checks of a pull request linked to an issue, as your own GitHub ' +
      'account: the failed jobs of each GitHub Actions run. A failed check of another app is listed ' +
      'as not re-runnable, because only the app that created it can re-run it.',
    target: pullTarget,
    input: pullTarget,
    output: z.looseObject({
      rerun: z.array(z.object({ name: z.string(), via: z.literal('workflow') })),
      refused: z.array(z.object({ name: z.string(), message: z.string() })),
      notRerunnable: z.array(z.object({ name: z.string(), url: z.string(), reason: z.string() })),
    }),
    rest: { method: 'POST', path: `${PULLS}/:pullNumber/checks/rerun` },
    authorize: githubWrite,
    handler: async (ctx, { projectId, issueNumber, pullNumber: number }) => {
      const { issue, link } = await prRepo(projectId, issueNumber);
      const pr = await linkedPullRequest(issue.id, link.id, number);
      const rows = await prisma.githubCheckRun.findMany({
        where: { repoLinkId: link.id, headSha: pr.headSha },
        select: {
          id: true,
          checkSuiteId: true,
          workflowRunId: true,
          appSlug: true,
          name: true,
          status: true,
          conclusion: true,
          htmlUrl: true,
        },
      });
      // Only the newest run of each app, workflow run and name counts: a superseded failure is not re-run
      const failed = newestRuns(rows).filter((run) => isFailed(run.conclusion));
      if (!failed.length) {
        throw new AppError(
          409,
          'No check of this pull request has failed, so there is nothing to re-run',
          'GITHUB_NOTHING_TO_RERUN',
        );
      }
      const actions = failed.filter((run) => run.workflowRunId);
      // Only the app that created a check can re-run it, and Axiom's App creates none
      const notRerunnable = failed
        .filter((run) => !run.workflowRunId)
        .map((run) => ({
          name: run.name,
          url: run.htmlUrl.startsWith('https://') ? run.htmlUrl : '',
          reason: NOT_RERUNNABLE,
        }));
      const { auth } = await userAuth(ctx);
      const repo = repoPath(link);
      const rerun: Array<{ name: string; via: 'workflow' }> = [];
      const refused: Array<{ name: string; message: string }> = [];
      let firstRefusal: AppError | null = null;
      for (const id of new Set(actions.map((run) => run.workflowRunId as string))) {
        const names = actions.filter((run) => run.workflowRunId === id).map((run) => run.name);
        try {
          await githubRequest<unknown>(
            auth,
            'POST',
            `${repo}/actions/runs/${encodeURIComponent(id)}/rerun-failed-jobs`,
          );
          rerun.push(...names.map((name) => ({ name, via: 'workflow' as const })));
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          firstRefusal ??= err;
          refused.push(...names.map((name) => ({ name, message: err.message })));
        }
      }
      if (!rerun.length && !notRerunnable.length) {
        if (firstRefusal) throw firstRefusal;
        throw new AppError(
          409,
          'No check of this pull request has failed, so there is nothing to re-run',
          'GITHUB_NOTHING_TO_RERUN',
        );
      }
      return { rerun, refused, notRerunnable };
    },
  }),
]);

/**
 * The GitHub logins of Axiom users, within the organization of the repository. A user who has
 * not connected GitHub, or who is outside the organization, is named in the refusal.
 * @param userIds The Axiom user ids
 * @param orgId The organization of the repository link
 * @throws {AppError} 400 naming the first user that has no login to use
 */
async function loginsOfUsers(userIds: string[], orgId: string): Promise<string[]> {
  if (!userIds.length) return [];
  // Only people of this organization are looked up: an id outside it, or none at all, is
  // answered alike, so the answer says nothing about users elsewhere
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, orgMemberships: { some: { orgId } } },
    select: { id: true, displayName: true, githubAccount: { select: { login: true } } },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  if (userIds.some((id) => !byId.has(id))) {
    throw new AppError(
      400,
      "Some reviewers can't be requested: they are not connected to GitHub or not in this organization",
      'REVIEWER_NOT_CONNECTED',
    );
  }
  const unconnected = users.filter((u) => !u.githubAccount);
  if (unconnected.length) {
    throw new AppError(
      400,
      `${unconnected.map((u) => u.displayName).join(', ')} ${unconnected.length > 1 ? 'have' : 'has'} not connected a GitHub account, so cannot be asked to review`,
      'REVIEWER_NOT_CONNECTED',
    );
  }
  return userIds.map((id) => byId.get(id)?.githubAccount?.login as string);
}
