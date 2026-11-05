import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';

import * as projectsService from './projects.service';

export const analytics = asyncHandler(async (req: Request, res: Response) => {
  const data = await projectsService.getProjectAnalytics(param(req, 'projectId'));
  res.json(data);
});
