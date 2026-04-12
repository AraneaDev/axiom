import type { Expression, Value, FieldRegistry, QueryContext } from './ast';
import { PRIORITY_ORDINALS } from './fields/issue-fields';
import { builtinFunctions } from './functions';

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

function normalizeEnum(val: string, values: string[]): string {
  const upper = val.toUpperCase();
  const match = values.find((v) => v.toUpperCase() === upper);
  return match ?? upper;
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

    const rawVal = resolved != null ? String(resolved) : '';
    const normalized = normalizeEnum(rawVal, enumValues);

    if (operator === '=') return { [column]: normalized };
    if (operator === '!=') return { [column]: { not: normalized } };
  }

  // User fields
  if (fieldDef.type === 'user') {
    if (resolved === null) {
      if (operator === '=') return { [column]: null };
      if (operator === '!=') return { [column]: { not: null } };
    }
    // When the value came from a function (e.g. currentUser()), resolved is the userId
    if (value.type === 'function') {
      if (operator === '=') return { [column]: resolved };
      if (operator === '!=') return { [column]: { not: resolved } };
    }
    // String value - use aliasField for username lookup if available
    if (operator === '=') return { [column]: resolved };
    if (operator === '!=') return { [column]: { not: resolved } };
  }

  // Numeric and date fields
  const opMap: Record<string, string> = {
    '=': 'equals',
    '!=': 'not',
    '>': 'gt',
    '<': 'lt',
    '>=': 'gte',
    '<=': 'lte',
  };

  // Contains operator
  if (operator === '~') {
    return { [column]: { contains: resolved, mode: 'insensitive' } };
  }

  if (operator === '=') {
    return { [column]: resolved };
  }
  if (operator === '!=') {
    return { [column]: { not: resolved } };
  }

  const prismaOp = opMap[operator];
  if (prismaOp) {
    return { [column]: { [prismaOp]: resolved } };
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
    const normalized = resolved.map((v) => normalizeEnum(String(v), enumValues));
    return { [column]: negated ? { notIn: normalized } : { in: normalized } };
  }

  return { [column]: negated ? { notIn: resolved } : { in: resolved } };
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
