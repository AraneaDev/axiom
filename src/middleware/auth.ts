import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

import { isRegistryRoute } from '../actions/rest';
import { prisma } from '../config/database';
import { env } from '../config/env';
import { getRequestContext } from '../lib/request-context';

import { AppError } from './errorHandler';
import { normalizeApiPath, tokenAllows } from './token-scopes';

export interface AuthPayload {
  userId: string;
}

/**
 * Escapes and doubled slashes: normalizeApiPath reads other segments here than Express routes
 * on, so such a path can match a binding and still reach a legacy route.
 */
const RESPELLED_PATH = /%|\/\//;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express augmentation requires namespace
  namespace Express {
    interface Request {
      userId?: string;
      /** Set when the request authenticated with an API token: the token's scopes */
      tokenScopes?: string[];
      /** Set when the request authenticated with an API token: the token's id and name */
      apiTokenId?: string;
      apiTokenName?: string;
    }
  }
}

/**
 * Authenticate via JWT Bearer token or API token.
 * API tokens use the "Token" scheme: `Authorization: Token tk_...`
 * JWTs use the "Bearer" scheme: `Authorization: Bearer eyJ...`
 * @param req
 * @param _res
 * @param next
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
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

      const apiTokenUser = await prisma.user.findUnique({
        where: { id: apiToken.userId },
        select: { deactivatedAt: true },
      });
      if (apiTokenUser?.deactivatedAt) {
        throw new AppError(403, 'Account has been deactivated', 'ACCOUNT_DEACTIVATED');
      }

      // A token only reaches what its scopes cover (see token-scopes.ts)
      // Every spelling Express routes to the same handler meets the same rule
      const rawPath = req.originalUrl.split('?')[0];
      const path = normalizeApiPath(rawPath);
      // On a registry route the action checks the scope; see executeAction
      const actionDecides = !RESPELLED_PATH.test(rawPath) && isRegistryRoute(req.method, path);
      if (!actionDecides && !tokenAllows(apiToken.scopes, req.method, path)) {
        throw new AppError(403, 'This API token does not have the scope for this request', 'SCOPE');
      }

      req.userId = apiToken.userId;
      req.tokenScopes = apiToken.scopes;
      req.apiTokenId = apiToken.id;
      req.apiTokenName = apiToken.name;
      const ctx = getRequestContext();
      if (ctx) {
        ctx.userId = apiToken.userId;
        ctx.apiTokenId = apiToken.id;
        ctx.apiTokenName = apiToken.name;
        ctx.channel = 'rest-token';
      }
      return next();
    }

    // JWT auth
    if (header.startsWith('Bearer ')) {
      const token = header.slice(7);
      const payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;

      const jwtUser = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { deactivatedAt: true },
      });
      if (jwtUser?.deactivatedAt) {
        throw new AppError(403, 'Account has been deactivated', 'ACCOUNT_DEACTIVATED');
      }

      req.userId = payload.userId;
      const ctx = getRequestContext();
      if (ctx) ctx.userId = payload.userId;
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
