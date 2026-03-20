import crypto from 'crypto';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';

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
        twoFactorEnabled: true,
        createdAt: true,
      },
    }),
    'User not found',
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
  data: { displayName?: string; avatarUrl?: string },
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
 * @param limit - Maximum number of results to return (defaults to 10)
 * @returns List of matching users with basic profile info
 */
export async function searchUsers(query: string, limit = 10) {
  return prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
      ],
    },
    select: USER_WITH_AVATAR_SELECT,
    take: limit,
    orderBy: { username: 'asc' },
  });
}

// ─── Dashboard ──────────────────────────────────────────────

/**
 * Get aggregated dashboard data for the current user including assigned issues, review requests, and upcoming due dates.
 * @param userId - The user ID
 * @returns Dashboard data with assignedIssues, reviewRequests, recentActivity, and upcomingDueDates
 */
export async function getDashboard(userId: string) {
  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [assignedIssues, reviewRequests, recentActivity, upcomingDueDates] = await Promise.all([
    // Open issues assigned to user across all projects
    prisma.issue.findMany({
      where: {
        assigneeId: userId,
        OR: [{ column: { isDone: false } }, { columnId: null }],
      },
      include: {
        project: { include: { team: { include: { org: true } } } },
        column: { select: { id: true, name: true, isDone: true } },
        assignee: { select: { id: true, displayName: true, username: true, avatarUrl: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),

    // Open PRs where user is a reviewer
    prisma.pullRequest.findMany({
      where: {
        reviews: { some: { reviewerId: userId } },
        status: 'OPEN',
      },
      include: {
        repo: {
          select: {
            id: true,
            name: true,
            slug: true,
            team: { select: { slug: true, org: { select: { slug: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
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
        project: { include: { team: { include: { org: true } } } },
        column: { select: { id: true, name: true, isDone: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 20,
    }),
  ]);

  // Fetch author info for PRs separately since PullRequest has no author relation
  const authorIds = [...new Set(reviewRequests.map((pr) => pr.authorId))];
  const authors =
    authorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, displayName: true, username: true, avatarUrl: true },
        })
      : [];
  const authorMap = new Map(authors.map((a) => [a.id, a]));

  const reviewRequestsWithAuthors = reviewRequests.map((pr) => ({
    ...pr,
    author: authorMap.get(pr.authorId) ?? {
      id: pr.authorId,
      displayName: 'Unknown',
      username: 'unknown',
      avatarUrl: null,
    },
  }));

  return {
    assignedIssues,
    reviewRequests: reviewRequestsWithAuthors,
    recentActivity,
    upcomingDueDates,
  };
}

// ─── SSH Keys ───────────────────────────────────────────────

function parseAndFingerprintKey(publicKey: string): string {
  // Extract the key data (second field of "type base64data comment")
  const parts = publicKey.trim().split(/\s+/);
  if (parts.length < 2) throw new AppError(400, 'Invalid SSH public key format');

  const keyData = Buffer.from(parts[1], 'base64');
  const hash = crypto.createHash('sha256').update(keyData).digest('base64');
  return `SHA256:${hash.replace(/=+$/, '')}`;
}

/**
 * List all SSH keys for a user.
 * @param userId - The user ID
 * @returns List of SSH keys with id, title, fingerprint, and timestamps
 */
export async function listSshKeys(userId: string) {
  return prisma.sshKey.findMany({
    where: { userId },
    select: { id: true, title: true, fingerprint: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Add an SSH public key to a user's account after computing its fingerprint.
 * @param userId - The user ID
 * @param data - SSH key data including title and public key string
 * @param data.title
 * @param data.publicKey
 * @returns The created SSH key record
 * @throws {AppError} 409 if SSH key fingerprint already registered
 * @throws {AppError} 400 if public key format is invalid
 */
export async function addSshKey(userId: string, data: { title: string; publicKey: string }) {
  const fingerprint = parseAndFingerprintKey(data.publicKey);

  const existing = await prisma.sshKey.findUnique({ where: { fingerprint } });
  if (existing) throw new AppError(409, 'SSH key already registered');

  return prisma.sshKey.create({
    data: {
      userId,
      title: data.title,
      publicKey: data.publicKey.trim(),
      fingerprint,
    },
    select: { id: true, title: true, fingerprint: true, createdAt: true },
  });
}

/**
 * Delete an SSH key belonging to a user.
 * @param userId - The user ID
 * @param keyId - The SSH key ID to delete
 * @throws {AppError} 404 if SSH key not found
 */
export async function deleteSshKey(userId: string, keyId: string) {
  await findOrThrow(prisma.sshKey.findFirst({ where: { id: keyId, userId } }), 'SSH key not found');
  await prisma.sshKey.delete({ where: { id: keyId } });
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
