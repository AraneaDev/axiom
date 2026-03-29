import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import { getDevelopmentSummary } from './development-panel.service';

export const getDevelopmentPanel = asyncHandler(async (req: Request, res: Response) => {
  const projectId = param(req, 'projectId');
  const issueNumber = param(req, 'issueNumber');
  const summary = await getDevelopmentSummary(projectId, parseInt(issueNumber, 10));
  res.json(summary);
});
