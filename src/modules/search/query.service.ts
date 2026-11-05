/**
 * Runs a query in the query language for one viewer: items, or groups with their aggregates. The
 * viewer's access filter is part of the where clause, so nothing they can't see reaches a limit,
 * sort, group or aggregate.
 */
import type { Prisma } from '@prisma/client';

import type { ActionContext } from '../../actions/define';
import { pickFields, READS_BUSY, readSlots } from '../../actions/read.service';
import { prisma } from '../../config/database';
import {
  buildGroups,
  compileOrderBy,
  compileToPrisma,
  groupColumns,
  issueFieldRegistry,
  ParseError,
  parseQuery,
  QueryValueError,
  type Expression,
  type GroupColumn,
  type GroupLabels,
  type GroupRow,
  type ParsedQuery,
} from '../../lib/query-engine';
import { AppError } from '../../middleware/errorHandler';
import { perUserLimit, SEARCH_LIMIT } from '../../middleware/rate-limit';
import { scopeAllows } from '../../middleware/token-scopes';
import { formatIssueKey } from '../../utils/issue-key';
import { PROJECT_URL_WITH_NAME_SELECT } from '../../utils/prisma-selects';
import { MAX_DB_INT } from '../../utils/validation/common-validators';

import { resolveQueryFields } from './query-fields.service';
import { projectsInScope, viewableProjectsWhere } from './search-access';

/**
 * GET /api/search has searchLimiter per address; search.run and query.run are reached by name, so
 * per user, and share this so that one can't double the other's budget.
 */
export const limitSearch = perUserLimit(
  SEARCH_LIMIT,
  'Too many search requests, please try again later',
);

/**
 * Rows one grouped query may bring back from the database, before any labels. Past this it is
 * refused: a part of the groups would give wrong totals.
 */
const MAX_GROUP_ROWS = 5000;

/**
 * Fields an item can have. A body is left out, for item.read to give: 500 of the largest would not
 * fit in the API's memory. So is the parent, which read checks per item.
 */
export const QUERY_ITEM_FIELDS = [
  'fullKey',
  'url',
  'number',
  'title',
  'type',
  'priority',
  'status',
  'assignee',
  'creator',
  'labels',
  'sprint',
  'project',
  'storyPoints',
  'dueDate',
  'startDate',
  'timeEstimate',
  'timeSpent',
  'createdAt',
  'updatedAt',
] as const;

const DEFAULT_ITEM_FIELDS: ReadonlyArray<(typeof QUERY_ITEM_FIELDS)[number]> = [
  'fullKey',
  'url',
  'title',
  'type',
  'priority',
  'status',
  'assignee',
  'sprint',
  'project',
  'storyPoints',
  'dueDate',
  'updatedAt',
];

const USER_REF_SELECT = { id: true, displayName: true } as const;

export interface QueryInput {
  query: string;
  limit: number;
  cursor?: string;
  fields?: ReadonlyArray<(typeof QUERY_ITEM_FIELDS)[number]>;
  scope?: { orgId?: string; teamId?: string; projectId?: string };
}

const invalidQuery = (message: string) => new AppError(400, message, 'INVALID_QUERY');
const invalidCursor = () => new AppError(400, 'This cursor is not valid', 'INVALID_CURSOR');

const encodeCursor = (offset: number) => Buffer.from(String(offset)).toString('base64');

/**
 * The offset a cursor holds.
 * @param cursor - From an earlier page, or nothing for the first
 * @throws {AppError} 400 for anything an earlier page could not have given
 */
function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  const text = Buffer.from(cursor, 'base64').toString();
  if (!/^(0|[1-9]\d*)$/.test(text)) throw invalidCursor();
  const offset = Number(text);
  if (offset > MAX_DB_INT || encodeCursor(offset) !== cursor) throw invalidCursor();
  return offset;
}

/**
 * The query with its free text as conditions. The compiler passes text over, as the search routes
 * rank it themselves; here it would otherwise leave every issue in. Each word must be found, as in
 * those routes.
 * @param ast - The where part
 */
