import { prisma } from '../../config/database';
import { emailQueue } from '../../email/queue';
import { assertKnownFields, evaluate, parse, resolveTemplate } from '../../lib/query-engine';
import { issueFieldRegistry } from '../../lib/query-engine/fields/issue-fields';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';
import type { GithubTriggerContext } from '../github/github-automation';
import { safeGithubContext } from '../github/github-template';
import {
  assertAssignable,
  assertColumnTransition,
  assertIssueRefsInProject,
} from '../issues/issue-references';
import * as issuesService from '../issues/issues.service';
import { resolveQueryFields } from '../search/query-fields.service';

import { applySetField, assertSettableField } from './set-field';
import { executeWebhook, isWebhookMethod } from './webhook';

export type AutomationTrigger =
  | 'issue:created'
  | 'issue:status_changed'
  | 'issue:assigned'
  | 'label:added'
  | 'pr:opened'
  | 'pr:merged'
  | 'pr:closed'
  | 'pr:review_requested'
  | 'pr:review_submitted'
  | 'checks:failed'
  | 'checks:passed'
  | 'branch:created';

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
  /** What the GitHub event behind the trigger was, for templates as `{{github.pr.url}}` */
  github?: GithubTriggerContext;
  /** Asked before an add_comment action runs; false skips the comment and nothing else */
  commentGuard?: () => boolean | Promise<boolean>;
}

// Re-export so existing consumers importing from this file keep working
export { AUTOMATION_ISSUE_INCLUDE } from '../../utils/prisma-selects';

interface CreateRuleData {
  name: string;
  trigger: AutomationTrigger;
  condition?: string | null;
  conditions?: AutomationCondition[] | null;
  actions: AutomationAction[];
  enabled?: boolean;
}

/**
 * Actions may only point at this project's own columns and at assignees on its team: an
 * automation must not do what a member couldn't do by hand.
 * @param projectId
 * @param actions
 * @throws {AppError} 400 for a foreign column, a non-member assignee or a webhook method that
 * isn't allowed
 */
async function assertActionsInProject(projectId: string, actions: AutomationAction[] | undefined) {
  for (const action of actions ?? []) {
    if (action.type === 'set_status' && action.columnId) {
      await assertIssueRefsInProject(projectId, { columnId: action.columnId });
    }
    if (action.type === 'set_assignee' && action.userId) {
      await assertAssignable(projectId, action.userId);
    }
    if (action.type === 'set_field') {
      await assertSettableField(projectId, action.field, action.value);
    }
    if (action.type === 'webhook' && action.method !== undefined) {
      if (!isWebhookMethod(action.method)) {
        throw new AppError(400, 'Webhook method is not allowed');
      }
    }
  }
}

/**
 * A rule's condition must be able to decide something in its project.
 * @param condition - The condition
 * @param projectId - The rule's project
 * @throws {AppError} 400 saying what is wrong
 */
