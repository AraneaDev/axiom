import { describe, expect, it } from 'vitest';

import type { CustomFieldType, Expression, QueryContext } from '../ast';
import { compileToPrisma, QueryValueError } from '../compiler';
import { typedCustomFieldValue } from '../custom-fields';
import { assertKnownFields, evaluate, freeTextOf } from '../evaluator';
import { issueFieldRegistry } from '../fields/issue-fields';
import { tokenize, TokenType } from '../lexer';
import { parse } from '../parser';

const customFields = new Map<string, CustomFieldType[]>([
  ['severity', ['SELECT']],
  ['cost', ['NUMBER']],
  ['ship date', ['DATE']],
  ['notes', ['TEXT']],
  ['owner', ['USER']],
  ['areas', ['MULTI_SELECT']],
  ['mixed', ['NUMBER', 'TEXT']],
]);
const linkedIssues = new Map<string, string | null>([
  ['AXM-12', 'issue-12'],
  ['AXM-99', null],
]);
const ctx: QueryContext = { currentUserId: 'user-1', projectId: 'p1', customFields, linkedIssues };

const compile = (query: string, context: QueryContext = ctx) =>
  compileToPrisma(parse(query), issueFieldRegistry, context);

const open = { column: { isDone: false } };
const done = { column: { isDone: true } };
const value = (name: string, type: CustomFieldType, stored: string) => ({
  value: stored,
  fieldDefinition: { name, type },
});

const issue = {
  id: 'i1',
  title: 'Fix the login page',
  body: 'Users see a timeout on checkout',
  column: { id: 'c1', name: 'Doing', isDone: false },
  sprint: { id: 's1', name: 'One', goal: null, status: 'ACTIVE' },
  sprintId: 's1',
  assigneeId: null,
  storyPoints: -5,
  number: 7,
  labels: [],
  linksFrom: [{ type: 'IS_BLOCKED_BY', toId: 'issue-12', to: open }],
  linksTo: [],
  customFieldValues: [
    value('Severity', 'SELECT', 'High'),
    value('Cost', 'NUMBER', '10'),
    value('Ship date', 'DATE', '2026-03-01'),
    value('Notes', 'TEXT', 'needs a second look'),
    value('Owner', 'USER', 'user-1'),
    value('Areas', 'MULTI_SELECT', 'Api,Web'),
  ],
};
const run = (query: string, target: Record<string, unknown> = issue, context = ctx) =>
  evaluate(parse(query), target, issueFieldRegistry, context);

describe('the words of the new fields', () => {
  it('lexes an issue key as one value in a structured query', () => {
    expect(parse('linked = AXM-12')).toEqual({
      type: 'comparison',
      field: 'linked',
      operator: '=',
      value: { type: 'string', value: 'AXM-12' },
    });
    expect(tokenize('linked IN (AXM-12, B2-3)').filter((t) => t.type === TokenType.STRING)).toEqual(
      [
        { type: TokenType.STRING, value: 'AXM-12', position: 11 },
        { type: TokenType.STRING, value: 'B2-3', position: 19 },
      ],
    );
  });

  it('keeps an issue key without an operator as free text', () => {
    expect(parse('AXM-12')).toEqual({ type: 'freetext', value: 'AXM-12' });
  });

  it('reads cf.Name and cf."Name with spaces", keeping the case of the name', () => {
    const field = (query: string) => (parse(query) as { field: string }).field;
    expect(field('cf.Severity = High')).toBe('cf.Severity');
    expect(field('CF.Severity = High')).toBe('cf.Severity');
    expect(field('cf."Ship date" > "2026-01-01"')).toBe('cf.Ship date');
    expect(parse('cf.Severity NOT IN (High)')).toMatchObject({
      type: 'in',
      field: 'cf.Severity',
      negated: true,
    });
  });

  it('refuses a custom field without a name', () => {
    expect(() => parse('cf."" = 1')).toThrow('name');
  });

  it('leaves key:value on the new fields as the text it was', () => {
    for (const query of ['text:login', 'done:true', 'blocked:true', 'linked:x', 'sprintstate:y']) {
      expect(parse(query)).toEqual({ type: 'freetext', value: query });
    }
    expect(freeTextOf(parse('type:bug done:true'))).toBe('done:true');
    expect(() => assertKnownFields(parse('done:true'), issueFieldRegistry)).toThrow('plain text');
  });
});

