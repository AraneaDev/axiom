import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation';

import { clientKey } from './client-ip';
import { withoutSecret } from './form-secret';
import * as formsService from './forms.service';
import {
  createFormSchema,
  updateFormSchema,
  createPageSchema,
  updatePageSchema,
  reorderPagesSchema,
  createFieldSchema,
  updateFieldSchema,
  reorderFieldsSchema,
  submitFormSchema,
  verifyFormSchema,
} from './forms.validation';

// ─── Form CRUD ──────────────────────────────────────────────

export const list = asyncHandler(async (req: Request, res: Response) => {
  const forms = await formsService.listForms(param(req, 'projectId'));
  res.json(forms.map(withoutSecret));
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const form = await formsService.getForm(param(req, 'formId'), param(req, 'projectId'));
  res.json(withoutSecret(form));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createFormSchema, req.body);
  const form = await formsService.createForm(param(req, 'projectId'), req.userId!, data);
  res.status(201).json(form);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateFormSchema, req.body);
  const form = await formsService.updateForm(param(req, 'formId'), param(req, 'projectId'), data);
  res.json(form);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await formsService.deleteForm(param(req, 'formId'), param(req, 'projectId'));
  res.status(204).send();
});

export const publish = asyncHandler(async (req: Request, res: Response) => {
  const form = await formsService.publishForm(param(req, 'formId'), param(req, 'projectId'));
  res.json(withoutSecret(form));
});

// ─── Page CRUD ──────────────────────────────────────────────

export const createPage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createPageSchema, req.body);
  const page = await formsService.createPage(param(req, 'formId'), data);
  res.status(201).json(page);
});

export const updatePage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updatePageSchema, req.body);
  const page = await formsService.updatePage(param(req, 'pageId'), data);
  res.json(page);
});

export const removePage = asyncHandler(async (req: Request, res: Response) => {
  await formsService.deletePage(param(req, 'pageId'));
  res.status(204).send();
});

export const reorderPages = asyncHandler(async (req: Request, res: Response) => {
  const { pageIds } = validate(reorderPagesSchema, req.body);
  const pages = await formsService.reorderPages(param(req, 'formId'), pageIds);
  res.json(pages);
});

// ─── Field CRUD ─────────────────────────────────────────────

export const createField = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createFieldSchema, req.body);
  const field = await formsService.createField(param(req, 'pageId'), data);
  res.status(201).json(field);
});

export const updateField = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateFieldSchema, req.body);
  const field = await formsService.updateField(param(req, 'fieldId'), data);
  res.json(field);
});

export const removeField = asyncHandler(async (req: Request, res: Response) => {
  await formsService.deleteField(param(req, 'fieldId'));
  res.status(204).send();
});

export const reorderFields = asyncHandler(async (req: Request, res: Response) => {
  const { fieldIds } = validate(reorderFieldsSchema, req.body);
  const fields = await formsService.reorderFields(param(req, 'formId'), fieldIds);
  res.json(fields);
});

// ─── Public ──────────────────────────────────────────────────

export const getPublic = asyncHandler(async (req: Request, res: Response) => {
  const form = await formsService.getPublicForm(param(req, 'slug'));
  res.json(form);
});

export const submit = asyncHandler(async (req: Request, res: Response) => {
  const {
    data,
    submitterEmail,
    submitterName,
    captchaToken: _captchaToken,
    honeypot,
  } = validate(submitFormSchema, req.body);
  const submitterIp = (req.headers['x-forwarded-for'] as string) || req.ip || '';
  const submission = await formsService.submitForm(
    param(req, 'slug'),
    data,
    submitterEmail,
    submitterName,
    submitterIp,
    honeypot,
  );
  res.status(201).json(submission);
});

export const verifyAccess = asyncHandler(async (req: Request, res: Response) => {
  const { secret } = validate(verifyFormSchema, req.body);
  const result = await formsService.verifyFormAccess(
    param(req, 'slug'),
    secret,
    clientKey(req.ip || req.socket.remoteAddress || 'unknown'),
  );
  res.json(result);
});
