import { prisma } from '../../config/database';
import { checkUnique } from '../../utils/check-unique';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { parsePagination, paginatedResponse } from '../../utils/pagination';

/**
 * Create a label for a project.
 * @param projectId - The project to create the label in
 * @param data - Label creation data including name, color, and optional description
 * @param data.name
 * @param data.color
 * @param data.description
 * @returns The created label record
 * @throws {AppError} 404 if project not found
 * @throws {AppError} 409 if label name already exists in the project
 */
export async function createLabel(
  projectId: string,
  data: { name: string; color: string; description?: string },
) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

  await checkUnique('label', { projectId, name: data.name }, 'Label with this name already exists');

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
 * List all labels for a project with pagination.
 * @param projectId - The project to list labels for
 * @param query - Pagination query params (limit, offset)
 * @param query.limit
 * @param query.offset
 * @returns Paginated list of labels with total count
 * @throws {AppError} 404 if project not found
 */
export async function listLabels(
  projectId: string,
  query: { limit?: string; offset?: string } = {},
) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

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
 * Update a label by name within a project, checking for name conflicts on rename.
 * @param projectId - The project the label belongs to
 * @param labelName - The current label name
 * @param data - Partial update data for name, color, and/or description
 * @param data.name
 * @param data.color
 * @param data.description
 * @returns The updated label record
 * @throws {AppError} 404 if label not found
 * @throws {AppError} 409 if new label name conflicts with an existing label
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
    ERR.LABEL_NOT_FOUND,
  );

  // If renaming, check for conflicts
  if (data.name && data.name !== labelName) {
    await checkUnique(
      'label',
      { projectId, name: data.name },
      'Label with this name already exists',
    );
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
 * Delete a label by name, automatically removing it from all issues.
 * @param projectId - The project the label belongs to
 * @param labelName - The label name to delete
 * @throws {AppError} 404 if label not found
 */
export async function deleteLabel(projectId: string, labelName: string) {
  const label = await findOrThrow(
    prisma.label.findUnique({
      where: { projectId_name: { projectId, name: labelName } },
    }),
    ERR.LABEL_NOT_FOUND,
  );

  await prisma.label.delete({ where: { id: label.id } });
}
