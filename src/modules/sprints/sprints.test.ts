import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Sprints API', () => {
  let token: string;
  let userId: string;
  let orgId: string;
  let teamId: string;
  let projectId: string;
  let columnId: string;
  let _doneColumnId: string;

  const testUser = {
    email: 'sprint-test@axiom.dev',
    username: 'sprint-testuser',
    displayName: 'Sprint Test User',
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
      where: { slug: 'sprint-test-org' },
      update: {},
      create: { name: 'Sprint Test Org', slug: 'sprint-test-org' },
    });
    orgId = org.id;

    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId } },
      update: {},
      create: { userId, orgId, role: 'OWNER' },
    });

    const team = await prisma.team.upsert({
      where: { orgId_slug: { orgId, slug: 'sprint-test-team' } },
      update: {},
      create: { orgId, name: 'Sprint Test Team', slug: 'sprint-test-team' },
    });
    teamId = team.id;

    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: {},
      create: { userId, teamId, role: 'ADMIN' },
    });

    const project = await prisma.project.upsert({
      where: { teamId_slug: { teamId, slug: 'sprint-test-project' } },
      update: {},
      create: { teamId, name: 'Sprint Test Project', slug: 'sprint-test-project', prefix: 'SPT' },
    });
    projectId = project.id;

    const col = await prisma.boardColumn.create({
      data: { projectId, name: 'To Do', position: 0, isDefault: true, isDone: false },
    });
    columnId = col.id;

    const doneCol = await prisma.boardColumn.create({
      data: { projectId, name: 'Done', position: 1, isDefault: false, isDone: true },
    });
    _doneColumnId = doneCol.id;

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
    await prisma.issue.deleteMany({ where: { projectId } });
    await prisma.sprint.deleteMany({ where: { projectId } });
    await prisma.boardColumn.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.teamMembership.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.orgMembership.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── Create Sprint ──────────────────────────────────────────

  describe('POST /api/projects/:projectId/sprints', () => {
    it('should create a sprint', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Sprint 1',
          goal: 'Deliver MVP',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Sprint 1');
      expect(res.body.status).toBe('PLANNING');
      expect(res.body.goal).toBe('Deliver MVP');
    });
  });

  // ── List Sprints ───────────────────────────────────────────

  describe('GET /api/projects/:projectId/sprints', () => {
    it('should list sprints for a project', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter sprints by status', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/sprints?status=PLANNING`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.every((s: { status: string }) => s.status === 'PLANNING')).toBe(true);
    });
  });

  // ── Sprint Lifecycle ───────────────────────────────────────

  describe('Sprint lifecycle: start and complete', () => {
    let sprintId: string;

    beforeAll(async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Lifecycle Sprint',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        });
      sprintId = res.body.id;
    });

    it('should start a sprint', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/sprints/${sprintId}/start`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send();
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ACTIVE');
    });

    it('should not allow starting another sprint when one is active', async () => {
      // Create another sprint
      const create = await request(app)
        .post(`/api/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Second Sprint',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        });
      const secondId = create.body.id;

      const res = await request(app)
        .post(`/api/projects/${projectId}/sprints/${secondId}/start`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send();
      expect(res.status).toBe(409);
    });

    it('should complete the active sprint', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/sprints/${sprintId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('COMPLETED');
    });
  });

  // ── Add/Remove Issues from Sprint ─────────────────────────

  describe('Sprint issue management', () => {
    let sprintId: string;
    let issueId: string;

    beforeAll(async () => {
      const sprintRes = await request(app)
        .post(`/api/projects/${projectId}/sprints`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Issue Mgmt Sprint',
          startDate: new Date().toISOString(),
          endDate: new Date(Date.now() + 14 * 86400000).toISOString(),
        });
      sprintId = sprintRes.body.id;

      const issue = await prisma.issue.create({
        data: {
          projectId,
          number: 900,
          title: 'Sprint Test Issue',
          body: 'Test body',
          creatorId: userId,
          columnId,
        },
      });
      issueId = issue.id;
    });

    it('should add issues to a sprint', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/sprints/${sprintId}/issues`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ issueIds: [issueId] });
      expect(res.status).toBe(200);
    });

    it('should remove an issue from a sprint', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectId}/sprints/${sprintId}/issues/${issueId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(204);
    });
  });

  // ── Velocity ───────────────────────────────────────────────

  describe('GET /api/projects/:projectId/velocity', () => {
    it('should return velocity data as an array', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/velocity`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
