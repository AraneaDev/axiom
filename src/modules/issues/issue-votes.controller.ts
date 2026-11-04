import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param, paramInt } from '../../utils/params';

import * as svc from './issue-votes.service';

export const toggle = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = paramInt(req, 'issueNumber');
  const result = await svc.toggleVote(projectId, issueNumber, req.userId!);
  res.json(result);
});

export const getVotes = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = paramInt(req, 'issueNumber');
  const result = await svc.getVotes(projectId, issueNumber, req.userId!);
  res.json(result);
});
