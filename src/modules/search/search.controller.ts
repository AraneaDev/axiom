import { Request, Response, NextFunction } from 'express';

import { searchSchema, codeSearchSchema, savedSearchSchema } from '../../utils/validation';

import * as searchService from './search.service';

/**
 * @param req
 * @param res
 * @param next
 */
export async function search(req: Request, res: Response, next: NextFunction) {
  try {
    const params = searchSchema.parse(req.query);
    const orgIds = await searchService.getUserOrgIds(req.userId!);
    const results = await searchService.search({ ...params, userId: req.userId!, orgIds });
    res.json(results);
  } catch (err) {
    next(err);
  }
}

/**
 * @param req
 * @param res
 * @param next
 */
export async function searchCodeEndpoint(req: Request, res: Response, next: NextFunction) {
  try {
    const params = codeSearchSchema.parse(req.query);
    const results = await searchService.searchCode({ ...params, userId: req.userId! });
    res.json(results);
  } catch (err) {
    next(err);
  }
}

/**
 * @param req
 * @param res
 * @param next
 */
export async function getSavedSearches(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const searches = await searchService.getSavedSearches(userId);
    res.json(searches);
  } catch (err) {
    next(err);
  }
}

/**
 * @param req
 * @param res
 * @param next
 */
export async function createSavedSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const data = savedSearchSchema.parse(req.body);
    const saved = await searchService.createSavedSearch(userId, data);
    res.status(201).json(saved);
  } catch (err) {
    next(err);
  }
}

/**
 * @param req
 * @param res
 * @param next
 */
export async function deleteSavedSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    await searchService.deleteSavedSearch(id as string, userId);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
