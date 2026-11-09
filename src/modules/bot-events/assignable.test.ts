import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
} from '../../test/factory';
import { createRule } from '../automation/automation.service';
import { GITHUB_INTEGRATION_USER_ID } from '../github/integration-user';
import { bulkUpdate } from '../issues/issue-bulk.service';
import { addComment } from '../issues/issue-comments.service';
import { assertAssignable, isAssignableBot } from '../issues/issue-references';
import { toggleWatch } from '../issues/issue-watchers.service';
import { createIssue, updateIssue } from '../issues/issues.service';
import { createNotification } from '../notifications/notifications.service';
import { assertPersonTarget } from '../service-accounts/person';
import {
  createServiceAccount,
  suspendServiceAccount,
} from '../service-accounts/service-accounts.service';
import * as teamsService from '../teams/teams.service';

const REFUSAL = 'The assignee must be a member of the project team';

// Notifications and mentions run fire-and-forget; keep their promises so a test can wait for them
const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('../notifications/notifications.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../notifications/notifications.service')>();
  return {
    ...actual,
    createNotification: vi.fn((...args: Parameters<typeof actual.createNotification>) => {
      const p = actual.createNotification(...args);
      pending.push(p);
      return p;
    }),
  };
});
vi.mock('../../utils/mention-notifier', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/mention-notifier')>();
  return {
    ...actual,
    notifyMentions: vi.fn((...args: Parameters<typeof actual.notifyMentions>) => {
      const p = actual.notifyMentions(...args);
      pending.push(p);
      return p;
    }),
  };
});

/** Wait until every notification and mention started so far has settled. */
async function settle(): Promise<void> {
  while (pending.length > 0) await Promise.allSettled(pending.splice(0));
}

