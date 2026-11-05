import type { OrgRole } from '@prisma/client';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { ERR } from '../../utils/error-messages';
import { findOrThrow } from '../../utils/find-or-throw';
import { USER_BASIC_SELECT } from '../../utils/prisma-selects';
import { assertCanGrantOrgRole } from '../orgs/org-roles';

/**
 * Create an invitation for a user to join an org (and optionally a team).
 * @param orgId
 * @param invitedBy
 * @param data
 * @param data.email
 * @param data.role
 * @param data.teamId
 */
export async function createInvitation(
  orgId: string,
  invitedBy: string,
  data: { email: string; role?: string; teamId?: string },
) {
  await findOrThrow(
    prisma.organization.findUnique({ where: { id: orgId }, select: { id: true } }),
    ERR.ORGANIZATION_NOT_FOUND,
  );
  // Check for existing pending invitation with same email+org+team
  const existing = await prisma.invitation.findFirst({
    where: {
      email: data.email,
      orgId,
      teamId: data.teamId ?? null,
      status: 'PENDING',
    },
  });
  if (existing) throw new AppError(409, 'An invitation for this email is already pending');

  // A team invite carries a team role; an org invite an org role no higher than the inviter's
  if (data.teamId) {
    if (data.role && !['ADMIN', 'MEMBER', 'VIEWER'].includes(data.role)) {
      throw new AppError(400, 'A team invitation role must be ADMIN, MEMBER or VIEWER');
    }
  } else {
    await assertCanGrantOrgRole(orgId, invitedBy, (data.role ?? 'MEMBER') as OrgRole);
  }

  // If teamId provided, verify team belongs to org
  if (data.teamId) {
    const team = await findOrThrow(
      prisma.team.findUnique({ where: { id: data.teamId } }),
      ERR.TEAM_NOT_FOUND,
    );
    if (team.orgId !== orgId) throw new AppError(400, 'Team does not belong to this organization');
  }

  // Check if user with this email is already a member
  const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingUser) {
    const orgMembership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: existingUser.id, orgId } },
    });
    if (orgMembership && !data.teamId) {
      throw new AppError(409, 'User is already an org member');
    }
    if (data.teamId) {
      const teamMembership = await prisma.teamMembership.findUnique({
        where: { userId_teamId: { userId: existingUser.id, teamId: data.teamId } },
      });
      if (teamMembership) throw new AppError(409, 'User is already a team member');
    }
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  return prisma.invitation.create({
    data: {
      email: data.email,
      orgId,
      teamId: data.teamId,
      role: data.role ?? 'MEMBER',
      invitedBy,
      expiresAt,
    },
    include: {
      inviter: { select: USER_BASIC_SELECT },
      org: { select: { id: true, name: true, slug: true } },
      team: { select: { id: true, name: true, slug: true } },
    },
  });
}

/**
 * List pending invitations for an organization, optionally filtered by team.
 * @param orgId
 * @param teamId
 */
export async function listInvitations(orgId: string, teamId?: string) {
  const where: { orgId: string; teamId?: string | null } = { orgId };
  if (teamId) where.teamId = teamId;

  return prisma.invitation.findMany({
    where,
    include: {
      inviter: { select: USER_BASIC_SELECT },
      org: { select: { id: true, name: true, slug: true } },
      team: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Revoke (delete) a pending invitation.
 * @param invitationId
 * @param orgId
 */
export async function revokeInvitation(invitationId: string, orgId: string) {
  const invitation = await findOrThrow(
    prisma.invitation.findUnique({ where: { id: invitationId } }),
    ERR.INVITATION_NOT_FOUND,
  );
  if (invitation.orgId !== orgId) throw new AppError(403, 'Invitation does not belong to this org');
  if (invitation.status !== 'PENDING')
    throw new AppError(400, 'Only pending invitations can be revoked');

  await prisma.invitation.delete({ where: { id: invitationId } });
}

/**
 * Accept an invitation by token. Adds the user to org and optionally team.
 * @param token
 * @param userId
 */
export async function acceptInvitation(token: string, userId: string) {
  const invitation = await findOrThrow(
    prisma.invitation.findUnique({
      where: { token },
      include: {
        org: { select: { id: true, name: true, slug: true } },
        team: { select: { id: true, name: true, slug: true } },
      },
    }),
    'Invitation not found or invalid',
  );

  if (invitation.status !== 'PENDING') throw new AppError(400, 'Invitation is no longer valid');
  if (invitation.expiresAt < new Date()) {
    await prisma.invitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
    throw new AppError(400, 'Invitation has expired');
  }

  // Verify the accepting user's email matches
  const user = await findOrThrow(
    prisma.user.findUnique({ where: { id: userId } }),
    ERR.USER_NOT_FOUND,
  );
  if (user.email !== invitation.email) {
    throw new AppError(403, 'This invitation was sent to a different email address');
  }

  // Add to org if not already a member
  const existingOrgMembership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: invitation.orgId } },
  });
  if (!existingOrgMembership) {
    await prisma.orgMembership.create({
      data: {
        userId,
        orgId: invitation.orgId,
        role: invitation.teamId
          ? 'MEMBER'
          : (invitation.role as 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST'),
      },
    });
  }

  // Add to team if specified
  if (invitation.teamId) {
    const existingTeamMembership = await prisma.teamMembership.findUnique({
      where: { userId_teamId: { userId, teamId: invitation.teamId } },
    });
    if (!existingTeamMembership) {
      await prisma.teamMembership.create({
        data: {
          userId,
          teamId: invitation.teamId,
          role: invitation.role as 'ADMIN' | 'MEMBER' | 'VIEWER',
        },
      });
    }
  }

  // Mark invitation as accepted
  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { status: 'ACCEPTED' },
  });

  return { org: invitation.org, team: invitation.team };
}
