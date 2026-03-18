import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('Admin API', () => {
  let adminToken: string;
  let memberToken: string;
  let memberUserId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    // Create admin user
    await prisma.user.upsert({
      where: { username: 'admin-test-user' },
      update: {},
      create: {
        email: 'admin-test@axiom.dev',
        username: 'admin-test-user',
        displayName: 'Admin Test User',
        passwordHash,
      },
    });

    // Create non-admin user
    const memberUser = await prisma.user.upsert({
      where: { username: 'member-test-user' },
      update: {},
      create: {
        email: 'member-test@axiom.dev',
        username: 'member-test-user',
        displayName: 'Member Test User',
        passwordHash,
      },
    });
    memberUserId = memberUser.id;

    // Login both users
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'admin-test@axiom.dev', password: 'testpassword123' });
    adminToken = adminLogin.body.accessToken;

    const memberLogin = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'member-test@axiom.dev', password: 'testpassword123' });
    memberToken = memberLogin.body.accessToken;

    // Create org via API (admin user becomes OWNER)
    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${adminToken}`)
      .set(XHR)
      .send({ name: 'Admin Test Org', slug: 'admin-test-org' });

    // Add member user to org as MEMBER
    await prisma.orgMembership.create({
      data: {
        userId: memberUserId,
        orgId: orgRes.body.id,
        role: 'MEMBER',
      },
    });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'admin-test-org' } });
    await prisma.user.deleteMany({
      where: { username: { in: ['admin-test-user', 'member-test-user'] } },
    });
    await prisma.$disconnect();
  });

  // ---- Access Control ----

  it('1. should reject non-admin access to stats', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });

  it('2. should reject non-admin access to user list', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${memberToken}`);
    expect(res.status).toBe(403);
  });

  it('3. should reject unauthenticated access', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });

  // ---- Stats ----

  it('4. should get system stats as admin', async () => {
    const res = await request(app)
      .get('/api/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.totalUsers).toBeGreaterThanOrEqual(2);
    expect(res.body.totalOrgs).toBeGreaterThanOrEqual(1);
    expect(res.body.storage).toBeDefined();
    expect(res.body.databaseSize).toBeDefined();
  });

  // ---- Users ----

  it('5. should list users as admin', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users).toBeDefined();
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(res.body.users)).toBe(true);
    // Users should not contain passwordHash
    for (const user of res.body.users) {
      expect(user.passwordHash).toBeUndefined();
    }
  });

  it('6. should search users', async () => {
    const res = await request(app)
      .get('/api/admin/users?search=admin-test')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBeGreaterThanOrEqual(1);
    expect(res.body.users[0].username).toBe('admin-test-user');
  });

  it('7. should get single user detail', async () => {
    const res = await request(app)
      .get(`/api/admin/users/${memberUserId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.username).toBe('member-test-user');
    expect(res.body.orgMemberships).toBeDefined();
  });

  it('8. should get system settings', async () => {
    const res = await request(app)
      .get('/api/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.version).toBeDefined();
    expect(res.body.nodeEnv).toBeDefined();
  });
});
