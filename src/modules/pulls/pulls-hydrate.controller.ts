import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param, paramInt } from '../../utils/params';

import { hydratePRDetail as hydratePRDetailService } from './pulls-hydrate.service';

export const hydratePRDetail = asyncHandler(async (req: Request, res: Response) => {
  const repoId = param(req, 'repoId');
  const prNumber = paramInt(req, 'number');
  const result = await hydratePRDetailService(repoId, prNumber);
  res.json(result);
});
