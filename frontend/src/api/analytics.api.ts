import { get } from './client';

export interface WorkloadEntry {
  userId: string;
  displayName: string;
  teamName: string;
  teamSlug: string;
  open: number;
  inProgress: number;
  inReview: number;
  total: number;
}

export interface HoursEntry {
  userId: string;
  displayName: string;
  teamName: string;
  projectName: string;
  minutes: number;
}

export interface OrgHours {
  totalMinutes: number;
  byMember: HoursEntry[];
  byTeam: { teamName: string; minutes: number }[];
}

export interface LeadTimeEntry {
  projectName: string;
  projectSlug: string;
  teamSlug: string;
  avgLeadTimeDays: number;
  issuesCompleted: number;
}

export interface BacklogEntry {
  projectName: string;
  projectSlug: string;
  teamSlug: string;
  backlogSize: number;
  maintenanceCount: number;
  bugCount: number;
  oldestItemDays: number;
}

export interface OrgAnalytics {
  workload: WorkloadEntry[];
  hours: OrgHours;
  leadTimes: LeadTimeEntry[];
  backlog: BacklogEntry[];
}

// Team-level types (more granular)
export interface TeamWorkloadProject {
  projectName: string;
  projectSlug: string;
  open: number;
  inProgress: number;
  inReview: number;
  total: number;
}

export interface TeamWorkloadEntry {
  userId: string;
  displayName: string;
  projects: TeamWorkloadProject[];
  totalOpen: number;
  totalInProgress: number;
  totalInReview: number;
  total: number;
}

export interface TeamHoursMember {
  userId: string;
  displayName: string;
  byProject: { projectName: string; projectSlug: string; minutes: number }[];
  totalMinutes: number;
}

export interface TeamHours {
  totalMinutes: number;
  byMember: TeamHoursMember[];
  byProject: { projectName: string; projectSlug: string; minutes: number }[];
}

export interface TeamLeadTimeEntry {
  projectName: string;
  projectSlug: string;
  avgLeadTimeDays: number;
  issuesCompleted: number;
  byType: Record<string, { avgLeadTimeDays: number; count: number }>;
}

export interface BacklogIssue {
  id: string;
  number: number;
  title: string;
  type: string;
  priority: string;
  ageDays: number;
  labels: string[];
}

export interface TeamBacklogEntry {
  projectName: string;
  projectSlug: string;
  backlogSize: number;
  maintenanceCount: number;
  bugCount: number;
  oldestItemDays: number;
  issues: BacklogIssue[];
}

export interface TeamAnalytics {
  workload: TeamWorkloadEntry[];
  hours: TeamHours;
  leadTimes: TeamLeadTimeEntry[];
  backlog: TeamBacklogEntry[];
}

export type Period = '7d' | '30d' | '90d' | 'quarter';

export const analyticsApi = {
  orgAnalytics: (orgId: string, period: Period = '30d') =>
    get<OrgAnalytics>(`/orgs/${orgId}/analytics?period=${period}`),

  teamAnalytics: (teamId: string, period: Period = '30d') =>
    get<TeamAnalytics>(`/teams/${teamId}/analytics?period=${period}`),
};
