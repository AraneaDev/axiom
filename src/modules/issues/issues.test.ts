import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Issues API', () => {
  let token: string;
  let _userId: string;
  let _orgId: string;
  let teamId: string;
  let projectId: string;
  let issueNumber: number;
  let _columnId: string;
  let secondColumnId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'issues-test-user' },
      update: {},
      create: {
        email: 'issues-test@axiom.dev',
        username: 'issues-test-user',
        displayName: 'Issues Test User',
        passwordHash,
      },
    });
    _userId = user.id;

    const org = await prisma.org.create({
      data: {
        name: 'Issues Test Org',
        slug: 'issues-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    _orgId = org.id;

    const team = await prisma.team.create({
      data: {
        name: 'Issues Test Team',
        slug: 'issues-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app).post('/api/auth/login').send({
      login: 'issues-test@axiom.dev',
      password: 'testpassword123',
    });
    token = loginRes.body.accessToken;

    // Create project via API so default columns are created
    const projectRes = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Issues Test Project', slug: 'issues-test-project', identifier: 'ISS' });
    projectId = projectRes.body.id;

    // Fetch columns for board tests
    const boardRes = await request(app)
      .get(`/api/issues/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    const columns = boardRes.body.columns ?? boardRes.body;
    _columnId = columns[0].id;
    secondColumnId = columns[1].id;
  });

  afterAll(async () => {
    await prisma.org.deleteMany({ where: { slug: 'issues-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'issues-test-user' } });
    await prisma.$disconnect();
  });

  // 1. Create issue
  it('1. should create an issue', async () => {
    const res = await request(app)
      .post(`/api/issues/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'First test issue',
        description: 'A test issue description',
        priority: 'MEDIUM',
        type: 'BUG',
      });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('First test issue');
    expect(res.body.number).toBeDefined();
    issueNumber = res.body.number;
  });

  // 2. List issues
  it('2. should list issues for a project', async () => {
    const res = await request(app)
      .get(`/api/issues/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  // 3. List issues with filter
  it('3. should filter issues by priority', async () => {
    const res = await request(app)
      .get(`/api/issues/${projectId}/issues?priority=MEDIUM`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach((issue: { priority: string }) => {
      expect(issue.priority).toBe('MEDIUM');
    });
  });

  // 4. Get issue by number
  it('4. should get an issue by number', async () => {
    const res = await request(app)
      .get(`/api/issues/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(issueNumber);
    expect(res.body.title).toBe('First test issue');
  });

  // 5. Update issue title
  it('5. should update issue title', async () => {
    const res = await request(app)
      .patch(`/api/issues/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Updated test issue' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated test issue');
  });

  // 6. Update issue priority and type
  it('6. should update issue priority and type', async () => {
    const res = await request(app)
      .patch(`/api/issues/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ priority: 'HIGH', type: 'FEATURE' });
    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('HIGH');
    expect(res.body.type).toBe('FEATURE');
  });

  // 7. Add comment
  it('7. should add a comment to an issue', async () => {
    const res = await request(app)
      .post(`/api/issues/${projectId}/issues/${issueNumber}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ body: 'This is a test comment' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('This is a test comment');
  });

  // 8. Get board view
  it('8. should get the board view', async () => {
    const res = await request(app)
      .get(`/api/issues/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const columns = res.body.columns ?? res.body;
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
  });

  // 9. Move issue between columns
  it('9. should move an issue to a different column', async () => {
    const res = await request(app)
      .patch(`/api/issues/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ columnId: secondColumnId });
    expect(res.status).toBe(200);
    expect(res.body.columnId).toBe(secondColumnId);
  });

  // 10. Delete issue
  it('10. should delete an issue', async () => {
    const res = await request(app)
      .delete(`/api/issues/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(204);
  });
});
