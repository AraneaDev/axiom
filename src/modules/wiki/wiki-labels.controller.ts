import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, addPageLabelSchema } from '../../utils/validation';

import * as svc from './wiki-labels.service';

export const listPageLabels = asyncHandler(async (req: Request, res: Response) => {
  const labels = await svc.listPageLabels(param(req, 'pageId'));
  res.json(labels);
});

export const addPageLabel = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(addPageLabelSchema, req.body);
  const label = await svc.addLabel(param(req, 'pageId'), data.label);
  res.status(201).json(label);
});

export const removePageLabel = asyncHandler(async (req: Request, res: Response) => {
  const label = decodeURIComponent(param(req, 'label'));
  await svc.removeLabel(param(req, 'pageId'), label);
  res.status(204).send();
});

export const searchByLabel = asyncHandler(async (req: Request, res: Response) => {
  const label = req.query.label as string;
  if (!label) {
    throw new AppError(400, 'label query parameter required');
  }
  const pages = await svc.searchPagesByLabel(param(req, 'spaceId'), label, req.userId!);
  res.json(pages);
});
