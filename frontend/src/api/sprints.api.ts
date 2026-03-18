import { get, post, patch, del } from './client';

import type { Sprint, VelocityDataPoint, Issue } from '@/lib/types';

export const sprintsApi = {
  list: (projectId: string, params?: { status?: string }) => {
    const query = params?.status ? `?status=${params.status}` : '';
    return get<Sprint[]>(`/projects/${projectId}/sprints${query}`);
  },
  get: (projectId: string, sprintId: string) =>
    get<Sprint>(`/projects/${projectId}/sprints/${sprintId}`),
  create: (
    projectId: string,
    data: { name: string; goal?: string; startDate: string; endDate: string },
  ) => post<Sprint>(`/projects/${projectId}/sprints`, data),
  update: (
    projectId: string,
    sprintId: string,
    data: { name?: string; goal?: string; startDate?: string; endDate?: string },
  ) => patch<Sprint>(`/projects/${projectId}/sprints/${sprintId}`, data),
  start: (projectId: string, sprintId: string) =>
    post<Sprint>(`/projects/${projectId}/sprints/${sprintId}/start`, {}),
  complete: (projectId: string, sprintId: string, moveToSprintId?: string) =>
    post<Sprint>(`/projects/${projectId}/sprints/${sprintId}/complete`, { moveToSprintId }),
  addIssues: (projectId: string, sprintId: string, issueIds: string[]) =>
    post<Sprint>(`/projects/${projectId}/sprints/${sprintId}/issues`, { issueIds }),
  removeIssue: (projectId: string, sprintId: string, issueId: string) =>
    del(`/projects/${projectId}/sprints/${sprintId}/issues/${issueId}`),
  getVelocity: (projectId: string, count?: number) => {
    const query = count ? `?count=${count}` : '';
    return get<VelocityDataPoint[]>(`/projects/${projectId}/velocity${query}`);
  },
  getBacklog: (projectId: string) => get<Issue[]>(`/projects/${projectId}/backlog`),
};
