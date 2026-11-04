import { AsyncLocalStorage } from 'node:async_hooks';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface RequestCtx {
  userId?: string;
  apiTokenId?: string;
  apiTokenName?: string;
  channel: 'ui' | 'rest-token' | 'mcp';
}

const storage = new AsyncLocalStorage<RequestCtx>();

/**
 * Run fn with ctx as the active request context. The object is shared, not copied,
 * so later mutations (authenticate filling in the user) are visible to every reader.
 * @param ctx - The context object to expose through getRequestContext
 * @param fn - The work to run inside the context
 */
export function runWithRequestContext<T>(ctx: RequestCtx, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The context of the request being handled, or undefined outside of one. */
export function getRequestContext(): RequestCtx | undefined {
  return storage.getStore();
}

/**
 * Open a mutable context for the request. Mount after body parsing and before routes:
 * `authenticate` runs inside routers, so it fills this object in rather than creating one.
 * @param _req
 * @param _res
 * @param next
 */
export const requestContextMiddleware: RequestHandler = (
  _req: Request,
  _res: Response,
  next: NextFunction,
) => {
  runWithRequestContext({ channel: 'ui' }, () => next());
};

/**
 * The attribution columns (`apiTokenId`, `via`) for a row written now. Both are null
 * outside a token request, so every activity and audit write can spread this.
 */
export function attributionFields(): { apiTokenId: string | null; via: string | null } {
  const ctx = getRequestContext();
  return { apiTokenId: ctx?.apiTokenId ?? null, via: ctx?.apiTokenName ?? null };
}
