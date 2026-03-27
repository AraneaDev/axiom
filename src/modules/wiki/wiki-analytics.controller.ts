import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as svc from './wiki-analytics.service';

export const getAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const analytics = await svc.getPageAnalytics(param(req, 'pageId'));
  res.json(analytics);
});

export const recordView = asyncHandler(async (req: Request, res: Response) => {
  await svc.recordView(param(req, 'pageId'), req.userId!);
  res.status(204).send();
});
