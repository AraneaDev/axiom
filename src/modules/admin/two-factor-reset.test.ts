import crypto from 'crypto';

import { generateSecret } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getAction } from '../../actions/registry';
import { prisma } from '../../config/database';
import app from '../../index';
import { encryptSecret, secretContext } from '../../lib/secret-box';
import { createTestUser, type TestUser } from '../../test/factory';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const PASSWORD = 'testpassword123';

/**
 * An API token for a user, as an agent holds it.
 * @param userId - Its user
 * @param scopes - Its scopes
 * @returns What the agent sends
 */
async function tokenOf(userId: string, scopes: string[]): Promise<string> {
  const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({
    data: {
      userId,
      name: 'reset-agent',
      scopes,
      prefix: raw.slice(0, 11),
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
    },
  });
  return raw;
}

const resetPath = (userId: string) => `/api/admin/users/${userId}/reset-2fa`;

describe('an admin resets a user 2FA', () => {
  let platformAdmin: TestUser;
  let member: TestUser;
  let locked: TestUser;
  let secret: string;

  beforeAll(async () => {
    platformAdmin = await createTestUser();
    member = await createTestUser();
    locked = await createTestUser();
    await prisma.user.update({ where: { id: platformAdmin.id }, data: { isAdmin: true } });
  });

  beforeEach(async () => {
    // As the database keeps it: sealed to the user
    secret = encryptSecret(generateSecret(), secretContext('user', 'twoFactorSecret', locked.id));
    await prisma.user.update({
      where: { id: locked.id },
      data: { twoFactorSecret: secret, twoFactorEnabled: true, twoFactorLastStep: 1 },
    });
  });

  afterAll(async () => {
    const ids = [platformAdmin.id, member.id, locked.id];
    await prisma.agentApproval.deleteMany({ where: { userId: { in: ids } } });
    await prisma.apiToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: ids } } });
    await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  /** The stored 2FA state of the locked-out user. */
  const stored = () =>
    prisma.user.findUniqueOrThrow({
      where: { id: locked.id },
      select: { twoFactorEnabled: true, twoFactorSecret: true, twoFactorLastStep: true },
    });

  it('is web UI only and needs a platform admin', () => {
    const def = getAction('adminUser.resetTwoFactor');
    expect(def?.uiOnly).toBe(true);
    expect(def?.admin).toBe(true);
  });

  it('clears the secret and the flag for a platform admin, writes an audit row, and lets the user in without a code', async () => {
    const res = await request(app)
      .post(resetPath(locked.id))
      .set(CSRF)
      .set('Authorization', `Bearer ${platformAdmin.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(await stored()).toEqual({
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorLastStep: null,
    });

    const audit = await prisma.auditLog.findFirst({
      where: { userId: platformAdmin.id, action: '2fa_reset', resource: `user:${locked.id}` },
    });
    expect(audit).not.toBeNull();

    const login = await request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ login: locked.email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe('string');
  });

  it('answers 404 for a user that does not exist', async () => {
    const res = await request(app)
      .post(resetPath('no-such-user'))
      .set(CSRF)
      .set('Authorization', `Bearer ${platformAdmin.token}`);
    expect(res.status).toBe(404);
  });

  it('refuses a user who is not a platform admin and changes nothing', async () => {
    const res = await request(app)
      .post(resetPath(locked.id))
      .set(CSRF)
      .set('Authorization', `Bearer ${member.token}`);
    expect(res.status).toBe(403);
    expect(await stored()).toEqual({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorLastStep: 1,
    });
  });

  it('refuses to reset your own 2FA and says to use the normal disable', async () => {
    await prisma.user.update({
      where: { id: platformAdmin.id },
      data: { twoFactorSecret: secret, twoFactorEnabled: true, twoFactorLastStep: 1 },
    });
    try {
      const res = await request(app)
        .post(resetPath(platformAdmin.id))
        .set(CSRF)
        .set('Authorization', `Bearer ${platformAdmin.token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/disable/i);
      expect(res.body.error.message).toMatch(/code/i);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: platformAdmin.id },
        select: { twoFactorEnabled: true, twoFactorSecret: true },
      });
      expect(after).toEqual({ twoFactorEnabled: true, twoFactorSecret: secret });
    } finally {
      await prisma.user.update({
        where: { id: platformAdmin.id },
        data: { twoFactorSecret: null, twoFactorEnabled: false, twoFactorLastStep: null },
      });
    }
  });

  it('ends every session of the user, refresh tokens included', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .set(CSRF)
      .send({ login: member.email, password: PASSWORD });
    expect(login.status).toBe(200);
    await prisma.refreshToken.create({
      data: {
        userId: locked.id,
        tokenHash: crypto.randomBytes(16).toString('hex'),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    expect(await prisma.refreshToken.count({ where: { userId: locked.id } })).toBeGreaterThan(0);
    expect(await prisma.refreshToken.count({ where: { userId: member.id } })).toBeGreaterThan(0);

    const res = await request(app)
      .post(resetPath(locked.id))
      .set(CSRF)
      .set('Authorization', `Bearer ${platformAdmin.token}`);
    expect(res.status).toBe(200);

    expect(await prisma.refreshToken.count({ where: { userId: locked.id } })).toBe(0);
    // another user's sessions are left alone
    expect(await prisma.refreshToken.count({ where: { userId: member.id } })).toBeGreaterThan(0);
  });

  it('refuses a token, even a platform admin one, over REST and act, with no request', async () => {
    const raw = await tokenOf(platformAdmin.id, ['admin:write']);
    const viaRest = await request(app)
      .post(resetPath(locked.id))
      .set(CSRF)
      .set('Authorization', `Token ${raw}`);
    expect(viaRest.status).toBe(403);

    const viaAct = await request(app)
      .post('/api/act')
      .set(CSRF)
      .set('Authorization', `Token ${raw}`)
      .send({ action: 'adminUser.resetTwoFactor', input: { userId: locked.id } });
    expect(viaAct.status).toBe(403);

    expect(await prisma.agentApproval.count({ where: { userId: platformAdmin.id } })).toBe(0);
    expect(await stored()).toEqual({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      twoFactorLastStep: 1,
    });
  });
});
