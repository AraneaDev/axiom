import type { Sprint, VelocityDataPoint, Issue } from '@/lib/types';

import { get, post, patch, del } from './client';

/** Sprints API client for sprint lifecycle, issue assignment, velocity, and backlog. */
export const sprintsApi = {
  /**
   * List sprints for a project, optionally filtered by status.
   * @param projectId
   * @param params
   * @param params.status
   */
  list: (projectId: string, params?: { status?: string }) => {
    const query = params?.status ? `?status=${params.status}` : '';
    return get<Sprint[]>(`/projects/${projectId}/sprints${query}`);
  },
  /**
   * Get a single sprint by ID.
   * @param projectId
   * @param sprintId
   */
  get: (projectId: string, sprintId: string) =>
    get<Sprint>(`/projects/${projectId}/sprints/${sprintId}`),
  /**
   * Create a new sprint with name, goal, and date range.
   * @param projectId
   * @param data
   * @param data.name
   * @param data.goal
   * @param data.startDate
   * @param data.endDate
   */
  create: (
    projectId: string,
    data: { name: string; goal?: string; startDate: string; endDate: string },
  ) => post<Sprint>(`/projects/${projectId}/sprints`, data),
  /**
   * Update sprint details.
   * @param projectId
   * @param sprintId
   * @param data
   * @param data.name
   * @param data.goal
   * @param data.startDate
   * @param data.endDate
   */
  update: (
    projectId: string,
    sprintId: string,
    data: { name?: string; goal?: string; startDate?: string; endDate?: string },
  ) => patch<Sprint>(`/projects/${projectId}/sprints/${sprintId}`, data),
  /**
   * Start a sprint (transition from planned to active).
   * @param projectId
   * @param sprintId
   */
  start: (projectId: string, sprintId: string) =>
    post<Sprint>(`/projects/${projectId}/sprints/${sprintId}/start`, {}),
  /**
   * Complete a sprint, optionally moving incomplete issues to another sprint.
   * @param projectId
   * @param sprintId
   * @param moveToSprintId
   */
  complete: (projectId: string, sprintId: string, moveToSprintId?: string) =>
    post<Sprint>(`/projects/${projectId}/sprints/${sprintId}/complete`, { moveToSprintId }),
  /**
   * Add issues to a sprint.
   * @param projectId
   * @param sprintId
   * @param issueIds
   */
  addIssues: (projectId: string, sprintId: string, issueIds: string[]) =>
    post<Sprint>(`/projects/${projectId}/sprints/${sprintId}/issues`, { issueIds }),
  /**
   * Remove an issue from a sprint.
   * @param projectId
   * @param sprintId
   * @param issueId
   */
  removeIssue: (projectId: string, sprintId: string, issueId: string) =>
    del(`/projects/${projectId}/sprints/${sprintId}/issues/${issueId}`),
  /**
   * Get velocity data points for completed sprints.
   * @param projectId
   * @param count
   */
  getVelocity: (projectId: string, count?: number) => {
    const query = count ? `?count=${count}` : '';
    return get<VelocityDataPoint[]>(`/projects/${projectId}/velocity${query}`);
  },
  /**
   * Get unassigned backlog issues (not in any sprint).
   * @param projectId
   */
  getBacklog: (projectId: string) => get<Issue[]>(`/projects/${projectId}/backlog`),
};
