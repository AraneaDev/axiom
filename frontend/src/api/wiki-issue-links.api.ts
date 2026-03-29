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

export const wikiIssueLinksApi = {
  listForPage: (pageId: string) => get<WikiIssueLink[]>(`/wiki/pages/${pageId}/linked-issues`),
  addLink: (pageId: string, issueId: string, linkType: 'MENTION' | 'EMBED') =>
    post<WikiIssueLink>(`/wiki/pages/${pageId}/linked-issues`, {
      issueId,
      linkType,
    }),
  removeLink: (pageId: string, issueId: string) =>
    del(`/wiki/pages/${pageId}/linked-issues/${issueId}`),
};
