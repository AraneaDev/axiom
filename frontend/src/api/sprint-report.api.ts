import { get } from './client';

export interface SprintReportIssue {
  id: string;
  number: number;
  title: string;
  type: string;
  priority: string;
  storyPoints: number | null;
  columnName: string | null;
  addedMidSprint?: boolean;
  destination?: string;
}

export interface SprintReportScopeChange {
  issueId: string;
  issueNumber: number;
  issueTitle: string;
  action: 'ADDED' | 'REMOVED';
  timestamp: string;
}

export interface SprintReportData {
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    startDate: string;
    endDate: string;
    committedAt: string | null;
    status: string;
  };
  summary: {
    committedCount: number;
    committedPoints: number;
    completedCount: number;
    completedPoints: number;
    incompleteCount: number;
    incompletePoints: number;
    addedMidSprintCount: number;
    removedMidSprintCount: number;
  };
  completedIssues: SprintReportIssue[];
  incompleteIssues: SprintReportIssue[];
  scopeChanges: SprintReportScopeChange[];
}

/** Sprint Report API client. */
export const sprintReportApi = {
  /**
   * Get the sprint report for a given sprint.
   * @param projectId
   * @param sprintId
   */
  get: (projectId: string, sprintId: string) =>
    get<SprintReportData>(`/projects/${projectId}/sprints/${sprintId}/report`),
};
