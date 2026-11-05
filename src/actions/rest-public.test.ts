import rateLimit from 'express-rate-limit';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { prisma } from '../config/database';
import { require2fa } from '../middleware/require2fa';
import {
  getSiteSettings,
  updateSiteSettings,
} from '../modules/site-settings/site-settings.service';

import { defineAction, definePublicAction } from './define';
import { registerActions } from './registry';

const output = z.looseObject({});
const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const seen: Array<{ userId: unknown; channel: string }> = [];
const guardedHandler = vi.fn(async () => ({ ran: true }));
const order: string[] = [];

// A limiter of its own: the app's limiters skip in tests, which would hide a missing one
const twoPerMinute = rateLimit({
  windowMs: 60_000,
  max: 2,
  message: { error: { message: 'Slow down', code: 'RATE_LIMITED' } },
});

// Registered before src/index.ts loads, so these run behind the real mount and middleware
registerActions([
  definePublicAction({
    name: 'restPublic.open',
    area: 'issues',
    kind: 'read',
    summary: 'A public read',
    input: z.looseObject({}),
    output,
    rest: { method: 'GET', path: '/api/rest-public-test/open', public: true },
    authorize: async () => {},
    handler: async (ctx) => {
      seen.push({ userId: ctx.userId, channel: ctx.channel });
      return { open: true };
    },
  }),
  definePublicAction({
    name: 'restPublic.submit',
    area: 'issues',
    kind: 'write',
    summary: 'A public write',
    input: z.looseObject({ name: z.string() }),
    target: z.looseObject({}),
    output,
    rest: { method: 'POST', path: '/api/rest-public-test/submit', public: true },
    authorize: async () => {},
    handler: async (_ctx, input) => ({ name: input.name }),
  }),
  defineAction({
    name: 'restPublic.closed',
    area: 'issues',
    kind: 'read',
    summary: 'Not public',
    input: z.looseObject({}),
    output,
    rest: { method: 'GET', path: '/api/rest-public-test/closed' },
    authorize: async () => {},
    handler: async () => ({ closed: true }),
  }),
  definePublicAction({
    name: 'restPublic.limited',
    area: 'issues',
    kind: 'read',
    summary: 'A public read behind its own limiter',
    input: z.looseObject({}),
    output,
    rest: {
      method: 'GET',
      path: '/api/rest-public-test/limited',
      public: true,
      rateLimit: twoPerMinute,
    },
    authorize: async () => {},
    handler: async () => ({ limited: false }),
  }),
  defineAction({
    name: 'restPublic.guarded',
    area: 'issues',
    kind: 'read',
    summary: 'Behind its own middleware',
    input: z.looseObject({}),
    output,
    rest: {
      method: 'GET',
      path: '/api/rest-public-test/guarded',
      middleware: [
        (req, res, next) => {
          order.push(`middleware saw ${req.userId ? 'a user' : 'nobody'}`);
          if (req.query.stop) {
            res.status(418).json({ error: { message: 'Stopped' } });
            return;
          }
          next();
        },
      ],
    },
    authorize: async () => {
      order.push('authorize');
    },
    handler: guardedHandler,
  }),
  defineAction({
    name: 'restPublic.needs2fa',
    area: 'issues',
    kind: 'read',
    summary: 'Keeps require2fa on its own route',
    input: z.looseObject({}),
    output,
    rest: { method: 'GET', path: '/api/rest-public-test/needs-2fa', middleware: [require2fa] },
    authorize: async () => {},
    handler: async () => ({ ran: true }),
  }),
]);

// The compiler holds a public action to B9: it has no user to read, and defineAction refuses `public`
definePublicAction({
  name: 'restPublic.typed',
  area: 'issues',
  kind: 'read',
  summary: 'Never registered',
  input: z.looseObject({}),
  output,
  rest: { method: 'GET', path: '/api/rest-public-test/typed', public: true },
  authorize: async (ctx) => {
    // @ts-expect-error a public context has no user id to read
    void ctx.userId.length;
  },
  handler: async () => ({}),
});
defineAction({
  name: 'restPublic.untyped',
  area: 'issues',
  kind: 'read',
  summary: 'Never registered',
  input: z.looseObject({}),
  output,
  // @ts-expect-error a public route is declared with definePublicAction
  rest: { method: 'GET', path: '/api/rest-public-test/untyped', public: true },
  authorize: async () => {},
  handler: async () => ({}),
});

