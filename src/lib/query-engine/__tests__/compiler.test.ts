import { describe, it, expect } from 'vitest';

import type { Expression, QueryContext, Value } from '../ast';
import { compileToPrisma, QueryValueError } from '../compiler';
import { issueFieldRegistry } from '../fields/issue-fields';
import { parse } from '../parser';

const ctx: QueryContext = { currentUserId: 'user-1', projectId: 'proj-1' };

describe('compiler', () => {
  it('compiles simple equality to Prisma where', () => {
    const ast = parse('type:bug');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ type: 'BUG' });
  });

  it('compiles IN to Prisma where with in', () => {
    const ast = parse('priority:high,critical');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ priority: { in: ['HIGH', 'CRITICAL'] } });
  });

  it('compiles AND to merged where', () => {
    const ast = parse('type:bug priority:high');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ AND: [{ type: 'BUG' }, { priority: 'HIGH' }] });
  });

  it('compiles OR to Prisma OR', () => {
    const ast = parse('type = Bug OR type = Task');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ OR: [{ type: 'BUG' }, { type: 'TASK' }] });
  });

  it('compiles NOT to Prisma NOT', () => {
    const ast = parse('NOT type = Bug');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ NOT: { type: 'BUG' } });
  });

  it('compiles currentUser() to userId', () => {
    const ast = parse('assignee = currentUser()');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ assigneeId: 'user-1' });
  });

  it('compiles empty() to null check', () => {
    const ast = parse('assignee = empty()');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ assigneeId: null });
  });

  it('compiles != empty() to not null', () => {
    const ast = parse('assignee != empty()');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ assigneeId: { not: null } });
  });

  it('compiles numeric comparison', () => {
    const ast = parse('storyPoints > 5');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ storyPoints: { gt: 5 } });
  });

  it('compiles contains operator', () => {
    const ast = parse('title ~ "login"');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ title: { contains: 'login', mode: 'insensitive' } });
  });

  it('compiles relation field (status via column)', () => {
    const ast = parse('status = "In Progress"');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ column: { name: { equals: 'in progress', mode: 'insensitive' } } });
  });

  it('compiles label (many relation)', () => {
    const ast = parse('label = "frontend"');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({
      labels: { some: { name: { equals: 'frontend', mode: 'insensitive' } } },
    });
  });

  it('compiles ordinal comparison on priority', () => {
    const ast = parse('priority > Medium');
    const where = compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(where).toEqual({ priority: { in: ['HIGH', 'CRITICAL'] } });
  });

  it('throws for unknown field', () => {
    const ast = parse('foo = bar');
    expect(() => compileToPrisma(ast, issueFieldRegistry, ctx)).toThrow('Unknown field');
  });

  it('throws for non-ordinal enum with > operator', () => {
    const ast = parse('type > Bug');
    expect(() => compileToPrisma(ast, issueFieldRegistry, ctx)).toThrow("Cannot use '>'");
  });

  it.each([
    ['number = 2147483648', 'between'],
    ['number = -2147483649', 'between'],
    ['storyPoints > 99999999999', 'between'],
    ['number = "abc"', 'whole number'],
    ['number ~ "1"', "can't be used"],
    ['created > "not a date"', 'date'],
    ['created ~ "2026"', "can't be used"],
    ['created > "0000-01-01"', 'date'],
    ['created > "+010000-01-01"', 'date'],
    ['type = NOPE', 'one of'],
    ['type ~ "BU"', "can't be used"],
    ['type IN (NOPE)', 'one of'],
    ['number IN (1, 2147483648)', 'between'],
  ])('refuses %s as a query value error', (query, message) => {
    const ast = parse(query);
    const compile = () => compileToPrisma(ast, issueFieldRegistry, ctx);
    expect(compile).toThrow(QueryValueError);
    expect(compile).toThrow(message);
  });

  // The same refusals when a value comes as an AST
  it.each([
    ['number', '=', { type: 'null' }, 'null'],
    ['storyPoints', '>', { type: 'null' }, 'null'],
    ['title', '=', { type: 'null' }, 'null'],
    ['number', '=', { type: 'number', value: 1.5 }, 'whole number'],
    ['number', '=', { type: 'number', value: -2147483649 }, 'between'],
  ] as const)('refuses %s %s %j', (field, operator, value, message) => {
    const ast: Expression = { type: 'comparison', field, operator, value };
    expect(() => compileToPrisma(ast, issueFieldRegistry, ctx)).toThrow(message);
  });

  it('keeps the edges of the column and the empty questions', () => {
    const compile = (query: string) => compileToPrisma(parse(query), issueFieldRegistry, ctx);
    const compileAst = (field: string, operator: '=' | '!=', value: Value) =>
      compileToPrisma({ type: 'comparison', field, operator, value }, issueFieldRegistry, ctx);
    expect(compile('number = 2147483647')).toEqual({ number: 2147483647 });
    expect(compileAst('number', '=', { type: 'number', value: -2147483648 })).toEqual({
      number: -2147483648,
    });
    expect(compileAst('storyPoints', '=', { type: 'null' })).toEqual({ storyPoints: null });
    expect(compileAst('assignee', '!=', { type: 'null' })).toEqual({ assigneeId: { not: null } });
    expect(compile('title = 5')).toEqual({ title: '5' });
    expect(compile('created > "2026-01-31"')).toEqual({
      createdAt: { gt: new Date('2026-01-31') },
    });
  });

  it('knows no field or function from the prototype', () => {
    for (const query of ['constructor = 1', '__proto__ = 1', 'constructor IN (1)']) {
      const compile = () => compileToPrisma(parse(query), issueFieldRegistry, ctx);
      expect(compile).toThrow('Unknown field');
    }
    const fn = () => compileToPrisma(parse('title = constructor()'), issueFieldRegistry, ctx);
    expect(fn).toThrow('Unknown function');
  });

  it('flattens a chain, so its length is no depth', () => {
    const compile = (query: string) => compileToPrisma(parse(query), issueFieldRegistry, ctx);
    expect(compile('number = 1 OR number = 2 OR number = 3')).toEqual({
      OR: [{ number: 1 }, { number: 2 }, { number: 3 }],
    });
    expect(compile('number = 1 AND (number = 2 AND number = 3)')).toEqual({
      AND: [{ number: 1 }, { number: 2 }, { number: 3 }],
    });
    const long = Array.from({ length: 200 }, (_, i) => `number = ${i}`).join(' OR ');
    expect((compile(long).OR as unknown[]).length).toBe(200);
  });

  it('refuses nesting past the cap', () => {
    const compile = (query: string) => compileToPrisma(parse(query), issueFieldRegistry, ctx);
    const nested = (levels: number) => `${'NOT ('.repeat(levels)}number = 1${')'.repeat(levels)}`;
    expect(() => compile(nested(100))).toThrow(QueryValueError);
    expect(() => compile(nested(5))).not.toThrow();
  });

  it('compiles IN on a relation through its join', () => {
    const compile = (query: string) => compileToPrisma(parse(query), issueFieldRegistry, ctx);
    expect(compile('status IN ("Done", "Todo")')).toEqual({
      column: { name: { in: ['Done', 'Todo'], mode: 'insensitive' } },
    });
    expect(compile('label NOT IN ("a")')).toEqual({
      labels: { none: { name: { in: ['a'], mode: 'insensitive' } } },
    });
  });
});
