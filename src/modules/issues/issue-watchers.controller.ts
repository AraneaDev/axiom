import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as svc from './issue-watchers.service';

export const toggleWatch = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const result = await svc.toggleWatch(projectId, parseInt(issueNumber, 10), req.userId!);
  res.json(result);
});

export const getWatchers = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const watchers = await svc.getWatchers(projectId, parseInt(issueNumber, 10));
  const watching = await svc.isWatching(projectId, parseInt(issueNumber, 10), req.userId!);
  res.json({ watchers, watching });
});
