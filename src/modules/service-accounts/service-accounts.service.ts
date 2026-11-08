import crypto from 'crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { isMintableScope } from '../../middleware/token-scopes';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { cancelPendingFor } from '../agent-approvals/agent-approvals.cleanup';
import { generateApiToken } from '../users/users.service';

/** Org roles that may own a bot: a person with one of these, not deactivated */
const OWNER_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;

/** Org roles that manage the org's bots */
const ADMIN_ROLES = ['OWNER', 'ADMIN'] as const;

/**
 * No bcrypt hash: no password matches it, so a bot can never sign in. The same value as the
 * integration user's.
 */
const UNUSABLE_PASSWORD_HASH = '!';

const NOT_FOUND = () => new AppError(404, 'Service account not found', 'SERVICE_ACCOUNT_NOT_FOUND');

const SUMMARY_INCLUDE = {
  user: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
  owners: {
    select: { owner: { select: { id: true, username: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.ServiceAccountInclude;

type SummaryRow = Prisma.ServiceAccountGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

/**
 * The shape a list and a detail share: the bot's identity, status and owners.
 * @param row - The service account with its user and owners
 */
function summarize(row: SummaryRow) {
  return {
    id: row.userId,
    orgId: row.orgId,
    username: row.user.username,
    displayName: row.user.displayName,
    avatarUrl: row.user.avatarUrl,
    description: row.description,
    status: row.status,
    suspendedReason: row.suspendedReason,
    suspendedAt: row.suspendedAt,
    createdById: row.createdById,
    createdAt: row.createdAt,
    owners: row.owners.map((o) => o.owner),
  };
}

/**
 * Whether a user manages an org's bots: an org OWNER or ADMIN, or a platform admin.
 * @param userId - The user
 * @param orgId - The org
 */
export async function isOrgAdmin(userId: string, orgId: string): Promise<boolean> {
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
    prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId } },
      select: { role: true },
    }),
  ]);
  if (user?.isAdmin) return true;
  return !!membership && (ADMIN_ROLES as readonly string[]).includes(membership.role);
}

/**
 * Refuse a caller who does not manage the org's bots.
 * @param userId - The caller
 * @param orgId - The org
 * @throws {AppError} 403 NOT_ORG_MEMBER off the org, 403 FORBIDDEN below ADMIN
 */
export async function assertOrgAdmin(userId: string, orgId: string): Promise<void> {
  if (await isOrgAdmin(userId, orgId)) return;
  const member = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
    select: { id: true },
  });
  if (!member) throw new AppError(403, 'Not a member of this organization', 'NOT_ORG_MEMBER');
  throw new AppError(403, 'Only an org owner or admin manages service accounts', 'FORBIDDEN');
}

/**
 * The service account row of a bot, or null when there is none (never made, or deleted).
 * @param id - The bot's user id
 */
export async function getServiceAccount(id: string) {
  return prisma.serviceAccount.findUnique({ where: { userId: id } });
}

/**
 * The ids of a bot's owners, oldest first.
 * @param id - The bot's user id
 */
