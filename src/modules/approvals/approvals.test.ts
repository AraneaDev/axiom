import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Approvals API', () => {
  let token: string;
  let userId: string;
  let projectId: string;
  let fromColumnId: string;
  let toColumnId: string;
  let _gateId: string;
  let issueId: string;
  let requestId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'approvals-test-user' },
      update: {},
      create: {
        email: 'approvals-test@axiom.dev',
        username: 'approvals-test-user',
        displayName: 'Approvals Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Approvals Test Org',
        slug: 'approvals-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Approvals Test Team',
        slug: 'approvals-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'approvals-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;
    userId = loginRes.body.user.id;

    // Create project via API so default columns are created
    const projectRes = await request(app)
      .post(`/api/projects/team/${team.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Approvals Test Project', slug: 'approvals-test-project', prefix: 'APT' });
    projectId = projectRes.body.id;

    // Fetch board columns
    const boardRes = await request(app)
      .get(`/api/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    const columns: Array<{ id: string; name: string }> = boardRes.body.columns ?? boardRes.body;
    fromColumnId = columns[0].id;
    toColumnId = columns[1].id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'approvals-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'approvals-test-user' } });
    await prisma.$disconnect();
  });

  // ── Gate CRUD ─────────────────────────────────────────────────────────────

  describe('POST /api/projects/:projectId/approval-gates', () => {
    it('should create an approval gate', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/approval-gates`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ fromColumnId, toColumnId, minApprovals: 1, allowSelfApproval: true });
      expect(res.status).toBe(201);
      expect(res.body.fromColumn.id).toBe(fromColumnId);
      expect(res.body.toColumn.id).toBe(toColumnId);
      expect(res.body.minApprovals).toBe(1);
      _gateId = res.body.id;
    });

    it('should reject a duplicate gate', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/approval-gates`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ fromColumnId, toColumnId, minApprovals: 1, allowSelfApproval: true });
      expect(res.status).toBe(409);
    });

    it('should reject same fromColumnId and toColumnId', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/approval-gates`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ fromColumnId, toColumnId: fromColumnId, minApprovals: 1 });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/projects/:projectId/approval-gates', () => {
    it('should list gates', async () => {
      const res = await request(app)
        .get(`/api/projects/${projectId}/approval-gates`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Approval Requests & Voting ────────────────────────────────────────────

  describe('Approval Request flow', () => {
    beforeAll(async () => {
      // Create an issue in the fromColumn
      const issueRes = await request(app)
        .post(`/api/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Approval test issue', columnId: fromColumnId });
      issueId = issueRes.body.id;
    });

    it('should create an approval request', async () => {
      const res = await request(app)
        .post(`/api/issues/${issueId}/approval-requests/${toColumnId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ approverIds: [userId] });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      requestId = res.body.id;
    });

    it('should reject a duplicate pending request', async () => {
      const res = await request(app)
        .post(`/api/issues/${issueId}/approval-requests/${toColumnId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ approverIds: [userId] });
      expect(res.status).toBe(409);
    });

    it('should cast an approval vote and auto-move issue to target column', async () => {
      const res = await request(app)
        .post(`/api/approval-requests/${requestId}/vote`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ decision: 'APPROVED', comment: 'Looks good' });
      expect(res.status).toBe(201);

      // Verify issue was moved to target column
      const issue = await prisma.issue.findUnique({
        where: { id: issueId },
        select: { columnId: true },
      });
      expect(issue?.columnId).toBe(toColumnId);
    });
  });
});
