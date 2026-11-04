import type { Expression, FieldDefinition, FieldRegistry, QueryContext, Value } from './ast';
import { PRIORITY_ORDINALS } from './fields/issue-fields';
import { builtinFunctions } from './functions';

/** The range of an integer column. */
const MIN_INT = -2147483648;
const MAX_INT = 2147483647;

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

/**
 * A value as its column takes it.
 * @param field - The field as written, for the message
 * @param fieldDef - The field
 * @param value - The resolved value
 * @param allowNull - Whether the operator can ask about empty at all
 * @throws {QueryValueError} When the column can't be compared with it
 */
function columnValue(
  field: string,
  fieldDef: FieldDefinition,
  value: unknown,
  allowNull: boolean,
): unknown {
  if (value === null) {
    if (allowNull && fieldDef.nullable) return null;
    throw new QueryValueError(`'${field}' can't be compared with null here`);
  }
  if (fieldDef.type === 'number') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new QueryValueError(`'${field}' takes a whole number`);
    }
    if (value < MIN_INT || value > MAX_INT) {
      throw new QueryValueError(`'${field}' takes a number between ${MIN_INT} and ${MAX_INT}`);
    }
    return value;
  }
  if (fieldDef.type === 'date') {
    const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
    const year = date?.getUTCFullYear();
    if (!date || year === undefined || Number.isNaN(year) || year < 0 || year > 9999) {
      throw new QueryValueError(`'${field}' takes a date, such as "2026-01-31"`);
    }
    return date;
  }
  return String(value);
}

function resolveValue(value: Value, context: QueryContext): unknown {
  if (value.type === 'null') return null;
  if (value.type === 'string') return value.value;
  if (value.type === 'number') return value.value;
  if (value.type === 'function') {
    const fn = builtinFunctions[value.name.toLowerCase()];
    if (!fn) throw new Error(`Unknown function: ${value.name}`);
    return fn(value.args, context);
  }
  return null;
}

function normalizeEnum(field: string, val: string, values: string[]): string {
  const upper = val.toUpperCase();
  const match = values.find((v) => v.toUpperCase() === upper);
  if (match === undefined) {
    throw new QueryValueError(`'${field}' takes one of ${values.join(', ')}`);
  }
  return match;
}

function ordinalComparison(
  fieldName: string,
  column: string,
  values: string[],
  operator: string,
  targetRaw: string,
): Record<string, unknown> {
  const target = targetRaw.toUpperCase();
  const targetOrdinal = PRIORITY_ORDINALS[target];
  if (targetOrdinal === undefined) {
    throw new Error(`Unknown priority value: ${targetRaw}`);
  }

  let qualifying: string[];
  if (operator === '>') {
    qualifying = values.filter((v) => (PRIORITY_ORDINALS[v] ?? -1) > targetOrdinal);
  } else if (operator === '>=') {
    qualifying = values.filter((v) => (PRIORITY_ORDINALS[v] ?? -1) >= targetOrdinal);
  } else if (operator === '<') {
    qualifying = values.filter((v) => (PRIORITY_ORDINALS[v] ?? -1) < targetOrdinal);
  } else if (operator === '<=') {
    qualifying = values.filter((v) => (PRIORITY_ORDINALS[v] ?? -1) <= targetOrdinal);
  } else {
    qualifying = [];
  }

  qualifying.sort((a, b) => (PRIORITY_ORDINALS[a] ?? 0) - (PRIORITY_ORDINALS[b] ?? 0));

  return { [column]: { in: qualifying } };
}

