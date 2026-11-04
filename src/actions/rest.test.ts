import crypto from 'crypto';
import type { Server } from 'http';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { prisma } from '../config/database';
import { getRequestContext } from '../lib/request-context';
import { TOKEN_SCOPES } from '../middleware/token-scopes';
import { listenForRawRequests, rawRequest } from '../test/raw-request';

import { defineAction, type ActionContext, type ActionDef } from './define';
import * as execute from './execute';
import { registerActions } from './registry';
import { mountActions } from './rest';

const output = z.looseObject({});
const noAuthorize = async () => {};
const seenContexts: ActionContext[] = [];
const guardedAuthorize = vi.fn(async () => {});
const guardedHandler = vi.fn(async () => ({ ran: true }));

/**
 * One action per path, read back by its answer.
 * @param name - The action's name
 * @param area - Its scope area
 * @param path - Its REST path
 */
function reader(name: string, area: 'issues' | 'wiki', path: string) {
  return defineAction({
    name,
    area,
    kind: 'read',
    summary: name,
    input: z.looseObject({}),
    output,
    rest: { method: 'GET', path },
    authorize: noAuthorize,
    handler: async () => ({ action: name }),
  });
}

// Registered before src/index.ts loads, so these run behind the real mount and middleware
registerActions([
  defineAction({
    name: 'rest.create',
    area: 'issues',
    kind: 'write',
    summary: 'Default POST status',
    input: z.object({ id: z.coerce.number(), from: z.string() }),
    output,
    rest: { method: 'POST', path: '/api/rest-test/things/:id' },
    authorize: noAuthorize,
    handler: async (_ctx, input) => input,
  }),
  defineAction({
    name: 'rest.accept',
    area: 'issues',
    kind: 'write',
    summary: 'Declared status',
    input: z.looseObject({}),
    output,
    rest: { method: 'POST', path: '/api/rest-test/accepted', status: 202 },
    authorize: noAuthorize,
    handler: async () => ({ ok: true }),
  }),
  defineAction({
    name: 'rest.update',
    area: 'issues',
    kind: 'write',
    summary: 'Default status of other methods',
    input: z.looseObject({}),
    output,
    rest: { method: 'PATCH', path: '/api/rest-test/things/:id' },
    authorize: noAuthorize,
    handler: async () => ({ ok: true }),
  }),
  defineAction({
    name: 'rest.delete',
    area: 'issues',
    kind: 'write',
    summary: 'No body',
    input: z.looseObject({}),
    output: z.undefined(),
    rest: { method: 'DELETE', path: '/api/rest-test/things/:id' },
    authorize: noAuthorize,
    handler: async () => undefined,
  }),
  defineAction({
    name: 'rest.deleteWithBody',
    area: 'issues',
    kind: 'write',
    summary: 'A body on DELETE stays a 200',
    input: z.looseObject({}),
    output,
    rest: { method: 'DELETE', path: '/api/rest-test/kept/:id' },
    authorize: noAuthorize,
    handler: async () => ({ deleted: 1 }),
  }),
  reader('rest.bulk', 'issues', '/api/rest-test/x/bulk'),
  reader('rest.byId', 'issues', '/api/rest-test/x/:id'),
  defineAction({
    name: 'rest.context',
    area: 'issues',
    kind: 'read',
    summary: 'Hands back who ran it',
    input: z.looseObject({}),
    output,
    rest: { method: 'GET', path: '/api/rest-test/context' },
    authorize: noAuthorize,
    handler: async (ctx) => {
      seenContexts.push(ctx);
      return { channel: getRequestContext()?.channel };
    },
  }),
  defineAction({
    name: 'rest.raw',
    area: 'issues',
    kind: 'read',
    summary: 'Answers through ctx.http',
    input: z.looseObject({}),
    output: z.undefined(),
    rest: { method: 'GET', path: '/api/rest-test/raw', raw: true },
    authorize: noAuthorize,
    handler: async (ctx) => {
      ctx.http?.res.status(200).type('text/plain').send(ctx.http.req.originalUrl);
    },
  }),
  // The legacy table refuses every token on /api/admin, and lets wiki scopes through on /api/wiki
  reader('rest.legacyRefuses', 'issues', '/api/admin/rest-test'),
  reader('rest.legacyAllows', 'issues', '/api/wiki/rest-test'),
  // A path a legacy router owns: its router.use(authenticate) and requireTeamMember must not run
  reader('rest.shadowsLegacy', 'issues', '/api/teams/:teamId'),
  // /api/admin/rest-guard%2Fx routes to the legacy admin router, and normalizes to this
  defineAction({
    name: 'rest.guard',
    area: 'issues',
    kind: 'write',
    summary: 'A pattern a respelled legacy path normalizes into',
    input: z.looseObject({}),
    output,
    rest: { method: 'PATCH', path: '/api/admin/rest-guard/:id' },
    authorize: noAuthorize,
    handler: async () => ({ ok: true }),
  }),
  // Beside the legacy PATCH /api/projects/:projectId, which a fragment can reach
  defineAction({
    name: 'rest.probe',
    area: 'issues',
    kind: 'write',
    summary: 'A binding that the spelling of a legacy path normalizes into',
    input: z.looseObject({}),
    output,
    rest: { method: 'PATCH', path: '/api/projects/:projectId/probe-labels' },
    authorize: noAuthorize,
    handler: async () => ({ action: 'rest.probe' }),
  }),
  defineAction({
    name: 'rest.scopePath',
    area: 'issues',
    kind: 'write',
    summary: 'Through one scope path',
    input: z.looseObject({}),
    output,
    rest: { method: 'POST', path: '/api/wiki/rest-scope-path' },
    authorize: guardedAuthorize,
    handler: guardedHandler,
  }),
  defineAction({
    name: 'rest.tokenBlocked',
    area: 'orgs',
    kind: 'write',
    summary: 'A normal action for the browser, refused to every token',
    input: z.looseObject({}),
    output,
    tokenBlocked: true,
    rest: { method: 'POST', path: '/api/rest-test/token-blocked' },
    authorize: noAuthorize,
    handler: async () => ({ ok: true }),
  }),
]);

