import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';

// ─── Accessible Spaces (for search filter UI) ───────────────

/**
 * Get all wiki spaces the user can access (via org membership).
 * @param orgIds - Organization IDs the user belongs to
 * @returns List of spaces with id, name, and slug
 */
export async function getAccessibleSpaces(orgIds: string[]) {
  if (!orgIds.length) return [];
  return prisma.wikiSpace.findMany({
    where: {
      isArchived: false,
      team: { orgId: { in: orgIds } },
    },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });
}

// ─── Saved Searches ─────────────────────────────────────────

/**
 * Create a global saved search for a user.
 * @param userId - The user ID
 * @param data - Saved search data including name and query object
 * @param data.name
 * @param data.query
 * @returns The created saved search record
 */
export async function createSavedSearch(
  userId: string,
  data: { name: string; query: Record<string, unknown> },
) {
  return prisma.savedFilter.create({
    data: {
      userId,
      name: data.name,
      query: data.query as Prisma.InputJsonValue,
      // projectId is null for global saved searches
    },
  });
}

/**
 * Get all global saved searches for a user.
 * @param userId - The user ID
 * @returns List of saved search records ordered by creation date
 */
export async function getSavedSearches(userId: string) {
  return prisma.savedFilter.findMany({
    where: {
      userId,
      projectId: null, // global saved searches only
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

/**
 * Delete a global saved search belonging to a user.
 * @param id - The saved search ID
 * @param userId - The user ID (ownership check)
 * @returns Delete result
 */
export async function deleteSavedSearch(id: string, userId: string) {
  return prisma.savedFilter.deleteMany({
    where: { id, userId, projectId: null },
  });
}
