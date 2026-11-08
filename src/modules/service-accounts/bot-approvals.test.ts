/**
 * Approvals for bots: a bot token's call that needs approval waits for the bot's owners, seven
 * days by default, and runs as the bot with the bot's rights when an owner approves it.
 */
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';
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
import { authDel, authGet, authPost, authPut } from '../../test/helpers';
import { cancelPendingFor } from '../agent-approvals/agent-approvals.cleanup';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Every scope a bot can hold: all mintable ones but admin */
const BOT_SCOPES = MINTABLE_SCOPES.filter((s) => !s.startsWith('admin:'));

const runs: string[] = [];

registerActions([
  defineAction({
    name: 'botApprovalTest.admin',
    admin: true,
    area: 'issues',
    kind: 'write',
    summary: 'A test admin action',
    input: z.object({ projectId: z.string() }),
    output: z.looseObject({ id: z.string() }),
    authorize: () => Promise.resolve(),
    handler: () => {
      runs.push('admin');
      return Promise.resolve({ id: 'admin' });
    },
  }),
  defineAction({
    name: 'botApprovalTest.always',
    alwaysApprove: true,
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'A test action that always waits',
    input: z.object({ projectId: z.string() }),
    output: z.looseObject({ id: z.string() }),
    authorize: () => Promise.resolve(),
    handler: () => {
      runs.push('always');
      return Promise.resolve({ id: 'always' });
    },
  }),
]);

/**
 * A request made with an API token.
 * @param method - The HTTP method
 * @param path - The path
 * @param raw - The raw token
 */
function withToken(method: 'get' | 'post' | 'patch' | 'delete', path: string, raw: string) {
  const req = request(app)[method](path);
  return req.set('Authorization', `Token ${raw}`).set('X-Requested-With', 'XMLHttpRequest');
}

