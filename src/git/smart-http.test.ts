import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { promisify } from 'util';

import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../config/database';
import app from '../index';

import { HOOK_SECRET } from './hook-handler';

const execFileAsync = promisify(execFile);
const TEST_REPOS_PATH = process.env.REPOS_PATH || '/tmp/axiom-test-repos';

describe('Smart HTTP & Hooks', () => {
  let token: string; // raw API token (tk_...)
  let jwtToken: string; // JWT for Bearer auth
  let orgSlug: string;
  let teamSlug: string;
  let repoSlug: string;
  let repoId: string;

  beforeAll(async () => {
    await fs.rm(TEST_REPOS_PATH, { recursive: true, force: true });
    await fs.mkdir(TEST_REPOS_PATH, { recursive: true });

    // Seed user + login
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    await prisma.user.upsert({
      where: { username: 'githttpuser' },
      update: {},
      create: {
        email: 'githttp@axiom.dev',
        username: 'githttpuser',
        displayName: 'Git HTTP User',
        passwordHash,
      },
    });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'githttpuser', password: 'testpassword123' });
    const jwt = loginRes.body.accessToken;
    jwtToken = jwt;

    // Create org
    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Git Org', slug: 'git-org' });
    orgSlug = orgRes.body.slug;

    // Create team
    const teamRes = await request(app)
      .post(`/api/teams/org/${orgRes.body.id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Core', slug: 'core' });
    teamSlug = teamRes.body.slug;

    // Create repo
    const repoRes = await request(app)
      .post(`/api/repos/team/${teamRes.body.id}`)
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'HTTP Test', slug: 'http-test' });
    repoSlug = repoRes.body.slug;
    repoId = repoRes.body.id;

    // Create API token for git auth
    const tokenRes = await request(app)
      .post('/api/users/me/tokens')
      .set('Authorization', `Bearer ${jwt}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Git Token', scopes: ['repo:read', 'repo:write'] });
    token = tokenRes.body.token;

    // Seed the repo with a commit
    const repo = await prisma.repository.findUnique({ where: { id: repoId } });
    const workDir = path.join(TEST_REPOS_PATH, '_http_work');
    await execFileAsync('git', ['clone', repo!.diskPath!, workDir]);
    await fs.writeFile(path.join(workDir, 'README.md'), '# HTTP Test');
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
    await fs.rm(workDir, { recursive: true });
  });

  afterAll(async () => {
    await prisma.apiToken.deleteMany({});
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

  // ─── Smart HTTP Protocol ──────────────────────────────────

  describe('info/refs discovery', () => {
    it('should return refs for git-upload-pack', async () => {
      const basicAuth = Buffer.from(`x:${token}`).toString('base64');
      const res = await request(app)
        .get(`/git/${orgSlug}/${teamSlug}/${repoSlug}.git/info/refs?service=git-upload-pack`)
        .set('Authorization', `Basic ${basicAuth}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/x-git-upload-pack-advertisement');
    });

    it('should return refs for git-receive-pack', async () => {
      const basicAuth = Buffer.from(`x:${token}`).toString('base64');
      const res = await request(app)
        .get(`/git/${orgSlug}/${teamSlug}/${repoSlug}.git/info/refs?service=git-receive-pack`)
        .set('Authorization', `Basic ${basicAuth}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/x-git-receive-pack-advertisement');
    });

    it('should reject without auth', async () => {
      const res = await request(app).get(
        `/git/${orgSlug}/${teamSlug}/${repoSlug}.git/info/refs?service=git-upload-pack`,
      );
      expect(res.status).toBe(401);
    });

    it('should reject with bad token', async () => {
      const basicAuth = Buffer.from('x:tk_invalidtoken').toString('base64');
      const res = await request(app)
        .get(`/git/${orgSlug}/${teamSlug}/${repoSlug}.git/info/refs?service=git-upload-pack`)
        .set('Authorization', `Basic ${basicAuth}`);
      expect(res.status).toBe(401);
    });

    it('should reject invalid service', async () => {
      const basicAuth = Buffer.from(`x:${token}`).toString('base64');
      const res = await request(app)
        .get(`/git/${orgSlug}/${teamSlug}/${repoSlug}.git/info/refs?service=invalid`)
        .set('Authorization', `Basic ${basicAuth}`);
      expect(res.status).toBe(400);
    });

    it('should 404 for nonexistent repo', async () => {
      const basicAuth = Buffer.from(`x:${token}`).toString('base64');
      const res = await request(app)
        .get(`/git/${orgSlug}/${teamSlug}/nonexistent.git/info/refs?service=git-upload-pack`)
        .set('Authorization', `Basic ${basicAuth}`);
      expect(res.status).toBe(404);
    });
  });

  // ─── Hook Handler ─────────────────────────────────────────

  describe('post-receive hook', () => {
    it('should accept valid hook payload', async () => {
      const res = await request(app)
        .post('/api/internal/hooks/post-receive')
        .set('Authorization', `Bearer ${jwtToken}`)
        .set('X-Hook-Secret', HOOK_SECRET)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          repo: repoId,
          ref: 'refs/heads/main',
          before: '0000000000000000000000000000000000000000',
          after: 'abc123abc123abc123abc123abc123abc123abc1',
        });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.event).toBe('branch:created');
    });

    it('should detect push event', async () => {
      const res = await request(app)
        .post('/api/internal/hooks/post-receive')
        .set('Authorization', `Bearer ${jwtToken}`)
        .set('X-Hook-Secret', HOOK_SECRET)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          repo: repoId,
          ref: 'refs/heads/main',
          before: 'abc123abc123abc123abc123abc123abc123abc1',
          after: 'def456def456def456def456def456def456def4',
        });
      expect(res.status).toBe(200);
      expect(res.body.event).toBe('push');
    });

    it('should detect branch delete event', async () => {
      const res = await request(app)
        .post('/api/internal/hooks/post-receive')
        .set('Authorization', `Bearer ${jwtToken}`)
        .set('X-Hook-Secret', HOOK_SECRET)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          repo: repoId,
          ref: 'refs/heads/feature',
          before: 'abc123abc123abc123abc123abc123abc123abc1',
          after: '0000000000000000000000000000000000000000',
        });
      expect(res.status).toBe(200);
      expect(res.body.event).toBe('branch:deleted');
    });

    it('should detect tag events', async () => {
      const res = await request(app)
        .post('/api/internal/hooks/post-receive')
        .set('Authorization', `Bearer ${jwtToken}`)
        .set('X-Hook-Secret', HOOK_SECRET)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          repo: repoId,
          ref: 'refs/tags/v1.0.0',
          before: '0000000000000000000000000000000000000000',
          after: 'abc123abc123abc123abc123abc123abc123abc1',
        });
      expect(res.status).toBe(200);
      expect(res.body.event).toBe('tag:created');
    });

    it('should reject invalid hook secret', async () => {
      const res = await request(app)
        .post('/api/internal/hooks/post-receive')
        .set('Authorization', `Bearer ${jwtToken}`)
        .set('X-Hook-Secret', 'wrong-secret')
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ repo: repoId, ref: 'refs/heads/main', before: 'a', after: 'b' });
      expect(res.status).toBe(403);
    });

    it('should reject missing payload', async () => {
      const res = await request(app)
        .post('/api/internal/hooks/post-receive')
        .set('Authorization', `Bearer ${jwtToken}`)
        .set('X-Hook-Secret', HOOK_SECRET)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({});
      expect(res.status).toBe(400);
    });

    it('should 404 for unknown repo', async () => {
      const res = await request(app)
        .post('/api/internal/hooks/post-receive')
        .set('Authorization', `Bearer ${jwtToken}`)
        .set('X-Hook-Secret', HOOK_SECRET)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ repo: 'nonexistent', ref: 'refs/heads/main', before: 'a', after: 'b' });
      expect(res.status).toBe(404);
    });
  });
});
