import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as svc from './board-columns.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const { name, position, isDone } = req.body;
  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: { message: 'name is required' } });
    return;
  }
  const column = await svc.createColumn(param(req, 'projectId'), { name, position, isDone });
  res.status(201).json(column);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const { name, isDone } = req.body;
  const column = await svc.updateColumn(param(req, 'projectId'), param(req, 'columnId'), {
    name,
    isDone,
  });
  res.json(column);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await svc.deleteColumn(param(req, 'projectId'), param(req, 'columnId'));
  res.status(204).send();
});

export const reorder = asyncHandler(async (req: Request, res: Response) => {
  const { positions } = req.body;
  if (!Array.isArray(positions)) {
    res.status(400).json({ error: { message: 'positions array is required' } });
    return;
  }
  const columns = await svc.reorderColumns(param(req, 'projectId'), positions);
  res.json(columns);
});
