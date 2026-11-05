/**
 * What the compiler, the evaluator and their field modules share about values.
 */

import type { FieldDefinition, Value } from './ast';

/**
 * A query that parses and names real fields, but holds a value its field can't be compared with.
 * Callers answer this as a bad query. It must never reach the database as a failed query.
 */
export class QueryValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryValueError';
  }
}

/** currentUser() where there is no user: nobody, which is neither a value nor empty. */
export const NO_USER = Symbol('no user');

/** A where clause no issue meets. */
export const MATCH_NOTHING = { id: { in: [] as string[] } };

/**
 * Whether a comparison is ~ currentUser() on a user field. Its value is an id rather than part of
 * a name, so it asks the same as = currentUser().
 * @param fieldDef - The field, null for a custom field
 * @param operator - The operator
 * @param value - The value as written
 */
export function isContainsCurrentUser(
  fieldDef: FieldDefinition | null,
  operator: string,
  value: Value,
): boolean {
  return (
    operator === '~' &&
    fieldDef?.type === 'user' &&
    value.type === 'function' &&
    value.name.toLowerCase() === 'currentuser'
  );
}

/**
 * Text for a case-insensitive Prisma filter, which runs as ILIKE and doesn't escape on its own.
 * @param text - The text, meant literally
 */
export function likeLiteral(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}

/**
 * What a hydrated issue holds, refusing to read an absent include as "none": a trigger site that
 * forgot it must fail, not make a rule decide on nothing.
 * @param holder - The object to read from
 * @param key - What the field needs
 * @param field - The field, for the message
 * @throws {Error} When the key is absent
 */
export function hydrated(holder: Record<string, unknown>, key: string, field: string): unknown {
  const value = holder[key];
  if (value === undefined) {
    throw new Error(`'${field}' needs ${key} on a hydrated issue (AUTOMATION_ISSUE_INCLUDE)`);
  }
  return value;
}
