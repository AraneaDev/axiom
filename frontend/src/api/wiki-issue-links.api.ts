import { get, post, del } from './client';

export interface WikiIssueLink {
  id: string;
  linkType: 'MENTION' | 'EMBED';
  createdAt: string;
  issue: {
    id: string;
    number: number;
    title: string;
    column: { name: string } | null;
    priority: string;
    type: string;
    assignee: {
      id: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
    } | null;
    project: {
      id: string;
      prefix: string;
      slug: string;
      team: { slug: string; org: { slug: string } };
    };
  };
}

export interface IssueLinkedPage {
  id: string;
  linkType: string;
  page: {
    id: string;
    title: string;
    slug: string;
    space: {
      id: string;
      name: string;
      slug: string;
      team: { slug: string; org: { slug: string } };
    };
  };
}

export const wikiIssueLinksApi = {
  listForIssue: (projectId: string, issueNumber: number) =>
    get<IssueLinkedPage[]>(`/projects/${projectId}/issues/${issueNumber}/wiki-links`),
  listForPage: (pageId: string) => get<WikiIssueLink[]>(`/wiki/pages/${pageId}/linked-issues`),
  addLink: (pageId: string, issueId: string, linkType: 'MENTION' | 'EMBED') =>
    post<WikiIssueLink>(`/wiki/pages/${pageId}/linked-issues`, {
      issueId,
      linkType,
    }),
  removeLink: (pageId: string, issueId: string) =>
    del(`/wiki/pages/${pageId}/linked-issues/${issueId}`),
};
