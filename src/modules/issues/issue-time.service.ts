import { prisma } from '../../config/database';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { logActivity } from '../activity/activity.service';

import { findIssueOrThrow } from './issue-utils';

/**
 * Log work against an issue, incrementing timeSpent and recording an activity entry.
 * @param projectId - The project the issue belongs to
 * @param issueNumber - The issue number within the project
 * @param userId - The user logging the work
 * @param minutes - Number of minutes to log
 * @param description - Optional description of the work performed
 * @returns Object with updated timeSpent and logged minutes
 * @throws {AppError} 404 if issue not found
 */
export async function logWork(
  projectId: string,
  issueNumber: number,
  userId: string,
  minutes: number,
  description?: string,
) {
  const issue = await findIssueOrThrow(projectId, issueNumber);

  const [updated] = await prisma.$transaction([
    prisma.issue.update({
      where: { id: issue.id },
      data: { timeSpent: (issue.timeSpent ?? 0) + minutes },
    }),
    prisma.timeEntry.create({
      data: {
        issueId: issue.id,
        userId,
        minutes,
        description: description ?? null,
      },
    }),
  ]);

  await logActivity('issue', issue.id, 'time_logged', userId, {
    minutes,
    description: description ?? '',
    totalSpent: updated.timeSpent,
  });

  return { timeSpent: updated.timeSpent, logged: minutes };
}

/**
 * Get work log entries for an issue.
 * @param projectId - The project the issue belongs to
 * @param issueNumber - The issue number within the project
 * @returns List of work log entries with user, minutes, description, and timestamp
 * @throws {AppError} 404 if issue not found
 */
export async function getWorklogs(projectId: string, issueNumber: number) {
  const issue = await findIssueOrThrow(projectId, issueNumber);

  const entries = await prisma.timeEntry.findMany({
    where: { issueId: issue.id },
    include: { user: { select: USER_BASIC_SELECT } },
    orderBy: { createdAt: 'desc' },
  });

  return entries.map(
    (e: {
      id: string;
      userId: string;
      user: unknown;
      minutes: number;
      description: string | null;
      createdAt: Date;
    }) => ({
      id: e.id,
      userId: e.userId,
      user: e.user,
      minutes: e.minutes,
      description: e.description,
      createdAt: e.createdAt,
    }),
  );
}

/**
 * Get time report for a project: aggregated time per member and per issue.
 * @param projectId - The project ID
 * @returns Time report with per-member and per-issue breakdown
 */
export async function getTimeReport(projectId: string) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

  const entries = await prisma.timeEntry.findMany({
    where: { issue: { projectId } },
    include: {
      user: { select: USER_BASIC_SELECT },
      issue: {
        select: {
          id: true,
          number: true,
          title: true,
          timeEstimate: true,
          sprintId: true,
          sprint: { select: { id: true, name: true } },
        },
      },
    },
  });

  const memberMap = new Map<
    string,
    { userId: string; displayName: string; username: string; totalMinutes: number }
  >();

  for (const entry of entries) {
    const existing = memberMap.get(entry.userId) ?? {
      userId: entry.userId,
      displayName: entry.user.displayName,
      username: entry.user.username,
      totalMinutes: 0,
    };
    existing.totalMinutes += entry.minutes;
    memberMap.set(entry.userId, existing);
  }

  const issueMap = new Map<
    string,
    {
      issueId: string;
      number: number;
      title: string;
      estimateMinutes: number | null;
      loggedMinutes: number;
      sprintId: string | null;
      sprintName: string | null;
    }
  >();

  for (const entry of entries) {
    const existing = issueMap.get(entry.issueId) ?? {
      issueId: entry.issueId,
      number: entry.issue.number,
      title: entry.issue.title,
      estimateMinutes: entry.issue.timeEstimate,
      loggedMinutes: 0,
      sprintId: entry.issue.sprintId,
      sprintName: entry.issue.sprint?.name ?? null,
    };
    existing.loggedMinutes += entry.minutes;
    issueMap.set(entry.issueId, existing);
  }

  // Estimated time from all issues in the project (not just those with entries)
  const allIssues = await prisma.issue.findMany({
    where: { projectId, timeEstimate: { not: null } },
    select: { assigneeId: true, timeEstimate: true },
  });
  const memberEstimates = new Map<string, number>();
  for (const issue of allIssues) {
    if (issue.assigneeId && issue.timeEstimate) {
      memberEstimates.set(
        issue.assigneeId,
        (memberEstimates.get(issue.assigneeId) ?? 0) + issue.timeEstimate,
      );
    }
  }

  const members = Array.from(memberMap.values())
    .map((m) => ({
      ...m,
      estimateMinutes: memberEstimates.get(m.userId) ?? 0,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  return {
    members,
    issues: Array.from(issueMap.values()).sort((a, b) => b.loggedMinutes - a.loggedMinutes),
  };
}
