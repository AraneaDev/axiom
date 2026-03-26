import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Backlog Hydration', () => {
  let token: string;
  let projectId: string;
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'backlog-hydrate-user' },
      update: {},
      create: {
        email: 'backlog-hydrate@axiom.dev',
        username: 'backlog-hydrate-user',
        displayName: 'Backlog Hydrate User',
        passwordHash,
      },
    });
    userId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: 'Backlog Hydrate Org',
        slug: 'backlog-hydrate-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });
    orgId = org.id;

    const team = await prisma.team.create({
      data: {
        name: 'Backlog Hydrate Team',
        slug: 'backlog-hydrate-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'backlog-hydrate@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    const projectRes = await request(app)
      .post(`/api/projects/team/${team.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Backlog Hydrate Project', slug: 'backlog-hydrate-project', prefix: 'BKH' });
    projectId = projectRes.body.id;

    // Create an issue (will land in backlog since no sprint assigned)
    await request(app)
      .post(`/api/projects/${projectId}/issues`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Backlog hydrate test issue', type: 'TASK' });
  });

  afterAll(async () => {
    await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('should return all sections in a single response', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/backlog/hydrate`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(200);

    // All three sections should be present
    expect(res.body).toHaveProperty('sprints');
    expect(res.body).toHaveProperty('backlogIssues');
    expect(res.body).toHaveProperty('velocity');

    // Sprints should be an array (possibly empty)
    expect(Array.isArray(res.body.sprints)).toBe(true);

    // Backlog should contain the issue we created
    expect(Array.isArray(res.body.backlogIssues)).toBe(true);
    expect(res.body.backlogIssues.length).toBeGreaterThanOrEqual(1);

    // Velocity should be an array
    expect(Array.isArray(res.body.velocity)).toBe(true);
  });

  it('should require authentication', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/backlog/hydrate`)
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(res.status).toBe(401);
  });
});
