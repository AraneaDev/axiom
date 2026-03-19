import fs from 'fs/promises';

import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const TEST_REPOS_PATH = process.env.REPOS_PATH || '/tmp/axiom-test-repos';

describe('Releases API', () => {
  let token: string;
  let orgId: string;
  let teamId: string;
  let repoId: string;

  beforeAll(async () => {
    await fs.rm(TEST_REPOS_PATH, { recursive: true, force: true });
    await fs.mkdir(TEST_REPOS_PATH, { recursive: true });

    const passwordHash = await bcrypt.hash('testpassword123', 4);
    await prisma.user.upsert({
      where: { username: 'releaseuser' },
      update: {},
      create: {
        email: 'releaseuser@axiom.dev',
        username: 'releaseuser',
        displayName: 'Release User',
        passwordHash,
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'releaseuser', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create org
    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Release Org', slug: 'release-org' });
    orgId = orgRes.body.id;

    // Create team
    const teamRes = await request(app)
      .post(`/api/teams/org/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'RelTeam', slug: 'rel-team' });
    teamId = teamRes.body.id;

    // Create repo
    const repoRes = await request(app)
      .post(`/api/repos/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Rel Repo', slug: 'rel-repo', description: 'Test repo for releases' });
    repoId = repoRes.body.id;
  });

  afterAll(async () => {
    await prisma.release.deleteMany({});
    await prisma.repository.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.orgMembership.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
    await fs.rm(TEST_REPOS_PATH, { recursive: true, force: true });
  });

  it('should create a release', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/releases`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        tagName: 'v1.0.0',
        title: 'Version 1.0.0',
        body: 'First stable release',
        targetBranch: 'main',
        isDraft: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.tagName).toBe('v1.0.0');
    expect(res.body.title).toBe('Version 1.0.0');
    expect(res.body.isDraft).toBe(false);
    expect(res.body.repoId).toBe(repoId);
  });

  it('should create a draft release', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/releases`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        tagName: 'v2.0.0-draft',
        title: 'Version 2.0.0 Draft',
        body: 'Upcoming release',
        targetBranch: 'main',
        isDraft: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.isDraft).toBe(true);
    expect(res.body.publishedAt).toBeNull();
  });

  it('should list releases for a repo', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/releases`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  it('should get a release by tag name', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/releases/v1.0.0`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tagName).toBe('v1.0.0');
    expect(res.body.title).toBe('Version 1.0.0');
  });

  it('should update a release', async () => {
    const res = await request(app)
      .patch(`/api/repos/${repoId}/releases/v1.0.0`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Version 1.0.0 - Updated', body: 'Updated release notes' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Version 1.0.0 - Updated');
    expect(res.body.body).toBe('Updated release notes');
  });

  it('should publish a draft release', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/releases/v2.0.0-draft/publish`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.isDraft).toBe(false);
    expect(res.body.publishedAt).toBeTruthy();
  });

  it('should return 404 for non-existent release', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/releases/v99.99.99`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should delete a release', async () => {
    const res = await request(app)
      .delete(`/api/repos/${repoId}/releases/v1.0.0`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(204);
  });

  it('should confirm deletion reduced list count', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/releases`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
  });
});
