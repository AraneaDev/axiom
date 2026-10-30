import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { validateTransition } from '../workflows/workflows.service';

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

/**
 * Every status change goes through here: the workflow rules must allow the move, and a
 * move into a column an enabled approval gate guards is refused, whatever the source. Gated moves only happen when an
 * approval request is approved (castVote moves the issue itself).
 * @param projectId - The issue's project
 * @param fromColumnId - The issue's current column
 * @param toColumnId - The target column
 * @throws {AppError} 400 when workflow rules forbid it, 409 when an approval gate covers it
 */
export async function assertColumnTransition(
  projectId: string,
  fromColumnId: string | null,
  toColumnId: string,
): Promise<void> {
  if (fromColumnId === toColumnId) return;
  await validateTransition(projectId, fromColumnId, toColumnId);
  // A gate guards entry into its column from anywhere: other columns, no column, or a
  // detour through an intermediate column
  const gate = await prisma.approvalGate.findFirst({
    where: { projectId, toColumnId, enabled: true },
    select: { id: true },
  });
  if (gate) {
    throw new AppError(409, 'This move needs approval: request it through the approval gate');
  }
}
