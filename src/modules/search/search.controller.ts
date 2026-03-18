import { Request, Response, NextFunction } from 'express';

import { searchSchema } from '../../utils/validation';

import * as searchService from './search.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function search(req: Request, res: Response, next: NextFunction) {
  try {
    const params = searchSchema.parse(req.query);
    const results = await searchService.search(params);
    res.json(results);
  } catch (err) {
    next(err);
  }
}
