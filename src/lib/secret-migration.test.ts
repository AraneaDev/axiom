import { randomBytes } from 'node:crypto';

import { generateSecret, generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';
import { createTestUser, type TestUser } from '../test/factory';

import { decryptSecret, isEncrypted, needsReencrypt, secretContext } from './secret-box';
import { ENCRYPTED_COLUMNS, encryptPlainSecrets } from './secret-migration';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const PASSWORD = 'testpassword123';
const original = { ...process.env };
const users: TestUser[] = [];

const contextOf = (userId: string) => secretContext('user', 'twoFactorSecret', userId);

async function newUser(): Promise<TestUser> {
  const user = await createTestUser();
  users.push(user);
  return user;
}

async function storedSecret(userId: string): Promise<string | null> {
  const row = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { twoFactorSecret: true },
  });
  return row.twoFactorSecret;
}

// The box reads its keys once through env, so another key needs a fresh module graph
async function withKeys<T>(
  current: string,
  previous: string | undefined,
  run: (modules: {
    box: typeof import('./secret-box');
    migration: typeof import('./secret-migration');
    logger: (typeof import('../utils/logger'))['logger'];
  }) => Promise<T>,
): Promise<T> {
  vi.resetModules();
  vi.doMock('../config/load-env', () => ({}));
  process.env = { ...original, AXIOM_ENCRYPTION_KEY: current };
  if (previous) process.env.AXIOM_ENCRYPTION_KEY_PREVIOUS = previous;
  else delete process.env.AXIOM_ENCRYPTION_KEY_PREVIOUS;
  const box = await import('./secret-box');
  const migration = await import('./secret-migration');
  const { logger } = await import('../utils/logger');
  const database = await import('../config/database');
  try {
    return await run({ box, migration, logger });
  } finally {
    await database.prisma.$disconnect();
  }
}

afterEach(() => {
  process.env = { ...original };
  vi.resetModules();
  vi.doUnmock('../config/load-env');
  vi.restoreAllMocks();
});

afterAll(async () => {
  const ids = users.map((u) => u.id);
  await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
  await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe('plain 2FA secrets are encrypted in place', () => {
  it('encrypts a plain secret, which still verifies a code at login, and a second run changes nothing', async () => {
    const user = await newUser();
    const secret = generateSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: secret, twoFactorEnabled: true },
    });

    const first = await encryptPlainSecrets();
    expect(first.twoFactor).toBeGreaterThanOrEqual(1);

    const stored = await storedSecret(user.id);
    expect(stored).not.toBeNull();
    expect(isEncrypted(stored!)).toBe(true);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored!, contextOf(user.id))).toBe(secret);

    const login = await request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ login: user.email, password: PASSWORD, twoFactorCode: generateSync({ secret }) });
    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe('string');

    expect(await encryptPlainSecrets()).toEqual({ twoFactor: 0 });
    expect(await storedSecret(user.id)).toBe(stored);
  });

  it('leaves users without a secret alone', async () => {
    const user = await newUser();
    await encryptPlainSecrets();
    expect(await storedSecret(user.id)).toBeNull();
  });
});

describe('2FA setup stores an encrypted secret', () => {
  it('enable stores enc:v1 and verify accepts a code for the secret it showed', async () => {
    const user = await newUser();
    const enable = await request(app)
      .post('/api/auth/2fa/enable')
      .set(CSRF)
      .set('Authorization', `Bearer ${user.token}`);
    expect(enable.status).toBe(200);
    const shown: string = enable.body.secret;

    const stored = await storedSecret(user.id);
    expect(stored!.startsWith('enc:v1:')).toBe(true);
    expect(stored).not.toContain(shown);
    expect(decryptSecret(stored!, contextOf(user.id))).toBe(shown);

    const verify = await request(app)
      .post('/api/auth/2fa/verify')
      .set(CSRF)
      .set('Authorization', `Bearer ${user.token}`)
      .send({ code: generateSync({ secret: shown }) });
    expect(verify.status).toBe(200);
    expect(verify.body).toEqual({ enabled: true });
  });
});

