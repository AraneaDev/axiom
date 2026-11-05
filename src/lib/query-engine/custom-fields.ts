/**
 * Custom fields in queries: `cf.Name` and `cf."Name with spaces"`. The parser takes any name; the
 * resolve step (src/modules/search/query-fields.service.ts) says which types a name has among the
 * projects a query may see, and hands them over in the context. Filters go by name and type, never
 * by definition ids, so one name across many projects stays one small filter. Which issues count
 * is the business of the access filter the caller adds.
 */
import type { ComparisonOp, CustomFieldType, QueryContext } from './ast';
import { hydrated, likeLiteral, MATCH_NOTHING, QueryValueError } from './query-values';

export const CUSTOM_FIELD_PREFIX = 'cf.';

/**
 * The custom field an AST field names.
 * @param field - The field as the parser wrote it
 * @returns The name, or null for a field of the registry
 */
export function customFieldName(field: string): string | null {
  return field.startsWith(CUSTOM_FIELD_PREFIX) ? field.slice(CUSTOM_FIELD_PREFIX.length) : null;
}

const NUMBER_TEXT = /^-?\d+(?:\.\d+)?$/;
const DATE_TEXT =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * A stored or queried text as a number.
 * @param text - The text
 * @returns The number, or null when it isn't one
 */
function castNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMBER_TEXT.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A stored or queried text as a date: an ISO date, or date and time. Without a zone it means UTC.
 * @param text - The text
 * @returns The date, or null when it isn't one: 2026-02-31 doesn't roll over into March
 */
function castDate(text: string): Date | null {
  const match = DATE_TEXT.exec(text.trim());
  if (!match) return null;
  const [, year, month, day, hour = '00', minute = '00', second = '00', fraction = '', zone] =
    match;
  if (year === '0000') return null;
  const dayStart = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(dayStart.getTime()) ||
    dayStart.toISOString().slice(0, 10) !== `${year}-${month}-${day}`
  ) {
    return null;
  }
  const date = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${zone ?? 'Z'}`,
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Everything to store for a custom field value. Number and date comparisons run on the typed
 * columns, whatever the type of the definition, so a changed type needs no rewrite. A value that
 * isn't a number or a date leaves them empty, and then never matches.
 * @param value - The value as text
 */
export function typedCustomFieldValue(value: string) {
  return { value, numberValue: castNumber(value), dateValue: castDate(value) };
}

/**
 * A query's value in the terms of a definition's type.
 * @param type - The type
 * @param value - The resolved value, not null
 * @returns It as a number, date or text, or null when it can't be one, which then matches nothing
 */
function castOperand(type: CustomFieldType, value: unknown): number | Date | string | null {
  if (type === 'NUMBER') {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    return typeof value === 'string' ? castNumber(value) : null;
  }
  if (type === 'DATE') {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    return typeof value === 'string' ? castDate(value) : null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

const ORDERING: Record<string, string> = { '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte' };

function answers(type: CustomFieldType, operator: ComparisonOp): boolean {
  if (operator === '=' || operator === '!=') return true;
  if (operator === '~') return type === 'TEXT' || type === 'SELECT';
  return type === 'NUMBER' || type === 'DATE';
}

/**
 * The types of a name among which the operator means something.
 * @param name - The name as written
 * @param operator - The operator
 * @param value - The resolved value
 * @param context - Holds what the resolve step found
 * @throws {QueryValueError} For an unknown name, or an operator none of its types can answer
 */
function typesFor(
  name: string,
  operator: ComparisonOp,
  value: unknown,
  context: QueryContext,
): CustomFieldType[] {
  const types = context.customFields?.get(name.toLowerCase());
  if (!types) throw unknownCustomField(name);
  if (value === null && operator !== '=' && operator !== '!=') {
    throw new QueryValueError(`'cf.${name}' can't be compared with null here`);
  }
  const usable = types.filter((type) => answers(type, operator));
  if (usable.length === 0) {
    throw new QueryValueError(`'cf.${name}' can't be used with ${operator}`);
  }
  return usable;
}

/**
 * The one answer for a name that doesn't exist and one the query can't see.
 * @param name - The name as written
 */
export function unknownCustomField(name: string): QueryValueError {
  return new QueryValueError(`Unknown custom field '${name}'`);
}

