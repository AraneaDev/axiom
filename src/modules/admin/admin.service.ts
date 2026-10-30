import { execFileSync } from 'child_process';
import fs from 'fs';
import _path from 'path';

import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { disconnectUser, revokeLiveAccess } from '../../realtime/access-revocation';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { parseServicePagination } from '../../utils/pagination';
import { assertNotLastOwnerTx } from '../orgs/org-roles';

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
    const output = execFileSync('du', ['-sb', dirPath], {
      encoding: 'utf-8',
      timeout: 10_000,
    }).trim();
    // du -sb output format is "SIZE\tPATH" — extract the size field
    const sizeField = output.split('\t')[0];
    return parseInt(sizeField, 10) || 0;
  } catch {
    return 0;
  }
}

function getDatabaseSize(): Promise<string> {
  return prisma.$queryRaw<
    { size: string }[]
  >`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`.then(
    (rows: { size: string }[]) => rows[0]?.size ?? 'unknown',
  );
}

/**
 *
 */
export async function getSystemStats() {
  const [totalUsers, totalOrgs, totalIssues, totalWikiPages, dbSize] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.issue.count(),
    prisma.page.count(),
    getDatabaseSize(),
  ]);

  const storagePath = process.env.STORAGE_PATH || '/data/storage';
  const storageSize = getDirectorySize(storagePath);

  return {
    totalUsers,
    totalOrgs,
    totalIssues,
    totalWikiPages,
    storage: {
      storageBytes: storageSize,
      totalBytes: storageSize,
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
    }),
    ERR.USER_NOT_FOUND,
  );
}

/**
 *
 * @param userId
 * @param data
 * @param data.role
 * @param data.disabled
 */
export async function updateUser(userId: string, data: { role?: string; disabled?: boolean }) {
  await findOrThrow(prisma.user.findUnique({ where: { id: userId } }), ERR.USER_NOT_FOUND);

  // Update org membership role if provided. In every org where the user is the last OWNER,
  // the change is refused: an org must keep an OWNER (checked under the OWNER row lock)
  if (data.role) {
    const role = data.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST';
    await prisma.$transaction(async (tx) => {
      const memberships = await tx.orgMembership.findMany({ where: { userId } });
      for (const m of memberships) {
        if (m.role !== 'OWNER' || role === 'OWNER') continue;
        await tx.$queryRaw`SELECT id FROM org_memberships WHERE "orgId" = ${m.orgId} AND role = 'OWNER' FOR UPDATE`;
        await assertNotLastOwnerTx(tx, m.orgId);
      }
      await tx.orgMembership.updateMany({ where: { userId }, data: { role } });
    });
    // A lower role can lose access: re-check the user's live connections
    void revokeLiveAccess({ userId });
  }

  return getUser(userId);
}

/**
 *
 * @param userId
 */
export async function deleteUser(userId: string) {
  await findOrThrow(prisma.user.findUnique({ where: { id: userId } }), ERR.USER_NOT_FOUND);

  // Deleting the last OWNER of an org would leave it unmanageable: transfer ownership first
  await prisma.$transaction(async (tx) => {
    const owned = await tx.orgMembership.findMany({ where: { userId, role: 'OWNER' } });
    for (const m of owned) {
      await tx.$queryRaw`SELECT id FROM org_memberships WHERE "orgId" = ${m.orgId} AND role = 'OWNER' FOR UPDATE`;
      await assertNotLastOwnerTx(tx, m.orgId);
    }
    await tx.user.delete({ where: { id: userId } });
  });
  // Live sockets authenticated before the delete: close them
  disconnectUser(userId);
  return { deleted: true };
}

/**
 *
 * @param userId
 */
export async function deactivateUser(userId: string) {
  const user = await findOrThrow(
    prisma.user.findUnique({ where: { id: userId } }),
    ERR.USER_NOT_FOUND,
  );
  if (user.isAdmin) throw new AppError(400, 'Cannot deactivate an admin user');

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { deactivatedAt: new Date() } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);
  // Access tokens stay valid until they expire, and open sockets never re-authenticate
  disconnectUser(userId);
  return { success: true };
}

/**
 *
 * @param userId
 */
export async function reactivateUser(userId: string) {
  await findOrThrow(prisma.user.findUnique({ where: { id: userId } }), ERR.USER_NOT_FOUND);

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
  await findOrThrow(prisma.user.findUnique({ where: { id: userId } }), ERR.USER_NOT_FOUND);

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
    storagePath: process.env.STORAGE_PATH || '/data/storage',
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    corsOrigin: env.CORS_ORIGIN,
    version: '0.1.0-alpha',
  };
}