describe('service accounts: approvals for bots', () => {
  let ctx: TestContext;
  let admin: TestUser;
  let owner: TestUser;
  let stranger: TestUser;
  let botId: string;
  let botToken: string;
  let nextNumber = 5000;

  beforeAll(async () => {
    ctx = await createTestContext('botappr');
    admin = await createTestUser({ username: 'voorbeeld-admin-botappr' });
    owner = await createTestUser({ username: 'voorbeeld-owner-botappr' });
    stranger = await createTestUser({ username: 'voorbeeld-stranger-botappr' });
    await prisma.orgMembership.createMany({
      data: [
        { orgId: ctx.orgId, userId: admin.id, role: 'ADMIN' },
        { orgId: ctx.orgId, userId: owner.id, role: 'MEMBER' },
        { orgId: ctx.orgId, userId: stranger.id, role: 'MEMBER' },
      ],
    });
    await prisma.teamMembership.createMany({
      data: [
        { teamId: ctx.teamId, userId: owner.id, role: 'MEMBER' },
        { teamId: ctx.teamId, userId: stranger.id, role: 'MEMBER' },
      ],
    });
    const bot = await authPost(`/api/orgs/${ctx.orgId}/service-accounts`, admin.token, {
      username: 'acme-botappr-bot',
      displayName: 'Acme triage bot',
      ownerIds: [owner.id],
    });
    expect(bot.status).toBe(201);
    botId = bot.body.id;
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: botId, role: 'MEMBER' },
    });
    const token = await authPost(`/api/service-accounts/${botId}/tokens`, admin.token, {
      name: 'Nightly triage',
      scopes: BOT_SCOPES,
    });
    expect(token.status).toBe(201);
    botToken = token.body.token;
  });

  beforeEach(async () => {
    runs.length = 0;
    await prisma.agentApproval.deleteMany({ where: { userId: botId } });
    await prisma.agentPolicy.deleteMany({ where: { orgId: ctx.orgId } });
  });

  afterAll(async () => {
    await prisma.agentPolicy.deleteMany({ where: { orgId: ctx.orgId } });
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({
      where: { id: { in: [admin.id, owner.id, stranger.id, botId] } },
    });
  });

  async function createIssue(title = 'Voorbeeld issue for the bot') {
    const number = nextNumber++;
    const issue = await prisma.issue.create({
      data: { projectId: ctx.projectId, number, title, body: '', creatorId: ctx.owner.id },
    });
    return { id: issue.id, number };
  }

  /**
   * The bot deletes an issue, which waits for approval.
   * @param number - The issue's number
   */
  async function botDeletes(number: number) {
    const res = await withToken(
      'delete',
      `/api/projects/${ctx.projectId}/issues/${number}`,
      botToken,
    );
    expect(res.status).toBe(202);
    return res.body as { approvalId: string; expiresAt: string; status: string };
  }

  function approve(id: string, who: TestUser = owner) {
    return authPost(`/api/agent-approvals/${id}/approve`, who.token);
  }

  it("a bot token's destructive call gives 202, expiring 7 days out", async () => {
    const issue = await createIssue();
    const before = Date.now();
    const pending = await botDeletes(issue.number);
    expect(pending.status).toBe('pending_approval');
    const expiresAt = new Date(pending.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY - MINUTE);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 7 * DAY + MINUTE);
    const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id: pending.approvalId } });
    expect(row.userId).toBe(botId);
    expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
  });

  it("the owner's list shows it with the bot's name, and a non-owner's doesn't", async () => {
    const issue = await createIssue();
    const pending = await botDeletes(issue.number);

    const mine = await authGet('/api/agent-approvals', owner.token);
    expect(mine.status).toBe(200);
    const shown = mine.body.data.find((r: { id: string }) => r.id === pending.approvalId);
    expect(shown).toMatchObject({
      status: 'PENDING',
      serviceAccount: { id: botId, displayName: 'Acme triage bot' },
    });
    const one = await authGet(`/api/agent-approvals/${pending.approvalId}`, owner.token);
    expect(one.status).toBe(200);
    expect(one.body.serviceAccount).toEqual({ id: botId, displayName: 'Acme triage bot' });

    const theirs = await authGet('/api/agent-approvals', stranger.token);
    expect(theirs.status).toBe(200);
    expect(theirs.body.data.map((r: { id: string }) => r.id)).not.toContain(pending.approvalId);
    const peek = await authGet(`/api/agent-approvals/${pending.approvalId}`, stranger.token);
    expect(peek.status).toBe(404);

    // The owner's own requests carry no bot marker
    const own = await prisma.agentApproval.create({
      data: {
        userId: owner.id,
        channel: 'rest-token',
        action: 'issue.delete',
        input: {},
        preview: 'Own request',
        expiresAt: new Date(Date.now() + 60 * MINUTE),
      },
    });
    try {
      const both = await authGet('/api/agent-approvals', owner.token);
      const ownShown = both.body.data.find((r: { id: string }) => r.id === own.id);
      expect(ownShown).toBeDefined();
      expect(ownShown.serviceAccount).toBeUndefined();
    } finally {
      await prisma.agentApproval.delete({ where: { id: own.id } });
    }
  });

  it('the owner approves and it runs as the bot; the audit names who approved', async () => {
    const issue = await createIssue();
    const pending = await botDeletes(issue.number);
    const res = await approve(pending.approvalId);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXECUTED');
    expect(await prisma.issue.findUnique({ where: { id: issue.id } })).toBeNull();

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { userId: botId, action: 'issue.delete' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.details).toMatchObject({
      outcome: 'ok',
      approvalId: pending.approvalId,
      approvedById: owner.id,
    });
  });

  it("an approved bot edit shows in the issue's activity under the bot", async () => {
    await authPut('/api/agent-policy', ctx.owner.token, {
      scope: 'org',
      orgId: ctx.orgId,
      rules: { alsoRequire: ['issue.update'] },
    }).expect(200);
    const issue = await createIssue();
    const pending = await withToken(
      'patch',
      `/api/projects/${ctx.projectId}/issues/${issue.number}`,
      botToken,
    ).send({ title: 'Retitled by the bot' });
    expect(pending.status).toBe(202);
    const res = await approve(pending.body.approvalId);
    expect(res.body.status).toBe('EXECUTED');
    const stored = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(stored.title).toBe('Retitled by the bot');
    const activity = await prisma.activity.findMany({ where: { resourceId: issue.id } });
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((a) => a.userId === botId)).toBe(true);
  });

  it('a non-owner approving or rejecting gives 404 and the request keeps waiting', async () => {
    const issue = await createIssue();
    const pending = await botDeletes(issue.number);
    const res = await approve(pending.approvalId, stranger);
    expect(res.status).toBe(404);
    const rejected = await authPost(
      `/api/agent-approvals/${pending.approvalId}/reject`,
      stranger.token,
    );
    expect(rejected.status).toBe(404);
    const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id: pending.approvalId } });
    expect(row.status).toBe('PENDING');
    expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
  });

  it('the owner rejects, and nothing runs', async () => {
    const issue = await createIssue();
    const pending = await botDeletes(issue.number);
    const res = await authPost(`/api/agent-approvals/${pending.approvalId}/reject`, owner.token);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
    expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
  });

  it("a bot removed from the team since fails with 403: the owner's rights don't help", async () => {
    const issue = await createIssue();
    const pending = await botDeletes(issue.number);
    await prisma.teamMembership.deleteMany({ where: { teamId: ctx.teamId, userId: botId } });
    try {
      const res = await approve(pending.approvalId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('FAILED');
      expect(res.body.error.status).toBe(403);
      expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
    } finally {
      await prisma.teamMembership.create({
        data: { teamId: ctx.teamId, userId: botId, role: 'MEMBER' },
      });
    }
  });

  it('a bot suspended since never runs: the request ends CANCELLED with the reason', async () => {
    const issue = await createIssue();
    const pending = await botDeletes(issue.number);
    await prisma.serviceAccount.update({
      where: { userId: botId },
      data: { status: 'SUSPENDED', suspendedReason: 'MANUAL', suspendedAt: new Date() },
    });
    try {
      const res = await approve(pending.approvalId);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.error).toMatchObject({ code: 'SERVICE_ACCOUNT_SUSPENDED' });
      expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
    } finally {
      await prisma.serviceAccount.update({
        where: { userId: botId },
        data: { status: 'ACTIVE', suspendedReason: null, suspendedAt: null },
      });
    }
  });

  it('a deactivated bot never runs either', async () => {
    const issue = await createIssue();
    const pending = await botDeletes(issue.number);
    await prisma.user.update({ where: { id: botId }, data: { deactivatedAt: new Date() } });
    try {
      const res = await approve(pending.approvalId);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.error).toMatchObject({ code: 'SERVICE_ACCOUNT_DEACTIVATED' });
      expect(await prisma.issue.findUnique({ where: { id: issue.id } })).not.toBeNull();
    } finally {
      await prisma.user.update({ where: { id: botId }, data: { deactivatedAt: null } });
    }
  });

  it('an org policy sets botExpiresMinutes from 60 to 43200; 50000 gives 400', async () => {
    const tooLong = await authPut('/api/agent-policy', ctx.owner.token, {
      scope: 'org',
      orgId: ctx.orgId,
      rules: { botExpiresMinutes: 50000 },
    });
    expect(tooLong.status).toBe(400);
    // The action's input validation names the field; it carries no code
    expect(tooLong.body.error.message).toMatch(/^rules\.botExpiresMinutes: Too big/);
    const tooShort = await authPut('/api/agent-policy', ctx.owner.token, {
      scope: 'org',
      orgId: ctx.orgId,
      rules: { botExpiresMinutes: 59 },
    });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body.error.message).toMatch(/^rules\.botExpiresMinutes: Too small/);
    const own = await authPut('/api/agent-policy', owner.token, {
      scope: 'user',
      rules: { botExpiresMinutes: 120 },
    });
    expect(own.status).toBe(400);
    expect(own.body.error.code).toBe('ORG_ONLY_RULE');

    const ok = await authPut('/api/agent-policy', ctx.owner.token, {
      scope: 'org',
      orgId: ctx.orgId,
      rules: { botExpiresMinutes: 120 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.effective.botExpiresMinutes).toBe(120);
    const issue = await createIssue();
    const before = Date.now();
    const pending = await botDeletes(issue.number);
    const expiresAt = new Date(pending.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 120 * MINUTE - MINUTE);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 120 * MINUTE + MINUTE);
  });

  it('admin and alwaysApprove actions still wait, whatever the org loosens', async () => {
    await authPut('/api/agent-policy', ctx.owner.token, {
      scope: 'org',
      orgId: ctx.orgId,
      rules: { destructive: false },
    }).expect(200);
    for (const action of ['botApprovalTest.admin', 'botApprovalTest.always']) {
      const res = await withToken('post', '/api/act', botToken).send({
        action,
        input: { projectId: ctx.projectId },
      });
      expect(res.status).toBe(202);
      expect(res.body.status).toBe('pending_approval');
    }
    expect(runs).toEqual([]);
  });

  it('cancelPendingFor cancels what waits, with the reason, and leaves decided ones', async () => {
    const waiting = await botDeletes((await createIssue()).number);
    const decided = await botDeletes((await createIssue()).number);
    await authPost(`/api/agent-approvals/${decided.approvalId}/reject`, owner.token).expect(200);

    expect(await cancelPendingFor(botId, 'The bot was suspended')).toBe(1);
    const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id: waiting.approvalId } });
    expect(row.status).toBe('CANCELLED');
    expect(row.decidedAt).not.toBeNull();
    expect(row.error).toMatchObject({ code: 'CANCELLED', message: 'The bot was suspended' });
    const other = await prisma.agentApproval.findUniqueOrThrow({
      where: { id: decided.approvalId },
    });
    expect(other.status).toBe('REJECTED');
    expect(await cancelPendingFor(botId, 'Again')).toBe(0);
    const late = await approve(waiting.approvalId);
    expect(late.status).toBe(409);
  });

  it('deleting a bot cancels its waiting requests through cancelPendingFor', async () => {
    const extra = await authPost(`/api/orgs/${ctx.orgId}/service-accounts`, admin.token, {
      username: 'acme-botappr-gone',
      displayName: 'Acme short-lived bot',
      ownerIds: [owner.id],
    });
    expect(extra.status).toBe(201);
    const goneId = extra.body.id as string;
    try {
      const row = await prisma.agentApproval.create({
        data: {
          userId: goneId,
          channel: 'rest-token',
          action: 'issue.delete',
          input: {},
          preview: 'Waiting',
          expiresAt: new Date(Date.now() + DAY),
        },
      });
      const res = await authDel(`/api/service-accounts/${goneId}`, admin.token);
      expect(res.status).toBe(204);
      const after = await prisma.agentApproval.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe('CANCELLED');
      expect(after.error).toMatchObject({ code: 'CANCELLED' });
    } finally {
      await prisma.user.deleteMany({ where: { id: goneId } });
    }
  });
});
