import { get, post, patch, del } from './client';
import type { Project } from '@/lib/types';

export const projectsApi = {
  listByTeam: (teamId: string) => get<Project[]>(`/projects/team/${teamId}`),
  get: (projectId: string) => get<Project>(`/projects/${projectId}`),
  create: (
    teamId: string,
    data: { name: string; slug: string; prefix: string; description?: string },
  ) => post<Project>(`/projects/team/${teamId}`, data),
  update: (projectId: string, data: { name?: string; description?: string }) =>
    patch<Project>(`/projects/${projectId}`, data),
  delete: (projectId: string) => del(`/projects/${projectId}`),
};
