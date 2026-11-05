import { generateSecret, generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { createTestUser, type TestUser } from '../../test/factory';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const PASSWORD = 'testpassword123';

/**
 * A six-digit code that differs from the current one in every digit.
 * @param secret - The TOTP secret
 * @returns The wrong code
 */
function wrongCode(secret: string): string {
  return generateSync({ secret })
    .split('')
    .map((d) => String((Number(d) + 5) % 10))
    .join('');
}

/**
 * The code of ten minutes ago, long outside any tolerance window.
 * @param secret - The TOTP secret
 * @returns The old code
 */
function oldCode(secret: string): string {
  return generateSync({ secret, epoch: Math.floor(Date.now() / 1000) - 600 });
}

const users: TestUser[] = [];

afterAll(async () => {
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe('two-factor codes are checked', () => {
  let user: TestUser;
  let secret: string;

  beforeEach(async () => {
    user = await createTestUser();
    users.push(user);
    secret = generateSecret();
  });

  describe('verify (activates 2FA)', () => {
    beforeEach(async () => {
      await prisma.user.update({ where: { id: user.id }, data: { twoFactorSecret: secret } });
    });

    const verify = (code: string) =>
      request(app)
        .post('/api/auth/2fa/verify')
        .set(CSRF)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ code });

    it.each([
      ['a wrong code', wrongCode],
      ['an old code', oldCode],
    ])('refuses %s with 400 and leaves 2FA off', async (_label, make) => {
      const res = await verify(make(secret));
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe('Invalid 2FA code');
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.twoFactorEnabled).toBe(false);
    });

    it('accepts the right code and turns 2FA on', async () => {
      const res = await verify(generateSync({ secret }));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ enabled: true });
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.twoFactorEnabled).toBe(true);
    });
  });

  describe('with 2FA on', () => {
    beforeEach(async () => {
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: secret, twoFactorEnabled: true },
      });
    });

    const login = (twoFactorCode: string) =>
      request(app)
        .post('/api/auth/login')
        .set(CSRF)
        .send({ login: user.email, password: PASSWORD, twoFactorCode });

    const disable = (code: string) =>
      request(app)
        .post('/api/auth/2fa/disable')
        .set(CSRF)
        .set('Authorization', `Bearer ${user.token}`)
        .send({ code });

    it.each([
      ['a wrong code', wrongCode],
      ['an old code', oldCode],
    ])('login refuses %s with 401 and issues no tokens', async (_label, make) => {
      const res = await login(make(secret));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('INVALID_TWO_FACTOR');
      expect(res.body.accessToken).toBeUndefined();
    });

    it('login accepts the right code', async () => {
      const res = await login(generateSync({ secret }));
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
    });

    it.each([
      ['a wrong code', wrongCode],
      ['an old code', oldCode],
    ])('disable refuses %s with 401 and leaves 2FA on', async (_label, make) => {
      const res = await disable(make(secret));
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid 2FA code');
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.twoFactorEnabled).toBe(true);
      expect(stored.twoFactorSecret).toBe(secret);
    });

    it('disable accepts the right code and clears the secret', async () => {
      const res = await disable(generateSync({ secret }));
      expect(res.status).toBe(200);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored.twoFactorEnabled).toBe(false);
      expect(stored.twoFactorSecret).toBeNull();
    });
  });
});
