import { get } from './client';

export interface ActivityEvent {
  id: string;
  resourceType: 'issue' | 'pull_request' | 'wiki_page' | 'repository';
  resourceId: string;
  action: string;
  userId: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
  };
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityListResponse {
  activities: ActivityEvent[];
  total: number;
}

export const activityApi = {
  listProjectActivity: (projectId: string, opts?: { limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const q = params.toString();
    return get<ActivityListResponse>(`/projects/${projectId}/activity${q ? `?${q}` : ''}`);
  },

  listIssueActivity: (
    projectId: string,
    issueNumber: number,
    opts?: { limit?: number; offset?: number },
  ) => {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.offset) params.set('offset', String(opts.offset));
    const q = params.toString();
    return get<ActivityListResponse>(
      `/projects/${projectId}/issues/${issueNumber}/activity${q ? `?${q}` : ''}`,
    );
  },
};
