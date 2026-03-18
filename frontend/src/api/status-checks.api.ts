import { get, post } from './client';

export interface StatusCheck {
  id: string;
  repoId: string;
  sha: string;
  context: string;
  state: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'ERROR';
  targetUrl?: string;
  description?: string;
  createdAt: string;
}

export interface CombinedStatus {
  sha: string;
  state: 'success' | 'failure' | 'pending' | 'none';
  statuses: StatusCheck[];
  total: number;
}

export interface PRStatusResult {
  sha: string;
  statuses: StatusCheck[];
  combined: 'success' | 'failure' | 'pending' | 'none';
}

export interface CodeOwnerStatus {
  owner: string;
  approved: boolean;
  reviewStatus: string | null;
}

export interface FileOwner {
  file: string;
  owners: string[];
}

export interface PRCodeOwners {
  fileOwners: FileOwner[];
  owners: CodeOwnerStatus[];
  allApproved: boolean;
}

export const statusChecksApi = {
  createStatus: (
    repoId: string,
    data: {
      sha: string;
      context: string;
      state: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'ERROR';
      targetUrl?: string;
      description?: string;
    },
  ) => post<StatusCheck>(`/repos/${repoId}/statuses`, data),

  getCommitStatuses: (repoId: string, sha: string) =>
    get<CombinedStatus>(`/repos/${repoId}/commits/${sha}/statuses`),

  getPRStatuses: (repoId: string, number: number) =>
    get<PRStatusResult>(`/repos/${repoId}/pulls/${number}/statuses`),

  getPRCodeOwners: (repoId: string, number: number) =>
    get<PRCodeOwners>(`/repos/${repoId}/pulls/${number}/code-owners`),
};