describe('the language fixes', () => {
  it('keeps the minus of a number', () => {
    expect(parse('storyPoints = -5')).toMatchObject({ value: { type: 'number', value: -5 } });
    expect(parse('number IN (1, -2)')).toMatchObject({
      values: [
        { type: 'number', value: 1 },
        { type: 'number', value: -2 },
      ],
    });
    expect(compile('storyPoints > -5')).toEqual({ storyPoints: { gt: -5 } });
    expect(run('storyPoints = -5')).toBe(true);
    expect(run('storyPoints = 5')).toBe(false);
  });

  it('reads a fraction as one number', () => {
    expect(parse('cf.Cost > 1.5')).toMatchObject({ value: { type: 'number', value: 1.5 } });
    expect(() => compile('number = 1.5')).toThrow('whole number');
  });

  it('reads null as the empty value, and "null" as text', () => {
    expect(parse('assignee = null')).toMatchObject({ value: { type: 'null' } });
    expect(parse('assignee = NULL')).toMatchObject({ value: { type: 'null' } });
    expect(parse('title = "null"')).toMatchObject({ value: { type: 'string', value: 'null' } });
    expect(compile('assignee = null')).toEqual({ assigneeId: null });
    expect(compile('assignee != null')).toEqual({ assigneeId: { not: null } });
    expect(compile('status = null')).toEqual({ column: null });
    expect(compile('status != null')).toEqual({ NOT: { column: null } });
    expect(compile('label = null')).toEqual({ labels: { none: {} } });
    expect(compile('label != null')).toEqual({ labels: { some: {} } });
    expect(() => compile('title = null')).toThrow(QueryValueError);

    expect(run('assignee = null')).toBe(true);
    expect(run('assignee != null')).toBe(false);
    expect(run('status = null')).toBe(false);
    expect(run('status = null', { ...issue, column: null })).toBe(true);
    expect(run('label = null')).toBe(true);
    expect(run('label != null')).toBe(false);
  });

  it('never takes the text "null" for an empty value', () => {
    expect(run('assignee = "null"')).toBe(false);
    expect(run('duedate = "null"', { ...issue, dueDate: null })).toBe(false);
  });

  it('matches nobody for currentUser() without a user', () => {
    const noUser: QueryContext = { projectId: 'p1' };
    const nothing = { id: { in: [] } };
    expect(compile('assignee = currentUser()', noUser)).toEqual(nothing);
    expect(compile('assignee != currentUser()', noUser)).toEqual({});
    expect(compile('assignee IN (currentUser())', noUser)).toEqual(nothing);
    expect(compile('assignee NOT IN (currentUser())', noUser)).toEqual({});
    expect(compile('assignee IN (currentUser(), "u2")', noUser)).toEqual({
      OR: [{ assigneeId: 'u2' }, { assignee: { username: { equals: 'u2', mode: 'insensitive' } } }],
    });
    expect(() => compile('created > currentUser()', noUser)).toThrow(QueryValueError);

    const unassigned = { ...issue, assigneeId: null };
    expect(run('assignee = currentUser()', unassigned, noUser)).toBe(false);
    expect(run('assignee != currentUser()', unassigned, noUser)).toBe(true);
    expect(run('assignee IN (currentUser())', unassigned, noUser)).toBe(false);
    expect(run('assignee = currentUser()', unassigned, { currentUserId: '' })).toBe(false);
    // With a user nothing changes
    expect(compile('assignee = currentUser()')).toEqual({ assigneeId: 'user-1' });
    expect(run('assignee = currentUser()', { ...issue, assigneeId: 'user-1' })).toBe(true);
  });

  it('keeps the text after or before a spaced comparison, as key:value does', () => {
    const type = {
      type: 'comparison',
      field: 'type',
      operator: '=',
      value: { type: 'string', value: 'bug' },
    };
    expect(parse('type = Bug login page')).toEqual({
      type: 'and',
      left: type,
      right: { type: 'freetext', value: 'login page' },
    });
    expect(parse('login type = Bug')).toEqual({
      type: 'and',
      left: { type: 'freetext', value: 'login' },
      right: type,
    });
    expect(freeTextOf(parse('type = Bug "login page" 42 AXM-12'))).toBe('login page 42 AXM-12');
    expect(compile('type = Bug login')).toEqual({ AND: [{ type: 'BUG' }, {}] });
    // Text says nothing about an issue: never what makes a rule fire, and refused in a new one
    expect(run('type = Bug login', { ...issue, type: 'BUG' })).toBe(false);
    expect(() => assertKnownFields(parse('type = Bug login'), issueFieldRegistry)).toThrow(
      'plain text',
    );
    // What isn't text after a whole comparison stays an error
    expect(() => parse('type = Bug login priority = High')).toThrow();
    expect(() => parse('login AND type = Bug')).toThrow();
  });

  it('refuses function arguments it cannot read, instead of dropping them', () => {
    expect(() => parse('created > now(nope())')).toThrow('now');
    expect(() => parse('created > now(7x)')).toThrow('now');
    expect(() => parse('assignee = currentUser(tim)')).toThrow('currentuser');
    expect(() => assertKnownFields(parse('created > now()'), issueFieldRegistry)).not.toThrow();
  });

  it('applies the duration of now(), in both directions', () => {
    const day = 24 * 60 * 60 * 1000;
    const bound = (query: string) =>
      (compile(query) as { createdAt: { gt: Date } }).createdAt.gt.getTime();
    expect(Math.abs(bound('created > now(-7d)') - (Date.now() - 7 * day))).toBeLessThan(5000);
    expect(Math.abs(bound('created > now(+7d)') - (Date.now() + 7 * day))).toBeLessThan(5000);
    expect(Math.abs(bound('created > now()') - Date.now())).toBeLessThan(5000);

    const old = { ...issue, createdAt: new Date(Date.now() - 2 * day) };
    expect(run('created > now(-3d)', old)).toBe(true);
    expect(run('created > now(-1d)', old)).toBe(false);
  });

  it('reads currentSprint() as the active sprint', () => {
    expect(compile('sprint = currentSprint()')).toEqual({ sprint: { status: 'ACTIVE' } });
    expect(compile('sprint != currentSprint()')).toEqual({ NOT: { sprint: { status: 'ACTIVE' } } });
    expect(run('sprint = currentSprint()')).toBe(true);
    expect(run('sprint != currentSprint()')).toBe(false);
    expect(run('sprint = currentSprint()', { ...issue, sprint: null, sprintId: null })).toBe(false);
  });

  it('takes % and _ literally in text comparisons', () => {
    expect(compile('title ~ "100%"')).toEqual({
      title: { contains: '100\\%', mode: 'insensitive' },
    });
    expect(compile('status = "a_b"')).toEqual({
      column: { name: { equals: 'a\\_b', mode: 'insensitive' } },
    });
  });
});

