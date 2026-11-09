import crypto from 'crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { isMintableScope } from '../../middleware/token-scopes';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_WITH_AVATAR_SELECT } from '../../utils/prisma-selects';
import { cancelPendingFor } from '../agent-approvals/agent-approvals.cleanup';
import { viewablePageIdFilter, viewableProjectIds } from '../search/search-access';
import { withResourceLinks } from '../teams/teams.service';
import { generateApiToken } from '../users/users.service';
import { canAccessSpace } from '../wiki/space-access';

import { assertPlacesKept, lockEligibleOwners, lockServiceAccount } from './bot-guards';
import { eligibleOwnerIds, eligibleOwnerWhere } from './owners';

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
 * The org of a bot, for the approval rules of a call on it: none when there is no such bot.
 * @param id - The bot's user id
 */
export async function orgsOfServiceAccount(id: string): Promise<string[]> {
  const account = await getServiceAccount(id);
  return account ? [account.orgId] : [];
}

/**
 * The ids of a bot's owners who count now, oldest first: an owner row of someone demoted,
 * deactivated or gone counts for nothing, even before the orphan check removes it.
 * @param id - The bot's user id
 */
export async function ownersOf(id: string): Promise<string[]> {
  return eligibleOwnerIds(id);
}

/**
 * Whether a user owns a bot now: an owner row, and still eligible in the bot's org.
 * @param botId - The bot's user id
 * @param userId - The user
 */
