/**
 * Fields no single column answers: blocked, blocks, linked, text, done and sprintstate. Each says
 * the same thing twice, as a Prisma filter and over a hydrated issue, side by side so the two stay
 * in step.
 */
import type { ComparisonOp, QueryContext } from './ast';
import { hydrated, likeLiteral, MATCH_NOTHING, QueryValueError } from './query-values';

type Where = Record<string, unknown>;
type Issue = Record<string, unknown>;

export interface DerivedField {
  compile(operator: ComparisonOp, value: unknown, context: QueryContext): Where;
  evaluate(operator: ComparisonOp, value: unknown, issue: Issue, context: QueryContext): boolean;
}

/** An issue not in a done column. One outside any column is open too. */
export const OPEN_ISSUE: Where = { NOT: { column: { isDone: true } } };

/**
 * An issue waiting on an open issue. Links are normally stored both ways, but older or half-deleted
 * pairs may hold one side only.
 */
export const BLOCKED_WHERE: Where = {
  OR: [
    { linksFrom: { some: { type: 'IS_BLOCKED_BY', to: OPEN_ISSUE } } },
    { linksTo: { some: { type: 'BLOCKS', from: OPEN_ISSUE } } },
  ],
};

/** An open issue with a blocking link to another, on either side. A done issue blocks nothing. */
export const BLOCKS_WHERE: Where = {
  AND: [
    OPEN_ISSUE,
    {
      OR: [
        { linksFrom: { some: { type: 'BLOCKS' } } },
        { linksTo: { some: { type: 'IS_BLOCKED_BY' } } },
      ],
    },
  ],
};

/**
 * Whether a boolean field's comparison asks for true.
 * @param field - The field
 * @param operator - The operator
 * @param value - The value
 * @throws {QueryValueError} For another operator or value
 */
function wantsTrue(field: string, operator: ComparisonOp, value: unknown): boolean {
  if (operator !== '=' && operator !== '!=') {
    throw new QueryValueError(`'${field}' can only be used with = or !=`);
  }
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (text !== 'true' && text !== 'false') {
    throw new QueryValueError(`'${field}' takes true or false`);
  }
  return (text === 'true') === (operator === '=');
}

interface HydratedLink {
  type: string;
  toId?: string;
  fromId?: string;
}

function linksOf(issue: Issue, key: 'linksFrom' | 'linksTo', field: string): HydratedLink[] {
  return hydrated(issue, key, field) as HydratedLink[];
}

function isOpen(link: HydratedLink, side: 'to' | 'from', field: string): boolean {
  const other = hydrated(link as unknown as Issue, side, field) as Issue;
  const column = hydrated(other, 'column', field) as { isDone: boolean } | null;
  return column?.isDone !== true;
}

function isBlocked(issue: Issue): boolean {
  const outgoing = linksOf(issue, 'linksFrom', 'blocked');
  const incoming = linksOf(issue, 'linksTo', 'blocked');
  return (
    outgoing.some((link) => link.type === 'IS_BLOCKED_BY' && isOpen(link, 'to', 'blocked')) ||
    incoming.some((link) => link.type === 'BLOCKS' && isOpen(link, 'from', 'blocked'))
  );
}

function isBlocking(issue: Issue): boolean {
  const outgoing = linksOf(issue, 'linksFrom', 'blocks');
  const incoming = linksOf(issue, 'linksTo', 'blocks');
  const column = hydrated(issue, 'column', 'blocks') as Issue | null;
  const issueDone = column !== null && hydrated(column, 'isDone', 'blocks') === true;
  return (
    !issueDone &&
    (outgoing.some((link) => link.type === 'BLOCKS') ||
      incoming.some((link) => link.type === 'IS_BLOCKED_BY'))
  );
}

function linkField(field: string, where: Where, holds: (issue: Issue) => boolean): DerivedField {
  return {
    compile: (operator, value) => (wantsTrue(field, operator, value) ? where : { NOT: where }),
    evaluate: (operator, value, issue) => holds(issue) === wantsTrue(field, operator, value),
  };
}

function assertEquality(field: string, operator: ComparisonOp): void {
  if (operator !== '=' && operator !== '!=') {
    throw new QueryValueError(`'${field}' can only be used with = or !=`);
  }
}

/**
 * What a key in a query stands for, as the resolve step found it.
 * @param value - The key as written
 * @param context - Holds what was found
 * @returns The issue's id, or null for nothing the query's user can see
 * @throws {QueryValueError} For a value no key was resolved for
 */
