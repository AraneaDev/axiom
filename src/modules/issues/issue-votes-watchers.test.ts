import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('Issue Votes & Watchers API', () => {
  let token: string;
  let _userId: string;
  let _orgId: string;
  let teamId: string;
  let projectId: string;
  let issueNumber: number;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'vote-watch-test-user' },
      update: {},
      create: {
        email: 'vote-watch-test@axiom.dev',
        username: 'vote-watch-test-user',
        displayName: 'Vote Watch Test User',
        passwordHash,
      },
    });
    _userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: 'Vote Watch Test Org',
        slug: 'vote-watch-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    _orgId = org.id;

    const team = await prisma.team.create({
      data: {
        name: 'Vote Watch Test Team',
        slug: 'vote-watch-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app).post('/api/auth/login').set(XHR).send({
      login: 'vote-watch-test@axiom.dev',
      password: 'testpassword123',
    });
    token = loginRes.body.accessToken;

    // Create project via API so default columns are created
    const projectRes = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Vote Watch Test Project', slug: 'vote-watch-test-project', prefix: 'VWT' });
    projectId = projectRes.body.id;

    // Create an issue for vote/watcher tests
    const issueRes = await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ title: 'Vote Watcher Test Issue' });
    issueNumber = issueRes.body.number;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'vote-watch-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'vote-watch-test-user' } });
    await prisma.$disconnect();
  });

  // ── Votes ────────────────────────────────────────────────────

  it('1. should return count 0 and voted false on a fresh issue', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/votes`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.voted).toBe(false);
  });

  it('2. should toggle vote on (add vote)', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues/${issueNumber}/votes/toggle`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(200);
    expect(res.body.voted).toBe(true);
  });

  it('3. should return count 1 and voted true after voting', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/votes`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.voted).toBe(true);
  });

  it('4. should toggle vote off (remove vote)', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues/${issueNumber}/votes/toggle`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(200);
    expect(res.body.voted).toBe(false);
  });

  it('5. should return count 0 and voted false after removing vote', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/votes`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.voted).toBe(false);
  });

  it('6. should return 404 when toggling vote on nonexistent issue', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues/99999/votes/toggle`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(404);
  });

  // ── Watchers ─────────────────────────────────────────────────

  it('7. should return empty watchers array on a fresh issue', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/watchers`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.watchers).toEqual([]);
  });

  it('8. should toggle watcher on (start watching)', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues/${issueNumber}/watchers/toggle`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(200);
    expect(res.body.watching).toBe(true);
  });

  it('9. should return 1 watcher with user info after watching', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/watchers`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.watchers).toHaveLength(1);
    expect(res.body.watchers[0].user).toHaveProperty('username', 'vote-watch-test-user');
    expect(res.body.watching).toBe(true);
  });

  it('10. should toggle watcher off (stop watching)', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues/${issueNumber}/watchers/toggle`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(200);
    expect(res.body.watching).toBe(false);
  });

  it('11. should return empty watchers array after unwatching', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issues/${issueNumber}/watchers`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.watchers).toEqual([]);
  });

  it('12. should return error when toggling watcher on nonexistent issue', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issues/99999/watchers/toggle`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
