import { type Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { findOrThrow } from '../../utils/find-or-throw';

/**
 * Create a saved filter for a user, optionally scoped to a project.
 * @param userId - The user ID
 * @param data - Filter creation data including name, query JSON, and optional projectId
 * @param data.name
 * @param data.query
 * @param data.projectId
 * @returns The created saved filter record
 */
export async function create(
  userId: string,
  data: { name: string; query: Prisma.InputJsonValue; projectId?: string },
) {
  return prisma.savedFilter.create({
    data: {
      userId,
      name: data.name,
      query: data.query,
      projectId: data.projectId ?? null,
    },
  });
}

/**
 * List saved filters for a user, optionally scoped to a project.
 * @param userId - The user ID
 * @param projectId - Optional project ID to scope results
 * @returns List of saved filter records
 */
export async function list(userId: string, projectId?: string) {
  return prisma.savedFilter.findMany({
    where: {
      userId,
      ...(projectId ? { projectId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/**
 * Update a saved filter's name or query.
 * @param userId - The user ID (ownership check)
 * @param filterId - The saved filter ID
 * @param data - Partial update data for name and/or query
 * @param data.name
 * @param data.query
 * @returns The updated saved filter record
 * @throws {AppError} 404 if saved filter not found
 */
export async function update(
  userId: string,
  filterId: string,
  data: { name?: string; query?: Prisma.InputJsonValue },
) {
  await findOrThrow(
    prisma.savedFilter.findFirst({ where: { id: filterId, userId } }),
    'Saved filter not found',
  );

  return prisma.savedFilter.update({
    where: { id: filterId },
    data,
  });
}

/**
 * Delete a saved filter.
 * @param userId - The user ID (ownership check)
 * @param filterId - The saved filter ID
 * @throws {AppError} 404 if saved filter not found
 */
export async function remove(userId: string, filterId: string) {
  await findOrThrow(
    prisma.savedFilter.findFirst({ where: { id: filterId, userId } }),
    'Saved filter not found',
  );

  await prisma.savedFilter.delete({ where: { id: filterId } });
}
