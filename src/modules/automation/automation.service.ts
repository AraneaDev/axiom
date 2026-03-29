import { prisma } from '../../config/database';
import { evaluate, parse } from '../../lib/query-engine';
import { issueFieldRegistry } from '../../lib/query-engine/fields/issue-fields';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';

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
  issue: any;
  actorId: string;
  from?: string | null;
  to?: string;
  label?: string;
  automationDepth?: number;
  issueCreationCount?: number;
}

export const AUTOMATION_ISSUE_INCLUDE = {
  assignee: { select: { id: true, username: true, displayName: true, email: true } },
  creator: { select: { id: true, username: true, displayName: true, email: true } },
  labels: { select: { name: true } },
  sprint: { select: { id: true, name: true, goal: true } },
  column: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, key: true } },
} as const;

interface CreateRuleData {
  name: string;
  trigger: AutomationTrigger;
  condition?: string;
  conditions?: AutomationCondition[];
  actions: AutomationAction[];
  enabled?: boolean;
}

/**
 * Create an automation rule for a project.
 * @param projectId
 * @param data
 */
export async function createRule(projectId: string, data: CreateRuleData) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), 'Project not found');

  if (data.condition) {
    try {
      parse(data.condition);
    } catch (e: any) {
      throw new AppError(400, `Invalid condition: ${e.message}`);
    }
  }

  return prisma.automationRule.create({
    data: {
      projectId,
      name: data.name,
      trigger: data.trigger,
      condition: data.condition,
      conditions: data.conditions ? JSON.parse(JSON.stringify(data.conditions)) : undefined,
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
  await findOrThrow(
    prisma.automationRule.findUnique({ where: { id: ruleId } }),
    'Automation rule not found',
  );

  if (data.condition) {
    try {
      parse(data.condition);
    } catch (e: any) {
      throw new AppError(400, `Invalid condition: ${e.message}`);
    }
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.trigger !== undefined) updateData.trigger = data.trigger;
  if (data.condition !== undefined) updateData.condition = data.condition;
  if (data.conditions !== undefined)
    updateData.conditions = data.conditions ? JSON.parse(JSON.stringify(data.conditions)) : null;
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
  await findOrThrow(
    prisma.automationRule.findUnique({ where: { id: ruleId } }),
    'Automation rule not found',
  );
  return prisma.automationRule.delete({ where: { id: ruleId } });
}

/**
 * Toggle an automation rule enabled/disabled.
 * @param ruleId
 */
export async function toggleRule(ruleId: string) {
  const rule = await findOrThrow(
    prisma.automationRule.findUnique({ where: { id: ruleId } }),
    'Automation rule not found',
  );

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
 * @param options
 * @param options.skipAutomation
 */
export async function evaluateRules(
  projectId: string,
  trigger: AutomationTrigger,
  context: AutomationContext,
  options?: { skipAutomation?: boolean },
) {
  if (options?.skipAutomation || (context.automationDepth ?? 0) > 0) return;

  const rules = await prisma.automationRule.findMany({
    where: { projectId, trigger, enabled: true },
  });

  for (const rule of rules) {
    if (!matchesCondition(rule, context)) continue;

    const actions = rule.actions as unknown as AutomationAction[];
    await executeActions(projectId, actions, context);
  }
}

function matchesCondition(rule: any, context: AutomationContext): boolean {
  if (rule.condition) {
    const ast = parse(rule.condition);
    return evaluate(ast, context.issue, issueFieldRegistry, {
      currentUserId: context.actorId,
      projectId: context.issue.projectId,
    });
  }
  if (rule.conditions) {
    return matchesConditionsLegacy(rule.conditions as AutomationCondition[], context);
  }
  return true;
}

function matchesConditionsLegacy(
  conditions: AutomationCondition[],
  context: AutomationContext,
): boolean {
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
