import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as invitationsService from './invitations.service';

export const accept = asyncHandler(async (req: Request, res: Response) => {
  const result = await invitationsService.acceptInvitation(param(req, 'token'), req.userId!);
  res.json(result);
});
