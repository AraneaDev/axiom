import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('Runners API', () => {
  let token: string;
  let orgId: string;
  let teamId: string;
  let repoId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    await prisma.user.upsert({
      where: { username: 'runners-test-user' },
      update: {},
      create: {
        email: 'runners-test@axiom.dev',
        username: 'runners-test-user',
        displayName: 'Runners Test User',
        passwordHash,
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'runners-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create org via API
    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Runners Test Org', slug: 'runners-test-org' });
    orgId = orgRes.body.id;

    // Create team for repo
    const teamRes = await request(app)
      .post(`/api/orgs/${orgId}/teams`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Runners Test Team', slug: 'runners-test-team' });
    teamId = teamRes.body.id;

    // Create repo for tasks
    const repo = await prisma.repository.create({
      data: {
        name: 'runners-test-repo',
        slug: 'runners-test-repo',
        teamId,
      },
    });
    repoId = repo.id;
  });

  afterAll(async () => {
    await prisma.runnerTaskLog.deleteMany({
      where: { task: { repoId } },
    });
    await prisma.runnerTask.deleteMany({ where: { repoId } });
    await prisma.runner.deleteMany({ where: { scopeType: 'ORG', scopeId: orgId } });
    await prisma.runnerRegistrationToken.deleteMany({
      where: { scopeType: 'ORG', scopeId: orgId },
    });
    await prisma.repository.deleteMany({ where: { id: repoId } });
    await prisma.organization.deleteMany({ where: { slug: 'runners-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'runners-test-user' } });
    await prisma.$disconnect();
  });

  it('1. should create a registration token', async () => {
    const res = await request(app)
      .post(`/api/orgs/${orgId}/runners/registration-token`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(typeof res.body.token).toBe('string');
    expect(res.body.token.length).toBe(64); // 32 bytes hex
    expect(res.body.id).toBeDefined();
    expect(res.body.expiresAt).toBeDefined();
  });

  it('2. should list runners (empty initially)', async () => {
    const res = await request(app)
      .get(`/api/orgs/${orgId}/runners`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(0);
  });

  it('3. should get task details', async () => {
    const runner = await prisma.runner.create({
      data: {
        name: 'task-test-runner',
        scopeType: 'ORG',
        scopeId: orgId,
        labels: ['self-hosted'],
        status: 'ONLINE',
      },
    });

    const task = await prisma.runnerTask.create({
      data: {
        runnerId: runner.id,
        status: 'RUNNING',
        workflowSource: 'repo_file',
        workflowRef: '.axiom/workflows/test.yml',
        workflowContent: 'name: test',
        repoId,
      },
    });

    const res = await request(app)
      .get(`/api/runner-tasks/${task.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(task.id);
    expect(res.body.runner.name).toBe('task-test-runner');

    // Cleanup
    await prisma.runnerTask.delete({ where: { id: task.id } });
    await prisma.runner.delete({ where: { id: runner.id } });
  });

  it('4. should return 404 for nonexistent task', async () => {
    const res = await request(app)
      .get('/api/runner-tasks/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('5. should return SSE content-type for task logs', async () => {
    const runner = await prisma.runner.create({
      data: {
        name: 'sse-test-runner',
        scopeType: 'ORG',
        scopeId: orgId,
        labels: ['self-hosted'],
        status: 'ONLINE',
      },
    });

    const task = await prisma.runnerTask.create({
      data: {
        runnerId: runner.id,
        status: 'SUCCESS',
        workflowSource: 'repo_file',
        workflowRef: '.axiom/workflows/test.yml',
        workflowContent: 'name: test',
        repoId,
      },
    });

    const res = await request(app)
      .get(`/api/runner-tasks/${task.id}/logs`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true);
    expect(res.headers['content-type']).toContain('text/event-stream');

    // Cleanup
    await prisma.runnerTask.delete({ where: { id: task.id } });
    await prisma.runner.delete({ where: { id: runner.id } });
  });

  it('6. should delete a runner via API', async () => {
    // Create a runner directly via Prisma
    const runner = await prisma.runner.create({
      data: {
        name: 'test-runner',
        scopeType: 'ORG',
        scopeId: orgId,
        labels: ['self-hosted', 'linux'],
        status: 'OFFLINE',
      },
    });

    // Verify it appears in the list
    const listRes = await request(app)
      .get(`/api/orgs/${orgId}/runners`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(1);
    expect(listRes.body[0].name).toBe('test-runner');

    // Delete via API
    const delRes = await request(app)
      .delete(`/api/orgs/${orgId}/runners/${runner.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(delRes.status).toBe(204);

    // Verify it was deleted
    const listRes2 = await request(app)
      .get(`/api/orgs/${orgId}/runners`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes2.body.length).toBe(0);
  });
});
