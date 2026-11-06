import type { NextFunction, Request, Response } from 'express';

import { requestPathname } from '../lib/request-path';
import { containsNul } from '../lib/text-guard';

import { normalizeApiPath } from './token-scopes';

/** These run actions by name: executeAction refuses NUL per action, so one item answers for itself. */
const CHECKED_PER_ACTION = new Set(['/api/mcp', '/api/act', '/api/read']);

/**
 * Refuse NUL in the path, the query or a JSON body of an /api request: every route would otherwise
 * answer it with a failed query. A multipart or binary body isn't parsed at this point, so files
 * holding NUL bytes pass, and the signed upload route sits ahead of this.
 * @param req - The request
 * @param res - The response
 * @param next - Continues to the routes
 */
export function nulGuard(req: Request, res: Response, next: NextFunction) {
  const pathname = requestPathname(req);
  if (CHECKED_PER_ACTION.has(normalizeApiPath(pathname))) {
    next();
    return;
  }
  // A Buffer is a raw body (the GitHub webhook's), kept as bytes for its signature: no text to scan
  const text = Buffer.isBuffer(req.body) ? undefined : req.body;
  if (/%00/.test(pathname) || containsNul(req.query) || containsNul(text)) {
    res.status(400).json({
      error: { message: 'Text may not contain a NUL character', code: 'INVALID_TEXT' },
    });
    return;
  }
  next();
}
