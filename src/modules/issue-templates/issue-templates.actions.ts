import { z } from 'zod';

import { projectAction, projectRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { createIssueTemplateSchema, updateIssueTemplateSchema } from '../../utils/validation';

import * as templatesService from './issue-templates.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const list = z.array(z.looseObject({}));
const nothing = z.void();

const TEMPLATES = '/api/projects/:projectId/issue-templates';
const TEMPLATE = `${TEMPLATES}/:templateId`;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const templateTarget = projectTarget.extend({ templateId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;

const read = projectRead<ProjectInput>((input) => input.projectId);
// Project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
const write = projectAction<ProjectInput>('team:manage_members', (input) => input.projectId);

registerActions([
  defineAction({
    name: 'issueTemplate.create',
    area: 'issues',
    kind: 'write',
    summary: 'Create an issue template in a project',
    target: projectTarget,
    input: projectTarget.extend(createIssueTemplateSchema.shape),
    output: record,
    rest: { method: 'POST', path: TEMPLATES },
    authorize: write,
    handler: async (_ctx, { projectId, ...data }) =>
      templatesService.createTemplate(projectId, data),
  }),
  defineAction({
    name: 'issueTemplate.list',
    area: 'issues',
    kind: 'read',
    summary: 'List the issue templates of a project',
    target: projectTarget,
    input: projectTarget,
    output: list,
    rest: { method: 'GET', path: TEMPLATES },
    authorize: read,
    handler: async (_ctx, { projectId }) => templatesService.listTemplates(projectId),
  }),
  defineAction({
    name: 'issueTemplate.get',
    area: 'issues',
    kind: 'read',
    summary: 'Read one issue template',
    target: templateTarget,
    input: templateTarget,
    output: record,
    rest: { method: 'GET', path: TEMPLATE },
    authorize: read,
    handler: async (_ctx, { projectId, templateId }) =>
      templatesService.getTemplate(projectId, templateId),
  }),
  defineAction({
    name: 'issueTemplate.update',
    area: 'issues',
    kind: 'write',
    summary: 'Change an issue template',
    target: templateTarget,
    input: templateTarget.extend(updateIssueTemplateSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: TEMPLATE },
    authorize: write,
    handler: async (_ctx, { projectId, templateId, ...data }) =>
      templatesService.updateTemplate(projectId, templateId, data),
  }),
  defineAction({
    name: 'issueTemplate.delete',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Delete an issue template',
    target: templateTarget,
    input: templateTarget,
    output: nothing,
    preview: (_ctx, { projectId, templateId }) =>
      previews.issueTemplateDelete(projectId, templateId),
    rest: { method: 'DELETE', path: TEMPLATE },
    authorize: write,
    handler: async (_ctx, { projectId, templateId }) =>
      templatesService.deleteTemplate(projectId, templateId),
  }),
]);
