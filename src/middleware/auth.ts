import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { AppError } from './errorHandler';

export interface AuthPayload {
  userId: string;
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Authenticate via JWT Bearer token or API token.
 * API tokens use the "Token" scheme: `Authorization: Token tk_...`
 * JWTs use the "Bearer" scheme: `Authorization: Bearer eyJ...`
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const header = req.headers.authorization;
    if (!header) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');

    // API token auth
    if (header.startsWith('Token ')) {
      const token = header.slice(6);
      const crypto = await import('crypto');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      const apiToken = await prisma.apiToken.findUnique({ where: { tokenHash } });
      if (!apiToken) throw new AppError(401, 'Invalid API token', 'INVALID_TOKEN');
      if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
        throw new AppError(401, 'API token expired', 'TOKEN_EXPIRED');
      }

      // Update last used
      await prisma.apiToken.update({
        where: { id: apiToken.id },
        data: { lastUsedAt: new Date() },
      });

      req.userId = apiToken.userId;
      return next();
    }

    // JWT auth
    if (header.startsWith('Bearer ')) {
      const token = header.slice(7);
      const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
      req.userId = payload.userId;
      return next();
    }

    throw new AppError(401, 'Invalid authorization scheme', 'INVALID_AUTH_SCHEME');
  } catch (err) {
    if (err instanceof AppError) return next(err);
    if (err instanceof jwt.JsonWebTokenError) {
      return next(new AppError(401, 'Invalid token', 'INVALID_TOKEN'));
    }
    return next(err);
  }
}
