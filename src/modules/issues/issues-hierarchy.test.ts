import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Issues Hierarchy API', () => {
  let token: string;
  let userId: string;
  let orgId: string;
  let teamId: string;
  let projectId: string;
  let columnId: string;
  let doneColumnId: string;

  // Issue numbers for our test issues
  const parentNumber = 500;
  const childNumber1 = 501;
  const childNumber2 = 502;
  const childNumber3 = 503;

  const testUser = {
    email: 'hierarchy-test@axiom.dev',
    username: 'hierarchy-testuser',
    displayName: 'Hierarchy Test User',
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
      where: { slug: 'hierarchy-test-org' },
      update: {},
      create: { name: 'Hierarchy Test Org', slug: 'hierarchy-test-org' },
    });
    orgId = org.id;

    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId } },
      update: {},
      create: { userId, orgId, role: 'OWNER' },
    });

    const team = await prisma.team.upsert({
      where: { orgId_slug: { orgId, slug: 'hierarchy-test-team' } },
      update: {},
      create: { orgId, name: 'Hierarchy Test Team', slug: 'hierarchy-test-team' },
    });
    teamId = team.id;

    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: {},
      create: { userId, teamId, role: 'ADMIN' },
    });

    const project = await prisma.project.upsert({
      where: { teamId_slug: { teamId, slug: 'hierarchy-test-project' } },
      update: {},
      create: {
        teamId,
        name: 'Hierarchy Test Project',
        slug: 'hierarchy-test-project',
        prefix: 'HIR',
      },
    });
    projectId = project.id;

    const col = await prisma.boardColumn.create({
      data: { projectId, name: 'To Do', position: 0, isDefault: true, isDone: false },
    });
    columnId = col.id;

    const doneCol = await prisma.boardColumn.create({
      data: { projectId, name: 'Done', position: 1, isDefault: false, isDone: true },
    });
    doneColumnId = doneCol.id;

    // Create parent (epic) and child issues
    await prisma.issue.create({
      data: {
        projectId,
        number: parentNumber,
        title: 'Epic Parent Issue',
        body: 'Parent epic',
        type: 'EPIC',
        creatorId: userId,
        columnId,
      },
    });

    await prisma.issue.create({
      data: {
        projectId,
        number: childNumber1,
        title: 'Child Issue 1',
        body: 'First child',
        type: 'TASK',
        storyPoints: 3,
        creatorId: userId,
        columnId: doneColumnId,
      },
    });

    await prisma.issue.create({
      data: {
        projectId,
        number: childNumber2,
        title: 'Child Issue 2',
        body: 'Second child',
        type: 'TASK',
        storyPoints: 5,
        creatorId: userId,
        columnId,
      },
    });

    await prisma.issue.create({
      data: {
        projectId,
        number: childNumber3,
        title: 'Child Issue 3 - for circular test',
        body: 'Third child',
        type: 'TASK',
        creatorId: userId,
        columnId,
      },
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
    // Unset parentId before deleting to avoid FK issues
    await prisma.issue.updateMany({
      where: { projectId },
      data: { parentId: null },
    });
    await prisma.issue.deleteMany({ where: { projectId } });
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

  // ── Set Parent Issue ───────────────────────────────────────

  describe('PATCH /api/projects/:projectId/issues/:issueNumber/parent', () => {
    it('should set parent issue', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/issues/${childNumber1}/parent`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ parentIssueNumber: parentNumber });
      expect(res.status).toBe(200);
    });

    it('should set parent for second child', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/issues/${childNumber2}/parent`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ parentIssueNumber: parentNumber });
      expect(res.status).toBe(200);
    });

    it('should reject setting an issue as its own parent', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/issues/${parentNumber}/parent`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ parentIssueNumber: parentNumber });
      expect(res.status).toBe(400);
    });

    it('should clear parent when null is passed', async () => {
      // First set a parent, then clear it
      await request(app)
        .patch(`/api/projects/${projectId}/issues/${childNumber3}/parent`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ parentIssueNumber: parentNumber });

      const res = await request(app)
        .patch(`/api/projects/${projectId}/issues/${childNumber3}/parent`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ parentIssueNumber: null });
      expect(res.status).toBe(200);
    });
  });

  // ── Circular Reference Prevention ──────────────────────────

  describe('Circular reference prevention', () => {
    it('should reject circular parent references', async () => {
      // childNumber1 -> parentNumber (already set)
      // Now try to set parentNumber -> childNumber1 (would be circular)
      const res = await request(app)
        .patch(`/api/projects/${projectId}/issues/${parentNumber}/parent`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ parentIssueNumber: childNumber1 });
      expect(res.status).toBe(400);
    });
  });

  // ── Get Children ───────────────────────────────────────────

  describe('GET /api/projects/:projectId/issues/:issueNumber/children', () => {
    it('should return child issues', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues/${parentNumber}/children`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array for issues with no children', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues/${childNumber1}/children`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(0);
    });
  });

  // ── Epic Progress ──────────────────────────────────────────

  describe('GET /api/projects/:projectId/issues/:issueNumber/progress', () => {
    it('should return epic progress stats', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/issues/${parentNumber}/progress`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('completed');
      expect(res.body).toHaveProperty('percentage');
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      // childNumber1 is in doneColumn, so at least 1 is completed
      expect(res.body.completed).toBeGreaterThanOrEqual(1);
      expect(typeof res.body.percentage).toBe('number');
    });
  });
});
