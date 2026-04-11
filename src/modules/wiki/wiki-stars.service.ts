import { prisma } from '../../config/database';
import { SPACE_URL_SELECT, USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { toggleAssociation } from '../../utils/toggle-association';

/**
 * Toggle a star on a wiki page for a user.
 * If the page is already starred, unstar it; otherwise, star it.
 * @param userId - The user toggling the star
 * @param pageId - The page to star/unstar
 * @returns Object indicating whether the page is now starred
 */
export async function toggleStar(userId: string, pageId: string): Promise<{ starred: boolean }> {
  const starred = await toggleAssociation(
    prisma.starredPage as never,
    { userId_pageId: { userId, pageId } },
    { userId, pageId },
  );
  return { starred };
}

/**
 * Check whether a user has starred a specific page.
 * @param userId - The user to check
 * @param pageId - The page to check
 * @returns True if the page is starred by the user
 */
export async function isStarred(userId: string, pageId: string): Promise<boolean> {
  const record = await prisma.starredPage.findUnique({
    where: { userId_pageId: { userId, pageId } },
  });
  return !!record;
}

/**
 * Get all starred pages for a user, with space context for URL building.
 * @param userId - The user whose starred pages to retrieve
 * @returns Array of starred page records with page and space details
 */
export async function getStarredPages(userId: string) {
  const stars = await prisma.starredPage.findMany({
    where: { userId },
    include: {
      page: {
        select: {
          id: true,
          title: true,
          slug: true,
          spaceId: true,
          space: { select: SPACE_URL_SELECT },
          versions: {
            orderBy: { version: 'desc' as const },
            take: 1,
            include: { author: { select: USER_BASIC_SELECT } },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return stars.map((s) => ({
    id: s.id,
    starredAt: s.createdAt,
    page: s.page,
  }));
}
