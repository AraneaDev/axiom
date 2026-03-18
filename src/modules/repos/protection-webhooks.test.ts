import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const execFileAsync = promisify(execFile);
const TEST_REPOS_PATH = process.env.REPOS_PATH || '/tmp/axiom-test-repos';

describe('Branch Protection & Webhooks', () => {
  let token: string;
  let repoId: string;
  let ruleId: string;
  let webhookId: string;

  beforeAll(async () => {
    await fs.rm(TEST_REPOS_PATH, { recursive: true, force: true });
    await fs.mkdir(TEST_REPOS_PATH, { recursive: true });

    const passwordHash = await bcrypt.hash('testpassword123', 4);
    await prisma.user.upsert({
      where: { username: 'protuser' },
      update: {},
      create: {
        email: 'prottest@axiom.dev',
        username: 'protuser',
        displayName: 'Prot User',
        passwordHash,
      },
    });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ login: 'protuser', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Prot Org', slug: 'prot-org' });

    const teamRes = await request(app)
      .post(`/api/teams/org/${orgRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dev', slug: 'dev' });

    const repoRes = await request(app)
      .post(`/api/repos/team/${teamRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Protected', slug: 'protected' });
    repoId = repoRes.body.id;

    // Seed with commits and branches
    const repo = await prisma.repository.findUnique({ where: { id: repoId } });
    const workDir = path.join(TEST_REPOS_PATH, '_prot_work');
    await execFileAsync('git', ['clone', repo!.diskPath!, workDir]);
    await fs.writeFile(path.join(workDir, 'README.md'), '# Protected');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      workDir,
      'commit',
      '-m',
      'init',
      '--author',
      'Test <t@t.com>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'main']);
    await execFileAsync('git', ['-C', workDir, 'checkout', '-b', 'feature/x']);
    await fs.writeFile(path.join(workDir, 'x.ts'), 'export const x = 1;');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      workDir,
      'commit',
      '-m',
      'Add x',
      '--author',
      'Test <t@t.com>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'feature/x']);
    await fs.rm(workDir, { recursive: true });
  });

  afterAll(async () => {
    await prisma.pRComment.deleteMany({});
    await prisma.pRReview.deleteMany({});
    await prisma.pullRequest.deleteMany({});
    await prisma.branchProtection.deleteMany({});
    await prisma.webhook.deleteMany({});
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

  // ─── Branch Protection CRUD ───────────────────────────────

  describe('Branch Protection', () => {
    it('should create a protection rule', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/branch-protection`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pattern: 'main', requiredReviews: 2, noForcePush: true, noDirectPush: true });
      expect(res.status).toBe(201);
      expect(res.body.pattern).toBe('main');
      expect(res.body.requiredReviews).toBe(2);
      expect(res.body.noDirectPush).toBe(true);
      ruleId = res.body.id;
    });

    it('should reject duplicate pattern', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/branch-protection`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pattern: 'main' });
      expect(res.status).toBe(409);
    });

    it('should create wildcard rule', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/branch-protection`)
        .set('Authorization', `Bearer ${token}`)
        .send({ pattern: 'release/*', requiredReviews: 1 });
      expect(res.status).toBe(201);
      expect(res.body.pattern).toBe('release/*');
    });

    it('should list rules', async () => {
      const res = await request(app)
        .get(`/api/repos/${repoId}/branch-protection`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(2);
    });

    it('should get a rule', async () => {
      const res = await request(app)
        .get(`/api/repos/${repoId}/branch-protection/${ruleId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.pattern).toBe('main');
    });

    it('should update a rule', async () => {
      const res = await request(app)
        .patch(`/api/repos/${repoId}/branch-protection/${ruleId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ requiredReviews: 1 });
      expect(res.status).toBe(200);
      expect(res.body.requiredReviews).toBe(1);
    });

    it('should enforce protection on merge (block without reviews)', async () => {
      // Create a PR
      const prRes = await request(app)
        .post(`/api/repos/${repoId}/pulls`)
        .set('Authorization', `Bearer ${token}`)
        .send({ title: 'Feature X', sourceBranch: 'feature/x', targetBranch: 'main' });
      expect(prRes.status).toBe(201);

      // Try to merge without reviews — should be blocked
      const mergeRes = await request(app)
        .post(`/api/repos/${repoId}/pulls/${prRes.body.number}/merge`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(mergeRes.status).toBe(403);
      expect(mergeRes.body.error.message).toContain('approved review');
    });

    it('should allow merge after required reviews', async () => {
      // Submit an approved review
      await request(app)
        .post(`/api/repos/${repoId}/pulls/1/reviews`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'APPROVED', body: 'LGTM' });

      // Now merge should work
      const mergeRes = await request(app)
        .post(`/api/repos/${repoId}/pulls/1/merge`)
        .set('Authorization', `Bearer ${token}`)
        .send({});
      expect(mergeRes.status).toBe(200);
      expect(mergeRes.body.status).toBe('MERGED');
    });

    it('should delete a rule', async () => {
      // Delete the release/* rule
      const listRes = await request(app)
        .get(`/api/repos/${repoId}/branch-protection`)
        .set('Authorization', `Bearer ${token}`);
      const releaseRule = listRes.body.find((r: any) => r.pattern === 'release/*');

      const res = await request(app)
        .delete(`/api/repos/${repoId}/branch-protection/${releaseRule.id}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);

      const listRes2 = await request(app)
        .get(`/api/repos/${repoId}/branch-protection`)
        .set('Authorization', `Bearer ${token}`);
      expect(listRes2.body.length).toBe(1);
    });
  });

  // ─── Webhooks CRUD ────────────────────────────────────────

  describe('Webhooks', () => {
    it('should create a webhook', async () => {
      const res = await request(app)
        .post(`/api/repos/${repoId}/webhooks`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          url: 'https://example.com/hook',
          secret: 'my-secret',
          events: ['push', 'pr:created'],
        });
      expect(res.status).toBe(201);
      expect(res.body.url).toBe('https://example.com/hook');
      expect(res.body.events).toEqual(['push', 'pr:created']);
      expect(res.body.active).toBe(true);
      webhookId = res.body.id;
    });

    it('should list webhooks (without secrets)', async () => {
      const res = await request(app)
        .get(`/api/repos/${repoId}/webhooks`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
      // Secret should not be exposed in list
      expect(res.body[0].secret).toBeUndefined();
    });

    it('should get webhook detail', async () => {
      const res = await request(app)
        .get(`/api/repos/${repoId}/webhooks/${webhookId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.url).toBe('https://example.com/hook');
    });

    it('should update webhook', async () => {
      const res = await request(app)
        .patch(`/api/repos/${repoId}/webhooks/${webhookId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ events: ['push', 'pr:created', 'pr:merged'], active: false });
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(3);
      expect(res.body.active).toBe(false);
    });

    it('should delete webhook', async () => {
      const res = await request(app)
        .delete(`/api/repos/${repoId}/webhooks/${webhookId}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(204);

      const listRes = await request(app)
        .get(`/api/repos/${repoId}/webhooks`)
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.body.length).toBe(0);
    });
  });
});
