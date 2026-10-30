/**
 * Org reads need membership; roles can only be granted up to the actor's own; OWNERs are
 * managed only by OWNERs; an org always keeps an OWNER; invite ids are scoped to the org.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
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

  it('3: two OWNERs demoting each other at once still leave one OWNER', async () => {
    const second = await addMemberToContext(ctx);
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: second.id, orgId: ctx.orgId } },
      data: { role: 'OWNER' },
    });
    try {
      for (let round = 0; round < 5; round++) {
        await prisma.orgMembership.updateMany({
          where: { orgId: ctx.orgId, userId: { in: [ctx.owner.id, second.id] } },
          data: { role: 'OWNER' },
        });
        const results = await Promise.all([
          authPatch(`/api/orgs/${ctx.orgId}/members/${second.id}`, ctx.owner.token, {
            role: 'ADMIN',
          }),
          authPatch(`/api/orgs/${ctx.orgId}/members/${ctx.owner.id}`, second.token, {
            role: 'ADMIN',
          }),
        ]);
        const owners = await prisma.orgMembership.count({
          where: { orgId: ctx.orgId, role: 'OWNER' },
        });
        expect(owners, `round ${round}: ${results.map((r) => r.status)}`).toBeGreaterThanOrEqual(1);
      }
    } finally {
      await prisma.orgMembership.updateMany({
        where: { orgId: ctx.orgId, userId: ctx.owner.id },
        data: { role: 'OWNER' },
      });
      await prisma.user.deleteMany({ where: { id: second.id } });
    }
  });

  it('19: org details hide emails from non-admins and other teams from GUESTs; team lists hide closed spaces', async () => {
    const guest = await addMemberToContext(ctx);
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: guest.id, orgId: ctx.orgId } },
      data: { role: 'GUEST' },
    });
    const hiddenTeam = await prisma.team.create({
      data: { orgId: ctx.orgId, name: 'Hidden team', slug: `hidden-${Date.now()}` },
    });
    const closed = await prisma.wikiSpace.create({
      data: {
        teamId: ctx.teamId,
        name: `ClosedSpace${Date.now()}`,
        slug: `closed-${Date.now()}`,
        permissions: { create: { userId: ctx.owner.id, level: 'ADMIN' } },
      },
    });
    try {
      const asMember = await authGet(`/api/orgs/${ctx.orgId}`, member.token);
      expect(JSON.stringify(asMember.body)).not.toContain('@test.dev');
      const asOwner = await authGet(`/api/orgs/${ctx.orgId}`, ctx.owner.token);
      expect(JSON.stringify(asOwner.body)).toContain('@test.dev');

      const asGuest = await authGet(`/api/orgs/${ctx.orgId}`, guest.token);
      expect(JSON.stringify(asGuest.body)).not.toContain(hiddenTeam.id);

      const teams = await authGet(`/api/teams/org/${ctx.orgId}`, member.token);
      expect(JSON.stringify(teams.body)).not.toContain(closed.name);
    } finally {
      await prisma.user.deleteMany({ where: { id: guest.id } });
    }
  });

  it('21: an OWNER invite link minted by a non-OWNER does not make OWNERs', async () => {
    const code = `legacy${Date.now()}`;
    await prisma.inviteLink.create({
      data: { code, orgId: ctx.orgId, createdBy: admin.id, role: 'OWNER', maxUses: 5 },
    });
    const username = `legacy-${Date.now()}`;
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        email: `${username}@test.dev`,
        username,
        displayName: 'Legacy',
        password: 'testpassword123',
        inviteCode: code,
      });
    expect(res.status).toBeLessThan(300);
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const membership = await prisma.orgMembership.findUniqueOrThrow({
      where: { userId_orgId: { userId: user.id, orgId: ctx.orgId } },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(membership.role).toBe('ADMIN');
  });
});
