import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

import { logger } from '../utils/logger';

/**
 * Application-specific error with HTTP status code and optional error code.
 */
export class AppError extends Error {
  /**
   * @param statusCode - HTTP status code to return
   * @param message - Human-readable error message
   * @param code - Optional machine-readable error code (e.g., 'NOT_FOUND', 'CONFLICT')
   */
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
 * Global Express error handler that converts AppError and ZodError into JSON responses.
 * Unhandled errors return 500 Internal Server Error.
 * @param err - The caught error
 * @param _req - The Express request (unused)
 * @param res - The Express response
 * @param _next - The next middleware (unused, required by Express error handler signature)
 */
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
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

  logger.error('Unhandled error', undefined, err);
  return res.status(500).json({
    error: { message: 'Internal server error', code: 'INTERNAL_ERROR' },
  });
}