describe('names as well as ids', () => {
  const named = {
    ...issue,
    assigneeId: 'id-a',
    assignee: { id: 'id-a', username: 'Tim' },
    creatorId: 'id-c',
    creator: { id: 'id-c', username: 'jane_d' },
    sprintId: 'id-s',
    sprint: { id: 'id-s', name: 'Sprint 1', status: 'ACTIVE' },
    projectId: 'id-p',
    project: { id: 'id-p', prefix: 'AXM' },
  };

  it('compiles an id or a name', () => {
    expect(compile('assignee = tim')).toEqual({
      OR: [
        { assigneeId: 'tim' },
        { assignee: { username: { equals: 'tim', mode: 'insensitive' } } },
      ],
    });
    expect(compile('sprint = "Sprint 1"')).toEqual({
      OR: [
        { sprintId: 'Sprint 1' },
        { sprint: { name: { equals: 'Sprint 1', mode: 'insensitive' } } },
      ],
    });
    expect(compile('project = AXM')).toEqual({
      OR: [{ projectId: 'axm' }, { project: { prefix: { equals: 'axm', mode: 'insensitive' } } }],
    });
    expect(compile('creator = "jane_d"')).toEqual({
      OR: [
        { creatorId: 'jane_d' },
        { creator: { username: { equals: 'jane\\_d', mode: 'insensitive' } } },
      ],
    });
  });

  it('counts an empty column as different, only on a column that can be empty', () => {
    const named = { assignee: { username: { equals: 'tim', mode: 'insensitive' } } };
    expect(compile('assignee != tim')).toEqual({
      OR: [{ assigneeId: null }, { AND: [{ assigneeId: { not: 'tim' } }, { NOT: named }] }],
    });
    expect(compile('project != axm')).toEqual({
      AND: [
        { projectId: { not: 'axm' } },
        { NOT: { project: { prefix: { equals: 'axm', mode: 'insensitive' } } } },
      ],
    });
    expect(compile('assignee != currentUser()')).toEqual({
      OR: [{ assigneeId: null }, { assigneeId: { not: 'user-1' } }],
    });
  });

  it('keeps the empty questions and what a function means', () => {
    expect(compile('assignee = currentUser()')).toEqual({ assigneeId: 'user-1' });
    expect(compile('sprint = null')).toEqual({ sprintId: null });
  });

  it('compiles a list', () => {
    expect(compile('assignee IN (tim, jan)')).toEqual({
      OR: [
        { assigneeId: { in: ['tim', 'jan'] } },
        { assignee: { username: { in: ['tim', 'jan'], mode: 'insensitive' } } },
      ],
    });
  });

  it('evaluates', () => {
    const cases: Array<[string, boolean]> = [
      ['assignee = tim', true],
      ['assignee = TIM', true],
      ['assignee = "id-a"', true],
      ['assignee = jan', false],
      ['assignee != tim', false],
      ['assignee != jan', true],
      ['creator = "JANE_D"', true],
      ['sprint = "sprint 1"', true],
      ['sprint = "id-s"', true],
      ['sprint = "Sprint 2"', false],
      ['project = AXM', true],
      ['project = "id-p"', true],
      ['project != AXM', false],
      ['project = OTHER', false],
      ['assignee IN (jan, tim)', true],
      ['assignee NOT IN (jan, tim)', false],
      ['project IN (OTHER)', false],
      ['project NOT IN (OTHER)', true],
    ];
    for (const [query, expected] of cases) expect(run(query, named), query).toBe(expected);
    const empty = { ...named, assigneeId: null, assignee: null };
    expect(run('assignee = tim', empty)).toBe(false);
    expect(run('assignee != tim', empty)).toBe(true);
    expect(run('assignee NOT IN (tim)', empty)).toBe(true);
  });

  it('reads a username on a USER custom field through what the resolve step found', () => {
    const context = { ...ctx, customFieldUsers: new Map([['tim', ['user-1']]]) };
    expect(compile('cf.Owner = tim', context)).toMatchObject({
      OR: [{ customFieldValues: { some: { value: { in: ['tim', 'user-1'] } } } }],
    });
    expect(run('cf.Owner = tim', issue, context)).toBe(true);
    expect(run('cf.Owner != tim', issue, context)).toBe(false);
    expect(run('cf.Owner = jan', issue, context)).toBe(false);
    expect(run('cf.Owner = "user-1"', issue, context)).toBe(true);
  });
});