describe('rotation re-encrypts under the current key', () => {
  it('lists the 2FA column', () => {
    expect(ENCRYPTED_COLUMNS).toContainEqual({ model: 'user', field: 'twoFactorSecret' });
  });

  it('moves a row from the previous key to the current one, row by row, and counts a row it cannot open', async () => {
    const testKey = process.env.AXIOM_ENCRYPTION_KEY!;
    const oldKey = randomBytes(32).toString('base64');
    const strangerKey = randomBytes(32).toString('base64');
    const moved = await newUser();
    const lost = await newUser();
    const secret = generateSecret();
    const lostPlain = generateSecret();

    const underOld = await withKeys(oldKey, undefined, async ({ box }) =>
      box.encryptSecret(secret, contextOf(moved.id)),
    );
    const underStranger = await withKeys(strangerKey, undefined, async ({ box }) =>
      box.encryptSecret(lostPlain, contextOf(lost.id)),
    );
    await prisma.user.update({ where: { id: moved.id }, data: { twoFactorSecret: underOld } });
    await prisma.user.update({ where: { id: lost.id }, data: { twoFactorSecret: underStranger } });

    const { result, logged } = await withKeys(testKey, oldKey, async ({ migration, logger }) => {
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
      const counts = await migration.reencryptAllSecrets();
      return { result: counts, logged: JSON.stringify(warn.mock.calls) };
    });

    expect(result['user.twoFactorSecret'].reencrypted).toBeGreaterThanOrEqual(1);
    expect(result['user.twoFactorSecret'].failed).toBeGreaterThanOrEqual(1);

    const after = await storedSecret(moved.id);
    expect(after).not.toBe(underOld);
    expect(needsReencrypt(after!)).toBe(false);
    expect(decryptSecret(after!, contextOf(moved.id))).toBe(secret);

    // The row it could not open is left as it was, and the log names the reason, never a value
    expect(await storedSecret(lost.id)).toBe(underStranger);
    expect(logged).toContain(lost.id);
    expect(logged).toContain('unknown-key');
    for (const value of [lostPlain, underStranger, secret, underOld, oldKey, strangerKey]) {
      expect(logged).not.toContain(value);
    }
  });
});

describe('rotation reaches a model whose id is an Int', () => {
  it('lists the three GitHub App columns', () => {
    for (const field of ['clientSecret', 'privateKey', 'webhookSecret']) {
      expect(ENCRYPTED_COLUMNS).toContainEqual({ model: 'githubApp', field });
    }
  });

  it('moves the App row to the current key with the context githubApp.<field>:1', async () => {
    const testKey = process.env.AXIOM_ENCRYPTION_KEY!;
    const oldKey = randomBytes(32).toString('base64');
    const fields = ['clientSecret', 'privateKey', 'webhookSecret'] as const;
    const plain = {
      clientSecret: 'cs-plain-1',
      privateKey: 'pem-plain-1',
      webhookSecret: 'wh-plain-1',
    };
    const underOld = await withKeys(oldKey, undefined, async ({ box }) =>
      Object.fromEntries(
        fields.map((f) => [f, box.encryptSecret(plain[f], box.secretContext('githubApp', f, '1'))]),
      ),
    );
    const saved = await prisma.githubApp.findUnique({ where: { id: 1 } });
    expect(saved).toBeNull();
    await prisma.githubApp.create({
      data: {
        id: 1,
        appId: 1201,
        slug: 'acme-axiom',
        name: 'Axiom',
        htmlUrl: 'https://github.com/apps/acme-axiom',
        ownerLogin: 'acme-labs',
        clientId: 'Iv1.x',
        createdById: 'seed',
        ...underOld,
      } as never,
    });
    try {
      const result = await withKeys(testKey, oldKey, async ({ migration }) =>
        migration.reencryptAllSecrets(),
      );
      for (const field of fields) {
        expect(result[`githubApp.${field}`]).toEqual({ reencrypted: 1, failed: 0 });
      }
      const row = await prisma.githubApp.findUniqueOrThrow({ where: { id: 1 } });
      for (const field of fields) {
        expect(needsReencrypt(row[field])).toBe(false);
        expect(decryptSecret(row[field], secretContext('githubApp', field, '1'))).toBe(
          plain[field],
        );
      }
    } finally {
      await prisma.githubApp.deleteMany();
    }
  });
});
