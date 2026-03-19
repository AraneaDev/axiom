import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

/**
 * Create a new sprint in PLANNING status.
 * @param projectId
 * @param data
 * @param data.name
 * @param data.goal
 * @param data.startDate
 * @param data.endDate
 */
export async function createSprint(
  projectId: string,
  data: { name: string; goal?: string; startDate: string; endDate: string },
) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), 'Project not found');

  return prisma.sprint.create({
    data: {
      projectId,
      name: data.name,
      goal: data.goal,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      status: 'PLANNING',
    },
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * List sprints for a project, optionally filtered by status.
 * @param projectId
 * @param opts
 * @param opts.status
 */
export async function listSprints(projectId: string, opts?: { status?: string }) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), 'Project not found');

  const where: Record<string, unknown> = { projectId };
  if (opts?.status) {
    where.status = opts.status;
  }

  const sprints = await prisma.sprint.findMany({
    where,
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { startDate: 'desc' },
  });

  return sprints.map((s) => ({
    ...s,
    _storyPoints: s.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
  }));
}

/**
 * Get a single sprint with its issues.
 * @param sprintId
 */
export async function getSprint(sprintId: string) {
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!sprint) throw new AppError(404, 'Sprint not found');

  return {
    ...sprint,
    _storyPoints: sprint.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
  };
}

/**
 * Update sprint fields.
 * @param sprintId
 * @param data
 * @param data.name
 * @param data.goal
 * @param data.startDate
 * @param data.endDate
 */
export async function updateSprint(
  sprintId: string,
  data: { name?: string; goal?: string; startDate?: string; endDate?: string },
) {
  await findOrThrow(prisma.sprint.findUnique({ where: { id: sprintId } }), 'Sprint not found');

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.goal !== undefined) updateData.goal = data.goal;
  if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
  if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);

  return prisma.sprint.update({
    where: { id: sprintId },
    data: updateData,
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Start a sprint. Only one active sprint per project is allowed.
 * @param sprintId
 */
export async function startSprint(sprintId: string) {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({ where: { id: sprintId } }),
    'Sprint not found',
  );
  if (sprint.status !== 'PLANNING') {
    throw new AppError(400, 'Only sprints in PLANNING status can be started');
  }

  // Ensure no other active sprint in the same project
  const activeSprint = await prisma.sprint.findFirst({
    where: { projectId: sprint.projectId, status: 'ACTIVE' },
  });
  if (activeSprint) {
    throw new AppError(409, `Sprint "${activeSprint.name}" is already active. Complete it first.`);
  }

  return prisma.sprint.update({
    where: { id: sprintId },
    data: { status: 'ACTIVE' },
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Complete a sprint. Move incomplete issues to another sprint or backlog.
 * @param sprintId
 * @param moveToSprintId
 */
export async function completeSprint(sprintId: string, moveToSprintId?: string) {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({
      where: { id: sprintId },
      include: {
        issues: { include: { column: true } },
      },
    }),
    'Sprint not found',
  );
  if (sprint.status !== 'ACTIVE') {
    throw new AppError(400, 'Only active sprints can be completed');
  }

  if (moveToSprintId) {
    await findOrThrow(
      prisma.sprint.findUnique({ where: { id: moveToSprintId } }),
      'Target sprint not found',
    );
  }

  // Find incomplete issues (not in a "done" column)
  const incompleteIssueIds = sprint.issues.filter((i) => !i.column?.isDone).map((i) => i.id);

  // Move incomplete issues
  if (incompleteIssueIds.length > 0) {
    await prisma.issue.updateMany({
      where: { id: { in: incompleteIssueIds } },
      data: { sprintId: moveToSprintId ?? null },
    });
  }

  return prisma.sprint.update({
    where: { id: sprintId },
    data: { status: 'COMPLETED' },
    include: {
      issues: {
        include: {
          assignee: { select: USER_BASIC_SELECT },
          labels: true,
          column: { select: { id: true, name: true } },
        },
      },
    },
  });
}

/**
 * Add issues to a sprint.
 * @param sprintId
 * @param issueIds
 */
export async function addIssuesToSprint(sprintId: string, issueIds: string[]) {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({ where: { id: sprintId } }),
    'Sprint not found',
  );

  await prisma.issue.updateMany({
    where: { id: { in: issueIds }, projectId: sprint.projectId },
    data: { sprintId },
  });

  return getSprint(sprintId);
}

/**
 * Remove an issue from its sprint (move to backlog).
 * @param issueId
 */
export async function removeIssueFromSprint(issueId: string) {
  await findOrThrow(prisma.issue.findUnique({ where: { id: issueId } }), 'Issue not found');

  return prisma.issue.update({
    where: { id: issueId },
    data: { sprintId: null },
  });
}

/**
 * Calculate velocity: story points completed per sprint for last N sprints.
 * @param projectId
 * @param sprintCount
 */
export async function getVelocity(projectId: string, sprintCount = 5) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), 'Project not found');

  const completedSprints = await prisma.sprint.findMany({
    where: { projectId, status: 'COMPLETED' },
    orderBy: { endDate: 'desc' },
    take: sprintCount,
    include: {
      issues: {
        where: { column: { isDone: true } },
        select: { storyPoints: true },
      },
    },
  });

  return completedSprints
    .map((s) => ({
      sprintId: s.id,
      sprintName: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
      completedPoints: s.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
      issueCount: s.issues.length,
    }))
    .reverse(); // chronological order
}

/**
 * Get backlog issues (issues with no sprint assigned).
 * @param projectId
 */
export async function getBacklog(projectId: string) {
  const project = await findOrThrow(
    prisma.project.findUnique({ where: { id: projectId } }),
    'Project not found',
  );

  const issues = await prisma.issue.findMany({
    where: { projectId, sprintId: null },
    include: {
      assignee: { select: USER_BASIC_SELECT },
      labels: true,
      column: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return issues.map((i) => ({ ...i, key: `${project.prefix}-${i.number}` }));
}
