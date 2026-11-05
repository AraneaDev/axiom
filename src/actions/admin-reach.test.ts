/**
 * Admin reach: what tokens were barred from now waits for a person, every time. The role checks of
 * the old routes still come first, and what a run returns stays with the person who approved it.
 */
import crypto from 'crypto';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';
import { MINTABLE_SCOPES } from '../middleware/token-scopes';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../test/factory';
import { authGet, authPatch, authPost } from '../test/helpers';
import { callTool, connectMcp, serveApp } from '../test/mcp-client';

import { LEGACY_ROUTES } from './legacy-routes';
import { getAction } from './registry';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';

/**
 * A token as it stands in the table, so a scope no one can mint is a case too.
 * @param userId - Its user
 * @param scopes - Its scopes
 * @param name - Its name, which a write carries as `via`
 * @returns The id and what the agent holds
 */
async function tokenOf(userId: string, scopes: string[], name = 'reach-agent') {
  const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
  const row = await prisma.apiToken.create({
    data: {
      userId,
      name,
      scopes,
      prefix: raw.slice(0, 11),
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
    },
  });
  return { id: row.id, raw };
}

/**
 * A call as an agent makes it.
 * @param raw - The token
 * @param method - The HTTP method
 * @param path - The path
 * @param body - The body of a write
 */
function asToken(raw: string, method: Method, path: string, body?: object) {
  const client = request(app);
  const req = client[method](path)
    .set('Authorization', `Token ${raw}`)
    .set('X-Requested-With', 'XMLHttpRequest');
  return body ? req.send(body) : req;
}

/**
 * A person approves a request in the web UI.
 * @param user - The person
 * @param id - The request
 */
function approve(user: TestUser, id: string) {
  return authPost(`/api/agent-approvals/${id}/approve`, user.token);
}

