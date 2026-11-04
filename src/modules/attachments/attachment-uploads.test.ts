/**
 * Real uploads (stored, then read back) for issue and wiki attachments, by session and by
 * API token: the parent's access rule and the token's scope both apply.
 */
import os from 'os';
import path from 'path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { LEGACY_SCOPE_MAP } from '../../middleware/token-scopes';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authPost } from '../../test/helpers';

// Uploads go to a throwaway directory, never the repository
process.env.STORAGE_PATH = path.join(os.tmpdir(), `axiom-upload-test-${process.pid}`);

describe('Attachment uploads', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let issueId: string;
  let pageId: string;
  const tokens: Record<string, string> = {};

  const upload = (auth: string, parent: Record<string, string>, name = 'note.txt') => {
    let req = request(app)
      .post('/api/attachments')
      .set('Authorization', auth)
      .set('X-Requested-With', 'XMLHttpRequest');
    for (const [k, v] of Object.entries(parent)) req = req.field(k, v);
    return req.attach('file', Buffer.from(`hello from ${name}`), name);
  };

  beforeAll(async () => {
    ctx = await createTestContext(`uploads${Date.now()}`);
    viewer = await addMemberToContext(ctx);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: viewer.id, teamId: ctx.teamId } },
      data: { role: 'VIEWER' },
    });
    issueId = (
      await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 1,
          title: 'I',
          body: '',
          creatorId: ctx.owner.id,
        },
      })
    ).id;
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Up', slug: `up-${Date.now()}` },
    });
    pageId = (
      await prisma.page.create({ data: { spaceId: space.id, title: 'P', slug: 'p', body: '' } })
    ).id;
    // Tokens as stored since scopes per area: files:<kind> plus the parent's area
    for (const scope of ['issues:read', 'issues:write', 'wiki:write'] as const) {
      const res = await authPost('/api/users/me/tokens', ctx.owner.token, {
        name: scope,
        scopes: LEGACY_SCOPE_MAP[scope],
      });
      tokens[scope] = res.body.token;
    }
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: viewer.id } });
  });

  it('stores an issue attachment and reads it back', async () => {
    const res = await upload(`Bearer ${ctx.owner.token}`, { issueId });
    expect(res.status).toBe(201);
    const download = await request(app)
      .get(`/api/attachments/${res.body.id}`)
      .set('Authorization', `Bearer ${ctx.owner.token}`);
    expect(download.status).toBe(200);
    expect(download.text).toContain('hello from note.txt');
  });

  it('applies access and scope to issue uploads', async () => {
    const results = {
      viewer: (await upload(`Bearer ${viewer.token}`, { issueId })).status,
      readToken: (await upload(`Token ${tokens['issues:read']}`, { issueId })).status,
      wikiToken: (await upload(`Token ${tokens['wiki:write']}`, { issueId })).status,
      writeToken: (await upload(`Token ${tokens['issues:write']}`, { issueId })).status,
    };
    expect(results).toEqual({ viewer: 403, readToken: 403, wikiToken: 403, writeToken: 201 });
  });

  it('applies access and scope to wiki uploads', async () => {
    const results = {
      owner: (await upload(`Bearer ${ctx.owner.token}`, { pageId })).status,
      viewer: (await upload(`Bearer ${viewer.token}`, { pageId })).status,
      issuesToken: (await upload(`Token ${tokens['issues:write']}`, { pageId })).status,
      wikiToken: (await upload(`Token ${tokens['wiki:write']}`, { pageId })).status,
    };
    expect(results).toEqual({ owner: 201, viewer: 403, issuesToken: 403, wikiToken: 201 });
  });
});