async function assertValidCondition(condition: string, projectId: string) {
  try {
    const ast = parse(condition);
    assertKnownFields(ast, issueFieldRegistry);
    await resolveQueryFields(ast, { projectId });
  } catch (e: unknown) {
    throw new AppError(400, `Invalid condition: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Create an automation rule for a project.
 * @param projectId
 * @param data
 */
export async function createRule(projectId: string, data: CreateRuleData) {
  await findOrThrow(prisma.project.findUnique({ where: { id: projectId } }), ERR.PROJECT_NOT_FOUND);
  await assertActionsInProject(projectId, data.actions);

  if (data.condition) await assertValidCondition(data.condition, projectId);

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
  const existing = await findOrThrow(
    prisma.automationRule.findUnique({ where: { id: ruleId } }),
    'Automation rule not found',
  );
  await assertActionsInProject(existing.projectId, data.actions);

  if (data.condition) await assertValidCondition(data.condition, existing.projectId);

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
    // A condition that can't be evaluated stops its own rule, not the rest of this event's
    let matches = false;
    try {
      matches = await matchesCondition(rule, context);
    } catch (err) {
      logger.warn('automation rule condition failed', { ruleId: rule.id }, err as Error);
    }
    if (!matches) continue;

    const actions = rule.actions as unknown as AutomationAction[];
    await executeActions(projectId, actions, context);
  }
}

async function matchesCondition(
  rule: { condition?: string | null; conditions?: unknown },
  context: AutomationContext,
): Promise<boolean> {
  if (rule.condition) {
    const ast = parse(rule.condition);
    // A condition stored before these were refused: the caller logs it and the rule doesn't run
    assertKnownFields(ast, issueFieldRegistry);
    return evaluate(ast, context.issue, issueFieldRegistry, {
      currentUserId: context.actorId,
      projectId: context.issue.projectId,
      ...(await resolveQueryFields(ast, { projectId: context.issue.projectId })),
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

/**
 * An issue as templates and webhooks see it: no email on its user objects, whatever the caller
 * hydrated, and nothing that is only there for conditions.
 * @param issue
 */
function withoutEmails<T extends Record<string, unknown>>(issue: T): T {
  const copy: Record<string, unknown> = { ...issue };
  // Hydrated for conditions, and no part of what a template or webhook gets
  for (const key of ['linksFrom', 'linksTo', 'customFieldValues']) delete copy[key];
  for (const key of ['assignee', 'creator', 'reporter']) {
    const user = copy[key];
    if (user && typeof user === 'object') {
      const { email: _email, ...rest } = user as Record<string, unknown>;
      copy[key] = rest;
    }
  }
  return copy as T;
}

async function buildTemplateContext(context: AutomationContext) {
  const plain = await buildPlainTemplateContext(context);
  // Where Markdown renders (comment bodies, issue descriptions) GitHub's text is escaped
  const markdown = context.github
    ? { ...plain, github: safeGithubContext(context.github, true) }
    : plain;
  return { plain, markdown };
}

async function buildPlainTemplateContext(context: AutomationContext) {
  const { issue, actorId } = context;
  // No emails in template output: comments and titles reach the whole team, and emails
  // are for admins only. send_email takes its recipient as written, not from a template.
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { username: true, displayName: true },
  });
  return {
    issue: {
      ...withoutEmails(issue),
      labels: (issue.labels as { name: string }[] | undefined)?.map((l) => l.name) ?? [],
    },
    trigger:
      context.github?.trigger ??
      (context.from !== undefined ? 'issue:status_changed' : 'issue:created'),
    github: context.github ? safeGithubContext(context.github, false) : undefined,
    from: context.from,
    to: context.to,
    label: context.label,
    actor: actor ?? { username: 'system', displayName: 'System' },
  };
}

async function executeActions(
  projectId: string,
  actions: AutomationAction[],
  context: AutomationContext,
) {
  const issue = context.issue;
  if (!issue?.id) return;

  const { plain: templateCtx, markdown: markdownCtx } = await buildTemplateContext(context);

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'set_status':
          if (action.columnId) {
            // The same checks as a manual move: the project's own column, workflow rules and
            // approval gates. A refused move is logged and skipped like any failed action.
            await assertIssueRefsInProject(projectId, { columnId: action.columnId });
            const current = await prisma.issue.findUnique({
              where: { id: issue.id },
              select: { columnId: true },
            });
            await assertColumnTransition(projectId, current?.columnId ?? null, action.columnId);
            await prisma.issue.update({
              where: { id: issue.id },
              data: { columnId: action.columnId },
            });
          }
          break;
        case 'set_assignee':
          if (action.userId) {
            // Checked again here: the assignee may have left the team since the rule was saved
            await assertAssignable(projectId, action.userId);
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
            if (context.commentGuard && !(await context.commentGuard())) break;
            const resolvedBody = resolveTemplate(action.body, markdownCtx);
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
            // Allowlisted content fields and the project's custom fields only (set-field.ts)
            // The description renders Markdown; custom TEXT fields are plain inputs and stay raw
            const resolvedValue = resolveTemplate(
              String(action.value),
              action.field === 'body' ? markdownCtx : templateCtx,
            );
            await applySetField(projectId, issue.id, action.field, resolvedValue);
          }
          break;
        case 'create_issue':
          if (action.title) {
            const depth = context.automationDepth ?? 0;
            const count = context.issueCreationCount ?? 0;
            if (depth >= 1 || count >= 5) break;
            const resolvedTitle = resolveTemplate(action.title, templateCtx);
            const resolvedIssueBody = action.body
              ? resolveTemplate(action.body, markdownCtx)
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