describe('admin reach', () => {
  let ctx: TestContext;
  let member: TestUser;
  let stranger: TestUser;
  let platformAdmin: TestUser;
  let spaceId: string;
  let pageId: string;
  let permissionId: string;
  let restrictionId: string;
  let invitationId: string;
  let auditId: string;
  let ownerAgent: { id: string; raw: string };
  let adminAgent: { id: string; raw: string };

  beforeAll(async () => {
    ctx = await createTestContext(`rch${Date.now()}`);
    member = await addMemberToContext(ctx);
    stranger = await createTestUser();
    platformAdmin = await createTestUser();
    await prisma.user.update({ where: { id: platformAdmin.id }, data: { isAdmin: true } });

    const space = await authPost(`/api/wiki/team/${ctx.teamId}/spaces`, ctx.owner.token, {
      name: 'Reach space',
      slug: 'reach-space',
    });
    spaceId = space.body.id;
    const page = await authPost(`/api/wiki/spaces/${spaceId}/pages`, ctx.owner.token, {
      title: 'Reach page',
      slug: 'reach-page',
      body: 'Text',
    });
    pageId = page.body.id;
    const permission = await prisma.spacePermission.create({
      data: { spaceId, userId: member.id, level: 'EDIT' },
    });
    permissionId = permission.id;
    const restriction = await prisma.pageRestriction.create({
      data: { pageId, userId: member.id, type: 'EDIT' },
    });
    restrictionId = restriction.id;
    const invitation = await prisma.invitation.create({
      data: {
        email: 'invited@test.dev',
        orgId: ctx.orgId,
        invitedBy: ctx.owner.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    invitationId = invitation.id;
    const audit = await prisma.auditLog.create({
      data: { orgId: 'system', userId: ctx.owner.id, action: 'reach.test', resource: 'reach' },
    });
    auditId = audit.id;

    ownerAgent = await tokenOf(ctx.owner.id, ['admin:write']);
    adminAgent = await tokenOf(platformAdmin.id, ['admin:write']);
  });

  afterEach(async () => {
    await prisma.agentApproval.deleteMany({
      where: { userId: { in: [ctx.owner.id, member.id, platformAdmin.id, stranger.id] } },
    });
    await prisma.agentPolicy.deleteMany({ where: { orgId: ctx.orgId } });
  });

  afterAll(async () => {
    await prisma.apiToken.deleteMany({
      where: { userId: { in: [ctx.owner.id, member.id, platformAdmin.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [member.id, stranger.id, platformAdmin.id] } },
    });
    await cleanupTestContext(ctx);
  });

  describe('every route a token was barred from waits for a person', () => {
    /** What the owner of the org and the team can ask for. */
    const ownerCalls = (): Array<[string, Method, string, object?]> => [
      ['org.create', 'post', '/api/orgs', { name: 'Asked', slug: `asked-${Date.now()}` }],
      ['org.update', 'patch', `/api/orgs/${ctx.orgId}`, { name: 'Renamed by agent' }],
      ['org.delete', 'delete', `/api/orgs/${ctx.orgId}`],
      ['orgMember.add', 'post', `/api/orgs/${ctx.orgId}/members`, { userId: stranger.id }],
      [
        'orgMember.update',
        'patch',
        `/api/orgs/${ctx.orgId}/members/${member.id}`,
        { role: 'ADMIN' },
      ],
      ['orgMember.remove', 'delete', `/api/orgs/${ctx.orgId}/members/${member.id}`],
      ['invitation.list', 'get', `/api/orgs/${ctx.orgId}/invitations`],
      [
        'invitation.create',
        'post',
        `/api/orgs/${ctx.orgId}/invitations`,
        { email: 'asked@test.dev', role: 'MEMBER' },
      ],
      ['invitation.revoke', 'delete', `/api/orgs/${ctx.orgId}/invitations/${invitationId}`],
      ['team.create', 'post', `/api/teams/org/${ctx.orgId}`, { name: 'Asked', slug: 'asked' }],
      ['team.update', 'patch', `/api/teams/${ctx.teamId}`, { name: 'Renamed by agent' }],
      ['team.delete', 'delete', `/api/teams/${ctx.teamId}`],
      ['teamMember.add', 'post', `/api/teams/${ctx.teamId}/members`, { userId: stranger.id }],
      [
        'teamMember.update',
        'patch',
        `/api/teams/${ctx.teamId}/members/${member.id}`,
        { role: 'ADMIN' },
      ],
      ['teamMember.remove', 'delete', `/api/teams/${ctx.teamId}/members/${member.id}`],
      [
        'project.create',
        'post',
        `/api/projects/team/${ctx.teamId}`,
        { name: 'Asked', slug: 'asked', prefix: 'ASK' },
      ],
      ['project.update', 'patch', `/api/projects/${ctx.projectId}`, { name: 'Renamed by agent' }],
      ['project.delete', 'delete', `/api/projects/${ctx.projectId}`],
      [
        'space.create',
        'post',
        `/api/wiki/team/${ctx.teamId}/spaces`,
        { name: 'Asked', slug: 'asked' },
      ],
      ['space.update', 'patch', `/api/wiki/spaces/${spaceId}`, { isArchived: true }],
      ['spacePermission.list', 'get', `/api/wiki/spaces/${spaceId}/permissions`],
      [
        'spacePermission.set',
        'put',
        `/api/wiki/spaces/${spaceId}/permissions`,
        { userId: stranger.id, level: 'ADMIN' },
      ],
      [
        'spacePermission.remove',
        'delete',
        `/api/wiki/spaces/${spaceId}/permissions/${permissionId}`,
      ],
      ['pageRestriction.get', 'get', `/api/wiki/pages/${pageId}/restrictions`],
      [
        'pageRestriction.set',
        'put',
        `/api/wiki/pages/${pageId}/restrictions`,
        { type: 'VIEW', userIds: [ctx.owner.id] },
      ],
      ['pageRestriction.remove', 'delete', `/api/wiki/restrictions/${restrictionId}`],
      ['token.create', 'post', '/api/users/me/tokens', { name: 'Asked', scopes: ['admin:read'] }],
      ['token.revoke', 'delete', `/api/users/me/tokens/${ownerAgent.id}`],
    ];

    /** What only a platform admin can ask for. */
    const platformCalls = (): Array<[string, Method, string, object?]> => [
      ['admin.stats', 'get', '/api/admin/stats'],
      ['admin.settings', 'get', '/api/admin/settings'],
      ['adminUser.list', 'get', '/api/admin/users?search=factory&limit=5'],
      ['adminUser.get', 'get', `/api/admin/users/${member.id}`],
      ['adminUser.update', 'patch', `/api/admin/users/${member.id}`, { role: 'VIEWER' }],
      ['adminUser.delete', 'delete', `/api/admin/users/${stranger.id}`],
      ['adminUser.deactivate', 'post', `/api/admin/users/${member.id}/deactivate`],
      ['adminUser.reactivate', 'post', `/api/admin/users/${member.id}/reactivate`],
      ['auditLog.list', 'get', '/api/admin/audit-logs?limit=5'],
      ['auditLog.get', 'get', `/api/admin/audit-logs/${auditId}`],
    ];

    it('runs nothing for the owner, each call a request with a preview', async () => {
      const before = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
      for (const [action, method, path, body] of ownerCalls()) {
        const res = await asToken(ownerAgent.raw, method, path, body);
        expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(202);
        expect(res.body.status).toBe('pending_approval');
        expect(res.body.preview, action).toMatch(/\S/);
        const row = await prisma.agentApproval.findUniqueOrThrow({
          where: { id: res.body.approvalId },
        });
        expect(row.action).toBe(action);
      }
      const after = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
      expect(after.name).toBe(before.name);
      expect(
        await prisma.teamMembership.findFirst({ where: { teamId: ctx.teamId, userId: member.id } }),
      ).toMatchObject({ role: 'MEMBER' });
      expect(await prisma.project.count({ where: { id: ctx.projectId } })).toBe(1);
      expect(await prisma.pageRestriction.count({ where: { id: restrictionId } })).toBe(1);
      expect(await prisma.spacePermission.count({ where: { id: permissionId } })).toBe(1);
      expect(await prisma.apiToken.count({ where: { id: ownerAgent.id } })).toBe(1);
    });

    it('runs nothing for a platform admin, each call a request with a preview', async () => {
      for (const [action, method, path, body] of platformCalls()) {
        const res = await asToken(adminAgent.raw, method, path, body);
        expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(202);
        expect(res.body.preview, action).toMatch(/\S/);
        const row = await prisma.agentApproval.findUniqueOrThrow({
          where: { id: res.body.approvalId },
        });
        expect(row.action).toBe(action);
      }
      expect(await prisma.user.count({ where: { id: stranger.id } })).toBe(1);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).deactivatedAt,
      ).toBeNull();
    });

    it('marks all of them admin, in area admin, with a preview', () => {
      const names = [...ownerCalls(), ...platformCalls()].map(([name]) => name);
      const wrong = names.filter((name) => {
        const def = getAction(name);
        return !def?.admin || def.area !== 'admin' || !def.preview || !def.rest;
      });
      expect(wrong).toEqual([]);
    });

    it('leaves no route tagged plan 3 on the legacy list', () => {
      expect(LEGACY_ROUTES.filter((route) => route.plan === 3)).toEqual([]);
    });

    it('lets a token be minted with the admin scopes, and no scope that still does nothing', () => {
      expect(MINTABLE_SCOPES).toContain('admin:read');
      expect(MINTABLE_SCOPES).toContain('admin:write');
      expect(MINTABLE_SCOPES).not.toContain('orgs:write');
      expect(MINTABLE_SCOPES).not.toContain('teams:write');
      expect(MINTABLE_SCOPES).not.toContain('projects:write');
    });
  });

  describe('a team member role change', () => {
    const path = () => `/api/teams/${ctx.teamId}/members/${member.id}`;
    const roleNow = async () =>
      (
        await prisma.teamMembership.findFirstOrThrow({
          where: { teamId: ctx.teamId, userId: member.id },
        })
      ).role;

    it('waits, then runs on approval and audits via the token', async () => {
      const asked = await asToken(ownerAgent.raw, 'patch', path(), { role: 'VIEWER' });
      expect(asked.status).toBe(202);
      expect(await roleNow()).toBe('MEMBER');
      expect(asked.body.preview).toContain(member.username);
      expect(asked.body.preview).toContain('VIEWER');

      const done = await approve(ctx.owner, asked.body.approvalId);
      expect(done.status).toBe(200);
      expect(done.body.status).toBe('EXECUTED');
      expect(await roleNow()).toBe('VIEWER');

      const rows = await prisma.auditLog.findMany({
        where: { action: 'teamMember.update', userId: ctx.owner.id },
      });
      const run = rows.find(
        (row) => (row.details as { approvalId?: string }).approvalId === asked.body.approvalId,
      );
      expect(run?.via).toBe('reach-agent');
      await prisma.teamMembership.updateMany({
        where: { teamId: ctx.teamId, userId: member.id },
        data: { role: 'MEMBER' },
      });
    });

    it('needs admin:write: 403 SCOPE without it, and no request', async () => {
      for (const scopes of [['admin:read'], ['teams:write'], [...MINTABLE_SCOPES.slice(0, 3)]]) {
        const agent = await tokenOf(ctx.owner.id, scopes);
        const res = await asToken(agent.raw, 'patch', path(), { role: 'VIEWER' });
        expect(res.status, scopes.join()).toBe(403);
        expect(res.body.error.code).toBe('SCOPE');
      }
      expect(await prisma.agentApproval.count({ where: { userId: ctx.owner.id } })).toBe(0);
    });

    it('waits through /api/act and MCP alike', async () => {
      const viaAct = await request(app)
        .post('/api/act')
        .set('Authorization', `Token ${ownerAgent.raw}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          action: 'teamMember.update',
          input: { teamId: ctx.teamId, memberId: member.id, role: 'VIEWER' },
        });
      expect(viaAct.status).toBe(202);

      const served = await serveApp();
      const client = await connectMcp(served.base, `Token ${ownerAgent.raw}`);
      try {
        const answer = await callTool(client, 'act', {
          action: 'teamMember.update',
          input: { teamId: ctx.teamId, memberId: member.id, role: 'VIEWER' },
        });
        expect(answer.text).toContain('pending_approval');
      } finally {
        await client.close();
        await served.close();
      }
      expect(await roleNow()).toBe('MEMBER');
    });

    it('is not lifted by an org rule', async () => {
      await prisma.agentPolicy.create({
        data: { orgId: ctx.orgId, rules: { neverRequire: ['teamMember.update'] } },
      });
      const res = await asToken(ownerAgent.raw, 'patch', path(), { role: 'VIEWER' });
      expect(res.status).toBe(202);
      expect(await roleNow()).toBe('MEMBER');
    });
  });

  describe('the role checks of the old routes', () => {
    it.each<[string, Method, () => string, object?]>([
      ['org:manage', 'patch', () => `/api/orgs/${ctx.orgId}`, { name: 'Taken' }],
      ['org:manage', 'delete', () => `/api/orgs/${ctx.orgId}`],
      [
        'team:manage_members',
        'post',
        () => `/api/orgs/${ctx.orgId}/members`,
        { userId: 'someone' },
      ],
      ['team:manage_members', 'get', () => `/api/orgs/${ctx.orgId}/invitations`],
      ['team:create', 'post', () => `/api/teams/org/${ctx.orgId}`, { name: 'T', slug: 'tt' }],
      [
        'team:manage_members',
        'patch',
        () => `/api/teams/${ctx.teamId}/members/${ctx.owner.id}`,
        { role: 'VIEWER' },
      ],
      ['team:delete', 'delete', () => `/api/teams/${ctx.teamId}`],
      ['team:manage_members', 'patch', () => `/api/projects/${ctx.projectId}`, { name: 'Taken' }],
      ['project:delete', 'delete', () => `/api/projects/${ctx.projectId}`],
      ['space ADMIN', 'patch', () => `/api/wiki/spaces/${spaceId}`, { isArchived: true }],
      ['space ADMIN', 'get', () => `/api/wiki/spaces/${spaceId}/permissions`],
    ])('refuse an org MEMBER needing %s, with no request', async (_role, method, path, body) => {
      const agent = await tokenOf(member.id, ['admin:write']);
      const res = await asToken(agent.raw, method, path(), body);
      expect(res.status).toBe(403);
      expect(await prisma.agentApproval.count({ where: { userId: member.id } })).toBe(0);
    });

    it.each<[Method, () => string]>([
      ['get', () => '/api/admin/stats'],
      ['get', () => '/api/admin/users'],
      ['delete', () => `/api/admin/users/${stranger.id}`],
      ['get', () => '/api/admin/audit-logs'],
    ])('keep %s %s to platform admins', async (method, path) => {
      const res = await asToken(ownerAgent.raw, method, path());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(await prisma.agentApproval.count({ where: { userId: ctx.owner.id } })).toBe(0);
    });

    it('answer 404 for what does not exist, with no request', async () => {
      const res = await asToken(ownerAgent.raw, 'delete', '/api/teams/no-such-team');
      expect(res.status).toBe(404);
      expect(await prisma.agentApproval.count({ where: { userId: ctx.owner.id } })).toBe(0);
    });

    it('run again at approval: a role lost since the request fails the run', async () => {
      await prisma.teamMembership.updateMany({
        where: { teamId: ctx.teamId, userId: member.id },
        data: { role: 'ADMIN' },
      });
      const agent = await tokenOf(member.id, ['admin:write']);
      const asked = await asToken(agent.raw, 'patch', `/api/teams/${ctx.teamId}`, {
        name: 'Renamed before the demotion',
      });
      expect(asked.status).toBe(202);
      await prisma.teamMembership.updateMany({
        where: { teamId: ctx.teamId, userId: member.id },
        data: { role: 'MEMBER' },
      });

      const done = await approve(member, asked.body.approvalId);
      expect(done.body.status).toBe('FAILED');
      expect(done.body.error.status).toBe(403);
      const team = await prisma.team.findUniqueOrThrow({ where: { id: ctx.teamId } });
      expect(team.name).not.toBe('Renamed before the demotion');
    });
  });

  describe('what stays with a person', () => {
    it('refuses an admin password reset to a token, with no request holding the password', async () => {
      const res = await asToken(
        adminAgent.raw,
        'post',
        `/api/admin/users/${member.id}/reset-password`,
        { newPassword: 'a-new-password-1' },
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');

      const viaAct = await request(app)
        .post('/api/act')
        .set('Authorization', `Token ${adminAgent.raw}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          action: 'adminUser.resetPassword',
          input: { userId: member.id, newPassword: 'a-new-password-1' },
        });
      expect(viaAct.status).toBe(403);
      expect(await prisma.agentApproval.count({ where: { userId: platformAdmin.id } })).toBe(0);
      expect(getAction('adminUser.resetPassword')?.uiOnly).toBe(true);
    });

    it('keeps the password reset for a platform admin in a session', async () => {
      const res = await authPost(
        `/api/admin/users/${stranger.id}/reset-password`,
        platformAdmin.token,
        { newPassword: 'a-new-password-1' },
      );
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
    });

    it('refuses an invite link, whose code lets anyone join, to every token', async () => {
      const agent = await tokenOf(ctx.owner.id, ['orgs:read', 'admin:write']);
      const res = await asToken(agent.raw, 'get', `/api/orgs/${ctx.orgId}/invites`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');
    });

    it('refuses a token deleting its own account through the admin route', async () => {
      const res = await asToken(adminAgent.raw, 'delete', `/api/admin/users/${platformAdmin.id}`);
      expect(res.status).toBe(403);
      expect(await prisma.agentApproval.count({ where: { userId: platformAdmin.id } })).toBe(0);
    });
  });

  describe('token create', () => {
    it('names the scopes and the expiry, and only the approver gets the raw token', async () => {
      const asked = await asToken(ownerAgent.raw, 'post', '/api/users/me/tokens', {
        name: 'Second agent',
        scopes: ['admin:read', 'admin:write'],
        expiresInDays: 30,
      });
      expect(asked.status).toBe(202);
      expect(asked.body.preview).toContain('admin:read');
      expect(asked.body.preview).toContain('admin:write');
      expect(asked.body.preview).toContain('30 days');
      expect(await prisma.apiToken.count({ where: { name: 'Second agent' } })).toBe(0);

      const done = await approve(ctx.owner, asked.body.approvalId);
      expect(done.body.status).toBe('EXECUTED');
      const raw: string = done.body.result.token;
      expect(raw).toMatch(/^tk_/);

      const stored = await prisma.agentApproval.findUniqueOrThrow({
        where: { id: asked.body.approvalId },
      });
      expect(JSON.stringify(stored)).not.toContain(raw);
      expect(stored.result).toMatchObject({ name: 'Second agent' });

      const waited = await asToken(
        ownerAgent.raw,
        'get',
        `/api/agent-approvals/${asked.body.approvalId}`,
      );
      // admin:write holds no approvals scope; the session's own read says the same
      expect(waited.status).toBe(403);
      const read = await authGet(`/api/agent-approvals/${asked.body.approvalId}`, ctx.owner.token);
      expect(JSON.stringify(read.body)).not.toContain(raw);

      const audit = await prisma.auditLog.findMany({
        where: { action: 'token.create', userId: ctx.owner.id },
      });
      expect(JSON.stringify(audit)).not.toContain(raw);

      const works = await asToken(raw, 'get', '/api/admin/stats');
      expect(works.status).toBe(403);
      expect(works.body.error.code).toBe('FORBIDDEN');
    });

    it('says when a token never expires', async () => {
      const asked = await asToken(ownerAgent.raw, 'post', '/api/users/me/tokens', {
        name: 'Forever',
        scopes: ['admin:read'],
      });
      expect(asked.body.preview).toMatch(/never expires/i);
    });

    it('refuses scopes beyond those of the token that asks, with no request', async () => {
      const res = await asToken(ownerAgent.raw, 'post', '/api/users/me/tokens', {
        name: 'Wider',
        scopes: ['admin:write', 'issues:write'],
      });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');
      expect(await prisma.agentApproval.count({ where: { userId: ctx.owner.id } })).toBe(0);
    });

    it('checks the scopes again at approval', async () => {
      const agent = await tokenOf(ctx.owner.id, ['admin:write', 'issues:read']);
      const asked = await asToken(agent.raw, 'post', '/api/users/me/tokens', {
        name: 'Narrowed',
        scopes: ['issues:read'],
      });
      expect(asked.status).toBe(202);
      await prisma.apiToken.update({ where: { id: agent.id }, data: { scopes: ['admin:write'] } });
      const done = await approve(ctx.owner, asked.body.approvalId);
      expect(done.body.status).toBe('FAILED');
      expect(done.body.error.status).toBe(403);
      expect(await prisma.apiToken.count({ where: { name: 'Narrowed' } })).toBe(0);
    });

    it('revokes only your own token, and a stranger token answers 404 without a request', async () => {
      const others = await tokenOf(member.id, ['issues:read']);
      const res = await asToken(ownerAgent.raw, 'delete', `/api/users/me/tokens/${others.id}`);
      expect(res.status).toBe(404);
      expect(await prisma.agentApproval.count({ where: { userId: ctx.owner.id } })).toBe(0);

      const mine = await tokenOf(ctx.owner.id, ['issues:read'], 'To revoke');
      const asked = await asToken(ownerAgent.raw, 'delete', `/api/users/me/tokens/${mine.id}`);
      expect(asked.status).toBe(202);
      expect(asked.body.preview).toContain('To revoke');
      expect(await prisma.apiToken.count({ where: { id: mine.id } })).toBe(1);
      const done = await approve(ctx.owner, asked.body.approvalId);
      expect(done.body.status).toBe('EXECUTED');
      expect(await prisma.apiToken.count({ where: { id: mine.id } })).toBe(0);
    });
  });

  describe('invitations', () => {
    it('keep their accept token out of what is stored and what the agent reads', async () => {
      const asked = await asToken(ownerAgent.raw, 'post', `/api/orgs/${ctx.orgId}/invitations`, {
        email: 'stored@test.dev',
        role: 'MEMBER',
      });
      expect(asked.status).toBe(202);
      const done = await approve(ctx.owner, asked.body.approvalId);
      expect(done.body.status).toBe('EXECUTED');
      const invitation = await prisma.invitation.findFirstOrThrow({
        where: { email: 'stored@test.dev' },
      });
      const stored = await prisma.agentApproval.findUniqueOrThrow({
        where: { id: asked.body.approvalId },
      });
      expect(JSON.stringify(stored.result)).not.toContain(invitation.token);

      const listed = await asToken(ownerAgent.raw, 'get', `/api/orgs/${ctx.orgId}/invitations`);
      expect(listed.status).toBe(202);
      await approve(ctx.owner, listed.body.approvalId);
      const storedList = await prisma.agentApproval.findUniqueOrThrow({
        where: { id: listed.body.approvalId },
      });
      expect(storedList.status).toBe('EXECUTED');
      expect(JSON.stringify(storedList.result)).toContain('stored@test.dev');
      expect(JSON.stringify(storedList.result)).not.toContain(invitation.token);
    });
  });

  describe('reads behind approval', () => {
    it('answer once approved, and only then', async () => {
      const asked = await asToken(adminAgent.raw, 'get', '/api/admin/settings');
      expect(asked.status).toBe(202);
      expect(asked.body.corsOrigin).toBeUndefined();
      const done = await approve(platformAdmin, asked.body.approvalId);
      expect(done.body.status).toBe('EXECUTED');
      expect(done.body.result).toHaveProperty('nodeEnv');
    });

    it('are refused a token holding only a wiki scope, which used to read restrictions', async () => {
      const agent = await tokenOf(ctx.owner.id, ['wiki:write']);
      for (const path of [
        `/api/wiki/pages/${pageId}/restrictions`,
        `/api/wiki/spaces/${spaceId}/permissions`,
      ]) {
        const res = await asToken(agent.raw, 'get', path);
        expect(res.status, path).toBe(403);
        expect(res.body.error.code).toBe('SCOPE');
      }
    });
  });

  describe('org rules reach what names no org', () => {
    it('sets the expiry of removing a restriction, addressed by its own id', async () => {
      await prisma.agentPolicy.create({
        data: { orgId: ctx.orgId, rules: { expiresMinutes: 10 } },
      });
      const res = await asToken(
        ownerAgent.raw,
        'delete',
        `/api/wiki/restrictions/${restrictionId}`,
      );
      expect(res.status).toBe(202);
      expect(new Date(res.body.expiresAt).getTime()).toBeLessThan(Date.now() + 11 * 60_000);
    });
  });

  describe('sessions', () => {
    it('never wait', async () => {
      const res = await authPatch(`/api/teams/${ctx.teamId}`, ctx.owner.token, {
        description: 'Changed in a session',
      });
      expect(res.status).toBe(200);
      expect(res.body.description).toBe('Changed in a session');
    });

    it('change only the named fields of a space', async () => {
      const res = await authPatch(`/api/wiki/spaces/${spaceId}`, ctx.owner.token, {
        isArchived: false,
        slug: 'taken-over',
        teamId: 'another-team',
      });
      expect(res.status).toBe(200);
      const space = await prisma.wikiSpace.findUniqueOrThrow({ where: { id: spaceId } });
      expect(space.slug).toBe('reach-space');
      expect(space.teamId).toBe(ctx.teamId);
    });
  });
});
