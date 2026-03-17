import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export async function createOrg(userId: string, data: { name: string; slug: string; description?: string }) {
  const existing = await prisma.organization.findUnique({ where: { slug: data.slug } });
  if (existing) throw new AppError(409, 'Organization slug already taken');

  const org = await prisma.organization.create({
    data: {
      name: data.name,
      slug: data.slug,
      description: data.description,
      members: {
        create: { userId, role: 'OWNER' },
      },
    },
    include: { members: { include: { user: { select: { id: true, username: true, displayName: true } } } } },
  });

  return org;
}

export async function getOrg(orgId: string) {
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      teams: { select: { id: true, name: true, slug: true } },
      members: {
        include: { user: { select: { id: true, username: true, displayName: true, email: true } } },
      },
    },
  });
  if (!org) throw new AppError(404, 'Organization not found');
  return org;
}

export async function listUserOrgs(userId: string) {
  const memberships = await prisma.orgMembership.findMany({
    where: { userId },
    include: {
      org: { select: { id: true, name: true, slug: true, description: true } },
    },
  });
  return memberships.map((m) => ({ ...m.org, role: m.role }));
}

export async function updateOrg(orgId: string, data: { name?: string; description?: string }) {
  return prisma.organization.update({ where: { id: orgId }, data });
}

export async function deleteOrg(orgId: string) {
  await prisma.organization.delete({ where: { id: orgId } });
}

export async function addOrgMember(orgId: string, userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST' = 'MEMBER') {
  const existing = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId } },
  });
  if (existing) throw new AppError(409, 'User is already a member');

  return prisma.orgMembership.create({
    data: { userId, orgId, role },
    include: { user: { select: { id: true, username: true, displayName: true } } },
  });
}

export async function updateOrgMemberRole(orgId: string, memberId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST') {
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: memberId, orgId },
  });
  if (!membership) throw new AppError(404, 'Membership not found');

  return prisma.orgMembership.update({
    where: { id: membership.id },
    data: { role },
  });
}

export async function removeOrgMember(orgId: string, memberId: string) {
  const membership = await prisma.orgMembership.findFirst({
    where: { userId: memberId, orgId },
  });
  if (!membership) throw new AppError(404, 'Membership not found');
  if (membership.role === 'OWNER') {
    const ownerCount = await prisma.orgMembership.count({
      where: { orgId, role: 'OWNER' },
    });
    if (ownerCount <= 1) throw new AppError(400, 'Cannot remove the last owner');
  }
  await prisma.orgMembership.delete({ where: { id: membership.id } });
}

// ─── Invite Links ─────────────────────────────────────────────

export async function createInviteLink(orgId: string, createdBy: string, data: {
  role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' | 'GUEST';
  maxUses?: number;
  expiresInDays?: number;
}) {
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

export async function listInviteLinks(orgId: string) {
  return prisma.inviteLink.findMany({
    where: { orgId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function deleteInviteLink(inviteId: string) {
  const invite = await prisma.inviteLink.findUnique({ where: { id: inviteId } });
  if (!invite) throw new AppError(404, 'Invite link not found');
  await prisma.inviteLink.delete({ where: { id: inviteId } });
}
