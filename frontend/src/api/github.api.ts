import { del, get, post } from './client';

export interface GithubInstallation {
  /** A number; a string only for an id above 2^53 - 1 */
  id: number | string;
  accountLogin: string;
  suspended: boolean;
  /** GitHub no longer has it: uninstalled, as opposed to suspended */
  removed: boolean;
}

export interface GithubAppStatus {
  configured: boolean;
  slug?: string;
  htmlUrl?: string;
  installUrl?: string;
  installations: GithubInstallation[];
}

export interface GithubManifestStart {
  postUrl: string;
  manifest: Record<string, unknown>;
  state: string;
}

export interface GithubAccountStatus {
  connected: boolean;
  login?: string;
  githubUserId?: number | string;
}

/** The query keys of the App's status and of your own account */
export const GITHUB_APP_KEY = ['github-app'];
export const GITHUB_ACCOUNT_KEY = ['github-account'];

export const githubAppApi = {
  status: () => get<GithubAppStatus>('/github/app'),
  startManifest: (organization?: string) =>
    post<GithubManifestStart>('/github/app/manifest', organization ? { organization } : {}),
  completeManifest: (code: string, state: string) =>
    post<GithubAppStatus>('/github/app/manifest/complete', { code, state }),
  syncInstallations: () => post<GithubAppStatus>('/github/app/installations/sync', {}),
  remove: () => del<{ deleted: boolean; note: string }>('/github/app'),
};

export const githubAccountApi = {
  get: () => get<GithubAccountStatus>('/github/account'),
  startConnect: () => post<{ authorizeUrl: string }>('/github/account/connect', {}),
  completeConnect: (code: string, state: string) =>
    post<GithubAccountStatus>('/github/account/connect/complete', { code, state }),
  disconnect: () => del<GithubAccountStatus>('/github/account'),
};

/** A person on GitHub; `user` is the Axiom account it maps to, inside the org */
export interface GithubPerson {
  login: string;
  user: { id: string; displayName: string } | null;
}

export interface GithubBranchView {
  name: string;
  url: string;
  headSha: string;
  deleted: boolean;
}

export interface GithubReviewView {
  author: GithubPerson;
  state: string;
  body: string;
  submittedAt: string;
}

export type GithubPrState = 'open' | 'closed' | 'merged';

export interface GithubPullRequestView {
  number: number;
  title: string;
  state: GithubPrState;
  draft: boolean;
  url: string;
  author: GithubPerson;
  headRef: string;
  baseRef: string;
  headSha: string;
  mergeableState: string | null;
  requestedReviewers: GithubPerson[];
  reviews: GithubReviewView[];
}

export interface GithubCheckView {
  pullRequest: number | null;
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
}

interface Capped<T> {
  items: T[];
  limit: number;
  truncated: boolean;
}

/** The `development` and `checks` includes of the issue read */
export interface IssueDevelopment {
  development?: {
    branches: Capped<GithubBranchView>;
    pullRequests: Capped<GithubPullRequestView>;
  };
  checks?: Capped<GithubCheckView>;
}

export interface GithubRepoLink {
  id: string;
  projectId: string;
  repoFullName: string;
  owner: string;
  name: string;
  htmlUrl: string;
  defaultBranch: string;
  linkedBy: { id: string; username: string; displayName: string } | null;
  createdAt: string;
  /** How many issues have branches, pull requests or checks from this link */
  linkedIssueCount: number;
}

export interface GithubDeliveryFailure {
  deliveryId: string;
  event: string;
  action: string | null;
  error: string | null;
  attempts: number;
  receivedAt: string;
}

export interface GithubLinkHealth {
  linked: boolean;
  repoFullName?: string;
  appInstalled: boolean;
  /** The installation was removed on GitHub (appInstalled is false too) */
  installationRemoved: boolean;
  installationSuspended: boolean;
  appSecretUnreadable: boolean;
  lastDeliveryAt: string | null;
  lastReconciledAt: string | null;
  lastReconcileError: string | null;
  reconcileComplete: boolean;
  reconcileIncompleteReason: string | null;
  recentFailures: GithubDeliveryFailure[];
}

export const githubRepoKey = (projectId: string | undefined) => ['github-repo', projectId];
export const githubHealthKey = (projectId: string | undefined) => ['github-health', projectId];
/**
 * Under `['issue-hydrate', projectId]`, which the realtime event `issue:development-updated` refetches
 * @param projectId
 * @param issueNumber
 */
export const issueDevelopmentKey = (
  projectId: string | undefined,
  issueNumber: string | undefined,
) => ['issue-development', projectId, issueNumber];

export const githubRepoApi = {
  get: (projectId: string) => get<GithubRepoLink | null>(`/projects/${projectId}/github`),
  link: (projectId: string, repo: string) =>
    post<GithubRepoLink>(`/projects/${projectId}/github`, { repo }),
  unlink: (projectId: string) => del<{ unlinked: boolean }>(`/projects/${projectId}/github`),
  reconcile: (projectId: string) =>
    post<{ complete: boolean }>(`/projects/${projectId}/github/reconcile`, {}),
  health: (projectId: string) => get<GithubLinkHealth>(`/projects/${projectId}/github/health`),
};

export const githubDevelopmentApi = {
  issue: (projectId: string, issueNumber: number) =>
    get<IssueDevelopment>(
      `/projects/${projectId}/issues/${issueNumber}/hydrate?include=development&include=checks`,
    ),
};
