import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate, createInvitationSchema } from '../../utils/validation';

import * as invitationsService from './invitations.service';

export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createInvitationSchema, req.body);
  const invitation = await invitationsService.createInvitation(
    param(req, 'orgId'),
    req.userId!,
    data,
  );
  res.status(201).json(invitation);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const teamId = req.query.teamId as string | undefined;
  const invitations = await invitationsService.listInvitations(param(req, 'orgId'), teamId);
  res.json(invitations);
});

export const revoke = asyncHandler(async (req: Request, res: Response) => {
  await invitationsService.revokeInvitation(param(req, 'id'), param(req, 'orgId'));
  res.status(204).send();
});

export const accept = asyncHandler(async (req: Request, res: Response) => {
  const result = await invitationsService.acceptInvitation(param(req, 'token'), req.userId!);
  res.json(result);
});
