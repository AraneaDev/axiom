import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

import { prisma } from '../../config/database';
import { runWithRequestContext } from '../../lib/request-context';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { castVote } from '../approvals/approvals.service';
import {
  AUTOMATION_ISSUE_INCLUDE,
  createRule,
  deleteRule,
  evaluateRules,
} from '../automation/automation.service';
import { moveIssue } from '../issues/issue-board.service';
import { bulkUpdate } from '../issues/issue-bulk.service';
import { addComment } from '../issues/issue-comments.service';
import { setParent } from '../issues/issue-hierarchy.service';
import { createIssue, updateIssue } from '../issues/issues.service';
import {
  createServiceAccount,
  suspendServiceAccount,
} from '../service-accounts/service-accounts.service';
import { addIssuesToSprint, removeIssueFromSprint } from '../sprints/sprints.service';

import { MAX_PENDING_PER_BOT } from './emit';
import { setBotWebhook } from './webhook-config.service';

// A literal public address: the check needs no DNS
const URL_OK = 'https://93.184.216.34/hooks/axiom';

/**
 * Every key path of a JSON value, sorted
 * @param value - The value
 * @param prefix - The path above it
 */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, v]) => [`${prefix}${k}`, ...keyPaths(v, `${prefix}${k}.`)])
    .sort();
}

