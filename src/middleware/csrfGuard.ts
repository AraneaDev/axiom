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

// Paths exempt from CSRF, relative to the /api mount. The MCP endpoint only reads the
// Authorization header, so a cross-site request carries no credential, and MCP clients don't
// send this header.
const CSRF_EXEMPT_PATHS = new Set(['/mcp']);

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

  if (CSRF_EXEMPT_PATHS.has(req.path)) {
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