describe('an unquoted ISO date', () => {
  it('lexes as one value', () => {
    expect(parse('created > 2026-01-31')).toMatchObject({
      value: { type: 'string', value: '2026-01-31' },
    });
    expect(parse('cf."Ship date" > 2026-01-31')).toMatchObject({
      type: 'comparison',
      value: { type: 'string', value: '2026-01-31' },
    });
    expect(parse('created IN (2026-01-31, 2026-02-01)')).toMatchObject({
      values: [{ value: '2026-01-31' }, { value: '2026-02-01' }],
    });
  });

  it('compiles and evaluates as the quoted one', () => {
    expect(compile('created > 2026-01-31')).toEqual(compile('created > "2026-01-31"'));
    expect(compile('cf."Ship date" > 2026-02-01')).toEqual(
      compile('cf."Ship date" > "2026-02-01"'),
    );
    expect(run('cf."Ship date" > 2026-02-01')).toBe(true);
    expect(run('cf."Ship date" > 2026-04-01')).toBe(false);
    const old = { ...issue, createdAt: new Date('2026-03-01') };
    expect(run('created > 2026-02-01', old)).toBe(true);
    expect(run('created > 2026-04-01', old)).toBe(false);
    expect(run('created > "2026-02-01"', old)).toBe(true);
    expect(run('created > "not a date"', old)).toBe(false);
  });

  it('answers a bad date as a bad date', () => {
    expect(() => compile('created > 2026-13-45')).toThrow('date');
    expect(compile('cf."Ship date" > 2026-02-31')).toEqual({ id: { in: [] } });
  });

  it('leaves other numbers with hyphens alone', () => {
    expect(() => parse('number = 1-2 AND type = Bug')).toThrow();
    expect(parse('number = 2026')).toMatchObject({ value: { type: 'number', value: 2026 } });
    expect(freeTextOf(parse('type = Bug 2026-01-01'))).toBe('2026-01-01');
  });
});

