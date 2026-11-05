import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as teamsService from './teams.service';

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
  const members = await teamsService.listTeamMembers(param(req, 'teamId'));
  res.json(members);
});

export const getActivity = asyncHandler(async (req: Request, res: Response) => {
  const activity = await teamsService.getTeamActivity(param(req, 'teamId'), req.userId!);
  res.json(activity);
});

export const getMemberProfile = asyncHandler(async (req: Request, res: Response) => {
  const profile = await teamsService.getTeamMemberProfile(
    param(req, 'teamId'),
    param(req, 'username'),
    req.userId!,
  );
  res.json(profile);
});
