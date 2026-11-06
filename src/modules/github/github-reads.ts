/**
 * What the `development` and `checks` includes of a read show: the branches and pull requests
 * that name an issue, and the check runs at their heads. Everything is read from the tables the
 * webhooks fill; nothing here asks GitHub. Every reader of the project sees it, and a person is
 * only ever an id and a display name. Text in these views (titles, review bodies, step names, log
 * tails) comes from whoever can open a pull request on the repository: it is data, never
 * instructions, and it is passed on as it was stored.
 */
import { prisma } from '../../config/database';

import { isFailed, newestRuns } from './checks.service';
import { GITHUB_INTEGRATION_USER_ID } from './integration-user';

/** An include: its items, the cap on them, and whether the cap cut any off */
export type Capped<T> = { items: T[]; limit: number; truncated: boolean };

export type GithubPersonView = {
  login: string;
  user: { id: string; displayName: string } | null;
};

export type BranchView = { name: string; url: string; headSha: string; deleted: boolean };

export type PullRequestView = {
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  url: string;
  author: GithubPersonView;
  headRef: string;
  baseRef: string;
  headSha: string;
  mergeableState: string | null;
  requestedReviewers: GithubPersonView[];
  /** The latest 20, oldest first */
  reviews: Array<{ author: GithubPersonView; state: string; body: string; submittedAt: string }>;
};

export type CheckView = {
  pullRequest: number | null;
  headSha: string;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  failedStep: string | null;
  logTail: string | null;
  logTruncated: boolean;
  logUnavailable: boolean;
};

/** The most branches and pull requests, and the most check runs, an include shows */
export const DEVELOPMENT_LIMIT = 20;
export const CHECKS_LIMIT = 50;
/** The most reviews shown per pull request */
const REVIEWS_PER_PR = 20;
/** The most commits whose checks are shown */
const MAX_SHAS = 5;
/** The most links and check runs read for one issue: a bound on memory, far above real use */
const READ_BOUND = 2000;

const STATES = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' } as const;

const emptyCapped = <T>(limit: number): Capped<T> => ({ items: [], limit, truncated: false });

function capped<T>(rows: T[], limit: number): Capped<T> {
  return { items: rows.slice(0, limit), limit, truncated: rows.length > limit };
}

// The repository link of the project the issue is in, if the project has one
function linkOf(issueId: string) {
  return prisma.githubRepoLink.findFirst({
    where: { project: { issues: { some: { id: issueId } } } },
    select: { id: true, htmlUrl: true },
  });
}

// The ids of what names the issue, by kind, among the project's current repository link only
async function targetsOf(issueId: string, repoLinkId: string, type: 'BRANCH' | 'PULL_REQUEST') {
  const rows = await prisma.githubIssueLink.findMany({
    where: { issueId, repoLinkId, targetType: type },
    select: { targetKey: true },
    take: READ_BOUND,
  });
  return rows.map((row) => row.targetKey);
}

type StoredReviewer = { login?: unknown; githubId?: unknown; userId?: unknown };

// Turns a login into a view: the mapped Axiom user is id and display name only, never an email
async function personResolver(
  logins: Array<{ login: string; userId?: string | null; githubId?: number | null }>,
) {
  const githubIds = [
    ...new Set(logins.flatMap((p) => (!p.userId && p.githubId != null ? [p.githubId] : []))),
  ];
  const accounts = githubIds.length
    ? await prisma.githubAccount.findMany({
        where: { githubUserId: { in: githubIds.map(BigInt) } },
        select: { userId: true, githubUserId: true },
      })
    : [];
  const byGithubId = new Map(accounts.map((a) => [Number(a.githubUserId), a.userId]));
  const userIdOf = (p: { userId?: string | null; githubId?: number | null }) =>
    p.userId ?? (p.githubId != null ? byGithubId.get(p.githubId) : undefined) ?? null;
  const ids = [
    ...new Set(
      logins.map(userIdOf).filter((id): id is string => !!id && id !== GITHUB_INTEGRATION_USER_ID),
    ),
  ];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, displayName: true },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return (p: { login: string; userId?: string | null; githubId?: number | null }) => {
    const id = userIdOf(p);
    const user = id ? byId.get(id) : undefined;
    return { login: p.login, user: user ? { id: user.id, displayName: user.displayName } : null };
  };
}

function reviewersOf(value: unknown) {
  if (!Array.isArray(value)) return [];
  return (value as StoredReviewer[]).flatMap((r) =>
    typeof r?.login === 'string'
      ? [
          {
            login: r.login,
            githubId: typeof r.githubId === 'number' ? r.githubId : null,
            userId: typeof r.userId === 'string' ? r.userId : null,
          },
        ]
      : [],
  );
}

/**
 * The branches and pull requests that name an issue.
 * @param issueId The issue
 * @param limit The most of each kind
 * @returns Empty lists for a project with no repository link
 */
