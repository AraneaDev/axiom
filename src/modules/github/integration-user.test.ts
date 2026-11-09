import { createHash } from 'crypto';

import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import * as adminService from '../admin/admin.service';
import * as authService from '../auth/auth.service';
import { assertAssignable } from '../issues/issue-references';
import { hydrateIssueDetail } from '../issues/issues-hydrate.service';
import { addComment } from '../issues/issues.service';
import { createNotification } from '../notifications/notifications.service';
import * as usersService from '../users/users.service';

import { GITHUB_INTEGRATION_USER_ID, isIntegrationUser } from './integration-user';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('GitHub integration user', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext('ghint');
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  it('is inserted by the migration, a member of nothing', async () => {
    const user = await prisma.user.findUnique({
      where: { id: GITHUB_INTEGRATION_USER_ID },
      include: { orgMemberships: true, teamMemberships: true },
    });
    expect(user).toMatchObject({
      username: 'github-integration',
      displayName: 'GitHub',
      email: 'github-integration@users.invalid',
      passwordHash: '!',
      kind: 'INTEGRATION',
    });
    expect(user?.orgMemberships).toHaveLength(0);
    expect(user?.teamMemberships).toHaveLength(0);
    expect(isIntegrationUser(GITHUB_INTEGRATION_USER_ID)).toBe(true);
    expect(isIntegrationUser(ctx.owner.id)).toBe(false);
  });

  it('answers a sign-in exactly like a wrong password', async () => {
    const wrong = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: ctx.owner.username, password: 'not-the-password' });
    for (const login of ['github-integration', 'github-integration@users.invalid']) {
      for (const password of ['!', 'anything-at-all']) {
        const res = await request(app).post('/api/auth/login').set(XHR).send({ login, password });
        expect(res.status).toBe(wrong.status);
        expect(res.body).toEqual(wrong.body);
      }
    }
    expect(wrong.status).toBe(401);
  });

  it('issues no reset mail and no reset', async () => {
    await expect(
      authService.requestPasswordReset('github-integration@users.invalid'),
    ).resolves.toEqual({
      success: true,
    });
    expect(
      await prisma.passwordResetToken.count({ where: { userId: GITHUB_INTEGRATION_USER_ID } }),
    ).toBe(0);
  });

  it('refuses a JWT and an API token for it', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const { env } = await import('../../config/env');
    const bearer = jwt.sign({ userId: GITHUB_INTEGRATION_USER_ID }, env.JWT_SECRET);
    const res = await request(app)
      .get('/api/users/search?q=x')
      .set('Authorization', `Bearer ${bearer}`);
    expect(res.status).toBe(401);

    const plantedToken = 'tk_planted_for_the_integration_user';
    await prisma.apiToken.create({
      data: {
        userId: GITHUB_INTEGRATION_USER_ID,
        name: 'planted',
        tokenHash: createHash('sha256').update(plantedToken).digest('hex'),
        prefix: plantedToken.slice(0, 11),
        scopes: ['issues:read'],
      },
    });
    try {
      const res2 = await request(app)
        .get('/api/users/search?q=x')
        .set(XHR)
        .set('Authorization', `Token ${plantedToken}`);
      expect(res2.status).toBe(401);
      expect(res2.body.error.code).toBe('INVALID_TOKEN');
    } finally {
      await prisma.apiToken.deleteMany({ where: { userId: GITHUB_INTEGRATION_USER_ID } });
    }
  });

  it('refuses to mint a token for it', async () => {
    await expect(
      usersService.createApiToken(GITHUB_INTEGRATION_USER_ID, {
        name: 'x',
        scopes: ['issues:read'],
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('creates no notification row for it', async () => {
    const result = await createNotification(GITHUB_INTEGRATION_USER_ID, 'mention', 'Hello');
    expect(result).toBeNull();
    expect(await prisma.notification.count({ where: { userId: GITHUB_INTEGRATION_USER_ID } })).toBe(
      0,
    );
  });

  it('is not assignable', async () => {
    await expect(assertAssignable(ctx.projectId, GITHUB_INTEGRATION_USER_ID)).rejects.toMatchObject(
      {
        statusCode: 400,
      },
    );
  });

  it('is left out of user search', async () => {
    const found = await usersService.searchUsers('GitHub', ctx.owner.id);
    expect(found.map((u) => u.id)).not.toContain(GITHUB_INTEGRATION_USER_ID);
  });

  it('cannot be added to a team or an org', async () => {
    const team = await request(app)
      .post(`/api/teams/${ctx.teamId}/members`)
      .set(XHR)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ userId: GITHUB_INTEGRATION_USER_ID, role: 'MEMBER' });
    expect(team.status).toBe(400);

    const org = await request(app)
      .post(`/api/orgs/${ctx.orgId}/members`)
      .set(XHR)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ userId: GITHUB_INTEGRATION_USER_ID, role: 'MEMBER' });
    expect(org.status).toBe(400);
    expect(
      await prisma.orgMembership.count({ where: { userId: GITHUB_INTEGRATION_USER_ID } }),
    ).toBe(0);
  });

  it('shows read-only in the admin list and refuses update, delete and deactivate', async () => {
    const list = await adminService.listUsers({ search: 'github-integration' });
    expect(list.users.map((u) => u.id)).toContain(GITHUB_INTEGRATION_USER_ID);
    expect(list.users.find((u) => u.id === GITHUB_INTEGRATION_USER_ID)).toMatchObject({
      kind: 'INTEGRATION',
    });
    await expect(
      adminService.updateUser(GITHUB_INTEGRATION_USER_ID, { role: 'MEMBER' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(adminService.deleteUser(GITHUB_INTEGRATION_USER_ID)).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(adminService.deactivateUser(GITHUB_INTEGRATION_USER_ID)).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(
      adminService.resetUserPassword(GITHUB_INTEGRATION_USER_ID, 'newpassword123'),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.user.count({ where: { id: GITHUB_INTEGRATION_USER_ID } })).toBe(1);
  });

  it('renders a comment it authored through issue.hydrate as GitHub', async () => {
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 9001,
        title: 'From GitHub',
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    await addComment(issue.id, GITHUB_INTEGRATION_USER_ID, 'Opened on GitHub');
    const detail = await hydrateIssueDetail(ctx.projectId, 9001, ctx.owner.id);
    const comment = detail.issue.comments.find(
      (c: { body: string }) => c.body === 'Opened on GitHub',
    );
    expect(comment?.author).toMatchObject({ displayName: 'GitHub' });
  });

  it('does not count as a person: the first registration still needs no invite', async () => {
    await prisma.siteSettings.upsert({
      where: { id: 1 },
      update: { registrationMode: 'INVITE_ONLY' },
      create: { id: 1, registrationMode: 'INVITE_ONLY' },
    });
    // A database whose only user is the integration user: every user count sees that row alone
    const realCount = prisma.user.count.bind(prisma.user) as (args?: object) => Promise<number>;
    const spy = vi.spyOn(prisma.user, 'count').mockImplementation(((args?: { where?: object }) =>
      realCount({
        ...args,
        where: { AND: [args?.where ?? {}, { id: GITHUB_INTEGRATION_USER_ID }] },
      })) as never);
    const name = `firstuser-${Date.now()}`;
    try {
      const res = await request(app)
        .post('/api/auth/register')
        .set(XHR)
        .send({
          email: `${name}@test.dev`,
          username: name,
          displayName: name,
          password: 'testpassword123',
        });
      expect(res.status).toBe(201);
      const stats = await adminService.getSystemStats();
      expect(stats.totalUsers).toBe(0);
    } finally {
      spy.mockRestore();
      const user = await prisma.user.findUnique({ where: { username: name } });
      if (user) {
        await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }
  });

  it('refuses a reset token planted for it', async () => {
    const raw = 'planted-reset-token-for-the-integration-user';
    await prisma.passwordResetToken.create({
      data: {
        userId: GITHUB_INTEGRATION_USER_ID,
        tokenHash: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    try {
      await expect(authService.resetPassword(raw, 'newpassword123')).rejects.toMatchObject({
        statusCode: 400,
      });
      const user = await prisma.user.findUnique({ where: { id: GITHUB_INTEGRATION_USER_ID } });
      expect(user?.passwordHash).toBe('!');
    } finally {
      await prisma.passwordResetToken.deleteMany({ where: { userId: GITHUB_INTEGRATION_USER_ID } });
    }
  });

  it('spends a bcrypt compare on an unknown login too', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const spy = vi.spyOn(bcrypt, 'compare');
    try {
      await expect(
        authService.login({ login: 'nobody-by-this-name', password: 'x' }),
      ).rejects.toMatchObject({ statusCode: 401 });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});
