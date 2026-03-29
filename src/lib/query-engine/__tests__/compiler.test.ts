import { describe, it, expect } from 'vitest';

import type { QueryContext } from '../ast';
import { compileToPrisma } from '../compiler';
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
});
