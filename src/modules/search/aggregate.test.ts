/**
 * query.run: grouping and aggregates across everything the viewer can see, and nothing else.
 */
import crypto from 'crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { readSlots, READ_CONCURRENCY } from '../../actions/read.service';
import { prisma } from '../../config/database';
import app from '../../index';
import { AppError } from '../../middleware/errorHandler';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authPost } from '../../test/helpers';
import { callTool, connectMcp, serveApp, tokenHeaderFor } from '../../test/mcp-client';

/** A tag no other test's issue holds, so queries over all a user sees stay exact. */
const MARK = `qrun${Date.now()}`;

describe('query.run', () => {
  let a: TestContext;
  let b: TestContext;
  let hidden: TestContext;
  let viewer: TestUser;
  let sprintA: { id: string; name: string };
  let sprintB: { id: string; name: string };
  let sprintHidden: { id: string; name: string };
  let number = 5000;

  const column = async (projectId: string, name: string) =>
    prisma.boardColumn.findFirstOrThrow({ where: { projectId, name } });

  const addIssue = async (
    ctx: TestContext,
    data: {
      title?: string;
      columnId?: string | null;
      sprintId?: string | null;
      storyPoints?: number | null;
      priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
      type?: 'TASK' | 'BUG';
      assigneeId?: string;
      body?: string;
    },
  ) =>
    prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: number++,
        title: data.title ?? `Issue ${MARK}`,
        body: data.body ?? '',
        creatorId: ctx.owner.id,
        columnId: data.columnId === undefined ? null : data.columnId,
        sprintId: data.sprintId ?? null,
        storyPoints: data.storyPoints ?? null,
        priority: data.priority,
        type: data.type,
        assigneeId: data.assigneeId,
      },
    });

  const sprint = (projectId: string, name: string) =>
    prisma.sprint.create({
      data: {
        projectId,
        name,
        status: 'ACTIVE',
        startDate: new Date('2026-11-01'),
        endDate: new Date('2026-11-15'),
      },
    });

  const run = (body: object, user: TestUser = viewer) => authPost('/api/query', user.token, body);

  /** A user of its own per test past the search limit of 30 a minute. */
  const member = async () => {
    const user = await createTestUser();
    await prisma.teamMembership.createMany({
      data: [
        { teamId: a.teamId, userId: user.id, role: 'MEMBER' },
        { teamId: b.teamId, userId: user.id, role: 'MEMBER' },
      ],
    });
    return user;
  };

  beforeAll(async () => {
    a = await createTestContext(`qaa${Date.now()}`);
    b = await createTestContext(`qbb${Date.now()}`);
    hidden = await createTestContext(`qhh${Date.now()}`);
    viewer = await addMemberToContext(a);
    await prisma.teamMembership.create({
      data: { teamId: b.teamId, userId: viewer.id, role: 'MEMBER' },
    });

    sprintA = await sprint(a.projectId, `Alpha ${MARK}`);
    sprintB = await sprint(b.projectId, `Beta ${MARK}`);
    sprintHidden = await sprint(hidden.projectId, `Secret ${MARK}`);

    const [todoA, doingA, todoB, doneB, todoHidden, secretColumn] = await Promise.all([
      column(a.projectId, 'To Do'),
      column(a.projectId, 'In Progress'),
      column(b.projectId, 'To Do'),
      column(b.projectId, 'Done'),
      column(hidden.projectId, 'To Do'),
      prisma.boardColumn.create({
        data: { projectId: hidden.projectId, name: `Secret column ${MARK}`, position: 9 },
      }),
    ]);

    await addIssue(a, { columnId: todoA.id, sprintId: sprintA.id, storyPoints: 3 });
    await addIssue(a, { columnId: todoA.id, sprintId: sprintA.id, storyPoints: 5 });
    await addIssue(a, { columnId: todoA.id, sprintId: sprintA.id, storyPoints: null });
    await addIssue(a, { columnId: doingA.id, sprintId: sprintA.id, storyPoints: 2 });
    await addIssue(b, { columnId: todoB.id, sprintId: sprintB.id, storyPoints: 8 });
    await addIssue(b, { columnId: doneB.id, sprintId: sprintB.id, storyPoints: null });
    // Not in an active sprint
    await addIssue(b, { columnId: todoB.id, storyPoints: 100, type: 'BUG' });

    // What the viewer must never count, sum or see named
    await addIssue(hidden, {
      columnId: todoHidden.id,
      sprintId: sprintHidden.id,
      storyPoints: 1000,
    });
    await addIssue(hidden, {
      columnId: secretColumn.id,
      sprintId: sprintHidden.id,
      storyPoints: 2000,
    });
  });

  afterAll(async () => {
    for (const ctx of [a, b, hidden]) await cleanupTestContext(ctx);
  });

  const inSprints = `sprintstate = ACTIVE AND title ~ ${MARK}`;

  it('groups active sprint issues by sprint and status across projects', async () => {
    const res = await run({
      query: `SELECT COUNT, SUM(storypoints) WHERE ${inSprints} GROUP BY sprint, status`,
    });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('groups');
    expect(res.body.total).toBe(6);
    const sprintKey = (s: { id: string; name: string }, ctx: TestContext) => ({
      id: s.id,
      name: s.name,
      project: { key: ctx.projectPrefix, name: expect.stringContaining('Test Project') },
    });
    const sorted = [...res.body.groups].sort((x, y) =>
      `${x.key.sprint.name}${x.key.status}`.localeCompare(`${y.key.sprint.name}${y.key.status}`),
    );
    expect(sorted).toEqual([
      { key: { sprint: sprintKey(sprintA, a), status: 'In Progress' }, count: 1, sum: 2 },
      { key: { sprint: sprintKey(sprintA, a), status: 'To Do' }, count: 3, sum: 8 },
      { key: { sprint: sprintKey(sprintB, b), status: 'Done' }, count: 1, sum: 0 },
      { key: { sprint: sprintKey(sprintB, b), status: 'To Do' }, count: 1, sum: 8 },
    ]);
  });

  it('merges columns of one name across projects, as the status key is the name', async () => {
    const res = await run({ query: `title ~ ${MARK} GROUP BY status` });
    const counts = Object.fromEntries(
      res.body.groups.map((g: { key: { status: string }; count: number }) => [
        g.key.status,
        g.count,
      ]),
    );
    expect(counts).toEqual({ 'To Do': 5, 'In Progress': 1, Done: 1 });
  });

  it('counts only issues the viewer can see', async () => {
    const query = `SELECT COUNT, SUM(storypoints), AVG(storypoints) WHERE title ~ ${MARK}`;
    const seen = await run({ query });
    expect(seen.body).toEqual({
      kind: 'groups',
      total: 7,
      groups: [{ key: {}, count: 7, sum: 118, avg: 118 / 5 }],
    });

    // Group keys name nothing hidden, whatever the field
    for (const groupBy of ['sprint', 'status', 'project', 'creator']) {
      const res = await run({ query: `${query} GROUP BY ${groupBy}` });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(7);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Secret');
      expect(text).not.toContain(hidden.projectPrefix);
      expect(text).not.toContain(hidden.owner.username);
      const sum = res.body.groups.reduce((all: number, g: { sum: number }) => all + g.sum, 0);
      expect(sum).toBe(118);
    }

    // The same query as the hidden project's owner counts its issues and none of the others
    const owner = await run({ query }, hidden.owner);
    expect(owner.body.total).toBe(2);
    expect(owner.body.groups[0].sum).toBe(3000);

    // And someone in no team at all counts nothing, and gets a group of nothing
    const outsider = await run({ query }, await createTestUser());
    expect(outsider.body).toEqual({
      kind: 'groups',
      total: 0,
      groups: [{ key: {}, count: 0, sum: 0, avg: null }],
    });
    const grouped = await run({ query: `${query} GROUP BY status` }, await createTestUser());
    expect(grouped.body).toEqual({ kind: 'groups', total: 0, groups: [] });
  });

  it('does not name a sprint or column of a hidden project an issue of a visible one points at', async () => {
    const user = await member();
    const tag = `${MARK}stray`;
    const secretColumn = await column(hidden.projectId, `Secret column ${MARK}`);
    await addIssue(a, {
      title: `Stray ${tag}`,
      sprintId: sprintHidden.id,
      columnId: secretColumn.id,
    });
    try {
      const keys = async (groupBy: string) =>
        (await run({ query: `title ~ ${tag} GROUP BY ${groupBy}` }, user)).body.groups;
      expect(await keys('sprint, status')).toEqual([
        { key: { sprint: null, status: 'Backlog' }, count: 1 },
      ]);
      expect(await keys('sprintstate, done')).toEqual([
        { key: { sprintstate: null, done: false }, count: 1 },
      ]);
    } finally {
      await prisma.issue.deleteMany({ where: { title: `Stray ${tag}` } });
    }
  });

  it('groups by every field it allows, each counting the same issues', async () => {
    const user = await member();
    for (const field of [
      'type',
      'status',
      'priority',
      'assignee',
      'creator',
      'sprint',
      'project',
      'done',
      'sprintstate',
    ]) {
      const res = await run({ query: `title ~ ${MARK} GROUP BY ${field}` }, user);
      expect([field, res.status, res.body.total]).toEqual([field, 200, 7]);
      expect(res.body.groups[0].key).toHaveProperty(field);
    }
  });

  it('sums story points per group', async () => {
    const res = await run({
      query: `SELECT SUM(storypoints), AVG(storypoints) WHERE ${inSprints} GROUP BY sprint ORDER BY sprint`,
    });
    expect(res.body.groups.map((g: Record<string, unknown>) => [g.count, g.sum, g.avg])).toEqual([
      [4, 10, 10 / 3],
      [2, 8, 8],
    ]);
  });

  it('rejects GROUP BY on a many field like label with a clear message', async () => {
    const user = await member();
    const label = await run({ query: 'GROUP BY label' }, user);
    expect(label.status).toBe(400);
    expect(label.body.error.code).toBe('INVALID_QUERY');
    expect(label.body.error.message).toContain('label');
    expect(label.body.error.message).toContain('an issue has several');

    const custom = await run({ query: 'GROUP BY cf.Owner' }, user);
    expect(custom.status).toBe(400);
    expect(custom.body.error.code).toBe('INVALID_QUERY');
  });

  it('answers 400 for what the query language has no reading of', async () => {
    const user = await member();
    for (const query of [
      'SELECT SUM(title)',
      'nonsense = 1',
      'type = Nonsense',
      '(type = Bug',
      'GROUP BY status ORDER BY title',
      'ORDER BY label',
      'WHERE',
      '   ',
    ]) {
      const res = await run({ query }, user);
      expect([query, res.status]).toEqual([query, 400]);
    }
    const tooLong = await run({ query: 'x'.repeat(1001) }, user);
    expect(tooLong.status).toBe(400);
  });

  it('returns items without SELECT or GROUP BY, sorted, only what can be seen', async () => {
    const res = await run({ query: `title ~ ${MARK} ORDER BY storypoints DESC` });
    expect(res.status).toBe(200);
    expect(res.body.kind).toBe('items');
    expect(res.body.nextCursor).toBeUndefined();
    expect(res.body.items.map((i: { storyPoints: number | null }) => i.storyPoints)).toEqual([
      100,
      8,
      5,
      3,
      2,
      null,
      null,
    ]);
    expect(res.body.items[0]).toMatchObject({
      key: expect.stringMatching(/^[A-Z0-9]+-\d+$/),
      fullKey: expect.stringContaining(b.orgSlug),
      url: expect.stringContaining(b.orgSlug),
      title: `Issue ${MARK}`,
      type: 'BUG',
      status: 'To Do',
    });
    expect(res.body.items[0]).not.toHaveProperty('body');
  });

  it('searches free text, per word, in title and body, not everything', async () => {
    const user = await member();
    const word = `${MARK}needle`;
    await addIssue(a, { title: `Found ${word}`, body: 'second' });
    await addIssue(a, { title: 'Other', body: `${word} third` });
    await addIssue(hidden, { title: `Hidden ${word}` });
    try {
      const titles = async (query: string) =>
        (await run({ query }, user)).body.items.map((i: { title: string }) => i.title).sort();
      expect(await titles(`${word} ORDER BY title`)).toEqual([`Found ${word}`, 'Other']);
      expect(await titles(`${word} second ORDER BY title`)).toEqual([`Found ${word}`]);
      expect(await titles(`${word} type = Task`)).toEqual([`Found ${word}`, 'Other']);
      expect(await titles(`${word} type = Bug`)).toEqual([]);
      const counted = await run({ query: `${word} GROUP BY type` }, user);
      expect(counted.body.total).toBe(2);
      const blank = await run({ query: '"   " ORDER BY title', limit: 1 }, user);
      expect(blank.status).toBe(200);
    } finally {
      await prisma.issue.deleteMany({ where: { title: { contains: word } } });
      await prisma.issue.deleteMany({ where: { body: { contains: word } } });
    }
  });

  it('pages with an opaque cursor, without gaps or repeats', async () => {
    const user = await member();
    const query = `title ~ ${MARK} ORDER BY number`;
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const res = await run({ query, limit: 3, ...(cursor ? { cursor } : {}) }, user);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(3);
      seen.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('answers 400 for a bad cursor, and for a cursor on groups', async () => {
    const user = await member();
    const b64 = (text: string) => Buffer.from(text).toString('base64');
    for (const cursor of [
      'nonsense!',
      b64('-1'),
      b64('1.5'),
      b64('abc'),
      b64(''),
      b64('007'),
      b64('99999999999999'),
      `${b64('5')}\n`,
    ]) {
      const res = await run({ query: `title ~ ${MARK}`, cursor }, user);
      expect([cursor, res.status]).toEqual([cursor, 400]);
    }
    const good = (await run({ query: `title ~ ${MARK}`, limit: 1 }, user)).body.nextCursor;
    expect(good).toEqual(expect.any(String));
    expect((await run({ query: `GROUP BY status`, cursor: good }, user)).status).toBe(400);
  });

  it('answers the limits: default 50, at most 500, also for groups', async () => {
    const user = await member();
    expect((await run({ query: `title ~ ${MARK}`, limit: 0 }, user)).status).toBe(400);
    expect((await run({ query: `title ~ ${MARK}`, limit: 501 }, user)).status).toBe(400);
    const cut = await run({ query: `title ~ ${MARK} GROUP BY status`, limit: 1 }, user);
    expect(cut.body.groups).toHaveLength(1);
    expect(cut.body.total).toBe(7);
    expect(cut.body.truncated).toBe(true);
  });

  it('returns the fields asked for, id and key always; a body is for read to give', async () => {
    const user = await member();
    const res = await run(
      { query: `title ~ ${MARK} ORDER BY number`, limit: 1, fields: ['storyPoints', 'sprint'] },
      user,
    );
    expect(Object.keys(res.body.items[0]).sort()).toEqual(['id', 'key', 'sprint', 'storyPoints']);
    expect(res.body.items[0].sprint).toEqual({ id: sprintA.id, name: sprintA.name });
    for (const field of ['body', 'parent', 'nonsense']) {
      const refused = await run({ query: `title ~ ${MARK}`, fields: [field] }, user);
      expect([field, refused.status]).toEqual([field, 400]);
    }
  });

  it('narrows with scope, and a scope out of sight is empty like a missing one', async () => {
    const user = await member();
    const count = async (scope: object) =>
      (await run({ query: `SELECT COUNT WHERE title ~ ${MARK}`, scope }, user)).body.total;
    expect(await count({})).toBe(7);
    expect(await count({ projectId: a.projectId })).toBe(4);
    expect(await count({ teamId: b.teamId })).toBe(3);
    expect(await count({ orgId: a.orgId })).toBe(4);
    expect(await count({ orgId: a.orgId, projectId: b.projectId })).toBe(0);
    for (const scope of [
      { projectId: hidden.projectId },
      { teamId: hidden.teamId },
      { orgId: hidden.orgId },
      { projectId: 'missing' },
    ]) {
      expect(await count(scope)).toBe(0);
    }
  });

  it('resolves custom fields among what can be seen: a hidden one is like no field', async () => {
    const user = await member();
    const name = `Tier${MARK}`;
    const secret = `Secret${MARK}`;
    const field = await prisma.customFieldDefinition.create({
      data: { projectId: a.projectId, name, type: 'NUMBER' },
    });
    await prisma.customFieldDefinition.create({
      data: { projectId: hidden.projectId, name: secret, type: 'NUMBER' },
    });
    const issue = await addIssue(a, { title: `Valued ${MARK}x`, storyPoints: 4 });
    await prisma.customFieldValue.create({
      data: { issueId: issue.id, fieldDefinitionId: field.id, value: '7', numberValue: 7 },
    });
    try {
      const res = await run({ query: `SELECT SUM(storypoints) WHERE cf.${name} > 5` }, user);
      expect(res.status).toBe(200);
      expect(res.body.groups[0]).toEqual({ key: {}, count: 1, sum: 4 });

      const missing = await run({ query: `cf.Nope${MARK} > 5` }, user);
      const seenNot = await run({ query: `cf.${secret} > 5` }, user);
      expect(seenNot.status).toBe(400);
      expect(seenNot.body.error.code).toBe(missing.body.error.code);
      expect(seenNot.body.error.message).toBe(
        missing.body.error.message.replace(`Nope${MARK}`, secret),
      );
    } finally {
      await prisma.issue.delete({ where: { id: issue.id } });
    }
  });

  it('refuses more distinct groups than it will hold, instead of a part of them', async () => {
    const user = await member();
    const tag = `${MARK}many`;
    const count = 5001;
    const sprints = Array.from({ length: count }, (_, i) => ({
      id: `${tag}${i}`,
      projectId: a.projectId,
      name: `Many ${i}`,
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-11-15'),
    }));
    await prisma.sprint.createMany({ data: sprints });
    await prisma.issue.createMany({
      data: sprints.map((s, i) => ({
        projectId: a.projectId,
        number: 100000 + i,
        title: tag,
        body: '',
        creatorId: a.owner.id,
        sprintId: s.id,
      })),
    });
    try {
      const res = await run({ query: `title ~ ${tag} GROUP BY sprint` }, user);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_QUERY');
      expect(res.body.error.message).toContain('too many groups');
    } finally {
      await prisma.issue.deleteMany({ where: { title: tag } });
      await prisma.sprint.deleteMany({ where: { id: { startsWith: tag } } });
    }
  }, 60000);

  describe('tokens', () => {
    const tokenWith = async (user: TestUser, scopes: string[]) => {
      const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
      await prisma.apiToken.create({
        data: {
          userId: user.id,
          name: 'query-test',
          tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
          prefix: raw.slice(0, 11),
          scopes,
        },
      });
      return `Token ${raw}`;
    };
    const post = (token: string) =>
      request(app)
        .post('/api/query')
        .set('Authorization', token)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ query: `SELECT COUNT WHERE title ~ ${MARK}` });

    it('needs issues:read besides search:read', async () => {
      const user = await member();
      for (const scopes of [['search:read'], ['issues:read'], ['wiki:read']]) {
        const res = await post(await tokenWith(user, scopes));
        expect([scopes, res.status, res.body.error?.code]).toEqual([scopes, 403, 'SCOPE']);
      }
      const allowed = await post(await tokenWith(user, ['search:read', 'issues:read']));
      expect(allowed.status).toBe(200);
      expect(allowed.body.total).toBe(7);
    });
  });

  it('refuses past the read cap and past the search limit', async () => {
    const user = await member();
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refused = new AppError(500, 'no free slot in the test');
    const running = Array.from({ length: READ_CONCURRENCY.perUser }, () =>
      readSlots.run(user.id, refused, () => held),
    );
    const busy = await run({ query: 'GROUP BY status' }, user);
    release();
    await Promise.all(running);
    expect(busy.status).toBe(429);
    expect(busy.body.error.code).toBe('RATE_LIMITED');

    const limited = await member();
    const answers = [];
    for (let i = 0; i < 31; i++) {
      answers.push((await run({ query: 'GROUP BY status' }, limited)).status);
    }
    expect(answers.slice(0, 30).every((status) => status === 200)).toBe(true);
    expect(answers[30]).toBe(429);
  });

  describe('through the search tool', () => {
    let server: { base: string; close: () => Promise<void> };

    beforeAll(async () => {
      server = await serveApp();
    });
    afterAll(async () => {
      await server.close();
    });

    it('routes a query with clauses, and leaves text alone', async () => {
      const user = await member();
      const client = await connectMcp(server.base, await tokenHeaderFor(user));
      const tool = (query: string, extra: object = {}) =>
        callTool(client, 'search', { query, ...extra });

      const grouped = await tool(`SELECT COUNT WHERE title ~ ${MARK} GROUP BY status`);
      expect(grouped.isError).toBe(false);
      expect(grouped.data.kind).toBe('groups');
      expect(grouped.data.total).toBe(7);

      const items = await tool(`title ~ ${MARK} ORDER BY number`, { limit: 2 });
      expect(items.data.kind).toBe('items');
      expect(items.data.items).toHaveLength(2);
      expect(items.data.nextCursor).toEqual(expect.any(String));

      // Lowercase is still a sentence, and a wiki search stays one whatever its words
      const text = await tool('where is login');
      expect(text.data.map((section: { type: string }) => section.type)).toEqual([
        'issues',
        'wiki',
      ]);
      const wiki = await tool(`WHERE is ${MARK}`, { type: 'wiki' });
      expect(wiki.data.map((section: { type: string }) => section.type)).toEqual(['wiki']);

      // A clause error is a 400, not a text search
      const bad = await tool('GROUP BY label');
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain('an issue has several');
      await client.close();
    });

    it('needs issues:read for a routed query', async () => {
      const user = await member();
      const client = await connectMcp(server.base, await tokenHeaderFor(user, ['search:read']));
      const refused = await callTool(client, 'search', { query: 'GROUP BY status' });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('SCOPE');
      // Plain text still answers, without the sections the token doesn't cover
      const text = await callTool(client, 'search', { query: 'login' });
      expect(text.isError).toBe(false);
      expect(text.data).toEqual([]);
      await client.close();
    });
  });
});
