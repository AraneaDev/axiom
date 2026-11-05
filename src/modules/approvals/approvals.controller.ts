import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';

import * as approvalsService from './approvals.service';

export const myPendingApprovals = asyncHandler(async (req: Request, res: Response) => {
  const approvals = await approvalsService.getPendingApprovalsForUser(req.userId!);
  res.json(approvals);
});
