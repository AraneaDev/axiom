import type { Prisma, RestrictionType, SpacePermissionLevel, TeamRole } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { revokeLiveAccess } from '../../realtime/access-revocation';
import { logger } from '../../utils/logger';
import { cancelPendingFor } from '../agent-approvals/agent-approvals.cleanup';
import { createNotification } from '../notifications/notifications.service';
import { canAccessSpace } from '../wiki/space-permissions.service';

/**
 * Decision 9: a bot only sits where one of its owners is. A place is a team the bot is a member
 * of, or a wiki space it holds a permission on.
 *
 * Locking: every check here runs in a transaction that first locks the bot's service account row
 * (FOR UPDATE), then the rows it reads about the owners (FOR SHARE: their org memberships, team
 * memberships and space permissions). A leave, removal or demotion either commits before the
 * check reads, or waits for it and is repaired by the hook that runs after it (onOwnerLeft,
 * onSpaceChanged, onOwnershipLapse). Those hooks run after the change commits and take the same
 * locks in the same order, so no two of them deadlock on each other.
 */

/** Where a bot sits */
export type Place = { teamId: string } | { spaceId: string };

/** The notification type of what happens to a bot here */
export const SERVICE_ACCOUNT_NOTICE = 'service_account';

/** Org roles that may own a bot */
const OWNER_ROLES = ['OWNER', 'ADMIN', 'MEMBER'];

/** Org roles below which ownership lapses */
const LAPSING_ROLES = ['VIEWER', 'GUEST'];

type Tx = Prisma.TransactionClient;

const OWNER_NOT_MEMBER = () =>
  new AppError(
    400,
    'A service account joins only a team or space where one of its owners is',
    'SERVICE_ACCOUNT_OWNER_NOT_MEMBER',
  );

const ROLE_LIMIT = () =>
  new AppError(
    400,
    'A service account is at most a member of a team and an editor of a space',
    'SERVICE_ACCOUNT_ROLE_LIMIT',
  );

const OWNER_NEEDED = () =>
  new AppError(
    400,
    'This would leave the service account in a team or space with none of its owners: remove it ' +
      'there first, or keep an owner who is there',
    'SERVICE_ACCOUNT_OWNER_NEEDED',
  );

/** A locked service account row */
export interface LockedAccount {
  userId: string;
  orgId: string;
  status: 'ACTIVE' | 'SUSPENDED';
  suspendedReason: 'ORPHANED' | 'MANUAL' | null;
}

/**
 * Lock a bot's service account row for the rest of the transaction.
 * @param tx - The transaction
 * @param botId - The bot's user id
 * @returns The row, or null when the user is no bot
 */
