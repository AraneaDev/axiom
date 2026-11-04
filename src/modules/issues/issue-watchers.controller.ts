import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param, paramInt } from '../../utils/params';

import * as svc from './issue-watchers.service';

export const toggleWatch = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = paramInt(req, 'issueNumber');
  const result = await svc.toggleWatch(projectId, issueNumber, req.userId!);
  res.json(result);
});

export const getWatchers = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = paramInt(req, 'issueNumber');
  const watchers = await svc.getWatchers(projectId, issueNumber);
  const watching = await svc.isWatching(projectId, issueNumber, req.userId!);
  res.json({ watchers, watching });
});
