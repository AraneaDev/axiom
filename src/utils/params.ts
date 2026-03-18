import { Request } from 'express';

import { AppError } from '../middleware/errorHandler';

/**
 * Safely extract a route param as a string.
 * Express 5 types params as string | string[] — this normalizes.
 * @param req
 * @param name
 */
export function param(req: Request, name: string): string {
  const val = req.params[name];
  if (Array.isArray(val)) return val[0];
  if (!val) throw new AppError(400, `Missing required parameter: ${name}`);
  return val;
}
