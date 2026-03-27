import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as svc from './wiki-stars.service';

export const toggleStar = asyncHandler(async (req: Request, res: Response) => {
  const result = await svc.toggleStar(req.userId!, param(req, 'pageId'));
  res.json(result);
});

export const getStarredPages = asyncHandler(async (req: Request, res: Response) => {
  const pages = await svc.getStarredPages(req.userId!);
  res.json(pages);
});

export const checkStarred = asyncHandler(async (req: Request, res: Response) => {
  const starred = await svc.isStarred(req.userId!, param(req, 'pageId'));
  res.json({ starred });
});
