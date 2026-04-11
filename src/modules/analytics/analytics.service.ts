import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';

type Period = '7d' | '30d' | '90d' | 'quarter';

function resolvePeriodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      return new Date(now.getFullYear(), quarter * 3, 1);
    }
  }
}

function isValidPeriod(value: string): value is Period {
  return ['7d', '30d', '90d', 'quarter'].includes(value);
}

/**
 *
 * @param value
 */
export function parsePeriod(value?: string): Period {
  if (!value) return '30d';
  if (isValidPeriod(value)) return value;
  return '30d';
}

/**
 * Classify a board column as 'open', 'inProgress', 'inReview', or 'done'.
 * @param col
 * @param col.name
 * @param col.isDefault
 * @param col.isDone
 */
function classifyColumn(col: { name: string; isDefault: boolean; isDone: boolean }): string {
  if (col.isDone) return 'done';
  if (col.isDefault) return 'open';
  const lower = col.name.toLowerCase();
  if (lower.includes('review') || lower.includes('testen')) return 'inReview';
  if (lower.includes('progress') || lower.includes('ontwikkeling')) return 'inProgress';
  return 'open';
}

/**
 *
 * @param orgId
 * @param period
 */
export async function getOrgAnalytics(orgId: string, period: Period) {
  const periodStart = resolvePeriodStart(period);

  // Get all teams and projects in the org
  const teams = await prisma.team.findMany({
    where: { orgId },
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

/**
 *
 * @param teamId
 * @param period
 */
export async function getTeamAnalytics(teamId: string, period: Period) {
  const periodStart = resolvePeriodStart(period);

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: { include: { user: { select: { id: true, displayName: true } } } },
      projects: {
        include: {
          columns: { select: { id: true, name: true, isDefault: true, isDone: true } },
        },
      },
    },
  });
  if (!team) throw new AppError(404, ERR.TEAM_NOT_FOUND);

  // Build column classification map
  const columnClassMap = new Map<string, string>();
  const doneColumnIds = new Set<string>();
  const defaultColumnIds = new Set<string>();
  for (const project of team.projects) {
    for (const col of project.columns) {
      const cls = classifyColumn(col);
      columnClassMap.set(col.id, cls);
      if (cls === 'done') doneColumnIds.add(col.id);
      if (col.isDefault) defaultColumnIds.add(col.id);
    }
  }

  const projectIds = team.projects.map((p) => p.id);
  const projectNameMap = new Map<string, string>();
  const projectSlugMap = new Map<string, string>();
  for (const p of team.projects) {
    projectNameMap.set(p.id, p.name);
    projectSlugMap.set(p.id, p.slug);
  }

  const userNameMap = new Map<string, string>();
  for (const m of team.members) {
    userNameMap.set(m.user.id, m.user.displayName);
  }

  // -- Workload by Member with per-project breakdown --
  const issues = await prisma.issue.findMany({
    where: {
      projectId: { in: projectIds },
      assigneeId: { not: null },
      columnId: { not: null },
    },
    select: {
      assigneeId: true,
      columnId: true,
      projectId: true,
    },
  });

  const workloadMap = new Map<
    string,
    Map<string, { open: number; inProgress: number; inReview: number }>
  >();
  for (const issue of issues) {
    if (!issue.assigneeId || !issue.columnId) continue;
    const cls = columnClassMap.get(issue.columnId);
    if (!cls || cls === 'done') continue;

    if (!workloadMap.has(issue.assigneeId)) workloadMap.set(issue.assigneeId, new Map());
    const userMap = workloadMap.get(issue.assigneeId)!;
    if (!userMap.has(issue.projectId))
      userMap.set(issue.projectId, { open: 0, inProgress: 0, inReview: 0 });
    const entry = userMap.get(issue.projectId)!;
    if (cls === 'inProgress') entry.inProgress++;
    else if (cls === 'inReview') entry.inReview++;
    else entry.open++;
  }

  const workload = Array.from(workloadMap.entries())
    .map(([userId, projectMap]) => {
      let totalOpen = 0,
        totalInProgress = 0,
        totalInReview = 0;
      const projects = Array.from(projectMap.entries()).map(([projectId, counts]) => {
        totalOpen += counts.open;
        totalInProgress += counts.inProgress;
        totalInReview += counts.inReview;
        return {
          projectName: projectNameMap.get(projectId) ?? '',
          projectSlug: projectSlugMap.get(projectId) ?? '',
          ...counts,
          total: counts.open + counts.inProgress + counts.inReview,
        };
      });
      return {
        userId,
        displayName: userNameMap.get(userId) ?? 'Unknown',
        projects,
        totalOpen,
        totalInProgress,
        totalInReview,
        total: totalOpen + totalInProgress + totalInReview,
      };
    })
    .sort((a, b) => b.total - a.total);

  // -- Hours by Member & Project --
  const timeEntries = await prisma.timeEntry.findMany({
    where: {
      issue: { projectId: { in: projectIds } },
      loggedAt: { gte: periodStart },
    },
    select: {
      userId: true,
      minutes: true,
      issue: { select: { projectId: true } },
    },
  });

  const hoursPerMemberProject = new Map<string, Map<string, number>>();
  const hoursPerProject = new Map<string, number>();
  let totalMinutes = 0;

  for (const entry of timeEntries) {
    totalMinutes += entry.minutes;
    const pid = entry.issue.projectId;

    hoursPerProject.set(pid, (hoursPerProject.get(pid) ?? 0) + entry.minutes);

    if (!hoursPerMemberProject.has(entry.userId))
      hoursPerMemberProject.set(entry.userId, new Map());
    const userMap = hoursPerMemberProject.get(entry.userId)!;
    userMap.set(pid, (userMap.get(pid) ?? 0) + entry.minutes);
  }

  const hoursByMember = Array.from(hoursPerMemberProject.entries())
    .map(([userId, projectMap]) => ({
      userId,
      displayName: userNameMap.get(userId) ?? 'Unknown',
      byProject: Array.from(projectMap.entries()).map(([pid, minutes]) => ({
        projectName: projectNameMap.get(pid) ?? '',
        projectSlug: projectSlugMap.get(pid) ?? '',
        minutes,
      })),
      totalMinutes: Array.from(projectMap.values()).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes);

  const hours = {
    totalMinutes,
    byMember: hoursByMember,
    byProject: Array.from(hoursPerProject.entries()).map(([pid, minutes]) => ({
      projectName: projectNameMap.get(pid) ?? '',
      projectSlug: projectSlugMap.get(pid) ?? '',
      minutes,
    })),
  };

  // -- Lead Times by Project with type breakdown --
  const completedIssues = await prisma.issue.findMany({
    where: {
      projectId: { in: projectIds },
      columnId: { in: Array.from(doneColumnIds) },
      updatedAt: { gte: periodStart },
      type: { not: 'EPIC' },
    },
    select: {
      createdAt: true,
      updatedAt: true,
      type: true,
      projectId: true,
    },
  });

  const leadTimeData = new Map<string, Map<string, { totalDays: number; count: number }>>();
  for (const issue of completedIssues) {
    const days = (issue.updatedAt.getTime() - issue.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const pid = issue.projectId;

    if (!leadTimeData.has(pid)) leadTimeData.set(pid, new Map());
    const typeMap = leadTimeData.get(pid)!;

    // Overall
    if (!typeMap.has('ALL')) typeMap.set('ALL', { totalDays: 0, count: 0 });
    const all = typeMap.get('ALL')!;
    all.totalDays += days;
    all.count++;

    // By type
    if (!typeMap.has(issue.type)) typeMap.set(issue.type, { totalDays: 0, count: 0 });
    const byType = typeMap.get(issue.type)!;
    byType.totalDays += days;
    byType.count++;
  }

  const leadTimes = Array.from(leadTimeData.entries()).map(([pid, typeMap]) => {
    const all = typeMap.get('ALL') ?? { totalDays: 0, count: 0 };
    const byType: Record<string, { avgLeadTimeDays: number; count: number }> = {};
    for (const [type, data] of typeMap.entries()) {
      if (type === 'ALL') continue;
      byType[type] = {
        avgLeadTimeDays: Math.round((data.totalDays / data.count) * 10) / 10,
        count: data.count,
      };
    }
    return {
      projectName: projectNameMap.get(pid) ?? '',
      projectSlug: projectSlugMap.get(pid) ?? '',
      avgLeadTimeDays: all.count > 0 ? Math.round((all.totalDays / all.count) * 10) / 10 : 0,
      issuesCompleted: all.count,
      byType,
    };
  });

  // -- Backlog by Project with issues --
  const backlogIssues = await prisma.issue.findMany({
    where: {
      projectId: { in: projectIds },
      columnId: { in: Array.from(defaultColumnIds) },
      type: { not: 'EPIC' },
    },
    select: {
      id: true,
      number: true,
      title: true,
      type: true,
      priority: true,
      createdAt: true,
      projectId: true,
      labels: { select: { name: true } },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  const backlogByProject = new Map<
    string,
    {
      backlogSize: number;
      maintenanceCount: number;
      bugCount: number;
      oldestDate: Date;
      issues: typeof backlogIssues;
    }
  >();

  const now = new Date();
  for (const issue of backlogIssues) {
    const pid = issue.projectId;
    if (!backlogByProject.has(pid)) {
      backlogByProject.set(pid, {
        backlogSize: 0,
        maintenanceCount: 0,
        bugCount: 0,
        oldestDate: issue.createdAt,
        issues: [],
      });
    }
    const entry = backlogByProject.get(pid)!;
    entry.backlogSize++;
    entry.issues.push(issue);
    if (issue.labels.some((l) => l.name === 'onderhoud' || l.name === 'maintenance'))
      entry.maintenanceCount++;
    if (issue.type === 'BUG' || issue.labels.some((l) => l.name === 'bug')) entry.bugCount++;
    if (issue.createdAt < entry.oldestDate) entry.oldestDate = issue.createdAt;
  }

  const backlog = Array.from(backlogByProject.entries())
    .map(([pid, data]) => ({
      projectName: projectNameMap.get(pid) ?? '',
      projectSlug: projectSlugMap.get(pid) ?? '',
      backlogSize: data.backlogSize,
      maintenanceCount: data.maintenanceCount,
      bugCount: data.bugCount,
      oldestItemDays: Math.round(
        (now.getTime() - data.oldestDate.getTime()) / (1000 * 60 * 60 * 24),
      ),
      issues: data.issues.map((i) => ({
        id: i.id,
        number: i.number,
        title: i.title,
        type: i.type,
        priority: i.priority,
        ageDays: Math.round((now.getTime() - i.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
        labels: i.labels.map((l) => l.name),
      })),
    }))
    .sort((a, b) => b.backlogSize - a.backlogSize);

  return { workload, hours, leadTimes, backlog };
}
