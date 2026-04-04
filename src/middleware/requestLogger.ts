import crypto from 'crypto';

import type { Request, Response, NextFunction } from 'express';

import { logger } from '../utils/logger';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    log: ReturnType<typeof logger.child>;
  }
}

/**
 * Assigns a unique request ID (or reuses X-Request-Id from the client),
 * attaches a child logger with request context, and logs request completion.
 * @param req
 * @param res
 * @param next
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.requestId = requestId;
  req.log = logger.child({ requestId, method: req.method, url: req.originalUrl });

  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level]('request completed', {
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });

  next();
}
