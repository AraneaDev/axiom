import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/**
 * An issue can only point at a board column or sprint of its own project. Connecting by id
 * alone let an issue join another project's (or org's) sprint, which then listed it, and
 * echoed the foreign sprint's name back.
 * @param projectId - The issue's project
 * @param refs - The ids being set; null or undefined ones are skipped
 * @param refs.columnId
 * @param refs.sprintId
 * @throws {AppError} 400 when one belongs elsewhere or doesn't exist
 */
export async function assertIssueRefsInProject(
  projectId: string,
  refs: { columnId?: string | null; sprintId?: string | null },
): Promise<void> {
  if (refs.columnId) {
    const column = await prisma.boardColumn.findUnique({
      where: { id: refs.columnId },
      select: { projectId: true },
    });
    if (column?.projectId !== projectId) {
      throw new AppError(400, 'The column does not belong to this project');
    }
  }
  if (refs.sprintId) {
    const sprint = await prisma.sprint.findUnique({
      where: { id: refs.sprintId },
      select: { projectId: true },
    });
    if (sprint?.projectId !== projectId) {
      throw new AppError(400, 'The sprint does not belong to this project');
    }
  }
}
