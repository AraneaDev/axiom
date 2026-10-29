import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';

const skip = () => env.NODE_ENV === 'test';

const errorMessage = (msg: string) => ({
  error: { message: msg, code: 'RATE_LIMITED' },
});

/** Global: 300 req/min */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
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
