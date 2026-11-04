import rateLimit, { MemoryStore, type Options } from 'express-rate-limit';

import { env } from '../config/env.js';

import { AppError } from './errorHandler.js';

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

/** Signed upload URLs: 30 req/min per IP. The route has no auth header, so this slows probing. */
export const SIGNED_UPLOAD_LIMIT = { windowMs: 60_000, max: 30 } as const;

export const signedUploadLimiter = rateLimit({
  ...SIGNED_UPLOAD_LIMIT,
  message: errorMessage('Too many uploads, please try again later'),
  skip,
});

/** Auth endpoints: 15 req/min */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  message: errorMessage('Too many authentication attempts, please try again later'),
  skip,
});

/** Search: 30 req/min (runs full-text queries). Per address on the route, per user on the action. */
export const SEARCH_LIMIT = { windowMs: 60_000, max: 30 } as const;

export const searchLimiter = rateLimit({
  ...SEARCH_LIMIT,
  message: errorMessage('Too many search requests, please try again later'),
  skip,
});

/**
 * Public form submissions and secret checks: 20 req/min per IP across all forms, on top of
 * each form's own rateLimitPerHour. Keeps guessing a gated form's secret slow.
 */
export const publicFormLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  message: errorMessage('Too many form submissions, please try again later'),
  skip,
});

/**
 * A limit per user, for what a per-request limit can't see: work that one request can multiply,
 * and ways in that the path-mounted limiters don't cover.
 * @param limit - The window, and the most counted in it
 * @param limit.windowMs
 * @param limit.max
 * @param message - What a caller past the limit reads
 * @returns Counts for a user, and throws 429 RATE_LIMITED past the limit
 */
export function perUserLimit(limit: { windowMs: number; max: number }, message: string) {
  const hits = new MemoryStore();
  hits.init({ windowMs: limit.windowMs } as Options);
  return async (userId: string, count = 1): Promise<void> => {
    let totalHits = 0;
    for (let i = 0; i < count; i++) ({ totalHits } = await hits.increment(userId));
    if (totalHits > limit.max) throw new AppError(429, message, 'RATE_LIMITED');
  };
}
