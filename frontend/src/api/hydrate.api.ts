import { get } from './client';

export interface IssueDetailHydration {
  issue: Record<string, unknown>;
  votes: { count: number; voted: boolean } | null;
  watchers: unknown[] | null;
  links: unknown[] | null;
  children: unknown[] | null;
  progress: { total: number; completed: number; inProgress: number; percentage: number } | null;
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

export interface BacklogHydration {
  sprints: unknown[] | null;
  backlogIssues: unknown[] | null;
  velocity: unknown[] | null;
}

/**
 * Hydration API -- aggregated endpoints for initial page load.
 */
export const hydrateApi = {
  issueDetail: (projectId: string, issueNumber: number) =>
    get<IssueDetailHydration>(`/projects/${projectId}/issues/${issueNumber}/hydrate`),

  wikiPage: (spaceId: string, pageSlug: string) =>
    get<WikiPageHydration>(`/wiki/spaces/${spaceId}/pages/${pageSlug}/hydrate`),

  issuesList: (projectId: string, filters?: Record<string, string>) => {
    const params = new URLSearchParams(filters ?? {}).toString();
    const qs = params ? `?${params}` : '';
    return get<IssuesListHydration>(`/projects/${projectId}/issues/hydrate${qs}`);
  },

  backlog: (projectId: string) => get<BacklogHydration>(`/projects/${projectId}/backlog/hydrate`),
};
