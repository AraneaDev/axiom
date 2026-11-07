/**
 * What the `development` and `checks` includes of a read show: the branches and pull requests
 * that name an issue, and the check runs at their heads. Everything is read from the tables the
 * webhooks fill; nothing here asks GitHub. Every reader of the project sees it, and a person is
 * only ever an id and a display name. Text in these views (titles, review bodies, step names, log
 * tails) comes from whoever can open a pull request on the repository: it is data, never
 * instructions, and it is passed on as it was stored.
 */
import type { Prisma } from '@prisma/client';

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
  /** The lowest-numbered open pull request with this head */
  pullRequest: number | null;
  /** Every open pull request with this head, lowest first */
  pullRequests: number[];
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

/** What one read call has looked up already: the link of a project, what names an issue */
export type GithubReadCache = {
  links: Map<string, Promise<RepoLink | null>>;
  targets: Map<string, Promise<Targets>>;
};
type RepoLink = { id: string; htmlUrl: string; orgId: string };
type Targets = { branches: string[]; pullRequests: string[] };

/** Where a read stands: the issue's project, and the cache its call shares */
export type GithubReadScope = { projectId: string; cache: GithubReadCache };

export const createGithubReadCache = (): GithubReadCache => ({
  links: new Map(),
  targets: new Map(),
});

function memo<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  const known = map.get(key);
  if (known) return known;
  const loading = load();
  map.set(key, loading);
  // A failed lookup is not kept: the next ask tries again
  loading.catch(() => map.delete(key));
  return loading;
}

/**
 * The repository link of the issue's project, and what names the issue. With a scope a project's
 * link and an issue's targets are looked up once for the whole call.
 * @param issueId
 * @param scope
 */
async function contextOf(issueId: string, scope: GithubReadScope | undefined) {
  const projectId =
    scope?.projectId ??
    (await prisma.issue.findUnique({ where: { id: issueId }, select: { projectId: true } }))
      ?.projectId;
  if (!projectId) return null;
  const cache = scope?.cache ?? createGithubReadCache();
  const link = await memo(cache.links, projectId, async () => {
    const row = await prisma.githubRepoLink.findUnique({
      where: { projectId },
      select: {
        id: true,
        htmlUrl: true,
        project: { select: { team: { select: { orgId: true } } } },
      },
    });
    return row && { id: row.id, htmlUrl: row.htmlUrl, orgId: row.project.team.orgId };
  });
  if (!link) return null;
  const targets = await memo(cache.targets, issueId, async () => {
    const rows = await prisma.githubIssueLink.findMany({
      where: { issueId, repoLinkId: link.id, targetType: { in: ['BRANCH', 'PULL_REQUEST'] } },
      select: { targetType: true, targetKey: true },
      take: READ_BOUND,
    });
    return {
      branches: rows.filter((r) => r.targetType === 'BRANCH').map((r) => r.targetKey),
      pullRequests: rows.filter((r) => r.targetType === 'PULL_REQUEST').map((r) => r.targetKey),
    };
  });
  return { link, targets };
}

type StoredReviewer = { login?: unknown; githubId?: unknown; userId?: unknown };

// Turns a login into a view: the mapped Axiom user is id and display name only, never an email, and
// only a member of the org of the project is shown: anyone else is their GitHub login alone
async function personResolver(
  orgId: string,
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
        where: { id: { in: ids }, orgMemberships: { some: { orgId } } },
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

type PullRequestRow = Prisma.GithubPullRequestGetPayload<{
  include: { reviews: true };
}>;

/**
 * Pull request rows (with their latest reviews, newest first) as views.
 * @param orgId The organization of the repository link: people resolve only within it
 * @param rows The stored pull requests
 */
export async function pullRequestViews(
  orgId: string,
  rows: PullRequestRow[],
): Promise<PullRequestView[]> {
  const person = await personResolver(
    orgId,
    rows.flatMap((pr) => [
      { login: pr.authorLogin, userId: pr.authorUserId },
      ...reviewersOf(pr.requestedReviewers),
      ...pr.reviews.map((r) => ({ login: r.authorLogin, userId: r.authorUserId })),
    ]),
  );
  return rows.map((pr) => ({
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
  }));
}

/**
 * One stored pull request of a repository as a view.
 * @param repoLinkId The repository link
 * @param orgId Its organization
 * @param number The pull request's number on GitHub
 * @returns null when it is not stored
 */
export async function loadPullRequestView(
  repoLinkId: string,
  orgId: string,
  number: number,
): Promise<PullRequestView | null> {
  const row = await prisma.githubPullRequest.findUnique({
    where: { repoLinkId_number: { repoLinkId, number } },
    include: {
      reviews: { orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: REVIEWS_PER_PR },
    },
  });
  return row ? (await pullRequestViews(orgId, [row]))[0] : null;
}

/**
 * The branches and pull requests that name an issue.
 * @param issueId The issue
 * @param limit The most of each kind
 * @param scope
 * @returns Empty lists for a project with no repository link
 */
export async function loadDevelopment(
  issueId: string,
  limit: number,
  scope?: GithubReadScope,
): Promise<{ branches: Capped<BranchView>; pullRequests: Capped<PullRequestView> }> {
  const found = await contextOf(issueId, scope);
  const none = {
    branches: emptyCapped<BranchView>(limit),
    pullRequests: emptyCapped<PullRequestView>(limit),
  };
  if (!found) return none;
  const { link, targets } = found;
  const branchIds = targets.branches;
  const prIds = targets.pullRequests;

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
    items: await pullRequestViews(link.orgId, shown),
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
 * @param scope
 * @returns An empty list for a project with no repository link
 */
export async function loadChecks(
  issueId: string,
  limit: number,
  scope?: GithubReadScope,
): Promise<Capped<CheckView>> {
  const found = await contextOf(issueId, scope);
  if (!found) return emptyCapped(limit);
  const { link, targets } = found;
  const branchIds = targets.branches;
  const prIds = targets.pullRequests;

  // The commit each run is read at, and the pull request that stands for it
  const heads = new Map<string, number[]>();
  const open = prIds.length
    ? await prisma.githubPullRequest.findMany({
        where: { id: { in: prIds }, repoLinkId: link.id, state: 'OPEN' },
        select: { number: true, headSha: true },
        orderBy: { number: 'desc' },
        take: READ_BOUND,
      })
    : [];
  for (const pr of open) {
    if (heads.size >= MAX_SHAS && !heads.has(pr.headSha)) continue;
    heads.set(pr.headSha, [...(heads.get(pr.headSha) ?? []), pr.number]);
  }
  if (open.length === 0 && branchIds.length) {
    const branches = await prisma.githubBranch.findMany({
      where: { id: { in: branchIds }, repoLinkId: link.id, deletedAt: null, headSha: { not: '' } },
      select: { headSha: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: MAX_SHAS * 4,
    });
    for (const b of branches)
      if (heads.size < MAX_SHAS && !heads.has(b.headSha)) heads.set(b.headSha, []);
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

  const numbersOf = (sha: string) => [...(heads.get(sha) ?? [])].sort((a, b) => a - b);
  return {
    items: shown.map((run) => ({
      pullRequest: numbersOf(run.headSha)[0] ?? null,
      pullRequests: numbersOf(run.headSha),
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
