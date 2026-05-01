import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { prisma } from '../config/database';
import { env } from '../config/env';
import { getSiteSettings } from '../modules/site-settings/site-settings.service';

import type { AuthPayload } from './auth';

/** Routes exempt from 2FA enforcement (users need these to set up 2FA or manage session). */
const EXEMPT_PATHS = new Set([
  '/api/auth/2fa/enable',
  '/api/auth/2fa/verify',
  '/api/auth/2fa/disable',
  '/api/auth/logout',
  '/api/auth/refresh',
  '/api/auth/me',
  '/api/auth/login',
  '/api/auth/register',
  '/api/site-settings',
]);

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

    // Skip exempt paths
    if (EXEMPT_PATHS.has(req.path)) return next();

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
