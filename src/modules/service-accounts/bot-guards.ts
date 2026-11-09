import type { Prisma, SpacePermissionLevel, TeamRole } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { revokeLiveAccess } from '../../realtime/access-revocation';
import { logger } from '../../utils/logger';
import { cancelPendingFor } from '../agent-approvals/agent-approvals.cleanup';
import { createNotification } from '../notifications/notifications.service';
import { canAccessSpace } from '../wiki/space-access';

/**
 * Decisions 9 and 13: a bot only sits where one of its owners can open the place too. A place is
 * a team the bot is a member of, every wiki space the bot can view (by its own permission or
 * through a team-role grant of one of its teams), and every page whose restrictions list it.
 *
 * Locking, one order everywhere: the bot's service account row (FOR UPDATE), then the org's
 * OWNER membership rows by userId, then the other org membership rows by userId, then team
 * memberships and space permissions (FOR SHARE where a check only reads them). A path that removes
 * a person takes the OWNER rows and then that person's own org row (removeOrgMember, deleteUser),
 * so it never holds a team row while waiting for an org row a check holds. A path that writes a
 * bot row through a cascade (deleteUser through createdById, deleteTeam, deleteOrg) takes the bot
 * rows first. A leave, removal or demotion either commits before the
 * check reads, or waits for it and is repaired by the hook that runs after it commits. Hooks
 * catch and log their errors: the change they follow stands, and the hourly sweep repairs what
 * a failed hook left.
 */

/** Where a bot sits */
export type Place = { teamId: string } | { spaceId: string } | { pageId: string };

/** The notification type of what happens to a bot here */
export const SERVICE_ACCOUNT_NOTICE = 'service_account';

/** Org roles that may own a bot */
const OWNER_ROLES = ['OWNER', 'ADMIN', 'MEMBER'];

/** Org roles below which ownership lapses */
const LAPSING_ROLES = ['VIEWER', 'GUEST'];

/** How long one bot's check may take */
const CHECK_TIMEOUT_MS = 30_000;

/** How many rounds a check repairs in: leaving a space can mean leaving its team, nothing more */
const MAX_REPAIR_ROUNDS = 3;

type Tx = Prisma.TransactionClient;

/** What whoCanOpen reads with: a transaction, or the client when it only looks */
type OpenDb = Pick<
  Tx,
  | '$queryRaw'
  | 'teamMembership'
  | 'page'
  | 'wikiSpace'
  | 'orgMembership'
  | 'user'
  | 'spacePermission'
>;

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
 * Lock the bots among some users, in id order, so two transactions never take them crosswise.
 * @param tx - The transaction
 * @param userIds - The users
 * @returns The bots' ids
 */