describe('blocked and blocks', () => {
  const OPEN = { NOT: { column: { isDone: true } } };
  const blockedWhere = {
    OR: [
      { linksFrom: { some: { type: 'IS_BLOCKED_BY', to: OPEN } } },
      { linksTo: { some: { type: 'BLOCKS', from: OPEN } } },
    ],
  };
  const blocksWhere = {
    AND: [
      OPEN,
      {
        OR: [
          { linksFrom: { some: { type: 'BLOCKS' } } },
          { linksTo: { some: { type: 'IS_BLOCKED_BY' } } },
        ],
      },
    ],
  };

  it('compiles', () => {
    expect(compile('blocked = true')).toEqual(blockedWhere);
    expect(compile('blocked = false')).toEqual({ NOT: blockedWhere });
    expect(compile('blocked != true')).toEqual({ NOT: blockedWhere });
    expect(compile('blocks = true')).toEqual(blocksWhere);
    expect(compile('BLOCKED = "TRUE"')).toEqual(blockedWhere);
  });

  it('refuses what is not true or false, and other operators', () => {
    for (const query of ['blocked = maybe', 'blocked = 1', 'blocked > true', 'blocks = null']) {
      expect(() => compile(query), query).toThrow(QueryValueError);
    }
  });

  it('evaluates either side of a pair, and only open blockers', () => {
    const blockedBy = (other: unknown) => ({
      ...issue,
      linksFrom: [{ type: 'IS_BLOCKED_BY', toId: 'x', to: other }],
      linksTo: [],
    });
    const blockedFrom = (other: unknown) => ({
      ...issue,
      linksFrom: [],
      linksTo: [{ type: 'BLOCKS', fromId: 'x', from: other }],
    });
    expect(run('blocked = true', blockedBy(open))).toBe(true);
    expect(run('blocked = true', blockedBy({ column: null }))).toBe(true);
    expect(run('blocked = true', blockedBy(done))).toBe(false);
    expect(run('blocked = false', blockedBy(done))).toBe(true);
    expect(run('blocked = true', blockedFrom(open))).toBe(true);
    expect(run('blocked = true', blockedFrom(done))).toBe(false);
    expect(run('blocks = true', blockedBy(open))).toBe(false);
    expect(
      run('blocks = true', {
        ...issue,
        linksFrom: [{ type: 'BLOCKS', toId: 'x', to: open }],
        linksTo: [],
      }),
    ).toBe(true);
    expect(
      run('blocks = true', {
        ...issue,
        linksFrom: [],
        linksTo: [{ type: 'IS_BLOCKED_BY', fromId: 'x', from: open }],
      }),
    ).toBe(true);
    expect(
      run('blocked = true', {
        ...issue,
        linksFrom: [{ type: 'RELATES_TO', toId: 'x', to: open }],
        linksTo: [],
      }),
    ).toBe(false);
  });

  it('a done issue blocks nothing, whatever the state of the other one', () => {
    const blocking = {
      ...issue,
      linksFrom: [{ type: 'BLOCKS', toId: 'x', to: done }],
      linksTo: [],
    };
    expect(run('blocks = true', blocking)).toBe(true);
    expect(run('blocks = true', { ...blocking, column: { isDone: true } })).toBe(false);
    expect(run('blocks = false', { ...blocking, column: { isDone: true } })).toBe(true);
    expect(run('blocks = true', { ...blocking, column: null })).toBe(true);
    expect(() => run('blocks = true', { ...blocking, column: { name: 'Doing' } })).toThrow(
      'isDone',
    );
  });

  it('throws when the links were not hydrated, rather than reading them as none', () => {
    const { linksFrom: _from, ...withoutFrom } = issue;
    expect(() => run('blocked = true', withoutFrom)).toThrow('linksFrom');
    expect(() => run('blocked = false', withoutFrom)).toThrow('linksFrom');
    expect(() =>
      run('blocked = true', { ...issue, linksFrom: [{ type: 'IS_BLOCKED_BY', toId: 'x' }] }),
    ).toThrow('hydrated');
  });
});

describe('linked', () => {
  const any = {
    OR: [
      { linksFrom: { some: { toId: 'issue-12' } } },
      { linksTo: { some: { fromId: 'issue-12' } } },
    ],
  };

  it('compiles a key through what the resolve step found', () => {
    expect(compile('linked = AXM-12')).toEqual(any);
    expect(compile('linked != AXM-12')).toEqual({ NOT: any });
    expect(compile('linked IN (AXM-12)')).toEqual({ OR: [any] });
    expect(compile('linked NOT IN (AXM-12)')).toEqual({ AND: [{ NOT: any }] });
  });

  it('matches nothing for what was not found', () => {
    expect(compile('linked = AXM-99')).toEqual({ id: { in: [] } });
    expect(compile('linked != AXM-99')).toEqual({});
    expect(run('linked = AXM-99')).toBe(false);
    expect(run('linked != AXM-99')).toBe(true);
  });

  it('asks about any link with null', () => {
    expect(compile('linked = null')).toEqual({ linksFrom: { none: {} }, linksTo: { none: {} } });
    expect(compile('linked != null')).toEqual({
      OR: [{ linksFrom: { some: {} } }, { linksTo: { some: {} } }],
    });
    expect(run('linked != null')).toBe(true);
    expect(run('linked = null', { ...issue, linksFrom: [], linksTo: [] })).toBe(true);
  });

  it('refuses a value no key was resolved for, and other operators', () => {
    expect(() => compile('linked = now()')).toThrow(QueryValueError);
    expect(() => compile('linked ~ AXM-12')).toThrow(QueryValueError);
  });

  it('evaluates either side', () => {
    expect(run('linked = AXM-12')).toBe(true);
    expect(run('linked != AXM-12')).toBe(false);
    expect(
      run('linked = AXM-12', {
        ...issue,
        linksFrom: [],
        linksTo: [{ type: 'RELATES_TO', fromId: 'issue-12', from: open }],
      }),
    ).toBe(true);
    expect(run('linked IN (AXM-99, AXM-12)')).toBe(true);
    expect(run('linked NOT IN (AXM-12)')).toBe(false);
  });
});

