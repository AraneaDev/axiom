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

describe('service accounts: the list and the activity of a bot', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let stranger: TestUser;
  let botId: string;
  let seenIssueId: string;
  let hiddenIssueId: string;
  let openPageId: string;
  let secretPageId: string;
  let spaceId: string;
  let opsTeamId: string;
  let hiddenSpaceId: string;

  beforeAll(async () => {
    ctx = await createTestContext('svcactivity');
    owner = await createTestUser({ username: 'voorbeeld-owner-svcactivity' });
    stranger = await createTestUser({ username: 'voorbeeld-stranger-svcactivity' });
    for (const user of [owner, stranger]) {
      await prisma.orgMembership.create({
        data: { orgId: ctx.orgId, userId: user.id, role: 'MEMBER' },
      });
    }
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: owner.id, role: 'MEMBER' },
    });
    const bot = await prisma.user.create({
      data: {
        email: 'activity-bot@service.invalid',
        username: 'acme-activity-bot',
        displayName: 'Activity bot',
        passwordHash: '!',
        kind: 'SERVICE',
        orgMemberships: { create: { orgId: ctx.orgId, role: 'MEMBER' } },
        teamMemberships: { create: { teamId: ctx.teamId, role: 'MEMBER' } },
        serviceAccount: {
          create: {
            orgId: ctx.orgId,
            createdById: ctx.owner.id,
            owners: { create: { ownerId: owner.id } },
          },
        },
      },
    });
    botId = bot.id;
    seenIssueId = (
      await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 1,
          title: 'Stale ticket',
          body: '',
          creatorId: botId,
        },
      })
    ).id;
    // A team none of the bot's owners is in: what the bot did there is not shown to them. Decision
    // 9 keeps a bot out of such a place; the filter is the backstop
    const hiddenTeam = await prisma.team.create({
      data: {
        orgId: ctx.orgId,
        name: 'Hidden team',
        slug: 'hidden-svcactivity',
        projects: { create: { name: 'Hidden', slug: 'hidden', prefix: 'HID' } },
      },
      include: { projects: true },
    });
    hiddenIssueId = (
      await prisma.issue.create({
        data: {
          projectId: hiddenTeam.projects[0].id,
          number: 1,
          title: 'Secret ticket',
          body: '',
          creatorId: botId,
        },
      })
    ).id;
    hiddenSpaceId = (
      await prisma.wikiSpace.create({
        data: { teamId: hiddenTeam.id, name: 'Hidden space', slug: 'hidden-space' },
      })
    ).id;
    // A space of the bot's team; one of its pages is restricted to the org owner alone
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Runbooks', slug: 'runbooks-svcactivity' },
    });
    spaceId = space.id;
    openPageId = (
      await prisma.page.create({
        data: { spaceId, title: 'Runbook', slug: 'runbook', body: '' },
      })
    ).id;
    secretPageId = (
      await prisma.page.create({
        data: {
          spaceId,
          title: 'Secret page',
          slug: 'secret',
          body: '',
          restrictions: { create: { type: 'VIEW', userId: ctx.owner.id } },
        },
      })
    ).id;
    // A team the owner is in and the bot is not: the bot may join it
    opsTeamId = (
      await prisma.team.create({
        data: {
          orgId: ctx.orgId,
          name: 'Ops',
          slug: 'ops-svcactivity',
          members: { create: { userId: owner.id, role: 'MEMBER' } },
        },
      })
    ).id;
    await prisma.activity.createMany({
      data: [
        { resourceType: 'issue', resourceId: seenIssueId, action: 'created', userId: botId },
        { resourceType: 'issue', resourceId: hiddenIssueId, action: 'created', userId: botId },
        { resourceType: 'wiki_page', resourceId: openPageId, action: 'created', userId: botId },
        { resourceType: 'wiki_page', resourceId: secretPageId, action: 'created', userId: botId },
      ],
    });
    await prisma.apiToken.create({
      data: {
        userId: botId,
        name: 'nightly',
        tokenHash: 'svcactivity-test-hash',
        prefix: 'tk_11111111',
        scopes: ['issues:read'],
        expiresAt: new Date(Date.now() + 86_400_000),
        lastUsedAt: new Date('2026-11-01T10:00:00Z'),
      },
    });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, stranger.id, botId] } } });
  });

  it('the list names the teams of each bot and when it was last active', async () => {
    const res = await authGet(`/api/orgs/${ctx.orgId}/service-accounts`, ctx.owner.token);
    expect(res.status).toBe(200);
    const row = res.body.find((b: { id: string }) => b.id === botId);
    expect(row.teams).toEqual([
      expect.objectContaining({ id: ctx.teamId, slug: ctx.teamSlug, role: 'MEMBER' }),
    ]);
    expect(row.lastUsedAt).toBe('2026-11-01T10:00:00.000Z');
  });

  it("an owner reads the bot's activity, only where they can open it", async () => {
    const res = await authGet(`/api/service-accounts/${botId}/activity`, owner.token);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ resourceId: string }>).map((a) => a.resourceId);
    expect(ids).toContain(seenIssueId);
    expect(ids).not.toContain(hiddenIssueId);
    const seen = res.body.find((a: { resourceId: string }) => a.resourceId === seenIssueId);
    expect(seen).toMatchObject({
      resourceTitle: 'Stale ticket',
      resourceKey: `${ctx.projectPrefix}-1`,
      user: { id: botId, kind: 'SERVICE' },
    });
  });

  it('an org admin reads it too', async () => {
    const res = await authGet(`/api/service-accounts/${botId}/activity`, ctx.owner.token);
    expect(res.status).toBe(200);
    expect((res.body as Array<{ resourceId: string }>).map((a) => a.resourceId)).toContain(
      seenIssueId,
    );
  });

  it('a stranger is told the bot does not exist', async () => {
    const res = await authGet(`/api/service-accounts/${botId}/activity`, stranger.token);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_ACCOUNT_NOT_FOUND');
  });

  it("an owner sees the bot's page activity, but not a page restricted away from them", async () => {
    const res = await authGet(`/api/service-accounts/${botId}/activity`, owner.token);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ resourceId: string }>).map((a) => a.resourceId);
    expect(ids).toContain(openPageId);
    expect(ids).not.toContain(secretPageId);
    const page = res.body.find((a: { resourceId: string }) => a.resourceId === openPageId);
    expect(page.resourceTitle).toBe('Runbook');
  });

  it('a platform admin outside the org reads it, issues in every team included', async () => {
    const platform = await createTestUser({ username: 'voorbeeld-platform-svcactivity' });
    await prisma.user.update({ where: { id: platform.id }, data: { isAdmin: true } });
    try {
      const res = await authGet(`/api/service-accounts/${botId}/activity`, platform.token);
      expect(res.status).toBe(200);
      const ids = (res.body as Array<{ resourceId: string }>).map((a) => a.resourceId);
      expect(ids).toEqual(expect.arrayContaining([seenIssueId, hiddenIssueId, openPageId]));
    } finally {
      await prisma.user.delete({ where: { id: platform.id } });
    }
  });

  it('joinable offers the teams an owner is in and the bot is not, and get no longer carries it', async () => {
    const res = await authGet(`/api/service-accounts/${botId}/joinable`, owner.token);
    expect(res.status).toBe(200);
    const teamIds = (res.body.teams as Array<{ id: string }>).map((t) => t.id);
    // Ops has its owner; the bot's own team and the team no owner is in are not offered
    expect(teamIds).toEqual([opsTeamId]);
    const spaceIds = (res.body.spaces as Array<{ id: string }>).map((sp) => sp.id);
    // Runbooks is open to its team, which the bot is in: it reaches it already
    expect(spaceIds).not.toContain(spaceId);
    expect(spaceIds).not.toContain(hiddenSpaceId);
    const read = await authGet(`/api/service-accounts/${botId}`, owner.token);
    expect(read.body).not.toHaveProperty('joinable');
  });

  it('joinable is refused to a stranger as if the bot did not exist', async () => {
    const res = await authGet(`/api/service-accounts/${botId}/joinable`, stranger.token);
    expect(res.status).toBe(404);
  });

  it("a bot's member profile names its kind", async () => {
    const res = await authGet(
      `/api/teams/${ctx.teamId}/members/profile/acme-activity-bot`,
      owner.token,
    );
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('SERVICE');
  });

  it('the org member list says who is deactivated, so the owner picker can leave them out', async () => {
    const res = await authGet(`/api/orgs/${ctx.orgId}/members`, ctx.owner.token);
    expect(res.status).toBe(200);
    const row = res.body.find((m: { userId: string }) => m.userId === owner.id);
    expect(row.user).toHaveProperty('deactivatedAt', null);
  });
});

