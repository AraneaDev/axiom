import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

const XHR = { 'X-Requested-With': 'XMLHttpRequest' };

describe('Automation API', () => {
  let token: string;
  let projectId: string;
  let ruleId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    await prisma.user.upsert({
      where: { username: 'automation-test-user' },
      update: {},
      create: {
        email: 'automation-test@axiom.dev',
        username: 'automation-test-user',
        displayName: 'Automation Test User',
        passwordHash,
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set(XHR)
      .send({ login: 'automation-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create org via API
    const orgRes = await request(app)
      .post('/api/orgs')
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Automation Test Org', slug: 'automation-test-org' });

    // Create team via API
    const teamRes = await request(app)
      .post(`/api/teams/org/${orgRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Automation Test Team', slug: 'automation-test-team' });

    // Create project via API
    const projectRes = await request(app)
      .post(`/api/projects/team/${teamRes.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({ name: 'Automation Test Project', slug: 'automation-test-project', prefix: 'AUT' });
    projectId = projectRes.body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'automation-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'automation-test-user' } });
    await prisma.$disconnect();
  });

  // ---- CRUD ----

  it('1. should create an automation rule', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/automation-rules`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({
        name: 'Auto-assign on creation',
        trigger: 'issue:created',
        conditions: [],
        actions: [{ type: 'add_label', name: 'triage' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Auto-assign on creation');
    expect(res.body.trigger).toBe('issue:created');
    expect(res.body.enabled).toBe(true);
    ruleId = res.body.id;
  });

  it('2. should list automation rules', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/automation-rules`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(ruleId);
  });

  it('3. should toggle rule to disabled', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/automation-rules/${ruleId}/toggle`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('4. should toggle rule back to enabled', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/automation-rules/${ruleId}/toggle`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });

  it('5. should update an automation rule', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/automation-rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({
        name: 'Updated rule name',
        actions: [{ type: 'add_comment', body: 'Welcome!' }],
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated rule name');
  });

  it('6. should create a second rule with conditions', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/automation-rules`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR)
      .send({
        name: 'Label bug on status change',
        trigger: 'issue:status_changed',
        conditions: [{ field: 'priority', operator: 'equals', value: 'HIGH' }],
        actions: [{ type: 'add_label', name: 'urgent' }],
        enabled: false,
      });
    expect(res.status).toBe(201);
    expect(res.body.enabled).toBe(false);
    expect(res.body.conditions).toEqual([{ field: 'priority', operator: 'equals', value: 'HIGH' }]);
  });

  it('7. should list two rules', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/automation-rules`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('8. should delete an automation rule', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/automation-rules/${ruleId}`)
      .set('Authorization', `Bearer ${token}`)
      .set(XHR);
    expect(res.status).toBe(204);

    // Verify it was deleted
    const listRes = await request(app)
      .get(`/api/projects/${projectId}/automation-rules`)
      .set('Authorization', `Bearer ${token}`);
    expect(listRes.body.length).toBe(1);
  });
});
