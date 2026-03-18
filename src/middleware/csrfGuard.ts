import { Request, Response, NextFunction } from 'express';

/**
 * CSRF mitigation for JWT/localStorage-based auth.
 *
 * Requires state-changing requests (POST, PUT, PATCH, DELETE) to include
 * the custom header `X-Requested-With: XMLHttpRequest`. Browsers enforce
 * that custom headers cannot be sent cross-origin without a preflight
 * CORS check, so this blocks simple cross-site form submissions.
 *
 * Safe methods (GET, HEAD, OPTIONS) are always allowed through.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard middleware requiring X-Requested-With header on mutations.
 * @param req - Express request
 * @param res - Express response
 * @param next - Next middleware
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const xRequestedWith = req.headers['x-requested-with'];
  if (xRequestedWith === 'XMLHttpRequest') {
    return next();
  }

  return res.status(403).json({
    error: {
      message: 'Missing required X-Requested-With header',
      code: 'CSRF_HEADER_MISSING',
    },
  });
}