export async function isOwner(botId: string, userId: string): Promise<boolean> {
  const account = await getServiceAccount(botId);
  if (!account) return false;
  const row = await prisma.serviceAccountOwner.findFirst({
    where: {
      serviceAccountId: botId,
      ownerId: userId,
      owner: eligibleOwnerWhere(account.orgId),
    },
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
    where: { id: { in: unique }, ...eligibleOwnerWhere(orgId) },
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
  const ids = rows.map((r) => r.userId);
  const [teams, lastUses] = await Promise.all([
    prisma.teamMembership.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, role: true, team: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    // When each bot last called the API, by any of its tokens: says it runs, not where
    prisma.apiToken.groupBy({
      by: ['userId'],
      where: { userId: { in: ids } },
      _max: { lastUsedAt: true },
    }),
  ]);
  const lastUsed = new Map(lastUses.map((t) => [t.userId, t._max.lastUsedAt]));
  return rows.map((row) => ({
    ...summarize(row),
    teams: teams.filter((t) => t.userId === row.userId).map((t) => ({ ...t.team, role: t.role })),
    lastUsedAt: lastUsed.get(row.userId) ?? null,
  }));
}

/** How many of a bot's latest activities its page shows */
const ACTIVITY_LIMIT = 30;

/**
 * A bot's latest activity on issues and pages, newest first, with each one's title and link:
 * only what the viewer can open, as team activity filters. A bot's owners can open each of its
 * places (decision 9); this is the backstop for one they no longer can.
 * @param id - The bot's user id
 * @param viewerId - Who reads
 */
export async function serviceAccountActivity(id: string, viewerId: string) {
  const [projectIds, { spaceIds, hiddenPageIds }] = await Promise.all([
    viewableProjectIds(viewerId),
    viewablePageIdFilter(viewerId),
  ]);
  const allProjects = projectIds === null;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT a.id FROM activities a
    WHERE a."userId" = ${id}
      AND (
        (a."resourceType" = 'issue' AND EXISTS (
          SELECT 1 FROM issues i
          WHERE i.id = a."resourceId"
            AND (${allProjects} OR i."projectId" = ANY(${projectIds ?? []}))
        ))
        OR (a."resourceType" = 'wiki_page' AND EXISTS (
          SELECT 1 FROM pages pg
          WHERE pg.id = a."resourceId"
            AND pg."spaceId" = ANY(${spaceIds})
            AND NOT (pg.id = ANY(${hiddenPageIds}))
        ))
      )
    ORDER BY a."createdAt" DESC
    LIMIT ${ACTIVITY_LIMIT}
  `;
  const activities = await prisma.activity.findMany({
    where: { id: { in: rows.map((r) => r.id) } },
    include: { user: { select: USER_WITH_AVATAR_SELECT } },
    orderBy: { createdAt: 'desc' },
  });
  return withResourceLinks(activities);
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
 * Where a bot may be added (decision 9): the teams of its org one of its owners is in, and the
 * spaces one of them can open, that it is not in yet. Spaces are only those the viewer can open
 * too, so no name reaches someone who can't see it. The member and permission actions still
 * decide; this only says what to offer.
 * @param id - The bot's user id
 * @param viewerId - Who reads
 */
export async function joinablePlaces(id: string, viewerId: string) {
  const account = await getServiceAccount(id);
  if (!account) throw NOT_FOUND();
  const owners = await eligibleOwnerIds(id);
  if (owners.length === 0) return { teams: [], spaces: [] };
  const [teams, spaces] = await Promise.all([
    prisma.team.findMany({
      where: {
        orgId: account.orgId,
        members: { some: { userId: { in: owners } }, none: { userId: id } },
      },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    }),
    prisma.wikiSpace.findMany({
      where: {
        team: { orgId: account.orgId },
        isArchived: false,
        permissions: { none: { userId: id } },
      },
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const open = await Promise.all(
    spaces.map(async (space) => {
      if (!(await canAccessSpace(space.id, viewerId, 'VIEW'))) return false;
      for (const owner of owners) {
        if (await canAccessSpace(space.id, owner, 'VIEW')) return true;
      }
      return false;
    }),
  );
  return { teams, spaces: spaces.filter((_, i) => open[i]) };
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
 * Replace a bot's owners. There is always at least one, each is eligible, and each team and space
 * the bot is in keeps one of them (decision 9). An orphaned bot that gets owners is resumed.
 * @param id - The bot's user id
 * @param ownerIds - The new owners
 * @throws {AppError} 400 SERVICE_ACCOUNT_OWNER_INVALID for an owner who is not eligible, 400
 * SERVICE_ACCOUNT_OWNER_NEEDED when a place of the bot would have none of them
 */
export async function setOwners(id: string, ownerIds: string[]) {
  // Under the bot's lock, with the owners' membership rows locked: a demotion, removal or leave
  // committed concurrently either shows here or waits, and its orphan check runs after this
  await prisma.$transaction(async (tx) => {
    const account = await lockServiceAccount(tx, id);
    if (!account) throw NOT_FOUND();
    await lockEligibleOwners(tx, account.orgId, [...new Set(ownerIds)]);
    const owners = await eligibleOwners(account.orgId, ownerIds, tx);
    await assertPlacesKept(tx, id, owners);
    await tx.serviceAccountOwner.deleteMany({
      where: { serviceAccountId: id, ownerId: { notIn: owners } },
    });
    await tx.serviceAccountOwner.createMany({
      data: owners.map((ownerId) => ({ serviceAccountId: id, ownerId })),
      skipDuplicates: true,
    });
    if (account.suspendedReason === 'ORPHANED') {
      await tx.serviceAccount.update({
        where: { userId: id },
        data: { status: 'ACTIVE', suspendedReason: null, suspendedAt: null },
      });
    }
  });
  return describeServiceAccount(id);
}

/**
 * Suspend a bot by hand: its tokens stop working at once and its waiting requests are cancelled.
 * An orphan suspended by hand becomes MANUAL, keeping when it was suspended: a new owner then
 * does not lift it, only resume does. A bot already suspended by hand stays as it is.
 * @param id - The bot's user id
 * @throws {AppError} 404 when there is no such bot
 */
export async function suspendServiceAccount(id: string) {
  await prisma.$transaction(async (tx) => {
    const account = await lockServiceAccount(tx, id);
    if (!account) throw NOT_FOUND();
    if (account.suspendedReason === 'ORPHANED') {
      // Its requests were cancelled when it was orphaned
      await tx.serviceAccount.update({
        where: { userId: id },
        data: { suspendedReason: 'MANUAL' },
      });
      return;
    }
    if (account.status === 'SUSPENDED') return;
    await tx.serviceAccount.update({
      where: { userId: id },
      data: { status: 'SUSPENDED', suspendedReason: 'MANUAL', suspendedAt: new Date() },
    });
    await cancelPendingFor(id, 'The service account was suspended', tx);
  });
  return describeServiceAccount(id);
}

/**
 * Resume a bot suspended by hand. An orphan resumes only by getting an owner (setOwners). Each of
 * its places needs an owner who can open it: a hook that failed while it was suspended may have
 * left it in one, and the sweep skips suspended bots.
 * @param id - The bot's user id
 * @throws {AppError} 404 when there is no such bot, 400 SERVICE_ACCOUNT_ORPHANED for an orphan,
 * 400 SERVICE_ACCOUNT_OWNER_NEEDED for a place none of its owners can open
 */
export async function resumeServiceAccount(id: string) {
  await prisma.$transaction(async (tx) => {
    const account = await lockServiceAccount(tx, id);
    if (!account) throw NOT_FOUND();
    const owners = await lockEligibleOwners(
      tx,
      account.orgId,
      (
        await tx.serviceAccountOwner.findMany({
          where: { serviceAccountId: id },
          select: { ownerId: true },
        })
      ).map((o) => o.ownerId),
    );
    // A lapse no orphan check saw still leaves the bot without an owner to answer for it
    if (account.suspendedReason === 'ORPHANED' || owners.length === 0) {
      throw new AppError(
        400,
        'This service account has no owner: give it an owner to resume it',
        'SERVICE_ACCOUNT_ORPHANED',
      );
    }
    if (account.status === 'ACTIVE') return;
    await assertPlacesKept(tx, id, owners);
    await tx.serviceAccount.update({
      where: { userId: id },
      data: { status: 'ACTIVE', suspendedReason: null, suspendedAt: null },
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
  return assertOwnerOrOrgAdmin(userId, botId);
}

/**
 * Authorize a call that an org admin or one of the bot's owners may make: its tokens, suspending
 * and resuming it. Anyone else is told the bot does not exist.
 * @param userId - The caller
 * @param botId - The bot's user id
 * @throws {AppError} 404 when there is no such bot or the caller is neither
 */
export async function assertOwnerOrOrgAdmin(userId: string, botId: string): Promise<void> {
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
  // Read under the bot row lock, in the transaction that writes: a suspension commits first and
  // refuses this, or waits until the token exists and then stops it with the rest
  return prisma.$transaction(async (tx) => {
    await lockServiceAccount(tx, botId);
    await assertActive(tx, botId);
    return storeBotToken(tx, botId, {
      name: data.name,
      scopes: [...new Set(data.scopes)],
      expiresAt: new Date(Date.now() + days * DAY_MS),
    });
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
