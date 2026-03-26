import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as savedFiltersService from './saved-filters.service';

export const createFilter = asyncHandler(async (req: Request, res: Response) => {
  const { name, query, projectId } = req.body;
  if (!name || !query) {
    throw new AppError(400, 'name and query are required');
  }
  const filter = await savedFiltersService.create(req.userId!, { name, query, projectId });
  res.status(201).json(filter);
});

export const listFilters = asyncHandler(async (req: Request, res: Response) => {
  const projectId = req.query.projectId as string | undefined;
  const filters = await savedFiltersService.list(req.userId!, projectId);
  res.json(filters);
});

export const updateFilter = asyncHandler(async (req: Request, res: Response) => {
  const filterId = param(req, 'filterId');
  const filter = await savedFiltersService.update(req.userId!, filterId, req.body);
  res.json(filter);
});

export const deleteFilter = asyncHandler(async (req: Request, res: Response) => {
  const filterId = param(req, 'filterId');
  await savedFiltersService.remove(req.userId!, filterId);
  res.status(204).send();
});
