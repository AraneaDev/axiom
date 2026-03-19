import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';
import { validate, createLabelSchema, updateLabelSchema } from '../../utils/validation';

import * as labelsService from './labels.service';

/**
 *
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(createLabelSchema, req.body);
    const label = await labelsService.createLabel(param(req, 'projectId'), body);
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
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const labels = await labelsService.listLabels(
      param(req, 'projectId'),
      req.query as Record<string, string>,
    );
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
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const body = validate(updateLabelSchema, req.body);
    const label = await labelsService.updateLabel(
      param(req, 'projectId'),
      decodeURIComponent(param(req, 'labelName')),
      body,
    );
    res.json(label);
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
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await labelsService.deleteLabel(
      param(req, 'projectId'),
      decodeURIComponent(param(req, 'labelName')),
    );
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}
