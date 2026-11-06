import { createGuardrails, generateSecret, generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { decryptSecret, encryptSecret, secretContext } from '../../lib/secret-box';
import { createTestUser, type TestUser } from '../../test/factory';
import { logger } from '../../utils/logger';

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

/**
 * A TOTP secret as the database keeps it: sealed to its user.
 * @param userId - Its user
 * @param secret - The plain TOTP secret
 * @returns The stored value
 */
function sealed(userId: string, secret: string): string {
  return encryptSecret(secret, secretContext('user', 'twoFactorSecret', userId));
}

/**
 * The plain TOTP secret behind a stored value.
 * @param userId - Its user
 * @param stored - The stored value
 * @returns The plain secret
 */
function opened(userId: string, stored: string | null): string {
  return decryptSecret(stored ?? '', secretContext('user', 'twoFactorSecret', userId));
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
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: sealed(user.id, secret) },
      });
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
        data: { twoFactorSecret: sealed(user.id, secret), twoFactorEnabled: true },
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
      expect(opened(user.id, stored.twoFactorSecret)).toBe(secret);
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

describe('a two-factor code is accepted once', () => {
  let user: TestUser;
  let secret: string;

  beforeEach(async () => {
    user = await createTestUser();
    users.push(user);
    secret = generateSecret();
  });

  const login = (twoFactorCode: string) =>
    request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ login: user.email, password: PASSWORD, twoFactorCode });

  const authed = (path: string, code: string) =>
    request(app).post(path).set(CSRF).set('Authorization', `Bearer ${user.token}`).send({ code });

  const enable = () =>
    prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: sealed(user.id, secret), twoFactorEnabled: true },
    });

  it('login refuses the code a login already used', async () => {
    await enable();
    const code = generateSync({ secret });
    expect((await login(code)).status).toBe(200);
    const again = await login(code);
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('INVALID_TWO_FACTOR');
    expect(again.body.accessToken).toBeUndefined();
  });

  it('verify refuses the code a verify already used', async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: sealed(user.id, secret) },
    });
    const code = generateSync({ secret });
    expect((await authed('/api/auth/2fa/verify', code)).status).toBe(200);
    const again = await authed('/api/auth/2fa/verify', code);
    expect(again.status).toBe(400);
    expect(again.body.error.message).toBe('Invalid 2FA code');
  });

  it('a login refuses the code that turned 2FA on', async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: sealed(user.id, secret) },
    });
    const code = generateSync({ secret });
    expect((await authed('/api/auth/2fa/verify', code)).status).toBe(200);
    expect((await login(code)).status).toBe(401);
  });

  it('disable refuses the code a login already used, and 2FA stays on', async () => {
    await enable();
    const code = generateSync({ secret });
    expect((await login(code)).status).toBe(200);
    const again = await authed('/api/auth/2fa/disable', code);
    expect(again.status).toBe(401);
    expect(again.body.error.message).toBe('Invalid 2FA code');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.twoFactorEnabled).toBe(true);
    expect(opened(user.id, stored.twoFactorSecret)).toBe(secret);
  });

  it('refuses the code of the next period, which only a clock ahead of the server would show', async () => {
    await enable();
    const next = generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
    expect((await login(next)).status).toBe(401);
  });
});

describe('a 2FA secret that cannot be opened', () => {
  let user: TestUser;
  let secret: string;

  beforeEach(async () => {
    user = await createTestUser();
    users.push(user);
    secret = generateSecret();
  });

  const login = (twoFactorCode: string) =>
    request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ login: user.email, password: PASSWORD, twoFactorCode });

  it.each([
    ['sealed to another user', (other: string, s: string) => sealed(other, s), 'auth-failed'],
    ['that is not base32', () => 'not a base32 secret', 'plaintext-unusable'],
    ['damaged', () => 'enc:v1:00000000:a:b', 'malformed'],
  ])(
    'login answers 500 TWO_FACTOR_UNREADABLE for a secret %s, logs the reason, never the value',
    async (_label, store, reason) => {
      const stored = store(`${user.id}x`, secret);
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: stored, twoFactorEnabled: true },
      });
      const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      try {
        const res = await login(generateSync({ secret }));
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('TWO_FACTOR_UNREADABLE');
        expect(res.body.accessToken).toBeUndefined();
        const body = JSON.stringify(res.body);
        const logged = JSON.stringify(error.mock.calls);
        expect(logged).toContain(user.id);
        expect(logged).toContain(reason);
        for (const value of [secret, stored]) {
          expect(body).not.toContain(value);
          expect(logged).not.toContain(value);
        }
      } finally {
        error.mockRestore();
      }
    },
  );

  it('disable answers the same and leaves 2FA on', async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: sealed(`${user.id}x`, secret), twoFactorEnabled: true },
    });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const res = await request(app)
      .post('/api/auth/2fa/disable')
      .set(CSRF)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ code: generateSync({ secret }) });
    error.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('TWO_FACTOR_UNREADABLE');
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.twoFactorEnabled).toBe(true);
  });
});

