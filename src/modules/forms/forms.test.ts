import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Forms API', () => {
  let token: string;
  let projectId: string;
  let formId: string;
  let formSlug: string;
  let pageId: string;
  let fieldId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'forms-test-user' },
      update: {},
      create: {
        email: 'forms-test@axiom.dev',
        username: 'forms-test-user',
        displayName: 'Forms Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Forms Test Org',
        slug: 'forms-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Forms Test Team',
        slug: 'forms-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'forms-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    const projectRes = await request(app)
      .post(`/api/projects/team/${team.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Forms Test Project', slug: 'forms-test-project', prefix: 'FTP' });
    projectId = projectRes.body.id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'forms-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'forms-test-user' } });
    await prisma.$disconnect();
  });

  describe('POST /api/projects/:projectId/forms', () => {
    it('should create a form (201)', async () => {
      formSlug = `test-form-${Date.now()}`;
      const res = await request(app)
        .post(`/api/projects/${projectId}/forms`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'Test Form', slug: formSlug });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Test Form');
      expect(res.body.slug).toBe(formSlug);
      formId = res.body.id;
    });
  });

  describe('POST /api/projects/:projectId/forms/:formId/pages', () => {
    it('should create a page (201)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/forms/${formId}/pages`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Page 1' });
      expect(res.status).toBe(201);
      expect(res.body.title).toBe('Page 1');
      pageId = res.body.id;
    });
  });

  describe('POST /api/projects/:projectId/forms/:formId/pages/:pageId/fields', () => {
    it('should create a field mapped to title (201)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/forms/${formId}/pages/${pageId}/fields`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          type: 'TEXT',
          label: 'Issue Title',
          required: true,
          issueFieldMapping: 'title',
        });
      expect(res.status).toBe(201);
      expect(res.body.issueFieldMapping).toBe('title');
      fieldId = res.body.id;
    });

    it('leaves required alone when a patch does not name it', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/forms/${formId}/pages/${pageId}/fields/${fieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ label: 'Issue Title Renamed' });
      expect(res.status).toBe(200);
      expect(res.body.label).toBe('Issue Title Renamed');
      expect(res.body.required).toBe(true);
    });
  });

  describe('PATCH /api/projects/:projectId/forms/:formId/publish', () => {
    it('should publish a form with title mapping (200, status PUBLISHED)', async () => {
      const res = await request(app)
        .patch(`/api/projects/${projectId}/forms/${formId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('PUBLISHED');
    });

    it('should reject publish of a form without title mapping (400)', async () => {
      // Create another form without any fields mapped to title
      const slug2 = `test-form-no-title-${Date.now()}`;
      const formRes = await request(app)
        .post(`/api/projects/${projectId}/forms`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'No Title Form', slug: slug2 });
      const formId2 = formRes.body.id;

      // Add a page with a non-title field
      const pageRes = await request(app)
        .post(`/api/projects/${projectId}/forms/${formId2}/pages`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Page 1' });
      const pageId2 = pageRes.body.id;

      await request(app)
        .post(`/api/projects/${projectId}/forms/${formId2}/pages/${pageId2}/fields`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ type: 'TEXT', label: 'Some Field', required: false });

      const publishRes = await request(app)
        .patch(`/api/projects/${projectId}/forms/${formId2}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(publishRes.status).toBe(400);
    });
  });

  describe('GET /api/f/:formSlug', () => {
    it('should fetch the public form by slug (200, no auth)', async () => {
      const res = await request(app).get(`/api/f/${formSlug}`);
      expect(res.status).toBe(200);
      expect(res.body.slug).toBe(formSlug);
      expect(res.body.status).toBe('PUBLISHED');
    });
  });

  describe('POST /api/f/:formSlug/submit', () => {
    it('should submit the public form (201, no auth)', async () => {
      const res = await request(app)
        .post(`/api/f/${formSlug}/submit`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          data: { [fieldId]: 'My submitted title' },
          submitterName: 'Jane Doe',
          submitterEmail: 'jane@example.com',
        });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
    });
  });
});
