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

describe('PR Detail Hydration API', () => {
  let token: string;
  let repoId: string;
  let prNumber: number;

  beforeAll(async () => {
    const reposDir = path.join(TEST_REPOS_PATH, 'pr-hydrate');
    await fs.rm(reposDir, { recursive: true, force: true });
    await fs.mkdir(reposDir, { recursive: true });

    // Seed user + login
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    await prisma.user.upsert({
      where: { username: 'pr-hydrate-test-user' },
      update: {},
      create: {
        email: 'pr-hydrate@axiom.dev',
        username: 'pr-hydrate-test-user',
        displayName: 'PR Hydrate User',
        passwordHash,
      },
    });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'pr-hydrate-test-user', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'PR Hydrate Org', slug: 'pr-hydrate-test-org' });

    const teamRes = await request(app)
      .post(`/api/teams/org/${orgRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Hydrate Team', slug: 'pr-hydrate-test-team' });

    const repoRes = await request(app)
      .post(`/api/repos/team/${teamRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Hydrate Repo', slug: 'pr-hydrate-test-repo' });
    repoId = repoRes.body.id;

    // Seed repo: main branch with commits, then feature branch
    const repo = await prisma.repository.findUnique({ where: { id: repoId } });
    const workDir = path.join(reposDir, '_work');
    await execFileAsync('git', ['clone', repo!.diskPath!, workDir]);

    await fs.writeFile(path.join(workDir, 'README.md'), '# Hydrate Test');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C', workDir, 'commit', '-m', 'Initial commit', '--author', 'Test <t@t.com>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'main']);

    // Feature branch
    await execFileAsync('git', ['-C', workDir, 'checkout', '-b', 'feature/hydrate']);
    await fs.writeFile(path.join(workDir, 'hydrate.ts'), 'export const hydrate = true;');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C', workDir, 'commit', '-m', 'Add hydrate module', '--author', 'Test <t@t.com>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'feature/hydrate']);

    await fs.rm(workDir, { recursive: true });

    // Create a PR
    const prRes = await request(app)
      .post(`/api/repos/${repoId}/pulls`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        title: 'Add hydrate module',
        body: 'Implements hydration',
        sourceBranch: 'feature/hydrate',
        targetBranch: 'main',
      });
    prNumber = prRes.body.number;
  });

  afterAll(async () => {
    await prisma.pRComment.deleteMany({});
    await prisma.pRReview.deleteMany({});
    await prisma.pullRequest.deleteMany({});
    await prisma.repository.deleteMany({});
    await prisma.teamMembership.deleteMany({});
    await prisma.team.deleteMany({});
    await prisma.orgMembership.deleteMany({});
    await prisma.organization.deleteMany({});
    await prisma.refreshToken.deleteMany({});
    await prisma.user.deleteMany({});
    await prisma.$disconnect();
    const reposDir = path.join(TEST_REPOS_PATH, 'pr-hydrate');
    await fs.rm(reposDir, { recursive: true, force: true });
  });

  it('should return all sections (200)', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls/${prNumber}/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);

    // Primary data
    expect(res.body.pr).toBeDefined();
    expect(res.body.pr.number).toBe(prNumber);
    expect(res.body.pr.title).toBe('Add hydrate module');

    // Secondary sections should be present (may be null on partial failure)
    expect(res.body).toHaveProperty('mergeChecks');
    expect(res.body).toHaveProperty('diff');
    expect(res.body).toHaveProperty('commits');
    expect(res.body).toHaveProperty('reviews');
    expect(res.body).toHaveProperty('comments');
    expect(res.body).toHaveProperty('linkedIssues');

    // Verify merge checks shape
    if (res.body.mergeChecks) {
      expect(res.body.mergeChecks).toHaveProperty('canMerge');
    }

    // Verify diff returns stats only (not full content)
    if (res.body.diff) {
      expect(res.body.diff).toHaveProperty('stats');
      expect(res.body.diff).not.toHaveProperty('diff');
    }

    // Commits should be an array
    if (res.body.commits) {
      expect(Array.isArray(res.body.commits)).toBe(true);
      expect(res.body.commits.length).toBeGreaterThan(0);
    }
  });

  it('should return 404 for non-existent PR', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls/9999/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(404);
  });

  it('should require authentication (401)', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls/${prNumber}/hydrate`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(401);
  });
});
