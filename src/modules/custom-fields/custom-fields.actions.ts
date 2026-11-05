import { z } from 'zod';

import { projectAction, projectRead, recordInProject } from '../../actions/authorize';
import { defineAction } from '../../actions/define';
import { orgsOfCustomField } from '../../actions/org-lookups';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { projectOf } from '../../middleware/requireProjectAccess';
import { ERR } from '../../utils/error-messages';
import { listPosition } from '../../utils/validation';

import * as customFieldsService from './custom-fields.service';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const list = z.array(z.looseObject({}));
const nothing = z.void();

const PROJECT_FIELDS = '/api/projects/:projectId/custom-fields';
const FIELD = '/api/custom-fields/:fieldId';
const ISSUE_FIELDS = '/api/issues/:issueId/custom-fields';
const NO_FIELD = 'Custom field not found';

// What the route took as it was: the options of a select field, a list or an object
const options = z.union([z.array(z.unknown()), z.looseObject({})]).nullable();
const fieldFields = {
  name: z.string().min(1),
  options: options.optional(),
  required: z.boolean().optional(),
  position: listPosition.optional(),
};

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const fieldTarget = z.object({ fieldId: z.string() });
const issueTarget = z.object({ issueId: z.string() });
const valueTarget = issueTarget.extend(fieldTarget.shape);

type ProjectInput = z.infer<typeof projectTarget>;
type FieldInput = z.infer<typeof fieldTarget>;
type IssueInput = z.infer<typeof issueTarget>;

const readProject = projectRead<ProjectInput>((input) => input.projectId);
// Project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
const settingsOfProject = projectAction<ProjectInput>(
  'team:manage_members',
  (input) => input.projectId,
);
// Changing a field definition is project configuration, whatever way it is addressed
const settingsOfField = recordInProject<FieldInput>(
  customFieldsService.fieldProjectId,
  NO_FIELD,
  (input) => input.fieldId,
  ['issue:edit', 'team:manage_members'],
);
const issueProject = async (id: string) => (await projectOf.issue(id))[0];
const readIssue = recordInProject<IssueInput>(
  issueProject,
  ERR.ISSUE_NOT_FOUND,
  (input) => input.issueId,
);
const writeIssue = recordInProject<IssueInput>(
  issueProject,
  ERR.ISSUE_NOT_FOUND,
  (input) => input.issueId,
  ['issue:edit'],
);
const writeFieldValue = recordInProject<FieldInput>(
  customFieldsService.fieldProjectId,
  NO_FIELD,
  (input) => input.fieldId,
  ['issue:edit'],
);

registerActions([
  defineAction({
    name: 'customField.create',
    area: 'issues',
    kind: 'write',
    summary: 'Define a custom field of a project: TEXT, NUMBER, DATE, SELECT, MULTI_SELECT or USER',
    target: projectTarget,
    input: projectTarget.extend({ ...fieldFields, type: z.string().min(1) }),
    output: record,
    rest: { method: 'POST', path: PROJECT_FIELDS },
    authorize: settingsOfProject,
    handler: async (_ctx, { projectId, ...data }) =>
      customFieldsService.createFieldDefinition(projectId, data),
  }),
  defineAction({
    name: 'customField.list',
    area: 'issues',
    kind: 'read',
    summary: 'List the custom field definitions of a project',
    target: projectTarget,
    input: projectTarget,
    output: list,
    rest: { method: 'GET', path: PROJECT_FIELDS },
    authorize: readProject,
    handler: async (_ctx, { projectId }) => customFieldsService.listFieldDefinitions(projectId),
  }),
  defineAction({
    name: 'customField.update',
    area: 'issues',
    kind: 'write',
    summary: 'Change the name, options, required flag or position of a custom field',
    target: fieldTarget,
    input: fieldTarget.extend({
      name: fieldFields.name.optional(),
      options: fieldFields.options,
      required: fieldFields.required,
      position: fieldFields.position,
    }),
    output: record,
    orgIds: (_ctx, { fieldId }) => orgsOfCustomField(fieldId),
    rest: { method: 'PATCH', path: FIELD },
    authorize: settingsOfField,
    handler: async (_ctx, { fieldId, ...data }) =>
      customFieldsService.updateFieldDefinition(fieldId, data),
  }),
  defineAction({
    name: 'customField.delete',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'Delete a custom field with the values stored in it',
    target: fieldTarget,
    input: fieldTarget,
    output: nothing,
    orgIds: (_ctx, { fieldId }) => orgsOfCustomField(fieldId),
    preview: (_ctx, { fieldId }) => previews.customFieldDelete(fieldId),
    rest: { method: 'DELETE', path: FIELD },
    authorize: settingsOfField,
    handler: async (_ctx, { fieldId }) => {
      await customFieldsService.deleteFieldDefinition(fieldId);
    },
  }),
  defineAction({
    name: 'customFieldValue.list',
    area: 'issues',
    kind: 'read',
    summary: 'List the custom field values of an issue',
    target: issueTarget,
    input: issueTarget,
    output: list,
    rest: { method: 'GET', path: ISSUE_FIELDS },
    authorize: readIssue,
    handler: async (_ctx, { issueId }) => customFieldsService.getFieldValues(issueId),
  }),
  defineAction({
    name: 'customFieldValue.set',
    area: 'issues',
    kind: 'write',
    summary: 'Set the value of a custom field on an issue',
    target: valueTarget,
    input: valueTarget.extend({ value: z.union([z.string(), z.number(), z.boolean()]) }),
    output: record,
    rest: { method: 'PUT', path: `${ISSUE_FIELDS}/:fieldId` },
    authorize: async (ctx, input) => {
      await writeIssue(ctx, input);
      await writeFieldValue(ctx, input);
    },
    handler: async (_ctx, { issueId, fieldId, value }) =>
      customFieldsService.setFieldValue(issueId, fieldId, String(value)),
  }),
]);
