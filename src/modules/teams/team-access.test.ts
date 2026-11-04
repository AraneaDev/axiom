/**
 * Team-wide reads need team membership (or org OWNER/ADMIN, or platform admin), project
 * settings need the matching role, and team activity stays within the team's resources.
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
import { callTool, withMcpClient } from '../../test/mcp-client';

describe('Team access', () => {
  let ctx: TestContext;
  let other: TestContext;
  let orgOnly: TestUser;
  let guest: TestUser;
  let teamViewer: TestUser;
  let teamMember: TestUser;
  let secondTeamId: string;
  let foreignIssueId: string;
  const SECRET = `TeamSecret-${Date.now()}`;

  beforeAll(async () => {
    ctx = await createTestContext(`tacc${Date.now()}`);
    other = await createTestContext(`taccx${Date.now()}`);
    orgOnly = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: orgOnly.id, role: 'MEMBER' },
    });
    guest = await createTestUser();
    await prisma.orgMembership.create({
      data: { orgId: ctx.orgId, userId: guest.id, role: 'GUEST' },
    });
    secondTeamId = (
      await prisma.team.create({
        data: {
          orgId: ctx.orgId,
          name: 'Guest team',
          slug: `guest-team-${Date.now()}`,
          members: { create: { userId: guest.id, role: 'MEMBER' } },
        },
      })
    ).id;
    teamViewer = await addMemberToContext(ctx);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: teamViewer.id, teamId: ctx.teamId } },
      data: { role: 'VIEWER' },
    });
    teamMember = await addMemberToContext(ctx);
    // The team member also works in another org: that activity must not show here
    await prisma.orgMembership.create({
      data: { orgId: other.orgId, userId: teamMember.id, role: 'MEMBER' },
    });
    const foreignIssue = await prisma.issue.create({
      data: {
        projectId: other.projectId,
        number: 1,
        title: SECRET,
        body: '',
        creatorId: other.owner.id,
      },
    });
    await prisma.activity.create({
      data: {
        resourceType: 'issue',
        resourceId: foreignIssue.id,
        action: 'created',
        userId: teamMember.id,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await cleanupTestContext(other);
    await prisma.user.deleteMany({
      where: { id: { in: [orgOnly.id, guest.id, teamViewer.id, teamMember.id] } },
    });
  });

  it('X: refuses team-wide reads to an org member who is not on the team', async () => {
    const t = orgOnly.token;
    const results = await Promise.all([
      authGet(`/api/teams/${ctx.teamId}`, t),
      authGet(`/api/teams/${ctx.teamId}/members`, t),
      authGet(`/api/teams/${ctx.teamId}/activity`, t),
      authGet(`/api/teams/${ctx.teamId}/roadmap/timeline`, t),
      authGet(`/api/teams/${ctx.teamId}/analytics`, t),
      authGet(`/api/projects/team/${ctx.teamId}`, t),
    ]);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403]);

    const failed = await withMcpClient(orgOnly, async (client) => {
      const res = await callTool(client, 'act', {
        action: 'project.list',
        input: { teamId: ctx.teamId },
      });
      return res.isError;
    });
    expect(failed).toBe(true);

    expect((await authGet(`/api/teams/${ctx.teamId}`, teamViewer.token)).status).toBe(200);
  });

  it('S: team activity only covers the team’s own resources', async () => {
    const res = await authGet(`/api/teams/${ctx.teamId}/activity`, teamViewer.token);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: teamMember.id } });
    const profile = await authGet(
      `/api/teams/${ctx.teamId}/members/profile/${user.username}`,
      teamViewer.token,
    );
    expect(profile.status).toBe(200);
    expect(JSON.stringify(profile.body.recentActivity)).not.toContain(foreignIssueId);
  });

  it('T: only team admins (or org admins) change or delete a project', async () => {
    const patch = await authPatch(`/api/projects/${ctx.projectId}`, teamViewer.token, {
      name: 'x',
    });
    const del = await authDel(`/api/projects/${ctx.projectId}`, teamMember.token);
    expect([patch.status, del.status]).toEqual([403, 403]);
    expect(await prisma.project.count({ where: { id: ctx.projectId } })).toBe(1);
  });

  it('Z: a GUEST lists only the teams they belong to', async () => {
    const res = await authGet(`/api/teams/org/${ctx.orgId}`, guest.token);
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toEqual([secondTeamId]);
  });

  it('23: team activity works for a team with more issues than a query can bind', async () => {
    // One INSERT ... SELECT: past the 32,767 bind-parameter limit of an IN list
    await prisma.$executeRaw`
      INSERT INTO issues (id, "projectId", number, title, body, "creatorId", "updatedAt")
      SELECT 'bulk-' || g || '-' || ${ctx.projectId}, ${ctx.projectId}, 10000 + g, 'bulk ' || g, '',
             ${ctx.owner.id}, now()
      FROM generate_series(1, 33000) AS g
    `;
    try {
      const res = await authGet(`/api/teams/${ctx.teamId}/activity`, teamViewer.token);
      expect(res.status).toBe(200);
    } finally {
      await prisma.issue.deleteMany({
        where: { projectId: ctx.projectId, number: { gte: 10_000 } },
      });
    }
  }, 60_000);

  it('24: creating a project or space in a team needs team membership', async () => {
    const stamp = Date.now();
    const project = await authPost(`/api/projects/team/${ctx.teamId}`, orgOnly.token, {
      name: 'Sneaky',
      slug: `sneaky-${stamp}`,
      prefix: 'SNK',
    });
    const space = await authPost(`/api/wiki/team/${ctx.teamId}/spaces`, orgOnly.token, {
      name: 'Sneaky',
      slug: `sneaky-${stamp}`,
    });
    expect([project.status, space.status]).toEqual([403, 403]);
  });

  it('N5: open team wiki spaces follow the team, so org members off the team get no access', async () => {
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Team wiki', slug: `team-wiki-${Date.now()}` },
    });
    await prisma.page.create({ data: { spaceId: space.id, title: 'P', slug: 'p', body: 'x' } });
    const read = await authGet(`/api/wiki/spaces/${space.id}/tree`, orgOnly.token);
    const write = await authPost(`/api/wiki/spaces/${space.id}/pages`, orgOnly.token, {
      title: 'Off team',
      slug: `off-${Date.now()}`,
    });
    expect([read.status, write.status]).toEqual([403, 403]);
    // A team VIEWER reads, a team MEMBER writes
    expect((await authGet(`/api/wiki/spaces/${space.id}/tree`, teamViewer.token)).status).toBe(200);
    const byMember = await authPost(`/api/wiki/spaces/${space.id}/pages`, teamMember.token, {
      title: 'On team',
      slug: `on-${Date.now()}`,
    });
    expect(byMember.status).toBe(201);
  });

  it('N9: a platform admin outside the org passes team permission checks', async () => {
    const platformAdmin = await createTestUser();
    await prisma.user.update({ where: { id: platformAdmin.id }, data: { isAdmin: true } });
    try {
      const res = await authPost(`/api/projects/team/${ctx.teamId}`, platformAdmin.token, {
        name: 'By admin',
        slug: `by-admin-${Date.now()}`,
        prefix: 'ADM',
      });
      expect(res.status).toBe(201);
    } finally {
      await prisma.user.deleteMany({ where: { id: platformAdmin.id } });
    }
  });

  it('Tim: team member emails only for team ADMINs, org OWNER/ADMIN and platform admins', async () => {
    const member = await prisma.user.findUniqueOrThrow({ where: { id: teamMember.id } });
    const path = `/api/teams/${ctx.teamId}/members/profile/${member.username}`;
    const asViewer = await authGet(path, teamViewer.token);
    expect(asViewer.status).toBe(200);
    expect(asViewer.body.email).toBeUndefined();
    const asOwner = await authGet(path, ctx.owner.token);
    expect(asOwner.body.email).toBe(member.email);

    // The members list doesn't reveal a member's other orgs either
    const list = await authGet(`/api/teams/${ctx.teamId}/members`, teamViewer.token);
    expect(list.status).toBe(200);
    expect(JSON.stringify(list.body)).not.toContain(other.orgId);
    expect(JSON.stringify(list.body)).not.toContain(member.email);
  });
});
