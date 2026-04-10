import { get, post, patch, del } from './client';

export interface Milestone {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  dueDate?: string;
  status: 'OPEN' | 'CLOSED';
  issueCount: number;
  closedIssueCount: number;
  createdAt: string;
}

export const milestonesApi = {
  list: (projectId: string) => get<Milestone[]>(`/projects/${projectId}/milestones`),
  get: (milestoneId: string) => get<Milestone>(`/projects/milestones/${milestoneId}`),
  create: (projectId: string, data: { title: string; description?: string; dueDate?: string }) =>
    post<Milestone>(`/projects/${projectId}/milestones`, data),
  update: (milestoneId: string, data: Record<string, unknown>) =>
    patch<Milestone>(`/projects/milestones/${milestoneId}`, data),
  delete: (milestoneId: string) => del(`/projects/milestones/${milestoneId}`),
};