describe('text', () => {
  const where = {
    OR: [
      { title: { contains: 'login', mode: 'insensitive' } },
      { body: { contains: 'login', mode: 'insensitive' } },
    ],
  };

  it('compiles ~ only', () => {
    expect(compile('text ~ "login"')).toEqual(where);
    expect(compile('text ~ Login')).toEqual(where);
    for (const query of ['text = "login"', 'text != "a"', 'text ~ null', 'text IN ("a")']) {
      expect(() => compile(query), query).toThrow(QueryValueError);
    }
  });

  it('evaluates title and body', () => {
    expect(run('text ~ "LOGIN"')).toBe(true);
    expect(run('text ~ "checkout"')).toBe(true);
    expect(run('text ~ "absent"')).toBe(false);
    expect(run('NOT text ~ "absent"')).toBe(true);
    expect(() => run('text = "login"')).toThrow(QueryValueError);
    const { body: _body, ...withoutBody } = issue;
    expect(() => run('text ~ "x"', withoutBody)).toThrow('body');
  });
});

describe('done', () => {
  it('compiles, with an issue outside any column as not done', () => {
    expect(compile('done = true')).toEqual({ column: { isDone: true } });
    expect(compile('done = false')).toEqual({ NOT: { column: { isDone: true } } });
    expect(compile('done != true')).toEqual({ NOT: { column: { isDone: true } } });
    expect(() => compile('done = 1')).toThrow(QueryValueError);
  });

  it('evaluates', () => {
    expect(run('done = false')).toBe(true);
    expect(run('done = true', { ...issue, column: { isDone: true } })).toBe(true);
    expect(run('done = true', { ...issue, column: null })).toBe(false);
    expect(() => run('done = true', { ...issue, column: { name: 'Doing' } })).toThrow('isDone');
    const { column: _column, ...withoutColumn } = issue;
    expect(() => run('done = true', withoutColumn)).toThrow('column');
  });
});

describe('sprintstate', () => {
  it('compiles', () => {
    expect(compile('sprintstate = active')).toEqual({ sprint: { status: 'ACTIVE' } });
    expect(compile('sprintstate != ACTIVE')).toEqual({ NOT: { sprint: { status: 'ACTIVE' } } });
    expect(compile('sprintstate = null')).toEqual({ sprintId: null });
    expect(compile('sprintstate != null')).toEqual({ sprintId: { not: null } });
    expect(compile('sprintstate IN (active, planning)')).toEqual({
      OR: [{ sprint: { status: 'ACTIVE' } }, { sprint: { status: 'PLANNING' } }],
    });
    expect(() => compile('sprintstate = NOPE')).toThrow('one of');
    expect(() => compile('sprintstate > ACTIVE')).toThrow(QueryValueError);
  });

  it('evaluates', () => {
    expect(run('sprintstate = Active')).toBe(true);
    expect(run('sprintstate != COMPLETED')).toBe(true);
    expect(run('sprintstate = COMPLETED')).toBe(false);
    const none = { ...issue, sprint: null, sprintId: null };
    expect(run('sprintstate = ACTIVE', none)).toBe(false);
    expect(run('sprintstate != ACTIVE', none)).toBe(true);
    expect(run('sprintstate = null', none)).toBe(true);
    expect(run('sprintstate IN (ACTIVE, PLANNING)')).toBe(true);
    expect(run('sprintstate NOT IN (ACTIVE)')).toBe(false);
    expect(() => run('sprintstate = ACTIVE', { ...issue, sprint: { name: 'One' } })).toThrow(
      'status',
    );
  });
});

