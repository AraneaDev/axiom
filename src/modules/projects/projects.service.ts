import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

const DEFAULT_COLUMNS = [
  { name: 'Backlog', position: 0, isDefault: true, isDone: false },
  { name: 'To Do', position: 1, isDefault: false, isDone: false },
  { name: 'In Progress', position: 2, isDefault: false, isDone: false },
  { name: 'In Review', position: 3, isDefault: false, isDone: false },
  { name: 'Done', position: 4, isDefault: false, isDone: true },
];

/**
 *
 * @param teamId
 * @param data
 * @param data.name
 * @param data.slug
 * @param data.description
 * @param data.prefix
 */
export async function createProject(
  teamId: string,
  data: {
    name: string;
    slug: string;
    description?: string;
    prefix: string;
  },
) {
  const existing = await prisma.project.findUnique({
    where: { teamId_slug: { teamId, slug: data.slug } },
  });
  if (existing) throw new AppError(409, 'Project slug already taken');

  const prefixExists = await prisma.project.findUnique({
    where: { teamId_prefix: { teamId, prefix: data.prefix } },
  });
  if (prefixExists) throw new AppError(409, 'Project prefix already taken');

  return prisma.project.create({
    data: {
      teamId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      prefix: data.prefix,
      columns: {
        createMany: { data: DEFAULT_COLUMNS },
      },
    },
    include: { columns: { orderBy: { position: 'asc' } } },
  });
}

/**
 *
 * @param projectId
 */
export async function getProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      columns: { orderBy: { position: 'asc' } },
      labels: true,
      _count: { select: { issues: true } },
    },
  });
  if (!project) throw new AppError(404, 'Project not found');
  return project;
}

/**
 *
 * @param teamId
 */
export async function listProjects(teamId: string) {
  return prisma.project.findMany({
    where: { teamId },
    include: { _count: { select: { issues: true } } },
    orderBy: { name: 'asc' },
  });
}

/**
 *
 * @param projectId
 * @param data
 * @param data.name
 * @param data.description
 */
export async function updateProject(
  projectId: string,
  data: { name?: string; description?: string },
) {
  return prisma.project.update({ where: { id: projectId }, data });
}

/**
 *
 * @param projectId
 */
export async function deleteProject(projectId: string) {
  await prisma.project.delete({ where: { id: projectId } });
}

/**
 * Returns analytics data for a project: issue distributions, activity over time,
 * cycle/lead time, and member workload.
 * @param projectId
 */
export async function getProjectAnalytics(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { columns: { orderBy: { position: 'asc' } } },
  });
  if (!project) throw new AppError(404, 'Project not found');

  // Issues by status (board column)
  const columnCounts = await prisma.issue.groupBy({
    by: ['columnId'],
    where: { projectId },
    _count: { id: true },
  });
  const columnMap = new Map(project.columns.map((c) => [c.id, c]));
  const issuesByStatus = columnCounts.map((row) => {
    const col = row.columnId ? columnMap.get(row.columnId) : null;
    return {
      status: col?.name ?? 'Unassigned',
      isDone: col?.isDone ?? false,
      count: row._count.id,
    };
  });

  // Issues by priority
  const priorityCounts = await prisma.issue.groupBy({
    by: ['priority'],
    where: { projectId },
    _count: { id: true },
  });
  const issuesByPriority = priorityCounts.map((row) => ({
    priority: row.priority,
    count: row._count.id,
  }));

  // Issues over time (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentIssues = await prisma.issue.findMany({
    where: {
      projectId,
      OR: [{ createdAt: { gte: thirtyDaysAgo } }, { updatedAt: { gte: thirtyDaysAgo } }],
    },
    select: {
      createdAt: true,
      updatedAt: true,
      columnId: true,
    },
  });

  // Build day-by-day map
  const doneColumnIds = new Set(project.columns.filter((c) => c.isDone).map((c) => c.id));
  const dayMap = new Map<string, { opened: number; closed: number }>();
  for (let d = 0; d < 30; d++) {
    const date = new Date(thirtyDaysAgo);
    date.setDate(date.getDate() + d);
    dayMap.set(date.toISOString().slice(0, 10), { opened: 0, closed: 0 });
  }
  for (const issue of recentIssues) {
    const createdDay = issue.createdAt.toISOString().slice(0, 10);
    if (dayMap.has(createdDay)) {
      dayMap.get(createdDay)!.opened++;
    }
    // Count as closed if column is a done column and updated in range
    if (issue.columnId && doneColumnIds.has(issue.columnId)) {
      const updatedDay = issue.updatedAt.toISOString().slice(0, 10);
      if (dayMap.has(updatedDay)) {
        dayMap.get(updatedDay)!.closed++;
      }
    }
  }
  const issuesOverTime = Array.from(dayMap.entries()).map(([date, counts]) => ({
    date,
    ...counts,
  }));

  // Cycle time & lead time (from issues that are in done columns)
  const closedIssues = await prisma.issue.findMany({
    where: {
      projectId,
      columnId: { in: Array.from(doneColumnIds) },
    },
    select: { createdAt: true, updatedAt: true },
  });

  let avgCycleTime = 0;
  let avgLeadTime = 0;
  if (closedIssues.length > 0) {
    const totalMs = closedIssues.reduce(
      (sum, i) => sum + (i.updatedAt.getTime() - i.createdAt.getTime()),
      0,
    );
    const avgMs = totalMs / closedIssues.length;
    const avgDays = avgMs / (1000 * 60 * 60 * 24);
    avgCycleTime = Math.round(avgDays * 10) / 10;
    avgLeadTime = Math.round(avgDays * 10) / 10;
  }

  // Member workload
  // "In progress" = columns that are not default (Backlog) and not done
  const inProgressColumnIds = new Set(
    project.columns.filter((c) => !c.isDefault && !c.isDone).map((c) => c.id),
  );

  const allIssues = await prisma.issue.findMany({
    where: { projectId, assigneeId: { not: null } },
    select: {
      assigneeId: true,
      columnId: true,
      assignee: { select: { id: true, displayName: true, username: true } },
    },
  });

  const workloadMap = new Map<
    string,
    {
      userId: string;
      displayName: string;
      username: string;
      assignedCount: number;
      inProgressCount: number;
      completedCount: number;
    }
  >();
  for (const issue of allIssues) {
    if (!issue.assigneeId || !issue.assignee) continue;
    const existing = workloadMap.get(issue.assigneeId) ?? {
      userId: issue.assigneeId,
      displayName: issue.assignee.displayName,
      username: issue.assignee.username,
      assignedCount: 0,
      inProgressCount: 0,
      completedCount: 0,
    };
    existing.assignedCount++;
    if (issue.columnId && doneColumnIds.has(issue.columnId)) {
      existing.completedCount++;
    } else if (issue.columnId && inProgressColumnIds.has(issue.columnId)) {
      existing.inProgressCount++;
    }
    workloadMap.set(issue.assigneeId, existing);
  }
  const memberWorkload = Array.from(workloadMap.values()).sort(
    (a, b) => b.assignedCount - a.assignedCount,
  );

  // Totals
  const totalIssues = await prisma.issue.count({ where: { projectId } });
  const openCount = totalIssues - closedIssues.length;

  return {
    totalIssues,
    openCount,
    closedCount: closedIssues.length,
    avgCycleTime,
    avgLeadTime,
    issuesByStatus,
    issuesByPriority,
    issuesOverTime,
    memberWorkload,
  };
}
