import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Roadmap API', () => {
  let token: string;
  let projectId: string;
  let columnId: string;

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash('testpassword123', 4);

    const user = await prisma.user.upsert({
      where: { username: 'roadmap-test-user' },
      update: {},
      create: {
        email: 'roadmap-test@axiom.dev',
        username: 'roadmap-test-user',
        displayName: 'Roadmap Test User',
        passwordHash,
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: 'Roadmap Test Org',
        slug: 'roadmap-test-org',
        members: { create: { userId: user.id, role: 'OWNER' } },
      },
    });

    const team = await prisma.team.create({
      data: {
        name: 'Roadmap Test Team',
        slug: 'roadmap-test-team',
        orgId: org.id,
        members: { create: { userId: user.id, role: 'ADMIN' } },
      },
    });

    const loginRes = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ login: 'roadmap-test@axiom.dev', password: 'testpassword123' });
    token = loginRes.body.accessToken;

    // Create project via API so default columns are created
    const projectRes = await request(app)
      .post(`/api/projects/team/${team.id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ name: 'Roadmap Test Project', slug: 'roadmap-test-project', prefix: 'RTP' });
    projectId = projectRes.body.id;

    // Fetch board columns to get a column ID for issue creation
    const boardRes = await request(app)
      .get(`/api/projects/${projectId}/board`)
      .set('Authorization', `Bearer ${token}`);
    const columns: Array<{ id: string; name: string }> = boardRes.body.columns ?? boardRes.body;
    columnId = columns[0].id;
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: 'roadmap-test-org' } });
    await prisma.user.deleteMany({ where: { username: 'roadmap-test-user' } });
    await prisma.$disconnect();
  });

  // ── Buckets ───────────────────────────────────────────────────────────────

  describe('POST /api/projects/:projectId/roadmap/buckets/defaults', () => {
    it('should create default buckets (Now, Next, Later)', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/roadmap/buckets/defaults`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(201);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(3);
      const names = res.body.map((b: { name: string }) => b.name);
      expect(names).toContain('Now');
      expect(names).toContain('Next');
      expect(names).toContain('Later');
    });

    it('should not duplicate defaults on second call', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/roadmap/buckets/defaults`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(res.status).toBe(201);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(3);
    });
  });

  describe('POST /api/projects/:projectId/roadmap/buckets', () => {
    it('should create a custom bucket', async () => {
      const res = await request(app)
        .post(`/api/projects/${projectId}/roadmap/buckets`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'Someday', color: '#aabbcc' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Someday');
      expect(res.body.color).toBe('#aabbcc');
      expect(res.body.projectId).toBe(projectId);
    });
  });

  describe('DELETE /api/projects/:projectId/roadmap/buckets/:id', () => {
    it('should delete a bucket and unset roadmapBucketId on associated issues', async () => {
      // Create a dedicated bucket for this test
      const bucketRes = await request(app)
        .post(`/api/projects/${projectId}/roadmap/buckets`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'ToDelete', color: '#ff0000' });
      expect(bucketRes.status).toBe(201);
      const bucketId = bucketRes.body.id;

      // Create an issue
      const issueRes = await request(app)
        .post(`/api/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Issue in bucket', columnId });
      expect(issueRes.status).toBe(201);
      const issueId = issueRes.body.id;

      // Assign issue to bucket directly via Prisma
      await prisma.issue.update({
        where: { id: issueId },
        data: { roadmapBucketId: bucketId },
      });

      // Delete the bucket
      const delRes = await request(app)
        .delete(`/api/projects/${projectId}/roadmap/buckets/${bucketId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      expect(delRes.status).toBe(204);

      // Verify issue's roadmapBucketId is now null
      const issue = await prisma.issue.findUnique({
        where: { id: issueId },
        select: { roadmapBucketId: true },
      });
      expect(issue?.roadmapBucketId).toBeNull();
    });
  });

  // ── Timeline ──────────────────────────────────────────────────────────────

  describe('GET /api/projects/:projectId/roadmap/timeline', () => {
    it('should return issues with dates and dependency links', async () => {
      // Create an epic with dueDate
      const epicRes = await request(app)
        .post(`/api/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          title: 'Timeline Epic',
          columnId,
          type: 'EPIC',
          dueDate: '2026-06-30T00:00:00.000Z',
        });
      expect(epicRes.status).toBe(201);
      const epicId = epicRes.body.id;

      // Set startDate directly via Prisma (not accepted by create endpoint)
      await prisma.issue.update({
        where: { id: epicId },
        data: { startDate: new Date('2026-06-01T00:00:00.000Z') },
      });

      // Create a second issue to form a dependency link
      const issue2Res = await request(app)
        .post(`/api/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          title: 'Blocked Issue',
          columnId,
          dueDate: '2026-07-15T00:00:00.000Z',
        });
      expect(issue2Res.status).toBe(201);
      const issue2Id = issue2Res.body.id;

      // Create a BLOCKS link from epic -> issue2
      await prisma.issueLink.create({
        data: { fromId: epicId, toId: issue2Id, type: 'BLOCKS' },
      });

      // Fetch timeline
      const res = await request(app)
        .get(`/api/projects/${projectId}/roadmap/timeline`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('issues');
      expect(res.body).toHaveProperty('links');
      expect(Array.isArray(res.body.issues)).toBe(true);
      expect(Array.isArray(res.body.links)).toBe(true);

      const issueIds = res.body.issues.map((i: { id: string }) => i.id);
      expect(issueIds).toContain(epicId);

      const link = res.body.links.find(
        (l: { fromId: string; toId: string }) => l.fromId === epicId && l.toId === issue2Id,
      );
      expect(link).toBeDefined();
      expect(link.type).toBe('BLOCKS');
    });
  });

  // ── Buckets View ──────────────────────────────────────────────────────────

  describe('GET /api/projects/:projectId/roadmap/buckets-view', () => {
    it('should return issues grouped by bucket and unassigned issues with dates', async () => {
      // Get the first bucket (Now)
      const listRes = await request(app)
        .get(`/api/projects/${projectId}/roadmap/buckets`)
        .set('Authorization', `Bearer ${token}`);
      expect(listRes.status).toBe(200);
      const nowBucket = listRes.body.find((b: { name: string }) => b.name === 'Now');
      expect(nowBucket).toBeDefined();

      // Create a bucketed issue
      const bucketedIssueRes = await request(app)
        .post(`/api/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Bucketed Issue', columnId });
      expect(bucketedIssueRes.status).toBe(201);
      const bucketedIssueId = bucketedIssueRes.body.id;
      await prisma.issue.update({
        where: { id: bucketedIssueId },
        data: { roadmapBucketId: nowBucket.id },
      });

      // Create an unassigned issue with a dueDate
      const unassignedIssueRes = await request(app)
        .post(`/api/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Unassigned Dated Issue', columnId, dueDate: '2026-08-01T00:00:00.000Z' });
      expect(unassignedIssueRes.status).toBe(201);
      const unassignedIssueId = unassignedIssueRes.body.id;

      // Fetch buckets view
      const res = await request(app)
        .get(`/api/projects/${projectId}/roadmap/buckets-view`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('buckets');
      expect(res.body).toHaveProperty('unassigned');
      expect(Array.isArray(res.body.buckets)).toBe(true);
      expect(Array.isArray(res.body.unassigned)).toBe(true);

      // The Now bucket should contain our bucketed issue
      const nowResult = res.body.buckets.find((b: { name: string }) => b.name === 'Now');
      expect(nowResult).toBeDefined();
      const nowIssueIds = nowResult.issues.map((i: { id: string }) => i.id);
      expect(nowIssueIds).toContain(bucketedIssueId);

      // The unassigned array should contain our dated unassigned issue
      const unassignedIds = res.body.unassigned.map((i: { id: string }) => i.id);
      expect(unassignedIds).toContain(unassignedIssueId);
    });
  });
});
