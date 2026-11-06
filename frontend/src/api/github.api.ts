import { del, get, post } from './client';

export interface GithubInstallation {
  /** A number; a string only for an id above 2^53 - 1 */
  id: number | string;
  accountLogin: string;
  suspended: boolean;
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
