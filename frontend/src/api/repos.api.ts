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
  prTemplate?: string | null;
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
  author?: { id: string; username: string; displayName: string };
  sourceBranch: string;
  targetBranch: string;
  status: 'OPEN' | 'MERGED' | 'CLOSED';
  mergeStrategy?: string;
  mergeable?: boolean;
  createdAt: string;
  updatedAt: string;
  reviews?: { id: string; status: string; body?: string; createdAt: string }[];
  comments?: {
    id: string;
    authorId: string;
    filePath?: string;
    line?: number;
    body: string;
    createdAt: string;
  }[];
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

/** Repositories API client for repo CRUD, branches, commits, file browsing, PRs, and webhooks. */
export const reposApi = {
  /**
   * List all repositories belonging to a team.
   * @param teamId
   */
  listByTeam: async (teamId: string) => {
    const res = await get<{ data: Repo[]; total: number } | Repo[]>(`/repos/team/${teamId}`);
    return Array.isArray(res) ? res : res.data;
  },
  /**
   * Get a single repository by ID.
   * @param repoId
   */
  get: (repoId: string) => get<Repo>(`/repos/${repoId}`),
  /**
   * Create a new repository within a team.
   * @param teamId
   * @param data
   * @param data.name
   * @param data.slug
   * @param data.description
   * @param data.visibility
   */
  create: (
    teamId: string,
    data: { name: string; slug: string; description?: string; visibility?: string },
  ) => post<Repo>(`/repos/team/${teamId}`, data),
  /**
   * Update repository metadata.
   * @param repoId
   * @param data
   */
  update: (repoId: string, data: Partial<Repo>) => patch<Repo>(`/repos/${repoId}`, data),
  /**
   * Update repository settings (merge strategy, code owners).
   * @param repoId
   * @param data
   * @param data.defaultMergeStrategy
   * @param data.codeOwnersEnabled
   */
  updateSettings: (
    repoId: string,
    data: { defaultMergeStrategy?: string; codeOwnersEnabled?: boolean },
  ) => patch<Repo>(`/repos/${repoId}/settings`, data),
  /**
   * Delete a repository.
   * @param repoId
   */
  delete: (repoId: string) => del(`/repos/${repoId}`),
  /**
   * Fork a repository into a target team with a new slug.
   * @param repoId
   * @param targetTeamId
   * @param slug
   */
  fork: (repoId: string, targetTeamId: string, slug: string) =>
    post<Repo>(`/repos/${repoId}/fork`, { targetTeamId, slug }),

  /**
   * List all branches in a repository.
   * @param repoId
   */
  listBranches: (repoId: string) => get<BranchInfo[]>(`/repos/${repoId}/branches`),
  /**
   * Get details for a specific branch.
   * @param repoId
   * @param name
   */
  getBranch: (repoId: string, name: string) => get(`/repos/${repoId}/branches/${name}`),

  /**
   * List commits for a repository, optionally filtered by ref and limited.
   * @param repoId
   * @param ref
   * @param limit
   * @param skip
   */
  listCommits: (repoId: string, ref?: string, limit?: number, skip?: number) => {
    const params = new URLSearchParams();
    if (ref) params.set('ref', ref);
    if (limit) params.set('limit', String(limit));
    if (skip) params.set('skip', String(skip));
    return get<CommitInfo[]>(`/repos/${repoId}/commits?${params}`);
  },
  /**
   * Get a single commit with diff and stats.
   * @param repoId
   * @param sha
   */
  getCommit: (repoId: string, sha: string) => get<CommitDetail>(`/repos/${repoId}/commits/${sha}`),

  /**
   * Get the file/directory tree at a given ref and path.
   * @param repoId
   * @param ref
   * @param path
   */
  getTree: (repoId: string, ref: string, path: string = '') =>
    get<TreeEntry[]>(`/repos/${repoId}/tree/${ref}${path ? '/' + path : ''}`),
  /**
   * Get a file's content and size at a given ref and path.
   * @param repoId
   * @param ref
   * @param path
   */
  getBlob: (repoId: string, ref: string, path: string) =>
    get<{ content: string; size: number }>(`/repos/${repoId}/blob/${ref}/${path}`),
  /**
   * Get git blame information for a file.
   * @param repoId
   * @param ref
   * @param path
   */
  getBlame: (repoId: string, ref: string, path: string) =>
    get<BlameLine[]>(`/repos/${repoId}/blame/${ref}/${path}`),

  /**
   * Get commit history for a single file.
   * @param repoId
   * @param ref
   * @param path
   * @param limit
   */
  getFileLog: (repoId: string, ref: string, path: string, limit?: number) => {
    const params = new URLSearchParams();
    params.set('ref', ref);
    if (limit) params.set('limit', String(limit));
    params.set('path', path);
    return get<CommitInfo[]>(`/repos/${repoId}/commits?${params}`);
  },

  /**
   * List all tags in a repository.
   * @param repoId
   */
  listTags: (repoId: string) => get(`/repos/${repoId}/tags`),

  /**
   * List pull requests, optionally filtered by status.
   * @param repoId
   * @param status
   * @param reviewerId
   */
  listPRs: (repoId: string, status?: string, reviewerId?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (reviewerId) params.set('reviewerId', reviewerId);
    const q = params.toString();
    return get<PullRequest[]>(`/repos/${repoId}/pulls${q ? `?${q}` : ''}`);
  },
  /**
   * Get a single pull request by number.
   * @param repoId
   * @param number
   */
  getPR: (repoId: string, number: number) => get<PullRequest>(`/repos/${repoId}/pulls/${number}`),
  /**
   * Create a new pull request.
   * @param repoId
   * @param data
   * @param data.title
   * @param data.body
   * @param data.sourceBranch
   * @param data.targetBranch
   */
  createPR: (
    repoId: string,
    data: { title: string; body?: string; sourceBranch: string; targetBranch: string },
  ) => post<PullRequest>(`/repos/${repoId}/pulls`, data),
  /**
   * Update a pull request's title or body.
   * @param repoId
   * @param number
   * @param data
   * @param data.title
   * @param data.body
   */
  updatePR: (repoId: string, number: number, data: { title?: string; body?: string }) =>
    patch(`/repos/${repoId}/pulls/${number}`, data),
  /**
   * Merge a pull request with an optional merge strategy and branch deletion.
   * @param repoId
   * @param number
   * @param data
   * @param data.strategy
   * @param data.deleteSourceBranch
   */
  mergePR: (
    repoId: string,
    number: number,
    data: { strategy?: string; deleteSourceBranch?: boolean },
  ) => post(`/repos/${repoId}/pulls/${number}/merge`, data),
  /**
   * Check if a PR meets merge requirements (reviews, CI).
   * @param repoId
   * @param number
   */
  getMergeChecks: (repoId: string, number: number) =>
    get<MergeChecks>(`/repos/${repoId}/pulls/${number}/merge-checks`),
  /**
   * Close a pull request without merging.
   * @param repoId
   * @param number
   */
  closePR: (repoId: string, number: number) => post(`/repos/${repoId}/pulls/${number}/close`, {}),
  /**
   * Get the unified diff and file stats for a pull request.
   * @param repoId
   * @param number
   */
  getPRDiff: (repoId: string, number: number) =>
    get<{ diff: string; stats: { file: string; additions: number; deletions: number }[] }>(
      `/repos/${repoId}/pulls/${number}/diff`,
    ),
  /**
   * List commits included in a pull request.
   * @param repoId
   * @param number
   */
  getPRCommits: (repoId: string, number: number) =>
    get<CommitInfo[]>(`/repos/${repoId}/pulls/${number}/commits`),
  /**
   * Submit a review (approve, request changes, comment).
   * @param repoId
   * @param number
   * @param data
   * @param data.status
   * @param data.body
   */
  submitReview: (repoId: string, number: number, data: { status: string; body?: string }) =>
    post(`/repos/${repoId}/pulls/${number}/reviews`, data),
  /**
   * Add a comment to a PR, optionally on a specific file and line.
   * @param repoId
   * @param number
   * @param data
   * @param data.body
   * @param data.filePath
   * @param data.line
   * @param data.parentId
   */
  addPRComment: (
    repoId: string,
    number: number,
    data: { body: string; filePath?: string; line?: number; parentId?: string },
  ) => post(`/repos/${repoId}/pulls/${number}/comments`, data),
  /**
   * Update an existing PR comment.
   * @param repoId
   * @param commentId
   * @param body
   */
  updatePRComment: (repoId: string, commentId: string, body: string) =>
    patch(`/repos/${repoId}/comments/${commentId}`, { body }),
  /**
   * Delete a PR comment.
   * @param repoId
   * @param commentId
   */
  deletePRComment: (repoId: string, commentId: string) =>
    del(`/repos/${repoId}/comments/${commentId}`),
  /**
   * Apply a code suggestion from a review comment.
   * @param repoId
   * @param number
   * @param commentId
   */
  applySuggestion: (repoId: string, number: number, commentId: string) =>
    post<{ applied: boolean; commentId: string }>(
      `/repos/${repoId}/pulls/${number}/suggestions/apply`,
      { commentId },
    ),
  /**
   * Batch apply multiple code suggestions at once.
   * @param repoId
   * @param number
   * @param commentIds
   */
  batchApplySuggestions: (repoId: string, number: number, commentIds: string[]) =>
    post<{ applied: boolean; count: number }>(
      `/repos/${repoId}/pulls/${number}/suggestions/batch-apply`,
      { commentIds },
    ),

  /**
   * List branch protection rules for a repository.
   * @param repoId
   */
  listProtectionRules: (repoId: string) => get(`/repos/${repoId}/branch-protection`),
  /**
   * Create a new branch protection rule.
   * @param repoId
   * @param data
   */
  createProtectionRule: (repoId: string, data: Record<string, unknown>) =>
    post(`/repos/${repoId}/branch-protection`, data),
  /**
   * Update a branch protection rule.
   * @param repoId
   * @param ruleId
   * @param data
   */
  updateProtectionRule: (repoId: string, ruleId: string, data: Record<string, unknown>) =>
    patch(`/repos/${repoId}/branch-protection/${ruleId}`, data),
  /**
   * Delete a branch protection rule.
   * @param repoId
   * @param ruleId
   */
  deleteProtectionRule: (repoId: string, ruleId: string) =>
    del(`/repos/${repoId}/branch-protection/${ruleId}`),

  /**
   * Update a file by committing new content to a branch.
   * @param repoId
   * @param ref
   * @param filePath
   * @param data
   * @param data.content
   * @param data.message
   * @param data.branch
   */
  updateFile: (
    repoId: string,
    ref: string,
    filePath: string,
    data: { content: string; message: string; branch: string },
  ) => patch<{ sha: string }>(`/repos/${repoId}/blob/${ref}/${filePath}`, data),

  /**
   * List webhooks configured on a repository.
   * @param repoId
   */
  listWebhooks: (repoId: string) => get(`/repos/${repoId}/webhooks`),
  /**
   * Create a new webhook on a repository.
   * @param repoId
   * @param data
   */
  createWebhook: (repoId: string, data: Record<string, unknown>) =>
    post(`/repos/${repoId}/webhooks`, data),
};
