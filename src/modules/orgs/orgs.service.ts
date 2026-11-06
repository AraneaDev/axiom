import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { revokeLiveAccess } from '../../realtime/access-revocation';
import { checkUnique } from '../../utils/check-unique';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { isIntegrationUser } from '../github/integration-user';

import {
  assertCanGrantOrgRole,
  assertCanManageOrgMember,
  assertNotLastOwnerTx,
  withOwnersLocked,
} from './org-roles';

/**
 * Create a new organization, adding the creator as owner.
 * @param userId - The user creating the org (becomes owner)
 * @param data - Org creation data including name, slug, and optional description
 * @param data.name
 * @param data.slug
 * @param data.description
 * @returns The created organization with members
 * @throws {AppError} 409 if organization slug already taken
 */
export async function createOrg(
  userId: string,
  data: { name: string; slug: string; description?: string },
) {
  await checkUnique('organization', { slug: data.slug }, 'Organization slug already taken');

  const org = await prisma.organization.create({
    data: {
      name: data.name,
      slug: data.slug,
      description: data.description,
      members: {
        create: { userId, role: 'OWNER' },
      },
    },
    include: {
      members: { include: { user: { select: USER_BASIC_SELECT } } },
    },
  });

  return org;
}

/**
 * Retrieve an organization by ID with teams and members.
 * @param orgId - The organization ID
 * @param viewerId
 * @returns The organization with teams and member details
 * @throws {AppError} 404 if organization not found
 */
export async function getOrg(orgId: string, viewerId?: string) {
  const org = await findOrThrow(
    prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        teams: {
          select: {
            id: true,
            name: true,
            slug: true,
            members: { select: { userId: true } },
          },
        },
        members: {
          include: {
            user: { select: { id: true, username: true, displayName: true, email: true } },
          },
        },
      },
    }),
    ERR.ORGANIZATION_NOT_FOUND,
  );
  if (!viewerId) return org;
  // Emails are for org OWNERs and ADMINs and platform admins; a GUEST only sees the teams
  // they belong to
  const role = org.members.find((m) => m.userId === viewerId)?.role;
  const viewer = await prisma.user.findUnique({
    where: { id: viewerId },
    select: { isAdmin: true },
  });
  const admin = role === 'OWNER' || role === 'ADMIN' || viewer?.isAdmin === true;
  return {
    ...org,
    teams: org.teams
      .filter((t) => role !== 'GUEST' || t.members.some((m) => m.userId === viewerId))
      .map(({ members: _members, ...team }) => team),
    members: org.members.map((m) => (admin ? m : { ...m, user: { ...m.user, email: undefined } })),
  };
}

/**
 * List all organizations a user is a member of with their roles.
 * @param userId - The user ID
 * @returns List of organizations with the user's role in each
 */
export async function listUserOrgs(userId: string) {
  const memberships = await prisma.orgMembership.findMany({
    where: { userId },
    include: {
      org: { select: { id: true, name: true, slug: true, description: true } },
    },
  });
  return memberships.map((m: (typeof memberships)[number]) => ({ ...m.org, role: m.role }));
}

/**
 * Update an organization's name or description.
 * @param orgId - The organization ID
 * @param data - Partial update data for name and/or description
 * @param data.name
 * @param data.description
 * @returns The updated organization record
 */
export async function updateOrg(orgId: string, data: { name?: string; description?: string }) {
  await assertOrgExists(orgId);
  return prisma.organization.update({ where: { id: orgId }, data });
}

/**
 * Throw the 404 for an org that does not exist, as a platform admin passes the permission check
 * on any id.
 * @param orgId - The organization ID
 * @throws {AppError} 404
 */
async function assertOrgExists(orgId: string): Promise<void> {
  await findOrThrow(
    prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }),
    ERR.ORGANIZATION_NOT_FOUND,
  );
}

/**
 * Delete an organization and all its associated data.
 * @param orgId - The organization ID
 */
export async function deleteOrg(orgId: string) {
  await assertOrgExists(orgId);
  await prisma.organization.delete({ where: { id: orgId } });
}

/**
 * List all members of an organization.
 * @param orgId - The organization ID
 * @returns List of org memberships with user details
 */
