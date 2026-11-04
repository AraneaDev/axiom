import { describe, it, expect } from 'vitest';

import type { QueryContext } from '../ast';
import { assertKnownFields, evaluate } from '../evaluator';
import { issueFieldRegistry } from '../fields/issue-fields';
import { parse } from '../parser';

const ctx: QueryContext = { currentUserId: 'user-1', projectId: 'proj-1' };

const issue = {
  type: 'BUG',
  priority: 'HIGH',
  storyPoints: 5,
  title: 'Fix login bug',
  number: 42,
  assigneeId: 'user-1',
  assignee: { id: 'user-1', username: 'tim', displayName: 'Tim', email: 'tim@test.com' },
  creator: { id: 'user-2', username: 'jane', displayName: 'Jane', email: 'jane@test.com' },
  creatorId: 'user-2',
  labels: [{ name: 'frontend' }, { name: 'urgent' }],
  sprint: { id: 'sprint-1', name: 'Sprint 1', goal: null },
  sprintId: 'sprint-1',
  column: { id: 'col-1', name: 'In Progress' },
  project: { id: 'proj-1', name: 'Axiom', key: 'AXM' },
  projectId: 'proj-1',
  createdAt: new Date('2026-03-01'),
  updatedAt: new Date('2026-03-29'),
  dueDate: null,
};

describe('evaluator', () => {
  it('evaluates simple equality', () => {
    expect(evaluate(parse('type = Bug'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('type = Task'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates IN', () => {
    expect(evaluate(parse('type IN (Bug, Task)'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('type IN (Task, Story)'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates NOT IN', () => {
    expect(evaluate(parse('type NOT IN (Task, Story)'), issue, issueFieldRegistry, ctx)).toBe(true);
  });

  it('evaluates AND', () => {
    expect(evaluate(parse('type = Bug AND priority = High'), issue, issueFieldRegistry, ctx)).toBe(
      true,
    );
    expect(evaluate(parse('type = Bug AND priority = Low'), issue, issueFieldRegistry, ctx)).toBe(
      false,
    );
  });

  it('evaluates OR', () => {
    expect(evaluate(parse('type = Task OR priority = High'), issue, issueFieldRegistry, ctx)).toBe(
      true,
    );
    expect(evaluate(parse('type = Task OR priority = Low'), issue, issueFieldRegistry, ctx)).toBe(
      false,
    );
  });

  it('evaluates NOT', () => {
    expect(evaluate(parse('NOT type = Task'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('NOT type = Bug'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates numeric comparison', () => {
    expect(evaluate(parse('storyPoints > 3'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('storyPoints > 5'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates contains', () => {
    expect(evaluate(parse('title ~ "login"'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('title ~ "signup"'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates currentUser()', () => {
    expect(evaluate(parse('assignee = currentUser()'), issue, issueFieldRegistry, ctx)).toBe(true);
  });

  it('evaluates empty()', () => {
    expect(evaluate(parse('dueDate = empty()'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('assignee = empty()'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates label (many relation)', () => {
    expect(evaluate(parse('label = "frontend"'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('label = "backend"'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates status (relation)', () => {
    expect(evaluate(parse('status = "In Progress"'), issue, issueFieldRegistry, ctx)).toBe(true);
  });

  it('evaluates ordinal priority comparison', () => {
    expect(evaluate(parse('priority > Medium'), issue, issueFieldRegistry, ctx)).toBe(true);
    expect(evaluate(parse('priority > High'), issue, issueFieldRegistry, ctx)).toBe(false);
  });

  it('evaluates simple mode query', () => {
    expect(evaluate(parse('type:bug priority:high'), issue, issueFieldRegistry, ctx)).toBe(true);
  });

  it('reads IN on a label as = does, in either case', () => {
    const issue = { labels: [{ name: 'l1' }, { name: 'L2' }] };
    const run = (query: string) => evaluate(parse(query), issue, issueFieldRegistry, {});
    expect(run('label = "l1"')).toBe(true);
    expect(run('label IN ("l1")')).toBe(true);
    expect(run('label IN ("l2", "x")')).toBe(true);
    expect(run('label IN ("x")')).toBe(false);
    expect(run('label NOT IN ("l1")')).toBe(false);
    expect(run('label NOT IN ("x")')).toBe(true);
    expect(evaluate(parse('label IN ("x")'), {}, issueFieldRegistry, {})).toBe(false);
  });

  it('knows no field or function from the prototype', () => {
    for (const query of ['constructor = 1', '__proto__ = 1', 'toString IN (1)']) {
      expect(() => evaluate(parse(query), {}, issueFieldRegistry, {})).toThrow('Unknown field');
    }
    expect(() => evaluate(parse('title = constructor()'), {}, issueFieldRegistry, {})).toThrow(
      'Unknown function',
    );
  });

  it('finds the unknown fields of a condition', () => {
    const check = (query: string) => assertKnownFields(parse(query), issueFieldRegistry);
    expect(() => check('type = Bug AND (NOT priority IN (High) OR label = "x")')).not.toThrow();
    expect(() => check('type = Bug AND (NOT nonsense = 1)')).toThrow('nonsense');
    expect(() => check('__proto__ IN (1)')).toThrow('__proto__');
  });
});
