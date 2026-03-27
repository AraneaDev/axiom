import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';

import { builtInBlueprints } from './blueprints';

/**
 * Create a page template in a wiki space.
 * @param spaceId - The wiki space ID
 * @param data - Template data including name, body, and optional description
 * @param data.name
 * @param data.body
 * @param data.description
 * @returns The created template record
 */
export async function createTemplate(
  spaceId: string,
  data: { name: string; body: string; description?: string },
) {
  return prisma.pageTemplate.create({
    data: { spaceId, ...data },
  });
}

/**
 * List all page templates in a wiki space.
 * @param spaceId - The wiki space ID
 * @returns List of template records ordered by built-in first, then creation date
 */
export async function listTemplates(spaceId: string) {
  return prisma.pageTemplate.findMany({
    where: { spaceId },
    orderBy: [{ isBuiltIn: 'desc' }, { createdAt: 'desc' }],
  });
}

/**
 * Retrieve a page template by ID.
 * @param id - The template ID
 * @returns The template record
 * @throws {AppError} 404 if template not found
 */
export async function getTemplate(id: string) {
  return findOrThrow(prisma.pageTemplate.findUnique({ where: { id } }), 'Template not found');
}

/**
 * Delete a page template by ID.
 * @param id - The template ID
 * @throws {AppError} 403 if template is built-in
 * @throws {AppError} 404 if template not found
 */
export async function deleteTemplate(id: string) {
  const template = await findOrThrow(
    prisma.pageTemplate.findUnique({ where: { id } }),
    'Template not found',
  );
  if (template.isBuiltIn) {
    throw new AppError(403, 'Built-in templates cannot be deleted');
  }
  await prisma.pageTemplate.delete({ where: { id } });
}

/**
 * Seed built-in page blueprints into a wiki space.
 * Idempotent -- skips templates that already exist by name.
 * @param spaceId - The wiki space ID to seed templates into
 */
export async function seedBuiltInTemplates(spaceId: string) {
  const existing = await prisma.pageTemplate.findMany({
    where: { spaceId, isBuiltIn: true },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((t) => t.name));

  const toCreate = builtInBlueprints.filter((bp) => !existingNames.has(bp.name));
  if (toCreate.length === 0) return;

  await prisma.pageTemplate.createMany({
    data: toCreate.map((bp) => ({
      spaceId,
      name: bp.name,
      body: bp.body,
      description: bp.description,
      isBuiltIn: true,
    })),
  });
}