describe('bot events for an assigned issue', () => {
  let ctx: TestContext;
  let person: TestUser;
  let botA: string;
  let botB: string;
  let noHookBot: string;
  const botIds: string[] = [];
  let columns: { id: string; name: string }[];

  async function makeBot(username: string, webhook = true): Promise<string> {
    const bot = await createServiceAccount(ctx.orgId, ctx.owner.id, {
      username,
      displayName: `Bot ${username}`,
      ownerIds: [ctx.owner.id],
    });
    botIds.push(bot.id);
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: bot.id, role: 'MEMBER' },
    });
    if (webhook) await setBotWebhook(bot.id, URL_OK);
    return bot.id;
  }

  const eventsOf = (botId: string) =>
    prisma.botEvent.findMany({ where: { botId }, orderBy: { seq: 'asc' } });
  const allEvents = () =>
    prisma.botEvent.findMany({ where: { botId: { in: botIds } }, orderBy: { seq: 'asc' } });
  const asBot = <T>(botId: string, fn: () => Promise<T>) =>
    runWithRequestContext({ channel: 'mcp', userId: botId }, fn);

  async function newIssue(title: string, assigneeId?: string) {
    return createIssue(ctx.projectId, ctx.owner.id, { title, assigneeId });
  }

  /**
   * An issue assigned to the bot, with the assignment event cleared
   * @param title - Its title
   * @param botId - The bot
   */
  async function botIssue(title: string, botId = botA) {
    const issue = await newIssue(title, botId);
    await prisma.botEvent.deleteMany({ where: { botId: { in: botIds } } });
    return issue;
  }

  async function hydrated(issueId: string) {
    return prisma.issue.findUniqueOrThrow({
      where: { id: issueId },
      include: AUTOMATION_ISSUE_INCLUDE,
    }) as unknown as Promise<Record<string, unknown> & { id: string; projectId: string }>;
  }

  /**
   * Run one automation rule against an issue, as the given actor
   * @param issueId - The issue
   * @param actorId - Who the rule runs as
   * @param actions - The rule's actions
   */
  async function runRule(
    issueId: string,
    actorId: string,
    actions: Parameters<typeof createRule>[1]['actions'],
  ) {
    const rule = await createRule(ctx.projectId, {
      name: 'Bot event rule',
      trigger: 'label:added',
      actions,
    } as Parameters<typeof createRule>[1]);
    try {
      await evaluateRules(ctx.projectId, 'label:added', {
        issue: await hydrated(issueId),
        actorId,
        label: 'x',
      });
    } finally {
      await deleteRule(rule.id);
    }
  }

  beforeAll(async () => {
    ctx = await createTestContext('botemit');
    person = await addMemberToContext(ctx, {
      email: 'voorbeeld-person@botemit.invalid',
      username: 'voorbeeld-person-botemit',
    });
    botA = await makeBot('acme-emit-bot-a');
    botB = await makeBot('acme-emit-bot-b');
    noHookBot = await makeBot('acme-emit-bot-nohook', false);
    columns = await prisma.boardColumn.findMany({
      where: { projectId: ctx.projectId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true },
    });
  });

  beforeEach(async () => {
    await prisma.botEvent.deleteMany({ where: { botId: { in: botIds } } });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.auditLog.deleteMany({ where: { userId: { in: botIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [...botIds, person.id] } } });
  });

  it('assigning a bot queues issue.assigned with ids only', async () => {
    const issue = await newIssue('Secret title');
    await updateIssue(ctx.projectId, issue.number, { assigneeId: botA }, ctx.owner.id);
    const born = await newIssue('Born assigned', botA);

    const events = await eventsOf(botA);
    expect(events.map((e) => e.type)).toEqual(['issue.assigned', 'issue.assigned']);
    const [first, second] = events;
    const payload = first.payload as Record<string, unknown>;
    expect(keyPaths(payload)).toEqual(
      [
        'actor',
        'actor.id',
        'actor.kind',
        'createdAt',
        'id',
        'issue',
        'issue.id',
        'issue.key',
        'org',
        'org.id',
        'org.slug',
        'project',
        'project.id',
        'project.key',
        'type',
      ].sort(),
    );
    expect(payload).toEqual({
      id: first.id,
      type: 'issue.assigned',
      createdAt: first.createdAt.toISOString(),
      org: { id: ctx.orgId, slug: ctx.orgSlug },
      project: { id: ctx.projectId, key: ctx.projectPrefix },
      issue: { id: issue.id, key: `${ctx.projectPrefix}-${issue.number}` },
      actor: { id: ctx.owner.id, kind: 'PERSON' },
    });
    expect(JSON.stringify(payload)).not.toContain('Secret title');
    expect(first.status).toBe('PENDING');
    expect((second.payload as { issue: { id: string } }).issue.id).toBe(born.id);
  });

  it('unassigning queues issue.unassigned and later edits queue nothing', async () => {
    const issue = await botIssue('Let go');
    await updateIssue(ctx.projectId, issue.number, { assigneeId: '' }, ctx.owner.id);
    await updateIssue(ctx.projectId, issue.number, { title: 'Let go again' }, ctx.owner.id);
    await addComment(issue.id, ctx.owner.id, 'Still here?');
    const events = await allEvents();
    expect(events.map((e) => [e.botId, e.type])).toEqual([[botA, 'issue.unassigned']]);
  });

  it('reassigning from bot A to bot B queues unassigned for A and assigned for B only', async () => {
    const issue = await botIssue('Hand over');
    await updateIssue(
      ctx.projectId,
      issue.number,
      { assigneeId: botB, title: 'Hand over now' },
      ctx.owner.id,
    );
    const events = await allEvents();
    expect(events.map((e) => [e.botId, e.type])).toEqual([
      [botA, 'issue.unassigned'],
      [botB, 'issue.assigned'],
    ]);
  });

  it("a status change on a bot's issue queues status_changed with column names", async () => {
    const [c0, c1, c2, c3] = columns;
    const issue = await botIssue('Moving');
    const statusOf = async () => {
      const events = await eventsOf(botA);
      await prisma.botEvent.deleteMany({ where: { botId: { in: botIds } } });
      return events.map((e) => [e.type, (e.payload as { status: unknown }).status]);
    };

    await updateIssue(ctx.projectId, issue.number, { columnId: c1.id }, ctx.owner.id);
    expect(await statusOf()).toEqual([['issue.status_changed', { from: c0.name, to: c1.name }]]);

    await runWithRequestContext({ channel: 'ui', userId: ctx.owner.id }, () =>
      moveIssue(ctx.projectId, issue.number, c2.id, 0),
    );
    expect(await statusOf()).toEqual([['issue.status_changed', { from: c1.name, to: c2.name }]]);

    await bulkUpdate(ctx.projectId, [issue.id], { status: c1.id }, ctx.owner.id);
    expect(await statusOf()).toEqual([['issue.status_changed', { from: c2.name, to: c1.name }]]);

    await runRule(issue.id, ctx.owner.id, [{ type: 'set_status', columnId: c0.id }]);
    expect(await statusOf()).toEqual([['issue.status_changed', { from: c1.name, to: c0.name }]]);

    // A gated move happens when the request is approved: the voter is the actor
    const gate = await prisma.approvalGate.create({
      data: {
        projectId: ctx.projectId,
        fromColumnId: c0.id,
        toColumnId: c3.id,
        minApprovals: 1,
        allowSelfApproval: false,
      },
    });
    try {
      const request = await prisma.approvalRequest.create({
        data: {
          issueId: issue.id,
          approvalGateId: gate.id,
          targetColumnId: c3.id,
          requestedById: person.id,
          approverIds: [ctx.owner.id],
        },
      });
      await castVote(request.id, ctx.owner.id, { decision: 'APPROVED' });
      const events = await eventsOf(botA);
      expect(events.map((e) => [e.type, (e.payload as { status: unknown }).status])).toEqual([
        ['issue.status_changed', { from: c0.name, to: c3.name }],
      ]);
      expect((events[0].payload as { actor: unknown }).actor).toEqual({
        id: ctx.owner.id,
        kind: 'PERSON',
      });
    } finally {
      await prisma.approvalGate.delete({ where: { id: gate.id } });
    }
  });

  it('a title and priority edit queues issue.edited with fields ["priority","title"]', async () => {
    const issue = await botIssue('Edit me');
    await updateIssue(
      ctx.projectId,
      issue.number,
      { title: 'Edited', priority: 'HIGH' },
      ctx.owner.id,
    );
    const events = await eventsOf(botA);
    expect(events.map((e) => [e.type, (e.payload as { changes: unknown }).changes])).toEqual([
      ['issue.edited', { fields: ['priority', 'title'] }],
    ]);
  });

  it('an unchanged value and an automation set_field edit', async () => {
    const issue = await botIssue('Same');
    await updateIssue(ctx.projectId, issue.number, { title: 'Same' }, ctx.owner.id);
    expect(await eventsOf(botA)).toHaveLength(0);
    await runRule(issue.id, ctx.owner.id, [{ type: 'set_field', field: 'priority', value: 'LOW' }]);
    const events = await eventsOf(botA);
    expect(events.map((e) => [e.type, (e.payload as { changes: unknown }).changes])).toEqual([
      ['issue.edited', { fields: ['priority'] }],
    ]);
  });

  it('a sprint change on a bot\'s issue queues issue.edited with fields ["sprint"]', async () => {
    const issue = await botIssue('Sprinting');
    const sprint = await prisma.sprint.create({
      data: {
        projectId: ctx.projectId,
        name: 'Sprint emit',
        startDate: new Date(),
        endDate: new Date(Date.now() + 14 * 86_400_000),
      },
    });
    await runWithRequestContext({ channel: 'ui', userId: ctx.owner.id }, () =>
      addIssuesToSprint(sprint.id, [issue.id]),
    );
    await runWithRequestContext({ channel: 'ui', userId: ctx.owner.id }, () =>
      removeIssueFromSprint(issue.id),
    );
    await updateIssue(ctx.projectId, issue.number, { sprintId: sprint.id }, ctx.owner.id);
    const events = await eventsOf(botA);
    expect(events.map((e) => [e.type, (e.payload as { changes: unknown }).changes])).toEqual([
      ['issue.edited', { fields: ['sprint'] }],
      ['issue.edited', { fields: ['sprint'] }],
      ['issue.edited', { fields: ['sprint'] }],
    ]);
    expect((events[0].payload as { actor: unknown }).actor).toEqual({
      id: ctx.owner.id,
      kind: 'PERSON',
    });
  });

  it('a parent change on a bot\'s issue queues issue.edited with fields ["parent"]', async () => {
    const epic = await newIssue('Epic');
    const issue = await botIssue('Child');
    await runWithRequestContext({ channel: 'ui', userId: ctx.owner.id }, async () => {
      await setParent(ctx.projectId, issue.number, epic.number);
      await setParent(ctx.projectId, issue.number, null);
    });
    const events = await eventsOf(botA);
    expect(events.map((e) => [e.type, (e.payload as { changes: unknown }).changes])).toEqual([
      ['issue.edited', { fields: ['parent'] }],
      ['issue.edited', { fields: ['parent'] }],
    ]);
  });

  it('a comment queues issue.commented with the comment id', async () => {
    const issue = await botIssue('Talk');
    const comment = await addComment(issue.id, person.id, 'Hello bot');
    let events = await eventsOf(botA);
    expect(events.map((e) => [e.type, (e.payload as { comment: unknown }).comment])).toEqual([
      ['issue.commented', { id: comment.id }],
    ]);
    expect((events[0].payload as { actor: unknown }).actor).toEqual({
      id: person.id,
      kind: 'PERSON',
    });
    expect(JSON.stringify(events[0].payload)).not.toContain('Hello bot');

    await prisma.botEvent.deleteMany({ where: { botId: botA } });
    await runRule(issue.id, person.id, [{ type: 'add_comment', body: 'Automated note' }]);
    const auto = await prisma.comment.findFirstOrThrow({
      where: { issueId: issue.id, body: 'Automated note' },
    });
    events = await eventsOf(botA);
    expect(events.map((e) => [e.type, (e.payload as { comment: unknown }).comment])).toEqual([
      ['issue.commented', { id: auto.id }],
    ]);
  });

  it('assign plus title in one update queues only issue.assigned', async () => {
    const issue = await newIssue('Both');
    await updateIssue(
      ctx.projectId,
      issue.number,
      { assigneeId: botA, title: 'Both at once', columnId: columns[1].id },
      ctx.owner.id,
    );
    expect((await allEvents()).map((e) => [e.botId, e.type])).toEqual([[botA, 'issue.assigned']]);
  });

  it("the bot's own comment or edit queues nothing", async () => {
    const issue = await botIssue('Mine');
    await asBot(botA, () => addComment(issue.id, botA, 'Working on it'));
    await asBot(botA, () => updateIssue(ctx.projectId, issue.number, { title: 'Mine, edited' }));
    await asBot(botA, () =>
      updateIssue(ctx.projectId, issue.number, { columnId: columns[1].id }, botA),
    );
    await asBot(botA, () => moveIssue(ctx.projectId, issue.number, columns[2].id, 0));
    expect(await allEvents()).toHaveLength(0);
  });

  it("an automation rule fired by the bot's own act queues nothing for its status move", async () => {
    const issue = await botIssue('Rule');
    await runRule(issue.id, botA, [{ type: 'set_status', columnId: columns[1].id }]);
    const row = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(row.columnId).toBe(columns[1].id);
    expect(await allEvents()).toHaveLength(0);
  });

  it('a suspended bot, a bot without a webhook and a bot removed from the team get nothing', async () => {
    await newIssue('No hook', noHookBot);
    expect(await allEvents()).toHaveLength(0);

    const suspended = await makeBot('acme-emit-bot-suspended');
    const suspendedIssue = await botIssue('Suspended', suspended);
    await suspendServiceAccount(suspended);
    await updateIssue(ctx.projectId, suspendedIssue.number, { title: 'Still?' }, ctx.owner.id);

    const removed = await makeBot('acme-emit-bot-removed');
    const removedIssue = await botIssue('Removed', removed);
    await prisma.teamMembership.deleteMany({ where: { teamId: ctx.teamId, userId: removed } });
    await updateIssue(ctx.projectId, removedIssue.number, { title: 'Gone?' }, ctx.owner.id);
    await addComment(removedIssue.id, ctx.owner.id, 'Anyone?');

    expect(await allEvents()).toHaveLength(0);
  });

  it('a bot with the maximum of pending events gets no more', async () => {
    const issue = await botIssue('Full', botB);
    await prisma.botEvent.createMany({
      data: Array.from({ length: MAX_PENDING_PER_BOT }, () => ({
        botId: botB,
        type: 'issue.edited',
        payload: {},
      })),
    });
    await updateIssue(ctx.projectId, issue.number, { title: 'Full, edited' }, ctx.owner.id);
    expect(await prisma.botEvent.count({ where: { botId: botB } })).toBe(MAX_PENDING_PER_BOT);
  });

  it('a person assignee gets nothing', async () => {
    const issue = await newIssue('Human', person.id);
    await updateIssue(ctx.projectId, issue.number, { title: 'Human, edited' }, ctx.owner.id);
    await addComment(issue.id, ctx.owner.id, 'For a person');
    expect(await allEvents()).toHaveLength(0);
  });

  it('an emit failure does not fail the issue write', async () => {
    const issue = await botIssue('Fragile');
    const spy = vi
      .spyOn(prisma.botWebhook, 'findUnique')
      .mockRejectedValue(new Error('bot lookup failed'));
    try {
      const updated = await updateIssue(
        ctx.projectId,
        issue.number,
        { title: 'Fragile, edited' },
        ctx.owner.id,
      );
      expect(updated.title).toBe('Fragile, edited');
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect(await allEvents()).toHaveLength(0);
  });
});
