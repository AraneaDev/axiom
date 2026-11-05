import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createInviteLinkSchema } from '../../utils/validation';

import * as orgsService from './orgs.service';

export const listMembers = asyncHandler(async (req: Request, res: Response) => {
  const members = await orgsService.listOrgMembers(param(req, 'orgId'));
  res.json(members);
});

// Invite Links
export const createInvite = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createInviteLinkSchema, req.body);
  const invite = await orgsService.createInviteLink(param(req, 'orgId'), req.userId!, data);
  res.status(201).json(invite);
});

export const listInvites = asyncHandler(async (req: Request, res: Response) => {
  const invites = await orgsService.listInviteLinks(param(req, 'orgId'));
  res.json(invites);
});

export const deleteInvite = asyncHandler(async (req: Request, res: Response) => {
  await orgsService.deleteInviteLink(param(req, 'orgId'), param(req, 'inviteId'));
  res.status(204).send();
});
