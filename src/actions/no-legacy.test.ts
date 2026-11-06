/**
 * No legacy route is left: every /api route in the Express app is an action's binding, apart
 * from a short list that answers for itself. A token request that no route serves answers as a
 * session's does, so a path tells nobody more than "not found".
 */
import crypto from 'crypto';
import { existsSync } from 'fs';
import path from 'path';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import { requestContextMiddleware } from '../lib/request-context';
import { auditMiddleware } from '../middleware/auditMiddleware';
import { authenticate } from '../middleware/auth';
import { csrfGuard } from '../middleware/csrfGuard';
import { errorHandler } from '../middleware/errorHandler';
import { metricsCollector } from '../middleware/metricsCollector';
import { nulGuard } from '../middleware/nulGuard';
import {
  authLimiter,
  githubWebhookLimiter,
  globalLimiter,
  searchLimiter,
} from '../middleware/rate-limit';
import { requestLogger } from '../middleware/requestLogger';
import { require2fa } from '../middleware/require2fa';
import * as tokenScopes from '../middleware/token-scopes';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';

import { listActions } from './registry';
import { mountActions } from './rest';

/** The /api routes that are no action binding, each answering for itself */
const NOT_ACTIONS = new Set([
  // Actions by name: each item goes through the registry's checks
  'POST /api/act',
  // The MCP server, whose tools run actions; GET and DELETE refuse a stream
  'POST /api/mcp',
  'GET /api/mcp',
  'DELETE /api/mcp',
  // A signed upload URL, its signature the credential
  'PUT /api/uploads/:uploadId',
  // The public API description. Its viewer at /api/docs is middleware, which this walk can't see
  'GET /api/openapi.json',
]);

/** The parts of Express's router internals the walk below reads */
interface RouterLayer {
  name: string;
  slash: boolean;
  path?: string;
  route?: { path: string; methods: Record<string, boolean> };
  handle: { stack?: RouterLayer[] };
  match(path: string): boolean;
}

/**
 * The prefix a router is mounted at, when it is the root or /api: Express keeps no other trace of
 * it. Undefined for any other prefix, which the walk reports as a router it can't read.
 * @param layer - The mount layer
 */
function mountPrefix(layer: RouterLayer): string | undefined {
  if (layer.slash) return '';
  for (const inner of layer.handle.stack ?? []) {
    const probe = `/api${inner.route?.path ?? ''}`;
    if (layer.match(probe)) return layer.path;
  }
  return undefined;
}

/**
 * Every route in a router stack as "METHOD /path", nested routers included. A router whose
 * prefix can't be found counts as "ROUTER ? <name>", and one without routes as "USE <prefix>".
 * @param stack - A router's layers
 * @param prefix - Where it is mounted
 */
function routesOf(stack: RouterLayer[], prefix = ''): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) {
      const full = `${prefix}${layer.route.path}`;
      return Object.keys(layer.route.methods)
        .filter((method) => method !== '_all')
        .map((method) => `${method.toUpperCase()} ${full}`);
    }
    if (!layer.handle.stack) return [];
    const at = mountPrefix(layer);
    if (at === undefined) return [`ROUTER ? ${layer.name}`];
    const inner = routesOf(layer.handle.stack, `${prefix}${at}`);
    if (inner.length > 0) return inner;
    return [`USE ${prefix}${at}`];
  });
}

/**
 * The middleware that app.use mounts where an /api request passes, in order. A handler mounted
 * with app.use answers before the catch-all authenticate, and no binding or action check sees it,
 * so a new one has to be named here. `docsPage` and the asset 404 belong to the API docs viewer.
 */
const API_MIDDLEWARE = [
  'helmetMiddleware',
  'corsMiddleware',
  'requestLogger',
  'metricsCollector',
  // The GitHub webhook path only: counted and gated before its body is read, which stays raw
  // bytes for the signature
  'githubWebhookLimiter',
  'githubWebhookGate',
  'rawParser',
  'jsonParser',
  'nulGuard',
  'requestContextMiddleware',
  'globalLimiter',
  'authLimiter',
  'authLimiter',
  'authLimiter',
  'authLimiter',
  'authLimiter',
  'searchLimiter',
  'csrfGuard',
  'openApiRouter serveStatic',
  'openApiRouter <anonymous>',
  'openApiRouter docsPage',
  'require2fa',
  'auditMiddleware',
  'authenticate',
  '<anonymous>',
  'errorHandler',
];

