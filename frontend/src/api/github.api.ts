import { del, get, patch, post, put } from './client';

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
  /** The wiki space release notes go to by default */
  releaseNotesSpaceId?: string | null;
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
 * The panel of one issue, under `['issue-development', projectId]`. The issue id is last because
 * the realtime event `issue:development-updated` names issue ids, and refetches only those panels.
 * @param projectId
 * @param issueNumber
 * @param issueId
 */
export const issueDevelopmentKey = (
  projectId: string | undefined,
  issueNumber: string | undefined,
  issueId: string | undefined,
) => ['issue-development', projectId, issueNumber, issueId];

export const githubRepoApi = {
  get: (projectId: string) => get<GithubRepoLink | null>(`/projects/${projectId}/github`),
  link: (projectId: string, repo: string) =>
    post<GithubRepoLink>(`/projects/${projectId}/github`, { repo }),
  unlink: (projectId: string) => del<{ unlinked: boolean }>(`/projects/${projectId}/github`),
  reconcile: (projectId: string) =>
    post<{ started: boolean }>(`/projects/${projectId}/github/reconcile`, {}),
  health: (projectId: string) => get<GithubLinkHealth>(`/projects/${projectId}/github/health`),
};

export const githubDevelopmentApi = {
  issue: (projectId: string, issueNumber: number) =>
    get<IssueDevelopment>(
      `/projects/${projectId}/issues/${issueNumber}/hydrate?include=development&include=checks`,
    ),
};

export interface GithubBranchCreated {
  name: string;
  url: string;
  headSha: string;
}

export const githubBranchApi = {
  create: (projectId: string, issueNumber: number, body: { name?: string; from?: string }) =>
    post<GithubBranchCreated>(`/projects/${projectId}/issues/${issueNumber}/github/branches`, body),
};

export type GithubImportStatusName =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED';

export interface GithubImportRun {
  status: GithubImportStatusName;
  /** Null while the open issues are still being counted */
  total: number | null;
  done: number;
  failed: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  /** Plain text, from GitHub or the server: never render it as Markdown or HTML */
  error: string | null;
  resumeAt?: string | null;
  linkCommentsWaitUntil?: string | null;
}

export interface GithubImportState {
  enabled: boolean;
  run: GithubImportRun | null;
  liveCap: { paused: boolean; resumesAt: string | null } | null;
}

export const githubImportKey = (projectId: string | undefined) => ['github-import', projectId];

export const githubImportApi = {
  status: (projectId: string) => get<GithubImportState>(`/projects/${projectId}/github/import`),
  configure: (projectId: string, enabled: boolean) =>
    put<{ enabled: boolean; queued: boolean; run: GithubImportRun | null }>(
      `/projects/${projectId}/github/import`,
      { enabled },
    ),
};

export const githubSettingsApi = {
  setReleaseNotesSpace: (projectId: string, releaseNotesSpaceId: string | null) =>
    patch<{ repoFullName: string; releaseNotesSpaceId: string | null }>(
      `/projects/${projectId}/github`,
      { releaseNotesSpaceId },
    ),
};

export interface ReleaseNotesInput {
  tag: string;
  previousTag?: string;
  spaceId?: string;
  replaceBody?: boolean;
}

export interface ReleaseNotesResult {
  pageUrl: string;
  releaseUrl: string;
  pullRequests: number;
  tickets: number;
  truncated: boolean;
}

export const githubReleaseApi = {
  writeNotes: (projectId: string, body: ReleaseNotesInput) =>
    post<ReleaseNotesResult>(`/projects/${projectId}/github/release-notes`, body),
};
