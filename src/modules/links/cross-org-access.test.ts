/**
 * Id-based routes outside /:projectId: link previews, teams, attachments, approval requests
 * and custom fields must apply the same access rules as the resources they belong to.
 * The attacker is a user of a different org.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authDel, authGet, authPatch, authPost, authPut } from '../../test/helpers';

describe('Cross-org access on id routes', () => {
  let a: TestContext;
  let stranger: TestUser;
  const ids: Record<string, string> = {};
  const SECRET = `Confidential-${Date.now()}`;

  beforeAll(async () => {
    a = await createTestContext(`xorg${Date.now()}`);
    stranger = await createTestUser();
    const issue = await prisma.issue.create({
      data: { projectId: a.projectId, number: 1, title: SECRET, body: '', creatorId: a.owner.id },
    });
    ids.issue = issue.id;
    const space = await prisma.wikiSpace.create({
      data: { teamId: a.teamId, name: 'X', slug: 'xspace' },
    });
    const page = await prisma.page.create({
      data: { spaceId: space.id, title: SECRET, slug: 'xpage', body: SECRET },
    });
    ids.page = page.id;
    ids.attachment = (
      await prisma.attachment.create({
        data: {
          filename: 'f.txt',
          originalName: `${SECRET}.txt`,
          mimeType: 'text/plain',
          size: 1,
          storageKey: `missing-${Date.now()}`,
          uploaderId: a.owner.id,
          issueId: issue.id,
        },
      })
    ).id;
    const cols = await prisma.boardColumn.findMany({ where: { projectId: a.projectId }, take: 2 });
    const gate = await prisma.approvalGate.create({
      data: { projectId: a.projectId, fromColumnId: cols[0].id, toColumnId: cols[1].id },
    });
    ids.column = cols[1].id;
    ids.request = (
      await prisma.approvalRequest.create({
        data: {
          issueId: issue.id,
          approvalGateId: gate.id,
          targetColumnId: cols[1].id,
          requestedById: a.owner.id,
        },
      })
    ).id;
    ids.field = (
      await prisma.customFieldDefinition.create({
        data: { projectId: a.projectId, name: SECRET, type: 'TEXT' },
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupTestContext(a);
    await prisma.user.deleteMany({ where: { id: stranger.id } });
  });

  it('gives a stranger no preview of another org’s issue or page', async () => {
    const t = stranger.token;
    const issueUrl = `/${a.orgSlug}/${a.teamSlug}/test-project-${a.orgSlug.replace('test-org-', '')}/issues/1`;
    const pageUrl = `/${a.orgSlug}/${a.teamSlug}/wiki/xspace/xpage`;
    for (const url of [issueUrl, pageUrl]) {
      const res = await authGet(`/api/links/resolve-link?url=${encodeURIComponent(url)}`, t);
      expect(JSON.stringify(res.body)).not.toContain(SECRET);
    }
  });

  it('refuses a stranger every id route', async () => {
    const t = stranger.token;
    const results = await Promise.all([
      authGet(`/api/teams/${a.teamId}`, t),
      authGet(`/api/teams/org/${a.orgId}`, t),
      authGet(`/api/teams/${a.teamId}/members`, t),
      authGet(`/api/teams/${a.teamId}/activity`, t),
      authGet(`/api/attachments/${ids.attachment}/meta`, t),
      authGet(`/api/attachments?issueId=${ids.issue}`, t),
      authGet(`/api/issues/${ids.issue}/approval-requests`, t),
      authPost(`/api/issues/${ids.issue}/approval-requests/${ids.column}`, t),
      authPost(`/api/approval-requests/${ids.request}/cancel`, t),
      authGet(`/api/issues/${ids.issue}/custom-fields`, t),
      authPut(`/api/issues/${ids.issue}/custom-fields/${ids.field}`, t, { value: 'x' }),
      authPatch(`/api/custom-fields/${ids.field}`, t, { name: 'pwned' }),
      authDel(`/api/custom-fields/${ids.field}`, t),
    ]);
    const leaks = results
      .map((r, i) => ({ i, status: r.status, body: JSON.stringify(r.body) }))
      .filter((r) => (r.status !== 403 && r.status !== 404) || r.body.includes(SECRET));
    expect(leaks.map((l) => ({ i: l.i, status: l.status }))).toEqual([]);
    expect(await prisma.customFieldDefinition.count({ where: { id: ids.field } })).toBe(1);
    expect(
      (await prisma.approvalRequest.findUniqueOrThrow({ where: { id: ids.request } })).status,
    ).toBe('PENDING');
  });
});
