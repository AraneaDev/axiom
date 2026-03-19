import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Projects API', () => {
  let token: string;
  let teamId: string;
  let projectId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'projects-test-user' },
      update: {},
      create: {
        email: 'projects-test@axiom.dev',
        username: 'projects-test-user',
        displayName: 'Projects Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Projects Test Org',
        slug: 'projects-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Projects Test Team',
        slug: 'projects-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: 'projects-test@axiom.dev',
        password: 'testpassword123',
      });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'projects-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'projects-test-user' } });
    await prisma.$disconnect();
  });

  // 1. Create project and verify 5 default columns
  it('1. should create a project and auto-create 5 default columns', async () => {
    const res = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Projects Test Project', slug: 'projects-test-project', prefix: 'PTP' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.slug).toBe('projects-test-project');
    projectId = res.body.id;

    // Verify via board endpoint that 5 default columns were created
    const boardRes = await request(app)
      .get(`/api/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    expect(boardRes.status).toBe(200);
    const columns = boardRes.body.columns ?? boardRes.body;
    expect(columns.length).toBe(5);
  });

  // 2. List projects by team
  it('2. should list projects for a team', async () => {
    const res = await request(app)
      .get(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find((p: { id: string }) => p.id === projectId);
    expect(found).toBeDefined();
  });

  // 3. Get project
  it('3. should get a project by id', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.slug).toBe('projects-test-project');
    expect(res.body.teamId).toBe(teamId);
  });

  // 4. Update project
  it('4. should update a project', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Projects Test Project Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Projects Test Project Updated');
  });

  // 5. Get board columns
  it('5. should get board columns for a project', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const columns = res.body.columns ?? res.body;
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
    // Each column should have an id and name
    columns.forEach((col: { id: string; name: string }) => {
      expect(col.id).toBeDefined();
      expect(col.name).toBeDefined();
    });
  });
});
