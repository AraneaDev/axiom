import { prisma } from '../../config/database';
import { findOrThrow } from '../../utils/find-or-throw';

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
 * @returns List of template records ordered by creation date
 */
export async function listTemplates(spaceId: string) {
  return prisma.pageTemplate.findMany({
    where: { spaceId },
    orderBy: { createdAt: 'desc' },
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
 * @throws {AppError} 404 if template not found
 */
export async function deleteTemplate(id: string) {
  await findOrThrow(prisma.pageTemplate.findUnique({ where: { id } }), 'Template not found');
  await prisma.pageTemplate.delete({ where: { id } });
}
