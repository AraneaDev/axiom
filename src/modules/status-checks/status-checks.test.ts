import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Status Checks API', () => {
  let token: string;
  let userId: string;
  let orgId: string;
  let teamId: string;
  let repoId: string;

  const testUser = {
    email: 'sc-test@axiom.dev',
    username: 'sc-testuser',
    displayName: 'SC Test User',
    password: 'securepassword123',
  };

  const testSha = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

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
      where: { slug: 'sc-test-org' },
      update: {},
      create: { name: 'SC Test Org', slug: 'sc-test-org' },
    });
    orgId = org.id;

    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId } },
      update: {},
      create: { userId, orgId, role: 'OWNER' },
    });

    const team = await prisma.team.upsert({
      where: { orgId_slug: { orgId, slug: 'sc-test-team' } },
      update: {},
      create: { orgId, name: 'SC Test Team', slug: 'sc-test-team' },
    });
    teamId = team.id;

    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: {},
      create: { userId, teamId, role: 'ADMIN' },
    });

    const repo = await prisma.repository.upsert({
      where: { teamId_slug: { teamId, slug: 'sc-test-repo' } },
      update: {},
      create: {
        teamId,
        name: 'SC Test Repo',
        slug: 'sc-test-repo',
        diskPath: '/tmp/axiom-test-repos/sc-test-repo',
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
    await prisma.commitStatus.deleteMany({ where: { repoId } });
    await prisma.repository.deleteMany({ where: { id: repoId } });
    await prisma.teamMembership.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.orgMembership.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── Create Status Check ────────────────────────────────────

  describe('POST /api/repos/:repoId/statuses', () => {
    it('should create a status check', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/statuses`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          sha: testSha,
          context: 'ci/build',
          state: 'SUCCESS',
          description: 'Build passed',
          targetUrl: 'https://ci.example.com/build/1',
        });
      expect(res.status).toBe(201);
      expect(res.body.context).toBe('ci/build');
      expect(res.body.state).toBe('SUCCESS');
    });

    it('should update an existing status check (upsert by context)', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/statuses`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          sha: testSha,
          context: 'ci/build',
          state: 'FAILURE',
          description: 'Build failed',
        });
      expect(res.status).toBe(201);
      expect(res.body.state).toBe('FAILURE');
    });

    it('should reject missing required fields', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/statuses`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sha: testSha });
      expect(res.status).toBe(400);
    });
  });

  // ── Get Commit Statuses ────────────────────────────────────

  describe('GET /api/repos/:repoId/commits/:sha/statuses', () => {
    beforeAll(async () => {
      // Reset the status to SUCCESS for combined status tests
      await request(app)
        .post(`/api/repos/${repoId}/statuses`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sha: testSha, context: 'ci/build', state: 'SUCCESS' });
    });

    it('should return combined status for a commit', async () => {
      const res = await request(app)
        .get(`/api/repos/${repoId}/commits/${testSha}/statuses`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('statuses');
      expect(res.body).toHaveProperty('state');
      expect(Array.isArray(res.body.statuses)).toBe(true);
    });

    it('should show state=success when all checks pass', async () => {
      // Add another passing check
      await request(app)
        .post(`/api/repos/${repoId}/statuses`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sha: testSha, context: 'ci/lint', state: 'SUCCESS' });

      const res = await request(app)
        .get(`/api/repos/${repoId}/commits/${testSha}/statuses`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('success');
    });

    it('should show state=failure when any check fails', async () => {
      await request(app)
        .post(`/api/repos/${repoId}/statuses`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sha: testSha, context: 'ci/test', state: 'FAILURE' });

      const res = await request(app)
        .get(`/api/repos/${repoId}/commits/${testSha}/statuses`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('failure');
    });

    it('should show state=pending when any check is pending and none failed', async () => {
      const pendingSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      await request(app)
        .post(`/api/repos/${repoId}/statuses`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sha: pendingSha, context: 'ci/build', state: 'SUCCESS' });
      await request(app)
        .post(`/api/repos/${repoId}/statuses`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ sha: pendingSha, context: 'ci/deploy', state: 'PENDING' });

      const res = await request(app)
        .get(`/api/repos/${repoId}/commits/${pendingSha}/statuses`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.state).toBe('pending');
    });
  });
});
