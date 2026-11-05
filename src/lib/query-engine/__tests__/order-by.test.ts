import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../../../test/factory';
import { compileOrderBy, compileToPrisma } from '../compiler';
import { issueFieldRegistry } from '../fields/issue-fields';
import { ParseError } from '../lexer';
import { parse, parseQuery } from '../parser';

describe('parseQuery', () => {
  it('parses a where part and an ORDER BY clause', () => {
    const q = parseQuery('priority > Low ORDER BY priority DESC, updated ASC');
    expect(q.where).toEqual(parse('priority > Low'));
    expect(q.orderBy).toEqual([
      { field: 'priority', dir: 'desc' },
      { field: 'updated', dir: 'asc' },
    ]);
  });

  it('defaults to ascending and allows ORDER BY alone', () => {
    expect(parseQuery('ORDER BY title')).toEqual({
      where: null,
      orderBy: [{ field: 'title', dir: 'asc' }],
    });
  });

  it('leaves a query without a clause as parse() reads it', () => {
    expect(parseQuery('type = Bug')).toEqual({ where: parse('type = Bug'), orderBy: [] });
  });

  it('does not read ORDER BY inside quotes or in lowercase as a clause', () => {
    expect(parseQuery('title ~ "ORDER BY x"').orderBy).toEqual([]);
    expect(parseQuery('type = Bug AND title ~ "a ORDER BY b"').orderBy).toEqual([]);
    expect(parseQuery('order by title').orderBy).toEqual([]);
  });

  it('refuses fields that cannot be sorted, naming the field', () => {
    expect(() => parseQuery('type = Bug ORDER BY label')).toThrow('label cannot be sorted');
    for (const field of ['blocked', 'blocks', 'linked', 'text', 'cf.Owner']) {
      expect(() => parseQuery(`ORDER BY ${field}`)).toThrow(ParseError);
    }
  });

  it('refuses unknown fields, bad directions, empty terms and repeats', () => {
    expect(() => parseQuery('ORDER BY nope')).toThrow(/Unknown field 'nope'/);
    expect(() => parseQuery('ORDER BY title UP')).toThrow(/ASC or DESC/);
    expect(() => parseQuery('ORDER BY')).toThrow(/expects a field/);
    expect(() => parseQuery('ORDER BY title,')).toThrow(/expects a field/);
    expect(() => parseQuery('ORDER BY title DESC extra')).toThrow(ParseError);
    expect(() => parseQuery('ORDER BY title, title DESC')).toThrow(/twice/);
  });

  it('reports the position in the whole input', () => {
    try {
      parseQuery('type = Bug ORDER BY title, label');
      expect.unreachable();
    } catch (error) {
      expect((error as ParseError).position).toBe(27);
    }
  });

  it('keeps parse() as it was', () => {
    // The words after a comparison search as text, as before
    expect(JSON.stringify(parse('type = Bug ORDER BY title'))).toContain('freetext');
  });
});

describe('compileOrderBy', () => {
  it('ends in id and puts nulls last', () => {
    expect(compileOrderBy([{ field: 'storypoints', dir: 'desc' }])).toEqual([
      { storyPoints: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ]);
  });
});

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
