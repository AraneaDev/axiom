import { get, post, patch, del } from './client';

import type { Issue, BoardColumn, Comment, EpicProgress, RoadmapEpic } from '@/lib/types';

export const issuesApi = {
  list: (projectId: string, params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return get<{ issues: Issue[]; total: number }>(`/projects/${projectId}/issues${query}`);
  },
  get: (projectId: string, issueNumber: number) =>
    get<Issue>(`/projects/${projectId}/issues/${issueNumber}`),
  create: (
    projectId: string,
    data: {
      title: string;
      body?: string;
      type?: string;
      priority?: string;
      assigneeId?: string;
      labels?: string[];
    },
  ) => post<Issue>(`/projects/${projectId}/issues`, data),
  update: (projectId: string, issueNumber: number, data: Partial<Issue>) =>
    patch<Issue>(`/projects/${projectId}/issues/${issueNumber}`, data),
  delete: (projectId: string, issueNumber: number) =>
    del(`/projects/${projectId}/issues/${issueNumber}`),
  addComment: (projectId: string, issueNumber: number, body: string) =>
    post<Comment>(`/projects/${projectId}/issues/${issueNumber}/comments`, { body }),
  getBoard: (projectId: string) => get<BoardColumn[]>(`/projects/${projectId}/board`),
  moveIssue: (
    projectId: string,
    issueNumber: number,
    data: { columnId: string; position: number },
  ) => patch<Issue>(`/projects/${projectId}/issues/${issueNumber}/move`, data),

  // Links
  listLinks: (projectId: string, issueNumber: number) =>
    get<
      {
        id: string;
        fromId: string;
        toId: string;
        type: string;
        fromKey: string;
        toKey: string;
        from: Record<string, unknown>;
        to: Record<string, unknown>;
      }[]
    >(`/projects/${projectId}/issues/${issueNumber}/links`),
  addLink: (
    projectId: string,
    issueNumber: number,
    data: { targetProjectId: string; targetIssueNumber: number; type: string },
  ) => post<{ id: string }>(`/projects/${projectId}/issues/${issueNumber}/links`, data),
  deleteLink: (projectId: string, issueNumber: number, linkId: string) =>
    del(`/projects/${projectId}/issues/${issueNumber}/links/${linkId}`),

  // Commits
  listIssueCommits: (projectId: string, issueNumber: number) =>
    get<
      {
        id: string;
        sha: string;
        message: string;
        authorName: string;
        committedAt: string;
        refType: string;
        repo: { id: string; slug: string; name: string };
      }[]
    >(`/projects/${projectId}/issues/${issueNumber}/commits`),

  // Branches
  listIssueBranches: (projectId: string, issueNumber: number) =>
    get<
      {
        id: string;
        branchName: string;
        repoId: string;
        repo: { id: string; slug: string; name: string };
      }[]
    >(`/projects/${projectId}/issues/${issueNumber}/branches`),
  createIssueBranch: (
    projectId: string,
    issueNumber: number,
    data: { repoId: string; branchName: string; startPoint?: string },
  ) =>
    post<{ id: string; branchName: string; repo: { id: string; slug: string; name: string } }>(
      `/projects/${projectId}/issues/${issueNumber}/branches`,
      data,
    ),
  suggestBranchName: (projectId: string, issueNumber: number) =>
    get<{ suggestion: string }>(`/projects/${projectId}/issues/${issueNumber}/branches/suggest`),

  // Pull Requests linked to issue
  listIssuePRs: (projectId: string, issueNumber: number) =>
    get<
      {
        id: string;
        refType: string;
        pr: { id: string; number: number; title: string; status: string; sourceBranch: string };
      }[]
    >(`/projects/${projectId}/issues/${issueNumber}/pull-requests`),

  // Hierarchy (parent/child)
  setParent: (projectId: string, issueNumber: number, parentIssueNumber: number | null) =>
    patch<Issue>(`/projects/${projectId}/issues/${issueNumber}/parent`, { parentIssueNumber }),
  getChildren: (projectId: string, issueNumber: number) =>
    get<Issue[]>(`/projects/${projectId}/issues/${issueNumber}/children`),
  getProgress: (projectId: string, issueNumber: number) =>
    get<EpicProgress>(`/projects/${projectId}/issues/${issueNumber}/progress`),

  // Roadmap
  getRoadmap: (projectId: string) => get<RoadmapEpic[]>(`/projects/${projectId}/roadmap`),

  // Worklogs (time tracking)
  logWork: (
    projectId: string,
    issueNumber: number,
    data: { minutes: number; description?: string },
  ) =>
    post<{ timeSpent: number; logged: number }>(
      `/projects/${projectId}/issues/${issueNumber}/worklogs`,
      data,
    ),
  getWorklogs: (projectId: string, issueNumber: number) =>
    get<
      {
        id: string;
        userId: string;
        user: { id: string; username: string; displayName: string };
        minutes: number;
        description: string;
        createdAt: string;
      }[]
    >(`/projects/${projectId}/issues/${issueNumber}/worklogs`),

  // Bulk operations
  bulkUpdate: (
    projectId: string,
    data: {
      issueIds: string[];
      updates: {
        status?: string;
        assigneeId?: string | null;
        priority?: string;
        sprintId?: string | null;
        labels?: string[];
      };
    },
  ) => patch<{ updated: number }>(`/projects/${projectId}/issues/bulk`, data),
};
