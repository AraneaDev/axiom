import { prisma } from '../../config/database';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';

/**
 * Record a page view, debounced to max 1 per user per page per hour.
 * @param pageId - The page being viewed
 * @param userId - The user viewing the page
 */
export async function recordView(pageId: string, userId: string): Promise<void> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const recent = await prisma.pageView.findFirst({
    where: {
      pageId,
      userId,
      viewedAt: { gte: oneHourAgo },
    },
  });

  if (recent) return;

  await prisma.pageView.create({
    data: { pageId, userId },
  });
}

/**
 * Get the total view count for a page.
 * @param pageId - The page to count views for
 * @returns Total number of views
 */
export async function getViewCount(pageId: string): Promise<number> {
  return prisma.pageView.count({ where: { pageId } });
}

/**
 * Get unique view count for a page.
 * @param pageId - The page to count unique viewers for
 * @returns Number of unique viewers
 */
export async function getUniqueViewerCount(pageId: string): Promise<number> {
  const result = await prisma.pageView.findMany({
    where: { pageId },
    distinct: ['userId'],
    select: { userId: true },
  });
  return result.length;
}

/**
 * Get recent viewers of a page with their last view time.
 * @param pageId - The page to get viewers for
 * @param limit - Maximum number of viewers to return (default 10)
 * @returns Array of recent viewers with user info and view time
 */
export async function getRecentViewers(pageId: string, limit = 10) {
  const views = await prisma.pageView.findMany({
    where: { pageId },
    orderBy: { viewedAt: 'desc' },
    distinct: ['userId'],
    take: limit,
    include: {
      user: { select: USER_BASIC_SELECT },
    },
  });

  return views.map((v) => ({
    user: v.user,
    viewedAt: v.viewedAt,
  }));
}

/**
 * Get full analytics for a page: view count, unique viewers, and recent viewers.
 * @param pageId - The page to get analytics for
 * @returns Combined analytics object
 */
export async function getPageAnalytics(pageId: string) {
  const [viewCount, uniqueViewers, recentViewers] = await Promise.all([
    getViewCount(pageId),
    getUniqueViewerCount(pageId),
    getRecentViewers(pageId),
  ]);

  return { viewCount, uniqueViewers, recentViewers };
}
