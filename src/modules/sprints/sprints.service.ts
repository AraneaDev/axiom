import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

/**
 * Create a new sprint in PLANNING status.
 * @param projectId - The project to create the sprint in
 * @param data - Sprint creation data including name, optional goal, start date, and end date
 * @param data.name
 * @param data.goal
 * @param data.startDate
 * @param data.endDate
 * @returns The created sprint with issues
 * @throws {AppError} 404 if project not found
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
 * List sprints for a project, optionally filtered by status, with computed story points.
 * @param projectId - The project to list sprints for
 * @param opts - Optional filter options (status)
 * @param opts.status
 * @returns List of sprints with issues and computed story point totals
 * @throws {AppError} 404 if project not found
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
 * Get a single sprint with its issues and computed story points.
 * @param sprintId - The sprint ID
 * @returns The sprint with issues and computed story point total
 * @throws {AppError} 404 if sprint not found
 */
export async function getSprint(sprintId: string) {
  const sprint = await findOrThrow(
    prisma.sprint.findUnique({
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
    }),
    'Sprint not found',
  );

  return {
    ...sprint,
    _storyPoints: sprint.issues.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
  };
}

/**
 * Update sprint fields (name, goal, start date, end date).
 * @param sprintId - The sprint ID
 * @param data - Partial update data for the sprint
 * @param data.name
 * @param data.goal
 * @param data.startDate
 * @param data.endDate
 * @returns The updated sprint with issues
 * @throws {AppError} 404 if sprint not found
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
 * Start a sprint, transitioning it from PLANNING to ACTIVE. Only one active sprint per project is allowed.
 * @param sprintId - The sprint ID
 * @returns The activated sprint with issues
 * @throws {AppError} 404 if sprint not found
 * @throws {AppError} 400 if sprint is not in PLANNING status
 * @throws {AppError} 409 if another sprint is already active in the project
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
 * Complete a sprint, moving incomplete issues to another sprint or backlog.
 * @param sprintId - The sprint ID to complete
 * @param moveToSprintId - Optional target sprint for incomplete issues (null moves to backlog)
 * @returns The completed sprint with issues
 * @throws {AppError} 404 if sprint or target sprint not found
 * @throws {AppError} 400 if sprint is not active
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
 * Add issues to a sprint (only issues in the same project are affected).
 * @param sprintId - The sprint ID
 * @param issueIds - Array of issue IDs to add to the sprint
 * @returns The updated sprint with all issues
 * @throws {AppError} 404 if sprint not found
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
 * @param issueId - The issue ID to remove from its sprint
 * @returns The updated issue with sprintId set to null
 * @throws {AppError} 404 if issue not found
 */
export async function removeIssueFromSprint(issueId: string) {
  await findOrThrow(prisma.issue.findUnique({ where: { id: issueId } }), 'Issue not found');

  return prisma.issue.update({
    where: { id: issueId },
    data: { sprintId: null },
  });
}

/**
 * Calculate velocity: story points completed per sprint for the last N completed sprints.
 * @param projectId - The project to calculate velocity for
 * @param sprintCount - Number of recent completed sprints to include (defaults to 5)
 * @returns Chronologically ordered list of sprints with completed points and issue counts
 * @throws {AppError} 404 if project not found
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
 * Get backlog issues (issues with no sprint assigned) for a project.
 * @param projectId - The project to get backlog issues for
 * @returns List of unassigned issues with computed keys
 * @throws {AppError} 404 if project not found
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
