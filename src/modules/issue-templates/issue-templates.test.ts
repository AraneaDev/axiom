import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Issue Templates API', () => {
  let token: string;
  let teamId: string;
  let projectId: string;
  let templateId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'tmpl-test-user' },
      update: {},
      create: {
        email: 'tmpl-test@axiom.dev',
        username: 'tmpl-test-user',
        displayName: 'Template Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Template Test Org',
        slug: 'tmpl-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Template Test Team',
        slug: 'tmpl-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });
    teamId = team.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'tmpl-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    const projectRes = await request(app)
      .post(`/api/projects/team/${teamId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Template Project', slug: 'tmpl-project', prefix: 'TMP' });
    projectId = projectRes.body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'tmpl-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'tmpl-test-user' } });
    await prisma.$disconnect();
  });

  // 1. Create template
  it('1. should create an issue template', async () => {
    const res = await request(app)
      .post(`/api/projects/${projectId}/issue-templates`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        name: 'Bug Report',
        type: 'BUG',
        title: 'Bug: [description]',
        body: 'Steps to reproduce:\n1.\n2.\n3.',
        labels: ['bug'],
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Bug Report');
    expect(res.body.type).toBe('BUG');
    expect(res.body.id).toBeDefined();
    templateId = res.body.id;
  });

  // 2. List templates
  it('2. should list templates for project', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issue-templates`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('Bug Report');
  });

  // 3. Get template by ID
  it('3. should get a template by ID', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issue-templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Bug Report');
    expect(res.body.title).toBe('Bug: [description]');
  });

  // 4. Update template
  it('4. should update a template', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/issue-templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Bug: [updated description]', body: 'Updated body' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Bug: [updated description]');
    expect(res.body.body).toBe('Updated body');
  });

  it('keeps the body when an update leaves it out', async () => {
    const res = await request(app)
      .patch(`/api/projects/${projectId}/issue-templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Bug: only the title' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Bug: only the title');
    expect(res.body.body).toBe('Updated body');
  });

  // 5. Template not found
  it('5. should return 404 for non-existent template', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issue-templates/nonexistent-id`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  // 6. Delete template
  it('6. should delete a template', async () => {
    const res = await request(app)
      .delete(`/api/projects/${projectId}/issue-templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    expect(res.status).toBe(204);
  });

  // 7. Verify deleted template is gone
  it('7. should return 404 after template deletion', async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/issue-templates/${templateId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
