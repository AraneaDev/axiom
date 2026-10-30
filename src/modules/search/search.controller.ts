import { Request, Response } from 'express';

import { scopesCover } from '../../middleware/token-scopes';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate, searchSchema, savedSearchSchema } from '../../utils/validation';

import * as searchService from './search.service';

export const search = asyncHandler(async (req: Request, res: Response) => {
  const params = validate(searchSchema, req.query);
  const results = await searchService.search({ ...params, userId: req.userId! });
  // An API token only searches the areas its scopes cover
  const scopes = req.tokenScopes;
  res.json(
    scopes
      ? results.filter((section) =>
          section.type === 'issues'
            ? scopesCover(scopes, 'issues', false)
            : scopesCover(scopes, 'wiki', false),
        )
      : results,
  );
});

export const getAccessibleSpaces = asyncHandler(async (req: Request, res: Response) => {
  const spaces = await searchService.getAccessibleSpaces(req.userId!);
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
