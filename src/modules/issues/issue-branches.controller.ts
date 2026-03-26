import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as svc from './issue-branches.service';

export const getBranches = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  res.json(await svc.getBranches(projectId, parseInt(issueNumber, 10)));
});

export const createBranch = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const branch = await svc.createBranch(projectId, parseInt(issueNumber), req.userId!, req.body);
  res.status(201).json(branch);
});

export const getSuggestedName = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const suggestion = await svc.getSuggestedName(projectId, parseInt(issueNumber, 10));
  res.json({ suggestion });
});
