import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Wiki API', () => {
  let token: string;
  let teamId: string;
  let spaceId: string;
  let rootPageSlug: string;
  let childPageSlug: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'wiki-test-user' },
      update: {},
      create: {
        email: 'wiki-test@axiom.dev',
        username: 'wiki-test-user',
        displayName: 'Wiki Test User',
        passwordHash,
      },
    });

    const org = await prisma.org.create({
      data: {
        name: 'Wiki Test Org',
        slug: 'wiki-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Wiki Test Team',
        slug: 'wiki-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app).post('/api/auth/login').send({
      login: 'wiki-test@axiom.dev',
      password: 'testpassword123',
    });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.org.deleteMany({ where: { slug: 'wiki-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'wiki-test-user' } });
    await prisma.$disconnect();
  });

  // 1. Create wiki space
  it('1. should create a wiki space', async () => {
    const res = await request(app)
      .post(`/api/wiki/team/${teamId}/spaces`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Wiki Space', slug: 'test-wiki-space' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Wiki Space');
    expect(res.body.id).toBeDefined();
    spaceId = res.body.id;
  });

  // 2. Create root page
  it('2. should create a root page', async () => {
    const res = await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Root Page',
        slug: 'root-page',
        content: 'This is the root page content.',
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Root Page');
    expect(res.body.slug).toBeDefined();
    rootPageSlug = res.body.slug;
  });

  // 3. Create child page
  it('3. should create a child page under the root page', async () => {
    const rootPage = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/${rootPageSlug}`)
      .set('Authorization', `Bearer ${token}`);
    const parentId = rootPage.body.id;

    const res = await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Child Page',
        slug: 'child-page',
        content: 'This is a child page.',
        parentId,
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Child Page');
    childPageSlug = res.body.slug;
  });

  // 4. Get page tree and verify hierarchy
  it('4. should get page tree and verify hierarchy', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/tree`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const tree = res.body.tree ?? res.body;
    expect(Array.isArray(tree)).toBe(true);
    const root = tree.find((p: { slug: string }) => p.slug === rootPageSlug);
    expect(root).toBeDefined();
    const children = root.children ?? [];
    expect(children.length).toBeGreaterThan(0);
    const child = children.find((c: { slug: string }) => c.slug === childPageSlug);
    expect(child).toBeDefined();
  });

  // 5. Update page
  it('5. should update a page and create a new version', async () => {
    const res = await request(app)
      .patch(`/api/wiki/spaces/${spaceId}/pages/${rootPageSlug}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Updated root page content.', title: 'Root Page Updated' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Root Page Updated');
  });

  // 6. Get page history
  it('6. should get page history with at least 2 versions', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/${rootPageSlug}/history`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const versions = res.body.versions ?? res.body;
    expect(Array.isArray(versions)).toBe(true);
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });

  // 7. Delete page
  it('7. should delete the child page', async () => {
    const res = await request(app)
      .delete(`/api/wiki/spaces/${spaceId}/pages/${childPageSlug}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
