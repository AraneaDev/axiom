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
  let secondToken: string;
  let commentId: string;

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

    const org = await prisma.organization.create({
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
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: 'issues-test@axiom.dev',
        password: 'testpassword123',
      });
    token = loginRes.body.accessToken;

    // Second user for ownership tests
    const user2 = await prisma.user.upsert({
      where: { username: 'issues-test-user2' },
      update: {},
      create: {
        email: 'issues-test2@axiom.dev',
        username: 'issues-test-user2',
        displayName: 'Issues Test User 2',
        passwordHash,
      },
    });
    await prisma.teamMembership.create({
      data: { userId: user2.id, teamId: team.id, role: 'MEMBER' },
    });
    await prisma.orgMembership.create({
      data: { userId: user2.id, orgId: org.id, role: 'MEMBER' },
    });
    const login2 = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'issues-test2@axiom.dev', password: 'testpassword123' });
    secondToken = login2.body.accessToken;

    // Create project via API so default columns are created
    const projectRes = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Issues Test Project', slug: 'issues-test-project', prefix: 'ISS' });
    projectId = projectRes.body.id;

    // Fetch columns for board tests
    const boardRes = await request(app)
      .get(`/api/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    const columns = boardRes.body.columns ?? boardRes.body;
    _columnId = columns[0].id;
    secondColumnId = columns[1].id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'issues-test-org' } });
    await prisma.user.deleteMany({
      where: { username: { in: ['issues-test-user', 'issues-test-user2'] } },
    });
    await prisma.$disconnect();
  });

  // 1. Create issue
  it('1. should create an issue', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
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
      .get(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  // 3. List issues with filter
  it('3. should filter issues by priority', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues?priority=MEDIUM`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.issues)).toBe(true);
    res.body.issues.forEach((issue: { priority: string }) => {
      expect(issue.priority).toBe('MEDIUM');
    });
  });

  // 4. Get issue by number
  it('4. should get an issue by number', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.number).toBe(issueNumber);
    expect(res.body.title).toBe('First test issue');
  });

  // 5. Update issue title
  it('5. should update issue title', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Updated test issue' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated test issue');
  });

  // 6. Update issue priority and type
  it('6. should update issue priority and type', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ priority: 'HIGH', type: 'STORY' });
    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('HIGH');
    expect(res.body.type).toBe('STORY');
  });

  // 7. Add comment
  it('7. should add a comment to an issue', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues/${issueNumber}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'This is a test comment' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('This is a test comment');
    commentId = res.body.id;
  });

  // 7a. Update comment
  it('7a. should update a comment body', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Updated comment body' });
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('Updated comment body');
  });

  // 7b. Update comment as different user -- expect 403
  it('7b. should reject comment update from non-author', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${secondToken}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Unauthorized edit' });
    expect(res.status).toBe(403);
  });

  // 7c. Update non-existent comment -- expect 404
  it('7c. should return 404 for non-existent comment update', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/comments/nonexistent-id`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Does not matter' });
    expect(res.status).toBe(404);
  });

  // 7d. Delete comment as different user -- expect 403
  it('7d. should reject comment delete from non-author', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${secondToken}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(403);
  });

  // 7e. Delete own comment
  it('7e. should delete own comment', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);
  });

  // 7f. Verify comment is gone
  it('7f. should confirm comment no longer exists after delete', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/comments/${commentId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ body: 'Should not work' });
    expect(res.status).toBe(404);
  });

  // 8. Get board view
  it('8. should get the board view', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const columns = res.body.columns ?? res.body;
    expect(Array.isArray(columns)).toBe(true);
    expect(columns.length).toBeGreaterThan(0);
  });

  // 9. Move issue between columns
  it('9. should move an issue to a different column', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ columnId: secondColumnId });
    expect(res.status).toBe(200);
    expect(res.body.columnId).toBe(secondColumnId);
  });

  // 10. Delete issue
  it('10. should delete an issue', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/issues/${issueNumber}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);
  });
});
