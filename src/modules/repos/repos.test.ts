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

describe('Repos API', () => {
  let token: string;
  let orgId: string;
  let _orgSlug: string;
  let teamId: string;
  let _teamSlug: string;
  let repoId: string;

  beforeAll(async () => {
    // Clean test repos dir
    await fs.rm(TEST_REPOS_PATH, { recursive: true, force: true });
    await fs.mkdir(TEST_REPOS_PATH, { recursive: true });

    // Seed user via Prisma (register endpoint requires invite when users exist)
    const passwordHash = await bcrypt.hash('testpassword123', 4);
    await prisma.user.upsert({
      where: { username: 'repouser' },
      update: {},
      create: {
        email: 'repotest@axiom.dev',
        username: 'repouser',
        displayName: 'Repo User',
        passwordHash,
      },
    });

    // Login to get token
    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: 'repouser',
        password: 'testpassword123',
      });
    token = loginRes.body.accessToken;

    // Create org
    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Repo Org', slug: 'repo-org' });
    orgId = orgRes.body.id;
    _orgSlug = orgRes.body.slug;

    // Create team
    const teamRes = await request(app)
      .post(`/api/teams/org/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Dev', slug: 'dev' });
    teamId = teamRes.body.id;
    _teamSlug = teamRes.body.slug;
  });

  afterAll(async () => {
    // Cleanup
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

  it('1. should create a repository', async () => {
    const res = await request(app)
      .post(`/api/repos/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'My App', slug: 'my-app', description: 'Test repo' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('my-app');
    expect(res.body.defaultBranch).toBe('main');
    expect(res.body.diskPath).toContain('my-app.git');
    repoId = res.body.id;
  });

  it('2. should list repos for team', async () => {
    const res = await request(app)
      .get(`/api/repos/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].slug).toBe('my-app');
  });

  it('3. should get repo detail', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('My App');
    expect(res.body.size).toBeGreaterThan(0);
  });

  it('4. should update repo', async () => {
    const res = await request(app)
      .patch(`/api/repos/${repoId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ description: 'Updated description' });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated description');
  });

  it('5. should reject duplicate slug', async () => {
    const res = await request(app)
      .post(`/api/repos/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'My App', slug: 'my-app' });
    expect(res.status).toBe(409);
  });

  // ─── Git operations require commits ───────────────────────
  // Push a commit to the bare repo so we can test git APIs

  it('6. should seed repo with commits for testing', async () => {
    const repo = await prisma.repository.findUnique({ where: { id: repoId } });
    const workDir = path.join(TEST_REPOS_PATH, '_work');
    await execFileAsync('git', ['clone', repo!.diskPath!, workDir]);
    await fs.writeFile(path.join(workDir, 'README.md'), '# My App\nHello');
    await fs.mkdir(path.join(workDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(workDir, 'src', 'index.ts'), 'console.log("app");');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      workDir,
      'commit',
      '-m',
      'Initial commit',
      '--author',
      'Test <test@axiom.dev>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'main']);

    // Second commit
    await fs.writeFile(path.join(workDir, 'src', 'utils.ts'), 'export const x = 1;');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      workDir,
      'commit',
      '-m',
      'Add utils',
      '--author',
      'Test <test@axiom.dev>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'main']);

    // Feature branch
    await execFileAsync('git', ['-C', workDir, 'checkout', '-b', 'feat']);
    await fs.writeFile(path.join(workDir, 'src', 'feat.ts'), 'export function feat() {}');
    await execFileAsync('git', ['-C', workDir, 'add', '.']);
    await execFileAsync('git', [
      '-C',
      workDir,
      'commit',
      '-m',
      'Add feature',
      '--author',
      'Test <test@axiom.dev>',
    ]);
    await execFileAsync('git', ['-C', workDir, 'push', 'origin', 'feat']);

    await fs.rm(workDir, { recursive: true });
    expect(true).toBe(true); // seed step
  });

  it('7. should list branches', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/branches`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body.find((b: Record<string, unknown>) => b.name === 'main')).toBeDefined();
    expect(res.body.find((b: Record<string, unknown>) => b.name === 'feat')).toBeDefined();
    expect(res.body.find((b: Record<string, unknown>) => b.name === 'main').isDefault).toBe(true);
  });

  it('8. should get branch detail', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/branches/main`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('main');
    expect(res.body.commitCount).toBe(2);
    expect(res.body.latestCommit.message).toBe('Add utils');
  });

  it('9. should create and delete branch', async () => {
    // Get main SHA
    const branchRes = await request(app)
      .get(`/api/repos/${repoId}/branches/main`)
      .set('Authorization', `Bearer ${token}`);
    const sha = branchRes.body.latestCommit.sha;

    const createRes = await request(app)
      .post(`/api/repos/${repoId}/branches`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'test-branch', startPoint: sha });
    expect(createRes.status).toBe(201);

    const delRes = await request(app)
      .delete(`/api/repos/${repoId}/branches/test-branch`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(delRes.status).toBe(204);
  });

  it('10. should list commits', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/commits?ref=main`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
    expect(res.body[0].message).toBe('Add utils');
  });

  it('11. should get commit detail with diff', async () => {
    const commitsRes = await request(app)
      .get(`/api/repos/${repoId}/commits?ref=main&limit=1`)
      .set('Authorization', `Bearer ${token}`);
    const sha = commitsRes.body[0].sha;

    const res = await request(app)
      .get(`/api/repos/${repoId}/commits/${sha}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sha).toBe(sha);
    expect(res.body.diff).toBeDefined();
  });

  it('12. should browse file tree', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/tree/main/`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const names = res.body.map((e: Record<string, unknown>) => e.name);
    expect(names).toContain('README.md');
    expect(names).toContain('src');
  });

  it('13. should read file content', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/blob/main/README.md`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.content).toContain('# My App');
    expect(res.body.size).toBeGreaterThan(0);
  });

  it('14. should get blame', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/blame/main/README.md`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].author).toBe('Test');
  });

  it('15. should list tags (empty)', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/tags`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('16. should fork repo', async () => {
    // Create a second team to fork into
    const team2Res = await request(app)
      .post(`/api/teams/org/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'QA', slug: 'qa' });

    const res = await request(app)
      .post(`/api/repos/${repoId}/fork`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ targetTeamId: team2Res.body.id, slug: 'my-app-fork' });
    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('my-app-fork');
    expect(res.body.description).toContain('Forked from');

    // Verify fork has branches
    const branchRes = await request(app)
      .get(`/api/repos/${res.body.id}/branches`)
      .set('Authorization', `Bearer ${token}`);
    expect(branchRes.body.length).toBeGreaterThanOrEqual(2);
  });

  it('17. should delete repo', async () => {
    // Create a disposable repo
    const createRes = await request(app)
      .post(`/api/repos/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'To Delete', slug: 'to-delete' });

    const res = await request(app)
      .delete(`/api/repos/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);

    // Should be gone
    const getRes = await request(app)
      .get(`/api/repos/${createRes.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(404);
  });
});