/** Middleware this file can import, named by identity: several are anonymous functions */
const KNOWN_MIDDLEWARE = new Map<unknown, string>([
  [requestLogger, 'requestLogger'],
  [metricsCollector, 'metricsCollector'],
  [nulGuard, 'nulGuard'],
  [requestContextMiddleware, 'requestContextMiddleware'],
  [globalLimiter, 'globalLimiter'],
  [authLimiter, 'authLimiter'],
  [searchLimiter, 'searchLimiter'],
  [githubWebhookLimiter, 'githubWebhookLimiter'],
  [csrfGuard, 'csrfGuard'],
  [require2fa, 'require2fa'],
  [auditMiddleware, 'auditMiddleware'],
  [authenticate, 'authenticate'],
  [errorHandler, 'errorHandler'],
]);

/** Routers named by identity, filled in once the app is imported */
const KNOWN_ROUTERS = new Map<unknown, string>();

/**
 * The function middleware (no route, no router) in a stack whose matcher accepts any of the
 * given /api paths, nested routers included, named by KNOWN_MIDDLEWARE or the function's name.
 * One mounted at a prefix that no probe and no other path reaches counts as "? <name>".
 * @param stack - A router's layers
 * @param probes - /api paths, relative to where the stack is mounted
 * @param router - The name of the router the stack belongs to, for nested ones
 */
function apiMiddlewareOf(stack: RouterLayer[], probes: string[], router = ''): string[] {
  return stack.flatMap((layer) => {
    if (layer.route) return [];
    if (layer.handle.stack) {
      const at = mountPrefix(layer);
      if (at === undefined) return [`ROUTER ? ${layer.name}`];
      const inner = probes.filter((p) => p.startsWith(at)).map((p) => p.slice(at.length) || '/');
      const name = KNOWN_ROUTERS.get(layer.handle) ?? layer.name;
      return apiMiddlewareOf(layer.handle.stack, inner, name);
    }
    const name = KNOWN_MIDDLEWARE.get(layer.handle) ?? layer.name;
    const full = router ? `${router} ${name}` : name;
    if (probes.some((p) => layer.match(p))) return [full];
    // Mounted at a prefix no probe reaches: it may be an /api path nothing else serves
    if (!layer.match('/zz-not-api')) return [`? ${full}`];
    return [];
  });
}

/**
 * /api paths to probe a middleware's matcher with: every binding and named route with its
 * params filled in, the docs viewer, and a path nothing serves.
 */
function apiProbes(): string[] {
  const paths = [...bindingRoutes(), ...NOT_ACTIONS].map((route) =>
    route.split(' ')[1].replace(/:\w+/g, 'x'),
  );
  return [...new Set([...paths, '/api/docs', '/api/docs/assets/x', '/api/zz-no-route'])];
}

/** The routes that action bindings make, as mountActions mounts them */
function bindingRoutes(): Set<string> {
  return new Set(
    listActions().flatMap((def) => (def.rest ? [`${def.rest.method} ${def.rest.path}`] : [])),
  );
}

