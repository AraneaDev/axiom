import { Request, Response } from 'express';

import * as healthService from './health.service';

/**
 * Handle health check requests.
 * @param _req
 * @param res
 */
export async function getHealth(_req: Request, res: Response) {
  const result = await healthService.checkHealth();
  const statusCode = result.status === 'unhealthy' ? 503 : 200;
  res.status(statusCode).json(result);
}
