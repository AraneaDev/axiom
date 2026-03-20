import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Board Columns API', () => {
  let token: string;
  let projectId: string;
  let createdColumnId: string;
  let defaultColumnIds: string[];

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'board-col-test-user' },
      update: {},
      create: {
        email: 'board-col-test@axiom.dev',
        username: 'board-col-test-user',
        displayName: 'Board Col Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Board Col Test Org',
        slug: 'board-col-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Board Col Test Team',
        slug: 'board-col-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'board-col-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create project via API so default columns are created
    const projectRes = await request(app)
      .post(`/api/projects/team/${team.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Board Col Test Project', slug: 'board-col-test-project', prefix: 'BCT' });
    projectId = projectRes.body.id;

    // Fetch default column IDs
    const boardRes = await request(app)
      .get(`/api/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    const columns = boardRes.body.columns ?? boardRes.body;
    defaultColumnIds = columns.map((c: { id: string }) => c.id);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'board-col-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'board-col-test-user' } });
    await prisma.$disconnect();
  });

  // 1. Create column
  it('1. should create a new board column', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/board/columns`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'QA Review', position: 10 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('QA Review');
    expect(res.body.position).toBe(10);
    expect(res.body.projectId).toBe(projectId);
    createdColumnId = res.body.id;
  });

  // 2. Update column name
  it('2. should update a column name', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/board/columns/${createdColumnId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'QA Verified' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('QA Verified');
  });

  // 3. Reorder columns
  it('3. should reorder columns', async () => {
    const positions = defaultColumnIds.map((id, i) => ({ id, position: i }));
    positions.push({ id: createdColumnId, position: defaultColumnIds.length });

    const res = await request(app)
      .patch(`/api/projects/${projectId}/board/columns/reorder`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ positions });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Verify the returned columns are in order
    for (let i = 1; i < res.body.length; i++) {
      expect(res.body[i].position).toBeGreaterThanOrEqual(res.body[i - 1].position);
    }
  });

  // 4. Delete column (no issues) -- should succeed
  it('4. should delete a column with no issues', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/board/columns/${createdColumnId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);
  });

  // 5. Delete column with issues -- should fail with 400
  it('5. should reject deleting a column that has issues', async () => {
    // First create a non-default column, add an issue to it, then try to delete
    const colRes = await request(app)
      .post(`/api/projects/${projectId}/board/columns`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Temp Column' });
    expect(colRes.status).toBe(201);
    const tempColumnId = colRes.body.id;

    // Create an issue
    const issueRes = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Blocker issue', priority: 'HIGH', type: 'BUG' });
    expect(issueRes.status).toBe(201);
    const issueNumber = issueRes.body.number;

    // Move issue to the temp column
    const moveRes = await request(app)
      .patch(`/api/projects/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ columnId: tempColumnId });
    expect(moveRes.status).toBe(200);

    // Try to delete the column -- should fail
    const delRes = await request(app)
      .delete(`/api/projects/${projectId}/board/columns/${tempColumnId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(delRes.status).toBe(400);

    // Cleanup: move issue back and delete column
    await request(app)
      .patch(`/api/projects/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ columnId: defaultColumnIds[0] });
    await request(app)
      .delete(`/api/projects/${projectId}/board/columns/${tempColumnId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    // Also delete the issue
    await request(app)
      .delete(`/api/projects/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
  });
});
