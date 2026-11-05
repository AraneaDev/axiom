import { z } from 'zod';

import { projectAction, projectRead } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import {
  createLabelSchema,
  firstQueryText,
  queryCount,
  updateLabelSchema,
} from '../../utils/validation';

import * as labelsService from './labels.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const loose = z.looseObject({});
const nothing = z.void();

const LABELS = '/api/projects/:projectId/labels';
const LABEL = `${LABELS}/:labelName`;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const labelTarget = projectTarget.extend({ labelName: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;

const read = projectRead<ProjectInput>((input) => input.projectId);
// Labels follow the permission matrix: VIEWERs and GUESTs can read, not change
const write = projectAction<ProjectInput>('issue:edit', (input) => input.projectId);

registerActions([
  defineAction({
    name: 'label.create',
    area: 'issues',
    kind: 'write',
    summary: 'Create a label in a project',
    target: projectTarget,
    input: projectTarget.extend(createLabelSchema.shape),
    output: record,
    rest: { method: 'POST', path: LABELS },
    authorize: write,
    handler: async (_ctx, { projectId, ...data }) => labelsService.createLabel(projectId, data),
  }),
  defineAction({
    name: 'label.list',
    area: 'issues',
    kind: 'read',
    summary: 'List the labels of a project, with limit (1 to 100) and offset',
    target: projectTarget,
    input: projectTarget.extend({ limit: queryCount, offset: queryCount }),
    output: z.looseObject({ data: z.array(loose) }),
    rest: { method: 'GET', path: LABELS },
    authorize: read,
    handler: async (_ctx, { projectId, limit, offset }) =>
      labelsService.listLabels(projectId, {
        limit: firstQueryText(limit),
        offset: firstQueryText(offset),
      }),
  }),
  defineAction({
    name: 'label.update',
    area: 'issues',
    kind: 'write',
    summary: 'Change the name, color or description of a label',
    target: labelTarget,
    input: labelTarget.extend(updateLabelSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: LABEL },
    authorize: write,
    handler: async (_ctx, { projectId, labelName, ...data }) =>
      labelsService.updateLabel(projectId, labelName, data),
  }),
  defineAction({
    name: 'label.delete',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Delete a label from a project',
    target: labelTarget,
    input: labelTarget,
    output: nothing,
    preview: (_ctx, { projectId, labelName }) => previews.labelDelete(projectId, labelName),
    rest: { method: 'DELETE', path: LABEL },
    authorize: write,
    handler: async (_ctx, { projectId, labelName }) =>
      labelsService.deleteLabel(projectId, labelName),
  }),
]);
