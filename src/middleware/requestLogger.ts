import crypto from 'crypto';

import type { Request, Response, NextFunction } from 'express';

import { logger } from '../utils/logger';

import { isBackendPath } from './static-frontend';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    log: ReturnType<typeof logger.child>;
    userId?: string;
  }
}

const SLOW_REQUEST_MS = parseInt(process.env.SLOW_REQUEST_THRESHOLD_MS || '1000', 10);

/**
 * Assigns a unique request ID (or reuses X-Request-Id from the client),
 * attaches a child logger with request context, and logs request completion
 * with duration, status, response size, and slow-request warnings.
 * Served frontend requests (assets, client routes) are only logged on a 5xx.
 * @param req
 * @param res
 * @param next
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.requestId = requestId;

  req.log = logger.child({
    requestId,
    method: req.method,
    url: req.originalUrl,
  });

  res.setHeader('X-Request-Id', requestId);

  const frontend = !isBackendPath(req.originalUrl.split('?')[0]);
  const start = Date.now();
  res.on('finish', () => {
    if (frontend && res.statusCode < 500) return;
    const durationMs = Date.now() - start;
    const contentLength = res.getHeader('content-length');
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    // userId is available here because auth middleware has already run
    const userId = req.userId;

    req.log[level]('request completed', {
      statusCode: res.statusCode,
      durationMs,
      ...(contentLength && { contentLength: Number(contentLength) }),
      ...(userId && { userId }),
    });

    if (durationMs > SLOW_REQUEST_MS) {
      req.log.warn('slow request detected', {
        statusCode: res.statusCode,
        durationMs,
        threshold: SLOW_REQUEST_MS,
      });
    }
  });

  next();
}
