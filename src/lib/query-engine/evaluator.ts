import type {
  ComparisonOp,
  Expression,
  Value,
  FieldDefinition,
  FieldRegistry,
  QueryContext,
} from './ast';
import { customFieldName, evaluateCustomField } from './custom-fields';
import { derivedField } from './derived-fields';
import { PRIORITY_ORDINALS } from './fields/issue-fields';
import { builtinFunctions } from './functions';
import { hydrated, NO_USER } from './query-values';

/**
 * A field of the registry. Only its own names: `constructor` is no field.
 * @param field - The field as written
 * @param registry - The fields
 * @throws {Error} For an unknown field
 */
function lookupField(field: string, registry: FieldRegistry): FieldDefinition {
  const name = field.toLowerCase();
  if (!Object.hasOwn(registry, name)) throw new Error(`Unknown field '${field}'`);
  return registry[name];
}

function resolveValue(value: Value, context: QueryContext): unknown {
  if (value.type === 'null') return null;
  if (value.type === 'string') return value.value;
  if (value.type === 'number') return value.value;
  if (value.type === 'function') {
    const name = value.name.toLowerCase();
    if (!Object.hasOwn(builtinFunctions, name)) throw new Error(`Unknown function: ${value.name}`);
    if (name === 'currentuser' && !context.currentUserId) return NO_USER;
    const fn = builtinFunctions[name];
    return fn(value.args, context);
  }
  return null;
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function getFieldValue(obj: Record<string, unknown>, fieldDef: FieldDefinition): unknown {
  return getByPath(obj, fieldDef.column);
}

function compareValues(
  actual: unknown,
  operator: string,
  expected: unknown,
  fieldDef: FieldDefinition,
): boolean {
  // Handle empty/null checks
  if (expected === null) {
    if (operator === '=') return actual == null;
    if (operator === '!=') return actual != null;
    return false;
  }

  // Enum fields: case-insensitive comparison
  if (fieldDef.type === 'enum') {
    const actualStr = actual != null ? String(actual).toUpperCase() : '';
    const expectedStr = expected != null ? String(expected).toUpperCase() : '';

    // Ordinal comparison
    if (['>', '>=', '<', '<='].includes(operator)) {
      const actualOrdinal = PRIORITY_ORDINALS[actualStr] ?? -1;
      const expectedOrdinal = PRIORITY_ORDINALS[expectedStr] ?? -1;
      if (operator === '>') return actualOrdinal > expectedOrdinal;
      if (operator === '>=') return actualOrdinal >= expectedOrdinal;
      if (operator === '<') return actualOrdinal < expectedOrdinal;
      if (operator === '<=') return actualOrdinal <= expectedOrdinal;
    }

    if (operator === '=') return actualStr === expectedStr;
    if (operator === '!=') return actualStr !== expectedStr;
    return false;
  }

  // Relation field (single, e.g. status via column.name)
  if (fieldDef.type === 'relation' && fieldDef.join && !fieldDef.many) {
    // actual is the nested object value already extracted via column path
    const actualStr = actual != null ? String(actual).toLowerCase() : '';
    const expectedStr = expected != null ? String(expected).toLowerCase() : '';
    if (operator === '=') return actualStr === expectedStr;
    if (operator === '!=') return actualStr !== expectedStr;
    return false;
  }

  // String contains
  if (operator === '~') {
    const actualStr = actual != null ? String(actual).toLowerCase() : '';
    const expectedStr = expected != null ? String(expected).toLowerCase() : '';
    return actualStr.includes(expectedStr);
  }

  // Numeric and date comparisons
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (operator === '=') return actual === expected;
    if (operator === '!=') return actual !== expected;
    if (operator === '>') return actual > expected;
    if (operator === '<') return actual < expected;
    if (operator === '>=') return actual >= expected;
    if (operator === '<=') return actual <= expected;
  }

  // Date comparisons. A date in a query is text, as the compiler reads it
  const expectedDate =
    actual instanceof Date && typeof expected === 'string' ? new Date(expected) : expected;
  if (actual instanceof Date && expectedDate instanceof Date) {
    const at = actual.getTime();
    const et = expectedDate.getTime();
    if (operator === '=') return at === et;
    if (operator === '!=') return at !== et;
    if (operator === '>') return at > et;
    if (operator === '<') return at < et;
    if (operator === '>=') return at >= et;
    if (operator === '<=') return at <= et;
  }

  // Default string equality. An empty column is no text, not even the text "null"
  if (actual == null) return operator === '!=';
  if (operator === '=') return String(actual) === String(expected);
  if (operator === '!=') return String(actual) !== String(expected);

  return false;
}

