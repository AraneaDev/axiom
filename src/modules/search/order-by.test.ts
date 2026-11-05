import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  compileOrderBy,
  compileToPrisma,
  issueFieldRegistry,
  parseQuery,
} from '../../lib/query-engine';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';

describe('ORDER BY against the database', () => {
  let ctx: TestContext;
  const titles: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestContext('order-by');
    const column = await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: ctx.projectId },
    });
    const rows = [
      { title: 'a', priority: 'LOW', storyPoints: 3 },
      { title: 'b', priority: 'CRITICAL', storyPoints: null },
      { title: 'c', priority: 'MEDIUM', storyPoints: 1 },
      { title: 'd', priority: 'HIGH', storyPoints: 8 },
      { title: 'e', priority: 'CRITICAL', storyPoints: 2 },
    ] as const;
    for (const [i, row] of rows.entries()) {
      const issue = await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 2000 + i,
          title: row.title,
          body: '',
          creatorId: ctx.owner.id,
          columnId: column.id,
          priority: row.priority,
          storyPoints: row.storyPoints,
        },
      });
      titles[issue.id] = row.title;
    }
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
  });

  const order = async (query: string) => {
    const { where, orderBy } = parseQuery(query);
    const compiled = where
      ? compileToPrisma(where, issueFieldRegistry, { currentUserId: ctx.owner.id })
      : {};
    const rows = await prisma.issue.findMany({
      where: { AND: [{ projectId: ctx.projectId }, compiled] },
      orderBy: compileOrderBy(orderBy) as never,
      select: { id: true },
    });
    return rows.map((r) => titles[r.id]).join('');
  };

  it('sorts priority by ordinal: DESC is CRITICAL first, ties by id', async () => {
    const desc = await order('ORDER BY priority DESC');
    expect(desc.slice(0, 2).split('').sort().join('')).toBe('be');
    expect(desc.slice(2)).toBe('dca');
    expect((await order('ORDER BY priority ASC')).slice(0, 3)).toBe('acd');
  });

  it('applies the where part and several terms', async () => {
    expect(await order('priority > Low ORDER BY priority DESC, title DESC')).toBe('ebdc');
  });

  it('puts null story points last in both directions', async () => {
    expect(await order('ORDER BY storypoints ASC')).toBe('ceadb');
    expect(await order('ORDER BY storypoints DESC')).toBe('daecb');
  });

  it('sorts by title', async () => {
    expect(await order('ORDER BY title DESC')).toBe('edcba');
  });

  it('accepts every sortable field', async () => {
    for (const field of [
      'type',
      'status',
      'priority',
      'assignee',
      'creator',
      'sprint',
      'project',
      'storypoints',
      'created',
      'updated',
      'duedate',
      'number',
      'title',
      'done',
      'sprintstate',
    ]) {
      await expect(order(`ORDER BY ${field} DESC`)).resolves.toHaveLength(5);
    }
  });
});
