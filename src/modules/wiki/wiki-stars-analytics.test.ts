import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Wiki Stars & Analytics API', () => {
  let token: string;
  let teamId: string;
  let spaceId: string;
  let pageId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'wiki-stars-test-user' },
      update: {},
      create: {
        email: 'wiki-stars-test@axiom.dev',
        username: 'wiki-stars-test-user',
        displayName: 'Wiki Stars Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Wiki Stars Test Org',
        slug: 'wiki-stars-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Wiki Stars Test Team',
        slug: 'wiki-stars-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'wiki-stars-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create a wiki space and page
    const spaceRes = await request(app)
      .post(`/api/wiki/team/${teamId}/spaces`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Stars Test Space', slug: 'stars-test-space' });
    spaceId = spaceRes.body.id;

    const pageRes = await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Test Page', slug: 'test-page', body: 'Content here.' });
    pageId = pageRes.body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'wiki-stars-test-org' } });
    await prisma.user.deleteMany({
      where: { username: { in: ['wiki-stars-test-user'] } },
    });
    await prisma.$disconnect();
  });

  // ─── Stars ─────────────────────────────────────────────────

  it('should star a page for the current user', async () => {
    const res = await request(app)
      .post(`/api/wiki/pages/${pageId}/star`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send();
    expect(res.status).toBe(200);
    expect(res.body.starred).toBe(true);
  });

  it('should return starred status for a page', async () => {
    const res = await request(app)
      .get(`/api/wiki/pages/${pageId}/star`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(200);
    expect(res.body.starred).toBe(true);
  });

  it('should list starred pages for the current user', async () => {
    const res = await request(app)
      .get('/api/wiki/starred')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].page.id).toBe(pageId);
    expect(res.body[0].page.title).toBe('Test Page');
    expect(res.body[0].page.space).toBeDefined();
  });

  it('should unstar a page (toggle off)', async () => {
    const res = await request(app)
      .post(`/api/wiki/pages/${pageId}/star`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send();
    expect(res.status).toBe(200);
    expect(res.body.starred).toBe(false);
  });

  it('should show empty starred list after unstarring', async () => {
    const res = await request(app)
      .get('/api/wiki/starred')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  // ─── Analytics ─────────────────────────────────────────────

  it('should record a page view', async () => {
    const res = await request(app)
      .post(`/api/wiki/pages/${pageId}/view`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send();
    expect(res.status).toBe(204);
  });

  it('should debounce page views (no duplicate within 1 hour)', async () => {
    // Second view within same hour should be silently ignored
    const res = await request(app)
      .post(`/api/wiki/pages/${pageId}/view`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send();
    expect(res.status).toBe(204);

    const analytics = await request(app)
      .get(`/api/wiki/pages/${pageId}/analytics`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(analytics.status).toBe(200);
    expect(analytics.body.viewCount).toBe(1); // still 1 due to debounce
  });

  it('should return analytics with view count, unique viewers, and recent viewers', async () => {
    const res = await request(app)
      .get(`/api/wiki/pages/${pageId}/analytics`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(200);
    expect(res.body.viewCount).toBe(1);
    expect(res.body.uniqueViewers).toBe(1);
    expect(Array.isArray(res.body.recentViewers)).toBe(true);
    expect(res.body.recentViewers.length).toBe(1);
    expect(res.body.recentViewers[0].user.displayName).toBe('Wiki Stars Test User');
    expect(res.body.recentViewers[0].viewedAt).toBeDefined();
  });
});
