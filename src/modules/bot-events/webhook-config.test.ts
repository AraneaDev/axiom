import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';

import { prisma } from '../../config/database';
import { decryptSecret, secretContext } from '../../lib/secret-box';
import { MINTABLE_SCOPES } from '../../middleware/token-scopes';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authGet, authPost, authPut } from '../../test/helpers';
import { createServiceAccount } from '../service-accounts/service-accounts.service';
import * as usersService from '../users/users.service';

import { readBotWebhookSecret } from './webhook-config.service';
import { assertWebhookUrl } from './webhook-url';

// A literal public address: the check needs no DNS
const URL_OK = 'https://93.184.216.34/hooks/axiom';
const URL_OTHER = 'https://93.184.216.35/hooks/other';

describe('bot webhook config', () => {
  let ctx: TestContext;
  let other: TestContext;
  let member: TestUser;
  let botId: string;
  const botIds: string[] = [];
  const env = { ...process.env };

  const path = (id = botId) => `/api/service-accounts/${id}/webhook`;

  async function makeBot(username: string): Promise<string> {
    const bot = await createServiceAccount(ctx.orgId, ctx.owner.id, {
      username,
      displayName: `Bot ${username}`,
      ownerIds: [ctx.owner.id],
    });
    botIds.push(bot.id);
    return bot.id;
  }

  beforeAll(async () => {
    ctx = await createTestContext('botwebhook');
    other = await createTestContext('botwebhook2');
    member = await addMemberToContext(ctx, {
      email: 'voorbeeld-member@botwebhook.invalid',
      username: 'voorbeeld-member-botwebhook',
    });
    botId = await makeBot('acme-hook-bot');
  });

  afterEach(() => {
    process.env.NODE_ENV = env.NODE_ENV;
    if (env.AXIOM_BOT_WEBHOOK_ALLOW_LOCAL === undefined) {
      delete process.env.AXIOM_BOT_WEBHOOK_ALLOW_LOCAL;
    } else {
      process.env.AXIOM_BOT_WEBHOOK_ALLOW_LOCAL = env.AXIOM_BOT_WEBHOOK_ALLOW_LOCAL;
    }
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await cleanupTestContext(other);
    await prisma.auditLog.deleteMany({ where: { userId: { in: botIds } } });
    await prisma.user.deleteMany({ where: { id: { in: botIds } } });
  });

  it('set creates the webhook and returns the secret once', async () => {
    const res = await authPut(path(), ctx.owner.token, { url: URL_OK });
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^whsec_/);
    expect(res.body.webhook).toMatchObject({
      url: URL_OK,
      status: 'ACTIVE',
      consecutiveFailures: 0,
    });
    const row = await prisma.botWebhook.findUniqueOrThrow({ where: { botId } });
    expect(row.secret.startsWith('enc:v1:')).toBe(true);
    expect(readBotWebhookSecret(row)).toBe(res.body.secret);
    expect(decryptSecret(row.secret, secretContext('botWebhook', 'secret', row.id))).toBe(
      res.body.secret,
    );
  });

  it('get never returns the secret', async () => {
    const res = await authGet(path(), ctx.owner.token);
    expect(res.status).toBe(200);
    expect(res.body.webhook.url).toBe(URL_OK);
    expect(JSON.stringify(res.body)).not.toMatch(/whsec_|enc:v1|secret/);
    expect(res.body.deliveries).toEqual([]);
  });

  it('get on a bot with no webhook returns null', async () => {
    const bare = await makeBot('acme-bare-hook-bot');
    const res = await authGet(path(bare), ctx.owner.token);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ webhook: null, deliveries: [] });
  });

  it('changing the URL keeps the secret and returns none', async () => {
    const before = await prisma.botWebhook.findUniqueOrThrow({ where: { botId } });
    const res = await authPut(path(), ctx.owner.token, { url: URL_OTHER });
    expect(res.status).toBe(200);
    expect(res.body.secret).toBeUndefined();
    expect(res.body.webhook.url).toBe(URL_OTHER);
    const after = await prisma.botWebhook.findUniqueOrThrow({ where: { botId } });
    expect(after.secret).toBe(before.secret);
    expect(after.id).toBe(before.id);
  });

  it('rotate returns a new secret and the old one no longer decrypts equal', async () => {
    const before = await prisma.botWebhook.findUniqueOrThrow({ where: { botId } });
    const oldSecret = readBotWebhookSecret(before);
    const res = await authPost(`${path()}/rotate-secret`, ctx.owner.token, {});
    expect(res.status).toBe(200);
    expect(res.body.secret).toMatch(/^whsec_/);
    expect(res.body.secret).not.toBe(oldSecret);
    const after = await prisma.botWebhook.findUniqueOrThrow({ where: { botId } });
    expect(after.secret.startsWith('enc:v1:')).toBe(true);
    expect(readBotWebhookSecret(after)).toBe(res.body.secret);
    expect(readBotWebhookSecret(after)).not.toBe(oldSecret);
  });

  describe('the URL check', () => {
    it('a non-https URL is refused', async () => {
      await expect(assertWebhookUrl('http://93.184.216.34/x')).rejects.toThrow(/HTTPS/);
      const res = await authPut(path(), ctx.owner.token, { url: 'http://93.184.216.34/x' });
      expect(res.status).toBe(400);
    });

    it('a URL with credentials is refused', async () => {
      await expect(assertWebhookUrl('https://user:pw@93.184.216.34/x')).rejects.toThrow(
        /credentials/,
      );
    });

    it('https://127.0.0.1 and https://10.0.0.5 are refused', async () => {
      await expect(assertWebhookUrl('https://127.0.0.1/x')).rejects.toThrow(/private/);
      await expect(assertWebhookUrl('https://10.0.0.5/x')).rejects.toThrow(/private/);
      const res = await authPut(path(), ctx.owner.token, { url: 'https://10.0.0.5/x' });
      expect(res.status).toBe(400);
    });

    it('http://localhost is refused unless AXIOM_BOT_WEBHOOK_ALLOW_LOCAL=1 outside production', async () => {
      delete process.env.AXIOM_BOT_WEBHOOK_ALLOW_LOCAL;
      await expect(assertWebhookUrl('http://localhost:9000/x')).rejects.toThrow();

      process.env.AXIOM_BOT_WEBHOOK_ALLOW_LOCAL = '1';
      process.env.NODE_ENV = 'development';
      await expect(assertWebhookUrl('http://localhost:9000/x')).resolves.toBeUndefined();
      await expect(assertWebhookUrl('http://127.0.0.1:9000/x')).resolves.toBeUndefined();
      await expect(assertWebhookUrl('http://[::1]:9000/x')).resolves.toBeUndefined();
      // Only those hosts, and never with credentials
      await expect(assertWebhookUrl('http://10.0.0.5/x')).rejects.toThrow();
      await expect(assertWebhookUrl('http://user:pw@localhost/x')).rejects.toThrow();
    });

    it('is refused in production even with the flag', async () => {
      process.env.AXIOM_BOT_WEBHOOK_ALLOW_LOCAL = '1';
      process.env.NODE_ENV = 'production';
      await expect(assertWebhookUrl('http://localhost:9000/x')).rejects.toThrow();
    });
  });

  describe('who may call', () => {
    it('a member who is neither owner nor org admin is refused on every action', async () => {
      const calls = [
        authGet(path(), member.token),
        authPut(path(), member.token, { url: URL_OK }),
        authPost(`${path()}/rotate-secret`, member.token, {}),
        authPost(`${path()}/resume`, member.token, {}),
        authDel(path(), member.token),
      ];
      const statuses = (await Promise.all(calls)).map((r) => r.status);
      // The bot is "not found" to anyone who may not manage it, as for its tokens
      expect(statuses).toEqual([404, 404, 404, 404, 404]);
      expect(await prisma.botWebhook.count({ where: { botId } })).toBe(1);
    });

    it('a token is refused UI_ONLY on set, rotate, delete and resume', async () => {
      const { token } = await usersService.createApiToken(ctx.owner.id, {
        name: 'hook-probe',
        scopes: [...MINTABLE_SCOPES],
      });
      const request = (await import('supertest')).default;
      const app = (await import('../../index')).default;
      const send = (method: 'put' | 'post' | 'delete' | 'get', url: string, body?: object) => {
        const req = request(app)[method](url);
        return req
          .set('Authorization', `Token ${token}`)
          .set('X-Requested-With', 'XMLHttpRequest')
          .send(body);
      };
      for (const res of [
        await send('put', path(), { url: URL_OK }),
        await send('post', `${path()}/rotate-secret`, {}),
        await send('delete', path()),
        await send('post', `${path()}/resume`, {}),
      ]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('UI_ONLY');
      }
      expect((await send('get', path())).status).toBe(200);
      expect(await prisma.botWebhook.count({ where: { botId } })).toBe(1);
    });
  });

  it('resume clears the pause and the failure count', async () => {
    await prisma.botWebhook.update({
      where: { botId },
      data: { status: 'PAUSED', consecutiveFailures: 10, pausedAt: new Date() },
    });
    const res = await authPost(`${path()}/resume`, ctx.owner.token, {});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ACTIVE', consecutiveFailures: 0, pausedAt: null });
    const row = await prisma.botWebhook.findUniqueOrThrow({ where: { botId } });
    expect(row).toMatchObject({ status: 'ACTIVE', consecutiveFailures: 0, pausedAt: null });
  });

  it('deliveries list holds the newest 50 and hides the key of an issue the viewer can not read', async () => {
    const mine = { issue: { key: `${ctx.projectPrefix}-1` }, project: { id: ctx.projectId } };
    const foreign = { issue: { key: 'SECRET-9' }, project: { id: other.projectId } };
    for (let i = 0; i < 55; i++) {
      await prisma.botEvent.create({
        data: {
          botId,
          type: 'issue.assigned',
          payload: i === 54 ? foreign : i === 53 ? mine : { n: i },
        },
      });
    }
    // The viewer reads ctx's team, not the other org's
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: member.id, orgId: ctx.orgId } },
      data: { role: 'ADMIN' },
    });
    const res = await authGet(path(), member.token);
    expect(res.status).toBe(200);
    const list = res.body.deliveries as Array<{ issueKey: string | null; type: string }>;
    expect(list).toHaveLength(50);
    expect(list[0].issueKey).toBeNull();
    expect(list[1].issueKey).toBe(`${ctx.projectPrefix}-1`);
    expect(list[2].issueKey).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('SECRET-9');
    expect(res.body.deliveries[0]).not.toHaveProperty('payload');
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: member.id, orgId: ctx.orgId } },
      data: { role: 'MEMBER' },
    });
    await prisma.botEvent.deleteMany({ where: { botId } });
  });

  it('an org admin not on the project team sees no issue key', async () => {
    // A second team in the same org, which the admin is not on
    const team = await prisma.team.create({
      data: { orgId: ctx.orgId, name: 'Voorbeeld closed team', slug: 'voorbeeld-closed-team' },
    });
    const project = await prisma.project.create({
      data: { teamId: team.id, name: 'Closed', slug: 'closed', prefix: 'CLSD' },
    });
    await prisma.botEvent.create({
      data: {
        botId,
        type: 'issue.assigned',
        payload: { issue: { key: 'CLSD-3' }, project: { id: project.id } },
      },
    });
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: member.id, orgId: ctx.orgId } },
      data: { role: 'ADMIN' },
    });
    try {
      const res = await authGet(path(), member.token);
      expect(res.status).toBe(200);
      expect(res.body.deliveries[0].issueKey).toBeNull();
      expect(JSON.stringify(res.body)).not.toContain('CLSD-3');
    } finally {
      await prisma.orgMembership.update({
        where: { userId_orgId: { userId: member.id, orgId: ctx.orgId } },
        data: { role: 'MEMBER' },
      });
      await prisma.botEvent.deleteMany({ where: { botId } });
      await prisma.team.delete({ where: { id: team.id } });
    }
  });

  it('delete removes pending events and the webhook', async () => {
    await prisma.botEvent.createMany({
      data: [
        { botId, type: 'issue.assigned', payload: {} },
        { botId, type: 'issue.assigned', payload: {}, status: 'DELIVERED' },
      ],
    });
    const res = await authDel(path(), ctx.owner.token);
    expect(res.status).toBe(204);
    expect(await prisma.botWebhook.count({ where: { botId } })).toBe(0);
    expect(await prisma.botEvent.count({ where: { botId, status: 'PENDING' } })).toBe(0);
    expect(await prisma.botEvent.count({ where: { botId, status: 'DELIVERED' } })).toBe(1);
  });

  it('deleting the bot cascades both tables', async () => {
    const id = await makeBot('acme-cascade-hook-bot');
    await authPut(path(id), ctx.owner.token, { url: URL_OK });
    await prisma.botEvent.create({ data: { botId: id, type: 'issue.assigned', payload: {} } });
    await prisma.user.delete({ where: { id } });
    expect(await prisma.botWebhook.count({ where: { botId: id } })).toBe(0);
    expect(await prisma.botEvent.count({ where: { botId: id } })).toBe(0);
  });
});
