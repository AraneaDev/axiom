import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createLabelSchema, updateLabelSchema } from '../../utils/validation';

import * as labelsService from './labels.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(createLabelSchema, req.body);
  const label = await labelsService.createLabel(param(req, 'projectId'), body);
  res.status(201).json(label);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const labels = await labelsService.listLabels(
    param(req, 'projectId'),
    req.query as Record<string, string>,
  );
  res.json(labels);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const body = validate(updateLabelSchema, req.body);
  const label = await labelsService.updateLabel(
    param(req, 'projectId'),
    decodeURIComponent(param(req, 'labelName')),
    body,
  );
  res.json(label);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await labelsService.deleteLabel(
    param(req, 'projectId'),
    decodeURIComponent(param(req, 'labelName')),
  );
  res.status(204).send();
});
