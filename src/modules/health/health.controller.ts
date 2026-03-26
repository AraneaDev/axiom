import { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';

import * as healthService from './health.service';

export const getHealth = asyncHandler(async (_req: Request, res: Response) => {
  const result = await healthService.checkHealth();
  const statusCode = result.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(result);
});
