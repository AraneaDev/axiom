import { Request, Response, NextFunction } from 'express';
import * as searchService from './search.service';
import { searchSchema } from '../../utils/validation';

export async function search(req: Request, res: Response, next: NextFunction) {
  try {
    const params = searchSchema.parse(req.query);
    const results = await searchService.search(params);
    res.json(results);
  } catch (err) {
    next(err);
  }
}
