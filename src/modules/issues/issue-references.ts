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

/**
 * An issue can only be assigned to someone on its project's team (or to no one). Otherwise
 * an issue could be handed to a stranger, who would then see it on their dashboard.
 * @param projectId - The issue's project
 * @param assigneeId - The proposed assignee; null, undefined or empty means unassigned
 * @throws {AppError} 400 when the user isn't a member of the project's team
 */
export async function assertAssignable(
  projectId: string,
  assigneeId: string | null | undefined,
): Promise<void> {
  if (!assigneeId) return;
  const member = await prisma.teamMembership.findFirst({
    where: { userId: assigneeId, team: { projects: { some: { id: projectId } } } },
    select: { id: true },
  });
  if (!member) throw new AppError(400, 'The assignee must be a member of the project team');
}
