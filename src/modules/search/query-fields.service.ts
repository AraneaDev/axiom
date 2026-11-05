/**
 * The step between parsing a query and running it, for what the parser can't know: which custom
 * fields a name means and which issue a key names, among what the query may see. A field or key
 * outside that answers exactly as one that doesn't exist. The engine itself stays free of the
 * database; this hands it the answers in its context.
 */
import type { Prisma } from '@prisma/client';

import { createViewer, parseKey, resolveKey } from '../../actions/keys';
import { prisma } from '../../config/database';
import {
  customFieldName,
  likeLiteral,
  QueryValueError,
  unknownCustomField,
  type CustomFieldType,
  type Expression,
  type QueryContext,
  type Value,
} from '../../lib/query-engine';
import { AppError } from '../../middleware/errorHandler';

import { viewableProjectsWhere } from './search-access';

/** How many issue keys one query may name: each costs lookups before the query itself runs */
const MAX_LINKED_KEYS = 50;
/** The largest value of the issue number column */
const MAX_ISSUE_NUMBER = 2147483647;

const NOT_AN_ISSUE_KEY = "'linked' takes an issue key, such as AXM-12";

/**
 * Whose view a query runs in. A user sees what their projects hold, narrowed to one project when
 * given. A project alone is an automation rule: it has no reader, so it sees that project's fields
 * and the issues of that project's team.
 */
export type QueryScope = { userId: string; projectId?: string } | { projectId: string };

export type ResolvedQueryFields = Pick<
  QueryContext,
  'customFields' | 'customFieldUsers' | 'linkedIssues'
>;

/**
 * The custom field names and linked keys a query holds.
 * @param ast - The query
 */
function collect(ast: Expression) {
  const names = new Set<string>();
  const keys = new Set<string>();
  // The text a custom field is compared with, which may be a username
  const texts: Array<{ name: string; text: string }> = [];
  const addKeys = (values: Value[]) => {
    for (const value of values) {
      if (value.type === 'string') keys.add(value.value);
      // A number or function can't be a key: the same answer as text that isn't one
      if (value.type === 'number') throw new QueryValueError(NOT_AN_ISSUE_KEY);
    }
  };
  const pending: Expression[] = [ast];
  while (pending.length > 0) {
    const node = pending.pop() as Expression;
    if (node.type === 'and' || node.type === 'or') pending.push(node.left, node.right);
    else if (node.type === 'not') pending.push(node.operand);
    else if (node.type === 'comparison' || node.type === 'in') {
      const name = customFieldName(node.field);
      if (name !== null) {
        names.add(name);
        for (const value of node.type === 'in' ? node.values : [node.value]) {
          if (value.type === 'string') texts.push({ name, text: value.value });
        }
      } else if (node.field.toLowerCase() === 'linked') {
        addKeys(node.type === 'in' ? node.values : [node.value]);
      }
    }
  }
  return { names, keys, texts };
}

/**
 * The types each name has among the projects in view, by lower-case name.
 * @param names - The names as written
 * @param scope - Whose view
 * @throws {QueryValueError} Naming the first name that has none
 */
async function resolveCustomFields(
  names: Set<string>,
  scope: QueryScope,
): Promise<Map<string, CustomFieldType[]>> {
  const project: Prisma.ProjectWhereInput = {
    ...('userId' in scope ? await viewableProjectsWhere(scope.userId) : {}),
  };
  const rows = await prisma.customFieldDefinition.findMany({
    where: {
      ...(scope.projectId ? { projectId: scope.projectId } : {}),
      project,
      OR: [...names].map((name) => ({
        name: { equals: likeLiteral(name), mode: 'insensitive' as const },
      })),
    },
    distinct: ['name', 'type'],
    orderBy: [{ name: 'asc' }, { type: 'asc' }],
    select: { name: true, type: true },
  });
  const types = new Map<string, CustomFieldType[]>();
  for (const row of rows) {
    const name = row.name.toLowerCase();
    const known = types.get(name) ?? [];
    if (!known.includes(row.type as CustomFieldType)) known.push(row.type as CustomFieldType);
    types.set(name, known);
  }
  for (const name of names) {
    if (!types.has(name.toLowerCase())) throw unknownCustomField(name);
  }
  return types;
}

/**
 * Who a text compared with a USER field may name. A username found here only widens the comparison
 * on values of issues the query may see, so it tells nothing about who exists.
 * @param texts - The text per custom field
 * @param types - The types of each name
 * @returns Ids per username in lower case
 */
