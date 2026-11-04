import type { Request, Response, Router } from 'express';

import { authenticate } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';

import type { ActionContext, ActionDef, RestBinding } from './define';
import { executeAction } from './execute';

const ROUTER_METHOD = {
  GET: 'get',
  POST: 'post',
  PUT: 'put',
  PATCH: 'patch',
  DELETE: 'delete',
} as const;

const LITERAL_SEGMENT = /^[a-z0-9._~-]+$/;
const PARAM_SEGMENT = /^:[a-z_][a-z0-9_]*$/;

/** What mountActions has mounted, for isRegistryRoute: lower-case segments, params as `:name`. */
const mountedRoutes: Array<{ method: RestBinding['method']; segments: string[] }> = [];

/**
 * A binding's path as segments to compare with a normalized path. Only literal and `:param`
 * segments: isRegistryRoute must agree with Express on what a path matches, and it would not on
 * wildcards or optional groups.
 * @param path - The binding's path
 * @throws {Error} On any other pattern, at startup
 */
function compilePath(path: string): string[] {
  const segments = path.toLowerCase().split('/').filter(Boolean);
  for (const segment of segments) {
    if (!LITERAL_SEGMENT.test(segment) && !PARAM_SEGMENT.test(segment)) {
      throw new Error(`Unsupported segment "${segment}" in action path ${path}`);
    }
  }
  return segments;
}

/**
 * Whether a registry binding owns this request, so that the action checks the token's scope
 * instead of the legacy path table. Only bindings that were mounted count.
 * @param method - The HTTP method
 * @param normalizedPath - The path, through normalizeApiPath
 */
export function isRegistryRoute(method: string, normalizedPath: string): boolean {
  // Express routes HEAD to the GET handler
  const wanted = method === 'HEAD' ? 'GET' : method;
  const segments = normalizedPath.split('/').filter(Boolean);
  return mountedRoutes.some(
    (route) =>
      route.method === wanted &&
      route.segments.length === segments.length &&
      route.segments.every((segment, i) => segment.startsWith(':') || segment === segments[i]),
  );
}

/**
 * Who runs an action, from what authenticate left on the request.
 * @param req - An authenticated request
 * @throws {AppError} 401 when the request went through no authentication
 */
export function actionContextFromRequest(req: Request): ActionContext {
  if (!req.userId) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
  if (req.apiTokenId === undefined) return { userId: req.userId, channel: 'ui' };
  return {
    userId: req.userId,
    apiTokenId: req.apiTokenId,
    apiTokenName: req.apiTokenName,
    scopes: req.tokenScopes ?? [],
    channel: 'rest-token',
  };
}

/**
 * Answer with what the handler returned. A raw handler has answered through `ctx.http` itself.
 * @param res - The response
 * @param binding - The action's binding
 * @param result - What the handler returned
 */
function sendResult(res: Response, binding: RestBinding, result: unknown): void {
  if (binding.raw) return;
  if (binding.method === 'DELETE' && result === undefined) {
    res.status(204).end();
    return;
  }
  res.status(binding.status ?? (binding.method === 'POST' ? 201 : 200)).json(result);
}

/**
 * Mount each action's REST binding, in array order: Express takes the first match, so a static
 * path goes before the param path that would capture it. Authentication is per route, because
 * this router sits in front of the legacy routers and must let their paths through untouched.
 * @param router - The router to mount on, at the root: binding paths are complete
 * @param defs - The actions; those without a binding are skipped
 */
export function mountActions(router: Router, defs: ActionDef[]): void {
  for (const def of defs) {
    const binding = def.rest;
    if (!binding) continue;
    const segments = compilePath(binding.path);
    router[ROUTER_METHOD[binding.method]](binding.path, authenticate, async (req, res) => {
      const ctx = actionContextFromRequest(req);
      if (binding.raw) ctx.http = { req, res };
      // The body and query can't override the params that authorize reads
      const input: unknown = { ...req.query, ...req.body, ...req.params };
      sendResult(res, binding, await executeAction(def.name, input, ctx));
    });
    mountedRoutes.push({ method: binding.method, segments });
  }
}
