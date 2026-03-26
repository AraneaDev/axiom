import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createPageTemplateSchema } from '../../utils/validation';

import * as svc from './wiki-templates.service';

export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createPageTemplateSchema, req.body);
  const template = await svc.createTemplate(param(req, 'spaceId'), data);
  res.status(201).json(template);
});

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const templates = await svc.listTemplates(param(req, 'spaceId'));
  res.json(templates);
});

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const template = await svc.getTemplate(param(req, 'templateId'));
  res.json(template);
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  await svc.deleteTemplate(param(req, 'templateId'));
  res.status(204).send();
});
