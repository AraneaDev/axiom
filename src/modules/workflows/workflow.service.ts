import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

/**
 * Create a workflow transition rule for a project.
 * @param projectId
 * @param data
 * @param data.fromColumnId
 * @param data.toColumnId
 */
export async function createRule(
  projectId: string,
  data: { fromColumnId: string; toColumnId: string },
) {
  if (data.fromColumnId === data.toColumnId) {
    throw new AppError(400, 'From and To columns must be different');
  }

  // Verify both columns belong to this project
  const [fromCol, toCol] = await Promise.all([
    prisma.boardColumn.findFirst({ where: { id: data.fromColumnId, projectId } }),
    prisma.boardColumn.findFirst({ where: { id: data.toColumnId, projectId } }),
  ]);
  if (!fromCol) throw new AppError(404, 'Source column not found in this project');
  if (!toCol) throw new AppError(404, 'Target column not found in this project');

  // Check for duplicate
  const existing = await prisma.workflowRule.findFirst({
    where: { projectId, fromColumnId: data.fromColumnId, toColumnId: data.toColumnId },
  });
  if (existing) throw new AppError(409, 'This transition rule already exists');

  return prisma.workflowRule.create({
    data: {
      projectId,
      fromColumnId: data.fromColumnId,
      toColumnId: data.toColumnId,
    },
    include: {
      fromColumn: { select: { id: true, name: true } },
      toColumn: { select: { id: true, name: true } },
    },
  });
}

/**
 * List all workflow rules for a project.
 * @param projectId
 */
export async function listRules(projectId: string) {
  return prisma.workflowRule.findMany({
    where: { projectId },
    include: {
      fromColumn: { select: { id: true, name: true } },
      toColumn: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Delete a workflow rule.
 * @param ruleId
 */
export async function deleteRule(ruleId: string) {
  const rule = await prisma.workflowRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Workflow rule not found');
  return prisma.workflowRule.delete({ where: { id: ruleId } });
}

/**
 * Update a workflow rule.
 * @param ruleId
 * @param projectId
 * @param data
 * @param data.fromColumnId
 * @param data.toColumnId
 * @param data.requiredFields
 */
export async function updateRule(
  ruleId: string,
  projectId: string,
  data: { fromColumnId?: string; toColumnId?: string; requiredFields?: unknown },
) {
  const rule = await prisma.workflowRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Workflow rule not found');

  const fromColumnId = data.fromColumnId ?? rule.fromColumnId;
  const toColumnId = data.toColumnId ?? rule.toColumnId;

  if (fromColumnId === toColumnId) {
    throw new AppError(400, 'From and To columns must be different');
  }

  // Verify changed columns belong to the project
  if (data.fromColumnId) {
    const fromCol = await prisma.boardColumn.findFirst({
      where: { id: data.fromColumnId, projectId },
    });
    if (!fromCol) throw new AppError(404, 'Source column not found in this project');
  }
  if (data.toColumnId) {
    const toCol = await prisma.boardColumn.findFirst({ where: { id: data.toColumnId, projectId } });
    if (!toCol) throw new AppError(404, 'Target column not found in this project');
  }

  // Check for duplicate if columns changed
  if (data.fromColumnId || data.toColumnId) {
    const existing = await prisma.workflowRule.findFirst({
      where: { projectId, fromColumnId, toColumnId, NOT: { id: ruleId } },
    });
    if (existing) throw new AppError(409, 'This transition rule already exists');
  }

  const updateData: Record<string, unknown> = {};
  if (data.fromColumnId !== undefined) updateData.fromColumnId = data.fromColumnId;
  if (data.toColumnId !== undefined) updateData.toColumnId = data.toColumnId;
  if (data.requiredFields !== undefined) updateData.requiredFields = data.requiredFields;

  return prisma.workflowRule.update({
    where: { id: ruleId },
    data: updateData,
    include: {
      fromColumn: { select: { id: true, name: true } },
      toColumn: { select: { id: true, name: true } },
    },
  });
}

/**
 * Validate whether a column transition is allowed.
 * If no rules exist for fromColumnId, any transition is allowed.
 * If rules exist, toColumnId must be in the allowed list.
 * @param projectId
 * @param fromColumnId
 * @param toColumnId
 */
export async function validateTransition(
  projectId: string,
  fromColumnId: string | null,
  toColumnId: string,
) {
  // If there's no source column (new issue), always allow
  if (!fromColumnId) return;

  const rulesFromColumn = await prisma.workflowRule.findMany({
    where: { projectId, fromColumnId },
  });

  // If no rules defined for this source column, any transition is allowed
  if (rulesFromColumn.length === 0) return;

  const allowed = rulesFromColumn.some((r) => r.toColumnId === toColumnId);
  if (!allowed) {
    throw new AppError(400, 'This column transition is not allowed by workflow rules');
  }
}
