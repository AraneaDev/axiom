import type { Server } from 'http';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';
import {
  getSiteSettings,
  updateSiteSettings,
} from '../modules/site-settings/site-settings.service';
import { createTestUser, type TestUser } from '../test/factory';
import { listenForRawRequests, rawRequest } from '../test/raw-request';

const REQUIRED = 'TWO_FACTOR_SETUP_REQUIRED';
const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };

describe('require2fa with enforcement on', () => {
  let without2fa: TestUser;
  let with2fa: TestUser;
  let server: Server;
  let enforcedBefore: boolean;

  beforeAll(async () => {
    without2fa = await createTestUser();
    with2fa = await createTestUser();
    await prisma.user.update({ where: { id: with2fa.id }, data: { twoFactorEnabled: true } });
    server = await listenForRawRequests(app);
    enforcedBefore = (await getSiteSettings()).enforce2fa;
    await updateSiteSettings({ enforce2fa: true });
  });

  afterAll(async () => {
    await updateSiteSettings({ enforce2fa: enforcedBefore });
    await new Promise((resolve) => server.close(resolve));
    await prisma.auditLog.deleteMany({ where: { userId: { in: [without2fa.id, with2fa.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [without2fa.id, with2fa.id] } } });
  });

  const bearer = () => `Bearer ${without2fa.token}`;

  it('lets /api/auth/me past the check, where no route answers it yet', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', bearer());
    expect(res.status).toBe(404);
    expect(res.body.error?.code).not.toBe(REQUIRED);
  });

  it.each(['enable', 'verify', 'disable'])('lets them reach the 2FA %s route', async (step) => {
    const res = await request(app)
      .post(`/api/auth/2fa/${step}`)
      .set(CSRF)
      .set('Authorization', bearer())
      .send({ code: '000000' });
    expect(res.body.error?.code).not.toBe(REQUIRED);
  });

  it('lets them refresh and log in, whatever the answer of those routes', async () => {
    for (const path of ['/api/auth/refresh', '/api/auth/login', '/api/auth/register']) {
      const res = await request(app).post(path).set(CSRF).set('Authorization', bearer()).send({});
      expect(res.body.error?.code, path).not.toBe(REQUIRED);
    }
  });

  it('lets them log out', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set(CSRF)
      .set('Authorization', bearer())
      .send({});
    expect(res.body.error?.code).not.toBe(REQUIRED);
    expect(res.status).toBeLessThan(300);
  });

  it('refuses them everything else', async () => {
    const res = await request(app).get('/api/notifications').set('Authorization', bearer());
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe(REQUIRED);
  });

  it('lets a user with 2FA through', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${with2fa.token}`);
    expect(res.status).toBe(200);
  });

  it.each([
    ['upper case', '/api/AUTH/ME'],
    ['a trailing slash', '/api/auth/me/'],
    ['an encoded slash', '/api/auth%2Fme'],
    ['an escaped letter', '/api/auth/m%65'],
    ['a doubled slash', '/api//auth/me'],
    ['a dot segment', '/api/auth/me/..'],
    ['an exempt path in a fragment', '/api/notifications#/auth/me'],
    ['an exempt path in the query', '/api/notifications?x=/auth/me'],
    ['an exempt path as a prefix', '/api/auth/me/x'],
  ])('does not count %s as exempt', async (_name, target) => {
    const res = await rawRequest(server, 'GET', target, bearer());
    expect(res.status, target).toBe(403);
    expect(res.body.error?.code, target).toBe(REQUIRED);
  });
});
