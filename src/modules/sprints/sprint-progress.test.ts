import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { executeAction } from '../../actions/execute';
import { readSlots, READ_CONCURRENCY } from '../../actions/read.service';
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';

import { getSprintReport } from './sprint-report.service';
import './sprints.actions';

describe('sprint.overview', () => {
  let visible: TestContext;
  let hidden: TestContext;
  let viewer: TestUser;
  const sprintIds: string[] = [];
  let n = 5_000_000;

  const columnOf = async (projectId: string, where: object) =>
    prisma.boardColumn.findFirstOrThrow({ where: { projectId, ...where } });

  const makeIssue = async (
    ctx: TestContext,
    title: string,
    data: { columnId?: string; sprintId?: string; storyPoints?: number } = {},
  ) =>
    prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: n--,
        title,
        body: '',
        creatorId: ctx.owner.id,
        ...data,
      },
    });

  const sprint = async (ctx: TestContext, name: string, status: 'ACTIVE' | 'PLANNING') => {
    const row = await prisma.sprint.create({
      data: {
        projectId: ctx.projectId,
        name,
        status,
        startDate: new Date(Date.now() - 2 * 86_400_000),
        endDate: new Date(Date.now() + 3 * 86_400_000 - 1000),
        committedAt: status === 'ACTIVE' ? new Date(Date.now() - 2 * 86_400_000) : null,
      },
    });
    sprintIds.push(row.id);
    return row;
  };

  const run = (input: Record<string, unknown> = {}, userId = viewer.id) =>
    executeAction('sprint.overview', input, { userId, channel: 'ui' }) as Promise<{
      sprints: Array<
        Record<string, unknown> & {
          id: string;
          name: string;
          project: { key: string };
          issues: Record<string, number>;
          points: Record<string, number>;
          daysLeft: number;
          blocked: Array<{ key: string; blockedBy: Array<Record<string, unknown>> }>;
        }
      >;
    }>;

  let blockedKey: string;
  let sprintA: string;
  let sprintB: string;

  beforeAll(async () => {
    visible = await createTestContext(`ovw${Date.now()}`);
    hidden = await createTestContext(`ovh${Date.now()}`);
    viewer = await addMemberToContext(visible);

    const open = await columnOf(visible.projectId, { isDefault: true });
    const done = await columnOf(visible.projectId, { isDone: true });
    const progress = await columnOf(visible.projectId, { name: { contains: 'Progress' } });
    const a = await sprint(visible, 'Overview A', 'ACTIVE');
    sprintA = a.id;
    const b = await sprint(hidden, 'Overview B', 'ACTIVE');
    sprintB = b.id;
    await sprint(visible, 'Overview planned', 'PLANNING');

    await makeIssue(visible, 'Todo', { columnId: open.id, sprintId: a.id, storyPoints: 2 });
    await makeIssue(visible, 'Doing', { columnId: progress.id, sprintId: a.id, storyPoints: 3 });
    await makeIssue(visible, 'Finished', { columnId: done.id, sprintId: a.id, storyPoints: 5 });
    const stuck = await makeIssue(visible, 'Stuck', {
      columnId: open.id,
      sprintId: a.id,
      storyPoints: 1,
    });
    blockedKey = `${visible.projectPrefix}-${stuck.number}`;
    await prisma.sprintIssueHistory.createMany({
      data: (await prisma.issue.findMany({ where: { sprintId: a.id } })).map((issue) => ({
        sprintId: a.id,
        issueId: issue.id,
        action: 'ADDED',
        timestamp: new Date(Date.now() - 3 * 86_400_000),
      })),
    });

    const secret = await makeIssue(hidden, 'Secret blocker', {
      columnId: (await columnOf(hidden.projectId, { isDefault: true })).id,
    });
    const open2 = await makeIssue(visible, 'Open blocker', { columnId: open.id });
    await prisma.issueLink.createMany({
      data: [
        { fromId: stuck.id, toId: secret.id, type: 'IS_BLOCKED_BY' },
        { fromId: stuck.id, toId: open2.id, type: 'IS_BLOCKED_BY' },
        // The pair stored the other way too, which must not repeat the blocker
        { fromId: open2.id, toId: stuck.id, type: 'BLOCKS' },
      ],
    });
    await makeIssue(hidden, 'Other project', {
      sprintId: b.id,
      columnId: (await columnOf(hidden.projectId, { isDefault: true })).id,
    });
  });

  afterAll(async () => {
    await cleanupTestContext(visible);
    await cleanupTestContext(hidden);
    await prisma.user.deleteMany({ where: { id: viewer.id } });
  });

  it('totals the active sprints of the projects the viewer can open, none of the others', async () => {
    const { sprints } = await run();
    const ids = sprints.map((s) => s.id);
    expect(ids).toContain(sprintA);
    expect(ids).not.toContain(sprintB);
    const entry = sprints.find((s) => s.id === sprintA)!;
    expect(entry.project.key).toBe(visible.projectPrefix);
    expect(entry.issues).toEqual({ total: 4, done: 1, inProgress: 1, todo: 2 });
    expect(entry.points).toEqual({ committed: 11, done: 5 });
    expect(entry.daysLeft).toBe(3);
  });

  it('names a blocker the viewer cannot open as hidden, without key or title', async () => {
    const entry = (await run()).sprints.find((s) => s.id === sprintA)!;
    expect(entry.blocked).toHaveLength(1);
    expect(entry.blocked[0].key).toBe(blockedKey);
    const blockers = entry.blocked[0].blockedBy as Array<Record<string, unknown>>;
    expect(blockers).toHaveLength(2);
    expect(blockers.find((b) => b.hidden)).toEqual({ hidden: true });
    expect(blockers.find((b) => !b.hidden)).toMatchObject({ title: 'Open blocker' });
  });

  it('shows the blocker once the viewer can open its project', async () => {
    const membership = await prisma.teamMembership.create({
      data: { teamId: hidden.teamId, userId: viewer.id, role: 'MEMBER' },
    });
    try {
      const entry = (await run()).sprints.find((s) => s.id === sprintA)!;
      const titles = entry.blocked[0].blockedBy.map((b: Record<string, unknown>) => b.title);
      expect(titles.sort()).toEqual(['Open blocker', 'Secret blocker']);
    } finally {
      await prisma.teamMembership.delete({ where: { id: membership.id } });
    }
  });

  it('leaves blocked out on request, and honours state and scope', async () => {
    expect((await run({ includeBlocked: false })).sprints[0].blocked).toEqual([]);
    const planning = await run({ state: 'PLANNING', scope: { projectId: visible.projectId } });
    expect(planning.sprints.map((s) => s.name)).toEqual(['Overview planned']);
    const none = await run({ scope: { projectId: hidden.projectId } });
    expect(none.sprints).toEqual([]);
  });

  it('needs the sprints:read scope, and not search:read', async () => {
    const as = (scopes: string[]) =>
      executeAction(
        'sprint.overview',
        {},
        { userId: viewer.id, channel: 'mcp', scopes, byName: {} },
      );
    await expect(as(['search:read', 'issues:read'])).rejects.toMatchObject({ statusCode: 403 });
    await expect(as(['sprints:read'])).resolves.toHaveProperty('sprints');
  });

  it('takes a read slot, and refuses when none is free', async () => {
    const user = await addMemberToContext(visible);
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refused = new AppError(500, 'no free slot in the test');
    const running = Array.from({ length: READ_CONCURRENCY.perUser }, () =>
      readSlots.run(user.id, refused, () => held),
    );
    try {
      await expect(
        executeAction('sprint.overview', {}, { userId: user.id, channel: 'ui' }),
      ).rejects.toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    } finally {
      release();
      await Promise.all(running);
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('keeps blockers apart that share a prefix and number across orgs', async () => {
    const same = await createTestContext(`ovs${Date.now()}`);
    const sameHidden = await createTestContext(`ovt${Date.now()}`);
    try {
      await prisma.project.update({
        where: { id: sameHidden.projectId },
        data: { prefix: same.projectPrefix },
      });
      const columnA = (await columnOf(same.projectId, { isDefault: true })).id;
      const columnB = (await columnOf(sameHidden.projectId, { isDefault: true })).id;
      const planned = await sprint(same, 'Same prefix', 'ACTIVE');
      const stuck = await makeIssue(same, 'Waits on two', {
        columnId: columnA,
        sprintId: planned.id,
      });
      const seen = await makeIssue(same, 'Seen blocker', { columnId: columnA });
      // The same key, in another org the viewer cannot open
      const unseen = await makeIssue(sameHidden, 'Unseen blocker', { columnId: columnB });
      await prisma.issue.update({ where: { id: unseen.id }, data: { number: seen.number } });
      await prisma.issueLink.createMany({
        data: [
          { fromId: stuck.id, toId: unseen.id, type: 'IS_BLOCKED_BY' },
          { fromId: stuck.id, toId: seen.id, type: 'IS_BLOCKED_BY' },
        ],
      });
      const { sprints } = (await executeAction(
        'sprint.overview',
        {},
        { userId: same.owner.id, channel: 'ui' },
      )) as Awaited<ReturnType<typeof run>>;
      const entry = sprints.find((s) => s.id === planned.id);
      const blockers = entry?.blocked[0].blockedBy ?? [];
      expect(blockers).toHaveLength(2);
      expect(blockers.filter((b) => b.hidden)).toEqual([{ hidden: true }]);
      expect(blockers.find((b) => !b.hidden)).toMatchObject({ title: 'Seen blocker' });
    } finally {
      await cleanupTestContext(same);
      await cleanupTestContext(sameHidden);
    }
  });

  it('agrees with the sprint report on done and points', async () => {
    const report = await getSprintReport(visible.projectId, sprintA);
    const entry = (await run()).sprints.find((s) => s.id === sprintA)!;
    expect(entry.issues.done).toBe(report.summary.completedCount);
    expect(entry.points.done).toBe(report.summary.completedPoints);
    expect(entry.points.committed).toBe(report.summary.committedPoints);
  });
});
