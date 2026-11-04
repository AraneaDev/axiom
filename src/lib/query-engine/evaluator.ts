import type { Expression, Value, FieldDefinition, FieldRegistry, QueryContext } from './ast';
import { PRIORITY_ORDINALS } from './fields/issue-fields';
import { builtinFunctions } from './functions';

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

  // Date comparisons
  if (actual instanceof Date && expected instanceof Date) {
    const at = actual.getTime();
    const et = expected.getTime();
    if (operator === '=') return at === et;
    if (operator === '!=') return at !== et;
    if (operator === '>') return at > et;
    if (operator === '<') return at < et;
    if (operator === '>=') return at >= et;
    if (operator === '<=') return at <= et;
  }

  // Default string equality
  if (operator === '=') return String(actual) === String(expected);
  if (operator === '!=') return String(actual) !== String(expected);

  return false;
}

function evaluateComparison(
  field: string,
  operator: string,
  value: Value,
  obj: Record<string, unknown>,
  registry: FieldRegistry,
  context: QueryContext,
): boolean {
  const fieldDef = lookupField(field, registry);

  const resolved = resolveValue(value, context);

  // Many-relation (e.g. labels)
  if (fieldDef.type === 'relation' && fieldDef.many) {
    const arr = getByPath(obj, fieldDef.join!) as Array<Record<string, unknown>> | null | undefined;
    if (!Array.isArray(arr)) return false;
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
    // String value - compare with column (id)
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
  const fieldDef = lookupField(field, registry);

  const resolvedValues = values.map((v) => resolveValue(v, context));

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
      lookupField(node.field, registry);
      assertKnownFunctions(node.value);
    } else if (node.type === 'in') {
      lookupField(node.field, registry);
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
