import { Prisma, type SavedFilter } from '@prisma/client';

import { prisma } from '../../config/database';
import { ParseError, parseQuery } from '../../lib/query-engine';
import {
  assertAccess,
  canEdit,
  editRightsOf,
  resolveSharing,
  resolveSharingChange,
  sharedWith,
  type SharingInput,
} from '../../lib/sharing';
import { AppError } from '../../middleware/errorHandler';

const WHAT = 'Saved query';
const LIST_LIMIT = 100;
/** Marks a stored query as text, so a UI preset that has a key called text is not mistaken for one */
const QUERY_KIND = 'query';

/** What a client sends to store: a UI filter record, or the text of a query */
export interface QueryBody {
  query?: Record<string, string>;
  text?: string;
}

/** A saved query as clients see it */
export type SavedQueryRecord = SavedFilter & { canEdit: boolean };

/**
 * The text a row stores, when it is a query written in the language: new rows hold { text }.
 * Anything else is a UI filter record saved before sharing existed (ruling P13).
 * @param query - The stored JSON
 */
function storedText(query: Prisma.JsonValue): string | null {
  if (query === null || typeof query !== 'object' || Array.isArray(query)) return null;
  const keys = Object.keys(query).sort();
  return keys.length === 2 &&
    keys[0] === 'kind' &&
    keys[1] === 'text' &&
    query.kind === QUERY_KIND &&
    typeof query.text === 'string'
    ? query.text
    : null;
}

const ENUM_FIELDS: Record<string, readonly string[]> = {
  type: ['TASK', 'BUG', 'STORY', 'EPIC'],
  priority: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
};

/**
 * Turn a UI filter record into query text, only when nothing is lost: type and priority with
 * values the language knows. Any other key (search, assignee, label, sort) has no exact
 * equivalent, so the row is not converted.
 * @param filter - The stored record
 * @returns The text, or null when the record cannot be converted without loss
 */
function legacyToText(filter: Prisma.JsonValue): string | null {
  if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) return null;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(filter)) {
    const allowed = ENUM_FIELDS[key];
    if (!allowed || typeof value !== 'string') return null;
    const values = value.split(',').map((v) => v.trim().toUpperCase());
    if (values.length === 0 || values.some((v) => !allowed.includes(v))) return null;
    const clause = values.map((v) => `${key} = ${v}`).join(' OR ');
    parts.push(values.length > 1 ? `(${clause})` : clause);
  }
  return parts.length > 0 ? parts.join(' AND ') : null;
}

/**
 * Check a query parses, so a saved one is never already broken.
 * @param text - The query text
 * @throws {AppError} 400 INVALID_QUERY
 */
export function assertParses(text: string): void {
  try {
    parseQuery(text);
  } catch (err) {
    if (err instanceof ParseError) throw new AppError(400, err.message, 'INVALID_QUERY');
    throw err;
  }
}

/**
 * The JSON to store for a body: { text } for a query in the language, the record as sent for a UI
 * filter.
 * @param body - One of query and text
 * @throws {AppError} 400 when neither or both are given, or the text does not parse
 */
function toStored(body: QueryBody): Prisma.InputJsonValue {
  if ((body.query === undefined) === (body.text === undefined)) {
    throw new AppError(400, 'Give either query or text');
  }
  if (body.text !== undefined) {
    assertParses(body.text);
    return { kind: QUERY_KIND, text: body.text };
  }
  return body.query as Prisma.InputJsonValue;
}

async function withEdit(userId: string, row: SavedFilter): Promise<SavedQueryRecord> {
  return { ...row, canEdit: await canEdit(userId, row, row.userId) };
}

/**
 * Load a saved query the user may open (404 otherwise) or, with 'edit', change (403 when they can
 * open it and not change it).
 * @param userId - The user
 * @param id - The saved query
 * @param need - 'view' or 'edit'
 */
export async function loadFor(
  userId: string,
  id: string,
  need: 'view' | 'edit',
): Promise<SavedFilter> {
  const row = await prisma.savedFilter.findUnique({ where: { id } });
  return assertAccess(userId, row, row?.userId, need, WHAT);
}

