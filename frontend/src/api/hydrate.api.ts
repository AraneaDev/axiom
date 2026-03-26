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

/**
 * Hydration API -- aggregated endpoints for initial page load.
 */
export const hydrateApi = {
  issueDetail: (projectId: string, issueNumber: number) =>
    get<IssueDetailHydration>(`/projects/${projectId}/issues/${issueNumber}/hydrate`),
};
