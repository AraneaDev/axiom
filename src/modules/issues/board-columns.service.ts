import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';

/**
 * Create a new board column in a project.
 * @param projectId
 * @param data
 * @param data.name
 * @param data.position
 * @param data.isDone
 * @param data.wipLimit
 */
export async function createColumn(
  projectId: string,
  data: { name: string; position?: number; isDone?: boolean; wipLimit?: number | null },
) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

  // If no position given, append at end
  let position: number;
  if (data.position !== undefined) {
    position = data.position;
  } else {
    const last = await prisma.boardColumn.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    position = (last?.position ?? -1) + 1;
  }

  return prisma.boardColumn.create({
    data: {
      projectId,
      name: data.name,
      position,
      isDone: data.isDone ?? false,
      ...(data.wipLimit !== undefined && { wipLimit: data.wipLimit }),
    },
  });
}

/**
 * Update a board column's name or done status.
 * @param projectId
 * @param columnId
 * @param data
 * @param data.name
 * @param data.isDone
 * @param data.wipLimit
 */
export async function updateColumn(
  projectId: string,
  columnId: string,
  data: { name?: string; isDone?: boolean; wipLimit?: number | null },
) {
  const column = await findOrThrow(
    prisma.boardColumn.findUnique({ where: { id: columnId } }),
    ERR.COLUMN_NOT_FOUND,
  );
  if (column.projectId !== projectId) throw new AppError(404, ERR.COLUMN_NOT_FOUND);

  return prisma.boardColumn.update({
    where: { id: columnId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.isDone !== undefined && { isDone: data.isDone }),
      ...(data.wipLimit !== undefined && { wipLimit: data.wipLimit }),
    },
  });
}

/**
 * Delete a board column if it has no issues.
 * @param projectId
 * @param columnId
 */
export async function deleteColumn(projectId: string, columnId: string) {
  const column = await findOrThrow(
    prisma.boardColumn.findUnique({
      where: { id: columnId },
      include: { _count: { select: { issues: true } } },
    }),
    ERR.COLUMN_NOT_FOUND,
  );
  if (column.projectId !== projectId) throw new AppError(404, ERR.COLUMN_NOT_FOUND);
  if (column.isDefault) throw new AppError(400, 'Cannot delete the default column');
  if (column._count.issues > 0) {
    throw new AppError(400, 'Cannot delete a column that has issues. Move them first.');
  }

  await prisma.boardColumn.delete({ where: { id: columnId } });
}

/**
 * Reorder board columns by updating their positions atomically.
 * @param projectId
 * @param positions
 */
export async function reorderColumns(
  projectId: string,
  positions: { id: string; position: number }[],
) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

  await prisma.$transaction(
    positions.map(({ id, position }) =>
      prisma.boardColumn.updateMany({
        where: { id, projectId },
        data: { position },
      }),
    ),
  );

  return prisma.boardColumn.findMany({
    where: { projectId },
    orderBy: { position: 'asc' },
  });
}
