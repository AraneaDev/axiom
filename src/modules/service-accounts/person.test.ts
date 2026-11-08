import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet } from '../../test/helpers';
import * as authService from '../auth/auth.service';
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
    // A bot in the org and the team, as Task 2's create and Task 5's join will make it
    const bot = await prisma.user.create({
      data: {
        email: `${botName}@service.invalid`,
        username: botName,
        displayName: 'Triage bot',
        passwordHash: '!',
        kind: 'SERVICE',
        orgMemberships: { create: { orgId: ctx.orgId, role: 'MEMBER' } },
        teamMemberships: { create: { teamId: ctx.teamId, role: 'MEMBER' } },
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
});
