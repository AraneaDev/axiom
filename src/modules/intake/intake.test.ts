import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Intake API', () => {
  let token: string;
  let projectId: string;
  let submissionId: string;
  let formSlug: string;
  let fieldId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'intake-test-user' },
      update: {},
      create: {
        email: 'intake-test@axiom.dev',
        username: 'intake-test-user',
        displayName: 'Intake Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Intake Test Org',
        slug: 'intake-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Intake Test Team',
        slug: 'intake-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'intake-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    const projectRes = await request(app)
      .post(`/api/projects/team/${team.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Intake Test Project', slug: 'intake-test-project', prefix: 'ITP' });
    projectId = projectRes.body.id;

    // Create form
    formSlug = `intake-form-${Date.now()}`;
    const formRes = await request(app)
      .post(`/api/projects/${projectId}/forms`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Intake Form', slug: formSlug });
    const formId = formRes.body.id;

    // Create page
    const pageRes = await request(app)
      .post(`/api/projects/${projectId}/forms/${formId}/pages`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ title: 'Page 1' });
    const pageId = pageRes.body.id;

    // Create field with title mapping
    const fieldRes = await request(app)
      .post(`/api/projects/${projectId}/forms/${formId}/pages/${pageId}/fields`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        type: 'TEXT',
        label: 'Issue Title',
        required: true,
        issueFieldMapping: 'title',
      });
    fieldId = fieldRes.body.id;

    // Publish form
    await request(app)
      .patch(`/api/projects/${projectId}/forms/${formId}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest');

    // Submit the form (public, no auth)
    const submitRes = await request(app)
      .post(`/api/f/${formSlug}/submit`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        data: { [fieldId]: 'My intake issue title' },
        submitterName: 'John Public',
        submitterEmail: 'john@example.com',
      });
    submissionId = submitRes.body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'intake-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'intake-test-user' } });
    await prisma.$disconnect();
  });

  describe('GET /api/projects/:projectId/intake', () => {
    it('should list submissions (200, length >= 1)', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/intake`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.submissions).toBeDefined();
      expect(res.body.submissions.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('POST /api/projects/:projectId/intake/:submissionId/approve', () => {
    it('should approve submission and verify issue is created (200)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/intake/${submissionId}/approve`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'My intake issue title' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('APPROVED');
      expect(res.body.issue).toBeDefined();
      expect(res.body.issue.title).toBe('My intake issue title');
    });
  });
});
