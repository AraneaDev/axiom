import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('Runners API', () => {
  let token: string;
  let orgId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    await prisma.user.upsert({
      where: { username: 'runners-test-user' },
      update: {},
      create: {
        email: 'runners-test@axiom.dev',
        username: 'runners-test-user',
        displayName: 'Runners Test User',
        passwordHash,
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'runners-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create org via API
    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Runners Test Org', slug: 'runners-test-org' });
    orgId = orgRes.body.id;
  });

  afterAll(async () => {
    await prisma.runnerRegistrationToken.deleteMany({
      where: { scopeType: 'ORG', scopeId: orgId },
    });
    await prisma.organization.deleteMany({ where: { slug: 'runners-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'runners-test-user' } });
    await prisma.$disconnect();
  });

  it('1. should create a registration token', async () => {
    const res = await request(app)
      .post(`/api/orgs/${orgId}/runners/registration-token`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBe(64); // 32 bytes hex
    expect(res.body.id).toBeDefined();
    expect(res.body.expiresAt).toBeDefined();
  });

  it('2. should list runners (empty initially)', async () => {
    const res = await request(app)
      .get(`/api/orgs/${orgId}/runners`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('3. should delete a runner via API', async () => {
    // Create a runner directly via Prisma
    const runner = await prisma.runner.create({
      data: {
        name: 'test-runner',
        scopeType: 'ORG',
        scopeId: orgId,
        labels: ['self-hosted', 'linux'],
        status: 'OFFLINE',
      },
    });

    // Verify it appears in the list
    const listRes = await request(app)
      .get(`/api/orgs/${orgId}/runners`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].name).toBe('test-runner');

    // Delete via API
    const delRes = await request(app)
      .delete(`/api/orgs/${orgId}/runners/${runner.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(delRes.status).toBe(204);

    // Verify it was deleted
    const listRes2 = await request(app)
      .get(`/api/orgs/${orgId}/runners`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes2.body.length).toBe(0);
  });
});
