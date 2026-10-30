/**
 * What an automation `set_field` action may write. An allowlist: plain content fields of the
 * issue, each with its own value parser, and the project's own custom fields
 * (`custom:<name>`). Ids, foreign keys, relations and anything access-related (column,
 * assignee, project, sprint, creator, parent, number) are never writable here: status and
 * assignee changes go through set_status and set_assignee, which carry their checks.
 */
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
const TYPES = ['TASK', 'BUG', 'STORY', 'EPIC'] as const;

function parseOptionalInt(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error('must be a whole number');
  return n;
}

function parseOptionalDate(raw: string): Date | null {
  if (raw.trim() === '') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error('must be a date');
  return d;
}

/** Plain issue fields and how to turn a (template-resolved) string into their value */
const CONTENT_FIELDS: Record<string, (raw: string) => unknown> = {
  title: (raw) => {
    if (!raw.trim()) throw new Error('must not be empty');
    return raw;
  },
  body: (raw) => raw,
  priority: (raw) => {
    if (!(PRIORITIES as readonly string[]).includes(raw)) throw new Error('is not a priority');
    return raw;
  },
  type: (raw) => {
    if (!(TYPES as readonly string[]).includes(raw)) throw new Error('is not an issue type');
    return raw;
  },
  storyPoints: parseOptionalInt,
  timeEstimate: parseOptionalInt,
  dueDate: parseOptionalDate,
  startDate: parseOptionalDate,
};

const CUSTOM_PREFIX = 'custom:';

/**
 * Values that are template expressions can only be checked once resolved, at run time
 * @param value
 */
const isTemplate = (value: string) => value.includes('{{');

/**
 * Check a set_field action when a rule is saved.
 * @param projectId - The rule's project
 * @param field - The action's field
 * @param value - The action's value (may contain {{templates}})
 * @throws {AppError} 400 for a field outside the allowlist or an invalid literal value
 */
export async function assertSettableField(
  projectId: string,
  field: unknown,
  value: unknown,
): Promise<void> {
  if (typeof field !== 'string' || typeof value !== 'string') {
    throw new AppError(400, 'set_field needs a field name and a string value');
  }
  if (field.startsWith(CUSTOM_PREFIX)) {
    await customDefinition(projectId, field.slice(CUSTOM_PREFIX.length));
    return;
  }
  const parse = Object.hasOwn(CONTENT_FIELDS, field) ? CONTENT_FIELDS[field] : undefined;
  if (!parse) {
    throw new AppError(
      400,
      `set_field can't write "${field}": use set_status or set_assignee for those, or one of ${Object.keys(CONTENT_FIELDS).join(', ')} or custom:<name>`,
    );
  }
  if (!isTemplate(value)) {
    try {
      parse(value);
    } catch (err) {
      throw new AppError(400, `set_field ${field} ${(err as Error).message}`);
    }
  }
}

async function customDefinition(projectId: string, name: string) {
  const definition = await prisma.customFieldDefinition.findFirst({
    where: { projectId, name },
    select: { id: true },
  });
  if (!definition) throw new AppError(400, `No custom field "${name}" in this project`);
  return definition;
}

/**
 * Apply a set_field action when a rule runs. Checks again: a rule may predate the
 * allowlist, or a custom field may have been deleted.
 * @param projectId - The issue's project
 * @param issueId - The issue
 * @param field - The action's field
 * @param value - The resolved value
 * @throws {AppError} 400 when the field or value isn't allowed
 */
export async function applySetField(
  projectId: string,
  issueId: string,
  field: string,
  value: string,
): Promise<void> {
  if (field.startsWith(CUSTOM_PREFIX)) {
    const definition = await customDefinition(projectId, field.slice(CUSTOM_PREFIX.length));
    await prisma.customFieldValue.upsert({
      where: { issueId_fieldDefinitionId: { issueId, fieldDefinitionId: definition.id } },
      create: { issueId, fieldDefinitionId: definition.id, value },
      update: { value },
    });
    return;
  }
  const parse = Object.hasOwn(CONTENT_FIELDS, field) ? CONTENT_FIELDS[field] : undefined;
  if (!parse) throw new AppError(400, `set_field can't write "${field}"`);
  let parsed: unknown;
  try {
    parsed = parse(value);
  } catch (err) {
    throw new AppError(400, `set_field ${field} ${(err as Error).message}`);
  }
  await prisma.issue.update({ where: { id: issueId }, data: { [field]: parsed } });
}
