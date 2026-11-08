import { z } from 'zod';

import { ownedByProject, projectAction, projectRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { inputPlace } from '../../actions/places';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { projectOf } from '../../middleware/requireProjectAccess';

import * as automationService from './automation.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const nothing = z.void();

const RULES = '/api/projects/:projectId/automation-rules';
const RULE = `${RULES}/:ruleId`;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const ruleTarget = projectTarget.extend({ ruleId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;
type RuleInput = z.infer<typeof ruleTarget>;

const read = projectRead<ProjectInput>((input) => input.projectId);
// Automation rules are project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
const settings = projectAction<ProjectInput>('team:manage_members', (input) => input.projectId);
const ownedRule = ownedByProject<RuleInput>(
  projectOf.automationRule,
  (input) => ({ projectId: input.projectId, recordId: input.ruleId }),
  'team:manage_members',
);

const TRIGGERS = [
  'issue:created',
  'issue:status_changed',
  'issue:assigned',
  'label:added',
  'pr:opened',
  'pr:merged',
  'pr:closed',
  'pr:review_requested',
  'pr:review_submitted',
  'checks:failed',
  'checks:passed',
  'branch:created',
] as const;
const ACTION_TYPES = [
  'set_status',
  'set_assignee',
  'add_label',
  'add_comment',
  'set_field',
  'create_issue',
  'send_email',
  'webhook',
] as const;
const MAX_LIST = 50;
const TEXT = z.string().max(5000);

const condition = z.object({
  field: z.string().min(1).max(100),
  operator: z.enum(['equals', 'not_equals', 'in', 'not_in', 'contains']),
  value: z.string().max(1000).optional(),
  values: z.array(z.string().max(1000)).max(MAX_LIST).optional(),
});

/**
 * Each type reads its own fields (see AutomationAction). A key none of them reads is refused,
 * so a misspelled field answers 400 instead of storing an action that does nothing.
 */
const action = z.strictObject(
  {
    type: z.enum(ACTION_TYPES),
    columnId: z.string().max(64).optional(),
    userId: z.string().max(64).optional(),
    name: z.string().max(200).optional(),
    body: TEXT.optional(),
    field: z.string().max(100).optional(),
    value: z.string().max(5000).optional(),
    title: z.string().max(500).optional(),
    to: z.string().max(500).optional(),
    subject: z.string().max(500).optional(),
    url: z.string().max(2000).optional(),
    method: z.string().max(10).optional(),
    headers: z.record(z.string(), z.string()).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  },
  {
    // Name the key, so a client saving a rule written elsewhere knows what to drop
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `no action type reads ${issue.keys.map((key) => `"${key}"`).join(', ')}: remove it from the action`
        : undefined,
  },
);

const ruleFields = {
  name: z.string().min(1).max(200),
  trigger: z.enum(TRIGGERS),
  condition: z
    .string()
    .max(2000)
    .nullable()
    .optional()
    .describe('A condition in the query language, such as type = Bug AND priority > Medium'),
  conditions: z.array(condition).max(MAX_LIST).nullable().optional(),
  actions: z.array(action).max(MAX_LIST),
  enabled: z.boolean().optional(),
};

registerActions([
  defineAction({
    name: 'automationRule.list',
    area: 'automation',
    kind: 'read',
    summary: 'List the automation rules of a project',
    target: projectTarget,
    input: projectTarget,
    output: z.array(record),
    rest: { method: 'GET', path: RULES },
    authorize: read,
    handler: async (_ctx, { projectId }) => automationService.listRules(projectId),
  }),
  defineAction({
    name: 'automationRule.create',
    place: inputPlace,
    area: 'automation',
    kind: 'write',
    summary:
      'Create an automation rule: a trigger, an optional condition, and actions that may use ' +
      '{{expression}} variables',
    target: projectTarget,
    input: projectTarget.extend(ruleFields),
    output: record,
    rest: { method: 'POST', path: RULES },
    authorize: settings,
    handler: async (_ctx, { projectId, ...data }) => automationService.createRule(projectId, data),
  }),
  defineAction({
    name: 'automationRule.update',
    place: inputPlace,
    area: 'automation',
    kind: 'write',
    summary: 'Change an automation rule: any of its name, trigger, conditions, actions or state',
    target: ruleTarget,
    input: ruleTarget.extend({
      name: ruleFields.name.optional(),
      trigger: ruleFields.trigger.optional(),
      condition: ruleFields.condition,
      conditions: ruleFields.conditions,
      actions: ruleFields.actions.optional(),
      enabled: ruleFields.enabled,
    }),
    output: record,
    rest: { method: 'PATCH', path: RULE },
    authorize: ownedRule,
    handler: async (_ctx, { projectId: _projectId, ruleId, ...data }) =>
      automationService.updateRule(ruleId, data),
  }),
  defineAction({
    name: 'automationRule.toggle',
    place: inputPlace,
    area: 'automation',
    kind: 'write',
    summary: 'Switch an automation rule on or off',
    target: ruleTarget,
    input: ruleTarget,
    output: record,
    rest: { method: 'POST', path: `${RULE}/toggle`, status: 200, emptyBody: true },
    authorize: ownedRule,
    handler: async (_ctx, { ruleId }) => automationService.toggleRule(ruleId),
  }),
  defineAction({
    name: 'automationRule.delete',
    place: inputPlace,
    destructive: true,
    area: 'automation',
    kind: 'write',
    summary: 'Delete an automation rule',
    target: ruleTarget,
    input: ruleTarget,
    output: nothing,
    preview: (_ctx, { projectId, ruleId }) => previews.automationRuleDelete(projectId, ruleId),
    rest: { method: 'DELETE', path: RULE },
    authorize: ownedRule,
    handler: async (_ctx, { ruleId }) => {
      await automationService.deleteRule(ruleId);
    },
  }),
]);
