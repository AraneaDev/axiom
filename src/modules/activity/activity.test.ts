import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Activity API', () => {
  let token: string;
  let userId: string;
  let orgId: string;
  let teamId: string;
  let projectId: string;
  let issueId: string;
  let issueNumber: number;

  const testUser = {
    email: 'activity-test@axiom.dev',
    username: 'activity-testuser',
    displayName: 'Activity Test User',
    password: 'securepassword123',
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(testUser.password, 4);
    const user = await prisma.user.upsert({
      where: { username: testUser.username },
      update: {},
      create: {
        email: testUser.email,
        username: testUser.username,
        displayName: testUser.displayName,
        passwordHash,
      },
    });
    userId = user.id;

    const org = await prisma.organization.upsert({
      where: { slug: 'activity-test-org' },
      update: {},
      create: { name: 'Activity Test Org', slug: 'activity-test-org' },
    });
    orgId = org.id;

    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId } },
      update: {},
      create: { userId, orgId, role: 'OWNER' },
    });

    const team = await prisma.team.upsert({
      where: { orgId_slug: { orgId, slug: 'activity-test-team' } },
      update: {},
      create: { orgId, name: 'Activity Test Team', slug: 'activity-test-team' },
    });
    teamId = team.id;

    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: {},
      create: { userId, teamId, role: 'ADMIN' },
    });

    const project = await prisma.project.upsert({
      where: { teamId_slug: { teamId, slug: 'activity-test-project' } },
      update: {},
      create: {
        teamId,
        name: 'Activity Test Project',
        slug: 'activity-test-project',
        prefix: 'ACT',
      },
    });
    projectId = project.id;

    const issue = await prisma.issue.create({
      data: {
        projectId,
        number: 700,
        title: 'Activity Test Issue',
        body: 'Test body',
        creatorId: userId,
      },
    });
    issueId = issue.id;
    issueNumber = issue.number;

    // Seed some activities
    await prisma.activity.createMany({
      data: [
        {
          resourceType: 'issue',
          resourceId: issueId,
          action: 'created',
          userId,
        },
        {
          resourceType: 'issue',
          resourceId: issueId,
          action: 'status_changed',
          userId,
          details: { from: 'To Do', to: 'In Progress' },
        },
        {
          resourceType: 'issue',
          resourceId: issueId,
          action: 'assigned',
          userId,
          details: { to: userId },
        },
      ],
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: testUser.email,
        password: testUser.password,
      });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.activity.deleteMany({ where: { resourceId: issueId } });
    await prisma.issue.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.teamMembership.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.orgMembership.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── List Project Activity ──────────────────────────────────

  describe('GET /api/projects/:projectId/activity', () => {
    it('should list activities for a project', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/activity`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('activities');
      expect(res.body.activities.length).toBeGreaterThanOrEqual(1);
    });

    it('should return activities with expected structure', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/activity`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      const activity = res.body.activities[0];
      expect(activity).toHaveProperty('id');
      expect(activity).toHaveProperty('resourceType');
      expect(activity).toHaveProperty('action');
      expect(activity).toHaveProperty('userId');
    });
  });

  // ── List Issue Activity ────────────────────────────────────

  describe('GET /api/projects/:projectId/issues/:issueNumber/activity', () => {
    it('should list activities for a specific issue', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues/${issueNumber}/activity`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('activities');
      expect(res.body.activities.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter activities by resource type', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues/${issueNumber}/activity`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(
        res.body.activities.every((a: { resourceType: string }) => a.resourceType === 'issue'),
      ).toBe(true);
    });
  });

  // ── Issue Activity: Edge Cases ─────────────────────────────

  describe('GET /api/projects/:projectId/issues/:issueNumber/activity - edge cases', () => {
    it('should return 404 for non-existent issue number', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues/99999/activity`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('Issue not found');
    });
  });

  // ── Pagination ───────────────────────────────────────────

  describe('GET /api/projects/:projectId/activity - pagination', () => {
    it('should support pagination with limit and offset', async () => {
      const res1 = await request(app)
        .get(`/api/projects/${projectId}/activity?limit=1&offset=0`)
        .set('Authorization', `Bearer ${token}`);
      expect(res1.status).toBe(200);
      expect(res1.body.activities).toHaveLength(1);

      const res2 = await request(app)
        .get(`/api/projects/${projectId}/activity?limit=1&offset=1`)
        .set('Authorization', `Bearer ${token}`);
      expect(res2.status).toBe(200);
      expect(res2.body.activities).toHaveLength(1);

      // Different activities
      expect(res1.body.activities[0].id).not.toBe(res2.body.activities[0].id);
    });
  });

  // ── User shape in response ───────────────────────────────

  describe('Activity response includes user with avatar', () => {
    it('should include user with id, username, displayName, avatarUrl', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/activity`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);

      const activity = res.body.activities[0];
      expect(activity.user).toBeDefined();
      expect(activity.user).toHaveProperty('id');
      expect(activity.user).toHaveProperty('username');
      expect(activity.user).toHaveProperty('displayName');
      expect(activity.user).toHaveProperty('avatarUrl');
    });
  });

  // ── Activity Service: getIssueIdByNumber ─────────────────

  describe('Activity Service - getIssueIdByNumber', () => {
    it('should return issue ID for valid project + number', async () => {
      const { getIssueIdByNumber } = await import('./activity.service');
      const result = await getIssueIdByNumber(projectId, 700);
      expect(result).toBe(issueId);
    });

    it('should return null for non-existent issue', async () => {
      const { getIssueIdByNumber } = await import('./activity.service');
      const result = await getIssueIdByNumber(projectId, 99999);
      expect(result).toBeNull();
    });
  });

  // ── Unauthenticated Access ─────────────────────────────────

  describe('Unauthenticated access', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get(`/api/projects/${projectId}/activity`);
      expect(res.status).toBe(401);
    });
  });
});
