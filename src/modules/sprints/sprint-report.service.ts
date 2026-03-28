import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';

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

/**
 * Generate a sprint report with completed/incomplete issues and scope change tracking.
 * @param projectId - The project that owns the sprint
 * @param sprintId - The sprint to generate a report for
 * @returns Sprint report data with summary, issue breakdowns, and scope changes
 * @throws {AppError} 404 if sprint not found or does not belong to project
 * @throws {AppError} 400 if sprint has not been started yet
 */
export async function getSprintReport(
  projectId: string,
  sprintId: string,
): Promise<SprintReportData> {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        issues: {
          include: {
            column: { select: { id: true, name: true, isDone: true } },
          },
        },
        issueHistory: {
          include: {
            issue: {
              select: {
                id: true,
                number: true,
                title: true,
                sprintId: true,
                sprint: { select: { name: true } },
              },
            },
          },
          orderBy: { timestamp: 'asc' },
        },
      },
    }),
    'Sprint not found',
  );

  if (sprint.projectId !== projectId) {
    throw new AppError(404, 'Sprint not found in this project');
  }

  if (!sprint.committedAt) {
    throw new AppError(
      400,
      'Sprint has not been started yet. Start the sprint to generate a report.',
    );
  }

  const committedAt = new Date(sprint.committedAt);

  // Determine the "committed" set: issues that were ADDED before or at committedAt
  const committedIssueIds = new Set<string>();
  for (const entry of sprint.issueHistory) {
    if (new Date(entry.timestamp) <= committedAt) {
      if (entry.action === 'ADDED') {
        committedIssueIds.add(entry.issueId);
      } else if (entry.action === 'REMOVED') {
        committedIssueIds.delete(entry.issueId);
      }
    }
  }

  // Current issues still in the sprint - split into completed vs incomplete
  const completedIssues: SprintReportIssue[] = [];
  const incompleteIssues: SprintReportIssue[] = [];

  for (const issue of sprint.issues) {
    const addedMidSprint = !committedIssueIds.has(issue.id);
    const base: SprintReportIssue = {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      type: issue.type,
      priority: issue.priority,
      storyPoints: issue.storyPoints,
      columnName: issue.column?.name ?? null,
      addedMidSprint,
    };

    if (issue.column?.isDone) {
      completedIssues.push(base);
    } else {
      incompleteIssues.push(base);
    }
  }

  // For completed sprints, also check removed issues (they went somewhere)
  // Build list of removed issues that were removed after committedAt
  const removedAfterCommit = sprint.issueHistory.filter(
    (e) => e.action === 'REMOVED' && new Date(e.timestamp) > committedAt,
  );

  // For removed issues, determine their destination
  for (const entry of removedAfterCommit) {
    // Check if this issue is already in the current sprint issues (re-added)
    if (sprint.issues.some((i) => i.id === entry.issueId)) {
      continue;
    }

    const destination = entry.issue.sprintId
      ? (entry.issue.sprint?.name ?? 'Another sprint')
      : 'Backlog';

    incompleteIssues.push({
      id: entry.issue.id,
      number: entry.issue.number,
      title: entry.issue.title,
      type: '',
      priority: '',
      storyPoints: null,
      columnName: null,
      addedMidSprint: !committedIssueIds.has(entry.issueId),
      destination,
    });
  }

  // Scope changes: history entries after committedAt
  const scopeChanges: SprintReportScopeChange[] = sprint.issueHistory
    .filter((e) => new Date(e.timestamp) > committedAt)
    .map((e) => ({
      issueId: e.issue.id,
      issueNumber: e.issue.number,
      issueTitle: e.issue.title,
      action: e.action as 'ADDED' | 'REMOVED',
      timestamp: e.timestamp.toISOString(),
    }));

  // Count mid-sprint additions and removals
  const addedMidSprintCount = scopeChanges.filter((c) => c.action === 'ADDED').length;
  const removedMidSprintCount = scopeChanges.filter((c) => c.action === 'REMOVED').length;

  // Calculate committed points (original commitment)
  let committedPoints = 0;
  const committedCount = committedIssueIds.size;

  // We need to look up story points for committed issues
  // Some are still in the sprint, some may have been removed
  const issuePointsMap = new Map<string, number>();

  // From current sprint issues
  for (const issue of sprint.issues) {
    issuePointsMap.set(issue.id, issue.storyPoints ?? 0);
  }

  // We can only know points of issues still available
  for (const issueId of committedIssueIds) {
    committedPoints += issuePointsMap.get(issueId) ?? 0;
  }

  const completedPoints = completedIssues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);
  const incompletePoints = incompleteIssues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0);

  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate.toISOString(),
      endDate: sprint.endDate.toISOString(),
      committedAt: sprint.committedAt.toISOString(),
      status: sprint.status,
    },
    summary: {
      committedCount,
      committedPoints,
      completedCount: completedIssues.length,
      completedPoints,
      incompleteCount: incompleteIssues.length,
      incompletePoints,
      addedMidSprintCount,
      removedMidSprintCount,
    },
    completedIssues,
    incompleteIssues,
    scopeChanges,
  };
}
