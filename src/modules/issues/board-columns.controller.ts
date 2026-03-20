import { Request, Response, NextFunction } from 'express';

import { param } from '../../utils/params';

import * as svc from './board-columns.service';

/**
 * Handle POST to create a board column.
 * @param req
 * @param res
 * @param next
 */
export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, position, isDone } = req.body;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: { message: 'name is required' } });
      return;
    }
    const column = await svc.createColumn(param(req, 'projectId'), { name, position, isDone });
    res.status(201).json(column);
  } catch (err) {
    next(err);
  }
}

/**
 * Handle PATCH to update a board column.
 * @param req
 * @param res
 * @param next
 */
export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, isDone } = req.body;
    const column = await svc.updateColumn(param(req, 'projectId'), param(req, 'columnId'), {
      name,
      isDone,
    });
    res.json(column);
  } catch (err) {
    next(err);
  }
}

/**
 * Handle DELETE to remove a board column.
 * @param req
 * @param res
 * @param next
 */
export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await svc.deleteColumn(param(req, 'projectId'), param(req, 'columnId'));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * Handle PATCH to reorder board columns.
 * @param req
 * @param res
 * @param next
 */
export async function reorder(req: Request, res: Response, next: NextFunction) {
  try {
    const { positions } = req.body;
    if (!Array.isArray(positions)) {
      res.status(400).json({ error: { message: 'positions array is required' } });
      return;
    }
    const columns = await svc.reorderColumns(param(req, 'projectId'), positions);
    res.json(columns);
  } catch (err) {
    next(err);
  }
}