describe('REST adapter, public actions, limiters and route middleware', () => {
  let app: Awaited<typeof import('../index')>['default'];
  let user: Awaited<ReturnType<(typeof import('../test/factory'))['createTestUser']>>;
  let enforcedBefore: boolean;

  beforeAll(async () => {
    app = (await import('../index')).default;
    const { createTestUser } = await import('../test/factory');
    user = await createTestUser();
    enforcedBefore = (await getSiteSettings()).enforce2fa;
  });

  afterAll(async () => {
    await updateSiteSettings({ enforce2fa: enforcedBefore });
    await prisma.auditLog.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  describe('public', () => {
    it('answers a request with no credentials, and the context holds no user', async () => {
      const res = await request(app).get('/api/rest-public-test/open');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ open: true });
      expect(seen.at(-1)).toEqual({ userId: undefined, channel: 'ui' });
    });

    it('does not read a credential that comes with it', async () => {
      const res = await request(app)
        .get('/api/rest-public-test/open')
        .set('Authorization', 'Bearer not-a-token');
      expect(res.status).toBe(200);
      const real = await request(app)
        .get('/api/rest-public-test/open')
        .set('Authorization', `Bearer ${user.token}`);
      expect(real.status).toBe(200);
      expect(seen.at(-1)?.userId).toBeUndefined();
    });

    it('takes a body on a public write', async () => {
      const res = await request(app)
        .post('/api/rest-public-test/submit')
        .set(CSRF)
        .send({ name: 'visitor' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ name: 'visitor' });
    });

    it('leaves a route without the flag behind authentication', async () => {
      const res = await request(app).get('/api/rest-public-test/closed');
      expect(res.status).toBe(401);
    });
  });

  describe('rateLimit', () => {
    it("answers 429 past the limit of the route, with the limiter's own body", async () => {
      const first = await request(app).get('/api/rest-public-test/limited');
      const second = await request(app).get('/api/rest-public-test/limited');
      const third = await request(app).get('/api/rest-public-test/limited');
      expect([first.status, second.status, third.status]).toEqual([200, 200, 429]);
      expect(third.body.error.code).toBe('RATE_LIMITED');
    });
  });

  describe('middleware', () => {
    it('runs after authentication and before authorize, and can answer for the route', async () => {
      order.length = 0;
      guardedHandler.mockClear();
      const stopped = await request(app)
        .get('/api/rest-public-test/guarded?stop=1')
        .set('Authorization', `Bearer ${user.token}`);
      expect(stopped.status).toBe(418);
      expect(order).toEqual(['middleware saw a user']);
      expect(guardedHandler).not.toHaveBeenCalled();

      order.length = 0;
      const through = await request(app)
        .get('/api/rest-public-test/guarded')
        .set('Authorization', `Bearer ${user.token}`);
      expect(through.status).toBe(200);
      expect(order).toEqual(['middleware saw a user', 'authorize']);
    });

    it('does not run for a caller authentication already turned away', async () => {
      order.length = 0;
      const res = await request(app).get('/api/rest-public-test/guarded');
      expect(res.status).toBe(401);
      expect(order).toEqual([]);
    });

    it('keeps the app-level require2fa on a route whose action also names it (the 418 test pins the slot)', async () => {
      await updateSiteSettings({ enforce2fa: true });
      const res = await request(app)
        .get('/api/rest-public-test/needs-2fa')
        .set('Authorization', `Bearer ${user.token}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
      await updateSiteSettings({ enforce2fa: false });
      const off = await request(app)
        .get('/api/rest-public-test/needs-2fa')
        .set('Authorization', `Bearer ${user.token}`);
      expect(off.status).toBe(200);
    });
  });
});
