import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Audit Logs API', () => {
  let token: string;
  let userId: string;
  let orgId: string;
  let auditLogIds: string[] = [];

  const testUser = {
    email: 'audit-test@axiom.dev',
    username: 'audit-testuser',
    displayName: 'Audit Test User',
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
      where: { slug: 'audit-test-org' },
      update: {},
      create: { name: 'Audit Test Org', slug: 'audit-test-org' },
    });
    orgId = org.id;

    // Must be OWNER to access admin routes
    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId } },
      update: { role: 'OWNER' },
      create: { userId, orgId, role: 'OWNER' },
    });

    // Seed some audit logs
    const log1 = await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'team.create',
        resource: 'team:test123',
        details: { name: 'New Team' },
      },
    });
    const log2 = await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'issue.delete',
        resource: 'issue:test456',
        details: { title: 'Deleted Issue' },
      },
    });
    const log3 = await prisma.auditLog.create({
      data: {
        orgId,
        userId,
        action: 'member.role_change',
        resource: 'member:test789',
        details: { from: 'MEMBER', to: 'ADMIN' },
      },
    });
    auditLogIds = [log1.id, log2.id, log3.id];

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
    await prisma.auditLog.deleteMany({ where: { id: { in: auditLogIds } } });
    await prisma.orgMembership.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── List Audit Logs ────────────────────────────────────────

  describe('GET /api/admin/audit-logs', () => {
    it('should list audit logs', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('logs');
      expect(res.body.logs.length).toBeGreaterThanOrEqual(3);
    });

    it('should filter by action', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs?action=team.create')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.logs.every((l: { action: string }) => l.action === 'team.create')).toBe(true);
    });

    it('should filter by userId', async () => {
      const res = await request(app)
        .get(`/api/admin/audit-logs?userId=${userId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeGreaterThanOrEqual(3);
    });

    it('should support pagination with limit and offset', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs?limit=1&offset=0')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeLessThanOrEqual(1);
    });
  });

  // ── Get Single Audit Log ───────────────────────────────────

  describe('GET /api/admin/audit-logs/:id', () => {
    it('should get a single audit log entry', async () => {
      const res = await request(app)
        .get(`/api/admin/audit-logs/${auditLogIds[0]}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(auditLogIds[0]);
      expect(res.body.action).toBe('team.create');
    });

    it('should return 404 for non-existent audit log', async () => {
      const res = await request(app)
        .get('/api/admin/audit-logs/nonexistent-id')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(404);
    });
  });

  // ── Access Control ─────────────────────────────────────────

  describe('Access control', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(app).get('/api/admin/audit-logs');
      expect(res.status).toBe(401);
    });

    it('should reject non-admin users', async () => {
      // Create a non-admin user
      const passwordHash = await bcrypt.hash('securepassword123', 4);
      const nonAdmin = await prisma.user.upsert({
        where: { username: 'audit-nonadmin' },
        update: {},
        create: {
          email: 'audit-nonadmin@axiom.dev',
          username: 'audit-nonadmin',
          displayName: 'Non Admin',
          passwordHash,
        },
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          login: 'audit-nonadmin@axiom.dev',
          password: 'securepassword123',
        });
      const nonAdminToken = loginRes.body.accessToken;

      const res = await request(app)
        .get('/api/admin/audit-logs')
        .set('Authorization', `Bearer ${nonAdminToken}`);
      expect(res.status).toBe(403);

      // Clean up non-admin user
      await prisma.refreshToken.deleteMany({ where: { userId: nonAdmin.id } });
      await prisma.user.deleteMany({ where: { id: nonAdmin.id } });
    });
  });
});
