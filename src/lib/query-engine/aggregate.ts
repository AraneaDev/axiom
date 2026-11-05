/**
 * The SELECT and GROUP BY clauses, and what becomes of the database's rows: a group per distinct key
 * with labels people read. No database here: the search module loads the rows and labels.
 */
import type { OrderByTerm, SelectTerm } from './ast';
import { issueFieldRegistry, PRIORITY_ORDINALS } from './fields/issue-fields';
import { ParseError } from './lexer';

/** The issue columns the database can group by. */
export type GroupColumn =
  | 'type'
  | 'priority'
  | 'columnId'
  | 'assigneeId'
  | 'creatorId'
  | 'sprintId'
  | 'projectId';

/** What a sort sees of a key: null for an empty key. */
type SortValue = string | number | null;

interface GroupField {
  column: GroupColumn;
  key: (id: string | null | undefined, labels: GroupLabels) => unknown;
  sortValue: (key: never) => SortValue;
}

export interface UserLabel {
  id: string;
  username: string;
  displayName: string;
}

export interface SprintLabel {
  id: string;
  name: string;
  status: string;
  project: { key: string; name: string };
}

export interface ProjectLabel {
  id: string;
  key: string;
  name: string;
}

/** What the ids in the rows stand for. An id missing here has no label the viewer may see. */
export interface GroupLabels {
  columns: Map<string, { name: string; isDone: boolean }>;
  sprints: Map<string, SprintLabel>;
  users: Map<string, UserLabel>;
  projects: Map<string, ProjectLabel>;
}

/** One row from the database: the columns grouped by, what it counted and the points it holds. */
export type GroupRow = Partial<Record<GroupColumn, string | null>> & {
  count: number;
  pointsSum: number;
  /** Issues with points, which is what an average divides by */
  pointsCount: number;
};

export type QueryGroup = {
  key: Record<string, unknown>;
  count: number;
  sum?: number;
  avg?: number | null;
};

/** The status of an issue without a column, as issue results call it. */
const NO_COLUMN_STATUS = 'Backlog';

const lookup = <T>(labels: Map<string, T>, id: string | null | undefined): T | null =>
  (id && labels.get(id)) || null;

const ordinalIn = (values: readonly string[]) => (key: string) => values.indexOf(key);

const userField = (column: GroupColumn): GroupField => ({
  column,
  key: (id, labels) => lookup(labels.users, id),
  sortValue: (key: UserLabel | null) => key?.username ?? null,
});

const GROUP_FIELDS: Record<string, GroupField> = {
  type: {
    column: 'type',
    key: (value) => value,
    // Enums sort in the order they are declared, as they do among the items
    sortValue: ordinalIn(issueFieldRegistry.type.values as string[]),
  },
  status: {
    column: 'columnId',
    key: (id, labels) => lookup(labels.columns, id)?.name ?? NO_COLUMN_STATUS,
    sortValue: (key: string) => key,
  },
  priority: {
    column: 'priority',
    key: (value) => value,
    sortValue: (key: string) => PRIORITY_ORDINALS[key],
  },
  assignee: userField('assigneeId'),
  creator: userField('creatorId'),
  sprint: {
    column: 'sprintId',
    key: (id, labels) => {
      const sprint = lookup(labels.sprints, id);
      return sprint && { id: sprint.id, name: sprint.name, project: sprint.project };
    },
    sortValue: (key: { name: string } | null) => key?.name ?? null,
  },
  project: {
    column: 'projectId',
    key: (id, labels) => lookup(labels.projects, id),
    sortValue: (key: ProjectLabel | null) => key?.key ?? null,
  },
  done: {
    column: 'columnId',
    key: (id, labels) => lookup(labels.columns, id)?.isDone ?? false,
    sortValue: (key: boolean) => Number(key),
  },
  sprintstate: {
    column: 'sprintId',
    key: (id, labels) => lookup(labels.sprints, id)?.status ?? null,
    sortValue: (key: string | null) =>
      key === null ? null : ordinalIn(issueFieldRegistry.sprintstate.values as string[])(key),
  },
};

const GROUPABLE = Object.keys(GROUP_FIELDS).join(', ');
const MAX_GROUP_FIELDS = 2;
const SELECT_TERMS = 'COUNT, SUM(storypoints) or AVG(storypoints)';

/**
 * The aggregates of a SELECT clause. COUNT comes with every group whether asked for or not.
 * @param text - What follows SELECT
 * @param position - Where it starts in the query
 * @throws {ParseError} For a term that isn't one, or one listed twice
 */
export function parseSelect(text: string, position: number): SelectTerm[] {
  const terms: SelectTerm[] = [];
  for (const part of text.split(',')) {
    const word = part.trim();
    if (word === '') throw new ParseError(`SELECT expects ${SELECT_TERMS}`, position);
    const aggregate = /^(SUM|AVG)\s*\(\s*([^()\s]*)\s*\)$/i.exec(word);
    let term: SelectTerm;
    if (/^COUNT(\s*\(\s*\*\s*\))?$/i.test(word)) {
      term = 'count';
    } else if (aggregate) {
      if (aggregate[2].toLowerCase() !== 'storypoints') {
        throw new ParseError(
          `${aggregate[1].toUpperCase()} takes only storypoints`,
          position,
          word,
        );
      }
      term = aggregate[1].toLowerCase() as SelectTerm;
    } else {
      throw new ParseError(`SELECT takes ${SELECT_TERMS}, not "${word}"`, position, word);
    }
    if (terms.includes(term)) throw new ParseError(`${word} is selected twice`, position, word);
    terms.push(term);
  }
  return terms;
}

