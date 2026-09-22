import type { Issue, BoardColumn, Comment, EpicProgress, RoadmapEpic } from '@/lib/types';

import { get, post, patch, del } from './client';

/** Issues API client for CRUD operations, comments, links, branches, PRs, hierarchy, and bulk actions. */
export const issuesApi = {
  /**
   * List issues for a project with optional query/filter parameters.
   * @param projectId
   * @param params
   */
  list: (projectId: string, params?: Record<string, string>) => {
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    return get<{ issues: Issue[]; total: number }>(`/projects/${projectId}/issues${query}`);
  },
  /**
   * Get a single issue by its number within a project.
   * @param projectId
   * @param issueNumber
   */
  get: (projectId: string, issueNumber: number) =>
    get<Issue>(`/projects/${projectId}/issues/${issueNumber}`),
  /**
   * Create a new issue in a project.
   * @param projectId
   * @param data
   * @param data.title
   * @param data.body
   * @param data.type
   * @param data.priority
   * @param data.assigneeId
   * @param data.labels
   * @param data.dueDate
   */
  create: (
    projectId: string,
    data: {
      title: string;
      body?: string;
      type?: string;
      priority?: string;
      assigneeId?: string;
      labels?: string[];
      dueDate?: string;
    },
  ) => post<Issue>(`/projects/${projectId}/issues`, data),
  /**
   * Update an existing issue's fields.
   * @param projectId
   * @param issueNumber
   * @param data
   */
  update: (projectId: string, issueNumber: number, data: Partial<Issue>) =>
    patch<Issue>(`/projects/${projectId}/issues/${issueNumber}`, data),
  /**
   * Delete an issue by number.
   * @param projectId
   * @param issueNumber
   */
  delete: (projectId: string, issueNumber: number) =>
    del(`/projects/${projectId}/issues/${issueNumber}`),
  /**
   * Add a comment to an issue.
   * @param projectId
   * @param issueNumber
   * @param body
   */
  addComment: (projectId: string, issueNumber: number, body: string) =>
    post<Comment>(`/projects/${projectId}/issues/${issueNumber}/comments`, { body }),
  /**
   * Update an existing comment body.
   * @param projectId
   * @param commentId
   * @param body
   */
  updateComment: (projectId: string, commentId: string, body: string) =>
    patch<Comment>(`/projects/${projectId}/comments/${commentId}`, { body }),
  /**
   * Delete a comment.
   * @param projectId
   * @param commentId
   */
  deleteComment: (projectId: string, commentId: string) =>
    del(`/projects/${projectId}/comments/${commentId}`),
  /**
   * Get the Kanban board columns and their issues for a project.
   * @param projectId
   */
  getBoard: (projectId: string) => get<BoardColumn[]>(`/projects/${projectId}/board`),
  /**
   * Move an issue to a different board column and position.
   * @param projectId
   * @param issueNumber
   * @param data
   * @param data.columnId
   * @param data.position
   */
  moveIssue: (
    projectId: string,
    issueNumber: number,
    data: { columnId: string; position: number },
  ) => patch<Issue>(`/projects/${projectId}/issues/${issueNumber}/move`, data),

  /**
   * List all links (blocks, duplicates, relates) for an issue.
   * @param projectId
   * @param issueNumber
   */
  listLinks: (projectId: string, issueNumber: number) =>
    get<
      {
        id: string;
        fromId: string;
        toId: string;
        type: string;
        fromKey: string;
        toKey: string;
        from: {
          id: string;
          number: number;
          title: string;
          project: { slug: string; prefix: string; team: { slug: string; org: { slug: string } } };
        };
        to: {
          id: string;
          number: number;
          title: string;
          project: { slug: string; prefix: string; team: { slug: string; org: { slug: string } } };
        };
      }[]
    >(`/projects/${projectId}/issues/${issueNumber}/links`),
  /**
   * Create a link between two issues.
   * @param projectId
   * @param issueNumber
   * @param data
   * @param data.targetProjectId
   * @param data.targetIssueNumber
   * @param data.type
   */
  addLink: (
    projectId: string,
    issueNumber: number,
    data: { targetProjectId: string; targetIssueNumber: number; type: string },
  ) => post<{ id: string }>(`/projects/${projectId}/issues/${issueNumber}/links`, data),
  /**
   * List git commits associated with an issue.
   * @param projectId
   * @param issueNumber
   */
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

  /**
   * List git branches associated with an issue.
   * @param projectId
   * @param issueNumber
   */
  listIssueBranches: (projectId: string, issueNumber: number) =>
    get<
      {
        id: string;
        branchName: string;
        repoId: string;
        repo: { id: string; slug: string; name: string };
      }[]
    >(`/projects/${projectId}/issues/${issueNumber}/branches`),
  /**
   * Create a new git branch linked to an issue.
   * @param projectId
   * @param issueNumber
   * @param data
   * @param data.repoId
   * @param data.branchName
   * @param data.startPoint
   */
  createIssueBranch: (
    projectId: string,
    issueNumber: number,
    data: { repoId: string; branchName: string; startPoint?: string },
  ) =>
    post<{ id: string; branchName: string; repo: { id: string; slug: string; name: string } }>(
      `/projects/${projectId}/issues/${issueNumber}/branches`,
      data,
    ),
  /**
   * Get a server-suggested branch name for an issue.
   * @param projectId
   * @param issueNumber
   */
  suggestBranchName: (projectId: string, issueNumber: number) =>
    get<{ suggestion: string }>(`/projects/${projectId}/issues/${issueNumber}/branches/suggest`),

  /**
   * List pull requests linked to an issue.
   * @param projectId
   * @param issueNumber
   */
  listIssuePRs: (projectId: string, issueNumber: number) =>
    get<
      {
        id: string;
        refType: string;
        pr: {
          id: string;
          number: number;
          title: string;
          status: string;
          sourceBranch: string;
          repo: { id: string; slug: string; name: string };
        };
      }[]
    >(`/projects/${projectId}/issues/${issueNumber}/pull-requests`),

  /**
   * Set or clear the parent issue for hierarchy (epic/sub-task).
   * @param projectId
   * @param issueNumber
   * @param parentIssueNumber
   */
  setParent: (projectId: string, issueNumber: number, parentIssueNumber: number | null) =>
    patch<Issue>(`/projects/${projectId}/issues/${issueNumber}/parent`, { parentIssueNumber }),
  /**
   * Get child issues (sub-tasks) of a parent issue.
   * @param projectId
   * @param issueNumber
   */
  getChildren: (projectId: string, issueNumber: number) =>
    get<Issue[]>(`/projects/${projectId}/issues/${issueNumber}/children`),
  /**
   * Get completion progress for an epic (parent issue).
   * @param projectId
   * @param issueNumber
   */
  getProgress: (projectId: string, issueNumber: number) =>
    get<EpicProgress>(`/projects/${projectId}/issues/${issueNumber}/progress`),

  /**
   * Get the roadmap view with epics and their timeline data.
   * @param projectId
   */
  getRoadmap: (projectId: string) => get<RoadmapEpic[]>(`/projects/${projectId}/roadmap`),

  /**
   * Log time spent on an issue.
   * @param projectId
   * @param issueNumber
   * @param data
   * @param data.minutes
   * @param data.description
   */
  logWork: (
    projectId: string,
    issueNumber: number,
    data: { minutes: number; description?: string },
  ) =>
    post<{ timeSpent: number; logged: number }>(
      `/projects/${projectId}/issues/${issueNumber}/worklogs`,
      data,
    ),
  /**
   * Get all work log entries for an issue.
   * @param projectId
   * @param issueNumber
   */
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

  /**
   * Bulk update multiple issues at once (status, assignee, priority, sprint, labels).
   * @param projectId
   * @param data
   * @param data.issueIds
   * @param data.updates
   * @param data.updates.status
   * @param data.updates.assigneeId
   * @param data.updates.priority
   * @param data.updates.sprintId
   * @param data.updates.labels
   */
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

  toggleVote: (projectId: string, issueNumber: number) =>
    post<{ voted: boolean }>(`/projects/${projectId}/issues/${issueNumber}/votes/toggle`, {}),

  getVotes: (projectId: string, issueNumber: number) =>
    get<{ count: number; voted: boolean }>(`/projects/${projectId}/issues/${issueNumber}/votes`),

  toggleWatch: (projectId: string, issueNumber: number) =>
    post<{ watching: boolean }>(`/projects/${projectId}/issues/${issueNumber}/watchers/toggle`, {}),

  getWatchers: (projectId: string, issueNumber: number) =>
    get<{
      watchers: {
        id: string;
        userId: string;
        user: { id: string; username: string; displayName: string; avatarUrl: string | null };
        createdAt: string;
      }[];
      watching: boolean;
    }>(`/projects/${projectId}/issues/${issueNumber}/watchers`),

  createColumn: (projectId: string, data: { name: string; position?: number; isDone?: boolean }) =>
    post<BoardColumn>(`/projects/${projectId}/board/columns`, data),

  updateColumn: (
    projectId: string,
    columnId: string,
    data: { name?: string; isDone?: boolean; wipLimit?: number | null },
  ) => patch<BoardColumn>(`/projects/${projectId}/board/columns/${columnId}`, data),

  deleteColumn: (projectId: string, columnId: string) =>
    del(`/projects/${projectId}/board/columns/${columnId}`),

  reorderColumns: (projectId: string, positions: { id: string; position: number }[]) =>
    patch<BoardColumn[]>(`/projects/${projectId}/board/columns/reorder`, { positions }),
};
