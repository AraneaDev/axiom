import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('Wiki Template Resolution API', () => {
  let token: string;
  let teamId: string;
  let spaceId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'wiki-template-test-user' },
      update: {},
      create: {
        email: 'wiki-template-test@axiom.dev',
        username: 'wiki-template-test-user',
        displayName: 'Wiki Template Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Wiki Template Test Org',
        slug: 'wiki-template-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Wiki Template Test Team',
        slug: 'wiki-template-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'wiki-template-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create a wiki space to use in resolve-template calls
    const spaceRes = await request(app)
      .post(`/api/wiki/team/${teamId}/spaces`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Template Test Space', slug: 'template-test-space' });
    spaceId = spaceRes.body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'wiki-template-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'wiki-template-test-user' } });
    await prisma.$disconnect();
  });

  it('1. should resolve template variables', async () => {
    const res = await request(app)
      .post('/api/wiki/resolve-template')
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({
        body: 'Hello, {{currentUser.displayName}}!',
        context: { teamId, spaceId },
      });
    expect(res.status).toBe(200);
    expect(res.body.body).toContain('Wiki Template Test User');
    expect(res.body.body).not.toContain('{{');
  });

  it('2. should resolve now() function', async () => {
    const res = await request(app)
      .post('/api/wiki/resolve-template')
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({
        body: '{{now()}}',
        context: { teamId, spaceId },
      });
    expect(res.status).toBe(200);
    expect(res.body.body).toBeTruthy();
    expect(res.body.body).not.toBe('{{now()}}');
  });

  it('3. should handle missing variables gracefully', async () => {
    const res = await request(app)
      .post('/api/wiki/resolve-template')
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({
        body: 'Value: {{nonexistent.path}}',
        context: { teamId, spaceId },
      });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Value: ');
  });

  it('4. should require authentication', async () => {
    const res = await request(app).post('/api/wiki/resolve-template').set(XHR).send({
      body: '{{currentUser.displayName}}',
      context: { teamId, spaceId },
    });
    expect(res.status).toBe(401);
  });
});
