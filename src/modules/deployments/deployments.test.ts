import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Deployments API', () => {
  let token: string;
  let userId: string;
  let orgId: string;
  let teamId: string;
  let repoId: string;

  const testUser = {
    email: 'deploy-test@axiom.dev',
    username: 'deploy-testuser',
    displayName: 'Deploy Test User',
    password: 'securepassword123',
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(testUser.password, 4);
    const user = await prisma.user.upsert({
      where: { username: testUser.username },
      update: {},
      create: {
        email: testUser.email,
        username: testUser.username,
        displayName: testUser.displayName,
        passwordHash,
      },
    });
    userId = user.id;

    const org = await prisma.organization.upsert({
      where: { slug: 'deploy-test-org' },
      update: {},
      create: { name: 'Deploy Test Org', slug: 'deploy-test-org' },
    });
    orgId = org.id;

    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId } },
      update: {},
      create: { userId, orgId, role: 'OWNER' },
    });

    const team = await prisma.team.upsert({
      where: { orgId_slug: { orgId, slug: 'deploy-test-team' } },
      update: {},
      create: { orgId, name: 'Deploy Test Team', slug: 'deploy-test-team' },
    });
    teamId = team.id;

    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: {},
      create: { userId, teamId, role: 'ADMIN' },
    });

    const repo = await prisma.repository.upsert({
      where: { teamId_slug: { teamId, slug: 'deploy-test-repo' } },
      update: {},
      create: {
        teamId,
        name: 'Deploy Test Repo',
        slug: 'deploy-test-repo',
        diskPath: '/tmp/axiom-test-repos/deploy-test-repo',
      },
    });
    repoId = repo.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: testUser.email,
        password: testUser.password,
      });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    // Clean up deployments and environments for this repo
    const envs = await prisma.deploymentEnvironment.findMany({ where: { repoId } });
    for (const env of envs) {
      await prisma.deployment.deleteMany({ where: { environmentId: env.id } });
    }
    await prisma.deploymentEnvironment.deleteMany({ where: { repoId } });
    await prisma.repository.deleteMany({ where: { id: repoId } });
    await prisma.teamMembership.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.orgMembership.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── Create Environment ─────────────────────────────────────

  describe('POST /api/repos/:repoId/environments', () => {
    it('should create an environment', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/environments`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'production', url: 'https://prod.example.com' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('production');
      expect(res.body.url).toBe('https://prod.example.com');
    });

    it('should create a staging environment', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/environments`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'staging' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('staging');
    });

    it('should reject missing name', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/environments`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ url: 'https://example.com' });
      expect(res.status).toBe(400);
    });
  });

  // ── List Environments ──────────────────────────────────────

  describe('GET /api/repos/:repoId/environments', () => {
    it('should list environments for a repo', async () => {
      const res = await request(app)
        .get(`/api/repos/${repoId}/environments`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── Create Deployment ──────────────────────────────────────

  describe('POST /api/repos/:repoId/environments/:envId/deployments', () => {
    let envId: string;

    beforeAll(async () => {
      const envs = await request(app)
        .get(`/api/repos/${repoId}/environments`)
        .set('Authorization', `Bearer ${token}`);
      envId = envs.body[0].id;
    });

    it('should create a deployment', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/environments/${envId}/deployments`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ commitSha: 'abc123def456', status: 'SUCCESS' });
      expect(res.status).toBe(201);
      expect(res.body.commitSha).toBe('abc123def456');
      expect(res.body.status).toBe('SUCCESS');
    });

    it('should reject missing commitSha', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/environments/${envId}/deployments`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ status: 'PENDING' });
      expect(res.status).toBe(400);
    });
  });

  // ── List Deployments ───────────────────────────────────────

  describe('GET /api/repos/:repoId/environments/:envId/deployments', () => {
    it('should list deployments for an environment', async () => {
      const envs = await request(app)
        .get(`/api/repos/${repoId}/environments`)
        .set('Authorization', `Bearer ${token}`);
      const envId = envs.body[0].id;

      const res = await request(app)
        .get(`/api/repos/${repoId}/environments/${envId}/deployments`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Last Deployed Timestamp ────────────────────────────────

  describe('Environment lastDeployedAt update', () => {
    it('should update lastDeployedAt when a deployment is created', async () => {
      const envs = await request(app)
        .get(`/api/repos/${repoId}/environments`)
        .set('Authorization', `Bearer ${token}`);
      const env = envs.body[0];
      expect(env.lastDeployedAt).not.toBeNull();
    });
  });
});
