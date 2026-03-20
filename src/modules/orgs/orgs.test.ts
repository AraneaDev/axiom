import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Orgs API', () => {
  let token: string;
  let orgId: string;
  let secondUserId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    await prisma.user.upsert({
      where: { username: 'orgs-test-owner' },
      update: {},
      create: {
        email: 'orgs-test-owner@axiom.dev',
        username: 'orgs-test-owner',
        displayName: 'Orgs Test Owner',
        passwordHash,
      },
    });

    const secondUser = await prisma.user.upsert({
      where: { username: 'orgs-test-member' },
      update: {},
      create: {
        email: 'orgs-test-member@axiom.dev',
        username: 'orgs-test-member',
        displayName: 'Orgs Test Member',
        passwordHash,
      },
    });
    secondUserId = secondUser.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: 'orgs-test-owner@axiom.dev',
        password: 'testpassword123',
      });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'orgs-test-org' } });
    await prisma.user.deleteMany({
      where: { username: { in: ['orgs-test-owner', 'orgs-test-member'] } },
    });
    await prisma.$disconnect();
  });

  // 1. Create org
  it('1. should create an org', async () => {
    const res = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Orgs Test Org', slug: 'orgs-test-org' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('orgs-test-org');
    expect(res.body.id).toBeDefined();
    orgId = res.body.id;
  });

  // 2. Get org by slug/id
  it('2. should get org by id', async () => {
    const res = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('orgs-test-org');
    expect(res.body.name).toBe('Orgs Test Org');
  });

  // 3. List orgs for user
  it('3. should list orgs for the current user', async () => {
    const res = await request(app).get('/api/orgs').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((o: { id: string }) => o.id === orgId);
    expect(found).toBeDefined();
  });

  // 4. Update org
  it('4. should update org name', async () => {
    const res = await request(app)
      .patch(`/api/orgs/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Orgs Test Org Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Orgs Test Org Updated');
  });

  // 5. Add member to org
  it('5. should add a member to the org', async () => {
    const res = await request(app)
      .post(`/api/orgs/${orgId}/members`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ userId: secondUserId, role: 'MEMBER' });
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(secondUserId);
  });

  // 6. List members via dedicated endpoint
  it('6. should list org members via dedicated endpoint', async () => {
    const res = await request(app)
      .get(`/api/orgs/${orgId}/members`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((m: { userId: string }) => m.userId === secondUserId);
    expect(found).toBeDefined();
    expect(found.user).toBeDefined();
  });

  // 7. List members via org detail
  it('7. should list members of the org', async () => {
    const res = await request(app)
      .get(`/api/orgs/${orgId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const members = res.body.members ?? [];
    const found = members.find((m: { userId: string }) => m.userId === secondUserId);
    expect(found).toBeDefined();
  });

  // 8. Remove member
  it('8. should remove a member from the org', async () => {
    const res = await request(app)
      .delete(`/api/orgs/${orgId}/members/${secondUserId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);
  });
});
