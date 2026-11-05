import { describe, expect, it } from 'vitest';

import { buildGroups, type GroupLabels, type GroupRow } from '../aggregate';
import { hasQueryClauses, parse, parseQuery } from '../parser';

describe('SELECT and GROUP BY clauses', () => {
  it('reads the plan example', () => {
    const q = parseQuery(
      'SELECT COUNT, SUM(storypoints) WHERE sprintstate = ACTIVE GROUP BY sprint, status',
    );
    expect(q.select).toEqual(['count', 'sum']);
    expect(q.where).toEqual(parse('sprintstate = ACTIVE'));
    expect(q.groupBy).toEqual(['sprint', 'status']);
    expect(q.orderBy).toEqual([]);
  });

  it('takes GROUP BY alone, and a where part with or without the keyword', () => {
    expect(parseQuery('GROUP BY status')).toEqual({
      where: null,
      orderBy: [],
      groupBy: ['status'],
    });
    expect(parseQuery('type = Bug GROUP BY status').where).toEqual(parse('type = Bug'));
    expect(parseQuery('WHERE type = Bug GROUP BY status').where).toEqual(parse('type = Bug'));
    expect(parseQuery('WHERE (type = Bug)').where).toEqual(parse('(type = Bug)'));
  });

  it('takes SELECT without GROUP BY, and its terms in any case and spacing', () => {
    const q = parseQuery('SELECT AVG( storyPoints ), sum(storypoints), count(*)');
    expect(q.select).toEqual(['avg', 'sum', 'count']);
    expect(q.groupBy).toBeUndefined();
    expect(q.where).toBeNull();
  });

  it('keeps ORDER BY after GROUP BY, on the fields it groups by', () => {
    const q = parseQuery('GROUP BY status, priority ORDER BY priority DESC');
    expect(q.groupBy).toEqual(['status', 'priority']);
    expect(q.orderBy).toEqual([{ field: 'priority', dir: 'desc' }]);
  });

  it('adds no keys to a query without these clauses', () => {
    expect(parseQuery('type = Bug')).toEqual({ where: parse('type = Bug'), orderBy: [] });
  });

  it('leaves quoted keywords and lowercase words as they are', () => {
    expect(parseQuery('title ~ "a GROUP BY b"').groupBy).toBeUndefined();
    expect(parseQuery('title ~ "WHERE x"').where).toEqual(parse('title ~ "WHERE x"'));
    expect(parseQuery('group by status').groupBy).toBeUndefined();
    expect(parseQuery('where is login').where).toEqual(parse('where is login'));
    expect(parseQuery('select count').select).toBeUndefined();
    expect(parseQuery('SELECTED items').select).toBeUndefined();
  });

  it.each([
    ['label', 'an issue has several'],
    ['cf.Team', 'cannot be grouped'],
    ['cf."Team name"', 'cannot be grouped'],
    ['text', 'cannot be grouped'],
    ['blocked', 'cannot be grouped'],
    ['blocks', 'cannot be grouped'],
    ['linked', 'cannot be grouped'],
    ['created', 'cannot be grouped'],
    ['updated', 'cannot be grouped'],
    ['duedate', 'cannot be grouped'],
    ['title', 'cannot be grouped'],
    ['number', 'cannot be grouped'],
    ['storypoints', 'cannot be grouped'],
    ['nonsense', 'Unknown field'],
    ['toString', 'Unknown field'],
  ])('refuses GROUP BY %s, naming why', (field, message) => {
    expect(() => parseQuery(`GROUP BY ${field}`)).toThrow(message);
  });

  it.each([
    ['GROUP BY', 'expects a field'],
    ['GROUP BY status,', 'expects a field'],
    ['GROUP BY status, status', 'twice'],
    ['GROUP BY type, status, priority', 'at most 2'],
    ['GROUP BY status extra', 'Unexpected'],
    ['SELECT', 'SELECT expects'],
    ['SELECT COUNT, COUNT', 'twice'],
    ['SELECT title', 'SELECT takes'],
    ['SELECT SUM(title)', 'only storypoints'],
    ['SELECT AVG(created)', 'only storypoints'],
    ['SELECT COUNT type = Bug', 'SELECT takes'],
    ['WHERE', 'WHERE expects'],
    ['WHERE GROUP BY status', 'WHERE expects'],
    ['login WHERE type = Bug', 'before WHERE'],
    ['WHERE type = Bug WHERE type = Task', 'twice'],
    ['GROUP BY status GROUP BY type', 'twice'],
    ['GROUP BY status WHERE type = Bug', 'before GROUP BY'],
    ['ORDER BY title GROUP BY status', 'before ORDER BY'],
    ['ORDER BY title WHERE type = Bug', 'before ORDER BY'],
    ['GROUP BY status ORDER BY title', 'fields from GROUP BY'],
    ['SELECT COUNT ORDER BY title', 'fields from GROUP BY'],
  ])('refuses %s', (query, message) => {
    expect(() => parseQuery(query)).toThrow(message);
  });
});

describe('hasQueryClauses', () => {
  it.each([
    'SELECT COUNT',
    'WHERE type = Bug',
    'type = Bug GROUP BY status',
    'type = Bug ORDER BY title',
    'GROUP BY status',
    'ORDER BY title DESC',
  ])('routes %s', (query) => {
    expect(hasQueryClauses(query)).toBe(true);
  });

  it.each([
    'where is login',
    'select count',
    'order by title',
    'group by status',
    'GROUP BY',
    'ORDER BY',
    'SELECTED items',
    'type = Bug',
    'type:bug login',
  ])('leaves %s to the plain search', (query) => {
    expect(hasQueryClauses(query)).toBe(false);
  });
});

