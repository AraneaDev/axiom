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
import { callTool, connectMcp, serveApp } from '../../test/mcp-client';
import { cancelPendingFor } from '../agent-approvals/agent-approvals.cleanup';

const DAY = 24 * 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/** Every scope a bot can hold: all mintable ones but admin */
const BOT_SCOPES = MINTABLE_SCOPES.filter((s) => !s.startsWith('admin:'));

const runs: string[] = [];
/** Who each run of botApprovalTest.place ran as */
const ranAs: string[] = [];

/** What a stub says instead of the preview */
const STUB = "A request in a place you can't open";

registerActions([
  defineAction({
    name: 'botApprovalTest.place',
    destructive: true,
    area: 'issues',
    kind: 'write',
    summary: 'A test action that touches a project or a space, or neither',
    input: z.object({
      projectId: z.string().optional(),
      spaceId: z.string().optional(),
      value: z.string(),
    }),
    output: z.looseObject({ id: z.string() }),
    preview: (_ctx, { value }) => Promise.resolve(`Touch ${value}`),
    authorize: () => Promise.resolve(),
    handler: (ctx, { value }) => {
      runs.push(value);
      ranAs.push(ctx.userId);
      return Promise.resolve({ id: value });
    },
  }),
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
  /** A second owner, in team B only, of the second bot (owned by owner and owner2) */
  let owner2: TestUser;
  let teamB: string;
  let projectB: string;
  let spaceB: string;
  let bot2Id: string;
  let bot2Token: string;

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

    owner2 = await createTestUser({ username: 'voorbeeld-owner2-botappr' });
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: owner2.id, role: 'MEMBER' },
    });
    teamB = (
      await prisma.team.create({
        data: { orgId: ctx.orgId, name: 'Voorbeeld team B', slug: 'voorbeeld-team-b-botappr' },
      })
    ).id;
    await prisma.teamMembership.create({
      data: { teamId: teamB, userId: owner2.id, role: 'MEMBER' },
    });
    projectB = (
      await prisma.project.create({
        data: { teamId: teamB, name: 'Voorbeeld B', slug: 'voorbeeld-b-botappr', prefix: 'VBB' },
      })
    ).id;
    spaceB = (
      await prisma.wikiSpace.create({
        data: { teamId: teamB, name: 'Voorbeeld wiki B', slug: 'voorbeeld-wiki-b-botappr' },
      })
    ).id;
    const bot2 = await authPost(`/api/orgs/${ctx.orgId}/service-accounts`, admin.token, {
      username: 'acme-botappr-two',
      displayName: 'Acme release bot',
      ownerIds: [owner.id, owner2.id],
    });
    expect(bot2.status).toBe(201);
    bot2Id = bot2.body.id;
    const token2 = await authPost(`/api/service-accounts/${bot2Id}/tokens`, admin.token, {
      name: 'Release notes',
      scopes: BOT_SCOPES,
    });
    expect(token2.status).toBe(201);
    bot2Token = token2.body.token;
  });

  beforeEach(async () => {
    runs.length = 0;
    ranAs.length = 0;
    await prisma.agentApproval.deleteMany({ where: { userId: { in: [botId, bot2Id] } } });
    await prisma.agentPolicy.deleteMany({ where: { orgId: ctx.orgId } });
  });

  afterAll(async () => {
    await prisma.agentPolicy.deleteMany({ where: { orgId: ctx.orgId } });
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({
      where: { id: { in: [admin.id, owner.id, owner2.id, stranger.id, botId, bot2Id] } },
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

  /**
   * The second bot asks for botApprovalTest.place through /api/act, which waits.
   * @param input - Its input: a project, a space, or neither
   * @param raw - The bot token
   */
  async function botTouches(input: Record<string, string>, raw = bot2Token) {
    const res = await withToken('post', '/api/act', raw).send({
      action: 'botApprovalTest.place',
      input,
    });
    expect(res.status).toBe(202);
    return res.body.approvalId as string;
  }

  /**
   * Whether a user was notified of a request.
   * @param userId - The user
   * @param approvalId - The request
   */
  async function notified(userId: string, approvalId: string): Promise<boolean> {
    const count = await prisma.notification.count({
      where: { userId, type: 'agent:approval', link: `/approvals/agent/${approvalId}` },
    });
    return count > 0;
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
      expect(res.body.error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
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
    const adminExempt = await authPut('/api/agent-policy', ctx.owner.token, {
      scope: 'org',
      orgId: ctx.orgId,
      rules: { neverRequire: ['botApprovalTest.admin'] },
    });
    expect(adminExempt.status).toBe(400);
    expect(adminExempt.body.error.message).toMatch(/^neverRequire takes names/);
    await authPut('/api/agent-policy', ctx.owner.token, {
      scope: 'org',
      orgId: ctx.orgId,
      rules: { destructive: false, neverRequire: ['botApprovalTest.always'] },
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

  // ─── Fix round 1: places, eligible owners, channels, refusals ─────────────────

  it('an owner who cannot open the place sees a stub and gets 404; one who can approves', async () => {
    const id = await botTouches({ projectId: projectB, value: 'in-team-b' });
    const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id } });
    expect(row.placeTeamIds).toEqual([teamB]);
    expect(row.placeSpaceIds).toEqual([]);

    const outside = await authGet('/api/agent-approvals', owner.token);
    const stub = outside.body.data.find((r: { id: string }) => r.id === id);
    expect(stub).toMatchObject({
      status: 'PENDING',
      restricted: true,
      preview: STUB,
      serviceAccount: { id: bot2Id, displayName: 'Acme release bot' },
    });
    const detail = await authGet(`/api/agent-approvals/${id}`, owner.token);
    expect(detail.status).toBe(200);
    expect(detail.body.preview).toBe(STUB);
    expect(detail.body.input).toBeUndefined();
    expect(detail.body.result).toBeUndefined();
    expect(JSON.stringify(detail.body)).not.toContain('in-team-b');
    expect((await approve(id, owner)).status).toBe(404);
    expect((await authPost(`/api/agent-approvals/${id}/reject`, owner.token)).status).toBe(404);
    expect(await notified(owner.id, id)).toBe(false);

    expect(await notified(owner2.id, id)).toBe(true);
    const inside = await authGet(`/api/agent-approvals/${id}`, owner2.token);
    expect(inside.body.preview).toBe('Touch in-team-b');
    expect(inside.body.restricted).toBeUndefined();
    const res = await approve(id, owner2);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('EXECUTED');
    expect(ranAs).toEqual([bot2Id]);
    // The stub stays a stub once decided: the result is not the outside owner's to read
    const after = await authGet(`/api/agent-approvals/${id}`, owner.token);
    expect(after.body).toMatchObject({ status: 'EXECUTED', preview: STUB });
    expect(after.body.result).toBeUndefined();
  });

  it('a space is a place too, and an org-level request is any owner to decide', async () => {
    const inSpace = await botTouches({ spaceId: spaceB, value: 'in-space-b' });
    const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id: inSpace } });
    expect(row.placeSpaceIds).toEqual([spaceB]);
    expect((await approve(inSpace, owner)).status).toBe(404);
    expect(await notified(owner.id, inSpace)).toBe(false);

    const orgLevel = await botTouches({ value: 'org-level' });
    expect(await notified(owner.id, orgLevel)).toBe(true);
    expect(await notified(owner2.id, orgLevel)).toBe(true);
    const res = await approve(orgLevel, owner);
    expect(res.body.status).toBe('EXECUTED');
  });

  it('owners are notified of a request, and the bot never is', async () => {
    const issue = await createIssue();
    const pending = await botDeletes(issue.number);
    expect(await notified(owner.id, pending.approvalId)).toBe(true);
    expect(await notified(botId, pending.approvalId)).toBe(false);
    expect(await notified(stranger.id, pending.approvalId)).toBe(false);
  });

  it('an owner demoted to VIEWER no longer sees, decides or hears of requests', async () => {
    const before = await botTouches({ value: 'before-demotion' });
    await prisma.orgMembership.updateMany({
      where: { orgId: ctx.orgId, userId: owner.id },
      data: { role: 'VIEWER' },
    });
    try {
      const list = await authGet('/api/agent-approvals', owner.token);
      expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(before);
      expect((await authGet(`/api/agent-approvals/${before}`, owner.token)).status).toBe(404);
      expect((await approve(before, owner)).status).toBe(404);
      const later = await botTouches({ value: 'after-demotion' });
      expect(await notified(owner.id, later)).toBe(false);
      expect(await notified(owner2.id, later)).toBe(true);
    } finally {
      await prisma.orgMembership.updateMany({
        where: { orgId: ctx.orgId, userId: owner.id },
        data: { role: 'MEMBER' },
      });
    }
  });

  it('a former owner, an org admin who is no owner and the bot itself cannot decide', async () => {
    const id = await botTouches({ value: 'who-decides' });
    const removed = await authPut(`/api/service-accounts/${bot2Id}/owners`, admin.token, {
      ownerIds: [owner2.id],
    });
    expect(removed.status).toBe(200);
    try {
      const list = await authGet('/api/agent-approvals', owner.token);
      expect(list.body.data.map((r: { id: string }) => r.id)).not.toContain(id);
      expect((await authGet(`/api/agent-approvals/${id}`, owner.token)).status).toBe(404);
      expect((await approve(id, owner)).status).toBe(404);
    } finally {
      await authPut(`/api/service-accounts/${bot2Id}/owners`, admin.token, {
        ownerIds: [owner.id, owner2.id],
      }).expect(200);
    }

    const byAdmin = await approve(id, admin);
    expect(byAdmin.status).toBe(404);
    const adminList = await authGet('/api/agent-approvals', admin.token);
    expect(adminList.body.data.map((r: { id: string }) => r.id)).not.toContain(id);

    const byBot = await withToken('post', `/api/agent-approvals/${id}/approve`, bot2Token);
    expect(byBot.status).toBe(403);
    expect(byBot.body.error.code).toBe('SCOPE');
    const byBotReject = await withToken('post', `/api/agent-approvals/${id}/reject`, bot2Token);
    expect(byBotReject.status).toBe(403);
    expect(byBotReject.body.error.code).toBe('SCOPE');
    const row = await prisma.agentApproval.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('PENDING');
    expect(runs).toEqual([]);
  });

  it("the bot's token lists only what that token asked", async () => {
    const other = await authPost(`/api/service-accounts/${bot2Id}/tokens`, admin.token, {
      name: 'Second token',
      scopes: BOT_SCOPES,
    });
    expect(other.status).toBe(201);
    const mine = await botTouches({ value: 'from-first' });
    const theirs = await botTouches({ value: 'from-second' }, other.body.token);
    const list = await withToken('get', '/api/agent-approvals', bot2Token);
    expect(list.status).toBe(200);
    const ids = list.body.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it('a request made over /api/act and one over MCP both run as the bot', async () => {
    const viaAct = await botTouches({ value: 'over-act' });
    const served = await serveApp();
    const client = await connectMcp(served.base, `Token ${bot2Token}`);
    let viaMcp: string;
    try {
      const answer = await callTool(client, 'act', {
        action: 'botApprovalTest.place',
        input: { value: 'over-mcp' },
      });
      expect(answer.data.status).toBe('pending_approval');
      viaMcp = answer.data.approvalId;
    } finally {
      await client.close();
      await served.close();
    }
    for (const id of [viaAct, viaMcp]) {
      const res = await approve(id, owner);
      expect(res.body.status).toBe('EXECUTED');
    }
    expect(runs).toEqual(['over-act', 'over-mcp']);
    expect(ranAs).toEqual([bot2Id, bot2Id]);
    const audits = (
      await prisma.auditLog.findMany({
        where: {
          userId: bot2Id,
          action: 'botApprovalTest.place',
          details: { path: ['outcome'], equals: 'ok' },
        },
      })
    ).filter((a) => [viaAct, viaMcp].includes((a.details as { approvalId: string }).approvalId));
    expect(audits.map((a) => (a.details as { channel: string }).channel).sort()).toEqual([
      'mcp',
      'rest-token',
    ]);
    expect(
      audits.every((a) => (a.details as { approvedById: string }).approvedById === owner.id),
    ).toBe(true);
  });

  it('a bot token cannot give the bot rules of its own', async () => {
    const put = await request(app)
      .put('/api/agent-policy')
      .set('Authorization', `Token ${bot2Token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ scope: 'user', rules: { alsoRequire: ['issue.update'] } });
    expect(put.status).toBe(400);
    expect(put.body.error.code).toBe('SERVICE_ACCOUNT_NO_USER_POLICY');
    expect(await prisma.agentApproval.count({ where: { userId: bot2Id } })).toBe(0);
    expect(await prisma.agentPolicy.count({ where: { userId: bot2Id } })).toBe(0);
  });

  it("deleting the org cancels its bots' waiting requests", async () => {
    const org = await prisma.organization.create({
      data: { name: 'Acme short-lived org', slug: 'acme-short-lived-botappr' },
    });
    await prisma.orgMembership.create({
      data: { orgId: org.id, userId: ctx.owner.id, role: 'OWNER' },
    });
    const made = await authPost(`/api/orgs/${org.id}/service-accounts`, ctx.owner.token, {
      username: 'acme-botappr-orgbot',
      displayName: 'Acme org bot',
      ownerIds: [ctx.owner.id],
    });
    expect(made.status).toBe(201);
    const orgBot = made.body.id as string;
    try {
      const row = await prisma.agentApproval.create({
        data: {
          userId: orgBot,
          channel: 'rest-token',
          action: 'issue.delete',
          input: {},
          preview: 'Waiting',
          expiresAt: new Date(Date.now() + DAY),
        },
      });
      const res = await authDel(`/api/orgs/${org.id}`, ctx.owner.token);
      expect(res.status).toBe(204);
      const after = await prisma.agentApproval.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.status).toBe('CANCELLED');
      expect(after.decidedAt).not.toBeNull();
      expect(after.error).toMatchObject({ code: 'CANCELLED' });
    } finally {
      await prisma.organization.deleteMany({ where: { id: org.id } });
      await prisma.user.deleteMany({ where: { id: orgBot } });
    }
  });
});
