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
  let secondToken: string;
  let rootPageId: string;
  let commentId: string;

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

    const org = await prisma.organization.create({
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
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: 'wiki-test@axiom.dev',
        password: 'testpassword123',
      });
    token = loginRes.body.accessToken;

    // Second user for ownership tests
    const user2 = await prisma.user.upsert({
      where: { username: 'wiki-test-user2' },
      update: {},
      create: {
        email: 'wiki-test2@axiom.dev',
        username: 'wiki-test-user2',
        displayName: 'Wiki Test User 2',
        passwordHash,
      },
    });
    await prisma.orgMembership.create({
      data: { userId: user2.id, orgId: org.id, role: 'MEMBER' },
    });
    await prisma.teamMembership.create({
      data: { userId: user2.id, teamId: team.id, role: 'MEMBER' },
    });
    const login2 = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'wiki-test2@axiom.dev', password: 'testpassword123' });
    secondToken = login2.body.accessToken;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'wiki-test-org' } });
    await prisma.user.deleteMany({
      where: { username: { in: ['wiki-test-user', 'wiki-test-user2'] } },
    });
    await prisma.$disconnect();
  });

  // 1. Create wiki space
  it('1. should create a wiki space', async () => {
    const res = await request(app)
      .post(`/api/wiki/team/${teamId}/spaces`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
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
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        title: 'Root Page',
        slug: 'root-page',
        content: 'This is the root page content.',
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Root Page');
    expect(res.body.slug).toBeDefined();
    rootPageSlug = res.body.slug;
    rootPageId = res.body.id;
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
      .set('X-Requested-With', 'XMLHttpRequest')
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
      .set('X-Requested-With', 'XMLHttpRequest')
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

  // ─── Version Diff & Restore ────────────────────────────────

  // 6a. Update with change description
  it('6a. should update a page with a change description', async () => {
    const res = await request(app)
      .patch(`/api/wiki/spaces/${spaceId}/pages/${rootPageSlug}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Version 3 content.', changeDescription: 'Added version 3 content' });
    expect(res.status).toBe(200);
  });

  // 6b. Diff two versions
  it('6b. should diff two versions', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/${rootPageSlug}/diff?from=2&to=3`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.from).toBeDefined();
    expect(res.body.to).toBeDefined();
    expect(res.body.from.version).toBe(2);
    expect(res.body.to.version).toBe(3);
    expect(Array.isArray(res.body.changes)).toBe(true);
    expect(res.body.changes.length).toBeGreaterThan(0);
  });

  // 6c. Diff with invalid versions should fail
  it('6c. should reject diff with same version numbers', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/${rootPageSlug}/diff?from=1&to=1`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  // 6d. Restore a version
  it('6d. should restore a previous version', async () => {
    const res = await request(app)
      .post(`/api/wiki/spaces/${spaceId}/pages/${rootPageSlug}/restore`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ version: 1 });
    expect(res.status).toBe(200);
    // Check the latest version has the restore description
    expect(res.body.versions[0].changeDescription).toBe('Restored to version 1');
  });

  // 6e. History should now have more versions after restore
  it('6e. should have additional version after restore', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/${rootPageSlug}/history`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const versions = res.body.versions ?? res.body;
    expect(versions.length).toBeGreaterThanOrEqual(4);
    // Latest version should be the restored one
    const latest = versions[0];
    expect(latest.changeDescription).toBe('Restored to version 1');
  });

  // 6f. Diff should include changeDescription
  it('6f. should include changeDescription in diff response', async () => {
    const res = await request(app)
      .get(`/api/wiki/spaces/${spaceId}/pages/${rootPageSlug}/diff?from=2&to=3`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.to.changeDescription).toBe('Added version 3 content');
  });

  // ─── Page Comments ──────────────────────────────────────────

  // 7a. Add comment to page
  it('7a. should add a comment to a page', async () => {
    const res = await request(app)
      .post(`/api/wiki/pages/${rootPageId}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'This is a wiki comment' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('This is a wiki comment');
    commentId = res.body.id;
  });

  // 7b. Update comment body
  it('7b. should update a wiki page comment body', async () => {
    const res = await request(app)
      .patch(`/api/wiki/comments/${commentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Updated wiki comment' });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Updated wiki comment');
  });

  // 7c. Update comment as different user -- expect 403
  it('7c. should reject wiki comment update from non-author', async () => {
    const res = await request(app)
      .patch(`/api/wiki/comments/${commentId}`)
      .set('Authorization', `Bearer ${secondToken}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Unauthorized edit' });
    expect(res.status).toBe(403);
  });

  // 7. Delete page
  it('7. should delete the child page', async () => {
    const res = await request(app)
      .delete(`/api/wiki/spaces/${spaceId}/pages/${childPageSlug}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);
  });
});
