import { prisma } from '../../config/database';
import { findOrThrow } from '../../utils/find-or-throw';

/**
 *
 * @param projectId
 * @param data
 * @param data.title
 * @param data.description
 * @param data.dueDate
 */
export async function createMilestone(
  projectId: string,
  data: { title: string; description?: string; dueDate?: string },
) {
  return prisma.milestone.create({
    data: {
      projectId,
      title: data.title,
      description: data.description,
      dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
    },
  });
}

/**
 *
 * @param projectId
 */
export async function listMilestones(projectId: string) {
  const milestones = await prisma.milestone.findMany({
    where: { projectId },
    include: { _count: { select: { issues: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return milestones.map((m) => ({
    ...m,
    issueCount: m._count.issues,
  }));
}

/**
 *
 * @param milestoneId
 */
export async function getMilestone(milestoneId: string) {
  return findOrThrow(
    prisma.milestone.findUnique({
      where: { id: milestoneId },
      include: {
        issues: { include: { assignee: true }, orderBy: { createdAt: 'desc' } },
      },
    }),
    'Milestone not found',
  );
}

/**
 *
 * @param milestoneId
 * @param data
 * @param data.title
 * @param data.description
 * @param data.dueDate
 * @param data.status
 */
export async function updateMilestone(
  milestoneId: string,
  data: { title?: string; description?: string; dueDate?: string; status?: 'OPEN' | 'CLOSED' },
) {
  await findOrThrow(
    prisma.milestone.findUnique({ where: { id: milestoneId } }),
    'Milestone not found',
  );
  return prisma.milestone.update({
    where: { id: milestoneId },
    data: {
      ...data,
      dueDate:
        data.dueDate !== undefined ? (data.dueDate ? new Date(data.dueDate) : null) : undefined,
    },
  });
}

/**
 *
 * @param milestoneId
 */
export async function deleteMilestone(milestoneId: string) {
  await prisma.milestone.delete({ where: { id: milestoneId } });
}
