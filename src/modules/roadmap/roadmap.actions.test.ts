import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authPatch, authPost } from '../../test/helpers';

describe('roadmap issue routes', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let outsider: TestUser;
  let issueId: string;
  let bucketId: string;
  let otherBucketId: string;
  let otherIssueId: string;
  let otherProject: TestContext;

  const path = (id: string, what: string, projectId = ctx.projectId) =>
    `/api/projects/${projectId}/roadmap/issues/${id}/${what}`;

  beforeAll(async () => {
    ctx = await createTestContext(`rmap${Date.now()}`);
    otherProject = await createTestContext(`rmapo${Date.now()}`);
    viewer = await addMemberToContext(ctx);
    await prisma.teamMembership.updateMany({
      where: { teamId: ctx.teamId, userId: viewer.id },
      data: { role: 'VIEWER' },
    });
    outsider = await createTestUser();
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'On the map',
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    issueId = issue.id;
    const otherIssue = await prisma.issue.create({
      data: {
        projectId: otherProject.projectId,
        number: 1,
        title: 'Elsewhere',
        body: '',
        creatorId: otherProject.owner.id,
      },
    });
    otherIssueId = otherIssue.id;
    const bucket = await prisma.roadmapBucket.create({
      data: { projectId: ctx.projectId, name: 'Now', position: 0 },
    });
    bucketId = bucket.id;
    const otherBucket = await prisma.roadmapBucket.create({
      data: { projectId: otherProject.projectId, name: 'Elsewhere', position: 0 },
    });
    otherBucketId = otherBucket.id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await cleanupTestContext(otherProject);
    await prisma.user.deleteMany({ where: { id: { in: [viewer.id, outsider.id] } } });
  });

  describe('PATCH .../bucket', () => {
    it('moves an issue to a bucket and out again, with the body the UI sends', async () => {
      const moved = await authPatch(path(issueId, 'bucket'), ctx.owner.token, { bucketId });
      expect(moved.status).toBe(200);
      expect(moved.body.roadmapBucketId).toBe(bucketId);
      const out = await authPatch(path(issueId, 'bucket'), ctx.owner.token, { bucketId: null });
      expect(out.status).toBe(200);
      expect(out.body.roadmapBucketId).toBeNull();
    });

    it('refuses a bucket of another project', async () => {
      const res = await authPatch(path(issueId, 'bucket'), ctx.owner.token, {
        bucketId: otherBucketId,
      });
      expect(res.status).toBe(404);
      const row = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
      expect(row.roadmapBucketId).toBeNull();
    });

    it('refuses an issue of another project', async () => {
      const res = await authPatch(path(otherIssueId, 'bucket'), ctx.owner.token, { bucketId });
      expect(res.status).toBe(404);
      const row = await prisma.issue.findUniqueOrThrow({ where: { id: otherIssueId } });
      expect(row.roadmapBucketId).toBeNull();
    });

    it('needs a bucketId in the body', async () => {
      expect((await authPatch(path(issueId, 'bucket'), ctx.owner.token, {})).status).toBe(400);
    });
  });

  describe('PATCH .../dates', () => {
    it('sets both dates, with the body the UI sends', async () => {
      const res = await authPatch(path(issueId, 'dates'), ctx.owner.token, {
        startDate: '2026-11-05',
        dueDate: '2026-11-19',
      });
      expect(res.status).toBe(200);
      const row = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
      expect(row.startDate?.toISOString().slice(0, 10)).toBe('2026-11-05');
      expect(row.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-19');
    });

    it('changes only the date a request names, and clears one with null', async () => {
      const res = await authPatch(path(issueId, 'dates'), ctx.owner.token, { startDate: null });
      expect(res.status).toBe(200);
      const row = await prisma.issue.findUniqueOrThrow({ where: { id: issueId } });
      expect(row.startDate).toBeNull();
      expect(row.dueDate?.toISOString().slice(0, 10)).toBe('2026-11-19');
    });

    it('refuses a start after the due date, and what is no date', async () => {
      const late = await authPatch(path(issueId, 'dates'), ctx.owner.token, {
        startDate: '2026-12-01',
      });
      expect(late.status).toBe(400);
      const garbage = await authPatch(path(issueId, 'dates'), ctx.owner.token, {
        startDate: 'soon',
      });
      expect(garbage.status).toBe(400);
    });

    it('needs at least one date', async () => {
      expect((await authPatch(path(issueId, 'dates'), ctx.owner.token, {})).status).toBe(400);
    });
  });

  describe('permissions, as the other roadmap writes', () => {
    it.each(['bucket', 'dates'])('refuses a VIEWER on %s, even with a bad body', async (what) => {
      const res = await authPatch(path(issueId, what), viewer.token, { nothing: true });
      expect(res.status).toBe(403);
    });

    it.each(['bucket', 'dates'])(
      'answers an outsider as a bucket write does on %s',
      async (what) => {
        const sibling = await authPost(
          `/api/projects/${ctx.projectId}/roadmap/buckets`,
          outsider.token,
          { name: 'No' },
        );
        const res = await authPatch(path(issueId, what), outsider.token, { nothing: true });
        expect(res.status).toBe(sibling.status);
        expect(res.body.error.code).toBe(sibling.body.error.code);
      },
    );
  });
});