function withTextConditions(ast: Expression): Expression {
  switch (ast.type) {
    case 'and':
    case 'or':
      return {
        ...ast,
        left: withTextConditions(ast.left),
        right: withTextConditions(ast.right),
      };
    case 'not':
      return { ...ast, operand: withTextConditions(ast.operand) };
    case 'freetext': {
      const words = ast.value.split(/\s+/).filter(Boolean);
      return (words.length > 0 ? words : [ast.value])
        .map(
          (word): Expression => ({
            type: 'comparison',
            field: 'text',
            operator: '~',
            value: { type: 'string', value: word },
          }),
        )
        .reduce((left, right) => ({ type: 'and', left, right }));
    }
    default:
      return ast;
  }
}

/**
 * Do a step of reading a query, answering 400 for what the language has no reading of.
 * @param step - The step
 */
async function asQueryError<T>(step: () => T | Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (err) {
    // The compiler throws a plain Error for an unknown field or function, which the search routes
    // read as "no query, try it as filters". Here it is a query, so it is the caller's to fix.
    if (
      err instanceof ParseError ||
      err instanceof QueryValueError ||
      (err instanceof Error && err.constructor === Error)
    ) {
      throw invalidQuery(err.message);
    }
    throw err;
  }
}

/**
 * The where clause of a query: what the viewer may see, within the scope, matching the condition.
 * @param userId - The viewer
 * @param parsed - The query
 * @param scope - What the caller narrowed it to
 * @param viewable - The projects the viewer can open
 */
async function queryWhere(
  userId: string,
  parsed: ParsedQuery,
  scope: QueryInput['scope'],
  viewable: Prisma.ProjectWhereInput,
): Promise<Prisma.IssueWhereInput> {
  const and: Prisma.IssueWhereInput[] = [
    { project: viewable },
    { project: projectsInScope(scope) },
  ];
  if (parsed.where) {
    const condition = withTextConditions(parsed.where);
    and.push(
      await asQueryError(
        async () =>
          compileToPrisma(condition, issueFieldRegistry, {
            currentUserId: userId,
            projectId: scope?.projectId,
            ...(await resolveQueryFields(condition, { userId, projectId: scope?.projectId })),
          }) as Prisma.IssueWhereInput,
      ),
    );
  }
  return { AND: and };
}

/**
 * The labels of the ids in these rows. Sprints and columns come only from projects the viewer can
 * open, should an issue point at one elsewhere: such a key is simply empty.
 * @param rows - The rows
 * @param columns - The columns they were grouped by
 * @param viewable - The projects the viewer can open
 */
async function loadLabels(
  rows: GroupRow[],
  columns: GroupColumn[],
  viewable: Prisma.ProjectWhereInput,
): Promise<GroupLabels> {
  const idsOf = (...of: GroupColumn[]) => [
    ...new Set(
      of
        .filter((column) => columns.includes(column))
        .flatMap((column) => rows.map((row) => row[column]))
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  // One at a time and only what is needed: one query holds one connection
  const columnIds = idsOf('columnId');
  const columnRows = columnIds.length
    ? await prisma.boardColumn.findMany({
        where: { id: { in: columnIds }, project: viewable },
        select: { id: true, name: true, isDone: true },
      })
    : [];
  const sprintIds = idsOf('sprintId');
  const sprints = sprintIds.length
    ? await prisma.sprint.findMany({
        where: { id: { in: sprintIds }, project: viewable },
        select: {
          id: true,
          name: true,
          status: true,
          project: { select: { prefix: true, name: true } },
        },
      })
    : [];
  const userIds = idsOf('assigneeId', 'creatorId');
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, displayName: true },
      })
    : [];
  const projectIds = idsOf('projectId');
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, prefix: true, name: true },
      })
    : [];
  return {
    columns: new Map(columnRows.map((c) => [c.id, c])),
    sprints: new Map(
      sprints.map((s) => [
        s.id,
        {
          id: s.id,
          name: s.name,
          status: s.status,
          project: { key: s.project.prefix, name: s.project.name },
        },
      ]),
    ),
    users: new Map(users.map((u) => [u.id, u])),
    projects: new Map(projects.map((p) => [p.id, { id: p.id, key: p.prefix, name: p.name }])),
  };
}

