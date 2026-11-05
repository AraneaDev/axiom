import crypto from 'crypto';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { isMintableScope } from '../../middleware/token-scopes';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { parseServicePagination } from '../../utils/pagination';
import {
  TEAM_ORG_INCLUDE,
  TEAM_ORG_SELECT,
  USER_WITH_AVATAR_SELECT,
} from '../../utils/prisma-selects';

// ─── Profile ────────────────────────────────────────────────

/**
 * Get a user's profile information.
 * @param userId - The user ID
 * @returns User profile with email, username, display name, avatar, 2FA status, and creation date
 * @throws {AppError} 404 if user not found
 */
export async function getProfile(userId: string) {
  return findOrThrow(
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        isAdmin: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    }),
    ERR.USER_NOT_FOUND,
  );
}

/**
 * Update a user's display name or avatar URL.
 * @param userId - The user ID
 * @param data - Partial update data for displayName and/or avatarUrl
 * @param data.displayName
 * @param data.avatarUrl
 * @returns The updated user profile
 */
export async function updateProfile(
  userId: string,
  data: { displayName?: string; avatarUrl?: string | null },
) {
  return prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, username: true, displayName: true, avatarUrl: true },
  });
}

/**
 * Search users by username or display name (case-insensitive).
 * @param query - The search string to match against username or display name
 * @param searcherId - Who is searching
 * @param limit - Maximum number of results to return (defaults to 10)
 * @returns List of matching users with basic profile info
 */
export async function searchUsers(query: string, searcherId: string, limit = 10) {
  const { take } = parseServicePagination({ limit });
  return prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
      ],
      // Only people the searcher shares an org with: no directory of every user
      orgMemberships: { some: { org: { members: { some: { userId: searcherId } } } } },
    },
    select: USER_WITH_AVATAR_SELECT,
    take,
    orderBy: { username: 'asc' },
  });
}

// ─── Dashboard ──────────────────────────────────────────────

/**
 * Get aggregated dashboard data for the current user including assigned issues, recent activity, and upcoming due dates.
 * @param userId - The user ID
 * @returns Dashboard data with assignedIssues, recentActivity, and upcomingDueDates
 */
