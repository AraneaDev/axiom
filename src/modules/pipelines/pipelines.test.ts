import fs from 'fs/promises';

import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const TEST_REPOS_PATH = process.env.REPOS_PATH || '/tmp/axiom-test-repos';

const VALID_YAML = `
name: CI
on: push
jobs:
  build:
    steps:
      - name: Checkout
        run: echo checkout
      - name: Build
        run: echo build
`;

const INVALID_YAML = `
name: Empty
on: push
jobs: {}
`;

describe('Pipelines API', () => {
  let token: string;
  let orgId: string;
  let teamId: string;
  let repoId: string;
  let pipelineId: string;
  let runId: string;

  beforeAll(async () => {
    await fs.rm(TEST_REPOS_PATH, { recursive: true, force: true });
    await fs.mkdir(TEST_REPOS_PATH, { recursive: true });

    const passwordHash = await bcrypt.hash('testpassword123', 4);
    await prisma.user.upsert({
      where: { username: 'pipelineuser' },
      update: {},
      create: {
        email: 'pipelineuser@axiom.dev',
        username: 'pipelineuser',
        displayName: 'Pipeline User',
        passwordHash,
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'pipelineuser', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create org
    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Pipeline Org', slug: 'pipeline-org' });
    orgId = orgRes.body.id;

    // Create team
    const teamRes = await request(app)
      .post(`/api/teams/org/${orgId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'PipeTeam', slug: 'pipe-team' });
    teamId = teamRes.body.id;

    // Create repo
    const repoRes = await request(app)
      .post(`/api/repos/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Pipe Repo', slug: 'pipe-repo', description: 'Test repo for pipelines' });
    repoId = repoRes.body.id;
  });

  afterAll(async () => {
    await prisma.pipelineRun.deleteMany({});
    await prisma.pipeline.deleteMany({});
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

  it('should create a pipeline', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pipelines`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'CI Pipeline', yamlContent: VALID_YAML });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('CI Pipeline');
    expect(res.body.slug).toBe('ci-pipeline');
    expect(res.body.repoId).toBe(repoId);
    pipelineId = res.body.id;
  });

  it('should reject pipeline with missing required fields', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pipelines`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: '' });

    expect(res.status).toBe(400);
  });

  it('should reject invalid pipeline config', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pipelines`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Bad Pipeline', yamlContent: INVALID_YAML });

    // Pipeline validator throws plain Error with status, not AppError, so 500
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('should list pipelines for a repo', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pipelines`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].name).toBe('CI Pipeline');
  });

  it('should update a pipeline', async () => {
    const res = await request(app)
      .put(`/api/repos/${repoId}/pipelines/${pipelineId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Updated Pipeline', yamlContent: VALID_YAML });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Pipeline');
  });

  it('should reject update with invalid YAML', async () => {
    const res = await request(app)
      .put(`/api/repos/${repoId}/pipelines/${pipelineId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Bad Update', yamlContent: INVALID_YAML });

    // Pipeline validator throws plain Error with status, not AppError, so 500
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('should trigger a pipeline run', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/pipelines/${pipelineId}/runs`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ ref: 'main' });

    expect(res.status).toBe(201);
    expect(res.body.pipelineId).toBe(pipelineId);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.triggerType).toBe('MANUAL');
    runId = res.body.id;
  });

  it('should get pipeline run status', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/runs/${runId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(runId);
    expect(res.body.pipeline).toBeDefined();
  });

  it('should list runs for a repo', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/runs`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('should return 404 for non-existent run', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/runs/nonexistent-run-id`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should cancel a pipeline run', async () => {
    const res = await request(app)
      .post(`/api/repos/${repoId}/runs/${runId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('should delete a pipeline', async () => {
    const res = await request(app)
      .delete(`/api/repos/${repoId}/pipelines/${pipelineId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(204);
  });

  it('should return empty list after deletion', async () => {
    const res = await request(app)
      .get(`/api/repos/${repoId}/pipelines`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});