const NO_LABELS: GroupLabels = {
  columns: new Map(),
  sprints: new Map(),
  users: new Map(),
  projects: new Map(),
};

const AGGREGATES = {
  _count: { _all: true, storyPoints: true },
  _sum: { storyPoints: true },
} as const;

interface AggregateRow {
  _count: { _all: number; storyPoints: number };
  _sum: { storyPoints: number | null };
}

const toGroupRow = <T extends AggregateRow>({ _count, _sum, ...columns }: T): GroupRow => ({
  ...columns,
  count: _count._all,
  pointsSum: _sum.storyPoints ?? 0,
  pointsCount: _count.storyPoints,
});

/**
 * Run a grouped query.
 * @param parsed - The query, with a SELECT or GROUP BY clause
 * @param where - Its where clause
 * @param limit - The most groups to return
 * @param viewable - The projects the viewer can open
 * @throws {AppError} 400 past MAX_GROUP_ROWS
 */
async function runGroups(
  parsed: ParsedQuery,
  where: Prisma.IssueWhereInput,
  limit: number,
  viewable: Prisma.ProjectWhereInput,
) {
  const groupBy = parsed.groupBy ?? [];
  const aggregates = (parsed.select ?? []).filter((term) => term !== 'count');
  const options = { aggregates, orderBy: parsed.orderBy, limit };
  if (groupBy.length === 0) {
    const row = toGroupRow(await prisma.issue.aggregate({ where, ...AGGREGATES }));
    return { kind: 'groups' as const, ...buildGroups([row], [], NO_LABELS, options) };
  }

  const columns = groupColumns(groupBy);
  const rows = (
    (await prisma.issue.groupBy({
      by: columns,
      where,
      ...AGGREGATES,
      orderBy: columns.map((column) => ({ [column]: 'asc' })),
      take: MAX_GROUP_ROWS + 1,
    } as never)) as unknown as AggregateRow[]
  ).map(toGroupRow);
  if (rows.length > MAX_GROUP_ROWS) {
    throw invalidQuery('This query has too many groups, narrow it with a condition');
  }
  const labels = await loadLabels(rows, columns, viewable);
  return { kind: 'groups' as const, ...buildGroups(rows, groupBy, labels, options) };
}

/**
 * Run a query for items.
 * @param parsed - The query
 * @param where - Its where clause
 * @param input - The page and fields asked for
 */
