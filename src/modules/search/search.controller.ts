import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { validate, searchSchema, savedSearchSchema } from '../../utils/validation';

import * as searchService from './search.service';

export const search = asyncHandler(async (req: Request, res: Response) => {
  const params = validate(searchSchema, req.query);
  const orgIds = await searchService.getUserOrgIds(req.userId!);
  const results = await searchService.search({ ...params, userId: req.userId!, orgIds });
  res.json(results);
});

export const getAccessibleSpaces = asyncHandler(async (req: Request, res: Response) => {
  const orgIds = await searchService.getUserOrgIds(req.userId!);
  const spaces = await searchService.getAccessibleSpaces(orgIds);
  res.json(spaces);
});

export const getSavedSearches = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  const searches = await searchService.getSavedSearches(userId);
  res.json(searches);
});

export const createSavedSearch = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  const data = validate(savedSearchSchema, req.body);
  const saved = await searchService.createSavedSearch(userId, data);
  res.status(201).json(saved);
});

export const deleteSavedSearch = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.userId!;
  const { id } = req.params;
  await searchService.deleteSavedSearch(id as string, userId);
  res.status(204).send();
});
