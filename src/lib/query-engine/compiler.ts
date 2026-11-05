import type {
  ComparisonOp,
  Expression,
  FieldDefinition,
  FieldRegistry,
  QueryContext,
  Value,
} from './ast';
import { compileCustomField, customFieldName } from './custom-fields';
import { CURRENT_SPRINT_WHERE, derivedField } from './derived-fields';
import { PRIORITY_ORDINALS } from './fields/issue-fields';
import { builtinFunctions } from './functions';
import { likeLiteral, MATCH_NOTHING, NO_USER, QueryValueError } from './query-values';

export { QueryValueError };

/** The range of an integer column. */
const MIN_INT = -2147483648;
const MAX_INT = 2147483647;

/** How deep parentheses and NOT may nest. Past some depth Prisma refuses a where clause outright. */
const MAX_DEPTH = 20;

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
    if (!date || year === undefined || Number.isNaN(year) || year < 1 || year > 9999) {
      throw new QueryValueError(`'${field}' takes a date, such as "2026-01-31"`);
    }
    return date;
  }
  return String(value);
}

/**
 * A field of the registry. Only its own names: `constructor` is no field.
 * @param field - The field as written
 * @param registry - The fields
 * @throws {Error} For an unknown field
 */
function lookupField(field: string, registry: FieldRegistry): FieldDefinition {
  const name = field.toLowerCase();
  if (!Object.hasOwn(registry, name)) {
    const available = Object.keys(registry).join(', ');
    throw new Error(`Unknown field '${field}'. Available fields: ${available}`);
  }
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
  const customName = customFieldName(field);
  const fieldDef = customName === null ? lookupField(field, registry) : null;

  const resolved = resolveValue(value, context);

  // currentUser() without a user: nobody, so equal to nothing and different from everything
  if (resolved === NO_USER) {
    if (operator === '=') return MATCH_NOTHING;
    if (operator === '!=') return {};
    throw new QueryValueError(`'${field}' can't be compared with currentUser() here`);
  }
  if (customName !== null) {
    return compileCustomField(customName, operator as ComparisonOp, resolved, context);
  }
  if (fieldDef === null) throw new Error(`Unknown field '${field}'`);
  const derived = derivedField(field.toLowerCase());
  if (derived) return derived.compile(operator as ComparisonOp, resolved, context);

  if (
    field.toLowerCase() === 'sprint' &&
    value.type === 'function' &&
    value.name.toLowerCase() === 'currentsprint' &&
    (operator === '=' || operator === '!=')
  ) {
    return operator === '=' ? CURRENT_SPRINT_WHERE : { NOT: CURRENT_SPRINT_WHERE };
  }

  // Relation fields (join-based): status, label
  if (fieldDef.type === 'relation' && fieldDef.join) {
    const joinName = fieldDef.join;
    if (resolved === null) {
      if (operator !== '=' && operator !== '!=') {
        throw new QueryValueError(`'${field}' can't be compared with null here`);
      }
      const empty = operator === '=';
      if (fieldDef.many) return { [joinName]: empty ? { none: {} } : { some: {} } };
      return empty ? { [joinName]: null } : { NOT: { [joinName]: null } };
    }
    // Extract the sub-field name from column (e.g. "column.name" -> "name", "labels.name" -> "name")
    const parts = fieldDef.column.split('.');
    const subField = parts.length > 1 ? parts[parts.length - 1] : 'name';
    const strVal = likeLiteral(String(resolved).toLowerCase());
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
    const contains = likeLiteral(String(columnValue(field, fieldDef, resolved, false)));
    return { [column]: { contains, mode: 'insensitive' } };
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
  const customName = customFieldName(field);
  const fieldDef = customName === null ? lookupField(field, registry) : null;
  const all = values.map((v) => resolveValue(v, context));
  // currentUser() without a user is nobody, so no value the list can hold
  const resolved = all.filter((v) => v !== NO_USER);
  if (resolved.length === 0 && all.length > 0) return negated ? {} : MATCH_NOTHING;

  const derived = customName === null ? derivedField(field.toLowerCase()) : undefined;
  if (customName !== null || derived) {
    const one = (operator: ComparisonOp, value: unknown) => {
      if (value === null) throw new QueryValueError(`'${field}' can't hold null in a list`);
      return customName !== null
        ? compileCustomField(customName, operator, value, context)
        : (derived as NonNullable<typeof derived>).compile(operator, value, context);
    };
    return negated
      ? { AND: resolved.map((value) => one('!=', value)) }
      : { OR: resolved.map((value) => one('=', value)) };
  }
  if (fieldDef === null) throw new Error(`Unknown field '${field}'`);

  const column = fieldDef.column;

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
 * The operands of a chain of one operator, in order. `a OR b OR c` parses as a nest, whose depth
 * says nothing about how complex the query is.
 * @param ast - The chain
 * @param type - Its operator
 */
function chainOperands(ast: Expression, type: 'and' | 'or'): Expression[] {
  const operands: Expression[] = [];
  const pending: Expression[] = [ast];
  while (pending.length > 0) {
    const node = pending.pop() as Expression;
    if (node.type === type) pending.push(node.right, node.left);
    else operands.push(node);
  }
  return operands;
}

function compileAt(
  ast: Expression,
  registry: FieldRegistry,
  context: QueryContext,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_DEPTH) {
    throw new QueryValueError(`A query can nest at most ${MAX_DEPTH} levels deep`);
  }
  switch (ast.type) {
    case 'comparison':
      return compileComparison(ast.field, ast.operator, ast.value, registry, context);

    case 'in':
      return compileIn(ast.field, ast.values, ast.negated, registry, context);

    case 'and':
      return {
        AND: chainOperands(ast, 'and').map((operand) =>
          compileAt(operand, registry, context, depth + 1),
        ),
      };

    case 'or':
      return {
        OR: chainOperands(ast, 'or').map((operand) =>
          compileAt(operand, registry, context, depth + 1),
        ),
      };

    case 'not':
      return { NOT: compileAt(ast.operand, registry, context, depth + 1) };

    case 'freetext':
      return {};

    default: {
      const _exhaustive: never = ast;
      throw new Error(`Unhandled expression type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Compiles an AST Expression to a Prisma where clause object.
 * @param ast
 * @param registry
 * @param context
 * @throws {QueryValueError} For a value its field can't take, or nesting past MAX_DEPTH
 */
export function compileToPrisma(
  ast: Expression,
  registry: FieldRegistry,
  context: QueryContext,
): Record<string, unknown> {
  return compileAt(ast, registry, context, 0);
}