describe('custom fields', () => {
  const named = (name: string, type: CustomFieldType) => ({
    name: { equals: name, mode: 'insensitive' },
    type,
  });
  const has = (name: string, type: CustomFieldType, filter: object) => ({
    customFieldValues: { some: { fieldDefinition: named(name, type), ...filter } },
  });
  const lacks = (name: string, type: CustomFieldType, filter: object) => ({
    project: { customFieldDefinitions: { some: named(name, type) } },
    customFieldValues: { none: { fieldDefinition: named(name, type), ...filter } },
  });

  it('compiles by name and type, with no ids', () => {
    const high = { value: { equals: 'high', mode: 'insensitive' } };
    expect(compile('cf.Severity = High')).toEqual({ OR: [has('Severity', 'SELECT', high)] });
    expect(compile('cf.Severity != High')).toEqual({ OR: [lacks('Severity', 'SELECT', high)] });
    expect(compile('cf.Notes ~ "second"')).toEqual({
      OR: [has('Notes', 'TEXT', { value: { contains: 'second', mode: 'insensitive' } })],
    });
    expect(compile('cf.Owner = currentUser()')).toEqual({
      OR: [has('Owner', 'USER', { value: 'user-1' })],
    });
  });

  it('compares numbers and dates by value', () => {
    expect(compile('cf.Cost > 9')).toEqual({
      OR: [has('Cost', 'NUMBER', { numberValue: { gt: 9 } })],
    });
    expect(compile('cf.Cost = "1.5"')).toEqual({
      OR: [has('Cost', 'NUMBER', { numberValue: 1.5 })],
    });
    expect(compile('cf."Ship date" <= "2026-02-01"')).toEqual({
      OR: [has('Ship date', 'DATE', { dateValue: { lte: new Date('2026-02-01') } })],
    });
    expect(run('cf.Cost > 9')).toBe(true);
    expect(run('cf.Cost > 10')).toBe(false);
    expect(run('cf.Cost >= 10')).toBe(true);
    expect(run('cf.Cost = "10"')).toBe(true);
    expect(run('cf."Ship date" > "2026-02-01"')).toBe(true);
    expect(run('cf."ship DATE" < "2026-02-01"')).toBe(false);
    expect(run('cf."Ship date" > now()')).toBe(false);
  });

  it('matches nothing for a value that does not fit the type', () => {
    expect(compile('cf.Cost = abc')).toEqual({ id: { in: [] } });
    expect(compile('cf.Cost != abc')).toEqual({ id: { in: [] } });
    expect(compile('cf."Ship date" > "soon"')).toEqual({ id: { in: [] } });
    expect(run('cf.Cost = abc')).toBe(false);
    expect(run('cf.Cost != abc')).toBe(false);
    expect(run('cf."Ship date" > "2026-02-31"')).toBe(false);
  });

  it('compiles per type when one name has several', () => {
    expect(compile('cf.Mixed = 5')).toEqual({
      OR: [
        has('Mixed', 'NUMBER', { numberValue: 5 }),
        has('Mixed', 'TEXT', { value: { equals: '5', mode: 'insensitive' } }),
      ],
    });
    expect(compile('cf.Mixed = abc')).toEqual({
      OR: [has('Mixed', 'TEXT', { value: { equals: 'abc', mode: 'insensitive' } })],
    });
    expect(compile('cf.Mixed > 5')).toEqual({
      OR: [has('Mixed', 'NUMBER', { numberValue: { gt: 5 } })],
    });
  });

  it('refuses an operator none of its types can answer', () => {
    for (const query of ['cf.Severity > 3', 'cf.Cost ~ "1"', 'cf.Owner ~ "a"', 'cf.Areas ~ "a"']) {
      expect(() => compile(query), query).toThrow(QueryValueError);
    }
    expect(() => compile('cf.Cost > null')).toThrow(QueryValueError);
  });

  it('reads a multi select as membership, for = and !=', () => {
    const member = {
      OR: [
        { value: { equals: 'web', mode: 'insensitive' } },
        { value: { startsWith: 'web,', mode: 'insensitive' } },
        { value: { endsWith: ',web', mode: 'insensitive' } },
        { value: { contains: ',web,', mode: 'insensitive' } },
      ],
    };
    expect(compile('cf.Areas = Web')).toEqual({ OR: [has('Areas', 'MULTI_SELECT', member)] });
    expect(compile('cf.Areas != Web')).toEqual({ OR: [lacks('Areas', 'MULTI_SELECT', member)] });
    expect(run('cf.Areas = Web')).toBe(true);
    expect(run('cf.Areas = Ap')).toBe(false);
    expect(run('cf.Areas != Web')).toBe(false);
    expect(run('cf.Areas != Db')).toBe(true);
  });

  it('asks about empty with null: no value, or a cleared one', () => {
    const filled = { value: { not: '' } };
    expect(compile('cf.Notes = null')).toEqual({ OR: [lacks('Notes', 'TEXT', filled)] });
    expect(compile('cf.Notes != null')).toEqual({ OR: [has('Notes', 'TEXT', filled)] });
    expect(run('cf.Notes != null')).toBe(true);
    expect(run('cf.Notes = null')).toBe(false);
    expect(run('cf.Notes = null', { ...issue, customFieldValues: [] })).toBe(true);
    expect(
      run('cf.Notes = null', { ...issue, customFieldValues: [value('Notes', 'TEXT', '')] }),
    ).toBe(true);
  });

  it('expands IN', () => {
    const eq = (text: string) => ({
      OR: [has('Severity', 'SELECT', { value: { equals: text, mode: 'insensitive' } })],
    });
    expect(compile('cf.Severity IN (High, Low)')).toEqual({ OR: [eq('high'), eq('low')] });
    expect(run('cf.Severity IN (Low, High)')).toBe(true);
    expect(run('cf.Severity NOT IN (Low, High)')).toBe(false);
    expect(run('cf.Severity NOT IN (Low)')).toBe(true);
    expect(() => compile('cf.Severity IN (null)')).toThrow(QueryValueError);
  });

  it('answers an unresolved name as unknown, naming it', () => {
    expect(() => compile('cf.Nope = 1')).toThrow(QueryValueError);
    expect(() => compile('cf.Nope = 1')).toThrow('Nope');
    expect(() => run('cf.Nope = 1')).toThrow('Nope');
    // The prototype of a plain object is no field either
    expect(() => compile('cf.constructor = 1')).toThrow('constructor');
  });

  it('passes the syntax check of a rule, which has no definitions to look at', () => {
    expect(() => assertKnownFields(parse('cf.Nope = 1'), issueFieldRegistry)).not.toThrow();
  });

  it('throws when the values were not hydrated', () => {
    const { customFieldValues: _values, ...without } = issue;
    expect(() => run('cf.Severity = High', without)).toThrow('customFieldValues');
  });

  it('never crashes on what a store holds', () => {
    const bad = { ...issue, customFieldValues: [value('Cost', 'NUMBER', 'twelve')] };
    expect(run('cf.Cost > 1', bad)).toBe(false);
    expect(run('cf.Cost != 1', bad)).toBe(true);
    const badDate = { ...issue, customFieldValues: [value('Ship date', 'DATE', '2026-02-31')] };
    expect(run('cf."Ship date" > "2000-01-01"', badDate)).toBe(false);
  });
});