export async function lockServiceAccount(tx: Tx, botId: string): Promise<LockedAccount | null> {
  const rows = await tx.$queryRaw<LockedAccount[]>`
    SELECT "userId", "orgId", status::text AS status, "suspendedReason"::text AS "suspendedReason"
    FROM service_accounts WHERE "userId" = ${botId} FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Of some users, those who can own a bot of the org now, with their org membership rows locked:
 * a demotion or removal waits until the transaction ends.
 * @param tx - The transaction
 * @param orgId - The bot's org
 * @param userIds - The candidates
 * @returns The eligible ones
 */
export async function lockEligibleOwners(
  tx: Tx,
  orgId: string,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ userId: string }>>`
    SELECT m."userId" FROM org_memberships m JOIN users u ON u.id = m."userId"
    WHERE m."orgId" = ${orgId} AND m."userId" = ANY(${userIds})
      AND m.role::text = ANY(${OWNER_ROLES})
      AND u.kind = 'PERSON' AND u."deactivatedAt" IS NULL
    ORDER BY m."userId"
    FOR SHARE OF m`;
  return rows.map((r) => r.userId);
}

/**
 * The owner rows of a bot, eligible or not.
 * @param db - The client
 * @param botId - The bot's user id
 */
async function ownerRowIds(db: Pick<Tx, 'serviceAccountOwner'>, botId: string): Promise<string[]> {
  const rows = await db.serviceAccountOwner.findMany({
    where: { serviceAccountId: botId },
    select: { ownerId: true },
  });
  return rows.map((r) => r.ownerId);
}

/**
 * Whether one of these owners is in a place, with the rows that say so locked.
 * @param tx - The transaction
 * @param place - The team (a member there) or the space (can view it)
 * @param owners - The bot's eligible owners, their org memberships already locked
 */
async function ownerPresent(tx: Tx, place: Place, owners: string[]): Promise<boolean> {
  if (owners.length === 0) return false;
  if ('teamId' in place) {
    const rows = await tx.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId" FROM team_memberships
      WHERE "teamId" = ${place.teamId} AND "userId" = ANY(${owners})
      ORDER BY "userId" FOR SHARE`;
    return rows.length > 0;
  }
  const space = await tx.wikiSpace.findUnique({
    where: { id: place.spaceId },
    select: { teamId: true },
  });
  if (!space) return false;
  // What canAccessSpace reads about the owners, locked against a concurrent removal
  await tx.$queryRaw`
    SELECT id FROM team_memberships
    WHERE "teamId" = ${space.teamId} AND "userId" = ANY(${owners}) ORDER BY id FOR SHARE`;
  await tx.$queryRaw`
    SELECT id FROM space_permissions
    WHERE "spaceId" = ${place.spaceId} AND "userId" = ANY(${owners}) ORDER BY id FOR SHARE`;
  for (const owner of owners) {
    if (await canAccessSpace(place.spaceId, owner, 'VIEW', tx)) return true;
  }
  return false;
}

/**
 * Whether a user is a bot, read in the transaction.
 * @param db - The client
 * @param userId - The user
 */
export async function isBotUser(db: Pick<Tx, 'user'>, userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { kind: true } });
  return user?.kind === 'SERVICE';
}

/**
 * Refuse a role above what a bot may hold: MEMBER on a team, edit on a space.
 * @param role - The team role or the space level
 * @throws {AppError} 400 SERVICE_ACCOUNT_ROLE_LIMIT
 */
export function assertBotRole(role: TeamRole | SpacePermissionLevel): void {
  if (role === 'ADMIN') throw ROLE_LIMIT();
}

/**
 * Refuse a bot joining a place where none of its owners is: a member of the team, or someone who
 * can view the space. Run it in the transaction that writes the membership, after the write when
 * the write itself can change who views the place (the first permission on a space closes it).
 * @param botId - The bot's user id
 * @param place - The team or space
 * @param tx - The transaction; without one the check runs alone
 * @throws {AppError} 400 SERVICE_ACCOUNT_OWNER_NOT_MEMBER, 404 when the user is no bot
 */
export async function assertOwnerPresent(botId: string, place: Place, tx?: Tx): Promise<void> {
  if (!tx) return prisma.$transaction((inner) => assertOwnerPresent(botId, place, inner));
  const account = await lockServiceAccount(tx, botId);
  if (!account) throw new AppError(404, 'Service account not found', 'SERVICE_ACCOUNT_NOT_FOUND');
  const owners = await lockEligibleOwners(tx, account.orgId, await ownerRowIds(tx, botId));
  if (!(await ownerPresent(tx, place, owners))) throw OWNER_NOT_MEMBER();
}

/**
 * Refuse a page restriction that lists a bot none of whose owners could view the page with it in
 * place: an owner must view the space, and for a view restriction be on the new list or an org
 * owner or admin. Lock order: each bot in id order.
 * @param tx - The transaction that writes the restriction
 * @param pageId - The page
 * @param type - The restriction type
 * @param userIds - The new list for that type
 * @throws {AppError} 400 SERVICE_ACCOUNT_OWNER_NOT_MEMBER
 */
