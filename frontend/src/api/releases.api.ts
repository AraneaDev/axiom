import { get, post, patch, del } from './client';

export interface Release {
  id: string;
  repoId: string;
  tagName: string;
  title: string;
  body: string;
  isDraft: boolean;
  isPrerelease: boolean;
  targetBranch: string;
  commitSha?: string;
  authorId: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  author: { id: string; username: string; displayName: string };
}

export interface CommitEntry {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export interface ChangelogSection {
  type: string;
  label: string;
  commits: CommitEntry[];
}

export const releasesApi = {
  list: (repoId: string, params?: { draft?: boolean; prerelease?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.draft !== undefined) q.set('draft', String(params.draft));
    if (params?.prerelease !== undefined) q.set('prerelease', String(params.prerelease));
    return get<Release[]>(`/repos/${repoId}/releases?${q}`);
  },
  get: (repoId: string, tagName: string) =>
    get<Release & { commits: CommitEntry[] }>(
      `/repos/${repoId}/releases/${encodeURIComponent(tagName)}`,
    ),
  create: (
    repoId: string,
    data: Partial<Release> & { tagName: string; title: string; targetBranch: string },
  ) => post<Release>(`/repos/${repoId}/releases`, data),
  update: (repoId: string, tagName: string, data: Partial<Release>) =>
    patch<Release>(`/repos/${repoId}/releases/${encodeURIComponent(tagName)}`, data),
  publish: (repoId: string, tagName: string) =>
    post<Release>(`/repos/${repoId}/releases/${encodeURIComponent(tagName)}/publish`, {}),
  delete: (repoId: string, tagName: string) =>
    del(`/repos/${repoId}/releases/${encodeURIComponent(tagName)}`),
  compare: (repoId: string, base: string, head: string) =>
    get<{ commits: CommitEntry[]; changelog: ChangelogSection[] }>(
      `/repos/${repoId}/releases/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`,
    ),
};
