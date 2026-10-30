import { prisma } from '../../config/database';

import { classifyColumn, resolvePeriodStart, type Period } from './analytics-helpers';

/**
 * Teams a viewer may see in org analytics.
 * @param orgId
 * @param userId
 */
async function readableTeamsWhere(orgId: string, userId: string) {
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
    prisma.orgMembership.findUnique({ where: { userId_orgId: { userId, orgId } } }),
  ]);
  if (user?.isAdmin || membership?.role === 'OWNER' || membership?.role === 'ADMIN') return {};
  return { members: { some: { userId } } };
}

/**
 *
 * @param orgId
 * @param period
 * @param viewerId
 */
export async function getOrgAnalytics(orgId: string, period: Period, viewerId?: string) {
  const periodStart = resolvePeriodStart(period);

  // Teams the viewer can read: all of them for org OWNERs/ADMINs and platform admins,
  // otherwise only their own (team-wide reads need team membership)
  const teamScope = viewerId ? await readableTeamsWhere(orgId, viewerId) : {};
  const teams = await prisma.team.findMany({
    where: { orgId, ...teamScope },
    include: {
      members: { include: { user: { select: { id: true, displayName: true } } } },
      projects: {
        include: {
          columns: { select: { id: true, name: true, isDefault: true, isDone: true } },
        },
      },
    },
  });

  // Build column classification map
  const columnClassMap = new Map<string, string>();
  const doneColumnIds = new Set<string>();
  for (const team of teams) {
    for (const project of team.projects) {
      for (const col of project.columns) {
        const cls = classifyColumn(col);
        columnClassMap.set(col.id, cls);
        if (cls === 'done') doneColumnIds.add(col.id);
      }
    }
  }

  const allProjectIds = teams.flatMap((t) => t.projects.map((p) => p.id));

  // -- Workload --
  const issues = await prisma.issue.findMany({
    where: {
      projectId: { in: allProjectIds },
      assigneeId: { not: null },
      columnId: { not: null },
    },
    select: {
      assigneeId: true,
      columnId: true,
      project: { select: { teamId: true } },
    },
  });

  // Build team name map
  const teamNameMap = new Map<string, string>();
  const teamSlugMap = new Map<string, string>();
  const memberTeamMap = new Map<string, string>(); // userId -> teamId
  for (const team of teams) {
    teamNameMap.set(team.id, team.name);
    teamSlugMap.set(team.id, team.slug);
    for (const m of team.members) {
      memberTeamMap.set(m.user.id, team.id);
    }
  }

  // Build user display name map
  const userNameMap = new Map<string, string>();
  for (const team of teams) {
    for (const m of team.members) {
      userNameMap.set(m.user.id, m.user.displayName);
    }
  }

  // Aggregate workload per member
  const workloadMap = new Map<string, { open: number; inProgress: number; inReview: number }>();
  for (const issue of issues) {
    if (!issue.assigneeId || !issue.columnId) continue;
    const cls = columnClassMap.get(issue.columnId);
    if (!cls || cls === 'done') continue;

    if (!workloadMap.has(issue.assigneeId)) {
      workloadMap.set(issue.assigneeId, { open: 0, inProgress: 0, inReview: 0 });
    }
    const entry = workloadMap.get(issue.assigneeId)!;
    if (cls === 'inProgress') entry.inProgress++;
    else if (cls === 'inReview') entry.inReview++;
    else entry.open++;
  }

  const workload = Array.from(workloadMap.entries())
    .map(([userId, counts]) => {
      const teamId = memberTeamMap.get(userId);
      return {
        userId,
        displayName: userNameMap.get(userId) ?? 'Unknown',
        teamName: teamId ? (teamNameMap.get(teamId) ?? '') : '',
        teamSlug: teamId ? (teamSlugMap.get(teamId) ?? '') : '',
        ...counts,
        total: counts.open + counts.inProgress + counts.inReview,
      };
    })
    .sort((a, b) => b.total - a.total);

  // -- Hours --
  const timeEntries = await prisma.timeEntry.findMany({
    where: {
      issue: { projectId: { in: allProjectIds } },
      loggedAt: { gte: periodStart },
    },
    select: {
      userId: true,
      minutes: true,
      issue: {
        select: {
          project: {
            select: { id: true, name: true, slug: true, teamId: true },
          },
        },
      },
    },
  });

  const hoursByMember: Record<
    string,
    {
      userId: string;
      displayName: string;
      teamName: string;
      teamSlug: string;
      projectName: string;
      projectSlug: string;
      minutes: number;
    }[]
  > = {};
  const hoursByTeam = new Map<string, number>();
  let totalMinutes = 0;

  for (const entry of timeEntries) {
    totalMinutes += entry.minutes;

    const teamId = entry.issue.project.teamId;
    hoursByTeam.set(teamId, (hoursByTeam.get(teamId) ?? 0) + entry.minutes);

    const key = `${entry.userId}:${entry.issue.project.id}`;
    if (!hoursByMember[key]) {
      hoursByMember[key] = [];
    }
    // Accumulate into existing entry or create new
    const existing = hoursByMember[key].find((h) => h.projectName === entry.issue.project.name);
    if (existing) {
      existing.minutes += entry.minutes;
    } else {
      hoursByMember[key].push({
        userId: entry.userId,
        displayName: userNameMap.get(entry.userId) ?? 'Unknown',
        teamName: teamNameMap.get(teamId) ?? '',
        teamSlug: teamSlugMap.get(teamId) ?? '',
        projectName: entry.issue.project.name,
        projectSlug: entry.issue.project.slug,
        minutes: entry.minutes,
      });
    }
  }

  const hours = {
    totalMinutes,
    byMember: Object.values(hoursByMember)
      .flat()
      .sort((a, b) => b.minutes - a.minutes),
    byTeam: Array.from(hoursByTeam.entries()).map(([teamId, minutes]) => ({
      teamName: teamNameMap.get(teamId) ?? '',
      minutes,
    })),
  };

  // -- Lead Times --
  const completedIssues = await prisma.issue.findMany({
    where: {
      projectId: { in: allProjectIds },
      columnId: { in: Array.from(doneColumnIds) },
      updatedAt: { gte: periodStart },
      type: { not: 'EPIC' },
    },
    select: {
      createdAt: true,
      updatedAt: true,
      project: { select: { name: true, slug: true, team: { select: { slug: true } } } },
    },
  });

  const leadTimesByProject = new Map<
    string,
    { totalDays: number; count: number; teamSlug: string }
  >();
  for (const issue of completedIssues) {
    const days = (issue.updatedAt.getTime() - issue.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const key = issue.project.slug;
    if (!leadTimesByProject.has(key)) {
      leadTimesByProject.set(key, { totalDays: 0, count: 0, teamSlug: issue.project.team.slug });
    }
    const entry = leadTimesByProject.get(key)!;
    entry.totalDays += days;
    entry.count++;
  }

  const leadTimes = Array.from(leadTimesByProject.entries()).map(([slug, data]) => ({
    projectName: completedIssues.find((i) => i.project.slug === slug)?.project.name ?? slug,
    projectSlug: slug,
    teamSlug: data.teamSlug,
    avgLeadTimeDays: Math.round((data.totalDays / data.count) * 10) / 10,
    issuesCompleted: data.count,
  }));

  // -- Backlog Health --
  const defaultColumnIds = new Set<string>();
  for (const team of teams) {
    for (const project of team.projects) {
      for (const col of project.columns) {
        if (col.isDefault) defaultColumnIds.add(col.id);
      }
    }
  }

  const backlogIssues = await prisma.issue.findMany({
    where: {
      projectId: { in: allProjectIds },
      columnId: { in: Array.from(defaultColumnIds) },
      type: { not: 'EPIC' },
    },
    select: {
      createdAt: true,
      type: true,
      project: { select: { name: true, slug: true, team: { select: { slug: true } } } },
      labels: { select: { name: true } },
    },
  });

  const backlogByProject = new Map<
    string,
    {
      projectName: string;
      teamSlug: string;
      backlogSize: number;
      maintenanceCount: number;
      bugCount: number;
      oldestDate: Date;
    }
  >();

  for (const issue of backlogIssues) {
    const key = issue.project.slug;
    if (!backlogByProject.has(key)) {
      backlogByProject.set(key, {
        projectName: issue.project.name,
        teamSlug: issue.project.team.slug,
        backlogSize: 0,
        maintenanceCount: 0,
        bugCount: 0,
        oldestDate: issue.createdAt,
      });
    }
    const entry = backlogByProject.get(key)!;
    entry.backlogSize++;
    if (issue.labels.some((l) => l.name === 'onderhoud' || l.name === 'maintenance'))
      entry.maintenanceCount++;
    if (issue.type === 'BUG' || issue.labels.some((l) => l.name === 'bug')) entry.bugCount++;
    if (issue.createdAt < entry.oldestDate) entry.oldestDate = issue.createdAt;
  }

  const now = new Date();
  const backlog = Array.from(backlogByProject.entries())
    .map(([slug, data]) => ({
      projectName: data.projectName,
      projectSlug: slug,
      teamSlug: data.teamSlug,
      backlogSize: data.backlogSize,
      maintenanceCount: data.maintenanceCount,
      bugCount: data.bugCount,
      oldestItemDays: Math.round(
        (now.getTime() - data.oldestDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
    }))
    .sort((a, b) => b.backlogSize - a.backlogSize);

  return { workload, hours, leadTimes, backlog };
}
