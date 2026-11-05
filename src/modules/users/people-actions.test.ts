/**
 * People and notifications as registry actions (plan 4, task 4): the routes the old routers served,
 * the reach a token keeps on a person's own state, and what the migration closed around it.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { listActions } from '../../actions/registry';
import { mountActions } from '../../actions/rest';
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
import { authGet, authPatch, authPost } from '../../test/helpers';
import { tokenHeaderFor } from '../../test/mcp-client';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

/** Every route the old routers of this group served, with the action that serves it now */
const MIGRATED: Array<[method: string, path: string, action: string]> = [
  ['GET', '/api/users/search', 'user.search'],
  ['GET', '/api/users/me', 'user.me'],
  ['PATCH', '/api/users/me', 'user.updateMe'],
  ['GET', '/api/users/me/dashboard', 'user.dashboard'],
  ['GET', '/api/users/me/tokens', 'token.list'],
  ['GET', '/api/users/me/pending-approvals', 'approvalRequest.listMine'],
  ['GET', '/api/notifications', 'notification.list'],
  ['GET', '/api/notifications/unread-count', 'notification.unreadCount'],
  ['GET', '/api/notifications/preferences', 'notification.preferences'],
  ['PATCH', '/api/notifications/preferences', 'notification.setPreference'],
  ['POST', '/api/notifications/read-all', 'notification.markAllRead'],
  ['PATCH', '/api/notifications/:id/read', 'notification.markRead'],
  ['POST', '/api/invitations/:token/accept', 'invitation.accept'],
  ['GET', '/api/projects/:projectId/activity', 'activity.listProject'],
  ['GET', '/api/projects/:projectId/issues/:issueNumber/activity', 'activity.listIssue'],
  ['GET', '/api/orgs/:orgId/analytics', 'analytics.org'],
  ['GET', '/api/teams/:teamId/analytics', 'analytics.team'],
  ['GET', '/api/projects/:projectId/analytics', 'analytics.project'],
  ['GET', '/api/links/resolve-link', 'link.resolve'],
  ['GET', '/api/orgs/:orgId/members', 'orgMember.list'],
  ['GET', '/api/orgs/:orgId/invites', 'inviteLink.list'],
  ['POST', '/api/orgs/:orgId/invites', 'inviteLink.create'],
  ['DELETE', '/api/orgs/:orgId/invites/:inviteId', 'inviteLink.delete'],
  ['GET', '/api/teams/:teamId/activity', 'team.activity'],
  ['GET', '/api/teams/:teamId/members/profile/:username', 'team.memberProfile'],
  ['GET', '/api/teams/:teamId/members', 'teamMember.list'],
];

describe('the route table of people and notifications', () => {
  beforeAll(() => {
    // The app registers every actions file when it is imported
    expect(app).toBeDefined();
  });

  it('serves each route the old routers had from the registry action named for it', () => {
    const served = new Map(
      listActions().map((def) => [`${def.rest?.method} ${def.rest?.path}`, def.name]),
    );
    const lost = MIGRATED.filter(
      ([method, path, action]) => served.get(`${method} ${path}`) !== action,
    );
    expect(lost).toEqual([]);
  });

  it('mounts static paths ahead of the param paths that would capture them', () => {
    // mountActions throws at startup when an earlier path leaves a later one unreachable
    expect(() => mountActions(express.Router(), listActions())).not.toThrow();
  });
});

