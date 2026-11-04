/**
 * Signed upload URLs, staged attachments, fetching from a URL and the multipart path. The signed
 * route carries no auth header, so every refusal here also checks that nothing was stored.
 */
import { randomBytes } from 'crypto';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { executeAction } from '../../actions/execute';
import { prisma } from '../../config/database';
import app from '../../index';
import { loggableUrl } from '../../lib/request-path';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { authGet, authPatch, authPost } from '../../test/helpers';
import { isBlockedAddress, publicLookup } from '../automation/webhook';

import {
  fetchRemoteFile,
  FROM_URL_LIMIT,
  MAX_CONCURRENT_FETCHES,
  MAX_CONCURRENT_FETCHES_PER_USER,
  type RemoteFetchDeps,
} from './remote-file';
import {
  attachFromUrl,
  bindStagedAttachments,
  cleanupExpiredUploads,
} from './upload-intents.service';

// Uploads go to a throwaway directory, never the repository
const storagePath = path.join(os.tmpdir(), `axiom-intent-test-${process.pid}`);
process.env.STORAGE_PATH = storagePath;

const MB = 1024 * 1024;
const MULTER_TEMP_DIR = '/tmp/uploads';

/**
 * Every file below a directory, to compare before and after a refused upload.
 * @param dir
 */
function filesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** What a refusal must leave as it found: stored files, temp files and attachment rows. */
async function storedState() {
  return {
    stored: filesIn(storagePath).sort(),
    temp: filesIn(MULTER_TEMP_DIR).sort(),
    rows: await prisma.attachment.count(),
  };
}

