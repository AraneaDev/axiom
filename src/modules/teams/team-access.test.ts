/**
 * Team-wide reads need team membership (or org OWNER/ADMIN, or platform admin), project
 * settings need the matching role, and team activity stays within the team's resources.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import { mcpContext } from '../../mcp/context';
import { createMcpServer } from '../../mcp/server';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authGet, authPatch } from '../../test/helpers';

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

    const server = createMcpServer(orgOnly.id);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'orgonly', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    let failed = false;
    try {
      const res = await mcpContext.run({ userId: orgOnly.id }, () =>
        client.callTool({ name: 'list_projects', arguments: { teamId: ctx.teamId } }),
      );
      failed = res.isError === true;
    } catch {
      failed = true;
    }
    await client.close();
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
});
