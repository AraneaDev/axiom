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
    expect(res.body).not.toHaveProperty('development');
    expect(res.body).toHaveProperty('activity');
    expect(res.body).toHaveProperty('attachments');
    expect(res.body).toHaveProperty('worklogs');
    expect(res.body).toHaveProperty('sprints');
    expect(res.body).toHaveProperty('customFields');
  });

  it('adds the GitHub panels when asked for them, with no link as empty ones', async () => {
    const get = (query: string) =>
      request(app)
        .get(`/api/projects/${projectId}/issues/${issueNumber}/hydrate${query}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');

    const one = await get('?include=development');
    expect(one.status).toBe(200);
    expect(one.body.development).toEqual({
      branches: { items: [], limit: 20, truncated: false },
      pullRequests: { items: [], limit: 20, truncated: false },
    });
    expect(one.body).not.toHaveProperty('checks');

    const both = await get('?include=development&include=checks');
    expect(both.body.checks).toEqual({ items: [], limit: 50, truncated: false });
    expect(both.body).toHaveProperty('development');

    expect((await get('?include=comments')).status).toBe(400);
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

describe('Issues List Hydration', () => {
  let token: string;
  let projectId: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'hydrate-list-test-user' },
      update: {},
      create: {
        email: 'hydrate-list-test@axiom.dev',
        username: 'hydrate-list-test-user',
        displayName: 'Hydrate List Test User',
        passwordHash,
      },
    });
    userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: 'Hydrate List Test Org',
        slug: 'hydrate-list-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    orgId = org.id;

    const team = await prisma.team.create({
      data: {
        name: 'Hydrate List Test Team',
        slug: 'hydrate-list-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'hydrate-list-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    const projectRes = await request(app)
      .post(`/api/projects/team/${team.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Hydrate List Project', slug: 'hydrate-list-project', prefix: 'HYL' });
    projectId = projectRes.body.id;

    // Create a couple of issues
    await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'List hydrate issue 1', type: 'TASK' });

    await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'List hydrate issue 2', type: 'BUG' });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('should return issues list with context data', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);

    // Issues data
    expect(res.body).toHaveProperty('issues');
    expect(res.body.issues).toHaveProperty('issues');
    expect(res.body.issues.issues.length).toBeGreaterThanOrEqual(2);
    expect(res.body.issues).toHaveProperty('total');

    // Context data
    expect(res.body).toHaveProperty('boardColumns');
    expect(Array.isArray(res.body.boardColumns)).toBe(true);
    expect(res.body).toHaveProperty('sprints');
    expect(res.body).toHaveProperty('savedFilters');
    expect(res.body).toHaveProperty('customFields');
  });

  it('should pass filters through', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/hydrate?type=BUG`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);
    expect(res.body.issues).toHaveProperty('issues');
    // All returned issues should be BUGs
    for (const issue of res.body.issues.issues) {
      expect(issue.type).toBe('BUG');
    }
  });
});
