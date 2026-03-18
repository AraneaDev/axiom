import { get, post, patch, del } from './client';

export interface IssueTemplate {
  id: string;
  name: string;
  type: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
  title: string;
  body: string;
  labels: string[];
  assigneeId?: string;
}

export const issueTemplatesApi = {
  list: (projectId: string) => get<IssueTemplate[]>(`/projects/${projectId}/issue-templates`),
  get: (projectId: string, templateId: string) =>
    get<IssueTemplate>(`/projects/${projectId}/issue-templates/${templateId}`),
  create: (projectId: string, data: Omit<IssueTemplate, 'id'>) =>
    post<IssueTemplate>(`/projects/${projectId}/issue-templates`, data),
  update: (projectId: string, templateId: string, data: Partial<Omit<IssueTemplate, 'id'>>) =>
    patch<IssueTemplate>(`/projects/${projectId}/issue-templates/${templateId}`, data),
  delete: (projectId: string, templateId: string) =>
    del(`/projects/${projectId}/issue-templates/${templateId}`),
};
