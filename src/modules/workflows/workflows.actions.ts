import { z } from 'zod';

import { ownedByProject, projectAction, projectRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { projectOf } from '../../middleware/requireProjectAccess';

import * as workflowService from './workflows.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const nothing = z.void();

const RULES = '/api/projects/:projectId/workflow-rules';
const RULE = `${RULES}/:ruleId`;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const ruleTarget = projectTarget.extend({ ruleId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;
type RuleInput = z.infer<typeof ruleTarget>;

const read = projectRead<ProjectInput>((input) => input.projectId);
// Workflow rules are project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
const settings = projectAction<ProjectInput>('team:manage_members', (input) => input.projectId);
const ownedRule = ownedByProject<RuleInput>(
  projectOf.workflowRule,
  (input) => ({ projectId: input.projectId, recordId: input.ruleId }),
  'team:manage_members',
);

const column = z.string().min(1);

registerActions([
  defineAction({
    name: 'workflowRule.list',
    area: 'issues',
    kind: 'read',
    summary: 'List the workflow rules of a project: which column an issue may move to from which',
    target: projectTarget,
    input: projectTarget,
    output: z.array(record),
    rest: { method: 'GET', path: RULES },
    authorize: read,
    handler: async (_ctx, { projectId }) => workflowService.listRules(projectId),
  }),
  defineAction({
    name: 'workflowRule.create',
    // A rule decides which moves a column allows, which is a human check (ruling B3)
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Allow issues to move from one column of a project to another',
    target: projectTarget,
    input: projectTarget.extend({ fromColumnId: column, toColumnId: column }),
    output: record,
    preview: (_ctx, { projectId, fromColumnId, toColumnId }) =>
      previews.workflowRuleCreate(projectId, fromColumnId, toColumnId),
    rest: { method: 'POST', path: RULES },
    authorize: settings,
    handler: async (_ctx, { projectId, fromColumnId, toColumnId }) =>
      workflowService.createRule(projectId, { fromColumnId, toColumnId }),
  }),
  defineAction({
    name: 'workflowRule.update',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Change the columns a workflow rule connects',
    target: ruleTarget,
    input: ruleTarget.extend({ fromColumnId: column.optional(), toColumnId: column.optional() }),
    output: record,
    preview: (_ctx, { projectId, ruleId, fromColumnId, toColumnId }) =>
      previews.workflowRuleUpdate(projectId, ruleId, { fromColumnId, toColumnId }),
    rest: { method: 'PATCH', path: RULE },
    authorize: ownedRule,
    handler: async (_ctx, { projectId, ruleId, ...data }) =>
      workflowService.updateRule(ruleId, projectId, data),
  }),
  defineAction({
    name: 'workflowRule.delete',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Delete a workflow rule',
    target: ruleTarget,
    input: ruleTarget,
    output: nothing,
    preview: (_ctx, { projectId, ruleId }) => previews.workflowRuleDelete(projectId, ruleId),
    rest: { method: 'DELETE', path: RULE },
    authorize: ownedRule,
    handler: async (_ctx, { ruleId }) => {
      await workflowService.deleteRule(ruleId);
    },
  }),
]);