export async function ownersOf(id: string): Promise<string[]> {
  const rows = await prisma.serviceAccountOwner.findMany({
    where: { serviceAccountId: id },
    select: { ownerId: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => r.ownerId);
}

/**
 * Whether a user owns a bot.
 * @param botId - The bot's user id
 * @param userId - The user
 */
export async function isOwner(botId: string, userId: string): Promise<boolean> {
  const row = await prisma.serviceAccountOwner.findUnique({
    where: { serviceAccountId_ownerId: { serviceAccountId: botId, ownerId: userId } },
    select: { ownerId: true },
  });
  return !!row;
}

/**
 * Authorize a call on one bot. An org admin may read and manage it, an owner may only read it,
 * and anyone else is told it does not exist, as for a bot that does not.
 * @param userId - The caller
 * @param botId - The bot's user id
 * @param mode - read for its detail, manage for a change
 * @throws {AppError} 404 when the caller can't see it, 403 when an owner tries to manage it
 */
export async function assertCanAccess(
  userId: string,
  botId: string,
  mode: 'read' | 'manage',
): Promise<void> {
  const account = await getServiceAccount(botId);
  if (!account) throw NOT_FOUND();
  if (await isOrgAdmin(userId, account.orgId)) return;
  if (!(await isOwner(botId, userId))) throw NOT_FOUND();
  if (mode === 'manage') {
    throw new AppError(403, 'Only an org owner or admin manages service accounts', 'FORBIDDEN');
  }
}

/**
 * Refuse owners who can't own a bot of this org: each must be a person, not deactivated, with org
 * role OWNER, ADMIN or MEMBER there.
 * @param orgId - The bot's org
 * @param ownerIds - The proposed owners
 * @param db - The client to read with: the transaction that writes the owners, when there is one
 * @returns The owners, each once
 * @throws {AppError} 400 SERVICE_ACCOUNT_OWNER_INVALID when one is not eligible, or there are none
 */
async function eligibleOwners(
  orgId: string,
  ownerIds: string[],
  db: Pick<Prisma.TransactionClient, 'user'> = prisma,
): Promise<string[]> {
  const unique = [...new Set(ownerIds)];
  const eligible = await db.user.count({
    where: {
      id: { in: unique },
      kind: 'PERSON',
      deactivatedAt: null,
      orgMemberships: { some: { orgId, role: { in: [...OWNER_ROLES] } } },
    },
  });
  if (unique.length === 0 || eligible !== unique.length) {
    throw new AppError(
      400,
      'Each owner must be a person in this organization with role member or above',
      'SERVICE_ACCOUNT_OWNER_INVALID',
    );
  }
  return unique;
}

/**
 * Create a bot in an org: a SERVICE user with no usable password, its service account, its owners
 * and an org membership as MEMBER, the only org role it ever has.
 * @param orgId - The org
 * @param actorId - The org admin creating it
 * @param data - Its profile and owners
 * @param data.username - A username unique like any other
 * @param data.displayName - Its display name
 * @param data.description - What it does
 * @param data.ownerIds - Its owners, at least one
 * @returns The new bot as the list shows it
 * @throws {AppError} 409 when the username is taken, 400 for an owner who is not eligible
 */
export async function createServiceAccount(
  orgId: string,
  actorId: string,
  data: { username: string; displayName: string; description?: string; ownerIds: string[] },
) {
  await findOrThrow(
    prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }),
    ERR.ORGANIZATION_NOT_FOUND,
  );
  const owners = await eligibleOwners(orgId, data.ownerIds);
  const usernameTaken = () => new AppError(409, 'Username already taken', 'USERNAME_TAKEN');
  const taken = await prisma.user.findUnique({
    where: { username: data.username },
    select: { id: true },
  });
  if (taken) throw usernameTaken();

  // A concurrent create can take the username between the check and the insert: the unique
  // index decides, and its violation answers like the check
  const row = await prisma
    .$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          // An address no mail reaches, unique without asking for one
          email: `bot-${crypto.randomUUID()}@service-accounts.invalid`,
          username: data.username,
          displayName: data.displayName,
          passwordHash: UNUSABLE_PASSWORD_HASH,
          kind: 'SERVICE',
          orgMemberships: { create: { orgId, role: 'MEMBER' } },
        },
      });
      return tx.serviceAccount.create({
        data: {
          userId: user.id,
          orgId,
          createdById: actorId,
          description: data.description ?? '',
          owners: { create: owners.map((ownerId) => ({ ownerId })) },
        },
        include: SUMMARY_INCLUDE,
      });
    })
    .catch((err: unknown) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw usernameTaken();
      }
      throw err;
    });
  return summarize(row);
}