/**
 * Create a saved query, private unless shared with a team or org the user belongs to.
 * @param userId - The creator
 * @param data - Name, the query as a record or text, and the sharing
 * @param data.name
 * @param data.description
 * @param data.projectId
 * @param data.body
 * @param data.sharing
 */
export async function create(
  userId: string,
  data: {
    name: string;
    description?: string;
    projectId?: string;
    body: QueryBody;
    sharing: SharingInput;
  },
): Promise<SavedQueryRecord> {
  const query = toStored(data.body);
  const sharing = await resolveSharing(userId, data.sharing);
  const row = await prisma.savedFilter.create({
    data: {
      userId,
      name: data.name,
      description: data.description ?? null,
      query,
      projectId: data.projectId ?? null,
      ...sharing,
    },
  });
  return withEdit(userId, row);
}

/**
 * The user's own saved queries and those shared with their teams and orgs.
 * @param userId - The user
 * @param projectId - Optional project to narrow to
 */
export async function list(userId: string, projectId?: string): Promise<SavedQueryRecord[]> {
  const narrow = projectId ? { projectId } : {};
  // The user's own come first, so shared ones can never push them out of the page
  const own = await prisma.savedFilter.findMany({
    where: { userId, ...narrow },
    orderBy: { createdAt: 'desc' },
    take: LIST_LIMIT,
  });
  const shared =
    own.length < LIST_LIMIT
      ? await prisma.savedFilter.findMany({
          where: { AND: [sharedWith(userId), { userId: { not: userId } }, narrow] },
          orderBy: { createdAt: 'desc' },
          take: LIST_LIMIT - own.length,
        })
      : [];
  const mayEdit = await editRightsOf(userId);
  return [...own, ...shared].map((row) => ({ ...row, canEdit: mayEdit(row, row.userId) }));
}

/**
 * One saved query the user may open.
 * @param userId - The user
 * @param id - The saved query
 */
export async function get(userId: string, id: string): Promise<SavedQueryRecord> {
  return withEdit(userId, await loadFor(userId, id, 'view'));
}

/**
 * Change a saved query. Moving it to a team or org needs membership of that one.
 * @param userId - The user changing it
 * @param id - The saved query
 * @param data - What to change
 * @param data.name
 * @param data.description
 * @param data.body
 * @param data.sharing
 * @param data.sharing.visibility
 * @param data.sharing.teamId
 * @param data.sharing.orgId
 */
export async function update(
  userId: string,
  id: string,
  data: {
    name?: string;
    description?: string | null;
    body: QueryBody;
    sharing: { visibility?: SharingInput['visibility']; teamId?: string; orgId?: string };
  },
): Promise<SavedQueryRecord> {
  const current = await loadFor(userId, id, 'edit');
  const sharing = await resolveSharingChange(userId, current, data.sharing);
  const changesQuery = data.body.query !== undefined || data.body.text !== undefined;
  const row = await prisma.savedFilter.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(changesQuery ? { query: toStored(data.body) } : {}),
      ...sharing,
    },
  });
  return withEdit(userId, row);
}

/**
 * Delete a saved query.
 * @param userId - The user deleting it
 * @param id - The saved query
 */
export async function remove(userId: string, id: string): Promise<void> {
  await loadFor(userId, id, 'edit');
  await prisma.savedFilter.delete({ where: { id } });
}

/**
 * The text and project scope to run for a saved query the user may open.
 * @param userId - The user
 * @param id - The saved query
 * @throws {AppError} 404 when unseen; 400 LEGACY_FILTER when the row is a UI filter with no exact
 * query
 */
export async function textToRun(
  userId: string,
  id: string,
): Promise<{ text: string; projectId?: string }> {
  const row = await loadFor(userId, id, 'view');
  const text = storedText(row.query) ?? legacyToText(row.query);
  if (text === null) {
    throw new AppError(
      400,
      'This saved filter was made in the issue list and has no exact query. Open it there, or save the query again as text.',
      'LEGACY_FILTER',
    );
  }
  return { text, ...(row.projectId ? { projectId: row.projectId } : {}) };
}
