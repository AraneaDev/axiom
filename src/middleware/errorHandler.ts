import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

import { loggableUrl } from '../lib/request-path';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    /** What a caller can act on beyond the message, such as the candidates of an ambiguous key */
    public details?: Record<string, unknown>,
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
      error: { message: err.message, code: err.code, details: err.details },
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

  // A malformed percent-escape in a path param, which the router marks with a status. A URIError
  // from a handler has none, and is a bug like any other.
  const routerStatus = (err as URIError & { status?: number }).status;
  if (err instanceof URIError && typeof routerStatus === 'number') {
    return res.status(routerStatus).json({
      error: { message: 'The URL is not valid', code: 'BAD_REQUEST' },
    });
  }

  // The JSON body parser refusing a body: the caller's mistake, in the caller's words
  const bodyError = (err as Error & { type?: string }).type;
  if (bodyError === 'entity.parse.failed') {
    return res.status(400).json({
      error: { message: 'The request body is not valid JSON', code: 'INVALID_JSON' },
    });
  }
  if (bodyError === 'entity.too.large') {
    return res.status(413).json({
      error: { message: 'The request body is too large', code: 'BODY_TOO_LARGE' },
    });
  }

  logger.fatal('unhandled error', requestContext, err);
  return res.status(500).json({
    error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
  });
}