describe('a 2FA secret still in plain text', () => {
  let user: TestUser;
  let secret: string;

  beforeEach(async () => {
    user = await createTestUser();
    users.push(user);
    secret = generateSecret();
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

  const storedSecret = async () =>
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).twoFactorSecret;

  it('login accepts the right code once and seals the secret, logging without the value', async () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    try {
      const res = await login(generateSync({ secret }));
      expect(res.status).toBe(200);
      expect(typeof res.body.accessToken).toBe('string');
      const stored = await storedSecret();
      expect(stored!.startsWith('enc:v1:')).toBe(true);
      expect(opened(user.id, stored)).toBe(secret);
      const logged = JSON.stringify(info.mock.calls);
      expect(logged).toContain('sealed');
      expect(logged).toContain(user.id);
      expect(logged).not.toContain(secret);
    } finally {
      info.mockRestore();
    }
  });

  it('login refuses a wrong code with 401 and leaves the secret as it was', async () => {
    const res = await login(wrongCode(secret));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TWO_FACTOR');
    expect(await storedSecret()).toBe(secret);
  });
});

describe('verify on a pending setup that cannot be opened', () => {
  it('answers TWO_FACTOR_UNREADABLE and says to start the setup again', async () => {
    const user = await createTestUser();
    users.push(user);
    const secret = generateSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: sealed(`${user.id}x`, secret) },
    });
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const res = await request(app)
      .post('/api/auth/2fa/verify')
      .set(CSRF)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ code: generateSync({ secret }) });
    error.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('TWO_FACTOR_UNREADABLE');
    expect(res.body.error.message).toMatch(/start .*setup again/i);
    expect(res.body.error.message).not.toMatch(/administrator/i);
  });
});

describe('a 10-byte secret from before the otplib 13 upgrade', () => {
  let user: TestUser;
  let secret: string;
  const legacy = createGuardrails({ MIN_SECRET_BYTES: 10 });
  const codeOf = (s: string) => generateSync({ secret: s, guardrails: legacy });

  beforeEach(async () => {
    user = await createTestUser();
    users.push(user);
    secret = generateSecret({ length: 10 });
  });

  const login = (twoFactorCode: string) =>
    request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ login: user.email, password: PASSWORD, twoFactorCode });

  const authed = (path: string, code: string) =>
    request(app).post(path).set(CSRF).set('Authorization', `Bearer ${user.token}`).send({ code });

  it('is 10 bytes', () => {
    expect(secret).toHaveLength(16);
  });

  it.each([
    ['sealed', (id: string, s: string) => sealed(id, s)],
    ['plain', (_id: string, s: string) => s],
  ])(
    'login accepts the right code for a %s one and refuses it a second time',
    async (_l, store) => {
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: store(user.id, secret), twoFactorEnabled: true },
      });
      const code = codeOf(secret);
      expect((await login(code)).status).toBe(200);
      const again = await login(code);
      expect(again.status).toBe(401);
      expect(again.body.error.code).toBe('INVALID_TWO_FACTOR');
    },
  );

  it('login refuses a wrong code with 401', async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: sealed(user.id, secret), twoFactorEnabled: true },
    });
    const wrong = codeOf(secret)
      .split('')
      .map((d) => String((Number(d) + 5) % 10))
      .join('');
    const res = await login(wrong);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_TWO_FACTOR');
  });

  it('verify accepts the right code for a pending setup', async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: sealed(user.id, secret) },
    });
    const res = await authed('/api/auth/2fa/verify', codeOf(secret));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
  });

  it('disable accepts the right code and clears the secret', async () => {
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: sealed(user.id, secret), twoFactorEnabled: true },
    });
    const res = await authed('/api/auth/2fa/disable', codeOf(secret));
    expect(res.status).toBe(200);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.twoFactorSecret).toBeNull();
  });
});

describe('a secret too short to use, or a code of the wrong length', () => {
  let user: TestUser;

  beforeEach(async () => {
    user = await createTestUser();
    users.push(user);
  });

  it.each([
    ['plain', (_id: string, s: string) => s, 'plaintext-unusable'],
    ['sealed', (id: string, s: string) => sealed(id, s), 'secret-unusable'],
  ])(
    'login answers TWO_FACTOR_UNREADABLE for a %s 5-byte secret, never a generic 500',
    async (_l, store, reason) => {
      await prisma.user.update({
        where: { id: user.id },
        data: { twoFactorSecret: store(user.id, 'JBSWY3DP'), twoFactorEnabled: true },
      });
      const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      try {
        const res = await request(app)
          .post('/api/auth/login')
          .set(CSRF)
          .send({ login: user.email, password: PASSWORD, twoFactorCode: '123456' });
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('TWO_FACTOR_UNREADABLE');
        expect(JSON.stringify(error.mock.calls)).toContain(reason);
      } finally {
        error.mockRestore();
      }
    },
  );

  it('verify refuses a code that is not six digits with 400, not a 500', async () => {
    const secret = generateSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: sealed(user.id, secret) },
    });
    const res = await request(app)
      .post('/api/auth/2fa/verify')
      .set(CSRF)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ code: '12345' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Invalid 2FA code');
  });
});