export async function lockBots(tx: Tx, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const bots = await tx.user.findMany({
    where: { id: { in: userIds }, kind: 'SERVICE' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const bot of bots) await lockServiceAccount(tx, bot.id);
  return bots.map((b) => b.id);
}

/**
 * Of some users, those who can own a bot of the org now, with their org membership rows locked:
 * a demotion or removal waits until the transaction ends. OWNER rows first, then the rest, each
 * in userId order: the order withOwnersLocked and the admin role change take OWNER rows in, so a
 * check never holds one row while a writer holds the other.
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
    ORDER BY (m.role = 'OWNER') DESC, m."userId"
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
 * Of some users, those who can open a place: a member of the team; someone who can view the space;
 * for a page, someone who can view its space and passes its view restriction (listed, or an org
 * OWNER or ADMIN, or a platform admin).
 * @param db - The client: a transaction sees its own writes
 * @param place - The place
 * @param userIds - The users
 * @param lock - Lock what is read about them (FOR SHARE), in a transaction
 */
async function whoCanOpen(
  db: OpenDb,
  place: Place,
  userIds: string[],
  lock: boolean,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  if ('teamId' in place) {
    if (lock) {
      const rows = await db.$queryRaw<Array<{ userId: string }>>`
        SELECT "userId" FROM team_memberships
        WHERE "teamId" = ${place.teamId} AND "userId" = ANY(${userIds})
        ORDER BY "userId" FOR SHARE`;
      return rows.map((r) => r.userId);
    }
    const rows = await db.teamMembership.findMany({
      where: { teamId: place.teamId, userId: { in: userIds } },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }
  const page =
    'pageId' in place
      ? await db.page.findUnique({
          where: { id: place.pageId },
          select: {
            spaceId: true,
            space: { select: { team: { select: { orgId: true } } } },
            restrictions: { where: { type: 'VIEW' }, select: { userId: true } },
          },
        })
      : null;
  if ('pageId' in place && !page) return [];
  const spaceId = 'spaceId' in place ? place.spaceId : page!.spaceId;
  const space = await db.wikiSpace.findUnique({
    where: { id: spaceId },
    select: { teamId: true },
  });
  if (!space) return [];
  if (lock) {
    // What canAccessSpace reads about them, locked against a concurrent removal
    await db.$queryRaw`
      SELECT id FROM team_memberships
      WHERE "teamId" = ${space.teamId} AND "userId" = ANY(${userIds}) ORDER BY id FOR SHARE`;
    await db.$queryRaw`
      SELECT id FROM space_permissions
      WHERE "spaceId" = ${spaceId} AND "userId" = ANY(${userIds}) ORDER BY id FOR SHARE`;
  }
  const open: string[] = [];
  for (const userId of userIds) {
    if (!(await canAccessSpace(spaceId, userId, 'VIEW', db))) continue;
    if (
      page &&
      page.restrictions.length > 0 &&
      !page.restrictions.some((r) => r.userId === userId)
    ) {
      const [member, user] = await Promise.all([
        db.orgMembership.findUnique({
          where: { userId_orgId: { userId, orgId: page.space.team.orgId } },
          select: { role: true },
        }),
        db.user.findUnique({ where: { id: userId }, select: { isAdmin: true } }),
      ]);
      if (!user?.isAdmin && member?.role !== 'OWNER' && member?.role !== 'ADMIN') continue;
    }
    open.push(userId);
  }
  return open;
}

/**
 * Whether one of these owners can open a place, with the rows that say so locked.
 * @param tx - The transaction
 * @param place - The place
 * @param owners - The bot's eligible owners, their org memberships already locked
 */
async function ownerPresent(tx: Tx, place: Place, owners: string[]): Promise<boolean> {
  return (await whoCanOpen(tx, place, owners, true)).length > 0;
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

/** A place of a bot, as the notifications name it */
interface BotPlace {
  place: Place;
  name: string;
  /** The team whose admins are told: the team itself, or the space's or page's */
  teamId: string;
}

/** Which of a bot's places to check: all, a team with its spaces and pages, a space, a page */
type Scope = 'all' | Place;

/**
 * The places of a bot, all of them or those a scope covers: its teams, the spaces it can view
 * (through its own permission or a team-role grant), and the pages that list it.
 * @param tx - The transaction
 * @param botId - The bot's user id
 * @param scope - Which places
 */
async function placesOf(tx: Tx, botId: string, scope: Scope): Promise<BotPlace[]> {
  const all = scope === 'all';
  const teamId = !all && 'teamId' in scope ? scope.teamId : null;
  const spaceId = !all && 'spaceId' in scope ? scope.spaceId : null;
  const pageId = !all && 'pageId' in scope ? scope.pageId : null;

  const teams =
    all || teamId
      ? await tx.teamMembership.findMany({
          where: { userId: botId, ...(teamId ? { teamId } : {}) },
          select: { teamId: true, team: { select: { name: true } } },
          orderBy: { teamId: 'asc' },
        })
      : [];
  // Spaces it may view: its own permissions, and every space of a team it is in
  const spaceWhere: Prisma.WikiSpaceWhereInput | null = pageId
    ? null
    : {
        ...(spaceId ? { id: spaceId } : {}),
        ...(teamId ? { teamId } : {}),
        OR: [
          { permissions: { some: { userId: botId } } },
          { team: { members: { some: { userId: botId } } } },
        ],
      };
  const candidates = spaceWhere
    ? await tx.wikiSpace.findMany({
        where: spaceWhere,
        select: { id: true, name: true, teamId: true },
        orderBy: { id: 'asc' },
      })
    : [];
  const spaces: typeof candidates = [];
  for (const s of candidates) {
    if (await canAccessSpace(s.id, botId, 'VIEW', tx)) spaces.push(s);
  }
  const pages = await tx.page.findMany({
    where: {
      restrictions: { some: { userId: botId } },
      ...(pageId ? { id: pageId } : {}),
      ...(spaceId ? { spaceId } : {}),
      ...(teamId ? { space: { teamId } } : {}),
    },
    select: { id: true, title: true, space: { select: { teamId: true } } },
    orderBy: { id: 'asc' },
  });
  return [
    ...teams.map((t) => ({ place: { teamId: t.teamId }, name: t.team.name, teamId: t.teamId })),
    ...spaces.map((s) => ({ place: { spaceId: s.id }, name: s.name, teamId: s.teamId })),
    ...pages.map((p) => ({ place: { pageId: p.id }, name: p.title, teamId: p.space.teamId })),
  ];
}

/**
 * Refuse a bot that sits where none of its owners can open the place: the place itself and, for
 * a team, every space and page of it the bot can now reach. Run it in the transaction that writes
 * the membership, after the write, so the write's own effect is seen (the first permission on a
 * space closes it; a team brings its team-role grants).
 * @param botId - The bot's user id
 * @param place - The team, space or page
 * @param tx - The transaction; without one the check runs alone
 * @throws {AppError} 400 SERVICE_ACCOUNT_OWNER_NOT_MEMBER, 404 when the user is no bot
 */
export async function assertOwnerPresent(botId: string, place: Place, tx?: Tx): Promise<void> {
  if (!tx) return prisma.$transaction((inner) => assertOwnerPresent(botId, place, inner));
  const account = await lockServiceAccount(tx, botId);
  if (!account) throw new AppError(404, 'Service account not found', 'SERVICE_ACCOUNT_NOT_FOUND');
  const owners = await lockEligibleOwners(tx, account.orgId, await ownerRowIds(tx, botId));
  if (!(await ownerPresent(tx, place, owners))) throw OWNER_NOT_MEMBER();
  for (const p of await placesOf(tx, botId, place)) {
    if (!(await ownerPresent(tx, p.place, owners))) throw OWNER_NOT_MEMBER();
  }
}

/**
 * Refuse owners that would leave one of the bot's places with none of them able to open it.
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

/**
 * Owner rows a check removes first: one person's, or those of everyone no longer eligible. Or
 * cascaded: a delete already removed one, which counts as an owner lost.
 */
type Drop = { ownerId: string } | 'lapsed' | 'cascaded';

/** What happened to a bot's ownership in one check */
type OwnerChange = 'orphaned' | 'ownerless' | null;

/** What one check did, for the notifications sent after it commits */
interface Outcome {
  botId: string;
  orgId: string;
  owners: string[];
  removed: BotPlace[];
  ownerChange: OwnerChange;
}

/**
 * A bot has no owner left: cancel what it waits on, and suspend it with reason ORPHANED. A bot
 * already suspended by hand stays MANUAL, so that only resume lifts it, never a new owner.
 * @param tx - The transaction, with the bot's row locked
 * @param account - The locked row
 * @param lostOwner - Whether this check removed its last owner
 * @returns What changed, for the notice
 */
async function orphan(tx: Tx, account: LockedAccount, lostOwner: boolean): Promise<OwnerChange> {
  if (account.suspendedReason === 'ORPHANED') return null;
  await cancelPendingFor(account.userId, 'The service account has no owner left', tx);
  if (account.status === 'SUSPENDED') return lostOwner ? 'ownerless' : null;
  await tx.serviceAccount.update({
    where: { userId: account.userId },
    data: { status: 'SUSPENDED', suspendedReason: 'ORPHANED', suspendedAt: new Date() },
  });
  return 'orphaned';
}

/**
 * Take a bot out of a place none of its owners can open. A space it views through a team-role
 * grant, not its own permission, is left by leaving that team.
 * @param tx - The transaction, with the bot's row locked
 * @param botId - The bot's user id
 * @param p - The place
 * @returns The places it left
 */
async function leave(tx: Tx, botId: string, p: BotPlace): Promise<BotPlace[]> {
  const leaveTeam = async (teamId: string, name: string): Promise<BotPlace[]> => {
    await tx.issueWatcher.deleteMany({ where: { userId: botId, issue: { project: { teamId } } } });
    const gone = await tx.teamMembership.deleteMany({ where: { userId: botId, teamId } });
    return gone.count > 0 ? [{ place: { teamId }, name, teamId }] : [];
  };
  if ('teamId' in p.place) return leaveTeam(p.place.teamId, p.name);
  if ('pageId' in p.place) {
    const gone = await tx.pageRestriction.deleteMany({
      where: { userId: botId, pageId: p.place.pageId },
    });
    return gone.count > 0 ? [p] : [];
  }
  const spaceId = p.place.spaceId;
  const gone = await tx.spacePermission.deleteMany({ where: { userId: botId, spaceId } });
  const left: BotPlace[] = gone.count > 0 ? [p] : [];
  if (await canAccessSpace(spaceId, botId, 'VIEW', tx)) {
    const team = await tx.team.findUniqueOrThrow({
      where: { id: p.teamId },
      select: { name: true },
    });
    const viaTeam = await leaveTeam(p.teamId, team.name);
    if (left.length === 0 && viaTeam.length > 0) left.push(p);
    left.push(...viaTeam);
  }
  return left;
}

/**
 * Check a bot's places under its lock: leave each one none of its owners can open, and orphan
 * the bot when it has no owner at all.
 * @param botId - The bot's user id
 * @param scope - Which places
 * @param drop - Owner rows to remove first: one whose ownership lapsed, or every lapsed one
 */
async function reconcile(botId: string, scope: Scope, drop?: Drop): Promise<void> {
  const outcome = await prisma.$transaction(
    async (tx): Promise<Outcome | null> => {
      const account = await lockServiceAccount(tx, botId);
      if (!account) return null;
      // A delete's cascade already took the owner row: it was lost all the same
      let lostOwner = drop === 'cascaded';
      if (drop && typeof drop === 'object') {
        const gone = await tx.serviceAccountOwner.deleteMany({
          where: { serviceAccountId: botId, ownerId: drop.ownerId },
        });
        lostOwner = gone.count > 0;
      }
      const rowIds = await ownerRowIds(tx, botId);
      const owners = await lockEligibleOwners(tx, account.orgId, rowIds);
      if (drop === 'lapsed') {
        const lapsed = rowIds.filter((id) => !owners.includes(id));
        if (lapsed.length > 0) {
          await tx.serviceAccountOwner.deleteMany({
            where: { serviceAccountId: botId, ownerId: { in: lapsed } },
          });
          lostOwner = true;
        }
      }
      const outcome: Outcome = {
        botId,
        orgId: account.orgId,
        owners,
        removed: [],
        ownerChange: null,
      };
      // A bot with no owner keeps its places, suspended, until an owner who is there comes back
      if (owners.length === 0) {
        outcome.ownerChange = await orphan(tx, account, lostOwner);
        return outcome;
      }
      for (let round = 0; round < MAX_REPAIR_ROUNDS; round++) {
        const missing: BotPlace[] = [];
        for (const p of await placesOf(tx, botId, scope)) {
          if (!(await ownerPresent(tx, p.place, owners))) missing.push(p);
        }
        if (missing.length === 0) break;
        for (const p of missing) outcome.removed.push(...(await leave(tx, botId, p)));
      }
      return outcome;
    },
    // A bot in many places with several owners takes many reads: past Prisma's default 5 s the
    // check would fail for that bot every hour
    { timeout: CHECK_TIMEOUT_MS },
  );
  if (!outcome) return;
  if (outcome.removed.length > 0) void revokeLiveAccess({ userId: botId });
  await tell(outcome);
}

/**
 * Tell who should know: of the owners and the team's admins, those who can open a place the bot
 * left (no one learns the name of a place they can't open), and the org's owners and admins when
 * the bot lost its last owner. Best effort: the change stands either way.
 * @param outcome - What the check did
 */
async function tell(outcome: Outcome): Promise<void> {
  if (outcome.removed.length === 0 && !outcome.ownerChange) return;
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
      const candidates = [...new Set([...outcome.owners, ...admins.map((a) => a.userId)])];
      for (const userId of await whoCanOpen(prisma, p.place, candidates, false)) {
        await createNotification(
          userId,
          SERVICE_ACCOUNT_NOTICE,
          `${name} left ${p.name}: none of its owners can open it`,
        );
      }
    }
    if (outcome.ownerChange) {
      const admins = await prisma.orgMembership.findMany({
        where: { orgId: outcome.orgId, role: { in: ['OWNER', 'ADMIN'] }, user: { kind: 'PERSON' } },
        select: { userId: true },
      });
      const title =
        outcome.ownerChange === 'orphaned'
          ? `${name} was suspended: it has no owner left`
          : `${name} has no owner left and stays suspended`;
      for (const { userId } of admins) {
        await createNotification(
          userId,
          SERVICE_ACCOUNT_NOTICE,
          title,
          'Give it an owner to answer for it',
        );
      }
    }
  } catch (err) {
    logger.error('telling about a service account failed', { botId: outcome.botId }, err as Error);
  }
}

/**
 * Run a hook's work and log what fails instead of throwing: the change it follows has committed,
 * and the sweep repairs what is left.
 * @param what - What is checked, for the log
 * @param work - The work
 * @returns Whether it ran without failing
 */
async function safely(what: string, work: () => Promise<void>): Promise<boolean> {
  try {
    await work();
    return true;
  } catch (err) {
    logger.error('a service account check failed; the sweep repairs it', { what }, err as Error);
    return false;
  }
}

/**
 * Check one bot, logging a failure.
 * @param botId - The bot's user id
 * @param scope - Which places
 * @param drop - Owner rows to remove first
 */
function recheck(botId: string, scope: Scope, drop?: Drop): Promise<boolean> {
  return safely(`bot ${botId}`, () => reconcile(botId, scope, drop));
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
 * The bots a user has an owner row for, in every org: read before a delete cascades them away.
 * @param userId - The user
 */
export async function botIdsOwnedBy(userId: string): Promise<string[]> {
  const rows = await prisma.serviceAccountOwner.findMany({
    where: { ownerId: userId },
    select: { serviceAccountId: true },
    orderBy: { serviceAccountId: 'asc' },
  });
  return rows.map((r) => r.serviceAccountId);
}

/**
 * The org a team belongs to.
 * @param teamId - The team
 */
async function orgOfTeam(teamId: string): Promise<string | null> {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { orgId: true } });
  return team?.orgId ?? null;
}

/**
 * After a person left a team, or their role in it or in the org changed: each bot they own leaves
 * the team, and the team's spaces and pages, that none of its owners can open anymore. With an
 * org, every place of their bots is checked. Run it after the change commits.
 * @param userId - The person
 * @param place - The team, or the whole org
 */
export async function onOwnerLeft(
  userId: string,
  place: { teamId: string } | { orgId: string },
): Promise<void> {
  await safely(`owner ${userId}`, async () => {
    const orgId = 'orgId' in place ? place.orgId : await orgOfTeam(place.teamId);
    if (!orgId) return;
    for (const botId of await botsOwnedIn(userId, orgId)) {
      await recheck(botId, 'orgId' in place ? 'all' : place);
    }
  });
}

/**
 * After a space's permissions changed: the first one closes the space to everyone not listed, a
 * team-role grant opens it to a bot of the team, and taking one away can leave an owner out.
 * Each bot that may view it (its own permission, or a member of its team) is checked; one whose
 * owners can't open it loses its permission, or leaves the team (decision 13).
 * @param spaceId - The space
 */
export async function onSpaceChanged(spaceId: string): Promise<void> {
  await safely(`space ${spaceId}`, async () => {
    const space = await prisma.wikiSpace.findUnique({
      where: { id: spaceId },
      select: { teamId: true },
    });
    if (!space) return;
    const bots = await prisma.user.findMany({
      where: {
        kind: 'SERVICE',
        OR: [
          { spacePermissions: { some: { spaceId } } },
          { teamMemberships: { some: { teamId: space.teamId } } },
        ],
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const bot of bots) await recheck(bot.id, { spaceId });
  });
}

/**
 * After a page's restrictions changed: each bot listed on it needs an owner who can open the page
 * with the new lists, or it comes off the page.
 * @param pageId - The page
 */
export async function onPageChanged(pageId: string): Promise<void> {
  await safely(`page ${pageId}`, async () => {
    const rows = await prisma.pageRestriction.findMany({
      where: { pageId, user: { kind: 'SERVICE' } },
      select: { userId: true },
      distinct: ['userId'],
      orderBy: { userId: 'asc' },
    });
    for (const row of rows) if (row.userId) await recheck(row.userId, { pageId });
  });
}

/**
 * A person's ownership of their bots in an org lapsed: they left it, were demoted to VIEWER or
 * GUEST, or were deactivated. They stop being an owner; a bot left with no owner is suspended
 * (ORPHANED, or stays MANUAL), its requests cancelled and the org's owners and admins told; a bot
 * that keeps owners leaves the places none of them can open.
 * @param userId - The person
 * @param orgId - The org
 */
export async function onOwnershipLapse(userId: string, orgId: string): Promise<void> {
  await safely(`lapse ${userId}`, async () => {
    for (const botId of await botsOwnedIn(userId, orgId)) {
      await recheck(botId, 'all', { ownerId: userId });
    }
  });
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
 * A person's ownership lapsed in every org they own a bot in (deactivated).
 * @param userId - The person
 */
export async function onOwnershipLapseEverywhere(userId: string): Promise<void> {
  await safely(`lapse ${userId}`, async () => {
    const orgs = await prisma.serviceAccountOwner.findMany({
      where: { ownerId: userId },
      select: { serviceAccount: { select: { orgId: true } } },
    });
    for (const orgId of new Set(orgs.map((o) => o.serviceAccount.orgId))) {
      await onOwnershipLapse(userId, orgId);
    }
  });
}

/**
 * Check every place of some bots: after a delete cascaded an owner's rows away.
 * @param botIds - The bots
 * @param opts - What happened to them
 * @param opts.lostOwner - Each lost an owner row to the cascade, so a bot already suspended by
 * hand that has none left is reported as ownerless
 */
export async function recheckBots(
  botIds: string[],
  opts: { lostOwner?: boolean } = {},
): Promise<void> {
  for (const botId of botIds) await recheck(botId, 'all', opts.lostOwner ? 'cascaded' : undefined);
}

/**
 * The hourly backstop for the hooks above, which log and move on when they fail: every active
 * bot drops the owner rows of people who can no longer own it, leaves each team, space and page
 * none of its owners can open, and is suspended as ORPHANED when no owner is left. The same
 * check the hooks run, over every place; one bot's failure is logged and the next is checked,
 * and the count of failures is logged at the end.
 * @returns How many bots were checked
 */
export async function sweepServiceAccounts(): Promise<number> {
  const bots = await prisma.serviceAccount.findMany({
    where: { status: 'ACTIVE' },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  });
  let failed = 0;
  for (const { userId } of bots) {
    if (!(await recheck(userId, 'all', 'lapsed'))) failed++;
  }
  if (failed > 0) {
    logger.warn('the service account sweep left bots unrepaired', {
      checked: bots.length,
      failed,
    });
  }
  return bots.length;
}
