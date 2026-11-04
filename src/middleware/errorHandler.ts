import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

import { loggableUrl } from '../lib/request-path';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 *
 * @param err
 * @param req
 * @param res
 * @param _next
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const requestContext = {
    requestId: req.requestId,
    method: req.method,
    url: loggableUrl(req),
  };

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error('application error', { ...requestContext, statusCode: err.statusCode }, err);
    }
    return res.status(err.statusCode).json({
      error: { message: err.message, code: err.code },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: err.issues,
      },
    });
  }

  logger.fatal('unhandled error', requestContext, err);
  return res.status(500).json({
    error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
  });
}
