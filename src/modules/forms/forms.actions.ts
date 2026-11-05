import { z } from 'zod';

import { ownedByProject, projectAction, projectRead } from '../../actions/authorize';
import type { ActionContext } from '../../actions/define';
import { defineAction } from '../../actions/define';
import * as previews from '../../actions/previews';
import { registerActions } from '../../actions/registry';
import { AppError } from '../../middleware/errorHandler';
import { projectOf } from '../../middleware/requireProjectAccess';

import { withoutSecret } from './form-secret';
import * as formsService from './forms.service';
import {
  createFieldSchema,
  createFormSchema,
  createPageSchema,
  reorderFieldsSchema,
  reorderPagesSchema,
  updateFieldSchema,
  updateFormSchema,
  updatePageSchema,
} from './forms.validation';

// Responses keep the shape the REST routes always had (R3)
const record = z.looseObject({ id: z.string() });
const list = z.array(z.looseObject({}));
const nothing = z.void();

const FORMS = '/api/projects/:projectId/forms';
const FORM = `${FORMS}/:formId`;
const PAGES = `${FORM}/pages`;
const PAGE = `${PAGES}/:pageId`;
const FIELDS = `${PAGE}/fields`;
const FIELD = `${FIELDS}/:fieldId`;

// Authorization runs on the ids alone (R10); every input extends its target (R11)
const projectTarget = z.object({ projectId: z.string() });
const formTarget = projectTarget.extend({ formId: z.string() });
const pageTarget = formTarget.extend({ pageId: z.string() });
const fieldTarget = pageTarget.extend({ fieldId: z.string() });

type ProjectInput = z.infer<typeof projectTarget>;
/** The ids a call names, as deep as its target goes */
type FormIds = ProjectInput & { formId: string; pageId?: string; fieldId?: string };

const read = projectRead<ProjectInput>((input) => input.projectId);
// Forms are project settings: team ADMINs, org OWNERs/ADMINs and platform admins only
const settings = projectAction<ProjectInput>('team:manage_members', (input) => input.projectId);

/**
 * A form, then its page, then its field, each of which must belong to the project, in the order
 * the old routes checked them. Writes need the settings role as well.
 * @param levels - How deep the input names records: a form, a page or a field
 * @param write - Whether the call changes the form
 */
function owned(levels: 'form' | 'page' | 'field', write: boolean) {
  const form = ownedByProject<FormIds>(
    projectOf.form,
    (input) => ({ projectId: input.projectId, recordId: input.formId }),
    write ? 'team:manage_members' : undefined,
  );
  return async (ctx: ActionContext, input: FormIds): Promise<void> => {
    await form(ctx, input);
    if (levels === 'form') return;
    await assertOwned(projectOf.formPage, input.pageId ?? '', input.projectId);
    if (levels === 'page') return;
    await assertOwned(projectOf.formField, input.fieldId ?? '', input.projectId);
  };
}

/**
 * Answer 404 unless the record belongs to the project (requireOwnedByProject).
 * @param resolver - Finds the projects the record belongs to
 * @param recordId - The record
 * @param projectId - The project in the path
 */
async function assertOwned(
  resolver: (id: string) => Promise<Array<string | null | undefined>>,
  recordId: string,
  projectId: string,
): Promise<void> {
  if (!(await resolver(recordId)).includes(projectId)) {
    throw new AppError(404, 'Not found in this project');
  }
}