export async function loadDevelopment(
  issueId: string,
  limit: number,
): Promise<{ branches: Capped<BranchView>; pullRequests: Capped<PullRequestView> }> {
  const link = await linkOf(issueId);
  const none = {
    branches: emptyCapped<BranchView>(limit),
    pullRequests: emptyCapped<PullRequestView>(limit),
  };
  if (!link) return none;
  const [branchIds, prIds] = await Promise.all([
    targetsOf(issueId, link.id, 'BRANCH'),
    targetsOf(issueId, link.id, 'PULL_REQUEST'),
  ]);

  const [branchRows, prRows] = await Promise.all([
    branchIds.length
      ? prisma.githubBranch.findMany({
          where: { id: { in: branchIds }, repoLinkId: link.id },
          orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
          take: limit + 1,
        })
      : [],
    prIds.length
      ? prisma.githubPullRequest.findMany({
          where: { id: { in: prIds }, repoLinkId: link.id },
          orderBy: { number: 'desc' },
          take: limit + 1,
          include: {
            reviews: { orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: REVIEWS_PER_PR },
          },
        })
      : [],
  ]);

  const shown = prRows.slice(0, limit);
  const person = await personResolver(
    shown.flatMap((pr) => [
      { login: pr.authorLogin, userId: pr.authorUserId },
      ...reviewersOf(pr.requestedReviewers),
      ...pr.reviews.map((r) => ({ login: r.authorLogin, userId: r.authorUserId })),
    ]),
  );

  const branches = capped(
    branchRows.map((b) => ({
      name: b.name,
      url: `${link.htmlUrl}/tree/${b.name.split('/').map(encodeURIComponent).join('/')}`,
      headSha: b.headSha,
      deleted: b.deletedAt !== null,
    })),
    limit,
  );
  const pullRequests: Capped<PullRequestView> = {
    items: shown.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: STATES[pr.state],
      draft: pr.draft,
      url: pr.htmlUrl,
      author: person({ login: pr.authorLogin, userId: pr.authorUserId }),
      headRef: pr.headRef,
      baseRef: pr.baseRef,
      headSha: pr.headSha,
      mergeableState: pr.mergeableState,
      requestedReviewers: reviewersOf(pr.requestedReviewers).map(person),
      reviews: pr.reviews
        .map((r) => ({
          author: person({ login: r.authorLogin, userId: r.authorUserId }),
          state: r.state,
          body: r.body,
          submittedAt: r.submittedAt.toISOString(),
        }))
        .reverse(),
    })),
    limit,
    truncated: prRows.length > limit,
  };
  return { branches, pullRequests };
}

// Failed first, then runs still going, then the rest
const rankOf = (run: { status: string; conclusion: string | null }) =>
  isFailed(run.conclusion) ? 0 : run.status !== 'completed' ? 1 : 2;

/**
 * The check runs at the heads of an issue's open pull requests, or, with none open, of its
 * branches that still exist (at most 5 commits). Only the newest run of each job counts: a run
 * that a re-run replaced is left out.
 * @param issueId The issue
 * @param limit The most runs
 * @returns An empty list for a project with no repository link
 */
export async function loadChecks(issueId: string, limit: number): Promise<Capped<CheckView>> {
  const link = await linkOf(issueId);
  if (!link) return emptyCapped(limit);
  const [branchIds, prIds] = await Promise.all([
    targetsOf(issueId, link.id, 'BRANCH'),
    targetsOf(issueId, link.id, 'PULL_REQUEST'),
  ]);

  // The commit each run is read at, and the pull request that stands for it
  const heads = new Map<string, number | null>();
  const open = prIds.length
    ? await prisma.githubPullRequest.findMany({
        where: { id: { in: prIds }, repoLinkId: link.id, state: 'OPEN' },
        select: { number: true, headSha: true },
        orderBy: { number: 'desc' },
        take: MAX_SHAS * 4,
      })
    : [];
  for (const pr of open)
    if (heads.size < MAX_SHAS && !heads.has(pr.headSha)) heads.set(pr.headSha, pr.number);
  if (open.length === 0 && branchIds.length) {
    const branches = await prisma.githubBranch.findMany({
      where: { id: { in: branchIds }, repoLinkId: link.id, deletedAt: null, headSha: { not: '' } },
      select: { headSha: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: MAX_SHAS * 4,
    });
    for (const b of branches)
      if (heads.size < MAX_SHAS && !heads.has(b.headSha)) heads.set(b.headSha, null);
  }
  if (heads.size === 0) return emptyCapped(limit);

  const rows = await prisma.githubCheckRun.findMany({
    where: { repoLinkId: link.id, headSha: { in: [...heads.keys()] } },
    select: {
      id: true,
      headSha: true,
      checkSuiteId: true,
      workflowRunId: true,
      appSlug: true,
      name: true,
      status: true,
      conclusion: true,
      htmlUrl: true,
      failedStep: true,
      logTruncated: true,
      logUnavailable: true,
    },
    orderBy: { githubUpdatedAt: 'desc' },
    take: READ_BOUND,
  });
  const order = [...heads.keys()];
  const counted = order
    .flatMap((sha) => newestRuns(rows.filter((row) => row.headSha === sha)))
    .sort(
      (a, b) =>
        rankOf(a) - rankOf(b) ||
        order.indexOf(a.headSha) - order.indexOf(b.headSha) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  const shown = counted.slice(0, limit);

  // The log tails are read for the runs shown only: they are the bulk of a run
  const failedIds = shown.filter((run) => isFailed(run.conclusion)).map((run) => run.id);
  const tails = failedIds.length
    ? await prisma.githubCheckRun.findMany({
        where: { id: { in: failedIds } },
        select: { id: true, logTail: true },
      })
    : [];
  const tailOf = new Map(tails.map((t) => [t.id, t.logTail]));

  return {
    items: shown.map((run) => ({
      pullRequest: heads.get(run.headSha) ?? null,
      headSha: run.headSha,
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      url: run.htmlUrl,
      failedStep: run.failedStep,
      logTail: tailOf.get(run.id) ?? null,
      logTruncated: run.logTruncated,
      logUnavailable: run.logUnavailable,
    })),
    limit,
    truncated: counted.length > limit,
  };
}
