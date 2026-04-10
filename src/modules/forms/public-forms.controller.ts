import type { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation';

import * as formsService from './forms.service';
import { submitFormSchema, verifyFormSchema } from './forms.validation';

export const getPublicForm = asyncHandler(async (req: Request, res: Response) => {
  const form = await formsService.getPublicForm(param(req, 'formSlug'));
  // Strip sensitive fields
  const { sharedSecret: _secret, ...publicForm } = form as typeof form & { sharedSecret?: string };
  res.json({ ...publicForm, authMode: form.authMode });
});

export const submitForm = asyncHandler(async (req: Request, res: Response) => {
  const { data, submitterEmail, submitterName, honeypot } = validate(submitFormSchema, req.body);
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const submission = await formsService.submitForm(
    param(req, 'formSlug'),
    data as Record<string, unknown>,
    submitterEmail,
    submitterName,
    ip,
    honeypot,
  );
  res.status(201).json({ id: submission.id, status: submission.status });
});

export const verifyAccess = asyncHandler(async (req: Request, res: Response) => {
  const { secret } = validate(verifyFormSchema, req.body);
  const result = await formsService.verifyFormAccess(param(req, 'formSlug'), secret);
  res.json(result);
});