/**
 * Why a field can't be grouped by.
 * @param field - The field in lower case, known to be no group field
 * @param position - Where it stands in the query
 */
function notGroupable(field: string, position: number): ParseError {
  if (field.startsWith('cf.')) {
    return new ParseError(
      `Custom fields cannot be grouped. GROUP BY takes ${GROUPABLE}`,
      position,
      field,
    );
  }
  if (field === 'label') {
    return new ParseError(
      `label cannot be grouped: an issue has several. GROUP BY takes ${GROUPABLE}`,
      position,
      field,
    );
  }
  if (Object.hasOwn(issueFieldRegistry, field)) {
    return new ParseError(
      `${field} cannot be grouped. GROUP BY takes ${GROUPABLE}`,
      position,
      field,
    );
  }
  return new ParseError(`Unknown field '${field}' in GROUP BY`, position, field);
}

/**
 * The fields of a GROUP BY clause.
 * @param text - What follows GROUP BY
 * @param position - Where it starts in the query
 * @throws {ParseError} For a field that can't be grouped, one listed twice, or too many
 */
export function parseGroupBy(text: string, position: number): string[] {
  const fields: string[] = [];
  for (const part of text.split(',')) {
    const words = part.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) throw new ParseError('GROUP BY expects a field', position);
    const field = words[0].toLowerCase();
    if (!Object.hasOwn(GROUP_FIELDS, field)) throw notGroupable(field, position);
    if (words.length > 1) {
      throw new ParseError(`Unexpected "${words[1]}" in GROUP BY, expected "," or end`, position);
    }
    if (fields.includes(field)) throw new ParseError(`${field} is grouped twice`, position, field);
    fields.push(field);
  }
  if (fields.length > MAX_GROUP_FIELDS) {
    throw new ParseError(`GROUP BY takes at most ${MAX_GROUP_FIELDS} fields`, position);
  }
  return fields;
}

/**
 * The columns the database groups by for these fields. Fewer than the fields when two read one.
 * @param groupBy - The fields of the clause
 */
export function groupColumns(groupBy: readonly string[]): GroupColumn[] {
  return [...new Set(groupBy.map((field) => GROUP_FIELDS[field].column))];
}

/**
 * Compare two keys of one field: an empty key last going up and first going down, as Postgres
 * sorts the items.
 * @param a
 * @param b
 */
function compareSortValues(a: SortValue, b: SortValue): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return typeof a === 'number' && typeof b === 'number'
    ? a - b
    : String(a).localeCompare(String(b));
}

/**
 * Turn rows into groups: labelled, merged where rows share a label (the status is a name, and two
 * projects have their own column of it), and sorted. By count when no order is given.
 * @param rows - All rows of the query
 * @param groupBy - The fields of the clause; none gives one group with an empty key per row
 * @param labels - What the ids stand for
 * @param options - What to compute and how many to return
 * @param options.aggregates - The aggregates asked for besides the count
 * @param options.orderBy - Terms on fields of the clause
 * @param options.limit - The most groups to return
 * @returns The groups, how many issues all of them hold, and truncated when the limit cut some off
 */
export function buildGroups(
  rows: readonly GroupRow[],
  groupBy: readonly string[],
  labels: GroupLabels,
  options: { aggregates: readonly SelectTerm[]; orderBy: readonly OrderByTerm[]; limit: number },
): { groups: QueryGroup[]; total: number; truncated?: true } {
  const merged = new Map<string, { key: Record<string, unknown>; row: GroupRow }>();
  for (const row of rows) {
    const key = Object.fromEntries(
      groupBy.map((field) => {
        const def = GROUP_FIELDS[field];
        return [field, def.key(row[def.column], labels)];
      }),
    );
    const identity = JSON.stringify(key);
    const known = merged.get(identity);
    if (known) {
      known.row.count += row.count;
      known.row.pointsSum += row.pointsSum;
      known.row.pointsCount += row.pointsCount;
    } else {
      merged.set(identity, { key, row: { ...row } });
    }
  }

  const sortOf = (key: Record<string, unknown>, field: string) =>
    GROUP_FIELDS[field].sortValue(key[field] as never);
  const sorted = [...merged.entries()].sort(([idA, a], [idB, b]) => {
    for (const { field, dir } of options.orderBy) {
      const order = compareSortValues(sortOf(a.key, field), sortOf(b.key, field));
      if (order !== 0) return dir === 'asc' ? order : -order;
    }
    return b.row.count - a.row.count || idA.localeCompare(idB);
  });

  const groups = sorted.slice(0, options.limit).map(([, { key, row }]) => ({
    key,
    count: row.count,
    ...(options.aggregates.includes('sum') ? { sum: row.pointsSum } : {}),
    ...(options.aggregates.includes('avg')
      ? { avg: row.pointsCount === 0 ? null : row.pointsSum / row.pointsCount }
      : {}),
  }));
  return {
    groups,
    total: sorted.reduce((sum, [, { row }]) => sum + row.count, 0),
    ...(sorted.length > options.limit ? { truncated: true as const } : {}),
  };
}
