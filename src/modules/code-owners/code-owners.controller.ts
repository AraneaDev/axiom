import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import { param, paramInt } from '../../utils/params';

import * as codeOwnersService from './code-owners.service';

export const getPROwners = asyncHandler(async (req: Request, res: Response) => {
  const result = await codeOwnersService.getOwnersForPR(
    param(req, 'repoId'),
    paramInt(req, 'number'),
  );
  res.json(result);
});
