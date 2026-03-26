import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

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
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    include: {
      issues: { include: { assignee: true }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!milestone) throw new AppError(404, 'Milestone not found');
  return milestone;
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
  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new AppError(404, 'Milestone not found');
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
