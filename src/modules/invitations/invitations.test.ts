import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

import app from '../../index';
import { prisma } from '../../config/database';

describe('Invitations', () => {
  let ownerToken: string;
  let orgId: string;
  let userId: string;
  let invitationId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('password123', 12);

    const user = await prisma.user.upsert({
      where: { email: 'invite-test-owner@test.dev' },
      update: {},
      create: {
        email: 'invite-test-owner@test.dev',
        username: 'invite_test_owner',
        displayName: 'Invite Test Owner',
        passwordHash,
      },
    });
    userId = user.id;

    const org = await prisma.organization.upsert({
      where: { slug: 'invite-test-org' },
      update: {},
      create: { name: 'Invite Test Org', slug: 'invite-test-org' },
    });
    orgId = org.id;

    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId: user.id, orgId: org.id } },
      update: { role: 'OWNER' },
      create: { userId: user.id, orgId: org.id, role: 'OWNER' },
    });

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'invite-test-owner@test.dev', password: 'password123' });
    ownerToken = res.body.accessToken;
  });

  afterAll(async () => {
    await prisma.invitation.deleteMany({ where: { orgId } });
    await prisma.orgMembership.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it('should create an invitation with valid data', async () => {
    const res = await request(app)
      .post(`/api/orgs/${orgId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'newmember@test.dev', role: 'MEMBER' });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe('newmember@test.dev');
    invitationId = res.body.id;
  });

  it('should reject invitation with invalid email', async () => {
    const res = await request(app)
      .post(`/api/orgs/${orgId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'not-an-email', role: 'MEMBER' });

    expect(res.status).toBe(400);
  });

  it('should reject invitation with invalid role', async () => {
    const res = await request(app)
      .post(`/api/orgs/${orgId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ email: 'test@test.dev', role: 'SUPERADMIN' });

    expect(res.status).toBe(400);
  });

  it('should list invitations for org', async () => {
    const res = await request(app)
      .get(`/api/orgs/${orgId}/invitations`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('should revoke a pending invitation', async () => {
    const res = await request(app)
      .delete(`/api/orgs/${orgId}/invitations/${invitationId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(204);
  });
});
