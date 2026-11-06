import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

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

    await prisma.apiToken.create({
      data: {
        userId: GITHUB_INTEGRATION_USER_ID,
        name: 'planted',
        tokenHash: 'a'.repeat(64),
        prefix: 'tk_planted',
        scopes: ['issues:read'],
      },
    });
    try {
      const res2 = await request(app)
        .get('/api/users/search?q=x')
        .set('Authorization', `Token ${'tk_planted'}`);
      expect(res2.status).toBe(401);
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
});
