import { prisma } from '../../config/database';
import { emailQueue } from '../../email/queue';
import { evaluate, parse, resolveTemplate } from '../../lib/query-engine';
import { issueFieldRegistry } from '../../lib/query-engine/fields/issue-fields';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';
import * as issuesService from '../issues/issues.service';

import { executeWebhook } from './webhook';

export type AutomationTrigger =
  | 'issue:created'
  | 'issue:status_changed'
  | 'issue:assigned'
  | 'label:added'
  | 'workflow:completed'
  | 'workflow:failed';

export interface AutomationCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'contains';
  value?: string;
  values?: string[];
}

export interface AutomationAction {
  type:
    | 'set_status'
    | 'set_assignee'
    | 'add_label'
    | 'add_comment'
    | 'set_field'
    | 'create_issue'
    | 'send_email'
    | 'webhook';
  columnId?: string;
  userId?: string;
  name?: string;
  body?: string;
  field?: string;
  value?: string;
  title?: string;
  to?: string;
  subject?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  data?: Record<string, unknown>;
}

export interface AutomationContext {
  issue: Record<string, unknown> & { id: string; projectId: string };
  actorId: string;
  from?: string | null;
  to?: string;
  label?: string;
  automationDepth?: number;
  issueCreationCount?: number;
}

// Re-export so existing consumers importing from this file keep working
export { AUTOMATION_ISSUE_INCLUDE } from '../../utils/prisma-selects';

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
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);

  if (data.condition) {
    try {
      parse(data.condition);
    } catch (e: unknown) {
      throw new AppError(400, `Invalid condition: ${e instanceof Error ? e.message : String(e)}`);
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
    } catch (e: unknown) {
      throw new AppError(400, `Invalid condition: ${e instanceof Error ? e.message : String(e)}`);
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
  if (options?.skipAutomation || (context.automationDepth ?? 0) > 2) return;

  const rules = await prisma.automationRule.findMany({
    where: { projectId, trigger, enabled: true },
  });

  for (const rule of rules) {
    if (!matchesCondition(rule, context)) continue;

    const actions = rule.actions as unknown as AutomationAction[];
    await executeActions(projectId, actions, context);
  }
}

function matchesCondition(
  rule: { condition?: string | null; conditions?: unknown },
  context: AutomationContext,
): boolean {
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

async function buildTemplateContext(context: AutomationContext) {
  const { issue, actorId } = context;
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { username: true, displayName: true, email: true },
  });
  return {
    issue: {
      ...issue,
      labels: (issue.labels as { name: string }[] | undefined)?.map((l) => l.name) ?? [],
    },
    trigger: context.from !== undefined ? 'issue:status_changed' : 'issue:created',
    from: context.from,
    to: context.to,
    label: context.label,
    actor: actor ?? { username: 'system', displayName: 'System', email: '' },
  };
}

async function executeActions(
  projectId: string,
  actions: AutomationAction[],
  context: AutomationContext,
) {
  const issue = context.issue;
  if (!issue?.id) return;

  const templateCtx = await buildTemplateContext(context);

  for (const action of actions) {
    try {
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
            const resolvedBody = resolveTemplate(action.body, templateCtx);
            await prisma.comment.create({
              data: {
                issueId: issue.id,
                authorId: context.actorId,
                body: resolvedBody,
              },
            });
          }
          break;
        case 'set_field':
          if (action.field && action.value !== undefined) {
            const resolvedValue = resolveTemplate(action.value, templateCtx);
            await prisma.issue.update({
              where: { id: issue.id },
              data: { [action.field]: resolvedValue },
            });
          }
          break;
        case 'create_issue':
          if (action.title) {
            const depth = context.automationDepth ?? 0;
            const count = context.issueCreationCount ?? 0;
            if (depth >= 1 || count >= 5) break;
            const resolvedTitle = resolveTemplate(action.title, templateCtx);
            const resolvedIssueBody = action.body
              ? resolveTemplate(action.body, templateCtx)
              : undefined;
            await issuesService.createIssue(
              projectId,
              context.actorId,
              { title: resolvedTitle, body: resolvedIssueBody },
              { skipAutomation: true },
            );
          }
          break;
        case 'send_email':
          if (action.to && action.subject) {
            const resolvedSubject = resolveTemplate(action.subject, templateCtx);
            const resolvedEmailBody = action.body ? resolveTemplate(action.body, templateCtx) : '';
            await emailQueue.add('automation-email', {
              to: action.to,
              recipientName: action.to,
              type: 'automation',
              title: resolvedSubject,
              body: resolvedEmailBody,
            });
          }
          break;
        case 'webhook':
          if (action.url) {
            await executeWebhook(
              action.url,
              action.data ?? templateCtx,
              action.method ?? 'POST',
              action.headers,
            );
          }
          break;
        default:
          logger.warn('Skipping unknown automation action type', {
            projectId,
            issueId: issue.id,
            actionType: String((action as { type?: unknown }).type),
          });
          break;
      }
    } catch (err) {
      logger.error(
        `Automation action ${action.type} failed`,
        { projectId, issueId: issue.id },
        err as Error,
      );
    }
  }
}