async function resolveCustomFieldUsers(
  texts: Array<{ name: string; text: string }>,
  types: Map<string, CustomFieldType[]>,
): Promise<Map<string, string[]>> {
  const usernames = new Set(
    texts
      .filter(({ name }) => types.get(name.toLowerCase())?.includes('USER'))
      .map(({ text }) => text.toLowerCase()),
  );
  const users = new Map<string, string[]>();
  if (usernames.size === 0) return users;
  const rows = await prisma.user.findMany({
    where: {
      OR: [...usernames].map((username) => ({
        username: { equals: likeLiteral(username), mode: 'insensitive' as const },
      })),
    },
    select: { id: true, username: true },
  });
  for (const row of rows) {
    const username = row.username.toLowerCase();
    users.set(username, [...(users.get(username) ?? []), row.id]);
  }
  return users;
}

/**
 * The id of the issue a key names, for a user: the rules of keys.ts.
 * @param key - The key as written
 * @param userId - Who asks
 * @param viewer - Their filters
 * @returns The id, or null for nothing they can see
 * @throws {QueryValueError} For what is no issue key, or a prefix several visible teams use
 */
async function issueIdForUser(
  key: string,
  userId: string,
  viewer: ReturnType<typeof createViewer>,
): Promise<string | null> {
  try {
    if (parseKey(key).kind !== 'issue') throw new QueryValueError(NOT_AN_ISSUE_KEY);
    const resolved = await resolveKey(key, userId, viewer);
    if (resolved.kind !== 'issue') throw new QueryValueError(NOT_AN_ISSUE_KEY);
    const issue = await prisma.issue.findUnique({
      where: {
        projectId_number: { projectId: resolved.projectId, number: resolved.issueNumber },
      },
      select: { id: true },
    });
    return issue?.id ?? null;
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 404) return null;
    if (err instanceof AppError && err.statusCode === 400) {
      throw new QueryValueError(NOT_AN_ISSUE_KEY);
    }
    if (err instanceof AppError) throw new QueryValueError(err.message);
    throw err;
  }
}

/**
 * The id of the issue a key names, for a rule: its project's team is what anyone it acts for shares.
 * @param key - The key as written
 * @param projectId - The rule's project
 * @returns The id, or null for nothing inside that team
 * @throws {QueryValueError} For what is no issue key
 */
async function issueIdForProject(key: string, projectId: string): Promise<string | null> {
  let parsed;
  try {
    parsed = parseKey(key);
  } catch {
    throw new QueryValueError(NOT_AN_ISSUE_KEY);
  }
  if (parsed.kind !== 'issue') throw new QueryValueError(NOT_AN_ISSUE_KEY);
  const number = Number(parsed.number);
  if (number > MAX_ISSUE_NUMBER) return null;
  const home = await prisma.project.findUnique({
    where: { id: projectId },
    select: { teamId: true, team: { select: { slug: true, org: { select: { slug: true } } } } },
  });
  if (!home) return null;
  if (
    parsed.org !== undefined &&
    (parsed.org !== home.team.org.slug || parsed.team !== home.team.slug)
  ) {
    return null;
  }
  const issue = await prisma.issue.findFirst({
    where: {
      number,
      project: {
        teamId: home.teamId,
        ...(parsed.prefix === undefined ? { slug: parsed.projectSlug } : { prefix: parsed.prefix }),
      },
    },
    select: { id: true },
  });
  return issue?.id ?? null;
}

/**
 * Find what a query's custom fields and issue keys mean, for its context. A query with neither
 * asks nothing of the database.
 * @param ast - The parsed query
 * @param scope - Whose view it runs in
 * @throws {QueryValueError} For a custom field that isn't there or can't be seen, naming it; for a
 * value of `linked` that is no issue key; for more keys than one query may name
 */
export async function resolveQueryFields(
  ast: Expression,
  scope: QueryScope,
): Promise<ResolvedQueryFields> {
  const { names, keys, texts } = collect(ast);
  if (keys.size > MAX_LINKED_KEYS) {
    throw new QueryValueError(`A query can name at most ${MAX_LINKED_KEYS} issue keys`);
  }
  const resolved: ResolvedQueryFields = {};
  if (names.size > 0) {
    resolved.customFields = await resolveCustomFields(names, scope);
    resolved.customFieldUsers = await resolveCustomFieldUsers(texts, resolved.customFields);
  }
  if (keys.size > 0) {
    const list = [...keys];
    const viewer = 'userId' in scope ? createViewer(scope.userId) : null;
    const found = await Promise.all(
      list.map((key) =>
        'userId' in scope
          ? issueIdForUser(key, scope.userId, viewer as ReturnType<typeof createViewer>)
          : issueIdForProject(key, scope.projectId),
      ),
    );
    resolved.linkedIssues = new Map(list.map((key, i) => [key, found[i]]));
  }
  return resolved;
}
