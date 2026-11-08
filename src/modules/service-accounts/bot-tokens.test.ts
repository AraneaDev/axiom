import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { MINTABLE_SCOPES, TOKEN_SCOPES } from '../../middleware/token-scopes';
import {
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authPost } from '../../test/helpers';
import { deactivateUser, reactivateUser } from '../admin/admin.service';
import { createUploadUrl, findUsableIntent } from '../attachments/upload-intents.service';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Every scope a bot can hold: all mintable ones but admin */
const BOT_SCOPES = MINTABLE_SCOPES.filter((s) => !s.startsWith('admin:'));

/**
 * A request made with an API token.
 * @param method - The HTTP method
 * @param path - The path
 * @param raw - The raw token
 */
function withToken(method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, raw: string) {
  const req = request(app)[method](path);
  return req.set('Authorization', `Token ${raw}`).set('X-Requested-With', 'XMLHttpRequest');
}

describe('service accounts: bot tokens', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let owner: TestUser;
  let stranger: TestUser;
  let botId: string;
  let issuePath: string;
  const bots: string[] = [];
  const otherOrgs: string[] = [];

  async function createBot(orgId: string, username: string, ownerIds: string[], token: string) {
    const res = await authPost(`/api/orgs/${orgId}/service-accounts`, token, {
      username,
      displayName: `Bot ${username}`,
      ownerIds,
    });
    expect(res.status).toBe(201);
    bots.push(res.body.id);
    return res.body.id as string;
  }

  function createToken(id: string, body: object, token = admin.token) {
    return authPost(`/api/service-accounts/${id}/tokens`, token, body);
  }

  async function mint(id: string, extra: object = {}) {
    const res = await createToken(id, { name: 'Nightly triage', scopes: BOT_SCOPES, ...extra });
    expect(res.status).toBe(201);
    return res.body as { id: string; token: string; expiresAt: string };
  }

  beforeAll(async () => {
    ctx = await createTestContext('bottok');
    admin = await createTestUser({ username: 'voorbeeld-admin-bottok' });
    owner = await createTestUser({ username: 'voorbeeld-owner-bottok' });
    stranger = await createTestUser({ username: 'voorbeeld-stranger-bottok' });
    await prisma.orgMembership.createMany({
      data: [
        { orgId: ctx.orgId, userId: admin.id, role: 'ADMIN' },
        { orgId: ctx.orgId, userId: owner.id, role: 'MEMBER' },
        { orgId: ctx.orgId, userId: stranger.id, role: 'MEMBER' },
      ],
    });
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: owner.id, role: 'MEMBER' },
    });
    botId = await createBot(ctx.orgId, 'acme-bottok-bot', [owner.id], admin.token);
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: botId, role: 'MEMBER' },
    });
    const issue = await authPost(`/api/projects/${ctx.projectId}/issues`, ctx.owner.token, {
      title: 'Voorbeeld issue for the bot',
    });
    expect(issue.status).toBe(201);
    issuePath = `/api/projects/${ctx.projectId}/issues/${issue.body.number}`;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: { in: otherOrgs } } });
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({
      where: { id: { in: [admin.id, owner.id, stranger.id, ...bots] } },
    });
  });

  it('an org admin creates a token: raw once, expiring 90 days out by default', async () => {
    const before = Date.now();
    const token = await mint(botId);
    expect(token.token).toMatch(/^tk_[0-9a-f]{96}$/);
    const expiresAt = new Date(token.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 90 * DAY - MINUTE);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 90 * DAY + MINUTE);

    const stored = await prisma.apiToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(stored.userId).toBe(botId);
    expect(stored.tokenHash).not.toBe(token.token);
  });

  it('expiresInDays above 365 gives 400 and makes nothing', async () => {
    const count = await prisma.apiToken.count({ where: { userId: botId } });
    const res = await createToken(botId, {
      name: 'Too long',
      scopes: ['issues:read'],
      expiresInDays: 400,
    });
    expect(res.status).toBe(400);
    const none = await createToken(botId, {
      name: 'Zero',
      scopes: ['issues:read'],
      expiresInDays: 0,
    });
    expect(none.status).toBe(400);
    expect(await prisma.apiToken.count({ where: { userId: botId } })).toBe(count);
  });

  it('an admin scope gives 400 and makes nothing', async () => {
    const count = await prisma.apiToken.count({ where: { userId: botId } });
    for (const scope of ['admin:read', 'admin:write']) {
      const res = await createToken(botId, { name: 'Admin', scopes: ['issues:read', scope] });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SERVICE_ACCOUNT_ADMIN_SCOPE');
    }
    expect(await prisma.apiToken.count({ where: { userId: botId } })).toBe(count);
  });

  it("the bot's token reads an issue in a team it belongs to", async () => {
    const token = await mint(botId);
    const res = await withToken('get', issuePath, token.token);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Voorbeeld issue for the bot');
  });

  it('an owner creates and rotates; both work until the old one expires, at most 7 days out', async () => {
    const old = await createToken(
      botId,
      { name: 'Rotated', scopes: ['issues:read'], expiresInDays: 30 },
      owner.token,
    );
    expect(old.status).toBe(201);

    const before = Date.now();
    const res = await authPost(
      `/api/service-accounts/${botId}/tokens/${old.body.id}/rotate`,
      owner.token,
    );
    expect(res.status).toBe(201);
    expect(res.body.id).not.toBe(old.body.id);
    expect(res.body.token).toMatch(/^tk_/);
    expect(res.body).toMatchObject({ name: 'Rotated', scopes: ['issues:read'] });
    const fresh = new Date(res.body.expiresAt).getTime();
    expect(fresh).toBeGreaterThanOrEqual(before + 30 * DAY - MINUTE);
    expect(fresh).toBeLessThanOrEqual(Date.now() + 30 * DAY + MINUTE);

    const oldRow = await prisma.apiToken.findUniqueOrThrow({ where: { id: old.body.id } });
    const oldExpiry = oldRow.expiresAt!.getTime();
    expect(oldExpiry).toBeGreaterThanOrEqual(before + 7 * DAY - MINUTE);
    expect(oldExpiry).toBeLessThanOrEqual(Date.now() + 7 * DAY + MINUTE);

    expect((await withToken('get', issuePath, old.body.token)).status).toBe(200);
    expect((await withToken('get', issuePath, res.body.token)).status).toBe(200);

    // Past the old token's new expiry, only the new one works
    await prisma.apiToken.update({
      where: { id: old.body.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await withToken('get', issuePath, old.body.token)).status).toBe(401);
    expect((await withToken('get', issuePath, res.body.token)).status).toBe(200);
  });

  it('rotation keeps an old expiry that is sooner than 7 days', async () => {
    const old = await mint(botId, { expiresInDays: 1 });
    const res = await authPost(
      `/api/service-accounts/${botId}/tokens/${old.id}/rotate`,
      admin.token,
    );
    expect(res.status).toBe(201);
    const oldRow = await prisma.apiToken.findUniqueOrThrow({ where: { id: old.id } });
    expect(oldRow.expiresAt!.toISOString()).toBe(new Date(old.expiresAt).toISOString());
    const fresh = new Date(res.body.expiresAt).getTime();
    expect(fresh).toBeGreaterThan(Date.now() + DAY - MINUTE);
    expect(fresh).toBeLessThan(Date.now() + DAY + MINUTE);
  });

  it('revoke gives 401 at once', async () => {
    const token = await mint(botId);
    expect((await withToken('get', issuePath, token.token)).status).toBe(200);
    const res = await authDel(`/api/service-accounts/${botId}/tokens/${token.id}`, owner.token);
    expect(res.status).toBe(204);
    expect(await prisma.apiToken.count({ where: { id: token.id } })).toBe(0);
    expect((await withToken('get', issuePath, token.token)).status).toBe(401);
  });

  it('someone neither admin nor owner gets 404, and a token of another bot 404', async () => {
    const token = await mint(botId);
    const create = await createToken(
      botId,
      { name: 'Mine', scopes: ['issues:read'] },
      stranger.token,
    );
    expect(create.status).toBe(404);
    const rotate = await authPost(
      `/api/service-accounts/${botId}/tokens/${token.id}/rotate`,
      stranger.token,
    );
    expect(rotate.status).toBe(404);
    const revoke = await authDel(
      `/api/service-accounts/${botId}/tokens/${token.id}`,
      stranger.token,
    );
    expect(revoke.status).toBe(404);

    const other = await createBot(ctx.orgId, 'acme-bottok-other', [owner.id], admin.token);
    const wrongBot = await authDel(
      `/api/service-accounts/${other}/tokens/${token.id}`,
      admin.token,
    );
    expect(wrongBot.status).toBe(404);
    const wrongRotate = await authPost(
      `/api/service-accounts/${other}/tokens/${token.id}/rotate`,
      admin.token,
    );
    expect(wrongRotate.status).toBe(404);
    // A person's own token is no bot token
    const personal = await prisma.apiToken.create({
      data: {
        userId: owner.id,
        name: 'Personal',
        tokenHash: `bottok-${Date.now()}`,
        prefix: 'tk_00000000',
        scopes: [],
      },
    });
    const personalRevoke = await authDel(
      `/api/service-accounts/${botId}/tokens/${personal.id}`,
      admin.token,
    );
    expect(personalRevoke.status).toBe(404);
    expect(await prisma.apiToken.count({ where: { id: { in: [token.id, personal.id] } } })).toBe(2);
  });

  it("a suspended bot's token gives 401", async () => {
    const token = await mint(botId);
    await prisma.serviceAccount.update({
      where: { userId: botId },
      data: { status: 'SUSPENDED', suspendedReason: 'MANUAL', suspendedAt: new Date() },
    });
    try {
      expect((await withToken('get', issuePath, token.token)).status).toBe(401);
    } finally {
      await prisma.serviceAccount.update({
        where: { userId: botId },
        data: { status: 'ACTIVE', suspendedReason: null, suspendedAt: null },
      });
    }
    expect((await withToken('get', issuePath, token.token)).status).toBe(200);
  });

  it('Review Focus 4: a real bot token is refused token.create for want of an admin scope', async () => {
    // A bot can never hold admin:*, and token.create is an admin action: the scope refuses it
    const { token } = await mint(botId);
    const before = await prisma.apiToken.count({ where: { userId: botId } });
    const res = await withToken('post', '/api/users/me/tokens', token).send({
      name: 'Escalate',
      scopes: ['issues:read'],
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SCOPE');
    expect(await prisma.apiToken.count({ where: { userId: botId } })).toBe(before);
    expect(await prisma.agentApproval.count({ where: { userId: botId } })).toBe(0);
  });

  it('Review Focus 4: with every scope, only uiOnly or tokenBlocked refuses the bot', async () => {
    const minted = await mint(botId);
    // Wider than any bot can be given: no scope check can be what refuses below
    await prisma.apiToken.update({
      where: { id: minted.id },
      data: { scopes: [...TOKEN_SCOPES] },
    });
    const token = minted.token;
    // The token itself works: what refuses below is the action, not the token
    const control = await withToken('get', `/api/service-accounts/${botId}`, token);
    expect(control.status).not.toBe(403);

    const tokensBefore = await prisma.apiToken.count({ where: { userId: botId } });
    const ownersBefore = await prisma.serviceAccountOwner.findMany({
      where: { serviceAccountId: botId },
    });
    const profileBefore = await prisma.user.findUniqueOrThrow({ where: { id: botId } });
    const membershipsBefore = await prisma.orgMembership.count({ where: { userId: botId } });

    const refused = [
      // tokenBlocked
      withToken('post', `/api/orgs/${ctx.orgId}/invites`, token).send({ role: 'MEMBER' }),
      withToken('patch', '/api/users/me', token).send({ displayName: 'Renamed by itself' }),
      withToken('post', '/api/invitations/voorbeeld-invite-code/accept', token).send({}),
      // uiOnly
      withToken('post', `/api/orgs/${ctx.orgId}/service-accounts`, token).send({
        username: 'acme-bottok-spawn',
        displayName: 'Spawn',
        ownerIds: [owner.id],
      }),
      withToken('put', `/api/service-accounts/${botId}/owners`, token).send({
        ownerIds: [stranger.id],
      }),
      withToken('post', `/api/service-accounts/${botId}/tokens`, token).send({
        name: 'Self',
        scopes: ['issues:read'],
      }),
      withToken('post', `/api/service-accounts/${botId}/tokens/${minted.id}/rotate`, token),
      withToken('delete', `/api/service-accounts/${botId}/tokens/${minted.id}`, token),
    ];
    for (const pending of refused) {
      const res = await pending;
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');
    }

    expect(await prisma.apiToken.count({ where: { userId: botId } })).toBe(tokensBefore);
    expect(await prisma.apiToken.count({ where: { id: minted.id } })).toBe(1);
    expect(await prisma.agentApproval.count({ where: { userId: botId } })).toBe(0);
    expect(await prisma.inviteLink.count({ where: { orgId: ctx.orgId } })).toBe(0);
    expect(await prisma.user.count({ where: { username: 'acme-bottok-spawn' } })).toBe(0);
    expect(await prisma.orgMembership.count({ where: { userId: botId } })).toBe(membershipsBefore);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: botId } })).displayName).toBe(
      profileBefore.displayName,
    );
    expect(
      await prisma.serviceAccountOwner.findMany({ where: { serviceAccountId: botId } }),
    ).toEqual(ownersBefore);
  });

  it('create and rotate refuse a suspended bot with 400', async () => {
    const minted = await mint(botId);
    const before = await prisma.apiToken.count({ where: { userId: botId } });
    await prisma.serviceAccount.update({
      where: { userId: botId },
      data: { status: 'SUSPENDED', suspendedReason: 'MANUAL', suspendedAt: new Date() },
    });
    try {
      const create = await createToken(botId, { name: 'While off', scopes: ['issues:read'] });
      expect(create.status).toBe(400);
      expect(create.body.error.code).toBe('SERVICE_ACCOUNT_SUSPENDED');
      const rotate = await authPost(
        `/api/service-accounts/${botId}/tokens/${minted.id}/rotate`,
        admin.token,
      );
      expect(rotate.status).toBe(400);
      expect(rotate.body.error.code).toBe('SERVICE_ACCOUNT_SUSPENDED');
    } finally {
      await prisma.serviceAccount.update({
        where: { userId: botId },
        data: { status: 'ACTIVE', suspendedReason: null, suspendedAt: null },
      });
    }
    expect(await prisma.apiToken.count({ where: { userId: botId } })).toBe(before);
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: minted.id } });
    expect(row.expiresAt!.toISOString()).toBe(new Date(minted.expiresAt).toISOString());
  });

  it('of two concurrent rotations of one token, only one makes a new token', async () => {
    const minted = await mint(botId);
    const before = await prisma.apiToken.count({ where: { userId: botId } });
    const path = `/api/service-accounts/${botId}/tokens/${minted.id}/rotate`;
    const results = await Promise.all([authPost(path, admin.token), authPost(path, owner.token)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect([404, 409]).toContain(statuses[1]);
    expect(await prisma.apiToken.count({ where: { userId: botId } })).toBe(before + 1);

    // Rotating it again later is refused the same way
    const again = await authPost(path, admin.token);
    expect([404, 409]).toContain(again.status);
    expect(await prisma.apiToken.count({ where: { userId: botId } })).toBe(before + 1);
  });

  it("a suspended bot's signed upload URL, or one of a bot that is gone, is refused", async () => {
    const id = await createBot(ctx.orgId, 'acme-bottok-upload', [owner.id], admin.token);
    const minted = await mint(id);
    const url = await createUploadUrl(
      { userId: id, apiTokenId: minted.id },
      { filename: 'notes.txt', mimeType: 'text/plain', size: 10 },
    );
    const sig = new URL(url.uploadUrl, 'https://axiom.invalid').searchParams.get('sig');
    expect((await findUsableIntent(url.uploadId, sig)).id).toBe(url.uploadId);

    await prisma.serviceAccount.update({
      where: { userId: id },
      data: { status: 'SUSPENDED', suspendedReason: 'MANUAL', suspendedAt: new Date() },
    });
    await expect(findUsableIntent(url.uploadId, sig)).rejects.toMatchObject({ statusCode: 403 });

    await prisma.serviceAccount.delete({ where: { userId: id } });
    await expect(findUsableIntent(url.uploadId, sig)).rejects.toMatchObject({ statusCode: 403 });
  });

  it('a token of a deactivated bot, or of a bot whose service account is gone, gives 401', async () => {
    const id = await createBot(ctx.orgId, 'acme-bottok-gone', [owner.id], admin.token);
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: id, role: 'MEMBER' },
    });
    const { token } = await mint(id);
    expect((await withToken('get', issuePath, token)).status).toBe(200);

    await prisma.user.update({ where: { id }, data: { deactivatedAt: new Date() } });
    expect((await withToken('get', issuePath, token)).status).toBe(401);
    await prisma.user.update({ where: { id }, data: { deactivatedAt: null } });
    expect((await withToken('get', issuePath, token)).status).toBe(200);

    // The row alone goes, as an org cascade would take it: the user and token stay
    await prisma.serviceAccount.delete({ where: { userId: id } });
    expect((await withToken('get', issuePath, token)).status).toBe(401);
  });

  it("deleting an org revokes its bots' tokens", async () => {
    const orgRes = await authPost('/api/orgs', admin.token, {
      name: 'Voorbeeld bottok org',
      slug: `voorbeeld-bottok-${Date.now()}`,
    });
    expect(orgRes.status).toBe(201);
    otherOrgs.push(orgRes.body.id);
    const id = await createBot(orgRes.body.id, 'acme-bottok-orgbot', [admin.id], admin.token);
    const res = await createToken(id, { name: 'Org bot', scopes: ['orgs:read'] });
    expect(res.status).toBe(201);
    expect(
      (await withToken('get', `/api/orgs/${orgRes.body.id}/service-accounts`, res.body.token))
        .status,
    ).not.toBe(401);

    const pending = await prisma.agentApproval.create({
      data: {
        userId: id,
        apiTokenId: res.body.id,
        apiTokenName: 'Org bot',
        channel: 'rest-token',
        action: 'issue.delete',
        input: {},
        preview: 'Delete an issue',
        expiresAt: new Date(Date.now() + DAY),
      },
    });

    const del = await authDel(`/api/orgs/${orgRes.body.id}`, admin.token);
    expect(del.status).toBe(204);
    expect(await prisma.apiToken.count({ where: { userId: id } })).toBe(0);
    expect((await withToken('get', '/api/users/me', res.body.token)).status).toBe(401);
    const cancelled = await prisma.agentApproval.findUniqueOrThrow({ where: { id: pending.id } });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.decidedAt).not.toBeNull();
  });

  it('deactivateUser refuses a bot: suspension is the one off switch', async () => {
    await expect(deactivateUser(botId)).rejects.toMatchObject({
      statusCode: 400,
      code: 'SERVICE_ACCOUNT_USE_SUSPEND',
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: botId } });
    expect(user.deactivatedAt).toBeNull();
  });

  it('reactivateUser refuses a bot', async () => {
    await expect(reactivateUser(botId)).rejects.toMatchObject({
      statusCode: 400,
      code: 'SERVICE_ACCOUNT_MANAGED_BY_ORG',
    });
  });
});
