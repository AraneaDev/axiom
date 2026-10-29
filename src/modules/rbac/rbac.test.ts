import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('RBAC Permission Boundaries', () => {
  let ownerToken: string;
  let outsiderToken: string;
  let orgId: string;
  let teamId: string;
  let projectId: string;
  let wikiSpaceId: string;
  let issueNumber: number;

  const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

  function authed(tok: string) {
    return { Authorization: `Bearer ${tok}`, ...XHR };
  }

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    // Create owner user
    await prisma.user.upsert({
      where: { username: 'rbac-owner' },
      update: {},
      create: {
        email: 'rbac-owner@axiom.dev',
        username: 'rbac-owner',
        displayName: 'RBAC Owner',
        passwordHash,
      },
    });

    // Create outsider user (not in org/team)
    await prisma.user.upsert({
      where: { username: 'rbac-outsider' },
      update: {},
      create: {
        email: 'rbac-outsider@axiom.dev',
        username: 'rbac-outsider',
        displayName: 'RBAC Outsider',
        passwordHash,
      },
    });

    // Login as owner
    const ownerLogin = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'rbac-owner', password: 'testpassword123' });
    ownerToken = ownerLogin.body.accessToken;

    // Login as outsider
    const outsiderLogin = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'rbac-outsider', password: 'testpassword123' });
    outsiderToken = outsiderLogin.body.accessToken;

    // Create org (owner becomes OWNER member automatically)
    const orgRes = await request(app)
      .post('/api/orgs')
      .set(authed(ownerToken))
      .send({ name: 'RBAC Test Org', slug: 'rbac-test-org' });
    orgId = orgRes.body.id;

    // Create team
    const teamRes = await request(app)
      .post(`/api/teams/org/${orgId}`)
      .set(authed(ownerToken))
      .send({ name: 'RBAC Team', slug: 'rbac-team' });
    teamId = teamRes.body.id;

    // Create project
    const projectRes = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set(authed(ownerToken))
      .send({ name: 'RBAC Project', slug: 'rbac-project', prefix: 'RBC' });
    projectId = projectRes.body.id;

    // Create wiki space
    const wikiRes = await request(app)
      .post(`/api/wiki/team/${teamId}/spaces`)
      .set(authed(ownerToken))
      .send({ name: 'RBAC Wiki', slug: 'rbac-wiki' });
    wikiSpaceId = wikiRes.body.id;

    // Create an issue for issue-level tests
    const issueRes = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set(authed(ownerToken))
      .send({ title: 'RBAC test issue', priority: 'MEDIUM', type: 'TASK' });
    issueNumber = issueRes.body.number;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'rbac-test-org' } });
    await prisma.user.deleteMany({
      where: { username: { in: ['rbac-owner', 'rbac-outsider'] } },
    });
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------
  // Unauthenticated requests (no token) -- expect 401
  // ---------------------------------------------------------------
  describe('Unauthenticated (no token)', () => {
    it('should reject unauthenticated org list', async () => {
      const res = await request(app).get('/api/orgs');
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated team list', async () => {
      const res = await request(app).get(`/api/teams/org/${orgId}`);
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated issue list', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/issues`);
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated wiki space list', async () => {
      const res = await request(app).get(`/api/wiki/team/${teamId}/spaces`);
      expect(res.status).toBe(401);
    });

    it('should reject unauthenticated admin stats', async () => {
      const res = await request(app).get('/api/admin/stats');
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------
  // Org-level: outsider cannot manage org
  // ---------------------------------------------------------------
  describe('Org-level permissions', () => {
    it('outsider cannot update org', async () => {
      const res = await request(app)
        .patch(`/api/orgs/${orgId}`)
        .set(authed(outsiderToken))
        .send({ name: 'Hacked Org' });
      expect(res.status).toBe(403);
    });

    it('outsider cannot delete org', async () => {
      const res = await request(app).delete(`/api/orgs/${orgId}`).set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot add org members', async () => {
      const res = await request(app)
        .post(`/api/orgs/${orgId}/members`)
        .set(authed(outsiderToken))
        .send({ email: 'someone@test.com', role: 'MEMBER' });
      expect(res.status).toBe(403);
    });

    it('outsider cannot create invite links', async () => {
      const res = await request(app)
        .post(`/api/orgs/${orgId}/invites`)
        .set(authed(outsiderToken))
        .send({});
      expect(res.status).toBe(403);
    });

    it('outsider cannot list invite links', async () => {
      const res = await request(app).get(`/api/orgs/${orgId}/invites`).set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // Team-level: outsider cannot manage teams
  // ---------------------------------------------------------------
  describe('Team-level permissions', () => {
    it('outsider cannot update team', async () => {
      const res = await request(app)
        .patch(`/api/teams/${teamId}`)
        .set(authed(outsiderToken))
        .send({ name: 'Hacked Team' });
      expect(res.status).toBe(403);
    });

    it('outsider cannot delete team', async () => {
      const res = await request(app).delete(`/api/teams/${teamId}`).set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot add team members', async () => {
      const res = await request(app)
        .post(`/api/teams/${teamId}/members`)
        .set(authed(outsiderToken))
        .send({ userId: 'some-id', role: 'MEMBER' });
      expect(res.status).toBe(403);
    });

    it('outsider cannot create projects in team', async () => {
      const res = await request(app)
        .post(`/api/projects/team/${teamId}`)
        .set(authed(outsiderToken))
        .send({ name: 'Hacked Project', slug: 'hacked-project', prefix: 'HCK' });
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // Project-level: outsider cannot access project resources
  // ---------------------------------------------------------------
  describe('Project-level permissions', () => {
    it('outsider cannot list project issues', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot create issues', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/issues`)
        .set(authed(outsiderToken))
        .send({ title: 'Hacked issue', priority: 'HIGH', type: 'BUG' });
      expect(res.status).toBe(403);
    });

    it('outsider cannot view project board', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/board`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot view project activity', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/activity`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // Issue-level: outsider cannot manipulate issues
  // ---------------------------------------------------------------
  describe('Issue-level permissions', () => {
    it('outsider cannot update an issue', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/issues/${issueNumber}`)
        .set(authed(outsiderToken))
        .send({ title: 'Hacked title' });
      expect(res.status).toBe(403);
    });

    it('outsider cannot delete an issue', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectId}/issues/${issueNumber}`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot add comments to an issue', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/issues/${issueNumber}/comments`)
        .set(authed(outsiderToken))
        .send({ body: 'Hacked comment' });
      expect(res.status).toBe(403);
    });

    it('outsider cannot view issue details', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues/${issueNumber}`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot bulk update issues', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/issues/bulk`)
        .set(authed(outsiderToken))
        .send({ issueIds: [], updates: { priority: 'LOW' } });
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // Wiki-level: outsider cannot access wiki space-specific routes
  // ---------------------------------------------------------------
  describe('Wiki-level permissions', () => {
    it('outsider cannot create wiki spaces (requireTeamPermission enforced)', async () => {
      const res = await request(app)
        .post(`/api/wiki/team/${teamId}/spaces`)
        .set(authed(outsiderToken))
        .send({ name: 'Hacked Wiki', slug: 'hacked-wiki' });
      expect(res.status).toBe(403);
    });

    it('outsider cannot list wiki spaces (requireTeamPermission enforced)', async () => {
      const res = await request(app)
        .get(`/api/wiki/team/${teamId}/spaces`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot view wiki space details', async () => {
      const res = await request(app)
        .get(`/api/wiki/spaces/${wikiSpaceId}`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot view wiki page tree', async () => {
      const res = await request(app)
        .get(`/api/wiki/spaces/${wikiSpaceId}/tree`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot create wiki pages', async () => {
      const res = await request(app)
        .post(`/api/wiki/spaces/${wikiSpaceId}/pages`)
        .set(authed(outsiderToken))
        .send({ title: 'Hacked Page', slug: 'hacked-page', body: 'content' });
      expect(res.status).toBe(403);
    });

    it('outsider cannot list wiki templates', async () => {
      const res = await request(app)
        .get(`/api/wiki/spaces/${wikiSpaceId}/templates`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('outsider cannot search wiki by label', async () => {
      const res = await request(app)
        .get(`/api/wiki/spaces/${wikiSpaceId}/labels`)
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('unauthenticated cannot create wiki pages', async () => {
      // CSRF guard returns 403 for POST without X-Requested-With before auth runs
      const res = await request(app)
        .post(`/api/wiki/spaces/${wikiSpaceId}/pages`)
        .send({ title: 'Anon Page', slug: 'anon-page', body: 'content' });
      expect([401, 403]).toContain(res.status);
    });

    it('unauthenticated cannot view wiki page tree', async () => {
      const res = await request(app).get(`/api/wiki/spaces/${wikiSpaceId}/tree`);
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------
  // Admin-level: non-admin cannot access admin endpoints
  // ---------------------------------------------------------------
  describe('Admin-level permissions', () => {
    it('non-admin cannot access admin stats', async () => {
      const res = await request(app).get('/api/admin/stats').set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('non-admin cannot list users', async () => {
      const res = await request(app).get('/api/admin/users').set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('non-admin cannot update users', async () => {
      const res = await request(app)
        .patch('/api/admin/users/some-user-id')
        .set(authed(outsiderToken))
        .send({ role: 'OWNER' });
      expect(res.status).toBe(403);
    });

    it('non-admin cannot delete users', async () => {
      const res = await request(app)
        .delete('/api/admin/users/some-user-id')
        .set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });

    it('non-admin cannot access admin settings', async () => {
      const res = await request(app).get('/api/admin/settings').set(authed(outsiderToken));
      expect(res.status).toBe(403);
    });
  });

  // ---------------------------------------------------------------
  // Verify owner CAN access resources (positive control)
  // ---------------------------------------------------------------
  describe('Owner access (positive control)', () => {
    it('owner can list org details', async () => {
      const res = await request(app).get(`/api/orgs/${orgId}`).set(authed(ownerToken));
      expect(res.status).toBe(200);
    });

    it('owner can list teams', async () => {
      const res = await request(app).get(`/api/teams/org/${orgId}`).set(authed(ownerToken));
      expect(res.status).toBe(200);
    });

    it('owner can list project issues', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues`)
        .set(authed(ownerToken));
      expect(res.status).toBe(200);
    });

    it('owner can view issue details', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues/${issueNumber}`)
        .set(authed(ownerToken));
      expect(res.status).toBe(200);
    });

    it('owner can list wiki spaces', async () => {
      const res = await request(app).get(`/api/wiki/team/${teamId}/spaces`).set(authed(ownerToken));
      expect(res.status).toBe(200);
    });

    it('owner can view wiki space details', async () => {
      const res = await request(app).get(`/api/wiki/spaces/${wikiSpaceId}`).set(authed(ownerToken));
      expect(res.status).toBe(200);
    });

    it('owner can view wiki page tree', async () => {
      const res = await request(app)
        .get(`/api/wiki/spaces/${wikiSpaceId}/tree`)
        .set(authed(ownerToken));
      expect(res.status).toBe(200);
    });
  });
});
