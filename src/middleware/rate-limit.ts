import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';

const skip = () => env.NODE_ENV === 'test';

const errorMessage = (msg: string) => ({
  error: { message: msg, code: 'RATE_LIMITED' },
});

/** Global API limit: 300 req/min per IP. Mounted on /api only. */
export const GLOBAL_LIMIT = { windowMs: 60_000, max: 300 } as const;

export const globalLimiter = rateLimit({
  ...GLOBAL_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
});

/** Auth endpoints: 15 req/min */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  message: errorMessage('Too many authentication attempts, please try again later'),
  skip,
});

/** Search: 30 req/min (runs full-text queries) */
export const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: errorMessage('Too many search requests, please try again later'),
  skip,
});
