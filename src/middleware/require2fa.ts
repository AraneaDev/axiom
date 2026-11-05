import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { prisma } from '../config/database';
import { env } from '../config/env';
import { getSiteSettings } from '../modules/site-settings/site-settings.service';

import type { AuthPayload } from './auth';

/**
 * Requests exempt from 2FA enforcement: what the app needs to load, set up 2FA and manage the
 * session, by method and path relative to the /api mount, as `req.path` is. Matched exactly, so
 * another spelling or method of one of these meets the check. The user's own profile is exempt
 * for reading only: the app loads it first, and changing it needs 2FA.
 */
const EXEMPT_REQUESTS = new Set([
  'POST /auth/2fa/enable',
  'POST /auth/2fa/verify',
  'POST /auth/2fa/disable',
  'POST /auth/logout',
  'POST /auth/refresh',
  'GET /auth/me',
  'POST /auth/login',
  'POST /auth/register',
  'GET /site-settings',
  'GET /users/me',
]);

/** The public side of the forms, by path relative to the /api mount */
const PUBLIC_FORM_PATH = /^\/f\/[^/]+(\/(submit|verify))?\/?$/i;

/**
 * Middleware that blocks authenticated users who haven't set up 2FA
 * when the admin has enabled enforce2fa in site settings.
 * Uses soft JWT decode so it works regardless of authenticate middleware ordering.
 * @param req
 * @param res
 * @param next
 */
export async function require2fa(req: Request, res: Response, next: NextFunction) {
  try {
    // The public form pages take no account, so a session that comes along does not count
    if (PUBLIC_FORM_PATH.test(req.path)) return next();

    // Soft-resolve userId from JWT if not already set by authenticate
    if (!req.userId) {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        try {
          const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as AuthPayload;
          req.userId = payload.userId;
        } catch {
          return next(); // Invalid/missing token — unauthenticated, skip
        }
      } else {
        return next(); // No bearer token — unauthenticated, skip
      }
    }

    // Skip exempt requests
    if (EXEMPT_REQUESTS.has(`${req.method} ${req.path}`)) return next();

    const settings = await getSiteSettings();
    if (!settings.enforce2fa) return next();

    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { twoFactorEnabled: true },
    });

    if (user?.twoFactorEnabled) return next();

    res.status(403).json({
      error: {
        message: 'Two-factor authentication is required. Please set up 2FA to continue.',
        code: 'TWO_FACTOR_SETUP_REQUIRED',
      },
    });
  } catch (err) {
    next(err);
  }
}