/**
 * Whether a field that takes a name as well as an id holds one of these values. Ids are exact,
 * names are not, as in the compiler.
 * @param obj - The issue
 * @param fieldDef - The field, with an aliasField
 * @param values - The values
 */
function matchesIdOrName(
  obj: Record<string, unknown>,
  fieldDef: FieldDefinition,
  values: string[],
): boolean {
  const id = getByPath(obj, fieldDef.column);
  const name = getByPath(obj, fieldDef.aliasField as string);
  return values.some(
    (value) =>
      (id != null && String(id) === value) ||
      (name != null && String(name).toLowerCase() === value.toLowerCase()),
  );
}

function evaluateComparison(
  field: string,
  operator: string,
  value: Value,
  obj: Record<string, unknown>,
  registry: FieldRegistry,
  context: QueryContext,
): boolean {
  const customName = customFieldName(field);
  const fieldDef = customName === null ? lookupField(field, registry) : null;

  const resolved = resolveValue(value, context);

  // currentUser() without a user: nobody, so equal to nothing and different from everything
  if (resolved === NO_USER) return operator === '!=';
  if (customName !== null) {
    return evaluateCustomField(customName, operator as ComparisonOp, resolved, obj, context);
  }
  if (fieldDef === null) throw new Error(`Unknown field '${field}'`);
  const derived = derivedField(field.toLowerCase());
  if (derived) return derived.evaluate(operator as ComparisonOp, resolved, obj, context);

  if (
    field.toLowerCase() === 'sprint' &&
    value.type === 'function' &&
    value.name.toLowerCase() === 'currentsprint' &&
    (operator === '=' || operator === '!=')
  ) {
    const sprint = hydrated(obj, 'sprint', 'currentSprint()') as Record<string, unknown> | null;
    const active = sprint !== null && hydrated(sprint, 'status', 'currentSprint()') === 'ACTIVE';
    return active === (operator === '=');
  }

  // Fields that take a name as well as an id. A function's value is an id, or no name at all
  if (
    fieldDef.aliasField &&
    value.type !== 'function' &&
    resolved !== null &&
    (operator === '=' || operator === '!=')
  ) {
    return matchesIdOrName(obj, fieldDef, [String(resolved)]) === (operator === '=');
  }

  // Many-relation (e.g. labels)
  if (fieldDef.type === 'relation' && fieldDef.many) {
    const arr = getByPath(obj, fieldDef.join!) as Array<Record<string, unknown>> | null | undefined;
    if (!Array.isArray(arr)) return false;
    if (resolved === null) {
      if (operator === '=') return arr.length === 0;
      if (operator === '!=') return arr.length > 0;
      return false;
    }
    const expectedStr = resolved != null ? String(resolved).toLowerCase() : '';
    // Extract sub-field name from column (e.g. "labels.name" -> "name")
    const parts = fieldDef.column.split('.');
    const subField = parts.length > 1 ? parts[parts.length - 1] : 'name';
    const matches = arr.some((item) => {
      const itemVal = item[subField];
      return itemVal != null && String(itemVal).toLowerCase() === expectedStr;
    });
    if (operator === '=') return matches;
    if (operator === '!=') return !matches;
    return false;
  }

  // User fields: compare by ID (column = assigneeId)
  if (fieldDef.type === 'user') {
    const actual = getByPath(obj, fieldDef.column);
    if (resolved === null) {
      if (operator === '=') return actual == null;
      if (operator === '!=') return actual != null;
      return false;
    }
    // Function result is a userId string
    if (value.type === 'function') {
      if (operator === '=') return actual === resolved;
      if (operator === '!=') return actual !== resolved;
      return false;
    }
    // String value - compare with column (id). An empty column is no text, not even "null"
    if (actual == null) return operator === '!=';
    if (operator === '=') return String(actual) === String(resolved);
    if (operator === '!=') return String(actual) !== String(resolved);
    return false;
  }

  const actual = getFieldValue(obj, fieldDef);
  return compareValues(actual, operator, resolved, fieldDef);
}

