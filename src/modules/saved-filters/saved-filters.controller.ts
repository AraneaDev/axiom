import { Request, Response, NextFunction } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { param } from '../../utils/params';

import * as savedFiltersService from './saved-filters.service';

/**
 * Create a saved filter.
 * @param req
 * @param res
 * @param next
 */
export async function createFilter(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, query, projectId } = req.body;
    if (!name || !query) {
      throw new AppError(400, 'name and query are required');
    }
    const filter = await savedFiltersService.create(req.userId!, { name, query, projectId });
    res.status(201).json(filter);
  } catch (err) {
    next(err);
  }
}

/**
 * List saved filters for the current user.
 * @param req
 * @param res
 * @param next
 */
export async function listFilters(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.query.projectId as string | undefined;
    const filters = await savedFiltersService.list(req.userId!, projectId);
    res.json(filters);
  } catch (err) {
    next(err);
  }
}

/**
 * Update a saved filter.
 * @param req
 * @param res
 * @param next
 */
export async function updateFilter(req: Request, res: Response, next: NextFunction) {
  try {
    const filterId = param(req, 'filterId');
    const filter = await savedFiltersService.update(req.userId!, filterId, req.body);
    res.json(filter);
  } catch (err) {
    next(err);
  }
}

/**
 * Delete a saved filter.
 * @param req
 * @param res
 * @param next
 */
export async function deleteFilter(req: Request, res: Response, next: NextFunction) {
  try {
    const filterId = param(req, 'filterId');
    await savedFiltersService.remove(req.userId!, filterId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