describe('service accounts: where a bot may be added', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let botId: string;
  let docsTeamId: string;
  let openSpaceId: string;
  let grantedSpaceId: string;
  let adminOnlySpaceId: string;
  let reachedSpaceId: string;

  beforeAll(async () => {
    ctx = await createTestContext('svcjoin');
    owner = await createTestUser({ username: 'voorbeeld-owner-svcjoin' });
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: owner.id, role: 'MEMBER' },
    });
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: owner.id, role: 'MEMBER' },
    });
    const bot = await prisma.user.create({
      data: {
        email: 'join-bot@service.invalid',
        username: 'acme-join-bot',
        displayName: 'Join bot',
        passwordHash: '!',
        kind: 'SERVICE',
        orgMemberships: { create: { orgId: ctx.orgId, role: 'MEMBER' } },
        teamMemberships: { create: { teamId: ctx.teamId, role: 'MEMBER' } },
        serviceAccount: {
          create: {
            orgId: ctx.orgId,
            createdById: ctx.owner.id,
            owners: { create: { ownerId: owner.id } },
          },
        },
      },
    });
    botId = bot.id;
    // A team the owner is in and the bot is not
    docsTeamId = (
      await prisma.team.create({
        data: {
          orgId: ctx.orgId,
          name: 'Docs',
          slug: 'docs-svcjoin',
          members: { create: { userId: owner.id, role: 'MEMBER' } },
        },
      })
    ).id;
    const space = (name: string, slug: string, teamId: string, grants: object[] = []) =>
      prisma.wikiSpace
        .create({ data: { teamId, name, slug, permissions: { create: grants } } })
        .then((s) => s.id);
    // Open to its team: the bot's grant would be the first and close it to everyone else
    openSpaceId = await space('Open', 'open-svcjoin', docsTeamId);
    // Members of the team may view it by a grant: the owner keeps it after the bot's grant
    grantedSpaceId = await space('Granted', 'granted-svcjoin', docsTeamId, [
      { teamRole: 'MEMBER', level: 'VIEW' },
    ]);
    // Only team admins: the owner, a member, can't open it
    adminOnlySpaceId = await space('Admins', 'admins-svcjoin', docsTeamId, [
      { teamRole: 'ADMIN', level: 'ADMIN' },
    ]);
    // In the bot's own team, granted to members: the bot reaches it already
    reachedSpaceId = await space('Reached', 'reached-svcjoin', ctx.teamId, [
      { teamRole: 'MEMBER', level: 'EDIT' },
    ]);
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, botId] } } });
  });

  it('offers only a space with grants that the bot does not reach and an owner keeps', async () => {
    const res = await authGet(`/api/service-accounts/${botId}/joinable`, ctx.owner.token);
    expect(res.status).toBe(200);
    const spaces = res.body.spaces as Array<{ id: string; name: string; teamName: string }>;
    expect(spaces.map((s) => s.id)).toEqual([grantedSpaceId]);
    expect(spaces[0].teamName).toBe('Docs');
    const ids = spaces.map((s) => s.id);
    expect(ids).not.toContain(openSpaceId);
    expect(ids).not.toContain(adminOnlySpaceId);
    expect(ids).not.toContain(reachedSpaceId);
    expect((res.body.teams as Array<{ id: string }>).map((t) => t.id)).toEqual([docsTeamId]);
  });

  it('every offered space and team can be added, with a 2xx', async () => {
    const res = await authGet(`/api/service-accounts/${botId}/joinable`, ctx.owner.token);
    for (const sp of res.body.spaces as Array<{ id: string }>) {
      const add = await authPut(`/api/wiki/spaces/${sp.id}/permissions`, ctx.owner.token, {
        userId: botId,
        level: 'EDIT',
      });
      expect(add.status, add.body?.error?.code).toBeLessThan(300);
    }
    for (const team of res.body.teams as Array<{ id: string }>) {
      const add = await authPost(`/api/teams/${team.id}/members`, ctx.owner.token, {
        userId: botId,
        role: 'MEMBER',
      });
      expect(add.status, add.body?.error?.code).toBeLessThan(300);
    }
  });
});
