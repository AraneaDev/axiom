/**
 * Auth, health and site settings as registry actions (plan 4, task 5): the routes the old routers
 * served, who may call them, and that no token reaches the ones meant for a person.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LEGACY_ROUTES } from '../../actions/legacy-routes';
import { listActions } from '../../actions/registry';
import { mountActions } from '../../actions/rest';
import app from '../../index';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import { authPost } from '../../test/helpers';
import { tokenHeaderFor } from '../../test/mcp-client';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

/** Every route the old routers of this group served, with the action that serves it now */
const MIGRATED: Array<[method: string, path: string, action: string]> = [
  ['POST', '/api/auth/register', 'auth.register'],
  ['POST', '/api/auth/login', 'auth.login'],
  ['POST', '/api/auth/refresh', 'auth.refresh'],
  ['POST', '/api/auth/logout', 'auth.logout'],
  ['POST', '/api/auth/forgot-password', 'auth.forgotPassword'],
  ['POST', '/api/auth/reset-password', 'auth.resetPassword'],
  ['POST', '/api/auth/2fa/enable', 'auth.twoFactorEnable'],
  ['POST', '/api/auth/2fa/verify', 'auth.twoFactorVerify'],
  ['POST', '/api/auth/2fa/disable', 'auth.twoFactorDisable'],
  ['GET', '/api/health', 'health.check'],
  ['GET', '/api/health/metrics', 'health.metrics'],
  ['GET', '/api/site-settings', 'siteSettings.get'],
  ['PUT', '/api/site-settings', 'siteSettings.update'],
];

describe('the route table of the platform group', () => {
  beforeAll(() => {
    expect(app).toBeDefined();
  });

  it('serves each route the old routers had from the registry action named for it', () => {
    const served = new Map(
      listActions().map((def) => [`${def.rest?.method} ${def.rest?.path}`, def.name]),
    );
    const lost = MIGRATED.filter(
      ([method, path, action]) => served.get(`${method} ${path}`) !== action,
    );
    expect(lost).toEqual([]);
  });

  it('mounts static paths ahead of the param paths that would capture them', () => {
    expect(() => mountActions(express.Router(), listActions())).not.toThrow();
  });

  it('leaves no legacy route behind', () => {
    expect(LEGACY_ROUTES).toEqual([]);
  });

  it('keeps every one of them out of reach of a token', () => {
    const open = MIGRATED.map(([, , action]) =>
      listActions().find((d) => d.name === action),
    ).filter((def) => !def?.uiOnly);
    expect(open).toEqual([]);
  });

  it('opens to anyone only what was open before', () => {
    const open = listActions()
      .filter((def) => def.rest?.public && MIGRATED.some(([, , name]) => name === def.name))
      .map((def) => def.name)
      .sort();
    expect(open).toEqual([
      'auth.forgotPassword',
      'auth.login',
      'auth.refresh',
      'auth.register',
      'auth.resetPassword',
      'health.check',
      'health.metrics',
      'siteSettings.get',
    ]);
  });
});

describe('the platform group over REST', () => {
  let ctx: TestContext;
  let tokenHeader: string;

  beforeAll(async () => {
    ctx = await createTestContext('platform5');
    tokenHeader = await tokenHeaderFor(
      ctx.owner,
      ['admin:write', 'issues:write'],
      'platform-agent',
    );
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('answers the health check with no credential', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect((await request(app).get('/api/health/metrics')).body.totalRequests).toBeTypeOf('number');
  });

  it('answers the site settings with no credential and keeps the write for a platform admin', async () => {
    expect((await request(app).get('/api/site-settings')).status).toBe(200);
    const anonymous = await request(app).put('/api/site-settings').set(XHR).send({});
    expect(anonymous.status).toBe(401);
    const member = await request(app)
      .put('/api/site-settings')
      .set(XHR)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ heroTitle: 'Nope' });
    expect(member.status).toBe(403);
    expect(member.body.error.code).toBe('FORBIDDEN');
  });

  it('refuses a token on the write and on the session routes', async () => {
    const put = await request(app)
      .put('/api/site-settings')
      .set(XHR)
      .set('Authorization', tokenHeader)
      .send({});
    expect(put.status).toBe(403);
    const logout = await request(app)
      .post('/api/auth/logout')
      .set(XHR)
      .set('Authorization', tokenHeader);
    expect(logout.status).toBe(403);
  });

  it('asks a session for logout and the 2FA routes, and the CSRF header for all of them', async () => {
    for (const path of ['/api/auth/logout', '/api/auth/2fa/enable', '/api/auth/2fa/verify']) {
      expect((await request(app).post(path).set(XHR)).status).toBe(401);
    }
    const noCsrf = await request(app)
      .post('/api/auth/login')
      .send({ login: 'nobody', password: 'x' });
    expect(noCsrf.status).toBe(403);
  });

  it('ends a session with a 204, with or without a body', async () => {
    expect((await authPost('/api/auth/logout', ctx.owner.token)).status).toBe(204);
    expect((await authPost('/api/auth/logout', ctx.owner.token, {})).status).toBe(204);
  });

  it('keeps the login answer: 200 with the tokens, 401 on a wrong password, 400 on no body', async () => {
    const wrong = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: ctx.owner.email, password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    const empty = await request(app).post('/api/auth/login').set(XHR);
    expect(empty.status).toBe(400);
  });
});