export async function assertOwnersSeePage(
  tx: Tx,
  pageId: string,
  type: RestrictionType,
  userIds: string[],
): Promise<void> {
  if (userIds.length === 0) return;
  const bots = await tx.user.findMany({
    where: { id: { in: userIds }, kind: 'SERVICE' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (bots.length === 0) return;
  const page = await tx.page.findUniqueOrThrow({
    where: { id: pageId },
    select: { spaceId: true, space: { select: { team: { select: { orgId: true } } } } },
  });
  const viewList =
    type === 'VIEW'
      ? userIds
      : (
          await tx.pageRestriction.findMany({
            where: { pageId, type: 'VIEW' },
            select: { userId: true },
          })
        ).map((r) => r.userId);
  for (const bot of bots) {
    const account = await lockServiceAccount(tx, bot.id);
    if (!account) throw OWNER_NOT_MEMBER();
    const owners = await lockEligibleOwners(tx, account.orgId, await ownerRowIds(tx, bot.id));
    let seen = false;
    for (const owner of owners) {
      if (!(await canAccessSpace(page.spaceId, owner, 'VIEW', tx))) continue;
      if (viewList.length === 0 || viewList.includes(owner)) {
        seen = true;
        break;
      }
      const [member, user] = await Promise.all([
        tx.orgMembership.findUnique({
          where: { userId_orgId: { userId: owner, orgId: page.space.team.orgId } },
          select: { role: true },
        }),
        tx.user.findUnique({ where: { id: owner }, select: { isAdmin: true } }),
      ]);
      if (user?.isAdmin || member?.role === 'OWNER' || member?.role === 'ADMIN') {
        seen = true;
        break;
      }
    }
    if (!seen) throw OWNER_NOT_MEMBER();
  }
}

/** A place of a bot, as the notifications name it */
interface BotPlace {
  place: Place;
  name: string;
  /** The team whose admins are told: the team itself, or the space's */
  teamId: string;
}

/**
 * The places of a bot, all of them or those a scope names.
 * @param tx - The transaction
 * @param botId - The bot's user id
 * @param scope - all, a team (and the team's spaces), or a space
 */
async function placesOf(tx: Tx, botId: string, scope: Scope): Promise<BotPlace[]> {
  const teamFilter = scope === 'all' ? {} : 'teamId' in scope ? { teamId: scope.teamId } : null;
  const spaceFilter =
    scope === 'all'
      ? {}
      : 'teamId' in scope
        ? { space: { teamId: scope.teamId } }
        : { spaceId: scope.spaceId };
  const [teams, spaces] = await Promise.all([
    teamFilter
      ? tx.teamMembership.findMany({
          where: { userId: botId, ...teamFilter },
          select: { teamId: true, team: { select: { name: true } } },
          orderBy: { teamId: 'asc' },
        })
      : Promise.resolve([]),
    tx.spacePermission.findMany({
      where: { userId: botId, ...spaceFilter },
      select: { spaceId: true, space: { select: { name: true, teamId: true } } },
      orderBy: { spaceId: 'asc' },
    }),
  ]);
  return [
    ...teams.map((t) => ({ place: { teamId: t.teamId }, name: t.team.name, teamId: t.teamId })),
    ...spaces.map((s) => ({
      place: { spaceId: s.spaceId },
      name: s.space.name,
      teamId: s.space.teamId,
    })),
  ];
}

/**
 * Refuse owners that would leave one of the bot's places with none of them in it.
 * @param tx - The transaction, with the bot's row locked
 * @param botId - The bot's user id
 * @param owners - The new owners, eligible and locked
 * @throws {AppError} 400 SERVICE_ACCOUNT_OWNER_NEEDED
 */
export async function assertPlacesKept(tx: Tx, botId: string, owners: string[]): Promise<void> {
  for (const { place } of await placesOf(tx, botId, 'all')) {
    if (!(await ownerPresent(tx, place, owners))) throw OWNER_NEEDED();
  }
}

/** Which of a bot's places to check */
type Scope = 'all' | Place;

/** What one check did, for the notifications sent after it commits */
interface Outcome {
  botId: string;
  orgId: string;
  owners: string[];
  removed: BotPlace[];
  orphaned: boolean;
}

/**
 * Suspend a bot that has no owner left, with reason ORPHANED, and cancel what it waits on. A bot
 * suspended by hand becomes ORPHANED too: only an owner can bring it back now.
 * @param tx - The transaction, with the bot's row locked
 * @param account - The locked row
 * @returns Whether it changed
 */
async function orphan(tx: Tx, account: LockedAccount): Promise<boolean> {
  if (account.suspendedReason === 'ORPHANED') return false;
  await tx.serviceAccount.update({
    where: { userId: account.userId },
    data: { status: 'SUSPENDED', suspendedReason: 'ORPHANED', suspendedAt: new Date() },
  });
  await cancelPendingFor(account.userId, 'The service account has no owner left', tx);
  return true;
}

/**
 * Check a bot's places under its lock: leave each one none of its owners is in, and suspend the
 * bot when it has no owner at all.
 * @param botId - The bot's user id
 * @param scope - Which places
 * @param dropOwner - An owner to remove first, whose ownership lapsed
 */
async function reconcile(botId: string, scope: Scope, dropOwner?: string): Promise<void> {
  const outcome = await prisma.$transaction(async (tx): Promise<Outcome | null> => {
    const account = await lockServiceAccount(tx, botId);
    if (!account) return null;
    if (dropOwner) {
      await tx.serviceAccountOwner.deleteMany({
        where: { serviceAccountId: botId, ownerId: dropOwner },
      });
    }
    const owners = await lockEligibleOwners(tx, account.orgId, await ownerRowIds(tx, botId));
    const base = { botId, orgId: account.orgId, owners, removed: [] as BotPlace[] };
    // A bot with no owner keeps its places, suspended, until an owner who is there comes back
    if (owners.length === 0) return { ...base, orphaned: await orphan(tx, account) };
    for (const p of await placesOf(tx, botId, scope)) {
      if (await ownerPresent(tx, p.place, owners)) continue;
      if ('teamId' in p.place) {
        const teamId = p.place.teamId;
        await tx.issueWatcher.deleteMany({
          where: { userId: botId, issue: { project: { teamId } } },
        });
        await tx.teamMembership.deleteMany({ where: { userId: botId, teamId } });
      } else {
        await tx.spacePermission.deleteMany({ where: { userId: botId, spaceId: p.place.spaceId } });
      }
      base.removed.push(p);
    }
    return { ...base, orphaned: false };
  });
  if (!outcome) return;
  if (outcome.removed.length > 0) void revokeLiveAccess({ userId: botId });
  await tell(outcome);
}

/**
 * Tell who should know: the owners and the team's admins of each place the bot left, and the
 * org's owners and admins when it was orphaned. Best effort: the change stands either way.
 * @param outcome - What the check did
 */
async function tell(outcome: Outcome): Promise<void> {
  if (outcome.removed.length === 0 && !outcome.orphaned) return;
  try {
    const bot = await prisma.user.findUnique({
      where: { id: outcome.botId },
      select: { displayName: true },
    });
    const name = bot?.displayName ?? 'A service account';
    for (const p of outcome.removed) {
      const admins = await prisma.teamMembership.findMany({
        where: { teamId: p.teamId, role: 'ADMIN', user: { kind: 'PERSON' } },
        select: { userId: true },
      });
      const to = new Set([...outcome.owners, ...admins.map((a) => a.userId)]);
      for (const userId of to) {
        await createNotification(
          userId,
          SERVICE_ACCOUNT_NOTICE,
          `${name} left ${p.name}: none of its owners is there anymore`,
        );
      }
    }
    if (outcome.orphaned) {
      const admins = await prisma.orgMembership.findMany({
        where: { orgId: outcome.orgId, role: { in: ['OWNER', 'ADMIN'] }, user: { kind: 'PERSON' } },
        select: { userId: true },
      });
      for (const { userId } of admins) {
        await createNotification(
          userId,
          SERVICE_ACCOUNT_NOTICE,
          `${name} was suspended: it has no owner left`,
          'Give it an owner to resume it',
        );
      }
    }
  } catch (err) {
    logger.error('telling about a service account failed', { botId: outcome.botId }, err as Error);
  }
}

/**
 * The bots a user has an owner row for, in one org.
 * @param userId - The user
 * @param orgId - The org
 */
async function botsOwnedIn(userId: string, orgId: string): Promise<string[]> {
  const rows = await prisma.serviceAccountOwner.findMany({
    where: { ownerId: userId, serviceAccount: { orgId } },
    select: { serviceAccountId: true },
    orderBy: { serviceAccountId: 'asc' },
  });
  return rows.map((r) => r.serviceAccountId);
}

/**
 * The org a place belongs to.
 * @param place - A team or space
 */
async function orgOf(place: Place): Promise<string | null> {
  if ('teamId' in place) {
    const team = await prisma.team.findUnique({
      where: { id: place.teamId },
      select: { orgId: true },
    });
    return team?.orgId ?? null;
  }
  const space = await prisma.wikiSpace.findUnique({
    where: { id: place.spaceId },
    select: { team: { select: { orgId: true } } },
  });
  return space?.team.orgId ?? null;
}

/**
 * After a person left a team or space, or their access there changed: each bot they own leaves
 * that place (for a team, also the team's spaces) when none of its owners is left there. With an
 * org, every place of their bots in it is checked. Run it after the change commits.
 * @param userId - The person
 * @param place - The team, the space, or the whole org
 */
export async function onOwnerLeft(userId: string, place: Place | { orgId: string }): Promise<void> {
  const orgId = 'orgId' in place ? place.orgId : await orgOf(place);
  if (!orgId) return;
  for (const botId of await botsOwnedIn(userId, orgId)) {
    await reconcile(botId, 'orgId' in place ? 'all' : place);
  }
}

/**
 * After a space's permissions changed: the first one closes the space to everyone not listed, and
 * taking one away can leave an owner out. Each bot with a permission there is checked.
 * @param spaceId - The space
 */
export async function onSpaceChanged(spaceId: string): Promise<void> {
  const rows = await prisma.spacePermission.findMany({
    where: { spaceId, user: { kind: 'SERVICE' } },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });
  for (const row of rows) {
    if (row.userId) await reconcile(row.userId, { spaceId });
  }
}

/**
 * A person's ownership of their bots in an org lapsed: they left it, were demoted to VIEWER or
 * GUEST, deactivated or deleted. They stop being an owner; a bot left with no owner is suspended
 * (ORPHANED), its requests cancelled and the org's owners and admins told; a bot that keeps owners
 * leaves the places none of them is in.
 * @param userId - The person
 * @param orgId - The org
 */
export async function onOwnershipLapse(userId: string, orgId: string): Promise<void> {
  for (const botId of await botsOwnedIn(userId, orgId)) {
    await reconcile(botId, 'all', userId);
  }
}

/**
 * After a person's org role changed: below MEMBER their ownership lapses, and any change can take
 * away the org-wide access an OWNER or ADMIN has to spaces.
 * @param userId - The person
 * @param orgId - The org
 * @param role - The new role
 */
export async function onOrgRoleChanged(userId: string, orgId: string, role: string): Promise<void> {
  if (LAPSING_ROLES.includes(role)) return onOwnershipLapse(userId, orgId);
  return onOwnerLeft(userId, { orgId });
}

/**
 * A person's ownership lapsed in every org they are in (deactivated or deleted).
 * @param userId - The person
 */
export async function onOwnershipLapseEverywhere(userId: string): Promise<void> {
  const orgs = await prisma.serviceAccountOwner.findMany({
    where: { ownerId: userId },
    select: { serviceAccount: { select: { orgId: true } } },
  });
  for (const orgId of new Set(orgs.map((o) => o.serviceAccount.orgId))) {
    await onOwnershipLapse(userId, orgId);
  }
}
