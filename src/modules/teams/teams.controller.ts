import { TeamRole } from '@prisma/client';
import { Request, Response } from 'express';

import { AppError } from '../../middleware/errorHandler';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createTeamSchema, addTeamMemberSchema } from '../../utils/validation';

import * as teamsService from './teams.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createTeamSchema, req.body);
  const team = await teamsService.createTeam(param(req, 'orgId'), req.userId!, data);
  res.status(201).json(team);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const { name, description } = req.body;
  if (name !== undefined && typeof name !== 'string') {
    throw new AppError(400, 'name must be a string');
  }
  if (description !== undefined && typeof description !== 'string') {
    throw new AppError(400, 'description must be a string');
  }
  const team = await teamsService.updateTeam(param(req, 'teamId'), { name, description });
  res.json(team);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await teamsService.deleteTeam(param(req, 'teamId'));
  res.status(204).send();
});

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
  const members = await teamsService.listTeamMembers(param(req, 'teamId'));
  res.json(members);
});

export const addMember = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(addTeamMemberSchema, req.body);
  const member = await teamsService.addTeamMember(
    param(req, 'teamId'),
    data.userId,
    data.role as TeamRole,
  );
  res.status(201).json(member);
});

export const updateMemberRole = asyncHandler(async (req: Request, res: Response) => {
  const member = await teamsService.updateTeamMemberRole(
    param(req, 'teamId'),
    param(req, 'memberId'),
    req.body.role,
  );
  res.json(member);
});

export const removeMember = asyncHandler(async (req: Request, res: Response) => {
  await teamsService.removeTeamMember(param(req, 'teamId'), param(req, 'memberId'));
  res.status(204).send();
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
