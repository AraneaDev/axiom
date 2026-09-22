import type { Request } from 'express';
import rateLimit from 'express-rate-limit';

import { env } from '../config/env.js';

const skip = () => env.NODE_ENV === 'test';

// Hook calls come from the api or git-ssh container, not a browser, and are already
// authenticated by the X-Hook-Secret header. A push with hundreds of refs fires one
// hook call per ref in quick succession, which the global per-IP budget was never
// sized for; exempt the route instead of raising the global limit for everyone.
const skipGlobal = (req: Request) =>
  env.NODE_ENV === 'test' || req.path.startsWith('/api/internal/hooks');

const errorMessage = (msg: string) => ({
  error: { message: msg, code: 'RATE_LIMITED' },
});

/** Global: 300 req/min */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipGlobal,
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

/** Git smart HTTP: 120 req/min */
export const gitLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  message: errorMessage('Too many git requests, please try again later'),
  skip,
});
