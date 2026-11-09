import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { MINTABLE_SCOPES } from '../../middleware/token-scopes';
import {
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authGet, authPatch, authPost, authPut } from '../../test/helpers';
import * as usersService from '../users/users.service';

import { getServiceAccount, isOwner, ownersOf } from './service-accounts.service';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('service accounts: create, list, owners, delete', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let member: TestUser;
  let otherMember: TestUser;
  let viewer: TestUser;
  let botId: string;
  const created: string[] = [];

  async function join(user: TestUser, role: 'ADMIN' | 'MEMBER' | 'VIEWER') {
    await prisma.orgMembership.create({ data: { orgId: ctx.orgId, userId: user.id, role } });
  }

  async function createBot(username: string, ownerIds: string[], token = admin.token) {
    const res = await authPost(`/api/orgs/${ctx.orgId}/service-accounts`, token, {
      username,
      displayName: `Bot ${username}`,
      description: 'Triages the backlog every night',
      ownerIds,
    });
    if (res.status === 201 || res.status === 200) created.push(res.body.id);
    return res;
  }

  beforeAll(async () => {
    ctx = await createTestContext('svcacct');
    admin = await createTestUser({ username: 'voorbeeld-admin-svcacct' });
    member = await createTestUser({ username: 'voorbeeld-member-svcacct' });
    otherMember = await createTestUser({ username: 'voorbeeld-other-svcacct' });
    viewer = await createTestUser({ username: 'voorbeeld-viewer-svcacct' });
    await join(admin, 'ADMIN');
    await join(member, 'MEMBER');
    await join(otherMember, 'MEMBER');
    await join(viewer, 'VIEWER');
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({
      where: {
        OR: [
          { id: { in: [admin.id, member.id, otherMember.id, viewer.id] } },
          { id: { in: created } },
        ],
      },
    });
  });

  it('an org admin creates a bot with one owner: listed, org role MEMBER', async () => {
    const res = await createBot('acme-triage-bot', [member.id]);
    expect(res.status).toBe(201);
    botId = res.body.id;
    expect(res.body).toMatchObject({
      username: 'acme-triage-bot',
      displayName: 'Bot acme-triage-bot',
      status: 'ACTIVE',
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: botId } });
    expect(user.kind).toBe('SERVICE');
    const login = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'acme-triage-bot', password: user.passwordHash });
    expect(login.status).toBe(401);

    const membership = await prisma.orgMembership.findUniqueOrThrow({
      where: { userId_orgId: { userId: botId, orgId: ctx.orgId } },
    });
    expect(membership.role).toBe('MEMBER');

    const list = await authGet(`/api/orgs/${ctx.orgId}/service-accounts`, admin.token);
    expect(list.status).toBe(200);
    expect(list.body.map((b: { id: string }) => b.id)).toContain(botId);

    expect(await ownersOf(botId)).toEqual([member.id]);
    expect(await isOwner(botId, member.id)).toBe(true);
    expect(await isOwner(botId, otherMember.id)).toBe(false);
    expect(await getServiceAccount(botId)).toMatchObject({ userId: botId, orgId: ctx.orgId });
  });

  it('an org MEMBER gets 403 on create, and on list when they own no bot', async () => {
    const res = await createBot('acme-refused-bot', [otherMember.id], otherMember.token);
    expect(res.status).toBe(403);
    expect(await prisma.user.count({ where: { username: 'acme-refused-bot' } })).toBe(0);
    const list = await authGet(`/api/orgs/${ctx.orgId}/service-accounts`, otherMember.token);
    expect(list.status).toBe(403);
  });

  it('an owner who is not an org admin sees only their own bot', async () => {
    const second = await createBot('acme-summary-bot', [otherMember.id]);
    expect(second.status).toBe(201);

    const list = await authGet(`/api/orgs/${ctx.orgId}/service-accounts`, member.token);
    expect(list.status).toBe(200);
    expect(list.body.map((b: { id: string }) => b.id)).toEqual([botId]);

    const own = await authGet(`/api/service-accounts/${botId}`, member.token);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ id: botId, status: 'ACTIVE' });
    expect(own.body.owners.map((o: { id: string }) => o.id)).toEqual([member.id]);
    expect(own.body).toHaveProperty('teams');
    expect(own.body).toHaveProperty('spaces');
    expect(own.body).toHaveProperty('tokens');

    const notOwn = await authGet(`/api/service-accounts/${second.body.id}`, member.token);
    expect(notOwn.status).toBe(404);
  });

  it('get lists its tokens by prefix, name, expiry and last use, never the hash', async () => {
    await prisma.apiToken.create({
      data: {
        userId: botId,
        name: 'nightly',
        tokenHash: 'svcacct-test-hash',
        prefix: 'tk_00000000',
        scopes: ['issues:read'],
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const res = await authGet(`/api/service-accounts/${botId}`, admin.token);
    expect(res.status).toBe(200);
    expect(res.body.tokens).toHaveLength(1);
    expect(res.body.tokens[0]).toMatchObject({ prefix: 'tk_00000000', name: 'nightly' });
    expect(res.body.tokens[0]).toHaveProperty('expiresAt');
    expect(res.body.tokens[0]).toHaveProperty('lastUsedAt');
    expect(res.body.tokens[0]).not.toHaveProperty('tokenHash');
  });

  it('a VIEWER owner gives 400 SERVICE_ACCOUNT_OWNER_INVALID', async () => {
    const res = await createBot('acme-viewer-bot', [viewer.id]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SERVICE_ACCOUNT_OWNER_INVALID');
    expect(await prisma.user.count({ where: { username: 'acme-viewer-bot' } })).toBe(0);

    const put = await authPut(`/api/service-accounts/${botId}/owners`, admin.token, {
      ownerIds: [viewer.id],
    });
    expect(put.status).toBe(400);
    expect(put.body.error.code).toBe('SERVICE_ACCOUNT_OWNER_INVALID');
    // A bot is no owner either
    const bot = await authPut(`/api/service-accounts/${botId}/owners`, admin.token, {
      ownerIds: [botId],
    });
    expect(bot.status).toBe(400);
    expect(await ownersOf(botId)).toEqual([member.id]);
  });

  it('setOwners with [] gives 400; with eligible people it replaces the owners', async () => {
    const empty = await authPut(`/api/service-accounts/${botId}/owners`, admin.token, {
      ownerIds: [],
    });
    expect(empty.status).toBe(400);
    expect(await ownersOf(botId)).toEqual([member.id]);

    const ok = await authPut(`/api/service-accounts/${botId}/owners`, admin.token, {
      ownerIds: [member.id, admin.id],
    });
    expect(ok.status).toBe(200);
    expect((await ownersOf(botId)).sort()).toEqual([member.id, admin.id].sort());

    // An owner who is no org admin can't change the owners
    const byOwner = await authPut(`/api/service-accounts/${botId}/owners`, member.token, {
      ownerIds: [member.id],
    });
    expect(byOwner.status).toBe(403);
  });

  it('update changes the display name and description', async () => {
    const res = await authPatch(`/api/service-accounts/${botId}`, admin.token, {
      displayName: 'Triage bot',
      description: 'Labels new issues',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ displayName: 'Triage bot', description: 'Labels new issues' });
  });

  it("raising the bot's org role gives 400 SERVICE_ACCOUNT_ROLE_FIXED", async () => {
    const res = await authPatch(`/api/orgs/${ctx.orgId}/members/${botId}`, ctx.owner.token, {
      role: 'ADMIN',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SERVICE_ACCOUNT_ROLE_FIXED');
    const membership = await prisma.orgMembership.findUniqueOrThrow({
      where: { userId_orgId: { userId: botId, orgId: ctx.orgId } },
    });
    expect(membership.role).toBe('MEMBER');
  });

  it('a token calling serviceAccount.create is refused as uiOnly, and nothing is written', async () => {
    const { token } = await usersService.createApiToken(ctx.owner.id, {
      name: 'svcacct-probe',
      // Every scope a token can hold: only uiOnly is left to refuse it
      scopes: [...MINTABLE_SCOPES],
    });
    const res = await request(app)
      .post(`/api/orgs/${ctx.orgId}/service-accounts`)
      .set('Authorization', `Token ${token}`)
      .set(XHR)
      .send({ username: 'acme-token-bot', displayName: 'Token bot', ownerIds: [member.id] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('UI_ONLY');
    expect(await prisma.user.count({ where: { username: 'acme-token-bot' } })).toBe(0);
  });

  it('delete removes the bot and cancels its pending approval, keeping its activity', async () => {
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'Bot wrote me',
        body: '',
        creatorId: botId,
      },
    });
    const pending = await prisma.agentApproval.create({
      data: {
        userId: botId,
        action: 'issue.delete',
        input: {},
        preview: 'Delete an issue',
        channel: 'rest-token',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    // An owner who is no org admin can't delete it
    const byOwner = await authDel(`/api/service-accounts/${botId}`, member.token);
    expect(byOwner.status).toBe(403);

    const res = await authDel(`/api/service-accounts/${botId}`, admin.token);
    expect(res.status).toBe(204);

    expect(await getServiceAccount(botId)).toBeNull();
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: botId } })).deactivatedAt,
    ).not.toBeNull();
    expect(await prisma.apiToken.count({ where: { userId: botId } })).toBe(0);
    expect(await prisma.orgMembership.count({ where: { userId: botId } })).toBe(0);
    expect(
      (await prisma.agentApproval.findUniqueOrThrow({ where: { id: pending.id } })).status,
    ).toBe('CANCELLED');
    // Its past activity stays under its name
    const kept = await prisma.issue.findUniqueOrThrow({
      where: { id: issue.id },
      include: { creator: true },
    });
    expect(kept.creator).toMatchObject({ displayName: 'Triage bot', kind: 'SERVICE' });

    const list = await authGet(`/api/orgs/${ctx.orgId}/service-accounts`, admin.token);
    expect(list.body.map((b: { id: string }) => b.id)).not.toContain(botId);
    expect((await authGet(`/api/service-accounts/${botId}`, admin.token)).status).toBe(404);
  });

  it('a platform admin creating a bot in an unknown org gets 404 (M1)', async () => {
    const platform = await createTestUser({ username: 'voorbeeld-platform-svcacct' });
    await prisma.user.update({ where: { id: platform.id }, data: { isAdmin: true } });
    try {
      const res = await authPost(
        '/api/orgs/cnosuchorg000000000000000/service-accounts',
        platform.token,
        {
          username: 'acme-nowhere-bot',
          displayName: 'Nowhere',
          ownerIds: [member.id],
        },
      );
      expect(res.status).toBe(404);
    } finally {
      await prisma.user.delete({ where: { id: platform.id } });
    }
  });

  it('concurrent creates with one username: one 201, the other 409 USERNAME_TAKEN (M7)', async () => {
    const results = await Promise.all([0, 1, 2].map(() => createBot('acme-race-bot', [member.id])));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('USERNAME_TAKEN');
    }
  });

  it('concurrent deletes: one 204, the other 404 (M7)', async () => {
    const res = await createBot('acme-twice-bot', [member.id]);
    expect(res.status).toBe(201);
    const results = await Promise.all(
      [0, 1].map(() => authDel(`/api/service-accounts/${res.body.id}`, admin.token)),
    );
    expect(results.map((r) => r.status).sort()).toEqual([204, 404]);
  });
});