function linkedIssueId(value: unknown, context: QueryContext): string | null {
  const found = typeof value === 'string' ? context.linkedIssues?.get(value) : undefined;
  if (found === undefined) throw new QueryValueError("'linked' takes an issue key, such as AXM-12");
  return found;
}

const linked: DerivedField = {
  compile: (operator, value, context) => {
    assertEquality('linked', operator);
    if (value === null) {
      return operator === '='
        ? { linksFrom: { none: {} }, linksTo: { none: {} } }
        : { OR: [{ linksFrom: { some: {} } }, { linksTo: { some: {} } }] };
    }
    const id = linkedIssueId(value, context);
    if (id === null) return operator === '=' ? MATCH_NOTHING : {};
    const where = {
      OR: [{ linksFrom: { some: { toId: id } } }, { linksTo: { some: { fromId: id } } }],
    };
    return operator === '=' ? where : { NOT: where };
  },
  evaluate: (operator, value, issue, context) => {
    assertEquality('linked', operator);
    const outgoing = linksOf(issue, 'linksFrom', 'linked');
    const incoming = linksOf(issue, 'linksTo', 'linked');
    const id = value === null ? null : linkedIssueId(value, context);
    const found =
      value === null
        ? outgoing.length > 0 || incoming.length > 0
        : id !== null &&
          (outgoing.some((link) => link.toId === id) ||
            incoming.some((link) => link.fromId === id));
    // `= null` asks for no link, so of the two questions it is the one that inverts
    return (operator === '=') === (value !== null) ? found : !found;
  },
};

function textValue(operator: ComparisonOp, value: unknown): string {
  if (operator !== '~') throw new QueryValueError("'text' can only be used with ~");
  if (value === null) throw new QueryValueError("'text' can't be compared with null");
  return String(value);
}

const text: DerivedField = {
  compile: (operator, value) => {
    const contains = { contains: likeLiteral(textValue(operator, value)), mode: 'insensitive' };
    return { OR: [{ title: contains }, { body: contains }] };
  },
  evaluate: (operator, value, issue) => {
    const wanted = textValue(operator, value).toLowerCase();
    return [hydrated(issue, 'title', 'text'), hydrated(issue, 'body', 'text')].some((part) =>
      String(part).toLowerCase().includes(wanted),
    );
  },
};

const done: DerivedField = {
  compile: (operator, value) =>
    wantsTrue('done', operator, value)
      ? { column: { isDone: true } }
      : { NOT: { column: { isDone: true } } },
  evaluate: (operator, value, issue) => {
    const wanted = wantsTrue('done', operator, value);
    const column = hydrated(issue, 'column', 'done') as Issue | null;
    return (column !== null && hydrated(column, 'isDone', 'done') === true) === wanted;
  },
};

const SPRINT_STATES = ['PLANNING', 'ACTIVE', 'COMPLETED'];

function sprintState(value: unknown): string {
  const upper = String(value).toUpperCase();
  if (!SPRINT_STATES.includes(upper)) {
    throw new QueryValueError(`'sprintstate' takes one of ${SPRINT_STATES.join(', ')}`);
  }
  return upper;
}

const sprintstate: DerivedField = {
  compile: (operator, value) => {
    assertEquality('sprintstate', operator);
    if (value === null) return { sprintId: operator === '=' ? null : { not: null } };
    const where = { sprint: { status: sprintState(value) } };
    return operator === '=' ? where : { NOT: where };
  },
  evaluate: (operator, value, issue) => {
    assertEquality('sprintstate', operator);
    const sprint = hydrated(issue, 'sprint', 'sprintstate') as Issue | null;
    if (value === null) return (sprint === null) === (operator === '=');
    const wanted = sprintState(value);
    const matches = sprint !== null && hydrated(sprint, 'status', 'sprintstate') === wanted;
    return matches === (operator === '=');
  },
};

export const derivedFields: Record<string, DerivedField> = {
  blocked: linkField('blocked', BLOCKED_WHERE, isBlocked),
  blocks: linkField('blocks', BLOCKS_WHERE, isBlocking),
  linked,
  text,
  done,
  sprintstate,
};

/**
 * Whether a registry field is one of these.
 * @param name - The field's name in lower case
 */
export function derivedField(name: string): DerivedField | undefined {
  return Object.hasOwn(derivedFields, name) ? derivedFields[name] : undefined;
}

/** currentSprint(), which asks about the state of the issue's sprint rather than for a value. */
export const CURRENT_SPRINT_WHERE = { sprint: { status: 'ACTIVE' } };
