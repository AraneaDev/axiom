import type { Request, RequestHandler, Response, Router } from 'express';

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

/**
 * A binding's path as lower-case segments, as Express compares them. Only literal and `:param`
 * segments, so that mountActions can tell which paths capture which.
 * @param path - The binding's path
 * @throws {Error} On any other pattern, at startup
 */
function pathSegments(path: string): string[] {
  const segments = path.toLowerCase().split('/').filter(Boolean);
  for (const segment of segments) {
    if (!LITERAL_SEGMENT.test(segment) && !PARAM_SEGMENT.test(segment)) {
      throw new Error(`Unsupported segment "${segment}" in action path ${path}`);
    }
  }
  return segments;
}

/**
 * Whether a mounted path takes every request a later path would match, leaving that one
 * unreachable: a duplicate, or a param path ahead of the static path it captures.
 * @param earlier - The segments mounted first
 * @param later - The segments mounted after
 */
function captures(earlier: string[], later: string[]): boolean {
  return (
    earlier.length === later.length &&
    earlier.every((segment, i) => segment.startsWith(':') || segment === later[i])
  );
}

/**
 * Tell authenticate that Express routed this request to a registry binding, so the action checks
 * the token's scope. A binding answers every request it gets, so the mark never reaches a legacy
 * route.
 * @param req - The request
 * @param _res - Unused
 * @param next - Continues to authenticate
 */
const markRegistryRoute: RequestHandler = (req, _res, next) => {
  req.registryRoute = true;
  next();
};

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
 * @throws {Error} At startup, on a path that an earlier one leaves unreachable
 */
export function mountActions(router: Router, defs: ActionDef[]): void {
  const mounted: Array<{ def: ActionDef; method: RestBinding['method']; segments: string[] }> = [];
  for (const def of defs) {
    const binding = def.rest;
    if (!binding) continue;
    const segments = pathSegments(binding.path);
    const captor = mounted.find(
      (route) => route.method === binding.method && captures(route.segments, segments),
    );
    if (captor) {
      throw new Error(
        `Action ${def.name} is unreachable: ${binding.method} ${binding.path} is captured by ` +
          `${captor.def.name} at ${captor.def.rest?.path}`,
      );
    }
    mounted.push({ def, method: binding.method, segments });

    const route = router[ROUTER_METHOD[binding.method]].bind(router);
    route(binding.path, markRegistryRoute, authenticate, async (req, res) => {
      const ctx = actionContextFromRequest(req);
      if (binding.raw) ctx.http = { req, res };
      // Only a read takes its fields from the query (R14); a write reads the body, as the old
      // controllers did. Neither can override the params that authorize reads.
      const query = binding.method === 'GET' ? req.query : {};
      const input: unknown = { ...query, ...req.body, ...req.params };
      sendResult(res, binding, await executeAction(def.name, input, ctx));
    });
  }
}
