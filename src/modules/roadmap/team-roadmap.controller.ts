import type { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation/common-validators';

import * as teamRoadmapService from './team-roadmap.service';
import { teamTimelineQuerySchema } from './team-roadmap.validation';

export const getTeamTimeline = asyncHandler(async (req: Request, res: Response) => {
  const teamId = param(req, 'teamId');
  const filters = validate(teamTimelineQuerySchema, req.query);
  const data = await teamRoadmapService.getTeamTimelineData(teamId, filters);
  res.json(data);
});
