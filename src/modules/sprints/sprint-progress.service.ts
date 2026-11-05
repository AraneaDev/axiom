import type { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { BLOCKED_WHERE, OPEN_ISSUE } from '../../lib/query-engine/derived-fields';
import { projectsInScope, viewableProjectsWhere } from '../search/search-access';

import { committedIssueIds, isDoneIssue, issueStage, pointsOf } from './sprint-metrics';

export interface SprintOverviewInput {
  state?: 'ACTIVE' | 'PLANNING';
  scope?: { orgId?: string; teamId?: string; projectId?: string };
  includeBlocked?: boolean;
}

export interface BlockerRef {
  key?: string;
  title?: string;
  hidden?: true;
}

export interface BlockedIssue {
  key: string;
  title: string;
  assignee?: { displayName: string };
  blockedBy: BlockerRef[];
}

export interface SprintOverviewEntry {
  id: string;
  name: string;
  goal: string | null;
  project: { key: string; name: string };
  startDate: string;
  endDate: string;
  /** Whole days to the end date, negative once it has passed */
  daysLeft: number;
  issues: { total: number; done: number; inProgress: number; todo: number };
  points: { committed: number; done: number };
  blocked: BlockedIssue[];
}

const DAY_MS = 86_400_000;

const BLOCKER_SELECT = {
  number: true,
  title: true,
  projectId: true,
  project: { select: { prefix: true } },
} as const;

/**
 * The sprints of every project the viewer can open, with their progress and blocked issues,
 * counted by the same rules as the sprint report. Loaded in bulk: one query per kind of data, not
 * per sprint.
 * @param userId - The viewer
 * @param input - Which sprints, and whether to list blocked issues
 * @param now - The moment daysLeft counts from
 */
export async function sprintOverview(
  userId: string,
  input: SprintOverviewInput,
  now: Date = new Date(),
): Promise<{ sprints: SprintOverviewEntry[] }> {
  const viewable = await viewableProjectsWhere(userId);
  const projectWhere: Prisma.ProjectWhereInput = {
    AND: [viewable, projectsInScope(input.scope)],
  };

  const sprints = await prisma.sprint.findMany({
    where: { status: input.state ?? 'ACTIVE', project: projectWhere },
    orderBy: [{ endDate: 'asc' }, { id: 'asc' }],
    include: {
      project: { select: { prefix: true, name: true } },
      issues: {
        select: {
          id: true,
          storyPoints: true,
          column: { select: { name: true, isDefault: true, isDone: true } },
        },
      },
      issueHistory: {
        where: { sprint: { committedAt: { not: null } } },
        select: { issueId: true, action: true, timestamp: true },
      },
    },
  });

  const blocked =
    input.includeBlocked === false
      ? new Map<string, BlockedIssue[]>()
      : await blockedBySprint(
          userId,
          sprints.map((sprint) => sprint.id),
        );

  return {
    sprints: sprints.map((sprint) => {
      const stages = { done: 0, inProgress: 0, todo: 0 };
      let donePoints = 0;
      for (const issue of sprint.issues) {
        stages[issueStage(issue)] += 1;
        if (isDoneIssue(issue)) donePoints += pointsOf(issue);
      }
      // A sprint not yet started has no commitment: its whole scope counts
      const committed = sprint.committedAt
        ? committedIssueIds(sprint.issueHistory, sprint.committedAt)
        : null;
      const committedPoints = sprint.issues
        .filter((issue) => committed === null || committed.has(issue.id))
        .reduce((sum, issue) => sum + pointsOf(issue), 0);
      return {
        id: sprint.id,
        name: sprint.name,
        goal: sprint.goal,
        project: { key: sprint.project.prefix, name: sprint.project.name },
        startDate: sprint.startDate.toISOString(),
        endDate: sprint.endDate.toISOString(),
        daysLeft: Math.ceil((sprint.endDate.getTime() - now.getTime()) / DAY_MS),
        issues: { total: sprint.issues.length, ...stages },
        points: { committed: committedPoints, done: donePoints },
        blocked: blocked.get(sprint.id) ?? [],
      };
    }),
  };
}

/**
 * The open issues of the sprints that wait on an open issue, with who blocks them. A blocker in a
 * project the viewer cannot open is named only as hidden: the fact is on the blocked issue's own
 * links, its key and title are not.
 * @param userId - The viewer
 * @param sprintIds - The sprints
 */
async function blockedBySprint(
  userId: string,
  sprintIds: string[],
): Promise<Map<string, BlockedIssue[]>> {
  const issues = await prisma.issue.findMany({
    where: { sprintId: { in: sprintIds }, AND: [BLOCKED_WHERE, OPEN_ISSUE] },
    orderBy: [{ project: { prefix: 'asc' } }, { number: 'asc' }],
    select: {
      id: true,
      sprintId: true,
      number: true,
      title: true,
      project: { select: { prefix: true } },
      assignee: { select: { displayName: true } },
      linksFrom: {
        where: { type: 'IS_BLOCKED_BY', to: OPEN_ISSUE },
        select: { to: { select: BLOCKER_SELECT } },
      },
      linksTo: {
        where: { type: 'BLOCKS', from: OPEN_ISSUE },
        select: { from: { select: BLOCKER_SELECT } },
      },
    },
  });

  const blockerProjects = new Set<string>();
  for (const issue of issues) {
    for (const link of issue.linksFrom) blockerProjects.add(link.to.projectId);
    for (const link of issue.linksTo) blockerProjects.add(link.from.projectId);
  }
  const visible = new Set(
    (
      await prisma.project.findMany({
        where: { AND: [await viewableProjectsWhere(userId), { id: { in: [...blockerProjects] } }] },
        select: { id: true },
      })
    ).map((project) => project.id),
  );

  const bySprint = new Map<string, BlockedIssue[]>();
  for (const issue of issues) {
    const seen = new Set<string>();
    const blockedBy: BlockerRef[] = [];
    for (const blocker of [
      ...issue.linksFrom.map((link) => link.to),
      ...issue.linksTo.map((link) => link.from),
    ]) {
      // A link pair stored both ways names the same blocker twice
      const key = `${blocker.project.prefix}-${blocker.number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blockedBy.push(
        visible.has(blocker.projectId) ? { key, title: blocker.title } : { hidden: true },
      );
    }
    const entry: BlockedIssue = {
      key: `${issue.project.prefix}-${issue.number}`,
      title: issue.title,
      ...(issue.assignee ? { assignee: { displayName: issue.assignee.displayName } } : {}),
      blockedBy,
    };
    const list = bySprint.get(issue.sprintId as string) ?? [];
    list.push(entry);
    bySprint.set(issue.sprintId as string, list);
  }
  return bySprint;
}
