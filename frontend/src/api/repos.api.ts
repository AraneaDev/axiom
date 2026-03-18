import { get, post, patch, del } from './client';

export interface Repo {
  id: string;
  teamId: string;
  name: string;
  slug: string;
  description?: string;
  visibility: 'PRIVATE' | 'INTERNAL' | 'PUBLIC';
  defaultBranch: string;
  defaultMergeStrategy?: string;
  codeOwnersEnabled?: boolean;
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
  mergeStrategy?: string;
  mergeable?: boolean;
  createdAt: string;
  updatedAt: string;
  reviews?: { id: string; status: string; body?: string; createdAt: string }[];
  comments?: { id: string; filePath?: string; line?: number; body: string; createdAt: string }[];
  _count?: { reviews: number; comments: number };
}

export interface MergeChecks {
  requiredReviews: number;
  approvedReviews: number;
  reviewsMet: boolean;
  requireCI: boolean;
  ciPassed: boolean;
  canMerge: boolean;
  defaultStrategy: string;
}

export interface CommitDetail {
  commit: CommitInfo;
  diff: string;
  stats: { file: string; additions: number; deletions: number }[];
  parents: string[];
}

export interface BlameLine {
  sha: string;
  author: string;
  date: string;
  lineNum: number;
  content: string;
}

export const reposApi = {
  // Repos
  listByTeam: async (teamId: string) => {
    const res = await get<{ data: Repo[]; total: number } | Repo[]>(`/repos/team/${teamId}`);
    return Array.isArray(res) ? res : res.data;
  },
  get: (repoId: string) => get<Repo>(`/repos/${repoId}`),
  create: (
    teamId: string,
    data: { name: string; slug: string; description?: string; visibility?: string },
  ) => post<Repo>(`/repos/team/${teamId}`, data),
  update: (repoId: string, data: Partial<Repo>) => patch<Repo>(`/repos/${repoId}`, data),
  updateSettings: (
    repoId: string,
    data: { defaultMergeStrategy?: string; codeOwnersEnabled?: boolean },
  ) => patch<Repo>(`/repos/${repoId}/settings`, data),
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
  getCommit: (repoId: string, sha: string) => get<CommitDetail>(`/repos/${repoId}/commits/${sha}`),

  // File browser
  getTree: (repoId: string, ref: string, path: string = '') =>
    get<TreeEntry[]>(`/repos/${repoId}/tree/${ref}${path ? '/' + path : ''}`),
  getBlob: (repoId: string, ref: string, path: string) =>
    get<{ content: string; size: number }>(`/repos/${repoId}/blob/${ref}/${path}`),
  getBlame: (repoId: string, ref: string, path: string) =>
    get<BlameLine[]>(`/repos/${repoId}/blame/${ref}/${path}`),

  // File history (commits for a single file)
  getFileLog: (repoId: string, ref: string, path: string, limit?: number) => {
    const params = new URLSearchParams();
    params.set('ref', ref);
    if (limit) params.set('limit', String(limit));
    params.set('path', path);
    return get<CommitInfo[]>(`/repos/${repoId}/commits?${params}`);
  },

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
  getMergeChecks: (repoId: string, number: number) =>
    get<MergeChecks>(`/repos/${repoId}/pulls/${number}/merge-checks`),
  closePR: (repoId: string, number: number) => post(`/repos/${repoId}/pulls/${number}/close`, {}),
  getPRDiff: (repoId: string, number: number) =>
    get<{ diff: string; stats: { file: string; additions: number; deletions: number }[] }>(
      `/repos/${repoId}/pulls/${number}/diff`,
    ),
  getPRCommits: (repoId: string, number: number) =>
    get<CommitInfo[]>(`/repos/${repoId}/pulls/${number}/commits`),
  submitReview: (repoId: string, number: number, data: { status: string; body?: string }) =>
    post(`/repos/${repoId}/pulls/${number}/reviews`, data),
  addPRComment: (
    repoId: string,
    number: number,
    data: { body: string; filePath?: string; line?: number },
  ) => post(`/repos/${repoId}/pulls/${number}/comments`, data),
  applySuggestion: (repoId: string, number: number, commentId: string) =>
    post<{ applied: boolean; commentId: string }>(
      `/repos/${repoId}/pulls/${number}/suggestions/apply`,
      { commentId },
    ),
  batchApplySuggestions: (repoId: string, number: number, commentIds: string[]) =>
    post<{ applied: boolean; count: number }>(
      `/repos/${repoId}/pulls/${number}/suggestions/batch-apply`,
      { commentIds },
    ),

  // Branch protection
  listProtectionRules: (repoId: string) => get(`/repos/${repoId}/branch-protection`),
  createProtectionRule: (repoId: string, data: Record<string, unknown>) =>
    post(`/repos/${repoId}/branch-protection`, data),

  // Webhooks
  listWebhooks: (repoId: string) => get(`/repos/${repoId}/webhooks`),
  createWebhook: (repoId: string, data: Record<string, unknown>) =>
    post(`/repos/${repoId}/webhooks`, data),
};
