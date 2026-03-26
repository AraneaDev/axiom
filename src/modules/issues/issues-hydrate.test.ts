import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Issue Detail Hydrate API', () => {
  let token: string;
  let projectId: string;
  let issueNumber: number;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'hydrate-test-user' },
      update: {},
      create: {
        email: 'hydrate-test@axiom.dev',
        username: 'hydrate-test-user',
        displayName: 'Hydrate Test User',
        passwordHash,
      },
    });
    userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: 'Hydrate Test Org',
        slug: 'hydrate-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    orgId = org.id;

    const team = await prisma.team.create({
      data: {
        name: 'Hydrate Test Team',
        slug: 'hydrate-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'hydrate-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create project via API so default columns are created
    const projectRes = await request(app)
      .post(`/api/projects/team/${team.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Hydrate Test Project', slug: 'hydrate-test-project', prefix: 'HYD' });
    projectId = projectRes.body.id;

    // Create an issue
    const issueRes = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Hydrate test issue', type: 'TASK' });
    issueNumber = issueRes.body.number;
  });

  afterAll(async () => {
    // Cleanup in dependency order
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('should return all sections in a single response', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);

    // Primary data
    expect(res.body.issue).toBeDefined();
    expect(res.body.issue.number).toBe(issueNumber);

    // Secondary sections should be present (may be empty arrays/objects but not undefined)
    expect(res.body).toHaveProperty('votes');
    expect(res.body).toHaveProperty('watchers');
    expect(res.body).toHaveProperty('links');
    expect(res.body).toHaveProperty('children');
    expect(res.body).toHaveProperty('progress');
    expect(res.body).toHaveProperty('development');
    expect(res.body.development).toHaveProperty('branches');
    expect(res.body.development).toHaveProperty('pullRequests');
    expect(res.body.development).toHaveProperty('commits');
    expect(res.body).toHaveProperty('activity');
    expect(res.body).toHaveProperty('attachments');
    expect(res.body).toHaveProperty('worklogs');
    expect(res.body).toHaveProperty('sprints');
    expect(res.body).toHaveProperty('customFields');
  });

  it('should return 404 for non-existent issue', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/99999/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(404);
  });

  it('should require authentication', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/hydrate`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(401);
  });
});