export async function listOrgMembers(orgId: string) {
  return prisma.orgMembership.findMany({
    where: { orgId },
    include: { user: { select: USER_BASIC_SELECT } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Add a user as a member of an organization.
 * @param orgId - The organization ID
 * @param userId - The user to add
 * @param role - The org role to assign (defaults to MEMBER)
 * @param actorId
 * @returns The created org membership with user details
 * @throws {AppError} 409 if user is already a member
 */
export async function addOrgMember(
  orgId: string,
  userId: string,
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST' = 'MEMBER',
  actorId?: string,
) {
  await assertOrgExists(orgId);
  if (isIntegrationUser(userId)) {
    throw new AppError(400, 'The GitHub integration user cannot join an organization');
  }
  if (actorId) await assertCanGrantOrgRole(orgId, actorId, role);
  await checkUnique('orgMembership', { userId, orgId }, 'User is already a member');

  return prisma.orgMembership.create({
    data: { userId, orgId, role },
    include: { user: { select: USER_BASIC_SELECT } },
  });
}

/**
 * Update an org member's role.
 * @param orgId - The organization ID
 * @param memberId - The user whose role to update
 * @param role - The new organization role
 * @param actorId
 * @returns The updated org membership record
 * @throws {AppError} 404 if membership not found
 */
export async function updateOrgMemberRole(
  orgId: string,
  memberId: string,
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST',
  actorId?: string,
) {
  const membership = await findOrThrow(
    prisma.orgMembership.findFirst({
      where: { userId: memberId, orgId },
    }),
    ERR.MEMBERSHIP_NOT_FOUND,
  );
  if (actorId) {
    await assertCanManageOrgMember(orgId, actorId, membership.role);
    await assertCanGrantOrgRole(orgId, actorId, role);
  }
  // Re-read and check under the OWNER lock: a concurrent demotion could otherwise leave
  // the org with no OWNER
  const updated = await withOwnersLocked(orgId, async (tx) => {
    const current = await tx.orgMembership.findUniqueOrThrow({ where: { id: membership.id } });
    if (current.role === 'OWNER' && role !== 'OWNER') await assertNotLastOwnerTx(tx, orgId);
    return tx.orgMembership.update({ where: { id: membership.id }, data: { role } });
  });
  // A lower role can lose org-wide access (an OWNER or ADMIN sees every space and page)
  void revokeLiveAccess({ userId: memberId });
  return updated;
}

/**
 * Remove a member from an organization (cannot remove the last owner).
 * @param orgId - The organization ID
 * @param memberId - The user to remove
 * @param actorId
 * @throws {AppError} 404 if membership not found
 * @throws {AppError} 400 if attempting to remove the last owner
 */
export async function removeOrgMember(orgId: string, memberId: string, actorId?: string) {
  const membership = await findOrThrow(
    prisma.orgMembership.findFirst({
      where: { userId: memberId, orgId },
    }),
    ERR.MEMBERSHIP_NOT_FOUND,
  );
  if (actorId) await assertCanManageOrgMember(orgId, actorId, membership.role);
  // Everything the org granted goes with the membership, in one transaction: team
  // memberships (project access), space permissions and page allow-list entries naming the
  // user, issue watches (which would keep sending them notifications) and page stars. The
  // last-OWNER check runs under the OWNER lock in the same transaction.
  const inOrgTeams = { team: { orgId } };
  await withOwnersLocked(orgId, async (tx) => {
    const current = await tx.orgMembership.findUniqueOrThrow({ where: { id: membership.id } });
    if (current.role === 'OWNER') await assertNotLastOwnerTx(tx, orgId);
    await tx.teamMembership.deleteMany({ where: { userId: memberId, ...inOrgTeams } });
    await tx.spacePermission.deleteMany({ where: { userId: memberId, space: inOrgTeams } });
    await tx.pageRestriction.deleteMany({
      where: { userId: memberId, page: { space: inOrgTeams } },
    });
    await tx.issueWatcher.deleteMany({
      where: { userId: memberId, issue: { project: inOrgTeams } },
    });
    await tx.starredPage.deleteMany({ where: { userId: memberId, page: { space: inOrgTeams } } });
    await tx.orgMembership.delete({ where: { id: membership.id } });
  });
  // Open sockets checked access when they joined: re-check them (not awaited)
  void revokeLiveAccess({ userId: memberId });
}

// ─── Invite Links ─────────────────────────────────────────────

/**
 * Create a new invite link for an organization with configurable role, max uses, and expiry.
 * @param orgId - The organization ID
 * @param createdBy - The user creating the invite link
 * @param data - Invite options including role, max uses, and expiry in days
 * @param data.role
 * @param data.maxUses
 * @param data.expiresInDays
 * @returns The created invite link record with code
 */
export async function createInviteLink(
  orgId: string,
  createdBy: string,
  data: {
    role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST';
    maxUses?: number;
    expiresInDays?: number;
  },
) {
  await assertCanGrantOrgRole(orgId, createdBy, data.role ?? 'MEMBER');
  const code = (await import('crypto')).randomBytes(16).toString('hex');
  return prisma.inviteLink.create({
    data: {
      code,
      orgId,
      createdBy,
      role: data.role ?? 'MEMBER',
      maxUses: data.maxUses ?? 1,
      expiresAt: data.expiresInDays
        ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
        : null,
    },
  });
}

/**
 * List all invite links for an organization.
 * @param orgId - The organization ID
 * @returns List of invite link records ordered by creation date
 */
export async function listInviteLinks(orgId: string) {
  return prisma.inviteLink.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Delete an invite link.
 * @param orgId
 * @param inviteId - The invite link ID
 * @throws {AppError} 404 if invite link not found
 */
export async function deleteInviteLink(orgId: string, inviteId: string) {
  // Scoped to the org in the URL: an admin of one org can't delete another org's links
  await findOrThrow(
    prisma.inviteLink.findFirst({ where: { id: inviteId, orgId } }),
    'Invite link not found',
  );
  await prisma.inviteLink.delete({ where: { id: inviteId } });
}
