import { get, post, patch, del } from './client';

export interface Repo {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  description?: string;
  visibility: 'PRIVATE' | 'INTERNAL' | 'PUBLIC';
  defaultBranch: string;
  diskPath?: string;
  size?: number;
}

export interface BranchInfo {
  name: string;
  sha: string;
  isDefault: boolean;
}

export interface CommitInfo {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
}

export interface TreeEntry {
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  name: string;
  size?: number;
}

export interface PullRequest {
  id: string;
  repoId: string;
  number: number;
  title: string;
  body: string;
  authorId: string;
  sourceBranch: string;
  targetBranch: string;
  status: 'OPEN' | 'MERGED' | 'CLOSED';
  mergeable?: boolean;
  createdAt: string;
  updatedAt: string;
  reviews?: any[];
  comments?: any[];
  _count?: { reviews: number; comments: number };
}

export const reposApi = {
  // Repos
  listByTeam: (teamId: string) => get<Repo[]>(`/repos/team/${teamId}`),
  get: (repoId: string) => get<Repo>(`/repos/${repoId}`),
  create: (
    teamId: string,
    data: { name: string; slug: string; description?: string; visibility?: string },
  ) => post<Repo>(`/repos/team/${teamId}`, data),
  update: (repoId: string, data: Partial<Repo>) => patch<Repo>(`/repos/${repoId}`, data),
  delete: (repoId: string) => del(`/repos/${repoId}`),
  fork: (repoId: string, targetTeamId: string, slug: string) =>
    post<Repo>(`/repos/${repoId}/fork`, { targetTeamId, slug }),

  // Branches
  listBranches: (repoId: string) => get<BranchInfo[]>(`/repos/${repoId}/branches`),
  getBranch: (repoId: string, name: string) => get(`/repos/${repoId}/branches/${name}`),

  // Commits
  listCommits: (repoId: string, ref?: string, limit?: number) => {
    const params = new URLSearchParams();
    if (ref) params.set('ref', ref);
    if (limit) params.set('limit', String(limit));
    return get<CommitInfo[]>(`/repos/${repoId}/commits?${params}`);
  },
  getCommit: (repoId: string, sha: string) => get(`/repos/${repoId}/commits/${sha}`),

  // File browser
  getTree: (repoId: string, ref: string, path: string = '') =>
    get<TreeEntry[]>(`/repos/${repoId}/tree/${ref}${path ? '/' + path : ''}`),
  getBlob: (repoId: string, ref: string, path: string) =>
    get<{ content: string; size: number }>(`/repos/${repoId}/blob/${ref}/${path}`),
  getBlame: (repoId: string, ref: string, path: string) =>
    get(`/repos/${repoId}/blame/${ref}/${path}`),

  // Tags
  listTags: (repoId: string) => get(`/repos/${repoId}/tags`),

  // Pull Requests
  listPRs: (repoId: string, status?: string) => {
    const q = status ? `?status=${status}` : '';
    return get<PullRequest[]>(`/repos/${repoId}/pulls${q}`);
  },
  getPR: (repoId: string, number: number) => get<PullRequest>(`/repos/${repoId}/pulls/${number}`),
  createPR: (
    repoId: string,
    data: { title: string; body?: string; sourceBranch: string; targetBranch: string },
  ) => post<PullRequest>(`/repos/${repoId}/pulls`, data),
  updatePR: (repoId: string, number: number, data: { title?: string; body?: string }) =>
    patch(`/repos/${repoId}/pulls/${number}`, data),
  mergePR: (repoId: string, number: number, strategy?: string) =>
    post(`/repos/${repoId}/pulls/${number}/merge`, { strategy }),
  closePR: (repoId: string, number: number) => post(`/repos/${repoId}/pulls/${number}/close`, {}),
  getPRDiff: (repoId: string, number: number) =>
    get<{ diff: string; stats: any[] }>(`/repos/${repoId}/pulls/${number}/diff`),
  getPRCommits: (repoId: string, number: number) =>
    get<CommitInfo[]>(`/repos/${repoId}/pulls/${number}/commits`),
  submitReview: (repoId: string, number: number, data: { status: string; body?: string }) =>
    post(`/repos/${repoId}/pulls/${number}/reviews`, data),
  addPRComment: (
    repoId: string,
    number: number,
    data: { body: string; filePath?: string; line?: number },
  ) => post(`/repos/${repoId}/pulls/${number}/comments`, data),

  // Branch protection
  listProtectionRules: (repoId: string) => get(`/repos/${repoId}/branch-protection`),
  createProtectionRule: (repoId: string, data: any) =>
    post(`/repos/${repoId}/branch-protection`, data),

  // Webhooks
  listWebhooks: (repoId: string) => get(`/repos/${repoId}/webhooks`),
  createWebhook: (repoId: string, data: any) => post(`/repos/${repoId}/webhooks`, data),
};