describe('no legacy routes', () => {
  let app: Express;

  beforeAll(async () => {
    app = (await import('../index')).default;
  });

  it('serves every /api route from an action binding, or names it here', () => {
    const stack = (app.router as unknown as { stack: RouterLayer[] }).stack;
    const bindings = bindingRoutes();
    const routes = routesOf(stack);
    expect(routes.length).toBeGreaterThan(200);
    const legacy = routes.filter(
      (route) =>
        (route.includes(' /api') || route.startsWith('ROUTER')) &&
        !bindings.has(route) &&
        !NOT_ACTIONS.has(route),
    );
    expect(legacy).toEqual([]);
  });

  it('mounts no function middleware on an /api path beyond the ones named here', async () => {
    const { openApiRouter } = await import('../lib/openapi');
    KNOWN_ROUTERS.set(openApiRouter, 'openApiRouter');
    const stack = (app.router as unknown as { stack: RouterLayer[] }).stack;
    expect(apiMiddlewareOf(stack, apiProbes())).toEqual(API_MIDDLEWARE);
  });

  it('finds a handler mounted with app.use on an /api path', () => {
    const planted = express();
    planted.use('/api/x', authenticate, function plantedHandler(_req, res) {
      res.end();
    });
    const stack = (planted.router as unknown as { stack: RouterLayer[] }).stack;
    expect(apiMiddlewareOf(stack, ['/api/x/y'])).toEqual(['authenticate', 'plantedHandler']);
    // At a prefix none of the probes reaches, it still shows, marked as unplaced
    expect(apiMiddlewareOf(stack, ['/api/elsewhere'])).toEqual([
      '? authenticate',
      '? plantedHandler',
    ]);
  });

  it('names nothing here that the app no longer has', () => {
    const routes = new Set(routesOf((app.router as unknown as { stack: RouterLayer[] }).stack));
    expect([...NOT_ACTIONS].filter((route) => !routes.has(route))).toEqual([]);
  });

  it('finds a route that is no binding, in a nested router or on the app', () => {
    const planted = express();
    const actions = express.Router();
    mountActions(actions, listActions().slice(0, 1));
    planted.use(actions);
    const legacyRouter = express.Router();
    legacyRouter.get('/:id', (_req, res) => res.end());
    planted.use('/api/legacy-things', legacyRouter);
    planted.delete('/api/projects/:projectId/legacy', (_req, res) => res.end());
    const routes = routesOf((planted.router as unknown as { stack: RouterLayer[] }).stack);
    const bindings = bindingRoutes();
    expect(routes.filter((route) => !bindings.has(route))).toEqual([
      'ROUTER ? router',
      'DELETE /api/projects/:projectId/legacy',
    ]);
  });

  it('keeps none of the path rules and lists that served legacy routes', () => {
    expect(Object.keys(tokenScopes)).not.toContain('tokenAllows');
    expect(Object.keys(tokenScopes)).not.toContain('legacyRouteDeletes');
    expect(existsSync(path.join(__dirname, 'legacy-routes.ts'))).toBe(false);
  });
});

describe('a path no route serves', () => {
  let app: Express;

  /**
   * A request to the app with any method.
   * @param method - The HTTP method
   * @param target - The path
   */
  function call(method: string, target: string) {
    return request(app)[method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](
      target,
    );
  }
  let ctx: TestContext;
  let session: string;
  const tokens: string[] = [];

  /**
   * Mint a real token for the context's owner.
   * @param scopes - Its scopes
   */
  async function tokenWith(scopes: readonly string[]): Promise<string> {
    const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
    await prisma.apiToken.create({
      data: {
        userId: ctx.owner.id,
        name: 'no-legacy',
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        prefix: raw.slice(0, 11),
        scopes: [...scopes],
      },
    });
    return `Token ${raw}`;
  }

  beforeAll(async () => {
    app = (await import('../index')).default;
    ctx = await createTestContext(`nolegacy${Date.now()}`);
    session = `Bearer ${ctx.owner.token}`;
    tokens.push(await tokenWith(tokenScopes.TOKEN_SCOPES), await tokenWith(['wiki:read']));
  });

  afterAll(async () => {
    await prisma.apiToken.deleteMany({ where: { userId: ctx.owner.id } });
    await cleanupTestContext(ctx);
  });

  const UNKNOWN: Array<[string, string]> = [
    ['GET', '/api/nothing-here'],
    ['GET', '/api/admin/no-such-thing'],
    ['PATCH', '/api/users/me/no-such-thing'],
    ['DELETE', '/api/notifications/probe'],
    ['GET', '/api/orgs/o1/invites/i1/code'],
    ['PUT', '/api/projects/p1'],
    ['POST', '/api/Admin/users/u1/no-such-thing/'],
  ];

  it.each(UNKNOWN)(
    'answers %s %s with 404 for a token and a session alike',
    async (method, target) => {
      for (const auth of [session, ...tokens]) {
        const res = await call(method, target)
          .set('X-Requested-With', 'XMLHttpRequest')
          .set('Authorization', auth);
        expect(res.status, `${auth.split(' ')[0]} ${method} ${target}`).toBe(404);
        expect(res.body).toEqual({ error: { message: 'Not found' } });
      }
    },
  );

  it.each(UNKNOWN)('asks for credentials on %s %s without any', async (method, target) => {
    const res = await call(method, target).set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('refuses an unknown token there, as on any route', async () => {
    const res = await request(app)
      .get('/api/nothing-here')
      .set('Authorization', `Token tk_${'0'.repeat(48)}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });
});