describe('buildGroups', () => {
  const labels: GroupLabels = {
    columns: new Map([
      ['c1', { name: 'Done', isDone: true }],
      ['c2', { name: 'Done', isDone: true }],
      ['c3', { name: 'To Do', isDone: false }],
    ]),
    sprints: new Map([
      ['s1', { id: 's1', name: 'One', status: 'ACTIVE', project: { key: 'AAA', name: 'A' } }],
    ]),
    users: new Map([['u1', { id: 'u1', username: 'ann', displayName: 'Ann' }]]),
    projects: new Map([['p1', { id: 'p1', key: 'AAA', name: 'A' }]]),
  };
  const row = (columns: Partial<GroupRow>): GroupRow => ({
    count: 1,
    pointsSum: 0,
    pointsCount: 0,
    ...columns,
  });
  const none = { aggregates: [] as Array<'sum' | 'avg'>, orderBy: [], limit: 50 };

  it('merges columns of one name, and averages over points that exist', () => {
    const { groups, total } = buildGroups(
      [
        row({ columnId: 'c1', count: 2, pointsSum: 6, pointsCount: 2 }),
        row({ columnId: 'c2', count: 3, pointsSum: 2, pointsCount: 1 }),
      ],
      ['status'],
      labels,
      { ...none, aggregates: ['sum', 'avg'] },
    );
    expect(groups).toEqual([{ key: { status: 'Done' }, count: 5, sum: 8, avg: 8 / 3 }]);
    expect(total).toBe(5);
  });

  it('answers 0 for a sum and null for an average without points, and neither unasked', () => {
    const rows = [row({ columnId: 'c3' })];
    expect(
      buildGroups(rows, ['status'], labels, { ...none, aggregates: ['sum', 'avg'] }).groups[0],
    ).toEqual({ key: { status: 'To Do' }, count: 1, sum: 0, avg: null });
    expect(buildGroups(rows, ['status'], labels, none).groups[0]).toEqual({
      key: { status: 'To Do' },
      count: 1,
    });
  });

  it('labels each kind of key, and what has none', () => {
    const { groups } = buildGroups(
      [
        row({
          sprintId: 's1',
          columnId: 'c1',
          assigneeId: 'u1',
          creatorId: 'u1',
          projectId: 'p1',
          type: 'BUG',
          priority: 'HIGH',
        }),
      ],
      [
        'sprint',
        'sprintstate',
        'status',
        'done',
        'assignee',
        'creator',
        'project',
        'type',
        'priority',
      ],
      labels,
      none,
    );
    expect(groups[0].key).toEqual({
      sprint: { id: 's1', name: 'One', project: { key: 'AAA', name: 'A' } },
      sprintstate: 'ACTIVE',
      status: 'Done',
      done: true,
      assignee: { id: 'u1', username: 'ann', displayName: 'Ann' },
      creator: { id: 'u1', username: 'ann', displayName: 'Ann' },
      project: { id: 'p1', key: 'AAA', name: 'A' },
      type: 'BUG',
      priority: 'HIGH',
    });
    const empty = buildGroups(
      [row({ sprintId: null, columnId: null, assigneeId: null })],
      ['sprint', 'sprintstate', 'status', 'done', 'assignee'],
      labels,
      none,
    );
    expect(empty.groups[0].key).toEqual({
      sprint: null,
      sprintstate: null,
      status: 'Backlog',
      done: false,
      assignee: null,
    });
  });

  it('sorts by count, largest first, unless told otherwise', () => {
    const rows = [
      row({ priority: 'LOW', count: 1 }),
      row({ priority: 'CRITICAL', count: 2 }),
      row({ priority: 'MEDIUM', count: 3 }),
    ];
    const order = (orderBy: Array<{ field: string; dir: 'asc' | 'desc' }>) =>
      buildGroups(rows, ['priority'], labels, { ...none, orderBy }).groups.map(
        (group) => group.key.priority,
      );
    expect(order([])).toEqual(['MEDIUM', 'CRITICAL', 'LOW']);
    expect(order([{ field: 'priority', dir: 'desc' }])).toEqual(['CRITICAL', 'MEDIUM', 'LOW']);
    expect(order([{ field: 'priority', dir: 'asc' }])).toEqual(['LOW', 'MEDIUM', 'CRITICAL']);
  });

  it('puts an empty key last ascending and first descending, as the items do', () => {
    const rows = [row({ assigneeId: null, count: 5 }), row({ assigneeId: 'u1', count: 1 })];
    const first = (dir: 'asc' | 'desc') =>
      buildGroups(rows, ['assignee'], labels, {
        ...none,
        orderBy: [{ field: 'assignee', dir }],
      }).groups[0].key.assignee;
    expect(first('asc')).toEqual({ id: 'u1', username: 'ann', displayName: 'Ann' });
    expect(first('desc')).toBeNull();
  });

  it('cuts at the limit, says so, and keeps the total of everything', () => {
    const rows = [row({ priority: 'LOW', count: 2 }), row({ priority: 'HIGH', count: 3 })];
    const cut = buildGroups(rows, ['priority'], labels, { ...none, limit: 1 });
    expect(cut.groups).toHaveLength(1);
    expect(cut.total).toBe(5);
    expect(cut.truncated).toBe(true);
    expect(buildGroups(rows, ['priority'], labels, none).truncated).toBeUndefined();
  });
});
