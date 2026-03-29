import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('Issue Query Engine (q param)', () => {
  let token: string;
  let projectId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'issue-query-test-user' },
      update: {},
      create: {
        email: 'issue-query-test@axiom.dev',
        username: 'issue-query-test-user',
        displayName: 'Issue Query Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Issue Query Test Org',
        slug: 'issue-query-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Issue Query Test Team',
        slug: 'issue-query-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'issue-query-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create project via API so default columns are created
    const projectRes = await request(app)
      .post(`/api/projects/team/${team.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Issue Query Test Project', slug: 'issue-query-test-project', prefix: 'IQT' });
    projectId = projectRes.body.id;

    // Seed issues: 2 BUG/HIGH, 1 BUG/MEDIUM, 1 STORY/HIGH
    await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ title: 'Login bug high', type: 'BUG', priority: 'HIGH' });

    await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ title: 'Signup bug medium', type: 'BUG', priority: 'MEDIUM' });

    await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ title: 'Dashboard story high', type: 'STORY', priority: 'HIGH' });
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'issue-query-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'issue-query-test-user' } });
    await prisma.$disconnect();
  });

  it('1. should filter issues by type using q param', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues?q=type:bug`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    res.body.issues.forEach((issue: { type: string }) => {
      expect(issue.type).toBe('BUG');
    });
  });

  it('2. should filter with complex AND query', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues?q=type%3DBUG%20AND%20priority%3DHIGH`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    res.body.issues.forEach((issue: { type: string; priority: string }) => {
      expect(issue.type).toBe('BUG');
      expect(issue.priority).toBe('HIGH');
    });
  });

  it('3. should fall back to text search for plain text q', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues?q=login`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    res.body.issues.forEach((issue: { title: string }) => {
      expect(issue.title.toLowerCase()).toContain('login');
    });
  });
});