async function runItems(parsed: ParsedQuery, where: Prisma.IssueWhereInput, input: QueryInput) {
  const offset = decodeCursor(input.cursor);
  const orderBy = parsed.orderBy.length
    ? parsed.orderBy
    : [{ field: 'updated', dir: 'desc' as const }];
  const rows = await prisma.issue.findMany({
    where,
    orderBy: compileOrderBy(orderBy) as Prisma.IssueOrderByWithRelationInput[],
    skip: offset,
    take: input.limit + 1,
    select: {
      id: true,
      number: true,
      title: true,
      type: true,
      priority: true,
      storyPoints: true,
      dueDate: true,
      startDate: true,
      timeEstimate: true,
      timeSpent: true,
      createdAt: true,
      updatedAt: true,
      column: { select: { name: true } },
      assignee: { select: USER_REF_SELECT },
      creator: { select: USER_REF_SELECT },
      labels: { select: { id: true, name: true } },
      sprint: { select: { id: true, name: true } },
      project: { select: { id: true, ...PROJECT_URL_WITH_NAME_SELECT } },
    },
  });
  const items = rows.slice(0, input.limit).map((row) => {
    const { team, prefix, slug, id: projectId, name } = row.project;
    const key = formatIssueKey(prefix, row.number);
    return pickFields(
      {
        id: row.id,
        key,
        fullKey: `${team.org.slug}/${team.slug}/${key}`,
        url: `/${team.org.slug}/${team.slug}/${slug}/issues/${row.number}`,
        number: row.number,
        title: row.title,
        type: row.type,
        priority: row.priority,
        status: row.column?.name ?? 'Backlog',
        assignee: row.assignee,
        creator: row.creator,
        labels: row.labels,
        sprint: row.sprint,
        project: { id: projectId, name, prefix, slug },
        storyPoints: row.storyPoints,
        dueDate: row.dueDate?.toISOString() ?? null,
        startDate: row.startDate?.toISOString() ?? null,
        timeEstimate: row.timeEstimate,
        timeSpent: row.timeSpent,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
      input.fields ?? DEFAULT_ITEM_FIELDS,
    );
  });
  return {
    kind: 'items' as const,
    items,
    ...(rows.length > input.limit ? { nextCursor: encodeCursor(offset + input.limit) } : {}),
  };
}

/**
 * Read a query for one caller, before any database work.
 * @param ctx - Who runs it
 * @param input - The query and its page
 * @throws {AppError} 403 SCOPE; 400 INVALID_QUERY or INVALID_CURSOR
 */
async function prepareQuery(ctx: ActionContext, input: QueryInput): Promise<ParsedQuery> {
  if (ctx.scopes && !scopeAllows(ctx.scopes, 'issues', 'read')) {
    throw new AppError(403, 'This API token does not have the scope for this request', 'SCOPE');
  }
  const parsed = await asQueryError(() => parseQuery(input.query));
  if (isGrouped(parsed) && input.cursor !== undefined) {
    throw new AppError(400, 'Groups come in one page, without a cursor', 'INVALID_CURSOR');
  }
  return parsed;
}

const isGrouped = (parsed: ParsedQuery) =>
  parsed.select !== undefined || parsed.groupBy !== undefined;

/**
 * Run a query that is already read: every issue it counts, sums, groups or returns is one the
 * caller can open.
 * @param ctx - Who runs it
 * @param parsed - The query
 * @param input - Its page and what to narrow it to
 */
async function executeQuery(ctx: ActionContext, parsed: ParsedQuery, input: QueryInput) {
  const viewable = await viewableProjectsWhere(ctx.userId);
  const where = await queryWhere(ctx.userId, parsed, input.scope, viewable);
  return isGrouped(parsed)
    ? runGroups(parsed, where, input.limit, viewable)
    : runItems(parsed, where, input);
}

/**
 * Run a query with the caller's rights. A token also needs issues:read, as the results are issue
 * data.
 * @param ctx - Who runs it
 * @param input - The query, its page and what to narrow it to
 * @throws {AppError} 403 SCOPE; 400 INVALID_QUERY or INVALID_CURSOR; 429 past the read cap
 */
export async function runQuery(ctx: ActionContext, input: QueryInput) {
  const parsed = await prepareQuery(ctx, input);
  return readSlots.run(ctx.userId, READS_BUSY, () => executeQuery(ctx, parsed, input));
}

/**
 * Run a query as part of a larger read that already holds its read slot and counted against its
 * limit: a dashboard's widgets. Otherwise as runQuery.
 * @param ctx - Who runs it
 * @param input - The query, its page and what to narrow it to
 * @param options - What to do with it
 * @param options.count - Count the matches of a query for items, instead of listing them
 * @throws {AppError} 403 SCOPE; 400 INVALID_QUERY or INVALID_CURSOR
 */
export async function runQueryInHeldSlot(
  ctx: ActionContext,
  input: QueryInput,
  options: { count?: boolean } = {},
) {
  const parsed = await prepareQuery(ctx, input);
  const counted: ParsedQuery =
    options.count && !isGrouped(parsed) ? { ...parsed, select: ['count'], orderBy: [] } : parsed;
  return executeQuery(ctx, counted, input);
}