describe('an active member bot can be assigned', () => {
  let ctx: TestContext;
  let other: TestContext;
  let personId: string;
  let memberBot: string;
  let viewerBot: string;
  let suspendedBot: string;
  let foreignBot: string;
  const botIds: string[] = [];

  async function makeBot(
    c: TestContext,
    username: string,
    role: 'MEMBER' | 'VIEWER',
  ): Promise<string> {
    const bot = await createServiceAccount(c.orgId, c.owner.id, {
      username,
      displayName: `Bot ${username}`,
      ownerIds: [c.owner.id],
    });
    botIds.push(bot.id);
    await prisma.teamMembership.create({ data: { teamId: c.teamId, userId: bot.id, role } });
    return bot.id;
  }

  beforeAll(async () => {
    ctx = await createTestContext('botassign');
    other = await createTestContext('botassign2');
    const person = await addMemberToContext(ctx, {
      email: 'voorbeeld-person@botassign.invalid',
      username: 'voorbeeld-person-botassign',
    });
    personId = person.id;
    memberBot = await makeBot(ctx, 'acme-member-bot-assign', 'MEMBER');
    viewerBot = await makeBot(ctx, 'acme-viewer-bot-assign', 'VIEWER');
    suspendedBot = await makeBot(ctx, 'acme-suspended-bot-assign', 'MEMBER');
    await suspendServiceAccount(suspendedBot);
    foreignBot = await makeBot(other, 'acme-foreign-bot-assign', 'MEMBER');
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await cleanupTestContext(other);
    await prisma.auditLog.deleteMany({ where: { userId: { in: botIds } } });
    await prisma.user.deleteMany({ where: { id: { in: botIds } } });
  });

  it('an ACTIVE MEMBER bot on the team can be assigned', async () => {
    const issue = await createIssue(ctx.projectId, ctx.owner.id, { title: 'Assign me' });
    await updateIssue(ctx.projectId, issue.number, { assigneeId: memberBot });
    const row = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(row.assigneeId).toBe(memberBot);
    expect(await isAssignableBot(memberBot, ctx.projectId)).toBe(true);
  });

  it('a person on the team is still assignable', async () => {
    await expect(assertAssignable(ctx.projectId, personId)).resolves.toBeUndefined();
  });

  it('a VIEWER bot is refused', async () => {
    await expect(assertAssignable(ctx.projectId, viewerBot)).rejects.toMatchObject({
      statusCode: 400,
      message: REFUSAL,
    });
  });

  it('a SUSPENDED bot is refused', async () => {
    await expect(assertAssignable(ctx.projectId, suspendedBot)).rejects.toMatchObject({
      statusCode: 400,
      message: REFUSAL,
    });
  });

  it('a bot of another team is refused', async () => {
    await expect(assertAssignable(ctx.projectId, foreignBot)).rejects.toMatchObject({
      statusCode: 400,
      message: REFUSAL,
    });
  });

  it('the integration user is refused', async () => {
    await expect(assertAssignable(ctx.projectId, GITHUB_INTEGRATION_USER_ID)).rejects.toMatchObject(
      { statusCode: 400, message: REFUSAL },
    );
  });

  it('assigning a bot creates no notification', async () => {
    const issue = await createIssue(ctx.projectId, ctx.owner.id, { title: 'Quiet assign' });
    vi.mocked(createNotification).mockClear();
    await updateIssue(ctx.projectId, issue.number, { assigneeId: memberBot });
    await settle();
    // The assignment notice was attempted, and the guard in createNotification refused it
    expect(vi.mocked(createNotification).mock.calls.map((c) => c[0])).toContain(memberBot);
    expect(await prisma.notification.count({ where: { userId: memberBot } })).toBe(0);
  });

  it('a bot cannot watch an issue', async () => {
    const issue = await createIssue(ctx.projectId, ctx.owner.id, { title: 'No bot watchers' });
    await expect(toggleWatch(ctx.projectId, issue.number, memberBot)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await prisma.issueWatcher.count({ where: { userId: memberBot } })).toBe(0);
  });

  it('a comment mentioning the assigned bot notifies it of nothing', async () => {
    const issue = await createIssue(ctx.projectId, ctx.owner.id, {
      title: 'Mention the bot',
      assigneeId: memberBot,
    });
    await settle();
    await addComment(issue.id, ctx.owner.id, 'Over to you @acme-member-bot-assign');
    await settle();
    expect(await prisma.notification.count({ where: { userId: memberBot } })).toBe(0);
    expect(await prisma.issueWatcher.count({ where: { userId: memberBot } })).toBe(0);
  });

  it('createIssue with a bot assignee succeeds', async () => {
    const issue = await createIssue(ctx.projectId, ctx.owner.id, {
      title: 'Born assigned',
      assigneeId: memberBot,
    });
    expect(issue.assigneeId).toBe(memberBot);
  });

  it('bulk update with a bot assignee succeeds', async () => {
    const issue = await createIssue(ctx.projectId, ctx.owner.id, { title: 'Bulk assign' });
    await bulkUpdate(ctx.projectId, [issue.id], { assigneeId: memberBot }, ctx.owner.id);
    const row = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(row.assigneeId).toBe(memberBot);
  });

  it('automation set_assignee may target an assignable bot', async () => {
    const rule = await createRule(ctx.projectId, {
      name: 'Hand to the bot',
      trigger: 'issue:created',
      actions: [{ type: 'set_assignee', userId: memberBot }],
    } as Parameters<typeof createRule>[1]);
    expect(rule.id).toBeTruthy();
    await expect(
      createRule(ctx.projectId, {
        name: 'Hand to the viewer bot',
        trigger: 'issue:created',
        actions: [{ type: 'set_assignee', userId: viewerBot }],
      } as Parameters<typeof createRule>[1]),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('listTeamMembers with assignable returns the MEMBER bot and not the VIEWER or SUSPENDED one', async () => {
    const assignable = await teamsService.listTeamMembers(ctx.teamId, { assignable: true });
    const ids = assignable.map((m) => m.userId);
    expect(ids).toContain(memberBot);
    expect(ids).toContain(personId);
    expect(ids).not.toContain(viewerBot);
    expect(ids).not.toContain(suspendedBot);
    expect(assignable.find((m) => m.userId === memberBot)?.user.kind).toBe('SERVICE');

    const plain = await teamsService.listTeamMembers(ctx.teamId);
    const plainIds = plain.map((m) => m.userId);
    expect(plainIds).not.toContain(memberBot);
    expect(plainIds).toContain(personId);
  });

  it('a bot stays refused as a mention, watcher and notification target', async () => {
    await expect(assertPersonTarget(memberBot, 'X', 'Not for bots')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(await createNotification(memberBot, 'mention', 'Hello')).toBeNull();
    expect(await prisma.notification.count({ where: { userId: memberBot } })).toBe(0);
  });
});
