import { execSync } from 'child_process';
import fs from 'fs';
import _path from 'path';

import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { parseServicePagination } from '../../utils/pagination';

// ─── Admin Check ────────────────────────────────────────────

/**
 * Check whether a user has platform admin privileges.
 * @param userId - The user ID to check
 * @returns true if the user is an admin, false otherwise
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  return user?.isAdmin === true;
}

// ─── System Stats ───────────────────────────────────────────

function getDirectorySize(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    const output = execSync(`du -sb "${dirPath}" 2>/dev/null | cut -f1`, {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}

function getDatabaseSize(): Promise<string> {
  return prisma.$queryRaw<
    { size: string }[]
  >`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`.then(
    (rows) => rows[0]?.size ?? 'unknown',
  );
}

/**
 *
 */
export async function getSystemStats() {
  const [totalUsers, totalOrgs, totalRepos, totalIssues, totalWikiPages, dbSize] =
    await Promise.all([
      prisma.user.count(),
      prisma.organization.count(),
      prisma.repository.count(),
      prisma.issue.count(),
      prisma.page.count(),
      getDatabaseSize(),
    ]);

  const storagePath = process.env.STORAGE_PATH || '/data/storage';
  const reposSize = getDirectorySize(env.REPOS_PATH);
  const storageSize = getDirectorySize(storagePath);

  return {
    totalUsers,
    totalOrgs,
    totalRepos,
    totalIssues,
    totalWikiPages,
    storage: {
      reposBytes: reposSize,
      storageBytes: storageSize,
      totalBytes: reposSize + storageSize,
    },
    databaseSize: dbSize,
  };
}

// ─── User Management ────────────────────────────────────────

/**
 *
 * @param opts
 * @param opts.search
 * @param opts.limit
 * @param opts.offset
 */
export async function listUsers(opts: { search?: string; limit?: number; offset?: number }) {
  const { take, skip } = parseServicePagination(opts, 50);
  const { search } = opts;

  const where = search
    ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' as const } },
          { displayName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }
    : {};

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
        avatarUrl: true,
        isAdmin: true,
        twoFactorEnabled: true,
        createdAt: true,
        deactivatedAt: true,
        orgMemberships: {
          select: {
            role: true,
            org: { select: { id: true, name: true, slug: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
    prisma.user.count({ where }),
  ]);

  return { users, total };
}

/**
 *
 * @param userId
 */
export async function getUser(userId: string) {
  const user = await prisma.user.findUnique({
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
      deactivatedAt: true,
      orgMemberships: {
        select: {
          role: true,
          org: { select: { id: true, name: true, slug: true } },
        },
      },
      teamMemberships: {
        select: {
          role: true,
          team: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  if (!user) throw new AppError(404, 'User not found');
  return user;
}

/**
 *
 * @param userId
 * @param data
 * @param data.role
 * @param data.disabled
 */
export async function updateUser(userId: string, data: { role?: string; disabled?: boolean }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');

  // Update org membership role if provided
  if (data.role) {
    await prisma.orgMembership.updateMany({
      where: { userId },
      data: { role: data.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST' },
    });
  }

  return getUser(userId);
}

/**
 *
 * @param userId
 */
export async function deleteUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');

  await prisma.user.delete({ where: { id: userId } });
  return { deleted: true };
}

/**
 *
 * @param userId
 */
export async function deactivateUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');
  if (user.isAdmin) throw new AppError(400, 'Cannot deactivate an admin user');

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { deactivatedAt: new Date() } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);
  return { success: true };
}

/**
 *
 * @param userId
 */
export async function reactivateUser(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');

  await prisma.user.update({
    where: { id: userId },
    data: { deactivatedAt: null },
  });
  return { success: true };
}

/**
 *
 * @param userId
 * @param newPassword
 */
export async function resetUserPassword(userId: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(404, 'User not found');

  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);

  return { success: true };
}

// ─── System Settings ────────────────────────────────────────

/**
 *
 */
export function getSystemSettings() {
  return {
    reposPath: env.REPOS_PATH,
    storagePath: process.env.STORAGE_PATH || '/data/storage',
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    corsOrigin: env.CORS_ORIGIN,
    version: '0.1.0-alpha',
  };
}
