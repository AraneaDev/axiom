import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as analyticsService from './analytics.service';

export const getOrgAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const orgId = param(req, 'orgId');
  const period = analyticsService.parsePeriod(req.query.period as string | undefined);
  const data = await analyticsService.getOrgAnalytics(orgId, period, req.userId!);
  res.json(data);
});

export const getTeamAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const teamId = param(req, 'teamId');
  const period = analyticsService.parsePeriod(req.query.period as string | undefined);
  const data = await analyticsService.getTeamAnalytics(teamId, period);
  res.json(data);
});
