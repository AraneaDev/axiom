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

/**
 * Extract a route param as an integer.
 * Throws 400 if missing or not a valid number.
 * @param req
 * @param name
 */
export function paramInt(req: Request, name: string): number {
  const val = param(req, name);
  const num = parseInt(val, 10);
  if (Number.isNaN(num)) throw new AppError(400, `Parameter '${name}' must be a number`);
  return num;
}
