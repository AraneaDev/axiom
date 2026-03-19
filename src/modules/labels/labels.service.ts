import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { parsePagination, paginatedResponse } from '../../utils/pagination';

/**
 * Create a label for a project.
 * @param projectId
 * @param data
 * @param data.name
 * @param data.color
 * @param data.description
 */
export async function createLabel(
  projectId: string,
  data: { name: string; color: string; description?: string },
) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), 'Project not found');

  const existing = await prisma.label.findUnique({
    where: { projectId_name: { projectId, name: data.name } },
  });
  if (existing) throw new AppError(409, 'Label with this name already exists');

  return prisma.label.create({
    data: {
      projectId,
      name: data.name,
      color: data.color,
      description: data.description,
    },
  });
}

/**
 * List all labels for a project.
 * @param projectId
 * @param query
 * @param query.limit
 * @param query.offset
 */
export async function listLabels(
  projectId: string,
  query: { limit?: string; offset?: string } = {},
) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), 'Project not found');

  const { take, skip } = parsePagination(query, { limit: 50 });
  const where = { projectId };

  const [labels, total] = await Promise.all([
    prisma.label.findMany({
      where,
      orderBy: { name: 'asc' },
      take,
      skip,
    }),
    prisma.label.count({ where }),
  ]);

  return paginatedResponse(labels, total, take, skip);
}

/**
 * Update a label by name within a project.
 * @param projectId
 * @param labelName
 * @param data
 * @param data.name
 * @param data.color
 * @param data.description
 */
export async function updateLabel(
  projectId: string,
  labelName: string,
  data: { name?: string; color?: string; description?: string },
) {
  const label = await findOrThrow(
    prisma.label.findUnique({
      where: { projectId_name: { projectId, name: labelName } },
    }),
    'Label not found',
  );

  // If renaming, check for conflicts
  if (data.name && data.name !== labelName) {
    const conflict = await prisma.label.findUnique({
      where: { projectId_name: { projectId, name: data.name } },
    });
    if (conflict) throw new AppError(409, 'Label with this name already exists');
  }

  return prisma.label.update({
    where: { id: label.id },
    data: {
      name: data.name,
      color: data.color,
      description: data.description,
    },
  });
}

/**
 * Delete a label by name. Removes it from all issues automatically (many-to-many disconnect).
 * @param projectId
 * @param labelName
 */
export async function deleteLabel(projectId: string, labelName: string) {
  const label = await findOrThrow(
    prisma.label.findUnique({
      where: { projectId_name: { projectId, name: labelName } },
    }),
    'Label not found',
  );

  await prisma.label.delete({ where: { id: label.id } });
}
