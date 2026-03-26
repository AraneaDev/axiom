import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import {
  validate,
  createIssueTemplateSchema,
  updateIssueTemplateSchema,
} from '../../utils/validation';

import * as templatesService from './issue-templates.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createIssueTemplateSchema, req.body);
  const template = await templatesService.createTemplate(param(req, 'projectId'), data);
  res.status(201).json(template);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const templates = await templatesService.listTemplates(param(req, 'projectId'));
  res.json(templates);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const template = await templatesService.getTemplate(
    param(req, 'projectId'),
    param(req, 'templateId'),
  );
  res.json(template);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateIssueTemplateSchema, req.body);
  const template = await templatesService.updateTemplate(
    param(req, 'projectId'),
    param(req, 'templateId'),
    data,
  );
  res.json(template);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await templatesService.deleteTemplate(param(req, 'projectId'), param(req, 'templateId'));
  res.status(204).send();
});
