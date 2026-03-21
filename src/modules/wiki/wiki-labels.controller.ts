import { Request, Response, NextFunction } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { param } from '../../utils/params';
import { validate, addPageLabelSchema } from '../../utils/validation';

import * as svc from './wiki-labels.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function listPageLabels(req: Request, res: Response, next: NextFunction) {
  try {
    const labels = await svc.listPageLabels(param(req, 'pageId'));
    res.json(labels);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function addPageLabel(req: Request, res: Response, next: NextFunction) {
  try {
    const data = validate(addPageLabelSchema, req.body);
    const label = await svc.addLabel(param(req, 'pageId'), data.label);
    res.status(201).json(label);
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function removePageLabel(req: Request, res: Response, next: NextFunction) {
  try {
    const label = decodeURIComponent(param(req, 'label'));
    await svc.removeLabel(param(req, 'pageId'), label);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function searchByLabel(req: Request, res: Response, next: NextFunction) {
  try {
    const label = req.query.label as string;
    if (!label) {
      throw new AppError(400, 'label query parameter required');
    }
    const pages = await svc.searchPagesByLabel(param(req, 'spaceId'), label);
    res.json(pages);
  } catch (err) {
    next(err);
  }
}
