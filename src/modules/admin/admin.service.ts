import { execFileSync } from 'child_process';
import fs from 'fs';
import _path from 'path';

import type { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { env } from '../../config/env';
import { AppError } from '../../middleware/errorHandler';
import { disconnectUser, revokeLiveAccess } from '../../realtime/access-revocation';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { logger } from '../../utils/logger';
import { parseServicePagination } from '../../utils/pagination';
import { logAudit } from '../audit/audit.service';
import { disconnect as disconnectGithub } from '../github/github-account.service';
import { isIntegrationUser } from '../github/integration-user';
import { assertNotLastOwnerTx } from '../orgs/org-roles';
import { onOrgRoleChanged, onOwnershipLapseEverywhere } from '../service-accounts/bot-guards';

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

/**
 * The built-in GitHub user is shown but never changed: no role, password, deactivation or delete.
 * @param userId - The user the admin acts on
 * @throws {AppError} 400 for the integration user
 */
function assertNotIntegrationUser(userId: string) {
  if (isIntegrationUser(userId)) {
    throw new AppError(400, 'The GitHub integration user is built in and cannot be changed');
  }
}

/**
 * A service account is managed from its org's service accounts: its org role is fixed, it has no
 * password or 2FA, and deleting it there keeps its past activity. The platform admin pages only
 * deactivate and reactivate it.
 * @param user - The user the admin acts on
 * @param user.kind - Its kind
 * @throws {AppError} 400 for a service account
 */
function assertNotServiceAccount(user: { kind: string }) {
  if (user.kind === 'SERVICE') {
    throw new AppError(
      400,
      "A service account is managed from its organization's service accounts",
      'SERVICE_ACCOUNT_MANAGED_BY_ORG',
    );
  }
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
    prisma.user.count({ where: { kind: 'PERSON' } }),
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
        kind: true,
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
        kind: true,
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
  assertNotIntegrationUser(userId);
  assertNotServiceAccount(
    await findOrThrow(prisma.user.findUnique({ where: { id: userId } }), ERR.USER_NOT_FOUND),
  );

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
    // In each org: below MEMBER their bots lose them as an owner, and any change can leave a
    // bot's place without its owner
    const orgs = await prisma.orgMembership.findMany({
      where: { userId },
      select: { orgId: true },
    });
    for (const { orgId } of orgs) await onOrgRoleChanged(userId, orgId, role);
  }

  return getUser(userId);
}

/**
 *
 * @param userId
 */
export async function deleteUser(userId: string) {
  assertNotIntegrationUser(userId);
  assertNotServiceAccount(
    await findOrThrow(prisma.user.findUnique({ where: { id: userId } }), ERR.USER_NOT_FOUND),
  );

  // Deleting the last OWNER of an org would leave it unmanageable: transfer ownership first
  const guardLastOwner = async (tx: Prisma.TransactionClient) => {
    const owned = await tx.orgMembership.findMany({ where: { userId, role: 'OWNER' } });
    for (const m of owned) {
      await tx.$queryRaw`SELECT id FROM org_memberships WHERE "orgId" = ${m.orgId} AND role = 'OWNER' FOR UPDATE`;
      await assertNotLastOwnerTx(tx, m.orgId);
    }
  };
  await prisma.$transaction(guardLastOwner);
  // Their bots lose them as an owner before the cascade drops the owner rows unseen: orphans are
  // suspended, the other bots leave the places only this user was in
  await onOwnershipLapseEverywhere(userId);
  // The row cascades with the user, and the grant at GitHub would outlive it: revoked first, on
  // a best-effort basis, and only for a delete that is going to happen
  try {
    await disconnectGithub(userId);
  } catch (err) {
    logger.warn('github grant not revoked on user delete', {
      code: err instanceof AppError ? err.code : undefined,
    });
  }
  await prisma.$transaction(async (tx) => {
    await guardLastOwner(tx);
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
  assertNotIntegrationUser(userId);
  const user = await findOrThrow(
    prisma.user.findUnique({ where: { id: userId } }),
    ERR.USER_NOT_FOUND,
  );
  if (user.isAdmin) throw new AppError(400, 'Cannot deactivate an admin user');
  // A bot has one off switch, its suspension, which its owners and org admins can see and undo
  if (user.kind === 'SERVICE') {
    throw new AppError(
      400,
      'Suspend a service account from its organization instead of deactivating it',
      'SERVICE_ACCOUNT_USE_SUSPEND',
    );
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { deactivatedAt: new Date() } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);
  // Access tokens stay valid until they expire, and open sockets never re-authenticate
  disconnectUser(userId);
  // A deactivated person owns no bot: orphans are suspended, the other bots leave the places
  // only this user was in
  await onOwnershipLapseEverywhere(userId);
  return { success: true };
}

/**
 *
 * @param userId
 */
export async function reactivateUser(userId: string) {
  assertNotIntegrationUser(userId);
  // Only a deleted bot is deactivated (deactivateUser refuses bots): reactivating it would bring
  // back a user with no service account, owners or org
  assertNotServiceAccount(
    await findOrThrow(prisma.user.findUnique({ where: { id: userId } }), ERR.USER_NOT_FOUND),
  );

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
  assertNotIntegrationUser(userId);
  assertNotServiceAccount(
    await findOrThrow(prisma.user.findUnique({ where: { id: userId } }), ERR.USER_NOT_FOUND),
  );

  const bcrypt = await import('bcryptjs');
  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);

  return { success: true };
}

/**
 * Turn off a user's 2FA, for someone locked out of their authenticator. Clears the secret, the flag
 * and the last accepted step, and ends every session of that user (refresh tokens and open
 * sockets), so they sign in again and set 2FA up anew. Your own 2FA is not reset this way: you
 * turn it off with a code.
 * @param actorId - The platform admin doing it, named in the audit row
 * @param userId - The user whose 2FA is reset
 * @returns Success
 * @throws {AppError} 400 if the admin targets their own account
 * @throws {AppError} 404 if the user does not exist
 */
export async function resetUserTwoFactor(actorId: string, userId: string) {
  assertNotIntegrationUser(userId);
  if (actorId === userId) {
    throw new AppError(
      400,
      "You can't reset your own 2FA: use the normal disable with a code from your authenticator in your account settings",
    );
  }
  assertNotServiceAccount(
    await findOrThrow(prisma.user.findUnique({ where: { id: userId } }), ERR.USER_NOT_FOUND),
  );

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorLastStep: null },
    }),
    prisma.refreshToken.deleteMany({ where: { userId } }),
  ]);
  // Access tokens stay valid until they expire, and open sockets never re-authenticate
  disconnectUser(userId);
  await logAudit({
    userId: actorId,
    action: '2fa_reset',
    resourceType: 'user',
    resourceId: userId,
  });

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