describe('typedCustomFieldValue', () => {
  it.each([
    ['10', 10, null],
    ['-1.5', -1.5, null],
    [' 7 ', 7, null],
    ['1e5', null, null],
    ['', null, null],
    ['twelve', null, null],
    ['9'.repeat(400), null, null],
    ['2026-03-01', null, new Date('2026-03-01T00:00:00Z')],
    ['2026-03-01T10:30:00+02:00', null, new Date('2026-03-01T08:30:00Z')],
    ['2026-03-01T10:30', null, new Date('2026-03-01T10:30:00Z')],
    ['2026-02-31', null, null],
    ['2026-13-01', null, null],
    ['0000-01-01', null, null],
    ['2026-03-01T25:00', null, null],
    ['March', null, null],
  ])('%s', (stored, numberValue, dateValue) => {
    expect(typedCustomFieldValue(stored)).toEqual({ value: stored, numberValue, dateValue });
  });
});

describe('what stays', () => {
  it('keeps old queries as they were', () => {
    const same: Array<[string, Expression]> = [
      [
        'type:bug',
        {
          type: 'comparison',
          field: 'type',
          operator: '=',
          value: { type: 'string', value: 'bug' },
        },
      ],
      [
        'title ~ login',
        {
          type: 'comparison',
          field: 'title',
          operator: '~',
          value: { type: 'string', value: 'login' },
        },
      ],
    ];
    for (const [query, ast] of same) expect(parse(query)).toEqual(ast);
    expect(run('NOT number = 8')).toBe(true);
  });

  it('lists the new fields among the known ones', () => {
    for (const field of ['blocked', 'blocks', 'linked', 'text', 'done', 'sprintstate']) {
      expect(Object.keys(issueFieldRegistry)).toContain(field);
    }
    expect(() => compile('nope = 1')).toThrow('sprintstate');
  });
});