let app: Express;
let userId: string;
let jwtHeader: string;
const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

/**
 * Mint a real token, so the requests pass through authenticate.
 * @param scopes - The token's scopes
 */
async function tokenWith(scopes: string[]): Promise<string> {
  const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({
    data: {
      userId,
      name: 'rest-test',
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
      prefix: raw.slice(0, 11),
      scopes,
    },
  });
  return `Token ${raw}`;
}

describe('REST adapter', () => {
  beforeAll(async () => {
    app = (await import('../index')).default;
    const { createTestUser } = await import('../test/factory');
    const user = await createTestUser();
    userId = user.id;
    jwtHeader = `Bearer ${user.token}`;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.apiToken.deleteMany({ where: { userId } });
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  describe('input and response', () => {
    it('serves a registered action at its REST path with the right status', async () => {
      const created = await request(app)
        .post('/api/rest-test/things/7')
        .set(CSRF)
        .set('Authorization', jwtHeader)
        .send({ from: 'body' });
      expect(created.status).toBe(201);
      // The action's schema coerces the param, the adapter passes it on as text
      expect(created.body).toEqual({ id: 7, from: 'body' });

      const accepted = await request(app)
        .post('/api/rest-test/accepted')
        .set(CSRF)
        .set('Authorization', jwtHeader);
      expect(accepted.status).toBe(202);

      const updated = await request(app)
        .patch('/api/rest-test/things/7')
        .set(CSRF)
        .set('Authorization', jwtHeader);
      expect(updated.status).toBe(200);
      expect(updated.body).toEqual({ ok: true });
    });

    it('lets params win over the body, and ignores the query on a write (R14)', async () => {
      const res = await request(app)
        .post('/api/rest-test/things/7?id=8&from=query')
        .set(CSRF)
        .set('Authorization', jwtHeader)
        .send({ id: 9, from: 'body' });
      expect(res.body).toEqual({ id: 7, from: 'body' });

      const queried = await request(app)
        .post('/api/rest-test/things/7?from=query')
        .set(CSRF)
        .set('Authorization', jwtHeader);
      expect(queried.status).toBe(400);
      expect(queried.body.error.message).toContain('from');
    });

    it('answers invalid input through the error handler', async () => {
      const invalid = await request(app)
        .post('/api/rest-test/things/7')
        .set(CSRF)
        .set('Authorization', jwtHeader)
        .send({});
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.message).toContain('from');
    });

    it('returns 204 for a DELETE without a body', async () => {
      const res = await request(app)
        .delete('/api/rest-test/things/7')
        .set(CSRF)
        .set('Authorization', jwtHeader);
      expect(res.status).toBe(204);
      expect(res.text).toBe('');

      const kept = await request(app)
        .delete('/api/rest-test/kept/7')
        .set(CSRF)
        .set('Authorization', jwtHeader);
      expect(kept.status).toBe(200);
      expect(kept.body).toEqual({ deleted: 1 });
    });

    it('lets a raw action answer for itself, and only a raw one sees the request', async () => {
      const raw = await request(app).get('/api/rest-test/raw?a=1').set('Authorization', jwtHeader);
      expect(raw.status).toBe(200);
      expect(raw.type).toBe('text/plain');
      expect(raw.text).toBe('/api/rest-test/raw?a=1');

      seenContexts.length = 0;
      await request(app).get('/api/rest-test/context').set('Authorization', jwtHeader);
      expect(seenContexts[0].http).toBeUndefined();
    });
  });

  describe('routing', () => {
    it('keeps static segments ahead of params', async () => {
      const bulk = await request(app).get('/api/rest-test/x/bulk').set('Authorization', jwtHeader);
      expect(bulk.body).toEqual({ action: 'rest.bulk' });

      const byId = await request(app).get('/api/rest-test/x/12').set('Authorization', jwtHeader);
      expect(byId.body).toEqual({ action: 'rest.byId' });
    });

    it('runs ahead of legacy routers, so their middleware never sees a migrated path', async () => {
      // The legacy route answers 404 for a team that doesn't exist
      const res = await request(app).get('/api/teams/no-such-team').set('Authorization', jwtHeader);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ action: 'rest.shadowsLegacy' });
    });

    it('leaves paths without a binding to the legacy routers', async () => {
      const res = await request(app)
        .get('/api/teams/no-such-team/activity')
        .set('Authorization', jwtHeader);
      expect(res.status).toBe(404);
      expect(res.body.action).toBeUndefined();
    });

    it('requires authentication on every binding', async () => {
      const res = await request(app).get('/api/rest-test/x/bulk');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_REQUIRED');
    });
  });

  describe('mountActions', () => {
    const route = (method: 'GET' | 'POST', path: string): ActionDef =>
      defineAction({
        name: `throwaway ${method} ${path}`,
        area: 'issues',
        kind: 'read',
        summary: 'Throwaway, never registered',
        input: z.object({}),
        output,
        rest: { method, path },
        authorize: noAuthorize,
        handler: async () => ({}),
      });
    const mount = (...defs: ActionDef[]) => mountActions(express.Router(), defs);

    it('throws on a duplicate method and path, however its params are named or cased', () => {
      expect(() => mount(route('GET', '/x/:id'), route('GET', '/x/:id'))).toThrow('unreachable');
      expect(() => mount(route('GET', '/x/:id'), route('GET', '/X/:other'))).toThrow('unreachable');
    });

    it('throws on a static path after the param path that captures it', () => {
      expect(() => mount(route('GET', '/x/:id'), route('GET', '/x/bulk'))).toThrow('unreachable');
    });

    it('accepts paths that leave each other reachable', () => {
      expect(() => mount(route('GET', '/x/bulk'), route('GET', '/x/:id'))).not.toThrow();
      expect(() => mount(route('GET', '/x/:id'), route('POST', '/x/bulk'))).not.toThrow();
      expect(() => mount(route('GET', '/x/:id'), route('GET', '/x/:id/y'))).not.toThrow();
      expect(() => mount(route('GET', '/a/:b/c'), route('GET', '/a/d/:e'))).not.toThrow();
    });

    it('throws on a path it cannot compare', () => {
      expect(() => mount(route('GET', '/x/*rest'))).toThrow('Unsupported segment');
    });
  });

  describe('token scope on registry routes', () => {
    it('lets the adapter, not the legacy path table, decide token scope on registry routes', async () => {
      const issues = await tokenWith(['issues:read']);
      const wiki = await tokenWith(['wiki:read']);

      // The legacy table refuses every token on /api/admin; issues:read is what the action asks
      const passes = await request(app).get('/api/admin/rest-test').set('Authorization', issues);
      expect(passes.status).toBe(200);
      expect(passes.body).toEqual({ action: 'rest.legacyRefuses' });

      // The legacy table lets wiki:read through on /api/wiki; the action is in area issues
      const refused = await request(app).get('/api/wiki/rest-test').set('Authorization', wiki);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('SCOPE');
    });

    it('still refuses a token the legacy table refuses on a path without a binding', async () => {
      const token = await tokenWith([...TOKEN_SCOPES]);
      const res = await request(app).get('/api/admin/users').set('Authorization', token);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');
    });

    it.each([
      ['an encoded slash', '/api/admin/rest-guard%2Fx'],
      ['a doubled slash', '/api/admin/rest-guard//x'],
      ['an encoded static segment', '/api/%61dmin/rest-guard/x'],
    ])(
      'does not skip the legacy table for %s, which Express routes elsewhere',
      async (_name, path) => {
        const token = await tokenWith(['issues:write']);
        const res = await request(app).patch(path).set(CSRF).set('Authorization', token);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('SCOPE');
      },
    );

    it('leaves the scope to the action for a path Express routes to the binding', async () => {
      const token = await tokenWith(['issues:write']);
      const res = await request(app)
        .patch('/api/admin/rest-guard/a%20b')
        .set(CSRF)
        .set('Authorization', token);
      expect(res.status).toBe(200);
    });

    describe('with a fragment, which Express routes without', () => {
      let server: Server;
      let projectId: string;
      let cleanup: () => Promise<void>;

      beforeAll(async () => {
        const { createTestContext, cleanupTestContext } = await import('../test/factory');
        const ctx = await createTestContext(`rest-${Date.now()}`);
        projectId = ctx.projectId;
        cleanup = () => cleanupTestContext(ctx);
        server = await listenForRawRequests(app);
      });

      afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
        await cleanup();
      });

      it('does not skip the legacy table when the fragment spells a binding', async () => {
        const token = await tokenWith(['issues:write']);
        const res = await rawRequest(
          server,
          'PATCH',
          `/api/projects/${projectId}#/probe-labels`,
          token,
          { name: 'renamed through a fragment' },
        );
        expect(res.status).toBe(403);
        expect(res.body.error?.code).toBe('SCOPE');
        const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
        expect(project.name).not.toBe('renamed through a fragment');
      });

      it('still reaches the binding when a fragment follows its own path', async () => {
        const token = await tokenWith(['issues:write']);
        const res = await rawRequest(
          server,
          'PATCH',
          `/api/projects/${projectId}/probe-labels#x`,
          token,
        );
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ action: 'rest.probe' });
      });
    });

    it('builds the context from the session or the token', async () => {
      seenContexts.length = 0;
      const session = await request(app)
        .get('/api/rest-test/context')
        .set('Authorization', jwtHeader);
      expect(session.body).toEqual({ channel: 'ui' });
      expect(seenContexts[0]).toEqual({ userId, channel: 'ui' });

      const token = await tokenWith(['issues:read']);
      const viaToken = await request(app).get('/api/rest-test/context').set('Authorization', token);
      expect(viaToken.body).toEqual({ channel: 'rest-token' });
      expect(seenContexts[1]).toEqual({
        userId,
        apiTokenId: expect.any(String),
        apiTokenName: 'rest-test',
        scopes: ['issues:read'],
        channel: 'rest-token',
      });
    });

    it('sends a wiki-only token and a browser session down the same scope path', async () => {
      const spy = vi.spyOn(execute, 'executeAction');
      guardedAuthorize.mockClear();
      guardedHandler.mockClear();
      const wikiOnly = await tokenWith(['wiki:read', 'wiki:write']);

      // The legacy table would let this token through on /api/wiki
      const refused = await request(app)
        .post('/api/wiki/rest-scope-path')
        .set(CSRF)
        .set('Authorization', wikiOnly)
        .send({ a: 1 });
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('SCOPE');
      expect(guardedAuthorize).not.toHaveBeenCalled();
      expect(guardedHandler).not.toHaveBeenCalled();

      const allowed = await request(app)
        .post('/api/wiki/rest-scope-path')
        .set(CSRF)
        .set('Authorization', jwtHeader)
        .send({ a: 1 });
      expect(allowed.status).toBe(201);
      expect(guardedAuthorize).toHaveBeenCalledTimes(1);
      expect(guardedHandler).toHaveBeenCalledTimes(1);

      expect(spy.mock.calls.map(([name, input, ctx]) => [name, input, ctx.channel])).toEqual([
        ['rest.scopePath', { a: 1 }, 'rest-token'],
        ['rest.scopePath', { a: 1 }, 'ui'],
      ]);
    });

    it('refuses a tokenBlocked action to any token and runs it for a session', async () => {
      const token = await tokenWith([...TOKEN_SCOPES]);
      const refused = await request(app)
        .post('/api/rest-test/token-blocked')
        .set(CSRF)
        .set('Authorization', token);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe('SCOPE');

      const allowed = await request(app)
        .post('/api/rest-test/token-blocked')
        .set(CSRF)
        .set('Authorization', jwtHeader);
      expect(allowed.status).toBe(201);
    });
  });
});