describe('upload intents', () => {
  let ctx: TestContext;
  let viewer: TestUser;
  let stranger: TestUser;
  let issueId: string;
  const issueNumber = 1;
  let spaceId: string;
  let pageId: string;
  const pageSlug = 'target';
  const issueTarget = () => ({ projectId: ctx.projectId, issueNumber });
  const file = { filename: 'note.txt', mimeType: 'text/plain', size: 64 };
  const content = Buffer.from('signed content');

  /**
   * Mint a token with exactly these scopes.
   * @param name
   * @param scopes
   */
  async function tokenWith(name: string, scopes: string[]) {
    const res = await authPost('/api/users/me/tokens', ctx.owner.token, { name, scopes });
    expect(res.status).toBe(201);
    return { header: `Token ${res.body.token}`, id: res.body.id as string };
  }

  const createUrl = (body: object, auth = `Bearer ${ctx.owner.token}`) =>
    request(app)
      .post('/api/attachments/upload-url')
      .set('Authorization', auth)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send(body);

  /**
   * PUT with nothing but the signed URL: no auth header, no CSRF header.
   * @param url
   * @param body
   * @param type
   */
  const put = (url: string, body: Buffer = content, type = 'text/plain') =>
    request(app).put(url).set('Content-Type', type).send(body);

  const ownerUrl = async (extra: object = {}) => {
    const res = await createUrl({ ...file, target: issueTarget(), ...extra });
    expect(res.status).toBe(201);
    return res.body as {
      uploadUrl: string;
      uploadId: string;
      expiresAt: string;
      attachmentUrl: string;
    };
  };

  const fromUrl = (url: string, extra: object = {}, auth = `Bearer ${ctx.owner.token}`) =>
    request(app)
      .post('/api/attachments/from-url')
      .set('Authorization', auth)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ url, ...extra });

  /**
   * A staged attachment of this user, through the real route.
   * @param user
   */
  async function stage(user: TestUser) {
    const created = await createUrl({ ...file }, `Bearer ${user.token}`);
    expect(created.status).toBe(201);
    const stored = await put(created.body.uploadUrl);
    expect(stored.status).toBe(201);
    return stored.body as { id: string; stagedAt: string | null };
  }

  beforeAll(async () => {
    ctx = await createTestContext(`intents${Date.now()}`);
    viewer = await addMemberToContext(ctx);
    await prisma.teamMembership.update({
      where: { userId_teamId: { userId: viewer.id, teamId: ctx.teamId } },
      data: { role: 'VIEWER' },
    });
    stranger = await createTestUser();
    issueId = (
      await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: issueNumber,
          title: 'I',
          body: '',
          creatorId: ctx.owner.id,
        },
      })
    ).id;
    spaceId = (
      await prisma.wikiSpace.create({
        data: { teamId: ctx.teamId, name: 'Up', slug: `intent-${Date.now()}` },
      })
    ).id;
    pageId = (await prisma.page.create({ data: { spaceId, title: 'P', slug: pageSlug, body: '' } }))
      .id;
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: { in: [viewer.id, stranger.id] } } });
    fs.rmSync(storagePath, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('signed URLs', () => {
    it('stores a file through a signed URL and attaches it to the target', async () => {
      const created = await ownerUrl();
      expect(created.uploadUrl).toMatch(/^\/api\/uploads\/[a-z0-9]+\?sig=[a-f0-9]{64}$/);
      const expiry = new Date(created.expiresAt).getTime() - Date.now();
      expect(expiry).toBeGreaterThan(9 * 60_000);
      expect(expiry).toBeLessThanOrEqual(10 * 60_000);

      const res = await put(created.uploadUrl);
      expect(res.status).toBe(201);
      expect(created.attachmentUrl).toBe(`/api/attachments/${res.body.id}`);
      expect(res.body).toMatchObject({
        issueId,
        pageId: null,
        stagedAt: null,
        originalName: 'note.txt',
        mimeType: 'text/plain',
        size: content.length,
        uploaderId: ctx.owner.id,
      });

      const read = await authGet(created.attachmentUrl, ctx.owner.token);
      expect(read.status).toBe(200);
      expect(read.text).toBe('signed content');
    });

    it('attaches to a page addressed by space and slug', async () => {
      const created = await ownerUrl({ target: { spaceId, pageSlug } });
      const res = await put(created.uploadUrl);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ pageId, issueId: null, stagedAt: null });
    });

    it('attributes the upload to the token that asked for the URL', async () => {
      const token = await tokenWith('uploader', ['files:write', 'issues:write']);
      const created = await createUrl({ ...file, target: issueTarget() }, token.header);
      expect(created.status).toBe(201);
      const res = await put(created.body.uploadUrl);
      expect(res.status).toBe(201);
      const activity = await prisma.activity.findFirst({
        where: { resourceId: issueId, action: 'attachment_added', apiTokenId: token.id },
      });
      expect(activity?.via).toBe('uploader');
    });

    it('audits the upload as the user, with the signature left out', async () => {
      const { uploadUrl, uploadId } = await ownerUrl();
      expect((await put(uploadUrl)).status).toBe(201);
      await vi.waitFor(async () => {
        const entry = await prisma.auditLog.findFirst({
          where: { userId: ctx.owner.id, resource: `attachment:${uploadId}` },
        });
        expect(entry?.action).toBe('update');
        expect(JSON.stringify(entry?.details)).not.toContain('sig');
      });
    });

    it('stages a file without a target for its owner only', async () => {
      const staged = await stage(ctx.owner);
      expect(staged.stagedAt).not.toBeNull();
      expect((await authGet(`/api/attachments/${staged.id}`, ctx.owner.token)).status).toBe(200);
      expect((await authGet(`/api/attachments/${staged.id}`, stranger.token)).status).toBe(403);
    });

    it('refuses a reused upload URL', async () => {
      const { uploadUrl } = await ownerUrl();
      expect((await put(uploadUrl)).status).toBe(201);
      const before = await storedState();
      expect((await put(uploadUrl)).status).toBe(403);
      expect(await storedState()).toEqual(before);
    });

    it('lets only one of two racing uses through', async () => {
      const { uploadUrl } = await ownerUrl();
      const [a, b] = await Promise.all([put(uploadUrl), put(uploadUrl)]);
      expect([a.status, b.status].sort()).toEqual([201, 403]);
    });

    it('refuses an expired upload URL', async () => {
      const { uploadUrl } = await ownerUrl();
      const before = await storedState();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 10 * 60_000 + 1000);
      expect((await put(uploadUrl)).status).toBe(403);
      vi.useRealTimers();
      expect(await storedState()).toEqual(before);
    });

    it('refuses an expiry moved in the database, which the signature covers', async () => {
      const { uploadUrl, uploadId } = await ownerUrl();
      await prisma.uploadIntent.update({
        where: { id: uploadId },
        data: { expiresAt: new Date(Date.now() + 60 * 60_000) },
      });
      expect((await put(uploadUrl)).status).toBe(403);
    });

    it('refuses a tampered signature', async () => {
      const { uploadUrl } = await ownerUrl();
      const flipped = uploadUrl.endsWith('0') ? '1' : '0';
      const before = await storedState();
      expect((await put(uploadUrl.slice(0, -1) + flipped)).status).toBe(403);
      expect((await put(uploadUrl.split('?')[0])).status).toBe(403);
      expect((await put(uploadUrl.split('?')[0] + '?sig=short')).status).toBe(403);
      expect((await put(`${uploadUrl}&sig=again`)).status).toBe(403);
      expect(await storedState()).toEqual(before);
      // The refusals did not use it up
      expect((await put(uploadUrl)).status).toBe(201);
    });

    it('answers the same for a bad signature, an expired URL and an unknown id', async () => {
      const bad = await ownerUrl();
      const expired = await ownerUrl();
      const badSig = await put(`${bad.uploadUrl.split('?')[0]}?sig=${'0'.repeat(64)}`);
      const unknown = await put(`/api/uploads/doesnotexist?sig=${'0'.repeat(64)}`);
      const nul = await put(`/api/uploads/a%00b?sig=${'0'.repeat(64)}`);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 11 * 60_000);
      const late = await put(expired.uploadUrl);
      vi.useRealTimers();
      for (const res of [unknown, nul, late]) {
        expect(res.status).toBe(badSig.status);
        expect(res.body).toEqual(badSig.body);
      }
      expect(badSig.status).toBe(403);
    });

    it('refuses a body over 25 MB', async () => {
      expect((await createUrl({ ...file, size: 25 * MB + 1 })).status).toBe(413);
      const { uploadUrl } = await ownerUrl({ size: 25 * MB });
      const before = await storedState();
      const res = await put(uploadUrl, Buffer.alloc(25 * MB + 1));
      expect(res.status).toBe(413);
      expect(await storedState()).toEqual(before);
    }, 30000);

    it('refuses a body over the declared size, and it does not use up the URL', async () => {
      const { uploadUrl } = await ownerUrl({ size: 4 });
      expect((await put(uploadUrl, Buffer.from('12345'))).status).toBe(413);
      expect((await put(uploadUrl, Buffer.from('1234'))).status).toBe(201);
    });

    it('stores a body at exactly the limit', async () => {
      const { uploadUrl } = await ownerUrl({ size: 25 * MB });
      const res = await put(uploadUrl, Buffer.alloc(25 * MB, 1));
      expect(res.status).toBe(201);
      expect(res.body.size).toBe(25 * MB);
    }, 30000);

    it('refuses a compressed body rather than inflate it past the limit', async () => {
      const { uploadUrl } = await ownerUrl();
      const res = await put(uploadUrl).set('Content-Encoding', 'gzip');
      expect(res.status).toBe(415);
    });

    it('refuses an empty body', async () => {
      const { uploadUrl } = await ownerUrl();
      const res = await put(uploadUrl, Buffer.alloc(0));
      expect(res.status).toBe(400);
    });

    it('refuses a disallowed MIME type', async () => {
      for (const mimeType of ['text/html', 'application/x-msdownload', 'image/png\r\nX-Evil: 1']) {
        const res = await createUrl({ ...file, mimeType });
        expect(res.status).toBe(415);
      }
      const { uploadUrl } = await ownerUrl();
      // The signed type holds: another Content-Type is refused and leaves the URL usable
      expect((await put(uploadUrl, content, 'text/html')).status).toBe(415);
      expect((await put(uploadUrl, content, 'application/json')).status).toBe(415);
      const res = await put(uploadUrl);
      expect(res.status).toBe(201);
      expect(res.body.mimeType).toBe('text/plain');
    });

    it('takes the longest name it allows, with a long extension', async () => {
      const { uploadUrl } = await ownerUrl({ filename: `a.${'x'.repeat(253)}` });
      expect((await put(uploadUrl)).status).toBe(201);
    });

    it('keeps only the base name of the filename', async () => {
      const { uploadUrl } = await ownerUrl({ filename: '../../etc/pass.wd' });
      const res = await put(uploadUrl);
      expect(res.status).toBe(201);
      expect(res.body.originalName).toBe('pass.wd');
      expect(res.body.storageKey).toMatch(/^attachments\/\d{4}\/\d{2}\/[a-z0-9]+\.wd$/);
      expect((await createUrl({ ...file, filename: '../' })).status).toBe(400);
    });

    it('re-checks edit access at upload time', async () => {
      const member = await addMemberToContext(ctx);
      const created = await createUrl({ ...file, target: issueTarget() }, `Bearer ${member.token}`);
      expect(created.status).toBe(201);
      await prisma.teamMembership.delete({
        where: { userId_teamId: { userId: member.id, teamId: ctx.teamId } },
      });
      const before = await storedState();
      expect((await put(created.body.uploadUrl)).status).toBe(403);
      expect(await storedState()).toEqual(before);
      await prisma.user.delete({ where: { id: member.id } });
    });

    it('refuses a URL once the token that asked for it is revoked or lost its scope', async () => {
      const revoked = await tokenWith('revoked', ['files:write', 'issues:write']);
      const created = await createUrl({ ...file, target: issueTarget() }, revoked.header);
      expect(created.status).toBe(201);
      await prisma.apiToken.delete({ where: { id: revoked.id } });
      expect((await put(created.body.uploadUrl)).status).toBe(403);

      const narrowed = await tokenWith('narrowed', ['files:write', 'issues:write']);
      const second = await createUrl({ ...file, target: issueTarget() }, narrowed.header);
      expect(second.status).toBe(201);
      await prisma.apiToken.update({
        where: { id: narrowed.id },
        data: { scopes: ['files:write'] },
      });
      expect((await put(second.body.uploadUrl)).status).toBe(403);

      const expired = await tokenWith('expired', ['files:write']);
      const third = await createUrl({ ...file }, expired.header);
      expect(third.status).toBe(201);
      await prisma.apiToken.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await put(third.body.uploadUrl)).status).toBe(403);
    });

    it('refuses a URL of a user who was deactivated', async () => {
      const user = await createTestUser();
      const created = await createUrl({ ...file }, `Bearer ${user.token}`);
      expect(created.status).toBe(201);
      await prisma.user.update({ where: { id: user.id }, data: { deactivatedAt: new Date() } });
      expect((await put(created.body.uploadUrl)).status).toBe(403);
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('lifts the CSRF guard for this exact route only', async () => {
      const uploads = [
        request(app).post('/api/uploads/x?sig=a'),
        request(app).patch('/api/uploads/x?sig=a'),
        request(app).delete('/api/uploads/x?sig=a'),
        request(app).put('/api/uploads/x/more?sig=a'),
        request(app).put('/api/uploads?sig=a'),
      ];
      for (const req of uploads) {
        const res = await req;
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('CSRF_HEADER_MISSING');
      }
    });

    it('reads the raw body whatever the JSON parser would make of it', async () => {
      const { uploadUrl } = await ownerUrl({ mimeType: 'text/plain', size: 6 * MB });
      const res = await put(uploadUrl, Buffer.alloc(6 * MB, 65));
      expect(res.status).toBe(201);
      expect(res.body.size).toBe(6 * MB);
    });

    it('checks access before it hands out a URL', async () => {
      const target = issueTarget();
      expect((await createUrl({ ...file, target }, `Bearer ${viewer.token}`)).status).toBe(403);
      expect((await createUrl({ ...file, target }, `Bearer ${stranger.token}`)).status).toBe(403);
      const page = { spaceId, pageSlug };
      expect((await createUrl({ ...file, target: page }, `Bearer ${viewer.token}`)).status).toBe(
        403,
      );
      const missing = { ...target, issueNumber: 9999 };
      expect((await createUrl({ ...file, target: missing })).status).toBe(404);
      const noPage = { spaceId, pageSlug: 'no-such-page' };
      expect((await createUrl({ ...file, target: noPage })).status).toBe(404);
    });

    it('takes one kind of target', async () => {
      const both = { ...issueTarget(), spaceId, pageSlug };
      const idAndKey = { ...issueTarget(), issueKey: 'A-1' };
      const bothKeys = { issueKey: 'A-1', pageKey: 'a/b/c/d' };
      for (const target of [{}, both, idAndKey, bothKeys, { projectId: ctx.projectId }]) {
        expect((await createUrl({ ...file, target })).status).toBe(400);
      }
    });

    it('needs files:write and the area of the parent (R1)', async () => {
      const filesOnly = await tokenWith('filesOnly', ['files:write']);
      const issuesOnly = await tokenWith('issuesOnly', ['issues:write']);
      const wikiToken = await tokenWith('wikiToken', ['files:write', 'wiki:write']);
      const readOnly = await tokenWith('readOnly', ['files:read', 'issues:read']);
      const target = issueTarget();
      const status = async (header: string, body: object) =>
        (await createUrl({ ...file, ...body }, header)).status;
      expect({
        filesOnly: await status(filesOnly.header, { target }),
        issuesOnly: await status(issuesOnly.header, { target }),
        wikiOnIssue: await status(wikiToken.header, { target }),
        readOnly: await status(readOnly.header, { target }),
        wikiOnPage: await status(wikiToken.header, { target: { spaceId, pageSlug } }),
        filesOnPage: await status(filesOnly.header, { target: { spaceId, pageSlug } }),
        stagedWithFiles: await status(filesOnly.header, {}),
        stagedWithoutFiles: await status(issuesOnly.header, {}),
      }).toEqual({
        filesOnly: 403,
        issuesOnly: 403,
        wikiOnIssue: 403,
        readOnly: 403,
        wikiOnPage: 201,
        filesOnPage: 403,
        stagedWithFiles: 201,
        stagedWithoutFiles: 403,
      });
    });

    it('runs createUploadUrl over MCP, and refuses the raw upload there', async () => {
      const mcp = {
        userId: ctx.owner.id,
        scopes: ['files:write', 'issues:write'],
        channel: 'mcp' as const,
        apiTokenId: (await tokenWith('mcp', ['files:write', 'issues:write'])).id,
        apiTokenName: 'mcp',
      };
      const result = (await executeAction(
        'attachment.createUploadUrl',
        { ...file, target: issueTarget() },
        mcp,
      )) as { uploadUrl: string };
      expect((await put(result.uploadUrl)).status).toBe(201);
      await expect(executeAction('attachment.upload', {}, mcp)).rejects.toMatchObject({
        statusCode: 400,
        code: 'RAW_ACTION',
      });
    });

    it('keeps the whole query of a signed upload out of the logs', () => {
      const logged = (originalUrl: string) => loggableUrl({ originalUrl } as never);
      expect(logged('/api/uploads/abc?x=1&sig=secret')).toBe('/api/uploads/abc');
      expect(logged('/api/uploads/abc?%73ig=secret')).toBe('/api/uploads/abc');
      expect(logged('/API/Uploads/abc?sig=secret')).toBe('/API/Uploads/abc');
      expect(logged('/api/issues?a=1')).toBe('/api/issues?a=1');
    });

    it('accepts no other spelling of the signature in the audit trail', async () => {
      const { uploadUrl, uploadId } = await ownerUrl();
      const sig = uploadUrl.split('sig=')[1];
      expect((await put(`/api/uploads/${uploadId}?%73ig=${sig}`)).status).toBe(201);
      await vi.waitFor(async () => {
        const entry = await prisma.auditLog.findFirst({
          where: { resource: `attachment:${uploadId}` },
        });
        expect(JSON.stringify(entry?.details)).toContain(`/api/uploads/${uploadId}`);
        expect(JSON.stringify(entry?.details)).not.toContain(sig);
      });
    });

    it('answers 400 for a malformed escape in the id', async () => {
      const res = await put(`/api/uploads/%E0%A4%A?sig=x`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('staged attachments', () => {
    const reference = (id: string) => `![image](/api/attachments/${id})`;

    const newPage = async (slug: string) =>
      prisma.page.create({ data: { spaceId, title: slug, slug, body: '' } });

    const updatePage = (slug: string, body: string) =>
      authPatch(`/api/wiki/spaces/${spaceId}/pages/${slug}`, ctx.owner.token, { body });

    const attachmentRow = (id: string) => prisma.attachment.findUniqueOrThrow({ where: { id } });

    it('binds a staged image when a page body references it', async () => {
      const staged = await stage(ctx.owner);
      const res = await updatePage(pageSlug, `Before ${reference(staged.id)} after`);
      expect(res.status).toBe(200);
      expect(await attachmentRow(staged.id)).toMatchObject({ pageId, stagedAt: null });
      // Access now follows the page
      expect((await authGet(`/api/attachments/${staged.id}`, viewer.token)).status).toBe(200);
      expect((await authGet(`/api/attachments/${staged.id}`, stranger.token)).status).toBe(403);
    });

    it('binds a staged image when a new page is created with the reference', async () => {
      // The editor has no page yet while it creates one: the upload is staged
      const staged = await stage(ctx.owner);
      const slug = `new-page-${Date.now()}`;
      const created = await authPost(`/api/wiki/spaces/${spaceId}/pages`, ctx.owner.token, {
        title: slug,
        slug,
        body: `New ${reference(staged.id)}`,
      });
      expect(created.status).toBe(201);
      expect(await attachmentRow(staged.id)).toMatchObject({
        pageId: created.body.id,
        stagedAt: null,
      });
    });

    it("does not bind another user's staged attachment", async () => {
      const staged = await stage(stranger);
      const res = await updatePage(pageSlug, reference(staged.id));
      expect(res.status).toBe(200);
      expect(await attachmentRow(staged.id)).toMatchObject({
        pageId: null,
        issueId: null,
        stagedAt: expect.any(Date),
      });
      expect((await authGet(`/api/attachments/${staged.id}`, ctx.owner.token)).status).toBe(403);
    });

    it('binds when an issue is created or its body changes', async () => {
      const first = await stage(ctx.owner);
      const created = await authPost(`/api/projects/${ctx.projectId}/issues`, ctx.owner.token, {
        title: 'With image',
        body: reference(first.id),
      });
      expect(created.status).toBe(201);
      expect(await attachmentRow(first.id)).toMatchObject({
        issueId: created.body.id,
        stagedAt: null,
      });

      const second = await stage(ctx.owner);
      const updated = await authPatch(
        `/api/projects/${ctx.projectId}/issues/${created.body.number}`,
        ctx.owner.token,
        { body: reference(second.id) },
      );
      expect(updated.status).toBe(200);
      expect(await attachmentRow(second.id)).toMatchObject({
        issueId: created.body.id,
        stagedAt: null,
      });
    });

    it('binds when a comment is added or edited', async () => {
      const first = await stage(ctx.owner);
      const project = `/api/projects/${ctx.projectId}`;
      const comments = `${project}/issues/${issueNumber}/comments`;
      const added = await authPost(comments, ctx.owner.token, { body: reference(first.id) });
      expect(added.status).toBe(201);
      expect(await attachmentRow(first.id)).toMatchObject({ issueId, stagedAt: null });

      const second = await stage(ctx.owner);
      const edited = await authPatch(`${project}/comments/${added.body.id}`, ctx.owner.token, {
        body: reference(second.id),
      });
      expect(edited.status).toBe(200);
      expect(await attachmentRow(second.id)).toMatchObject({ issueId, stagedAt: null });
    });

    it('binds when a page is created with the reference', async () => {
      const staged = await stage(ctx.owner);
      const res = await authPost(`/api/wiki/spaces/${spaceId}/pages`, ctx.owner.token, {
        title: 'Created',
        slug: `created-${randomBytes(4).toString('hex')}`,
        body: reference(staged.id),
      });
      expect(res.status).toBe(201);
      expect(await attachmentRow(staged.id)).toMatchObject({
        pageId: res.body.id,
        stagedAt: null,
      });
    });

    it('does not move an attachment that is already bound', async () => {
      const staged = await stage(ctx.owner);
      const first = await newPage(`first-${randomBytes(4).toString('hex')}`);
      const second = await newPage(`second-${randomBytes(4).toString('hex')}`);
      await updatePage(first.slug, reference(staged.id));
      await updatePage(second.slug, reference(staged.id));
      expect(await attachmentRow(staged.id)).toMatchObject({ pageId: first.id, stagedAt: null });
    });

    it('stages a multipart upload without a parent, and binds it the same way', async () => {
      const multipart = await request(app)
        .post('/api/attachments')
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .attach('file', Buffer.from('plain'), 'plain.txt');
      expect(multipart.status).toBe(201);
      expect(multipart.body.stagedAt).not.toBeNull();
      await bindStagedAttachments(reference(multipart.body.id), { pageId }, ctx.owner.id);
      expect(await attachmentRow(multipart.body.id)).toMatchObject({ pageId, stagedAt: null });
    });

    it('ignores a body with no reference', async () => {
      const staged = await stage(ctx.owner);
      await bindStagedAttachments('no images here', { pageId }, ctx.owner.id);
      await bindStagedAttachments(reference(staged.id), {}, ctx.owner.id);
      expect((await attachmentRow(staged.id)).stagedAt).not.toBeNull();
    });

    it('cleans up expired intents and staged files older than a day', async () => {
      const old = await stage(ctx.owner);
      const recent = await stage(ctx.owner);
      const bound = await stage(ctx.owner);
      await updatePage(pageSlug, reference(bound.id));
      const longAgo = new Date(Date.now() - 25 * 60 * 60_000);
      await prisma.attachment.updateMany({
        where: { id: { in: [old.id, bound.id] } },
        data: { createdAt: longAgo },
      });
      await prisma.attachment.update({ where: { id: old.id }, data: { stagedAt: longAgo } });
      const oldKey = (await attachmentRow(old.id)).storageKey;
      const oldFile = path.join(storagePath, oldKey);
      expect(fs.existsSync(oldFile)).toBe(true);

      const live = await ownerUrl();
      const lapsed = await ownerUrl();
      await prisma.uploadIntent.update({
        where: { id: lapsed.uploadId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await cleanupExpiredUploads();

      expect(await prisma.attachment.findUnique({ where: { id: old.id } })).toBeNull();
      expect(fs.existsSync(oldFile)).toBe(false);
      expect((await attachmentRow(recent.id)).stagedAt).not.toBeNull();
      expect((await attachmentRow(bound.id)).pageId).toBe(pageId);
      const left = await prisma.uploadIntent.findMany({
        where: { id: { in: [live.uploadId, lapsed.uploadId] } },
        select: { id: true },
      });
      expect(left).toEqual([{ id: live.uploadId }]);
    });

    it('goes on after a file it could not delete, and leaves bound rows alone', async () => {
      const longAgo = new Date(Date.now() - 25 * 60 * 60_000);
      const stuck = await stage(ctx.owner);
      const next = await stage(ctx.owner);
      const parented = await stage(ctx.owner);
      // A directory where the file should be: unlink throws
      fs.mkdirSync(path.join(storagePath, 'a-directory'), { recursive: true });
      await prisma.attachment.update({
        where: { id: stuck.id },
        data: { storageKey: 'a-directory', stagedAt: longAgo },
      });
      await prisma.attachment.update({ where: { id: next.id }, data: { stagedAt: longAgo } });
      // Not a state the code writes: the guard must hold even so
      await prisma.attachment.update({
        where: { id: parented.id },
        data: { stagedAt: longAgo, pageId },
      });

      await expect(cleanupExpiredUploads()).resolves.toBeUndefined();

      const removed = (id: string) => prisma.attachment.findUnique({ where: { id } });
      expect(await removed(stuck.id)).toBeNull();
      expect(await removed(next.id)).toBeNull();
      expect(await removed(parented.id)).not.toBeNull();
    });
  });

  describe('fromUrl', () => {
    it('fromUrl refuses private addresses', async () => {
      const before = await storedState();
      // More than one user may fetch in a minute
      const users = [await createTestUser(), await createTestUser()];
      for (const [i, url] of [
        'http://127.0.0.1/x',
        'https://127.0.0.1/x',
        'https://2130706433/x',
        'https://10.0.0.1/x',
        'https://169.254.169.254/latest/meta-data',
        'https://100.64.0.1/x',
        'https://[::1]/x',
        'https://[::ffff:7f00:1]/x',
        'https://[fd00::1]/x',
        'https://localhost/x',
        'https://user:pass@example.com/x',
        'not a url',
        'file:///etc/passwd',
      ].entries()) {
        const res = await fromUrl(url, {}, `Bearer ${users[i % 2].token}`);
        expect({ url, status: res.status }).toEqual({ url, status: 400 });
      }
      expect(await storedState()).toEqual(before);
      await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    });

    it('stores what it fetched, on the target or staged', async () => {
      const server = http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.end('fetched');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const deps: Partial<RemoteFetchDeps> = {
        checkUrl: async () => {},
        open: (url, { signal }) =>
          new Promise((resolve, reject) => {
            http.get(url, { signal, agent: false }, resolve).on('error', reject);
          }),
      };
      const onIssue = await attachFromUrl(
        ctx.owner.id,
        { url: `${base}/dir/a%20b.txt`, target: issueTarget() },
        deps,
      );
      expect(onIssue).toMatchObject({ issueId, stagedAt: null, originalName: 'a b.txt' });
      const staged = await attachFromUrl(
        ctx.owner.id,
        { url: `${base}/`, filename: 'given.txt' },
        deps,
      );
      expect(staged).toMatchObject({ issueId: null, originalName: 'given.txt', size: 7 });
      expect(staged.stagedAt).not.toBeNull();
      const unnamed = await attachFromUrl(ctx.owner.id, { url: `${base}/` }, deps);
      expect(unnamed.originalName).toBe('download');
      server.closeAllConnections();
      server.close();
    });

    it('needs files:write and the area of the parent (R1)', async () => {
      const filesOnly = await tokenWith('fromFiles', ['files:write']);
      const res = await fromUrl(
        'https://example.com/a.png',
        { target: issueTarget() },
        filesOnly.header,
      );
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');
      const viewerRes = await fromUrl(
        'https://example.com/a.png',
        { target: issueTarget() },
        `Bearer ${viewer.token}`,
      );
      expect(viewerRes.status).toBe(403);
    });

    describe('fetching', () => {
      let server: http.Server;
      let base: string;
      let hits: string[] = [];

      beforeAll(async () => {
        server = http.createServer((req, res) => {
          hits.push(req.url ?? '');
          if (req.url === '/file.png') {
            res.setHeader('Content-Type', 'image/png; charset=binary');
            res.end('png bytes');
          } else if (req.url === '/to-file') {
            res.writeHead(302, { Location: '/file.png' }).end();
          } else if (req.url === '/to-private') {
            res.writeHead(302, { Location: 'https://127.0.0.1/secret' }).end();
          } else if (req.url === '/to-http') {
            res.writeHead(302, { Location: 'http://example.com/x' }).end();
          } else if (req.url === '/loop') {
            res.writeHead(302, { Location: '/loop' }).end();
          } else if (req.url === '/html') {
            res.setHeader('Content-Type', 'text/html');
            res.end('<script>');
          } else if (req.url === '/no-type') {
            res.end('bytes');
          } else if (req.url === '/empty') {
            res.setHeader('Content-Type', 'text/plain');
            res.end();
          } else if (req.url === '/huge-declared') {
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Content-Length', String(25 * MB + 1));
            res.flushHeaders();
          } else if (req.url === '/huge-stream') {
            // No Content-Length: only counting while reading catches this
            res.setHeader('Content-Type', 'image/png');
            const chunk = Buffer.alloc(MB);
            const pump = () => {
              while (!res.destroyed && res.write(chunk));
              if (!res.destroyed) res.once('drain', pump);
            };
            pump();
          } else if (req.url === '/hang') {
            res.setHeader('Content-Type', 'image/png');
            res.write('start');
          } else if (req.url === '/missing') {
            res.writeHead(404).end();
          } else {
            res.writeHead(500).end();
          }
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      });

      afterAll(() => {
        server.closeAllConnections();
        server.close();
      });

      // The test server is local, so the real guard would refuse it: everything on it passes and
      // anything else meets the guard as usual
      const deps: Partial<RemoteFetchDeps> = {
        checkUrl: async (url) => {
          if (url.startsWith(base)) return;
          const { assertPublicUrl } = await import('../automation/webhook');
          await assertPublicUrl(url, 'Attachment');
        },
        open: (url, { signal }) =>
          new Promise((resolve, reject) => {
            http.get(url, { signal, agent: false }, resolve).on('error', reject);
          }),
      };
      const fetchPath = (p: string, extra: Partial<RemoteFetchDeps> = {}) => {
        hits = [];
        return fetchRemoteFile(`${base}${p}`, { ...deps, ...extra });
      };

      it('returns the bytes and the bare type, following a redirect', async () => {
        const result = await fetchPath('/to-file');
        expect(fs.readFileSync(result.path, 'utf8')).toBe('png bytes');
        expect(result.mimeType).toBe('image/png');
        expect(result.size).toBe(9);
        fs.unlinkSync(result.path);
        expect(hits).toEqual(['/to-file', '/file.png']);
      });

      it('checks every redirect against the guard', async () => {
        await expect(fetchPath('/to-private')).rejects.toMatchObject({ statusCode: 400 });
        expect(hits).toEqual(['/to-private']);
        await expect(fetchPath('/to-http')).rejects.toMatchObject({ statusCode: 400 });
      });

      it('gives up on a redirect loop', async () => {
        await expect(fetchPath('/loop')).rejects.toMatchObject({ statusCode: 400 });
        expect(hits.length).toBeLessThanOrEqual(6);
      });

      it('applies the MIME allowlist to what the server sends', async () => {
        await expect(fetchPath('/html')).rejects.toMatchObject({ statusCode: 415 });
        await expect(fetchPath('/no-type')).rejects.toMatchObject({
          statusCode: 415,
          message: 'The URL did not name a file type',
        });
      });

      it('caps the size, by the header and while reading', async () => {
        await expect(fetchPath('/huge-declared')).rejects.toMatchObject({ statusCode: 413 });
        const before = filesIn(MULTER_TEMP_DIR);
        await expect(fetchPath('/huge-stream')).rejects.toMatchObject({ statusCode: 413 });
        expect(filesIn(MULTER_TEMP_DIR)).toEqual(before);
      }, 30000);

      it('times out on a server that stops sending', async () => {
        const before = filesIn(MULTER_TEMP_DIR);
        await expect(fetchPath('/hang', { timeoutMs: 200 })).rejects.toMatchObject({
          statusCode: 502,
        });
        expect(filesIn(MULTER_TEMP_DIR)).toEqual(before);
      });

      it('refuses an empty file, as a signed upload does', async () => {
        const before = filesIn(MULTER_TEMP_DIR);
        await expect(fetchPath('/empty')).rejects.toMatchObject({ statusCode: 400 });
        expect(filesIn(MULTER_TEMP_DIR)).toEqual(before);
      });

      it('caps the fetches running at once, per user and in total', async () => {
        const users = [await createTestUser(), await createTestUser(), await createTestUser()];
        const hang = (userId: string) =>
          attachFromUrl(userId, { url: `${base}/hang` }, { ...deps, timeoutMs: 500 }).catch(
            (err: unknown) => err,
          );
        const quick = (userId: string) => attachFromUrl(userId, { url: `${base}/file.png` }, deps);
        hits = [];
        const running = [
          ...Array.from({ length: MAX_CONCURRENT_FETCHES_PER_USER }, () => hang(users[0].id)),
        ];
        await vi.waitFor(() => expect(hits.length).toBe(MAX_CONCURRENT_FETCHES_PER_USER));
        // One user can't hold every slot, and being refused costs nothing: more refusals than
        // the limit allows calls, and the user's next call still works
        for (let i = 0; i <= FROM_URL_LIMIT.max; i++) {
          await expect(quick(users[0].id)).rejects.toMatchObject({ statusCode: 429 });
        }
        running.push(hang(users[1].id), hang(users[1].id));
        await vi.waitFor(() => expect(hits.length).toBe(MAX_CONCURRENT_FETCHES));
        await expect(quick(users[2].id)).rejects.toMatchObject({ statusCode: 429 });

        await Promise.all(running);
        const after = await quick(users[0].id);
        expect(after.mimeType).toBe('image/png');
        await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
      });

      it('refuses an answer that is not a success', async () => {
        await expect(fetchPath('/missing')).rejects.toMatchObject({ statusCode: 400 });
      });
    });

    it('connects through the pinned lookup, whatever checkUrl let through', async () => {
      await expect(
        fetchRemoteFile('https://localhost:1/x', { checkUrl: async () => {} }),
      ).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('private') });
    });

    it('holds a user to the fetch limit', async () => {
      const user = await createTestUser();
      const statuses: number[] = [];
      for (let i = 0; i <= FROM_URL_LIMIT.max; i++) {
        statuses.push((await fromUrl('https://127.0.0.1/x', {}, `Bearer ${user.token}`)).status);
      }
      expect(statuses.slice(0, -1).every((status) => status === 400)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
      // Another user is not affected
      expect((await fromUrl('https://127.0.0.1/x')).status).toBe(400);
      await prisma.user.delete({ where: { id: user.id } });
    });

    it('pins the connection to an address it checked', async () => {
      const lookup = (hostname: string, all: boolean) =>
        new Promise<unknown>((resolve, reject) => {
          publicLookup(hostname, { all }, (err, address) => (err ? reject(err) : resolve(address)));
        });
      await expect(lookup('localhost', true)).rejects.toMatchObject({
        code: 'ERR_BLOCKED_ADDRESS',
      });
      await expect(lookup('localhost', false)).rejects.toMatchObject({
        code: 'ERR_BLOCKED_ADDRESS',
      });
    });

    it.each([
      ['0.0.0.0', true],
      ['10.1.2.3', true],
      ['100.64.0.1', true],
      ['127.0.0.1', true],
      ['169.254.169.254', true],
      ['172.16.0.1', true],
      ['192.168.1.1', true],
      ['198.18.0.1', true],
      ['224.0.0.1', true],
      ['255.255.255.255', true],
      ['::', true],
      ['::1', true],
      ['::127.0.0.1', true],
      ['::7f00:1', true],
      ['::a9fe:a9fe', true],
      ['64:ff9b:1::7f00:1', true],
      ['100::1', true],
      ['::ffff:127.0.0.1', true],
      ['::ffff:7f00:1', true],
      ['::ffff:8.8.8.8', true],
      ['64:ff9b::7f00:1', true],
      ['fe80::1', true],
      ['fd00::1', true],
      ['ff02::1', true],
      ['not-an-ip', true],
      ['8.8.8.8', false],
      ['172.32.0.1', false],
      ['2606:4700:4700::1111', false],
    ])('classifies %s as blocked: %s', (address, blocked) => {
      expect(isBlockedAddress(address)).toBe(blocked);
    });
  });

  describe('multipart upload', () => {
    const upload = (auth: string, parent: Record<string, string>, data?: Buffer, type?: string) => {
      let req = request(app)
        .post('/api/attachments')
        .set('Authorization', auth)
        .set('X-Requested-With', 'XMLHttpRequest');
      for (const [k, v] of Object.entries(parent)) req = req.field(k, v);
      return req.attach('file', data ?? Buffer.from('x'), {
        filename: 'n.txt',
        contentType: type ?? 'text/plain',
      });
    };

    it('stores nothing for a caller refused after the body is parsed', async () => {
      const filesOnly = await tokenWith('multiFiles', ['files:write']);
      const before = await storedState();
      const byScope = await upload(filesOnly.header, { issueId });
      expect(byScope.status).toBe(403);
      expect(byScope.body.error.code).toBe('SCOPE');
      expect((await upload(`Bearer ${viewer.token}`, { issueId })).status).toBe(403);
      expect((await upload(`Bearer ${ctx.owner.token}`, { issueId: 'missing' })).status).toBe(404);
      expect(await storedState()).toEqual(before);
    });

    it('stores nothing for a bad upload', async () => {
      const owner = `Bearer ${ctx.owner.token}`;
      const before = await storedState();
      expect((await upload(owner, {}, Buffer.from('x'), 'text/html')).status).toBe(415);
      expect((await upload(owner, {}, Buffer.alloc(25 * MB + 1))).status).toBe(413);
      // A parent that can't be meant: repeated, or empty
      const repeated = request(app)
        .post('/api/attachments')
        .set('Authorization', owner)
        .set('X-Requested-With', 'XMLHttpRequest')
        .field('issueId', issueId)
        .field('issueId', issueId)
        .attach('file', Buffer.from('x'), 'n.txt');
      expect((await repeated).status).toBe(400);
      expect((await upload(owner, { issueId: '' })).status).toBe(400);
      // The comment must belong to the issue
      expect((await upload(owner, { issueId, commentId: 'missing' })).status).toBe(400);
      expect(await storedState()).toEqual(before);
    }, 30000);

    it('answers 400 without a file', async () => {
      const res = await request(app)
        .post('/api/attachments')
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ issueId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('MISSING_FILE');
    });
  });

  describe('downloads', () => {
    it('keeps the response headers of a download', async () => {
      const { uploadUrl } = await ownerUrl({
        filename: 'a b.svg',
        mimeType: 'image/svg+xml',
      });
      const stored = await put(uploadUrl, Buffer.from('<svg/>'), 'image/svg+xml');
      expect(stored.status).toBe(201);
      const res = await authGet(`/api/attachments/${stored.body.id}`, ctx.owner.token);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('image/svg+xml');
      expect(res.headers['content-disposition']).toBe('inline; filename="a%20b.svg"');
      expect(res.headers['content-security-policy']).toContain("script-src 'self'");
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    it('redirects the preview of an image to its download', async () => {
      const { uploadUrl } = await ownerUrl({ filename: 'a.png', mimeType: 'image/png' });
      const stored = await put(uploadUrl, Buffer.from('png'), 'image/png');
      const res = await authGet(`/api/attachments/${stored.body.id}/preview`, ctx.owner.token);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/api/attachments/${stored.body.id}`);
    });
  });
});
