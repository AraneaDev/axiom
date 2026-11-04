import { del, get, post } from './client';

export interface IssueWebLink {
  id: string;
  url: string;
  title: string | null;
  createdAt: string;
  createdBy: { id: string; username: string; displayName: string };
}

export const issueWebLinksApi = {
  list: (projectId: string, issueNumber: number) =>
    get<IssueWebLink[]>(`/projects/${projectId}/issues/${issueNumber}/web-links`),
  add: (projectId: string, issueNumber: number, data: { url: string; title?: string }) =>
    post<IssueWebLink>(`/projects/${projectId}/issues/${issueNumber}/web-links`, data),
  remove: (projectId: string, issueNumber: number, linkId: string) =>
    del(`/projects/${projectId}/issues/${issueNumber}/web-links/${linkId}`),
};
