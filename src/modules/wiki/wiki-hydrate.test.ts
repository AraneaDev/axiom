import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Wiki Page Hydration API', () => {
  let token: string;
  let spaceId: string;
  let pageSlug: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'wiki-hydrate-test-user' },
      update: {},
      create: {
        email: 'wiki-hydrate-test@axiom.dev',
        username: 'wiki-hydrate-test-user',
        displayName: 'Wiki Hydrate Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Wiki Hydrate Test Org',
        slug: 'wiki-hydrate-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Wiki Hydrate Test Team',
        slug: 'wiki-hydrate-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: 'wiki-hydrate-test@axiom.dev',
        password: 'testpassword123',
      });
    token = loginRes.body.accessToken;

    // Create a wiki space
    const spaceRes = await request(app)
      .post(`/api/wiki/team/${team.id}/spaces`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Hydrate Space', slug: 'hydrate-space' });
    spaceId = spaceRes.body.id;

    // Create a page
    pageSlug = 'hydrate-test-page';
    await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Hydrate Test Page', slug: pageSlug, body: 'Test body content' });
  });

  afterAll(async () => {
    await prisma.organization
      .delete({ where: { slug: 'wiki-hydrate-test-org' } })
      .catch(() => {});
    await prisma.user.delete({ where: { username: 'wiki-hydrate-test-user' } }).catch(() => {});
  });

  it('should return all sections (200)', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/${pageSlug}/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('page');
    expect(res.body).toHaveProperty('labels');
    expect(res.body).toHaveProperty('attachments');
    expect(res.body).toHaveProperty('history');
    expect(res.body).toHaveProperty('children');
    expect(res.body.page.slug).toBe(pageSlug);
    expect(res.body.page.title).toBe('Hydrate Test Page');
  });

  it('should return 404 for non-existent page', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/does-not-exist/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(404);
  });

  it('should require authentication (401)', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/${pageSlug}/hydrate`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(401);
  });
});
