import { createHash } from 'crypto';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import WebSocket from 'ws';

import * as previews from '../../actions/previews';
import { prisma } from '../../config/database';
import app from '../../index';
import { createWebSocketServer } from '../../realtime/ws-server';
import { tokenFor } from '../../test/collab-client';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet } from '../../test/helpers';
import { createApprovalRequestWithTarget } from '../approvals/approvals.service';
import { listAuditLogs } from '../audit/audit.service';
import * as authService from '../auth/auth.service';
import { assertCustomFieldValue } from '../custom-fields/custom-field-values';
import { GITHUB_INTEGRATION_USER_ID } from '../github/integration-user';
import { assertAssignable } from '../issues/issue-references';
import { toggleWatch } from '../issues/issue-watchers.service';
import { addComment } from '../issues/issues.service';
import { createNotification } from '../notifications/notifications.service';
import * as orgsService from '../orgs/orgs.service';
import * as teamsService from '../teams/teams.service';

import { assertPersonTarget, isPerson } from './person';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('a SERVICE user is never a person', () => {
  let ctx: TestContext;
  let member: TestUser;
  let botId: string;
  const botName = 'triage-bot-person';
  let issueId: string;

  beforeAll(async () => {
    ctx = await createTestContext('svcperson');
    member = await addMemberToContext(ctx, {
      email: 'voorbeeld-member@svcperson.invalid',
      username: 'voorbeeld-member-svcperson',
    });
    ctx.member = member;
    // A bot in the org and, as a VIEWER (an active MEMBER bot is assignable), in the team
    const bot = await prisma.user.create({
      data: {
        email: `${botName}@service.invalid`,
        username: botName,
        displayName: 'Triage bot',
        passwordHash: '!',
        kind: 'SERVICE',
        orgMemberships: { create: { orgId: ctx.orgId, role: 'MEMBER' } },
        teamMemberships: { create: { teamId: ctx.teamId, role: 'VIEWER' } },
        serviceAccount: { create: { orgId: ctx.orgId, createdById: ctx.owner.id } },
      },
    });
    botId = bot.id;
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'Stale ticket',
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    issueId = issue.id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.auditLog.deleteMany({ where: { userId: botId } });
    await prisma.user.deleteMany({ where: { id: botId } });
  });

  it('isPerson is false for SERVICE and INTEGRATION, true for PERSON', async () => {
    expect(await isPerson(botId)).toBe(false);
    expect(await isPerson(GITHUB_INTEGRATION_USER_ID)).toBe(false);
    expect(await isPerson(ctx.owner.id)).toBe(true);
    expect(await isPerson('no-such-user')).toBe(false);
  });

  it('assertPersonTarget throws 400 with the code given for a bot', async () => {
    await expect(assertPersonTarget(botId, 'SOME_CODE', 'Not for bots')).rejects.toMatchObject({
      statusCode: 400,
      code: 'SOME_CODE',
      message: 'Not for bots',
    });
    await expect(assertPersonTarget(member.id, 'SOME_CODE', 'x')).resolves.toBeUndefined();
  });

  it('refuses a bot as assignee with 400, also over REST', async () => {
    await expect(assertAssignable(ctx.projectId, botId)).rejects.toMatchObject({ statusCode: 400 });
    const res = await request(app)
      .patch(`/api/projects/${ctx.projectId}/issues/1`)
      .set(XHR)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .send({ assigneeId: botId });
    expect(res.status).toBe(400);
    expect((await prisma.issue.findUnique({ where: { id: issueId } }))?.assigneeId).toBeNull();
  });

  it('createNotification for a bot returns null and writes nothing', async () => {
    expect(await createNotification(botId, 'mention', 'Hello')).toBeNull();
    expect(await prisma.notification.count({ where: { userId: botId } })).toBe(0);
  });

  it('a comment with @botname notifies nobody, and the person beside it is notified', async () => {
    await addComment(issueId, ctx.owner.id, `@${botName} and @${member.username} please look`);
    await expect
      .poll(() => prisma.notification.count({ where: { userId: member.id, type: 'mention' } }))
      .toBe(1);
    expect(await prisma.notification.count({ where: { userId: botId } })).toBe(0);
  });

  it('a bot that comments @person does notify that person', async () => {
    await addComment(issueId, botId, `@${ctx.owner.username} this one is stale`);
    await expect
      .poll(() =>
        prisma.notification.count({
          where: { userId: ctx.owner.id, type: 'mention', title: { contains: botName } },
        }),
      )
      .toBe(1);
  });

  it('leaves the bot out of the org member, team member and assignee pickers', async () => {
    const orgMembers = await orgsService.listOrgMembers(ctx.orgId);
    expect(orgMembers.map((m) => m.userId)).toContain(member.id);
    expect(orgMembers.map((m) => m.userId)).not.toContain(botId);

    const org = await orgsService.getOrg(ctx.orgId, ctx.owner.id);
    expect(org.members.map((m) => m.userId)).not.toContain(botId);

    const teamMembers = await teamsService.listTeamMembers(ctx.teamId);
    expect(teamMembers.map((m) => m.userId)).toContain(member.id);
    expect(teamMembers.map((m) => m.userId)).not.toContain(botId);

    // The assignee picker reads the team's members from team.get
    const team = await authGet(`/api/teams/${ctx.teamId}`, ctx.owner.token);
    expect(team.status).toBe(200);
    const ids = (team.body.members as Array<{ userId: string }>).map((m) => m.userId);
    expect(ids).toContain(member.id);
    expect(ids).not.toContain(botId);
  });

  it('the org and team member lists show the bot, with its kind, only when asked', async () => {
    const org = await authGet(`/api/orgs/${ctx.orgId}/members?includeBots=true`, ctx.owner.token);
    expect(org.status).toBe(200);
    const orgBot = (org.body as Array<{ userId: string; user: { kind: string } }>).find(
      (m) => m.userId === botId,
    );
    expect(orgBot?.user.kind).toBe('SERVICE');

    const team = await authGet(
      `/api/teams/${ctx.teamId}/members?includeBots=true`,
      ctx.owner.token,
    );
    expect(team.status).toBe(200);
    const rows = team.body as Array<{ userId: string; user: { kind: string } }>;
    expect(rows.find((m) => m.userId === botId)?.user.kind).toBe('SERVICE');
    expect(rows.find((m) => m.userId === member.id)?.user.kind).toBe('PERSON');

    // Without the flag, as the pickers ask, the bot stays out
    const plain = await authGet(`/api/teams/${ctx.teamId}/members`, ctx.owner.token);
    expect((plain.body as Array<{ userId: string }>).map((m) => m.userId)).not.toContain(botId);
  });

  it("a bot's comment, its issue and its activity carry the author's kind", async () => {
    const res = await authGet(`/api/projects/${ctx.projectId}/issues/1`, ctx.owner.token);
    expect(res.status).toBe(200);
    const comments = res.body.comments as Array<{ author: { id: string; kind: string } }>;
    expect(comments.find((c) => c.author.id === botId)?.author.kind).toBe('SERVICE');
    expect(res.body.creator.kind).toBe('PERSON');

    await prisma.activity.create({
      data: { resourceType: 'issue', resourceId: issueId, action: 'commented', userId: botId },
    });
    const activity = await authGet(
      `/api/projects/${ctx.projectId}/issues/1/activity`,
      ctx.owner.token,
    );
    expect(activity.status).toBe(200);
    const events = activity.body.activities as Array<{ userId: string; user: { kind: string } }>;
    expect(events.find((e) => e.userId === botId)?.user.kind).toBe('SERVICE');
  });

  it("the audit log names a bot's kind beside its name", async () => {
    await prisma.auditLog.create({
      data: { orgId: ctx.orgId, userId: botId, action: 'update', resource: `issue:${issueId}` },
    });
    const { logs } = await listAuditLogs({ userId: botId });
    expect(logs[0]).toMatchObject({ userName: 'Triage bot', userKind: 'SERVICE' });
  });

  it('refuses a bot as a watcher', async () => {
    await expect(toggleWatch(ctx.projectId, 1, botId)).rejects.toMatchObject({ statusCode: 400 });
    expect(await prisma.issueWatcher.count({ where: { userId: botId } })).toBe(0);
  });

  it('refuses to add a bot to an org by hand (R3)', async () => {
    const other = await prisma.organization.create({
      data: { name: 'Acme Labs svcperson', slug: 'acme-labs-svcperson' },
    });
    try {
      await expect(orgsService.addOrgMember(other.id, botId, 'MEMBER')).rejects.toMatchObject({
        statusCode: 400,
      });
    } finally {
      await prisma.organization.delete({ where: { id: other.id } });
    }
  });

  it('login with a bot username gives 401, and no reset or 2FA is set up for it', async () => {
    for (const password of ['!', 'anything-at-all']) {
      const res = await request(app)
        .post('/api/auth/login')
        .set(XHR)
        .send({ login: botName, password });
      expect(res.status).toBe(401);
    }
    await authService.requestPasswordReset(`${botName}@service.invalid`);
    expect(await prisma.passwordResetToken.count({ where: { userId: botId } })).toBe(0);
    await expect(authService.enableTwoFactor(botId)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('refuses a stored refresh token and a stored reset token of a bot', async () => {
    const refreshValue = 'svcperson-planted-refresh';
    await prisma.refreshToken.create({
      data: {
        userId: botId,
        tokenHash: createHash('sha256').update(refreshValue).digest('hex'),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await expect(authService.refresh(refreshValue)).rejects.toMatchObject({ statusCode: 401 });

    const resetValue = 'svcperson-planted-reset';
    await prisma.passwordResetToken.create({
      data: {
        userId: botId,
        tokenHash: createHash('sha256').update(resetValue).digest('hex'),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await expect(authService.resetPassword(resetValue, 'newpassword123')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: botId } })).passwordHash).toBe('!');
  });

  it('refuses a JWT for a bot on REST, the realtime socket and the collaboration socket', async () => {
    const rest = await request(app)
      .get('/api/users/search?q=x')
      .set('Authorization', `Bearer ${tokenFor(botId)}`);
    expect(rest.status).toBe(401);

    const server: Server = createServer();
    const wss = createWebSocketServer(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const realtime = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${tokenFor(botId)}`);
      const outcome = await new Promise<string>((resolve) => {
        realtime.once('open', () => resolve('open'));
        realtime.once('error', () => resolve('refused'));
        realtime.once('unexpected-response', () => resolve('refused'));
      });
      realtime.terminate();
      expect(outcome).toBe('refused');

      const collab = new WebSocket(
        `ws://127.0.0.1:${port}/ws/wiki/no-such-page?token=${tokenFor(botId)}`,
      );
      const code = await new Promise<number>((resolve) => {
        collab.once('close', (c) => resolve(c));
        collab.once('error', () => resolve(-1));
      });
      expect(code).toBe(4001);
    } finally {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('refuses a bot as an issue approval approver (I1)', async () => {
    const columns = await prisma.boardColumn.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { position: 'asc' },
    });
    const [from, to] = columns;
    await prisma.issue.update({ where: { id: issueId }, data: { columnId: from.id } });
    const gate = await prisma.approvalGate.create({
      data: {
        projectId: ctx.projectId,
        fromColumnId: from.id,
        toColumnId: to.id,
        minApprovals: 1,
        allowSelfApproval: false,
      },
    });
    try {
      await expect(
        createApprovalRequestWithTarget(issueId, to.id, ctx.owner.id, [botId]),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'SERVICE_ACCOUNT_NOT_APPROVER',
        message: 'A service account cannot be an approver',
      });
      expect(await prisma.approvalRequest.count({ where: { issueId } })).toBe(0);
      // A person on the team still can be named
      await expect(
        createApprovalRequestWithTarget(issueId, to.id, ctx.owner.id, [member.id]),
      ).resolves.toMatchObject({ approverIds: [member.id] });
    } finally {
      await prisma.approvalRequest.deleteMany({ where: { issueId } });
      await prisma.approvalGate.delete({ where: { id: gate.id } });
    }
  });

  it('refuses a bot as the value of a USER custom field (M2)', async () => {
    const field = { type: 'USER', projectId: ctx.projectId };
    await expect(assertCustomFieldValue(field, botId)).rejects.toMatchObject({
      statusCode: 400,
      code: 'SERVICE_ACCOUNT_NOT_ASSIGNABLE',
    });
    await expect(assertCustomFieldValue(field, member.id)).resolves.toBeUndefined();
  });

  it('gives an unknown user id in a USER custom field the usual access message', async () => {
    const field = { type: 'USER', projectId: ctx.projectId };
    await expect(assertCustomFieldValue(field, 'voorbeeld-no-such-user')).rejects.toMatchObject({
      statusCode: 400,
      message: 'A user field can only name someone who can read this project',
    });
  });

  it('leaves the bot out of team and org member counts (M3)', async () => {
    const people = await prisma.teamMembership.count({
      where: { teamId: ctx.teamId, user: { kind: 'PERSON' } },
    });
    const { data } = (await teamsService.listOrgTeams(ctx.orgId, {}, ctx.owner.id)) as unknown as {
      data: Array<{ id: string; _count: { members: number } }>;
    };
    expect(data.find((t) => t.id === ctx.teamId)?._count.members).toBe(people);

    const orgPeople = await prisma.orgMembership.count({
      where: { orgId: ctx.orgId, user: { kind: 'PERSON' } },
    });
    expect(await previews.teamDelete(ctx.teamId)).toContain(
      `${people} member${people === 1 ? '' : 's'}`,
    );
    expect(await previews.orgDelete(ctx.orgId)).toContain(
      `${orgPeople} member${orgPeople === 1 ? '' : 's'}`,
    );
  });
});