describe('people and notifications over REST', () => {
  let ctx: TestContext;
  let member: TestUser;
  let outsider: TestUser;
  let wikiOnly: string;
  let issuesRead: string;
  let sprintsOnly: string;
  let orgsRead: string;

  beforeAll(async () => {
    ctx = await createTestContext('people4');
    member = await addMemberToContext(ctx);
    outsider = await createTestUser();
    wikiOnly = await tokenHeaderFor(ctx.owner, ['wiki:read'], 'wiki-agent');
    issuesRead = await tokenHeaderFor(ctx.owner, ['issues:read'], 'issues-agent');
    sprintsOnly = await tokenHeaderFor(ctx.owner, ['sprints:read'], 'sprints-agent');
    orgsRead = await tokenHeaderFor(ctx.owner, ['orgs:read'], 'orgs-agent');
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: ctx.owner.id } });
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [member.id, outsider.id] } } });
  });

  describe("a token's reach on a person's own state", () => {
    it.each([
      '/api/users/me',
      '/api/users/me/tokens',
      '/api/users/me/pending-approvals',
      '/api/users/search?q=a',
      '/api/notifications',
      '/api/notifications/unread-count',
      '/api/notifications/preferences',
    ])(
      'opens %s to a token that reads wiki or issues, and not to one that reads sprints',
      async (path) => {
        for (const header of [wikiOnly, issuesRead]) {
          const res = await request(app).get(path).set('Authorization', header);
          expect(res.status).toBe(200);
        }
        const refused = await request(app).get(path).set('Authorization', sprintsOnly);
        expect(refused.status).toBe(403);
        expect(refused.body.error.code).toBe('SCOPE');
      },
    );

    it('lets a token that reads wiki clear its notifications, and one that reads sprints not', async () => {
      const wiki = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', wikiOnly)
        .set(XHR);
      expect(wiki.status).toBe(200);
      expect(wiki.body).toEqual({ success: true });
      const sprints = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', sprintsOnly)
        .set(XHR);
      expect(sprints.status).toBe(403);
    });

    it('opens the dashboard to a token that reads issues, and not to one that reads wiki', async () => {
      const issues = await request(app)
        .get('/api/users/me/dashboard')
        .set('Authorization', issuesRead);
      expect(issues.status).toBe(200);
      const wiki = await request(app).get('/api/users/me/dashboard').set('Authorization', wikiOnly);
      expect(wiki.status).toBe(403);
    });

    it('keeps the same reach through /api/act', async () => {
      const ok = await request(app)
        .post('/api/act')
        .set('Authorization', wikiOnly)
        .set(XHR)
        .send({ action: 'notification.unreadCount', input: {} });
      expect(ok.status).toBe(200);
      const refused = await request(app)
        .post('/api/act')
        .set('Authorization', sprintsOnly)
        .set(XHR)
        .send({ action: 'notification.unreadCount', input: {} });
      expect(refused.status).toBe(403);
    });
  });

  describe('the profile', () => {
    it('changes the display name of a session and nothing else of the user row', async () => {
      const res = await authPatch('/api/users/me', member.token, {
        displayName: 'Renamed member',
        isAdmin: true,
        email: 'taken-over@test.dev',
      });
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Renamed member');
      const row = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
      expect(row.isAdmin).toBe(false);
      expect(row.email).toBe(member.email);
    });

    it.each([{ displayName: '' }, { avatarUrl: 'javascript:alert(1)' }, { displayName: 5 }])(
      'answers 400 to %j',
      async (body) => {
        const res = await authPatch('/api/users/me', member.token, body);
        expect(res.status).toBe(400);
      },
    );

    it('refuses a token any change of the account, even with every scope', async () => {
      const all = await tokenHeaderFor(ctx.owner, undefined, 'all-agent');
      const res = await request(app)
        .patch('/api/users/me')
        .set('Authorization', all)
        .set(XHR)
        .send({ displayName: 'Taken over' });
      expect(res.status).toBe(403);
      const row = await prisma.user.findUniqueOrThrow({ where: { id: ctx.owner.id } });
      expect(row.displayName).not.toBe('Taken over');
    });
  });

  describe('agent approval lines in the notifications', () => {
    it("keeps the previews of an agent's request out of every token's list, by REST and by name", async () => {
      const secret = 'Delete the issue "secret preview text"';
      const line = await prisma.notification.create({
        data: { userId: ctx.owner.id, type: 'agent:approval', title: secret },
      });
      const plain = await prisma.notification.create({
        data: { userId: ctx.owner.id, type: 'issue_assigned', title: 'Plain line' },
      });

      const viaRest = await request(app).get('/api/notifications').set('Authorization', issuesRead);
      expect(JSON.stringify(viaRest.body)).not.toContain(secret);
      expect((viaRest.body.notifications as Array<{ id: string }>).map((n) => n.id)).toContain(
        plain.id,
      );

      const viaAct = await request(app)
        .post('/api/act')
        .set('Authorization', wikiOnly)
        .set(XHR)
        .send({ action: 'notification.list', input: {} });
      expect(viaAct.status).toBe(200);
      expect(JSON.stringify(viaAct.body)).not.toContain(secret);

      const session = await authGet('/api/notifications', ctx.owner.token);
      expect((session.body.notifications as Array<{ id: string }>).map((n) => n.id)).toContain(
        line.id,
      );
    });

    it('leaves one unread when a token marks everything read, by name too', async () => {
      const line = await prisma.notification.create({
        data: { userId: ctx.owner.id, type: 'agent:approval', title: 'Waiting', read: false },
      });
      const res = await request(app)
        .post('/api/act')
        .set('Authorization', issuesRead)
        .set(XHR)
        .send({ action: 'notification.markAllRead', input: {} });
      expect(res.status).toBe(200);
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: line.id } })).read).toBe(
        false,
      );
      const viaRest = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', issuesRead)
        .set(XHR);
      expect(viaRest.status).toBe(200);
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: line.id } })).read).toBe(
        false,
      );
    });
  });

  describe('activity and analytics', () => {
    it('opens project activity to the team and to a token that reads issues, not to a stranger', async () => {
      const path = `/api/projects/${ctx.projectId}/activity`;
      expect((await authGet(path, member.token)).status).toBe(200);
      expect((await request(app).get(path).set('Authorization', issuesRead)).status).toBe(200);
      expect((await request(app).get(path).set('Authorization', sprintsOnly)).status).toBe(403);
      expect((await authGet(path, outsider.token)).status).toBe(403);
    });

    it('answers 404 for an issue that is not there, and 400 for a number that is no number', async () => {
      const base = `/api/projects/${ctx.projectId}/issues`;
      expect((await authGet(`${base}/9999/activity`, member.token)).status).toBe(404);
      expect((await authGet(`${base}/12abc/activity`, member.token)).status).toBe(400);
    });

    it('opens org analytics to the org scope and not to an issues scope', async () => {
      const path = `/api/orgs/${ctx.orgId}/analytics?period=7d`;
      expect((await request(app).get(path).set('Authorization', orgsRead)).status).toBe(200);
      expect((await request(app).get(path).set('Authorization', issuesRead)).status).toBe(403);
      expect((await authGet(path, outsider.token)).status).toBe(403);
    });

    it('opens team and project analytics to the issues scope', async () => {
      for (const path of [
        `/api/teams/${ctx.teamId}/analytics`,
        `/api/projects/${ctx.projectId}/analytics`,
        `/api/teams/${ctx.teamId}/activity`,
      ]) {
        expect((await request(app).get(path).set('Authorization', issuesRead)).status).toBe(200);
        expect((await request(app).get(path).set('Authorization', orgsRead)).status).toBe(403);
        expect((await authGet(path, outsider.token)).status).toBe(403);
      }
    });
  });

  describe('invitations and invite links', () => {
    it('keeps invite links from every token, with every scope', async () => {
      const all = await tokenHeaderFor(ctx.owner, undefined, 'links-agent');
      const base = `/api/orgs/${ctx.orgId}/invites`;
      const list = await request(app).get(base).set('Authorization', all);
      expect(list.status).toBe(403);
      const create = await request(app).post(base).set('Authorization', all).set(XHR).send({});
      expect(create.status).toBe(403);
      expect(await prisma.inviteLink.count({ where: { orgId: ctx.orgId } })).toBe(0);
    });

    it('lets an org owner make, read and delete links, and no plain member', async () => {
      const base = `/api/orgs/${ctx.orgId}/invites`;
      const made = await authPost(base, ctx.owner.token, { maxUses: 3 });
      expect(made.status).toBe(201);
      expect(made.body.code).toBeTypeOf('string');
      expect((await authGet(base, ctx.owner.token)).body).toHaveLength(1);
      expect((await authGet(base, member.token)).status).toBe(403);
      const refused = await request(app)
        .delete(`${base}/${made.body.id}`)
        .set('Authorization', `Bearer ${member.token}`)
        .set(XHR);
      expect(refused.status).toBe(403);
      const removed = await request(app)
        .delete(`${base}/${made.body.id}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set(XHR);
      expect(removed.status).toBe(204);
    });

    it('refuses a token the acceptance of an invitation', async () => {
      const all = await tokenHeaderFor(outsider, undefined, 'accept-agent');
      const res = await request(app)
        .post('/api/invitations/some-code/accept')
        .set('Authorization', all)
        .set(XHR);
      expect(res.status).toBe(403);
    });

    it('answers 404 to a code that matches no invitation', async () => {
      const res = await authPost('/api/invitations/no-such-code/accept', outsider.token);
      expect(res.status).toBe(404);
    });
  });

  describe('resolve-link', () => {
    it('answers 400 without a url and 404 for one that resolves to nothing', async () => {
      expect((await authGet('/api/links/resolve-link', member.token)).status).toBe(400);
      const res = await authGet('/api/links/resolve-link?url=https://example.test/x', member.token);
      expect(res.status).toBe(404);
    });
  });
});
