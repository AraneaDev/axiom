import { get } from './client';

export interface IssueDetailHydration {
  issue: Record<string, unknown>;
  votes: { count: number; voted: boolean } | null;
  watchers: unknown[] | null;
  links: unknown[] | null;
  children: unknown[] | null;
  progress: { total: number; completed: number; inProgress: number; percentage: number } | null;
  development: {
    branches: unknown[] | null;
    pullRequests: unknown[] | null;
    commits: unknown[] | null;
  };
  activity: unknown[] | null;
  attachments: unknown[] | null;
  worklogs: unknown[] | null;
  sprints: unknown[] | null;
  customFields: unknown[] | null;
}

export interface IssuesListHydration {
  issues: { issues: unknown[]; total: number } | null;
  boardColumns: unknown[] | null;
  sprints: unknown[] | null;
  savedFilters: unknown[] | null;
  customFields: unknown[] | null;
}

export interface WikiPageHydration {
  page: Record<string, unknown>;
  labels: unknown[] | null;
  attachments: unknown[] | null;
  history: unknown[] | null;
  children: unknown[] | null;
}

export interface PRDetailHydration {
  pr: Record<string, unknown>;
  mergeChecks: Record<string, unknown> | null;
  diff: { stats: Record<string, unknown> } | null;
  commits: unknown[] | null;
  reviews: unknown[] | null;
  comments: unknown[] | null;
  linkedIssues: unknown[] | null;
}

/**
 * Hydration API -- aggregated endpoints for initial page load.
 */
export const hydrateApi = {
  issueDetail: (projectId: string, issueNumber: number) =>
    get<IssueDetailHydration>(`/projects/${projectId}/issues/${issueNumber}/hydrate`),

  prDetail: (repoId: string, prNumber: number) =>
    get<PRDetailHydration>(`/repos/${repoId}/pulls/${prNumber}/hydrate`),

  wikiPage: (spaceId: string, pageSlug: string) =>
    get<WikiPageHydration>(`/wiki/spaces/${spaceId}/pages/${pageSlug}/hydrate`),

  issuesList: (projectId: string, filters?: Record<string, string>) => {
    const params = new URLSearchParams(filters ?? {}).toString();
    const qs = params ? `?${params}` : '';
    return get<IssuesListHydration>(`/projects/${projectId}/issues/hydrate${qs}`);
  },
};