function compileComparison(
  field: string,
  operator: string,
  value: Value,
  registry: FieldRegistry,
  context: QueryContext,
): Record<string, unknown> {
  const fieldDef = registry[field.toLowerCase()];
  if (!fieldDef) {
    const available = Object.keys(registry).join(', ');
    throw new Error(`Unknown field '${field}'. Available fields: ${available}`);
  }

  const resolved = resolveValue(value, context);

  // Relation fields (join-based): status, label
  if (fieldDef.type === 'relation' && fieldDef.join) {
    const joinName = fieldDef.join;
    // Extract the sub-field name from column (e.g. "column.name" -> "name", "labels.name" -> "name")
    const parts = fieldDef.column.split('.');
    const subField = parts.length > 1 ? parts[parts.length - 1] : 'name';
    const strVal = String(resolved).toLowerCase();
    const isNegated = operator === '!=' || operator === 'NOT';
    const prismaOp = isNegated ? 'not' : 'equals';
    const condition = { [subField]: { [prismaOp]: strVal, mode: 'insensitive' } };

    if (fieldDef.many) {
      return isNegated
        ? { [joinName]: { none: { [subField]: { equals: strVal, mode: 'insensitive' } } } }
        : { [joinName]: { some: condition } };
    }
    return { [joinName]: condition };
  }

  const column = fieldDef.column;

  // Enum fields
  if (fieldDef.type === 'enum') {
    const enumValues = fieldDef.values ?? [];

    // Ordinal comparison
    if (['>', '>=', '<', '<='].includes(operator)) {
      if (!fieldDef.ordinal) {
        throw new Error(
          `Cannot use '${operator}' on enum field '${field}' without ordinal ordering`,
        );
      }
      const rawVal = resolved != null ? String(resolved) : '';
      return ordinalComparison(field, column, enumValues, operator, rawVal);
    }

    if (operator !== '=' && operator !== '!=') {
      throw new QueryValueError(`'${field}' can't be used with ${operator}`);
    }
    const rawVal = resolved != null ? String(resolved) : '';
    const normalized = normalizeEnum(field, rawVal, enumValues);
    return { [column]: operator === '=' ? normalized : { not: normalized } };
  }

  // Contains operator
  if (operator === '~') {
    if (fieldDef.type === 'number' || fieldDef.type === 'date') {
      throw new QueryValueError(`'${field}' can't be used with ~`);
    }
    return {
      [column]: { contains: columnValue(field, fieldDef, resolved, false), mode: 'insensitive' },
    };
  }

  // Only = and != can ask whether a column is empty
  const scalar = columnValue(field, fieldDef, resolved, operator === '=' || operator === '!=');

  if (operator === '=') {
    return { [column]: scalar };
  }
  if (operator === '!=') {
    return { [column]: { not: scalar } };
  }

  // Numeric and date fields
  const opMap: Record<string, string> = { '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte' };
  const prismaOp = opMap[operator];
  if (prismaOp) {
    return { [column]: { [prismaOp]: scalar } };
  }

  throw new Error(`Unsupported operator: ${operator}`);
}

function compileIn(
  field: string,
  values: Value[],
  negated: boolean,
  registry: FieldRegistry,
  context: QueryContext,
): Record<string, unknown> {
  const fieldDef = registry[field.toLowerCase()];
  if (!fieldDef) {
    const available = Object.keys(registry).join(', ');
    throw new Error(`Unknown field '${field}'. Available fields: ${available}`);
  }

  const column = fieldDef.column;
  const resolved = values.map((v) => resolveValue(v, context));

  if (fieldDef.type === 'enum') {
    const enumValues = fieldDef.values ?? [];
    const normalized = resolved.map((v) => normalizeEnum(field, String(v), enumValues));
    return { [column]: negated ? { notIn: normalized } : { in: normalized } };
  }

  const scalars = resolved.map((v) => columnValue(field, fieldDef, v, false));

  // Relation fields go through their join, as a comparison does
  if (fieldDef.type === 'relation' && fieldDef.join) {
    const parts = column.split('.');
    const subField = parts.length > 1 ? parts[parts.length - 1] : 'name';
    const filter = { in: scalars, mode: 'insensitive' };
    if (fieldDef.many) {
      return { [fieldDef.join]: { [negated ? 'none' : 'some']: { [subField]: filter } } };
    }
    return {
      [fieldDef.join]: {
        [subField]: negated ? { notIn: scalars, mode: 'insensitive' } : filter,
      },
    };
  }

  return { [column]: negated ? { notIn: scalars } : { in: scalars } };
}

/**
 * Compiles an AST Expression to a Prisma where clause object.
 * @param ast
 * @param registry
 * @param context
 */
export function compileToPrisma(
  ast: Expression,
  registry: FieldRegistry,
  context: QueryContext,
): Record<string, unknown> {
  switch (ast.type) {
    case 'comparison':
      return compileComparison(ast.field, ast.operator, ast.value, registry, context);

    case 'in':
      return compileIn(ast.field, ast.values, ast.negated, registry, context);

    case 'and':
      return {
        AND: [
          compileToPrisma(ast.left, registry, context),
          compileToPrisma(ast.right, registry, context),
        ],
      };

    case 'or':
      return {
        OR: [
          compileToPrisma(ast.left, registry, context),
          compileToPrisma(ast.right, registry, context),
        ],
      };

    case 'not':
      return { NOT: compileToPrisma(ast.operand, registry, context) };

    case 'freetext':
      return {};

    default: {
      const _exhaustive: never = ast;
      throw new Error(`Unhandled expression type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