/**
 * The bots of an org a caller may see: all of them for an org admin, the bots they own for an
 * owner who is not.
 * @param orgId - The org
 * @param viewerId - The caller
 * @throws {AppError} 403 for a caller who is neither
 */
export async function listServiceAccounts(orgId: string, viewerId: string) {
  const admin = await isOrgAdmin(viewerId, orgId);
  const where: Prisma.ServiceAccountWhereInput = admin
    ? { orgId }
    : { orgId, owners: { some: { ownerId: viewerId } } };
  const rows = await prisma.serviceAccount.findMany({
    where,
    include: SUMMARY_INCLUDE,
    orderBy: { createdAt: 'asc' },
  });
  if (!admin && rows.length === 0) await assertOrgAdmin(viewerId, orgId);
  return rows.map(summarize);
}

/**
 * One bot with its status, owners, team and space memberships, and tokens (never their hashes).
 * @param id - The bot's user id
 * @throws {AppError} 404 when there is no such bot
 */
export async function describeServiceAccount(id: string) {
  const row = await prisma.serviceAccount.findUnique({
    where: { userId: id },
    include: SUMMARY_INCLUDE,
  });
  if (!row) throw NOT_FOUND();
  const [teams, spaces, tokens] = await Promise.all([
    prisma.teamMembership.findMany({
      where: { userId: id },
      select: { role: true, team: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.spacePermission.findMany({
      where: { userId: id },
      select: { level: true, space: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.apiToken.findMany({
      where: { userId: id },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        expiresAt: true,
        rotatedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    ...summarize(row),
    teams: teams.map((t) => ({ ...t.team, role: t.role })),
    spaces: spaces.map((s) => ({ ...s.space, level: s.level })),
    tokens,
  };
}

/**
 * Change a bot's display name or description.
 * @param id - The bot's user id
 * @param data - What changes
 * @param data.displayName - Its new display name
 * @param data.description - Its new description
 */
export async function updateServiceAccount(
  id: string,
  data: { displayName?: string; description?: string },
) {
  await prisma.$transaction(async (tx) => {
    if (data.displayName !== undefined) {
      await tx.user.update({ where: { id }, data: { displayName: data.displayName } });
    }
    if (data.description !== undefined) {
      await tx.serviceAccount.update({
        where: { userId: id },
        data: { description: data.description },
      });
    }
  });
  return describeServiceAccount(id);
}

/**
 * Replace a bot's owners. There is always at least one, and each is eligible.
 * @param id - The bot's user id
 * @param ownerIds - The new owners
 * @throws {AppError} 400 SERVICE_ACCOUNT_OWNER_INVALID for an owner who is not eligible
 */
export async function setOwners(id: string, ownerIds: string[]) {
  const account = await getServiceAccount(id);
  if (!account) throw NOT_FOUND();
  // Eligibility is read in the transaction that writes, so the owners it checked are the ones
  // stored
  await prisma.$transaction(async (tx) => {
    const owners = await eligibleOwners(account.orgId, ownerIds, tx);
    await tx.serviceAccountOwner.deleteMany({
      where: { serviceAccountId: id, ownerId: { notIn: owners } },
    });
    await tx.serviceAccountOwner.createMany({
      data: owners.map((ownerId) => ({ serviceAccountId: id, ownerId })),
      skipDuplicates: true,
    });
  });
  return describeServiceAccount(id);
}

/**
 * Delete a bot: its tokens, its pending approval requests (cancelled), its memberships and its
 * service account go. The user row stays, deactivated and a member of nothing, so its past
 * activity, comments and issues stay under its name.
 * @param id - The bot's user id
 * @throws {AppError} 404 when there is no such bot, also for the second of two concurrent deletes
 */
export async function deleteServiceAccount(id: string): Promise<void> {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Taken first, under the row lock: of two concurrent deletes, the second finds nothing
    const gone = await tx.serviceAccount.deleteMany({ where: { userId: id } });
    if (gone.count === 0) throw NOT_FOUND();
    await cancelPendingFor(id, 'The service account was deleted', tx);
    await tx.apiToken.deleteMany({ where: { userId: id } });
    await tx.teamMembership.deleteMany({ where: { userId: id } });
    await tx.spacePermission.deleteMany({ where: { userId: id } });
    await tx.pageRestriction.deleteMany({ where: { userId: id } });
    await tx.issueWatcher.deleteMany({ where: { userId: id } });
    await tx.starredPage.deleteMany({ where: { userId: id } });
    await tx.orgMembership.deleteMany({ where: { userId: id } });
    await tx.user.update({ where: { id }, data: { deactivatedAt: now } });
  });
}

// ─── Tokens ─────────────────────────────────────────────────

/** A bot token's lifetime when none is asked for, and the longest one allowed */
export const BOT_TOKEN_DEFAULT_DAYS = 90;
export const BOT_TOKEN_MAX_DAYS = 365;

/** How long a rotated token keeps working, at most, so its users can move to the new one */
const ROTATION_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const TOKEN_NOT_FOUND = () => new AppError(404, 'API token not found', 'TOKEN_NOT_FOUND');

const SUSPENDED = () =>
  new AppError(
    400,
    'This service account is suspended: resume it before giving it tokens',
    'SERVICE_ACCOUNT_SUSPENDED',
  );

/**
 * Refuse a token change for a bot that is gone or suspended: a token it can't use is no token.
 * @param db - The client to read with
 * @param botId - The bot's user id
 * @throws {AppError} 404 when there is no such bot, 400 SERVICE_ACCOUNT_SUSPENDED when suspended
 */
async function assertActive(
  db: Pick<Prisma.TransactionClient, 'serviceAccount'>,
  botId: string,
): Promise<void> {
  const account = await db.serviceAccount.findUnique({
    where: { userId: botId },
    select: { status: true },
  });
  if (!account) throw NOT_FOUND();
  if (account.status !== 'ACTIVE') throw SUSPENDED();
}

const TOKEN_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  createdAt: true,
  expiresAt: true,
} satisfies Prisma.ApiTokenSelect;

/**
 * Authorize a change to a bot's tokens: an org admin or one of its owners. Anyone else is told
 * the bot does not exist.
 * @param userId - The caller
 * @param botId - The bot's user id
 * @throws {AppError} 404 when there is no such bot or the caller is neither
 */
export async function assertCanManageTokens(userId: string, botId: string): Promise<void> {
  const account = await getServiceAccount(botId);
  if (!account) throw NOT_FOUND();
  if (await isOrgAdmin(userId, account.orgId)) return;
  if (!(await isOwner(botId, userId))) throw NOT_FOUND();
}

/**
 * Store a new token for a bot.
 * @param db - The client to write with
 * @param botId - The bot's user id
 * @param data - Its name, scopes and expiry
 * @param data.name - Its name
 * @param data.scopes - Its scopes
 * @param data.expiresAt - When it stops working
 * @returns The token's metadata and the raw token, the only time it is shown
 */
async function storeBotToken(
  db: Pick<Prisma.TransactionClient, 'apiToken'>,
  botId: string,
  data: { name: string; scopes: string[]; expiresAt: Date },
) {
  const { rawToken, tokenHash, prefix } = generateApiToken();
  const token = await db.apiToken.create({
    data: { userId: botId, tokenHash, prefix, ...data },
    select: TOKEN_SELECT,
  });
  return { ...token, token: rawToken };
}

/**
 * Create a token for a bot. It always expires: 90 days out by default, 365 at most. A bot has no
 * admin scope: everything that manages the org waits for a person, and a bot is never one.
 * @param botId - The bot's user id
 * @param data - The token's name, scopes and lifetime
 * @param data.name - Its name
 * @param data.scopes - Its scopes, none of them admin
 * @param data.expiresInDays - Days until it expires, 1 to 365
 * @returns The token's metadata and the raw token, the only time it is shown
 * @throws {AppError} 400 for an admin or unknown scope, or a lifetime out of range
 */
export async function createBotToken(
  botId: string,
  data: { name: string; scopes: string[]; expiresInDays?: number },
) {
  if (data.scopes.some((scope) => scope.startsWith('admin:'))) {
    throw new AppError(
      400,
      'A service account token has no admin scope',
      'SERVICE_ACCOUNT_ADMIN_SCOPE',
    );
  }
  if (!data.scopes.every(isMintableScope)) {
    throw new AppError(400, 'Unknown token scope, or one no action uses yet');
  }
  const days = data.expiresInDays ?? BOT_TOKEN_DEFAULT_DAYS;
  if (!Number.isInteger(days) || days < 1 || days > BOT_TOKEN_MAX_DAYS) {
    throw new AppError(400, `A service account token expires in 1 to ${BOT_TOKEN_MAX_DAYS} days`);
  }
  await assertActive(prisma, botId);
  return storeBotToken(prisma, botId, {
    name: data.name,
    scopes: [...new Set(data.scopes)],
    expiresAt: new Date(Date.now() + days * DAY_MS),
  });
}

/**
 * Rotate a bot's token: a new one with the same name and scopes and a fresh expiry, as long as
 * the old one was made for, and the old one keeps working for 7 more days at most. A token is
 * rotated once: of two concurrent rotations, the second waits on the row lock and is refused.
 * @param botId - The bot's user id
 * @param tokenId - The token to rotate
 * @returns The new token's metadata and its raw token, the only time it is shown
 * @throws {AppError} 404 when the bot has no such token, 409 TOKEN_ALREADY_ROTATED when it was
 * rotated before, 400 SERVICE_ACCOUNT_SUSPENDED when the bot is suspended
 */
export async function rotateBotToken(botId: string, tokenId: string) {
  return prisma.$transaction(async (tx) => {
    // Locked before it is read: a concurrent rotation sees this one's rotatedAt once it commits
    await tx.$queryRaw`SELECT id FROM api_tokens WHERE id = ${tokenId} AND "userId" = ${botId} FOR UPDATE`;
    const old = await tx.apiToken.findFirst({ where: { id: tokenId, userId: botId } });
    if (!old) throw TOKEN_NOT_FOUND();
    if (old.rotatedAt) {
      throw new AppError(
        409,
        'This token was already rotated: rotate its replacement instead',
        'TOKEN_ALREADY_ROTATED',
      );
    }
    await assertActive(tx, botId);
    const now = Date.now();
    // The same lifetime as the old token, in whole days within the bounds a new one has
    const lifetimeDays = old.expiresAt
      ? Math.round((old.expiresAt.getTime() - old.createdAt.getTime()) / DAY_MS)
      : BOT_TOKEN_DEFAULT_DAYS;
    const days = Math.min(Math.max(lifetimeDays, 1), BOT_TOKEN_MAX_DAYS);
    const graceEnd = now + ROTATION_GRACE_MS;
    const oldEnd = old.expiresAt ? Math.min(old.expiresAt.getTime(), graceEnd) : graceEnd;
    await tx.apiToken.update({
      where: { id: old.id },
      data: { expiresAt: new Date(oldEnd), rotatedAt: new Date(now) },
    });
    return storeBotToken(tx, botId, {
      name: old.name,
      scopes: old.scopes,
      expiresAt: new Date(now + days * DAY_MS),
    });
  });
}

/**
 * Revoke a bot's token. The next request with it answers 401.
 * @param botId - The bot's user id
 * @param tokenId - The token to revoke
 * @throws {AppError} 404 when the bot has no such token
 */
export async function revokeBotToken(botId: string, tokenId: string): Promise<void> {
  const gone = await prisma.apiToken.deleteMany({ where: { id: tokenId, userId: botId } });
  if (gone.count === 0) throw TOKEN_NOT_FOUND();
}
