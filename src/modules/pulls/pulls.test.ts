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

describe('Pull Requests API', () => {
  let token: string;
  let secondToken: string;
  let repoId: string;
  let prNumber: number;
  let commentId: string;

  beforeAll(async () => {
    await fs.rm(TEST_REPOS_PATH, { recursive: true, force: true });
    await fs.mkdir(TEST_REPOS_PATH, { recursive: true });

    // Seed user + login
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    await prisma.user.upsert({
      where: { username: 'pruser' },
      update: {},
      create: {
        email: 'prtest@axiom.dev',
        username: 'pruser',
        displayName: 'PR User',
        passwordHash,
      },
    });
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'pruser', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'PR Org', slug: 'pr-org' });

    const teamRes = await request(app)
      .post(`/api/teams/org/${orgRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Dev', slug: 'dev' });

    // Second user for ownership tests -- must be in same org for repo access
    const user2 = await prisma.user.upsert({
      where: { username: 'pruser2' },
      update: {},
      create: {
        email: 'prtest2@axiom.dev',
        username: 'pruser2',
        displayName: 'PR User 2',
        passwordHash,
      },
    });
    await prisma.orgMembership.create({
      data: { userId: user2.id, orgId: orgRes.body.id, role: 'MEMBER' },
    });
    const login2 = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'pruser2', password: 'testpassword123' });
    secondToken = login2.body.accessToken;

    const repoRes = await request(app)
      .post(`/api/repos/team/${teamRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'PR Test', slug: 'pr-test' });
    repoId = repoRes.body.id;

    // Seed repo: main branch with 2 commits, then feature branch with 1 commit
    const repo = await prisma.repository.findUnique({ where: { id: repoId } });
    const workDir = path.join(TEST_REPOS_PATH, '_pr_work');
    await execFileAsync('git', ['clone', repo!.diskPath!, workDir]);

    await fs.writeFile(path.join(workDir, 'README.md'), '# PR Test');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      workDir,
      'commit',
      '-m',
      'Initial commit',
      '--author',
      'Test <t@t.com>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'main']);

    await fs.writeFile(path.join(workDir, 'app.ts'), 'const app = "hello";');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      workDir,
      'commit',
      '-m',
      'Add app',
      '--author',
      'Test <t@t.com>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'main']);

    // Feature branch
    await execFileAsync('git', ['-C', workDir, 'checkout', '-b', 'feature/login']);
    await fs.writeFile(path.join(workDir, 'login.ts'), 'export function login() { return true; }');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      workDir,
      'commit',
      '-m',
      'Add login',
      '--author',
      'Test <t@t.com>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'feature/login']);

    // Another branch for merge test
    await execFileAsync('git', ['-C', workDir, 'checkout', 'main']);
    await execFileAsync('git', ['-C', workDir, 'checkout', '-b', 'feature/signup']);
    await fs.writeFile(path.join(workDir, 'signup.ts'), 'export function signup() {}');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      workDir,
      'commit',
      '-m',
      'Add signup',
      '--author',
      'Test <t@t.com>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'feature/signup']);

    await fs.rm(workDir, { recursive: true });
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
    await fs.rm(TEST_REPOS_PATH, { recursive: true, force: true });
  });

  // ─── PR CRUD ──────────────────────────────────────────────

  it('1. should create a pull request', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pulls`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        title: 'Add login feature',
        body: 'Implements login',
        sourceBranch: 'feature/login',
        targetBranch: 'main',
      });
    expect(res.status).toBe(201);
    expect(res.body.number).toBe(1);
    expect(res.body.title).toBe('Add login feature');
    expect(res.body.status).toBe('OPEN');
    prNumber = res.body.number;
  });

  it('2. should reject PR with same source and target', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pulls`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Bad PR', sourceBranch: 'main', targetBranch: 'main' });
    expect(res.status).toBe(400);
  });

  it('3. should reject PR with nonexistent branch', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pulls`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Bad PR', sourceBranch: 'nonexistent', targetBranch: 'main' });
    expect(res.status).toBe(400);
  });

  it('4. should list PRs', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].number).toBe(1);
  });

  it('5. should filter PRs by status', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls?status=MERGED`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('6. should get PR detail with merge status', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls/${prNumber}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Add login feature');
    expect(res.body.mergeable).toBe(true);
  });

  it('7. should update PR title/body', async () => {
    const res = await request(app)
      .patch(`/api/repos/${repoId}/pulls/${prNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Add login feature (updated)' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Add login feature (updated)');
  });

  // ─── PR Diff & Commits ───────────────────────────────────

  it('8. should get PR diff', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls/${prNumber}/diff`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.diff).toContain('login.ts');
    expect(res.body.stats.length).toBeGreaterThan(0);
    expect(res.body.stats[0].file).toContain('login.ts');
  });

  it('9. should get PR commits', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls/${prNumber}/commits`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].message).toBe('Add login');
  });

  // ─── Reviews ──────────────────────────────────────────────

  it('10. should submit a review', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pulls/${prNumber}/reviews`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ status: 'APPROVED', body: 'LGTM!' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('APPROVED');
  });

  it('11. should list reviews', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls/${prNumber}/reviews`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].status).toBe('APPROVED');
  });

  // ─── PR Comments ──────────────────────────────────────────

  it('12. should add a general comment', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pulls/${prNumber}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Looks good overall' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Looks good overall');
    expect(res.body.filePath).toBeNull();
    commentId = res.body.id;
  });

  it('13. should add an inline comment', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pulls/${prNumber}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Should validate input here', filePath: 'login.ts', line: 1 });
    expect(res.status).toBe(201);
    expect(res.body.filePath).toBe('login.ts');
    expect(res.body.line).toBe(1);
  });

  it('14. should list PR comments', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls/${prNumber}/comments`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  // ─── Comment Update / Delete ────────────────────────────────

  it('14a. should update a PR comment body', async () => {
    const res = await request(app)
      .patch(`/api/repos/${repoId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Updated PR comment' });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Updated PR comment');
  });

  it('14b. should reject PR comment update from non-author', async () => {
    const res = await request(app)
      .patch(`/api/repos/${repoId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${secondToken}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Unauthorized edit' });
    expect(res.status).toBe(403);
  });

  it('14c. should reject PR comment delete from non-author', async () => {
    const res = await request(app)
      .delete(`/api/repos/${repoId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${secondToken}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(403);
  });

  it('14d. should delete own PR comment', async () => {
    const res = await request(app)
      .delete(`/api/repos/${repoId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);
  });

  // ─── Merge ────────────────────────────────────────────────

  it('15. should merge PR (default merge commit)', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pulls/${prNumber}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('MERGED');
  });

  it('16. should reject merge on already merged PR', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pulls/${prNumber}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({});
    expect(res.status).toBe(400);
  });

  it('17. should reject edit on merged PR', async () => {
    const res = await request(app)
      .patch(`/api/repos/${repoId}/pulls/${prNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Should fail' });
    expect(res.status).toBe(400);
  });

  // ─── Close ────────────────────────────────────────────────

  it('18. should create and close a PR', async () => {
    // Create PR #2
    const createRes = await request(app)
      .post(`/api/repos/${repoId}/pulls`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Add signup', sourceBranch: 'feature/signup', targetBranch: 'main' });
    expect(createRes.status).toBe(201);

    const closeRes = await request(app)
      .post(`/api/repos/${repoId}/pulls/${createRes.body.number}/close`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.status).toBe('CLOSED');
  });

  // ─── Filter after operations ──────────────────────────────

  it('19. should filter open PRs (none left)', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls?status=OPEN`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('20. should list all PRs', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pulls`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });
});
