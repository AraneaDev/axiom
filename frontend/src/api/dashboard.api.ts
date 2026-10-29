import { get } from './client';

export interface DashboardIssue {
  id: string;
  number: number;
  key: string;
  title: string;
  type: string;
  priority: string;
  dueDate: string | null;
  updatedAt: string;
  column: { id: string; name: string; isDone: boolean } | null;
  assignee: { id: string; displayName: string; username: string; avatarUrl: string | null } | null;
  project: {
    id: string;
    name: string;
    slug: string;
    prefix: string;
    team: {
      id: string;
      name: string;
      slug: string;
      org: { id: string; name: string; slug: string };
    };
  };
}

export interface DashboardActivity {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
  user: { id: string; displayName: string; username: string; avatarUrl: string | null };
  resourceTitle: string | null;
  resourceLink: string | null;
  resourceKey: string | null;
}

export interface DashboardTrends {
  assignedIssues: number[];
  upcomingDueDates: number[];
  recentActivity: number[];
}

export interface DashboardData {
  assignedIssues: DashboardIssue[];
  recentActivity: DashboardActivity[];
  upcomingDueDates: DashboardIssue[];
  trends?: DashboardTrends;
}

export const dashboardApi = {
  get: () => get<DashboardData>('/users/me/dashboard'),
};
