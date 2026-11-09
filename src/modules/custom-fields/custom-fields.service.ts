import { prisma } from '../../config/database';
import { typedCustomFieldValue } from '../../lib/query-engine';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { emitIssueEvents } from '../bot-events/emit';

import { assertCustomFieldValue } from './custom-field-values';

// ─── Field Definitions ──────────────────────────────────────

/**
 *
 * @param projectId
 * @param data
 * @param data.name
 * @param data.type
 * @param data.options
 * @param data.required
 * @param data.position
 */
export async function createFieldDefinition(
  projectId: string,
  data: {
    name: string;
    type: string;
    options?: unknown;
    required?: boolean;
    position?: number;
  },
) {
  const validTypes = ['TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTI_SELECT', 'USER'];
  if (!validTypes.includes(data.type)) {
    throw new AppError(
      400,
      `Invalid field type: ${data.type}. Must be one of: ${validTypes.join(', ')}`,
    );
  }

  if ((data.type === 'SELECT' || data.type === 'MULTI_SELECT') && !data.options) {
    throw new AppError(400, 'SELECT and MULTI_SELECT fields require options');
  }

  // Auto-assign position if not provided
  let position = data.position;
  if (position === undefined) {
    const last = await prisma.customFieldDefinition.findFirst({
      where: { projectId },
      orderBy: { position: 'desc' },
    });
    position = (last?.position ?? -1) + 1;
  }

  return prisma.customFieldDefinition.create({
    data: {
      projectId,
      name: data.name,
      type: data.type,
      options: data.options ?? undefined,
      required: data.required ?? false,
      position,
    },
  });
}

/**
 *
 * @param projectId
 */
export async function listFieldDefinitions(projectId: string) {
  return prisma.customFieldDefinition.findMany({
    where: { projectId },
    orderBy: { position: 'asc' },
  });
}

/**
 *
 * @param fieldId
 * @param data
 * @param data.name
 * @param data.options
 * @param data.required
 * @param data.position
 */
export async function updateFieldDefinition(
  fieldId: string,
  data: {
    name?: string;
    options?: unknown;
    required?: boolean;
    position?: number;
  },
) {
  await findOrThrow(
    prisma.customFieldDefinition.findUnique({ where: { id: fieldId } }),
    'Custom field definition not found',
  );

  return prisma.customFieldDefinition.update({
    where: { id: fieldId },
    data: {
      name: data.name,
      options: data.options ?? undefined,
      required: data.required,
      position: data.position,
    },
  });
}

/**
 *
 * @param fieldId
 */
export async function deleteFieldDefinition(fieldId: string) {
  await findOrThrow(
    prisma.customFieldDefinition.findUnique({ where: { id: fieldId } }),
    'Custom field definition not found',
  );

  // Cascade delete is handled by Prisma schema, but let's be explicit
  await prisma.customFieldValue.deleteMany({ where: { fieldDefinitionId: fieldId } });
  return prisma.customFieldDefinition.delete({ where: { id: fieldId } });
}

// ─── Field Values ───────────────────────────────────────────

/**
 *
 * @param issueId
 * @param fieldDefinitionId
 * @param value
 */
export async function setFieldValue(issueId: string, fieldDefinitionId: string, value: string) {
  const definition = await findOrThrow(
    prisma.customFieldDefinition.findUnique({
      where: { id: fieldDefinitionId },
    }),
    'Custom field definition not found',
  );
  // A project's fields only apply to its own issues
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { projectId: true },
  });
  if (issue?.projectId !== definition.projectId) {
    throw new AppError(400, 'The custom field does not belong to the project of this issue');
  }
  await assertCustomFieldValue(definition, value);

  const saved = await prisma.customFieldValue.upsert({
    where: {
      issueId_fieldDefinitionId: { issueId, fieldDefinitionId },
    },
    create: { issueId, fieldDefinitionId, ...typedCustomFieldValue(value) },
    update: typedCustomFieldValue(value),
    include: { fieldDefinition: true },
  });
  // A custom field's name is the project's own text: the event names the kind, not the field
  await emitIssueEvents({ issueId, changedFields: ['customFields'] });
  return saved;
}

/**
 *
 * @param issueId
 */
export async function getFieldValues(issueId: string) {
  return prisma.customFieldValue.findMany({
    where: { issueId },
    include: { fieldDefinition: true },
  });
}

/**
 *
 * @param issueIds
 */
export async function getFieldValuesForIssues(issueIds: string[]) {
  return prisma.customFieldValue.findMany({
    where: { issueId: { in: issueIds } },
    include: { fieldDefinition: true },
  });
}

/**
 * The project a field definition belongs to, for the checks that address it by its own id.
 * @param fieldId - The definition
 */
export async function fieldProjectId(fieldId: string): Promise<string | undefined> {
  const row = await prisma.customFieldDefinition.findUnique({
    where: { id: fieldId },
    select: { projectId: true },
  });
  return row?.projectId;
}