function valueFilter(
  type: CustomFieldType,
  operator: ComparisonOp,
  operand: number | Date | string,
): Record<string, unknown> {
  if (type === 'NUMBER' || type === 'DATE') {
    const column = type === 'NUMBER' ? 'numberValue' : 'dateValue';
    const ordering = ORDERING[operator];
    return { [column]: ordering ? { [ordering]: operand } : operand };
  }
  const literal = likeLiteral(String(operand));
  const insensitive = { mode: 'insensitive' };
  if (operator === '~') return { value: { contains: literal, ...insensitive } };
  if (type === 'USER') return { value: operand };
  if (type === 'MULTI_SELECT') {
    // Stored as "A,B"
    return {
      OR: [
        { value: { equals: literal, ...insensitive } },
        { value: { startsWith: `${literal},`, ...insensitive } },
        { value: { endsWith: `,${literal}`, ...insensitive } },
        { value: { contains: `,${literal},`, ...insensitive } },
      ],
    };
  }
  return { value: { equals: literal, ...insensitive } };
}

/**
 * A comparison on a custom field as a Prisma filter, per type its name has.
 * @param name - The name as written
 * @param operator - The operator
 * @param value - The resolved value
 * @param context - Holds what the resolve step found
 * @throws {QueryValueError} For an unknown name, or an operator none of its types can answer
 */
export function compileCustomField(
  name: string,
  operator: ComparisonOp,
  value: unknown,
  context: QueryContext,
): Record<string, unknown> {
  const branches: Record<string, unknown>[] = [];
  for (const type of typesFor(name, operator, value, context)) {
    const definition = { name: { equals: likeLiteral(name), mode: 'insensitive' }, type };
    const has = (filter: Record<string, unknown>) => ({
      customFieldValues: { some: { fieldDefinition: definition, ...filter } },
    });
    // In a project with the field, and only there: elsewhere the field isn't anything
    const lacks = (filter: Record<string, unknown>) => ({
      project: { customFieldDefinitions: { some: definition } },
      customFieldValues: { none: { fieldDefinition: definition, ...filter } },
    });
    if (value === null) {
      const filled = { value: { not: '' } };
      branches.push(operator === '=' ? lacks(filled) : has(filled));
      continue;
    }
    const operand = castOperand(type, value);
    if (operand === null) continue;
    const filter = valueFilter(type, operator === '!=' ? '=' : operator, operand);
    branches.push(operator === '!=' ? lacks(filter) : has(filter));
  }
  return branches.length > 0 ? { OR: branches } : MATCH_NOTHING;
}

function rowMatches(
  type: CustomFieldType,
  operator: ComparisonOp,
  operand: number | Date | string,
  stored: string,
): boolean {
  if (type === 'NUMBER' || type === 'DATE') {
    const typed = typedCustomFieldValue(stored);
    const actual = type === 'NUMBER' ? typed.numberValue : typed.dateValue?.getTime();
    if (actual == null) return false;
    const target = operand instanceof Date ? operand.getTime() : (operand as number);
    if (operator === '>') return actual > target;
    if (operator === '<') return actual < target;
    if (operator === '>=') return actual >= target;
    if (operator === '<=') return actual <= target;
    return actual === target;
  }
  const wanted = String(operand);
  if (type === 'USER') return stored === wanted;
  const lower = wanted.toLowerCase();
  if (operator === '~') return stored.toLowerCase().includes(lower);
  if (type === 'MULTI_SELECT') {
    return stored.split(',').some((item) => item.toLowerCase() === lower);
  }
  return stored.toLowerCase() === lower;
}

interface HydratedValue {
  value: string;
  fieldDefinition: { name: string; type: string };
}

/**
 * A comparison on a custom field over a hydrated issue, reading as compileCustomField does.
 * @param name - The name as written
 * @param operator - The operator
 * @param value - The resolved value
 * @param issue - The issue
 * @param context - Holds what the resolve step found
 * @throws {QueryValueError} For an unknown name, or an operator none of its types can answer
 * @throws {Error} When the issue wasn't hydrated with its values
 */
export function evaluateCustomField(
  name: string,
  operator: ComparisonOp,
  value: unknown,
  issue: Record<string, unknown>,
  context: QueryContext,
): boolean {
  const types = typesFor(name, operator, value, context);
  const stored = hydrated(issue, 'customFieldValues', `cf.${name}`) as HydratedValue[];
  const lower = name.toLowerCase();
  return types.some((type) => {
    const rows = stored
      .filter(
        (row) =>
          row.fieldDefinition.type === type && row.fieldDefinition.name.toLowerCase() === lower,
      )
      .map((row) => row.value);
    if (value === null) {
      const filled = rows.some((row) => row !== '');
      return operator === '=' ? !filled : filled;
    }
    const operand = castOperand(type, value);
    if (operand === null) return false;
    const comparison = operator === '!=' ? '=' : operator;
    const found = rows.some((row) => rowMatches(type, comparison, operand, row));
    return operator === '!=' ? !found : found;
  });
}