export async function getDashboard(userId: string) {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [assignedIssues, recentActivity, upcomingDueDates] = await Promise.all([
    // Open issues assigned to user across all projects
    prisma.issue.findMany({
      where: {
        assigneeId: userId,
        OR: [{ column: { isDone: false } }, { columnId: null }],
      },
      include: {
        project: { include: TEAM_ORG_INCLUDE },
        column: { select: { id: true, name: true, isDone: true } },
        assignee: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),

    // Recent activity for user
    prisma.activity.findMany({
      where: { userId },
      include: {
        user: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),

    // Issues with due dates in next 7 days
    prisma.issue.findMany({
      where: {
        assigneeId: userId,
        dueDate: { lte: sevenDaysFromNow },
        OR: [{ column: { isDone: false } }, { columnId: null }],
      },
      include: {
        project: { include: TEAM_ORG_INCLUDE },
        column: { select: { id: true, name: true, isDone: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
    }),
  ]);

  // Hydrate activities with resource titles and links
  type RecentActivity = (typeof recentActivity)[number];
  const issueActivityIds = recentActivity
    .filter((a: RecentActivity) => a.resourceType === 'issue')
    .map((a: RecentActivity) => a.resourceId);
  const wikiActivityIds = recentActivity
    .filter((a: RecentActivity) => a.resourceType === 'wiki_page')
    .map((a: RecentActivity) => a.resourceId);

  const teamOrgSelect = TEAM_ORG_SELECT;

  const issueSelect = {
    id: true,
    number: true,
    title: true,
    project: { select: { slug: true, prefix: true, team: { select: teamOrgSelect } } },
  } as const;
  type IssueResult = Awaited<
    ReturnType<typeof prisma.issue.findMany<{ select: typeof issueSelect }>>
  >[number];

  const activityIssues: IssueResult[] =
    issueActivityIds.length > 0
      ? await prisma.issue.findMany({
          where: { id: { in: issueActivityIds } },
          select: issueSelect,
        })
      : [];

  const wikiSelect = {
    id: true,
    title: true,
    slug: true,
    space: { select: { slug: true, team: { select: teamOrgSelect } } },
  } as const;
  type WikiResult = Awaited<
    ReturnType<typeof prisma.page.findMany<{ select: typeof wikiSelect }>>
  >[number];

  const activityWikiPages: WikiResult[] =
    wikiActivityIds.length > 0
      ? await prisma.page.findMany({
          where: { id: { in: wikiActivityIds } },
          select: wikiSelect,
        })
      : [];

  const issueMap = new Map(
    activityIssues.map((i: (typeof activityIssues)[number]) => [i.id, i] as const),
  );
  const wikiMap = new Map(
    activityWikiPages.map((w: (typeof activityWikiPages)[number]) => [w.id, w] as const),
  );

  const enrichedActivity = recentActivity.map((a: RecentActivity) => {
    let resourceTitle: string | null = null;
    let resourceLink: string | null = null;
    let resourceKey: string | null = null;

    if (a.resourceType === 'issue') {
      const issue = issueMap.get(a.resourceId);
      if (issue) {
        resourceTitle = issue.title;
        resourceKey = `${issue.project.prefix}-${issue.number}`;
        resourceLink = `/${issue.project.team.org.slug}/${issue.project.team.slug}/${issue.project.slug}/issues/${issue.number}`;
      }
    } else if (a.resourceType === 'wiki_page') {
      const page = wikiMap.get(a.resourceId);
      if (page) {
        resourceTitle = page.title;
        resourceLink = `/${page.space.team.org.slug}/${page.space.team.slug}/wiki/${page.space.slug}/${page.slug}`;
      }
    }

    return { ...a, resourceTitle, resourceLink, resourceKey };
  });

  // ── 7-day trend sparklines ──────────────────────────────────
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Build an array of day-start boundaries for the past 7 days (index 0 = oldest)
  const dayBoundaries = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sevenDaysAgo.getTime() + i * 24 * 60 * 60 * 1000);
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const dayEnd = (i: number) =>
    i < 6 ? dayBoundaries[i + 1] : new Date(dayBoundaries[6].getTime() + 24 * 60 * 60 * 1000);

  const [trendIssues, trendDueDates, trendActivity] = await Promise.all([
    // Issues created (assigned to user) per day
    prisma.issue.findMany({
      where: { assigneeId: userId, createdAt: { gte: sevenDaysAgo } },
      select: { createdAt: true },
    }),
    // Issues that became due per day
    prisma.issue.findMany({
      where: {
        assigneeId: userId,
        dueDate: { gte: sevenDaysAgo, lte: sevenDaysFromNow },
      },
      select: { dueDate: true },
    }),
    // Activity events per day
    prisma.activity.findMany({
      where: { userId, createdAt: { gte: sevenDaysAgo } },
      select: { createdAt: true },
    }),
  ]);

  function bucketByDay(dates: Date[]): number[] {
    return dayBoundaries.map((_, i) => {
      const start = dayBoundaries[i];
      const end = dayEnd(i);
      return dates.filter((d) => d >= start && d < end).length;
    });
  }

  const trends = {
    assignedIssues: bucketByDay(trendIssues.map((i) => new Date(i.createdAt))),
    upcomingDueDates: bucketByDay(
      trendDueDates.filter((i) => i.dueDate != null).map((i) => new Date(i.dueDate!)),
    ),
    recentActivity: bucketByDay(trendActivity.map((a) => new Date(a.createdAt))),
  };

  return {
    assignedIssues,
    recentActivity: enrichedActivity,
    upcomingDueDates,
    trends,
  };
}

// ─── API Tokens ─────────────────────────────────────────────

/**
 * List all API tokens for a user (token values are never returned).
 * @param userId - The user ID
 * @returns List of API token metadata including name, prefix, scopes, and timestamps
 */
export async function listApiTokens(userId: string) {
  return prisma.apiToken.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Create a new API token. The raw token is returned only on creation and never stored.
 * @param userId - The user ID
 * @param data - Token creation data including name, scopes, and optional expiry in days
 * @param data.name
 * @param data.scopes
 * @param data.expiresInDays
 * @returns The created token metadata plus the raw token string (one-time only)
 */
export async function createApiToken(
  userId: string,
  data: {
    name: string;
    scopes: string[];
    expiresInDays?: number;
  },
) {
  if (!data.scopes.every(isMintableScope)) {
    throw new AppError(400, 'Unknown token scope, or one no action uses yet');
  }

  // Generate token: tk_ prefix + 48 random bytes
  const rawToken = `tk_${crypto.randomBytes(48).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const prefix = rawToken.slice(0, 11); // "tk_" + first 8 hex chars

  const token = await prisma.apiToken.create({
    data: {
      userId,
      name: data.name,
      tokenHash,
      prefix,
      scopes: data.scopes,
      expiresAt: data.expiresInDays
        ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
        : null,
    },
    select: { id: true, name: true, prefix: true, scopes: true, createdAt: true, expiresAt: true },
  });

  // Return the raw token ONLY on creation — it's never stored or retrievable again
  return { ...token, token: rawToken };
}

/**
 * Delete an API token belonging to a user.
 * @param userId - The user ID
 * @param tokenId - The API token ID to delete
 * @throws {AppError} 404 if API token not found
 */
export async function deleteApiToken(userId: string, tokenId: string) {
  await findOrThrow(
    prisma.apiToken.findFirst({ where: { id: tokenId, userId } }),
    'API token not found',
  );
  await prisma.apiToken.delete({ where: { id: tokenId } });
}
