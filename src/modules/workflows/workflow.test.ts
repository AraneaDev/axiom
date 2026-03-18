import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('Workflows API', () => {
  let token: string;
  let projectId: string;
  let columnAId: string;
  let columnBId: string;
  let columnCId: string;
  let ruleId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    await prisma.user.upsert({
      where: { username: 'workflow-test-user' },
      update: {},
      create: {
        email: 'workflow-test@axiom.dev',
        username: 'workflow-test-user',
        displayName: 'Workflow Test User',
        passwordHash,
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'workflow-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create org via API
    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Workflow Test Org', slug: 'workflow-test-org' });

    // Create team via API
    const teamRes = await request(app)
      .post(`/api/teams/org/${orgRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Workflow Test Team', slug: 'workflow-test-team' });

    // Create project via API so default columns are created
    const projectRes = await request(app)
      .post(`/api/projects/team/${teamRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Workflow Test Project', slug: 'workflow-test-project', prefix: 'WFL' });
    projectId = projectRes.body.id;

    // Fetch columns
    const boardRes = await request(app)
      .get(`/api/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    const columns = boardRes.body.columns ?? boardRes.body;
    columnAId = columns[0].id;
    columnBId = columns[1].id;
    columnCId = columns.length > 2 ? columns[2].id : columns[1].id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'workflow-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'workflow-test-user' } });
    await prisma.$disconnect();
  });

  // ---- CRUD ----

  it('1. should create a workflow rule', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/workflow-rules`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ fromColumnId: columnAId, toColumnId: columnBId });
    expect(res.status).toBe(201);
    expect(res.body.fromColumn).toBeDefined();
    expect(res.body.toColumn).toBeDefined();
    expect(res.body.fromColumn.id).toBe(columnAId);
    expect(res.body.toColumn.id).toBe(columnBId);
    ruleId = res.body.id;
  });

  it('2. should list workflow rules', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/workflow-rules`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(ruleId);
  });

  it('3. should reject duplicate transition rule', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/workflow-rules`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ fromColumnId: columnAId, toColumnId: columnBId });
    expect(res.status).toBe(409);
  });

  it('4. should reject rule with same source and target', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/workflow-rules`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ fromColumnId: columnAId, toColumnId: columnAId });
    expect(res.status).toBe(400);
  });

  it('5. should create a second rule from same source', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/workflow-rules`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ fromColumnId: columnAId, toColumnId: columnCId });
    expect(res.status).toBe(201);
  });

  it('6. should now list two rules', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/workflow-rules`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('7. should delete a workflow rule', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/workflow-rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(204);
  });

  it('8. should return 404 when deleting nonexistent rule', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/workflow-rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(404);
  });
});
