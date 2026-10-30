/**
 * Org reads need membership; roles can only be granted up to the actor's own; OWNERs are
 * managed only by OWNERs; an org always keeps an OWNER; invite ids are scoped to the org.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authGet, authPatch, authPost } from '../../test/helpers';

describe('Org access and roles', () => {
  let ctx: TestContext;
  let other: TestContext;
  let admin: TestUser;
  let member: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    ctx = await createTestContext(`orgroles${Date.now()}`);
    other = await createTestContext(`orgrolesx${Date.now()}`);
    admin = await addMemberToContext(ctx);
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: admin.id, orgId: ctx.orgId } },
      data: { role: 'ADMIN' },
    });
    member = await addMemberToContext(ctx);
    stranger = await createTestUser();
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await cleanupTestContext(other);
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, member.id, stranger.id] } } });
  });

  it('H: refuses org details and members to non-members', async () => {
    const results = await Promise.all([
      authGet(`/api/orgs/${ctx.orgId}`, stranger.token),
      authGet(`/api/orgs/${ctx.orgId}/members`, stranger.token),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403]);
    expect(JSON.stringify(results.map((r) => r.body))).not.toContain('@test.dev');
    expect((await authGet(`/api/orgs/${ctx.orgId}/members`, member.token)).status).toBe(200);
  });

  it("I: refuses to delete another org's invite link", async () => {
    const link = await prisma.inviteLink.create({
      data: { code: `x${Date.now()}`, orgId: other.orgId, createdBy: other.owner.id },
    });
    const res = await authDel(`/api/orgs/${ctx.orgId}/invites/${link.id}`, ctx.owner.token);
    expect(res.status).toBe(404);
    expect(await prisma.inviteLink.count({ where: { id: link.id } })).toBe(1);
  });

  it('J: an ADMIN cannot create, demote or remove OWNERs', async () => {
    const t = admin.token;
    const promoteSelf = await authPatch(`/api/orgs/${ctx.orgId}/members/${admin.id}`, t, {
      role: 'OWNER',
    });
    const promoteOther = await authPatch(`/api/orgs/${ctx.orgId}/members/${member.id}`, t, {
      role: 'OWNER',
    });
    const demoteOwner = await authPatch(`/api/orgs/${ctx.orgId}/members/${ctx.owner.id}`, t, {
      role: 'MEMBER',
    });
    const removeOwner = await authDel(`/api/orgs/${ctx.orgId}/members/${ctx.owner.id}`, t);
    expect([promoteSelf, promoteOther, demoteOwner, removeOwner].map((r) => r.status)).toEqual([
      403, 403, 403, 403,
    ]);
    const owner = await prisma.orgMembership.findUniqueOrThrow({
      where: { userId_orgId: { userId: ctx.owner.id, orgId: ctx.orgId } },
    });
    expect(owner.role).toBe('OWNER');
  });

  it('J: the last OWNER cannot demote themselves', async () => {
    const res = await authPatch(`/api/orgs/${ctx.orgId}/members/${ctx.owner.id}`, ctx.owner.token, {
      role: 'ADMIN',
    });
    expect(res.status).toBe(400);
  });

  it('K: an ADMIN cannot mint OWNER invites, and team invites need a team role', async () => {
    const link = await authPost(`/api/orgs/${ctx.orgId}/invites`, admin.token, { role: 'OWNER' });
    const invite = await authPost(`/api/orgs/${ctx.orgId}/invitations`, admin.token, {
      email: `owner-${Date.now()}@test.dev`,
      role: 'OWNER',
    });
    const teamInvite = await authPost(`/api/orgs/${ctx.orgId}/invitations`, ctx.owner.token, {
      email: `team-${Date.now()}@test.dev`,
      role: 'GUEST',
      teamId: ctx.teamId,
    });
    expect([link.status, invite.status, teamInvite.status]).toEqual([403, 403, 400]);
    const ok = await authPost(`/api/orgs/${ctx.orgId}/invites`, admin.token, { role: 'MEMBER' });
    expect(ok.status).toBe(201);
  });
});
