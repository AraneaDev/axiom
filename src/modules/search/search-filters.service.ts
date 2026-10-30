import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';

import { viewableSpaces } from './search-access';

// ─── Accessible Spaces (for search filter UI) ───────────────

/**
 * Wiki spaces the user may view, for the search filter: in their orgs and passing the
 * space's own permissions.
 * @param userId - The user
 * @returns List of spaces with id, name, and slug
 */
export async function getAccessibleSpaces(userId: string) {
  return viewableSpaces(userId, { includeArchived: false });
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
