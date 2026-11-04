import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as issuesService from './issues.service';

export const board = asyncHandler(async (req: Request, res: Response) => {
  const columns = await issuesService.getBoard(param(req, 'projectId'));
  res.json(columns);
});

export const roadmap = asyncHandler(async (req: Request, res: Response) => {
  const data = await issuesService.getRoadmap(param(req, 'projectId'));
  res.json(data);
});
