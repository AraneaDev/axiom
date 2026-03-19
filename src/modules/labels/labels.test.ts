import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Labels API', () => {
  let token: string;
  let userId: string;
  let orgId: string;
  let teamId: string;
  let projectId: string;

  const testUser = {
    email: 'label-test@axiom.dev',
    username: 'label-testuser',
    displayName: 'Label Test User',
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
      where: { slug: 'label-test-org' },
      update: {},
      create: { name: 'Label Test Org', slug: 'label-test-org' },
    });
    orgId = org.id;

    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId } },
      update: {},
      create: { userId, orgId, role: 'OWNER' },
    });

    const team = await prisma.team.upsert({
      where: { orgId_slug: { orgId, slug: 'label-test-team' } },
      update: {},
      create: { orgId, name: 'Label Test Team', slug: 'label-test-team' },
    });
    teamId = team.id;

    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: {},
      create: { userId, teamId, role: 'ADMIN' },
    });

    const project = await prisma.project.upsert({
      where: { teamId_slug: { teamId, slug: 'label-test-project' } },
      update: {},
      create: { teamId, name: 'Label Test Project', slug: 'label-test-project', prefix: 'LBL' },
    });
    projectId = project.id;

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
    await prisma.label.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.teamMembership.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.orgMembership.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── Create Label ───────────────────────────────────────────

  describe('POST /api/projects/:projectId/labels', () => {
    it('should create a label with name and color', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/labels`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'bug', color: '#ef4444', description: 'Bug reports' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('bug');
      expect(res.body.color).toBe('#ef4444');
      expect(res.body.description).toBe('Bug reports');
    });

    it('should reject missing name or color', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/labels`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'no-color' });
      expect(res.status).toBe(400);
    });

    it('should reject duplicate label names in the same project', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/labels`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'bug', color: '#000000' });
      expect(res.status).toBe(409);
    });
  });

  // ── List Labels ────────────────────────────────────────────

  describe('GET /api/projects/:projectId/labels', () => {
    it('should list labels for a project', async () => {
      // Create a second label first
      await request(app)
        .post(`/api/projects/${projectId}/labels`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'enhancement', color: '#3b82f6' });

      const res = await request(app)
        .get(`/api/projects/${projectId}/labels`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Update Label ───────────────────────────────────────────

  describe('PATCH /api/projects/:projectId/labels/:labelName', () => {
    it('should update a label color and description', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/labels/bug`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ color: '#dc2626', description: 'Updated bug description' });
      expect(res.status).toBe(200);
      expect(res.body.color).toBe('#dc2626');
      expect(res.body.description).toBe('Updated bug description');
    });

    it('should return 404 for non-existent label', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/labels/nonexistent`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ color: '#000' });
      expect(res.status).toBe(404);
    });
  });

  // ── Delete Label ───────────────────────────────────────────

  describe('DELETE /api/projects/:projectId/labels/:labelName', () => {
    it('should delete a label', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectId}/labels/enhancement`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(204);

      // Verify it is gone
      const listRes = await request(app)
        .get(`/api/projects/${projectId}/labels`)
        .set('Authorization', `Bearer ${token}`);
      const names = listRes.body.data.map((l: { name: string }) => l.name);
      expect(names).not.toContain('enhancement');
    });

    it('should return 404 when deleting non-existent label', async () => {
      const res = await request(app)
        .delete(`/api/projects/${projectId}/labels/nonexistent`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(404);
    });
  });
});
