import { get, post, patch, del } from './client';

import type { Project, ProjectAnalytics } from '@/lib/types';

/** Projects API client for project CRUD within a team. */
export const projectsApi = {
  /**
   * List all projects belonging to a team.
   * @param teamId
   */
  listByTeam: (teamId: string) => get<Project[]>(`/projects/team/${teamId}`),
  /**
   * Get a single project by ID.
   * @param projectId
   */
  get: (projectId: string) => get<Project>(`/projects/${projectId}`),
  /**
   * Create a new project with a name, slug, issue prefix, and optional description.
   * @param teamId
   * @param data
   * @param data.name
   * @param data.slug
   * @param data.prefix
   * @param data.description
   */
  create: (
    teamId: string,
    data: { name: string; slug: string; prefix: string; description?: string },
  ) => post<Project>(`/projects/team/${teamId}`, data),
  /**
   * Update a project's name or description.
   * @param projectId
   * @param data
   * @param data.name
   * @param data.description
   */
  update: (projectId: string, data: { name?: string; description?: string }) =>
    patch<Project>(`/projects/${projectId}`, data),
  /**
   * Delete a project.
   * @param projectId
   */
  delete: (projectId: string) => del(`/projects/${projectId}`),
  /**
   * Get project analytics data.
   * @param projectId
   */
  analytics: (projectId: string) => get<ProjectAnalytics>(`/projects/${projectId}/analytics`),
};