// Static paths come before the param paths that would capture them: pages/reorder, fields/reorder
registerActions([
  defineAction({
    name: 'form.list',
    area: 'forms',
    kind: 'read',
    summary: 'List the forms of a project, with how many pages and submissions each holds',
    target: projectTarget,
    input: projectTarget,
    output: list,
    rest: { method: 'GET', path: FORMS },
    authorize: read,
    handler: async (_ctx, { projectId }) =>
      (await formsService.listForms(projectId)).map(withoutSecret),
  }),
  defineAction({
    name: 'form.create',
    area: 'forms',
    kind: 'write',
    summary:
      'Create a form for a project. A gated form returns its access code once, in sharedSecret',
    target: projectTarget,
    input: projectTarget.extend(createFormSchema.shape),
    output: record,
    rest: { method: 'POST', path: FORMS },
    authorize: settings,
    handler: async (ctx, { projectId, ...data }) =>
      formsService.createForm(projectId, ctx.userId, data),
  }),
  defineAction({
    name: 'form.get',
    area: 'forms',
    kind: 'read',
    summary: 'Read a form with its pages and fields',
    target: formTarget,
    input: formTarget,
    output: record,
    rest: { method: 'GET', path: FORM },
    authorize: owned('form', false),
    handler: async (_ctx, { projectId, formId }) =>
      withoutSecret(await formsService.getForm(formId, projectId)),
  }),
  defineAction({
    name: 'form.update',
    area: 'forms',
    kind: 'write',
    summary: 'Change a form. regenerateSecret returns a new access code of a gated form, once',
    target: formTarget,
    input: formTarget.extend(updateFormSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: FORM },
    authorize: owned('form', true),
    handler: async (_ctx, { projectId, formId, ...data }) =>
      formsService.updateForm(formId, projectId, data),
  }),
  defineAction({
    name: 'form.delete',
    destructive: true,
    area: 'forms',
    kind: 'write',
    summary: 'Delete a form with its pages, fields and submissions',
    target: formTarget,
    input: formTarget,
    output: nothing,
    preview: (_ctx, { projectId, formId }) => previews.formDelete(projectId, formId),
    rest: { method: 'DELETE', path: FORM },
    authorize: owned('form', true),
    handler: async (_ctx, { projectId, formId }) => formsService.deleteForm(formId, projectId),
  }),
  defineAction({
    name: 'form.publish',
    area: 'forms',
    kind: 'write',
    summary: 'Publish a form so that its public link accepts submissions',
    target: formTarget,
    input: formTarget,
    output: record,
    rest: { method: 'PATCH', path: `${FORM}/publish`, emptyBody: true },
    authorize: owned('form', true),
    handler: async (_ctx, { projectId, formId }) =>
      withoutSecret(await formsService.publishForm(formId, projectId)),
  }),
  defineAction({
    name: 'formPage.create',
    area: 'forms',
    kind: 'write',
    summary: 'Add a page to a form',
    target: formTarget,
    input: formTarget.extend(createPageSchema.shape),
    output: record,
    rest: { method: 'POST', path: PAGES },
    authorize: owned('form', true),
    handler: async (_ctx, { projectId: _projectId, formId, ...data }) =>
      formsService.createPage(formId, data),
  }),
  defineAction({
    name: 'formPage.reorder',
    area: 'forms',
    kind: 'write',
    summary: 'Set the order of the pages of a form',
    target: formTarget,
    input: formTarget.extend(reorderPagesSchema.shape),
    output: list,
    rest: { method: 'POST', path: `${PAGES}/reorder`, status: 200 },
    authorize: owned('form', true),
    handler: async (_ctx, { formId, pageIds }) => formsService.reorderPages(formId, pageIds),
  }),
  defineAction({
    name: 'formPage.update',
    area: 'forms',
    kind: 'write',
    summary: 'Change a page of a form',
    target: pageTarget,
    input: pageTarget.extend(updatePageSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: PAGE },
    authorize: owned('page', true),
    handler: async (_ctx, { projectId: _projectId, formId: _formId, pageId, ...data }) =>
      formsService.updatePage(pageId, data),
  }),
  defineAction({
    name: 'formPage.delete',
    destructive: true,
    area: 'forms',
    kind: 'write',
    summary: 'Delete a page of a form with its fields',
    target: pageTarget,
    input: pageTarget,
    output: nothing,
    preview: (_ctx, { projectId, pageId }) => previews.formPageDelete(projectId, pageId),
    rest: { method: 'DELETE', path: PAGE },
    authorize: owned('page', true),
    handler: async (_ctx, { pageId }) => formsService.deletePage(pageId),
  }),
  defineAction({
    name: 'formField.reorder',
    area: 'forms',
    kind: 'write',
    summary: 'Set the order of the fields of a form',
    target: formTarget,
    input: formTarget.extend(reorderFieldsSchema.shape),
    output: list,
    rest: { method: 'POST', path: `${FORM}/fields/reorder`, status: 200 },
    authorize: owned('form', true),
    handler: async (_ctx, { formId, fieldIds }) => formsService.reorderFields(formId, fieldIds),
  }),
  defineAction({
    name: 'formField.create',
    area: 'forms',
    kind: 'write',
    summary: 'Add a field to a page of a form',
    target: pageTarget,
    input: pageTarget.extend(createFieldSchema.shape),
    output: record,
    rest: { method: 'POST', path: FIELDS },
    authorize: owned('page', true),
    handler: async (_ctx, { projectId: _projectId, formId: _formId, pageId, ...data }) =>
      formsService.createField(pageId, data),
  }),
  defineAction({
    name: 'formField.update',
    area: 'forms',
    kind: 'write',
    summary: 'Change a field of a form',
    target: fieldTarget,
    input: fieldTarget.extend(updateFieldSchema.shape),
    output: record,
    rest: { method: 'PATCH', path: FIELD },
    authorize: owned('field', true),
    handler: async (
      _ctx,
      { projectId: _projectId, formId: _formId, pageId: _pageId, fieldId, ...data },
    ) => formsService.updateField(fieldId, data),
  }),
  defineAction({
    name: 'formField.delete',
    destructive: true,
    area: 'forms',
    kind: 'write',
    summary: 'Delete a field of a form',
    target: fieldTarget,
    input: fieldTarget,
    output: nothing,
    preview: (_ctx, { projectId, fieldId }) => previews.formFieldDelete(projectId, fieldId),
    rest: { method: 'DELETE', path: FIELD },
    authorize: owned('field', true),
    handler: async (_ctx, { fieldId }) => formsService.deleteField(fieldId),
  }),
]);
