import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as insightsService from './insights.service';

export const commitFrequency = asyncHandler(async (req: Request, res: Response) => {
  const days = parseInt((req.query.days as string) || '90', 10);
  const data = await insightsService.getCommitFrequency(param(req, 'repoId'), days);
  res.json(data);
});

export const contributors = asyncHandler(async (req: Request, res: Response) => {
  const data = await insightsService.getContributors(param(req, 'repoId'));
  res.json(data);
});

export const languages = asyncHandler(async (req: Request, res: Response) => {
  const ref = (req.query.ref as string) || 'HEAD';
  const data = await insightsService.getLanguageBreakdown(param(req, 'repoId'), ref);
  res.json(data);
});

export const codeFrequency = asyncHandler(async (req: Request, res: Response) => {
  const weeks = parseInt((req.query.weeks as string) || '52', 10);
  const data = await insightsService.getCodeFrequency(param(req, 'repoId'), weeks);
  res.json(data);
});
