import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Custom Fields API', () => {
  let token: string;
  let userId: string;
  let orgId: string;
  let teamId: string;
  let projectId: string;
  let issueId: string;

  const testUser = {
    email: 'cf-test@axiom.dev',
    username: 'cf-testuser',
    displayName: 'CF Test User',
    password: 'securepassword123',
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(testUser.password, 4);
    const user = await prisma.user.upsert({
      where: { username: testUser.username },
      update: {},
      create: {
        email: testUser.email,
        username: testUser.username,
        displayName: testUser.displayName,
        passwordHash,
      },
    });
    userId = user.id;

    const org = await prisma.organization.upsert({
      where: { slug: 'cf-test-org' },
      update: {},
      create: { name: 'CF Test Org', slug: 'cf-test-org' },
    });
    orgId = org.id;

    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId, orgId } },
      update: {},
      create: { userId, orgId, role: 'OWNER' },
    });

    const team = await prisma.team.upsert({
      where: { orgId_slug: { orgId, slug: 'cf-test-team' } },
      update: {},
      create: { orgId, name: 'CF Test Team', slug: 'cf-test-team' },
    });
    teamId = team.id;

    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: {},
      create: { userId, teamId, role: 'ADMIN' },
    });

    const project = await prisma.project.upsert({
      where: { teamId_slug: { teamId, slug: 'cf-test-project' } },
      update: {},
      create: { teamId, name: 'CF Test Project', slug: 'cf-test-project', prefix: 'CFT' },
    });
    projectId = project.id;

    const issue = await prisma.issue.create({
      data: {
        projectId,
        number: 800,
        title: 'CF Test Issue',
        body: 'Test body',
        creatorId: userId,
      },
    });
    issueId = issue.id;

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({
        login: testUser.email,
        password: testUser.password,
      });
    token = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await prisma.customFieldValue.deleteMany({ where: { issueId } });
    await prisma.customFieldDefinition.deleteMany({ where: { projectId } });
    await prisma.issue.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.teamMembership.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.orgMembership.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  // ── Create Field Definitions ───────────────────────────────

  describe('POST /api/projects/:projectId/custom-fields', () => {
    it('should create a TEXT field definition', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/custom-fields`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'Customer Name', type: 'TEXT' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Customer Name');
      expect(res.body.type).toBe('TEXT');
    });

    it('should create a NUMBER field definition', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/custom-fields`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'Effort Points', type: 'NUMBER' });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe('NUMBER');
    });

    it('should create a SELECT field definition with options', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/custom-fields`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          name: 'Severity',
          type: 'SELECT',
          options: ['Low', 'Medium', 'High'],
        });
      expect(res.status).toBe(201);
      expect(res.body.type).toBe('SELECT');
      expect(res.body.options).toEqual(['Low', 'Medium', 'High']);
    });

    it('should reject missing name or type', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/custom-fields`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'Missing Type' });
      expect(res.status).toBe(400);
    });
  });

  // ── List Field Definitions ─────────────────────────────────

  describe('GET /api/projects/:projectId/custom-fields', () => {
    it('should list field definitions for a project', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/custom-fields`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ── Set/Get Field Values ───────────────────────────────────

  describe('Custom field values on issues', () => {
    let fieldId: string;

    beforeAll(async () => {
      const defs = await request(app)
        .get(`/api/projects/${projectId}/custom-fields`)
        .set('Authorization', `Bearer ${token}`);
      fieldId = defs.body[0].id;
    });

    it('should set a custom field value on an issue', async () => {
      const res = await request(app)
        .put(`/api/issues/${issueId}/custom-fields/${fieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ value: 'Acme Corp' });
      expect(res.status).toBe(200);
      expect(res.body.value).toBe('Acme Corp');
    });

    it('should get all custom field values for an issue', async () => {
      const res = await request(app)
        .get(`/api/issues/${issueId}/custom-fields`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0].value).toBe('Acme Corp');
    });

    it('should reject missing value', async () => {
      const res = await request(app)
        .put(`/api/issues/${issueId}/custom-fields/${fieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({});
      expect(res.status).toBe(400);
    });
  });

  // ── Delete Field Definition Cascades Values ────────────────

  describe('DELETE /api/custom-fields/:fieldId', () => {
    it('should delete a field definition and cascade to values', async () => {
      // Create a new field + value, then delete
      const createRes = await request(app)
        .post(`/api/projects/${projectId}/custom-fields`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'Temp Field', type: 'TEXT' });
      const tempFieldId = createRes.body.id;

      await request(app)
        .put(`/api/issues/${issueId}/custom-fields/${tempFieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ value: 'temp value' });

      const delRes = await request(app)
        .delete(`/api/custom-fields/${tempFieldId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(delRes.status).toBe(204);

      // Verify the values are gone
      const values = await prisma.customFieldValue.findMany({
        where: { fieldDefinitionId: tempFieldId },
      });
      expect(values).toHaveLength(0);
    });
  });
});
