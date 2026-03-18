import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export type AutomationTrigger =
  | 'issue:created'
  | 'issue:status_changed'
  | 'issue:assigned'
  | 'pr:merged'
  | 'label:added';

export interface AutomationCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'contains';
  value?: string;
  values?: string[];
}

export interface AutomationAction {
  type: 'set_status' | 'set_assignee' | 'add_label' | 'add_comment';
  columnId?: string;
  userId?: string;
  name?: string;
  body?: string;
}

export interface AutomationContext {
  issue?: {
    id: string;
    type: string;
    priority: string;
    assigneeId?: string | null;
    columnId?: string | null;
    [key: string]: unknown;
  };
  from?: string | null;
  to?: string;
  label?: string;
}

interface CreateRuleData {
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  enabled?: boolean;
}

/**
 * Create an automation rule for a project.
 * @param projectId
 * @param data
 */
export async function createRule(projectId: string, data: CreateRuleData) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError(404, 'Project not found');

  return prisma.automationRule.create({
    data: {
      projectId,
      name: data.name,
      trigger: data.trigger,
      conditions: JSON.parse(JSON.stringify(data.conditions)),
      actions: JSON.parse(JSON.stringify(data.actions)),
      enabled: data.enabled ?? true,
    },
  });
}

/**
 * List all automation rules for a project.
 * @param projectId
 */
export async function listRules(projectId: string) {
  return prisma.automationRule.findMany({
    where: { projectId },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Update an automation rule.
 * @param ruleId
 * @param data
 */
export async function updateRule(ruleId: string, data: Partial<CreateRuleData>) {
  const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Automation rule not found');

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.trigger !== undefined) updateData.trigger = data.trigger;
  if (data.conditions !== undefined)
    updateData.conditions = JSON.parse(JSON.stringify(data.conditions));
  if (data.actions !== undefined) updateData.actions = JSON.parse(JSON.stringify(data.actions));
  if (data.enabled !== undefined) updateData.enabled = data.enabled;

  return prisma.automationRule.update({
    where: { id: ruleId },
    data: updateData,
  });
}

/**
 * Delete an automation rule.
 * @param ruleId
 */
export async function deleteRule(ruleId: string) {
  const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Automation rule not found');
  return prisma.automationRule.delete({ where: { id: ruleId } });
}

/**
 * Toggle an automation rule enabled/disabled.
 * @param ruleId
 */
export async function toggleRule(ruleId: string) {
  const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError(404, 'Automation rule not found');

  return prisma.automationRule.update({
    where: { id: ruleId },
    data: { enabled: !rule.enabled },
  });
}

/**
 * Evaluate and execute matching automation rules for a given trigger.
 * @param projectId
 * @param trigger
 * @param context
 */
export async function evaluateRules(
  projectId: string,
  trigger: AutomationTrigger,
  context: AutomationContext,
) {
  const rules = await prisma.automationRule.findMany({
    where: { projectId, trigger, enabled: true },
  });

  for (const rule of rules) {
    const conditions = rule.conditions as unknown as AutomationCondition[];
    if (!matchesConditions(conditions, context)) continue;

    const actions = rule.actions as unknown as AutomationAction[];
    await executeActions(projectId, actions, context);
  }
}

function matchesConditions(conditions: AutomationCondition[], context: AutomationContext): boolean {
  if (!conditions || conditions.length === 0) return true;

  const issue = (context.issue ?? {}) as Record<string, string | string[] | undefined>;

  for (const cond of conditions) {
    const fieldValue = issue[cond.field] as string | undefined;

    switch (cond.operator) {
      case 'equals':
        if (fieldValue !== cond.value) return false;
        break;
      case 'not_equals':
        if (fieldValue === cond.value) return false;
        break;
      case 'in':
        if (!cond.values || !cond.values.includes(fieldValue as string)) return false;
        break;
      case 'not_in':
        if (cond.values && cond.values.includes(fieldValue as string)) return false;
        break;
      case 'contains':
        if (typeof fieldValue !== 'string' || !fieldValue.includes(cond.value ?? '')) return false;
        break;
    }
  }
  return true;
}

async function executeActions(
  projectId: string,
  actions: AutomationAction[],
  context: AutomationContext,
) {
  const issue = context.issue;
  if (!issue?.id) return;

  for (const action of actions) {
    switch (action.type) {
      case 'set_status':
        if (action.columnId) {
          await prisma.issue.update({
            where: { id: issue.id },
            data: { columnId: action.columnId },
          });
        }
        break;
      case 'set_assignee':
        if (action.userId) {
          await prisma.issue.update({
            where: { id: issue.id },
            data: { assigneeId: action.userId },
          });
        }
        break;
      case 'add_label':
        if (action.name) {
          await prisma.issue.update({
            where: { id: issue.id },
            data: {
              labels: {
                connectOrCreate: {
                  where: { projectId_name: { projectId, name: action.name } },
                  create: { projectId, name: action.name },
                },
              },
            },
          });
        }
        break;
      case 'add_comment':
        if (action.body) {
          // Use the first project member as the "system" commenter
          const membership = await prisma.teamMembership.findFirst({
            where: { team: { projects: { some: { id: projectId } } } },
            orderBy: { createdAt: 'asc' },
          });
          if (membership) {
            await prisma.comment.create({
              data: {
                issueId: issue.id,
                authorId: membership.userId,
                body: action.body,
              },
            });
          }
        }
        break;
    }
  }
}