function evaluateIn(
  field: string,
  values: Value[],
  negated: boolean,
  obj: Record<string, unknown>,
  registry: FieldRegistry,
  context: QueryContext,
): boolean {
  const customName = customFieldName(field);
  const fieldDef = customName === null ? lookupField(field, registry) : null;

  // currentUser() without a user is nobody, so no value the list can hold
  const resolvedValues = values.map((v) => resolveValue(v, context)).filter((v) => v !== NO_USER);

  const derived = customName === null ? derivedField(field.toLowerCase()) : undefined;
  if (customName !== null || derived) {
    const found = resolvedValues.some((value) =>
      customName !== null
        ? evaluateCustomField(customName, '=', value, obj, context)
        : (derived as NonNullable<typeof derived>).evaluate('=', value, obj, context),
    );
    return negated ? !found : found;
  }
  if (fieldDef === null) throw new Error(`Unknown field '${field}'`);

  // Many-relation (e.g. labels): any of its rows, as = reads it
  if (fieldDef.type === 'relation' && fieldDef.many) {
    const rows = getByPath(obj, fieldDef.join!);
    const parts = fieldDef.column.split('.');
    const subField = parts.length > 1 ? parts[parts.length - 1] : 'name';
    const wanted = resolvedValues.map((rv) => (rv != null ? String(rv).toUpperCase() : ''));
    const found =
      Array.isArray(rows) &&
      rows.some((row: Record<string, unknown>) => {
        const name = row[subField];
        return name != null && wanted.includes(String(name).toUpperCase());
      });
    return negated ? !found : found;
  }

  if (fieldDef.aliasField) {
    const found = matchesIdOrName(
      obj,
      fieldDef,
      resolvedValues.filter((rv) => rv != null).map(String),
    );
    return negated ? !found : found;
  }

  const actual = getFieldValue(obj, fieldDef);
  const actualStr = actual != null ? String(actual).toUpperCase() : '';

  const matches = resolvedValues.some((rv) => {
    const rvStr = rv != null ? String(rv).toUpperCase() : '';
    return actualStr === rvStr;
  });

  return negated ? !matches : matches;
}

/**
 * Refuse a function the engine doesn't have, at any depth of its value.
 * @param value - A value of a condition
 * @throws {Error} For an unknown function
 */
function assertKnownFunctions(value: Value): void {
  if (value.type !== 'function') return;
  if (!Object.hasOwn(builtinFunctions, value.name.toLowerCase())) {
    throw new Error(`Unknown function: ${value.name}`);
  }
  value.args.forEach(assertKnownFunctions);
}

/**
 * Refuse a rule condition that could not decide anything: one that names a field or function the
 * registry doesn't have, which could only fail later, or holds plain text, which says nothing about
 * an issue. Such text parses, as anything does that isn't a structured query.
 * @param ast - The parsed condition
 * @param registry - The fields
 * @throws {Error} Saying what is wrong
 */
export function assertKnownFields(ast: Expression, registry: FieldRegistry): void {
  const pending: Expression[] = [ast];
  while (pending.length > 0) {
    const node = pending.pop() as Expression;
    if (node.type === 'comparison') {
      if (customFieldName(node.field) === null) lookupField(node.field, registry);
      assertKnownFunctions(node.value);
    } else if (node.type === 'in') {
      if (customFieldName(node.field) === null) lookupField(node.field, registry);
      node.values.forEach(assertKnownFunctions);
    } else if (node.type === 'and' || node.type === 'or') {
      pending.push(node.left, node.right);
    } else if (node.type === 'not') {
      pending.push(node.operand);
    } else if (node.type === 'freetext') {
      throw new Error(`A condition can't hold plain text: "${node.value}"`);
    }
  }
}

/**
 * The plain text of a query, which the structured part leaves for a text search.
 * @param ast - The parsed query
 * @returns Its text in query order, or the empty string
 */
export function freeTextOf(ast: Expression): string {
  const parts: string[] = [];
  const pending: Expression[] = [ast];
  while (pending.length > 0) {
    const node = pending.pop() as Expression;
    if (node.type === 'freetext') parts.push(node.value);
    else if (node.type === 'and' || node.type === 'or') pending.push(node.right, node.left);
    else if (node.type === 'not') pending.push(node.operand);
  }
  return parts.join(' ');
}

/**
 * Evaluates an AST Expression against a plain object, returning true if the object matches.
 * @param ast
 * @param obj
 * @param registry
 * @param context
 */
export function evaluate(
  ast: Expression,
  obj: Record<string, unknown>,
  registry: FieldRegistry,
  context: QueryContext,
): boolean {
  switch (ast.type) {
    case 'comparison':
      return evaluateComparison(ast.field, ast.operator, ast.value, obj, registry, context);

    case 'in':
      return evaluateIn(ast.field, ast.values, ast.negated, obj, registry, context);

    case 'and':
      return (
        evaluate(ast.left, obj, registry, context) && evaluate(ast.right, obj, registry, context)
      );

    case 'or':
      return (
        evaluate(ast.left, obj, registry, context) || evaluate(ast.right, obj, registry, context)
      );

    case 'not':
      return !evaluate(ast.operand, obj, registry, context);

    // Text says nothing about the object, so it must never be what makes a rule fire
    case 'freetext':
      return false;

    default: {
      const _exhaustive: never = ast;
      throw new Error(`Unhandled expression type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
