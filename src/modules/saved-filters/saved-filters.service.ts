import { type Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { findOrThrow } from '../../utils/find-or-throw';

/**
 * Create a saved filter for a user.
 * @param userId
 * @param data
 * @param data.name
 * @param data.query
 * @param data.projectId
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
 * @param userId
 * @param projectId
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
 * Update a saved filter (name or query).
 * @param userId
 * @param filterId
 * @param data
 * @param data.name
 * @param data.query
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
 * @param userId
 * @param filterId
 */
export async function remove(userId: string, filterId: string) {
  await findOrThrow(
    prisma.savedFilter.findFirst({ where: { id: filterId, userId } }),
    'Saved filter not found',
  );

  await prisma.savedFilter.delete({ where: { id: filterId } });
}
