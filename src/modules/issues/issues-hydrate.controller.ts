import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param, paramInt } from '../../utils/params';

import {
  hydrateIssueDetail as hydrateIssueDetailService,
  hydrateIssuesList as hydrateIssuesListService,
} from './issues-hydrate.service';

export const hydrateIssueDetail = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = paramInt(req, 'issueNumber');
  const result = await hydrateIssueDetailService(projectId, issueNumber, req.userId!);
  res.json(result);
});

export const hydrateIssuesList = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.query)) {
    if (typeof v === 'string') filters[k] = v;
  }
  const result = await hydrateIssuesListService(projectId, filters, req.userId!);
  res.json(result);
});
