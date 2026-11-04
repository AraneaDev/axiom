/**
 * item.read and the key forms, over REST against the real database.
 */
import crypto from 'crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../config/database';
import { checkProjectAccess } from '../middleware/requireProjectAccess';
import { logActivity } from '../modules/activity/activity.service';
import { createPage } from '../modules/wiki/wiki.service';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../test/factory';
import { authPost } from '../test/helpers';

import { executeAction } from './execute';
import { MAX_KEY_LENGTH, resolveKey } from './keys';

/** Keys that may never appear anywhere in a response */
const FORBIDDEN_KEY = /email|storagekey|tokenhash|passwordhash|sharedsecret|^secret$/i;

/**
 * Every object key in a JSON value that must not be there, with its path.
 * @param value - The parsed JSON
 * @param path - Where this value sits
 */
function forbiddenKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, v]) => [
    ...(FORBIDDEN_KEY.test(key) ? [`${path}.${key}`] : []),
    ...forbiddenKeys(v, `${path}.${key}`),
  ]);
}

const ALL_ISSUE_INCLUDES = [
  'comments',
  'links',
  'webLinks',
  'attachments',
  'history',
  'worklogs',
  'children',
  'pages',
];
const ALL_PAGE_INCLUDES = [
  'children',
  'attachments',
  'history',
  'labels',
  'linkedIssues',
  'comments',
];

describe('item.read', () => {
  let ctx: TestContext;
  let other: TestContext;
  let member: TestUser;
  let viewer: TestUser;
  let orgAdmin: TestUser;
  let stranger: TestUser;
  const extraUsers: string[] = [];

  let prefix: string;
  let issueKey: string;
  let issueId: string;
  let foreignIssueId: string;
  let spaceId: string;
  let spaceSlug: string;

  let mainPageKey: string;
  let hiddenPageSlug: string;

  const readAs = (user: TestUser, body: object) => authPost('/api/read', user.token, body);

  /**
   * Mint a real API token for a user.
   * @param user - The owner
   * @param scopes - Its scopes
   */
  async function tokenWith(user: TestUser, scopes: string[]): Promise<string> {
    const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
    await prisma.apiToken.create({
      data: {
        userId: user.id,
        name: 'read-test',
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        prefix: raw.slice(0, 11),
        scopes,
      },
    });
    return raw;
  }

  /**
   * POST /api/read with an API token.
   * @param raw - The raw token
   * @param body - The input
   */
  async function readWithToken(raw: string, body: object) {
    const { default: request } = await import('supertest');
    const { default: app } = await import('../index');
    return request(app)
      .post('/api/read')
      .set('Authorization', `Token ${raw}`)
      .set('X-Requested-With', 'XMLHttpRequest')
      .send(body);
  }

  /**
   * Make an issue directly.
   * @param number - Its number
   * @param extra - Other columns
   */
  async function makeIssue(number: number, extra: object = {}) {
    return prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number,
        title: `Issue ${number}`,
        body: `Body ${number}`,
        creatorId: ctx.owner.id,
        ...extra,
      },
    });
  }

  beforeAll(async () => {
    ctx = await createTestContext(`read${crypto.randomBytes(4).toString('hex')}`);
    other = await createTestContext(`rdo${crypto.randomBytes(4).toString('hex')}`);
    member = await addMemberToContext(ctx);
    viewer = await createTestUser();
    orgAdmin = await createTestUser();
    stranger = await createTestUser();
    extraUsers.push(member.id, viewer.id, orgAdmin.id, stranger.id);
    await prisma.orgMembership.createMany({
      data: [
        { orgId: ctx.orgId, userId: viewer.id, role: 'GUEST' },
        { orgId: ctx.orgId, userId: orgAdmin.id, role: 'ADMIN' },
      ],
    });
    await prisma.teamMembership.create({
      data: { teamId: ctx.teamId, userId: viewer.id, role: 'VIEWER' },
    });

    prefix = ctx.projectPrefix;
    const column = await prisma.boardColumn.findFirst({ where: { projectId: ctx.projectId } });
    const label = await prisma.label.create({
      data: { projectId: ctx.projectId, name: 'bug' },
    });

    const parent = await makeIssue(40);
    const main = await makeIssue(42, {
      assigneeId: member.id,
      columnId: column?.id,
      parentId: parent.id,
      labels: { connect: { id: label.id } },
    });
    issueId = main.id;
    issueKey = `${prefix}-42`;
    await makeIssue(4);

    await prisma.comment.create({
      data: { issueId, authorId: member.id, body: 'A comment' },
    });
    const linked = await makeIssue(43);
    await prisma.issueLink.create({ data: { fromId: issueId, toId: linked.id, type: 'BLOCKS' } });
    await prisma.issueWebLink.create({
      data: { issueId, url: 'https://example.com/x', title: 'Spec', createdById: ctx.owner.id },
    });
    await prisma.attachment.create({
      data: {
        filename: 'stored.txt',
        originalName: 'notes.txt',
        mimeType: 'text/plain',
        size: 5,
        storageKey: 'secret/stored.txt',
        uploaderId: member.id,
        issueId,
      },
    });
    await logActivity('issue', issueId, 'time_logged', member.id, {
      minutes: 5,
      reporterEmail: 'leak@example.com',
    });
    await prisma.timeEntry.create({
      data: { issueId, userId: member.id, minutes: 15, description: 'Work' },
    });
    await makeIssue(44, { parentId: issueId });

    // A link and a child into an org the reader has nothing to do with
    const foreign = await prisma.issue.create({
      data: {
        projectId: other.projectId,
        number: 1,
        title: 'Foreign secret',
        body: '',
        creatorId: other.owner.id,
      },
    });
    foreignIssueId = foreign.id;
    await prisma.issueLink.create({
      data: { fromId: issueId, toId: foreign.id, type: 'RELATES_TO' },
    });
    await prisma.issue.create({
      data: {
        projectId: other.projectId,
        number: 2,
        title: 'Foreign child',
        body: '',
        creatorId: other.owner.id,
        parentId: issueId,
      },
    });

    spaceSlug = 'read-space';
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Read', slug: spaceSlug },
    });
    spaceId = space.id;

    // Written through the service, so it holds a mention row
    const mainPage = await createPage(spaceId, ctx.owner.id, {
      title: 'Main',
      slug: 'main',
      body: `About ${issueKey}.`,
    });
    mainPageKey = `${ctx.orgSlug}/${ctx.teamSlug}/${spaceSlug}/main`;
    await prisma.wikiPageIssueLink.create({
      data: { pageId: mainPage.id, issueId, linkType: 'EMBED', createdById: ctx.owner.id },
    });
    await prisma.wikiPageIssueLink.create({
      data: {
        pageId: mainPage.id,
        issueId: foreignIssueId,
        linkType: 'EMBED',
        createdById: other.owner.id,
      },
    });
    await prisma.pageLabel.create({ data: { pageId: mainPage.id, label: 'design' } });
    await prisma.pageComment.create({
      data: { pageId: mainPage.id, userId: member.id, body: 'Page comment' },
    });
    await prisma.attachment.create({
      data: {
        filename: 'p.txt',
        originalName: 'page.txt',
        mimeType: 'text/plain',
        size: 5,
        storageKey: 'secret/p.txt',
        uploaderId: member.id,
        pageId: mainPage.id,
      },
    });

    // No mention row, as after a save from the collaborative editor
    await prisma.page.create({
      data: {
        spaceId,
        title: 'Saved by the editor',
        slug: 'collab',
        body: `Text ${issueKey}, done`,
        parentId: mainPage.id,
      },
    });
    await prisma.page.create({
      data: { spaceId, title: 'Nearby number', slug: 'nearby', body: `Only ${prefix}-420` },
    });

    hiddenPageSlug = 'hidden';
    const hidden = await prisma.page.create({
      data: {
        spaceId,
        title: 'Restricted secret',
        slug: hiddenPageSlug,
        body: `Secret about ${issueKey}`,
        parentId: mainPage.id,
      },
    });
    await prisma.pageRestriction.create({
      data: { pageId: hidden.id, type: 'VIEW', userId: ctx.owner.id },
    });
    await prisma.pageComment.create({
      data: { pageId: hidden.id, userId: ctx.owner.id, body: 'Hidden comment' },
    });
    await prisma.wikiPageIssueLink.create({
      data: { pageId: hidden.id, issueId, linkType: 'MENTION', createdById: ctx.owner.id },
    });
  });

  afterAll(async () => {
    await cleanupTestContext(ctx);
    await cleanupTestContext(other);
    await prisma.user.deleteMany({ where: { id: { in: extraUsers } } });
  });

  it('reads an issue with every include in one call', async () => {
    const res = await readAs(member, { keys: [issueKey], include: ALL_ISSUE_INCLUDES });
    expect(res.status).toBe(200);
    const [item] = res.body.items;
    expect(item).toMatchObject({ key: issueKey, kind: 'issue' });
    const data = item.data;
    expect(data).toMatchObject({
      id: issueId,
      key: issueKey,
      fullKey: `${ctx.orgSlug}/${ctx.teamSlug}/${issueKey}`,
      title: 'Issue 42',
      assignee: { id: member.id, displayName: member.username },
      labels: [expect.objectContaining({ name: 'bug' })],
      parent: expect.objectContaining({ key: `${prefix}-40` }),
    });
    expect(typeof data.status).toBe('string');

    expect(data.comments.items).toEqual([
      expect.objectContaining({
        body: 'A comment',
        author: { id: member.id, displayName: member.username },
      }),
    ]);
    expect(data.links.items).toEqual([
      expect.objectContaining({
        type: 'BLOCKS',
        direction: 'outward',
        issue: expect.objectContaining({ key: `${prefix}-43` }),
      }),
    ]);
    expect(data.webLinks.items).toEqual([
      expect.objectContaining({ url: 'https://example.com/x', title: 'Spec' }),
    ]);
    expect(data.attachments.items).toEqual([
      expect.objectContaining({ name: 'notes.txt', mimeType: 'text/plain', size: 5 }),
    ]);
    expect(data.history.items).toEqual([expect.objectContaining({ action: 'time_logged' })]);
    expect(data.worklogs.items).toEqual([
      expect.objectContaining({ minutes: 15, description: 'Work' }),
    ]);
    expect(data.children.items).toEqual([expect.objectContaining({ key: `${prefix}-44` })]);
    expect(data.pages.items.map((p: { slug: string }) => p.slug).sort()).toEqual([
      'collab',
      'main',
    ]);
    for (const name of ALL_ISSUE_INCLUDES) {
      expect(data[name]).toMatchObject({ truncated: false, limit: expect.any(Number) });
    }
  });

  it('reads a page with every include in one call', async () => {
    const res = await readAs(member, { keys: [mainPageKey], include: ALL_PAGE_INCLUDES });
    expect(res.status).toBe(200);
    const [item] = res.body.items;
    expect(item).toMatchObject({ key: mainPageKey, kind: 'page' });
    const data = item.data;
    expect(data).toMatchObject({
      key: mainPageKey,
      title: 'Main',
      slug: 'main',
      space: { id: spaceId, slug: spaceSlug, name: 'Read' },
      version: 1,
    });
    expect(data.children.items.map((c: { slug: string }) => c.slug)).toEqual(['collab']);
    expect(data.attachments.items).toEqual([expect.objectContaining({ name: 'page.txt' })]);
    expect(data.history.items).toEqual([expect.objectContaining({ version: 1 })]);
    expect(data.history.items[0]).not.toHaveProperty('body');
    expect(data.labels.items).toEqual(['design']);
    expect(data.linkedIssues.items).toEqual([
      expect.objectContaining({
        issue: expect.objectContaining({ key: issueKey }),
        linkTypes: expect.arrayContaining(['EMBED', 'MENTION']),
      }),
    ]);
    expect(data.comments.items).toEqual([expect.objectContaining({ body: 'Page comment' })]);
  });

  it('returns the base item only without an include, and fields narrow it', async () => {
    const base = await readAs(member, { keys: [issueKey] });
    expect(base.body.items[0].data).not.toHaveProperty('comments');
    expect(base.body.items[0].data).toHaveProperty('body', 'Body 42');

    const narrow = await readAs(member, {
      keys: [issueKey, mainPageKey],
      fields: ['title', 'status'],
      include: ['comments'],
    });
    expect(Object.keys(narrow.body.items[0].data).sort()).toEqual(
      ['comments', 'id', 'key', 'status', 'title'].sort(),
    );
    expect(Object.keys(narrow.body.items[1].data).sort()).toEqual(
      ['comments', 'id', 'key', 'title'].sort(),
    );

    const unknown = await readAs(member, { keys: [issueKey], fields: ['passwordHash'] });
    expect(unknown.status).toBe(400);
  });

  it('answers each key on its own and keeps the order', async () => {
    const res = await readAs(member, { keys: [`${prefix}-9999`, issueKey, 'not a key'] });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([
      {
        key: `${prefix}-9999`,
        error: expect.objectContaining({ status: 404, code: 'NOT_FOUND' }),
      },
      expect.objectContaining({ key: issueKey, kind: 'issue' }),
      { key: 'not a key', error: expect.objectContaining({ status: 400, code: 'INVALID_KEY' }) },
    ]);
  });

  describe('ambiguous keys', () => {
    const number = 1;
    let shared: string;
    let secondTeamId: string;

    beforeAll(async () => {
      shared = `Q${crypto.randomBytes(3).toString('hex').toUpperCase().replace(/\d/g, 'K')}`;
      const secondTeam = await prisma.team.create({
        data: { orgId: ctx.orgId, name: 'Second', slug: 'read-second' },
      });
      secondTeamId = secondTeam.id;
      const hiddenTeam = await prisma.team.create({
        data: { orgId: ctx.orgId, name: 'Hidden', slug: 'read-hidden' },
      });
      await prisma.teamMembership.create({
        data: { teamId: secondTeam.id, userId: member.id, role: 'MEMBER' },
      });
      await prisma.project.createMany({
        data: [
          { teamId: ctx.teamId, name: 'A', slug: 'read-shared-a', prefix: shared },
          { teamId: secondTeam.id, name: 'B', slug: 'read-shared-b', prefix: shared },
          { teamId: hiddenTeam.id, name: 'C', slug: 'read-shared-c', prefix: shared },
        ],
      });
    });

    it('returns 409 AMBIGUOUS_KEY with candidates when two visible teams share the prefix', async () => {
      const res = await readAs(member, { keys: [`${shared}-${number}`] });
      const { error } = res.body.items[0];
      expect(error).toMatchObject({ status: 409, code: 'AMBIGUOUS_KEY' });
      expect(error.details.candidates.sort()).toEqual(
        [
          `${ctx.orgSlug}/read-second/${shared}-${number}`,
          `${ctx.orgSlug}/${ctx.teamSlug}/${shared}-${number}`,
        ].sort(),
      );
    });

    it('counts only visible projects, so a hidden one neither shows up nor blurs the key', async () => {
      // On one of the three teams, and the org admin is on none
      const onOne = await readAs(viewer, { keys: [`${shared}-${number}`] });
      expect(onOne.body.items[0].error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      const onNone = await readAs(orgAdmin, { keys: [`${shared}-${number}`] });
      expect(onNone.body.items[0].error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });

    it('resolves the full form to one project', async () => {
      const project = await prisma.project.findFirstOrThrow({
        where: { prefix: shared, teamId: secondTeamId },
      });
      await prisma.issue.create({
        data: { projectId: project.id, number, title: 'B1', body: '', creatorId: member.id },
      });
      const res = await readAs(member, {
        keys: [`${ctx.orgSlug}/read-second/${shared}-${number}`],
      });
      expect(res.body.items[0].data).toMatchObject({ title: 'B1' });
    });

    it('answers ambiguity from resolveKey with the candidates in details', async () => {
      await expect(resolveKey(`${shared}-${number}`, member.id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'AMBIGUOUS_KEY',
        details: { candidates: expect.any(Array) },
      });
    });
  });

  describe('access', () => {
    it('returns 404 for an issue the user cannot see', async () => {
      const hidden = await readAs(stranger, { keys: [issueKey] });
      const missing = await readAs(member, { keys: [`${prefix}-99999`] });
      expect(hidden.status).toBe(200);
      const hiddenError = hidden.body.items[0].error;
      const missingError = missing.body.items[0].error;
      expect(hiddenError).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      // The full forms name it exactly: still the same answer as nothing there
      const full = await readAs(stranger, {
        keys: [`${ctx.orgSlug}/${ctx.teamSlug}/${issueKey}`],
      });
      expect(full.body.items[0].error).toEqual(hiddenError);
      expect(hiddenError).toEqual(missingError);
      expect(await checkProjectAccess(stranger.id, ctx.projectId)).toBe('forbidden');
    });

    it('answers a restricted page like a page that does not exist', async () => {
      const key = `${ctx.orgSlug}/${ctx.teamSlug}/${spaceSlug}/${hiddenPageSlug}`;
      const hidden = await readAs(member, { keys: [key], include: ['comments'] });
      const missing = await readAs(member, {
        keys: [`${ctx.orgSlug}/${ctx.teamSlug}/${spaceSlug}/nothing`],
      });
      expect(hidden.body.items[0].error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
      expect(hidden.body.items[0].error).toEqual(missing.body.items[0].error);
      expect(JSON.stringify(hidden.body)).not.toContain('Hidden comment');

      const owner = await readAs(ctx.owner, { keys: [key], include: ['comments'] });
      expect(owner.body.items[0].data.comments.items).toEqual([
        expect.objectContaining({ body: 'Hidden comment' }),
      ]);
    });

    it('lets the team role win over the org role, and keeps the wiki with the team', async () => {
      // Org GUEST with a team role reads what the team holds
      const guest = await readAs(viewer, { keys: [issueKey, mainPageKey] });
      expect(guest.body.items.map((i: { kind?: string }) => i.kind)).toEqual(['issue', 'page']);
      // Org ADMIN off the team: the wiki opens, the project does not
      const admin = await readAs(orgAdmin, { keys: [issueKey, mainPageKey] });
      expect(admin.body.items[0].error).toMatchObject({ status: 404 });
      expect(admin.body.items[1].kind).toBe('page');
      // Someone in another org: neither
      const outsider = await readAs(other.owner, { keys: [issueKey, mainPageKey] });
      expect(outsider.body.items.map((i: { error: { status: number } }) => i.error.status)).toEqual(
        [404, 404],
      );
    });

    it('lists only pages the user can view under pages', async () => {
      const res = await readAs(member, { keys: [issueKey], include: ['pages'] });
      const slugs = res.body.items[0].data.pages.items.map((p: { slug: string }) => p.slug);
      expect(slugs).not.toContain(hiddenPageSlug);
      expect(JSON.stringify(res.body)).not.toContain('Restricted secret');

      // Who may view it does get it, from the row as well as from the body
      const owner = await readAs(ctx.owner, { keys: [issueKey], include: ['pages'] });
      const ownerSlugs = owner.body.items[0].data.pages.items.map((p: { slug: string }) => p.slug);
      expect(ownerSlugs).toContain(hiddenPageSlug);
    });

    it('hides restricted pages from children, except from org admins', async () => {
      const res = await readAs(member, { keys: [mainPageKey], include: ['children'] });
      expect(JSON.stringify(res.body)).not.toContain('Restricted secret');
      const admin = await readAs(orgAdmin, { keys: [mainPageKey], include: ['children'] });
      expect(admin.body.items[0].data.children.items.map((c: { slug: string }) => c.slug)).toEqual(
        expect.arrayContaining(['collab', hiddenPageSlug]),
      );
    });

    it('leaves out linked issues and children across orgs', async () => {
      const res = await readAs(member, {
        keys: [issueKey, mainPageKey],
        include: ['links', 'children', 'linkedIssues'],
      });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Foreign secret');
      expect(text).not.toContain('Foreign child');
      expect(text).not.toContain(foreignIssueId);
    });

    it('does not show a parent in a project the reader cannot open', async () => {
      const child = await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: 70,
          title: 'Child of foreign',
          body: '',
          creatorId: ctx.owner.id,
          parentId: foreignIssueId,
        },
      });
      const res = await readAs(member, { keys: [`${prefix}-70`] });
      expect(res.body.items[0].data.parent).toBeNull();
      await prisma.issue.delete({ where: { id: child.id } });
    });
  });

  describe('mentions', () => {
    it('does not let AXM-4 match a page that only mentions AXM-42 or AXM-420', async () => {
      const res = await readAs(member, { keys: [`${prefix}-4`], include: ['pages'] });
      expect(res.body.items[0].data.pages.items).toEqual([]);
    });

    it('finds a mention only in the issue org', async () => {
      const space = await prisma.wikiSpace.create({
        data: { teamId: other.teamId, name: 'Other', slug: 'read-other' },
      });
      await prisma.orgMembership.create({
        data: { orgId: other.orgId, userId: member.id, role: 'ADMIN' },
      });
      await prisma.page.create({
        data: { spaceId: space.id, title: 'Elsewhere', slug: 'elsewhere', body: `See ${issueKey}` },
      });
      const res = await readAs(member, { keys: [issueKey], include: ['pages'] });
      await prisma.orgMembership.delete({
        where: { userId_orgId: { userId: member.id, orgId: other.orgId } },
      });
      expect(JSON.stringify(res.body)).not.toContain('Elsewhere');
    });

    it('stops at 20 pages and says so', async () => {
      const issue = await makeIssue(80);
      const key = `${prefix}-80`;
      await prisma.page.createMany({
        data: Array.from({ length: 12 }, (_, i) => ({
          spaceId,
          title: `Body ${i}`,
          slug: `body-${i}`,
          body: `Mentions ${key}`,
        })),
      });
      const rowPages = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          prisma.page.create({
            data: { spaceId, title: `Row ${i}`, slug: `row-${i}`, body: 'Linked only' },
          }),
        ),
      );
      await prisma.wikiPageIssueLink.createMany({
        data: rowPages.flatMap((page) =>
          (['EMBED', 'MENTION'] as const).map((linkType) => ({
            pageId: page.id,
            issueId: issue.id,
            linkType,
            createdById: ctx.owner.id,
          })),
        ),
      });
      const res = await readAs(member, { keys: [key], include: ['pages'] });
      const { pages } = res.body.items[0].data;
      expect(pages).toMatchObject({ limit: 20, truncated: true });
      expect(pages.items).toHaveLength(20);
      expect(new Set(pages.items.map((p: { id: string }) => p.id)).size).toBe(20);
      await prisma.page.deleteMany({
        where: {
          spaceId,
          OR: [{ slug: { startsWith: 'body-' } }, { slug: { startsWith: 'row-' } }],
        },
      });
    });
  });

  describe('key forms', () => {
    it('accepts a full issue URL and a page URL as keys', async () => {
      const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
      const keys = [
        `https://axiom.example/${ctx.orgSlug}/${ctx.teamSlug}/${project.slug}/issues/42`,
        `/${ctx.orgSlug}/${ctx.teamSlug}/${project.slug}/issues/42?tab=comments#c1`,
        `https://elsewhere.example/${ctx.orgSlug}/${ctx.teamSlug}/wiki/${spaceSlug}/main`,
        `/${ctx.orgSlug}/${ctx.teamSlug}/wiki/${spaceSlug}/main/`,
      ];
      const res = await readAs(member, { keys });
      expect(
        res.body.items.map((i: { data?: { id: string; title: string } }) => i.data?.title),
      ).toEqual(['Issue 42', 'Issue 42', 'Main', 'Main']);
    });

    it.each([
      ['another scheme', 'ftp://axiom.example/a/b/c/issues/1'],
      ['a site-relative other path', '/api/projects/x/issues'],
      ['a protocol-relative URL', '//evil.example/a/b/issues/1'],
      ['a control character', 'a/b/c/d\u0000'],
      ['two segments', 'a/b'],
      ['a lowercase prefix', 'axm-42'],
      ['a bare word', 'AXM'],
    ])('refuses %s without touching anything', async (_name, key) => {
      const res = await readAs(member, { keys: [key] });
      expect(res.body.items[0].error).toMatchObject({ status: 400, code: 'INVALID_KEY' });
    });

    it('answers a number beyond the column like a missing issue', async () => {
      const res = await readAs(member, { keys: [`${prefix}-99999999999999999999`] });
      expect(res.body.items[0].error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    });

    it('refuses an overlong key, too many keys and no keys', async () => {
      const long = 'a'.repeat(MAX_KEY_LENGTH + 1);
      expect((await readAs(member, { keys: [long] })).status).toBe(400);
      expect((await readAs(member, { keys: [] })).status).toBe(400);
      expect(
        (await readAs(member, { keys: Array.from({ length: 51 }, (_, i) => `${prefix}-${i}`) }))
          .status,
      ).toBe(400);
      expect((await readAs(member, {})).status).toBe(400);
    });

    it('reads 50 keys, repeated ones once', async () => {
      const keys = Array.from({ length: 50 }, (_, i) => `${prefix}-${i % 2 ? 42 : 40}`);
      const res = await readAs(member, { keys, include: ALL_ISSUE_INCLUDES });
      expect(res.status).toBe(200);
      expect(res.body.items.map((i: { key: string }) => i.key)).toEqual([
        `${prefix}-40`,
        `${prefix}-42`,
      ]);
    });
  });

  describe('caps', () => {
    it('keeps the newest comments and flags the cut', async () => {
      const issue = await makeIssue(81);
      const start = Date.now();
      await prisma.comment.createMany({
        data: Array.from({ length: 101 }, (_, i) => ({
          issueId: issue.id,
          authorId: member.id,
          body: `c${i}`,
          createdAt: new Date(start + i * 1000),
        })),
      });
      const res = await readAs(member, { keys: [`${prefix}-81`], include: ['comments'] });
      const { comments } = res.body.items[0].data;
      expect(comments).toMatchObject({ limit: 100, truncated: true });
      expect(comments.items).toHaveLength(100);
      expect(comments.items[0].body).toBe('c1');
      expect(comments.items[99].body).toBe('c100');
    });
  });

  it('never includes an email field anywhere in the response', async () => {
    const res = await readAs(ctx.owner, {
      keys: [issueKey, mainPageKey, `${prefix}-40`],
      include: [...ALL_ISSUE_INCLUDES, ...ALL_PAGE_INCLUDES],
    });
    expect(res.status).toBe(200);
    expect(res.body.items.every((i: { data?: object }) => i.data)).toBe(true);
    expect(forbiddenKeys(res.body)).toEqual([]);
    const text = JSON.stringify(res.body);
    for (const user of [ctx.owner, member]) expect(text).not.toContain(user.email);
    expect(text).not.toContain('leak@example.com');
    expect(text).not.toContain('secret/');
    expect(text).not.toContain('passwordHash');
  });

  describe('token scopes', () => {
    const pick = (res: { body: { items: Array<{ error?: { code: string } }> } }) =>
      res.body.items.map((i) => i.error?.code ?? 'ok');

    it('needs search:read to call at all', async () => {
      const raw = await tokenWith(member, ['issues:read', 'wiki:read']);
      const res = await readWithToken(raw, { keys: [issueKey] });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');
    });

    it('refuses per item, whether the item exists or not', async () => {
      const onlySearch = await tokenWith(member, ['search:read']);
      const none = await readWithToken(onlySearch, {
        keys: [issueKey, `${prefix}-99999`, mainPageKey],
      });
      expect(none.status).toBe(200);
      expect(pick(none)).toEqual(['SCOPE', 'SCOPE', 'SCOPE']);
      expect(none.body.items[0].error.status).toBe(403);

      const issuesOnly = await tokenWith(member, ['search:read', 'issues:read']);
      expect(pick(await readWithToken(issuesOnly, { keys: [issueKey, mainPageKey] }))).toEqual([
        'ok',
        'SCOPE',
      ]);

      const wikiOnly = await tokenWith(member, ['search:read', 'wiki:read']);
      expect(pick(await readWithToken(wikiOnly, { keys: [issueKey, mainPageKey] }))).toEqual([
        'SCOPE',
        'ok',
      ]);
    });

    it('holds back includes of an area the token does not cover, and says which', async () => {
      const issuesOnly = await tokenWith(member, ['search:read', 'issues:read']);
      const res = await readWithToken(issuesOnly, {
        keys: [issueKey],
        include: ['comments', 'pages', 'attachments'],
      });
      const { data } = res.body.items[0];
      expect(data.comments.items).toHaveLength(1);
      expect(data).not.toHaveProperty('pages');
      expect(data).not.toHaveProperty('attachments');
      expect(data.omittedIncludes.sort()).toEqual(['attachments', 'pages']);

      const wikiOnly = await tokenWith(member, ['search:read', 'wiki:read', 'files:read']);
      const page = await readWithToken(wikiOnly, {
        keys: [mainPageKey],
        include: ['linkedIssues', 'attachments'],
      });
      expect(page.body.items[0].data).not.toHaveProperty('linkedIssues');
      expect(page.body.items[0].data.attachments.items).toHaveLength(1);
      expect(page.body.items[0].data.omittedIncludes).toEqual(['linkedIssues']);
    });

    it('holds a token to its owner, and runs over MCP the same', async () => {
      const raw = await tokenWith(stranger, ['search:read', 'issues:read', 'wiki:read']);
      expect(pick(await readWithToken(raw, { keys: [issueKey, mainPageKey] }))).toEqual([
        'NOT_FOUND',
        'NOT_FOUND',
      ]);

      const mcp = {
        userId: member.id,
        scopes: ['search:read', 'issues:read'],
        channel: 'mcp' as const,
        apiTokenId: 'mcp-test',
        apiTokenName: 'mcp',
      };
      const result = (await executeAction('item.read', { keys: [issueKey, mainPageKey] }, mcp)) as {
        items: Array<{ error?: { code: string } }>;
      };
      expect(pick({ body: result })).toEqual(['ok', 'SCOPE']);
    });
  });

  describe('attachment targets by key', () => {
    const file = { filename: 'a.txt', mimeType: 'text/plain', size: 5 };
    const uploadUrl = (user: TestUser, target: object) =>
      authPost('/api/attachments/upload-url', user.token, { ...file, target });

    it('takes an issue key and a page key, and lands on that parent', async () => {
      const issue = await uploadUrl(member, { issueKey });
      expect(issue.status).toBe(201);
      const issueIntent = await prisma.uploadIntent.findUniqueOrThrow({
        where: { id: issue.body.uploadId },
      });
      expect(issueIntent.target).toEqual({ issueId });

      const page = await uploadUrl(member, { pageKey: mainPageKey });
      expect(page.status).toBe(201);
      const pageRow = await prisma.page.findFirstOrThrow({ where: { spaceId, slug: 'main' } });
      const pageIntent = await prisma.uploadIntent.findUniqueOrThrow({
        where: { id: page.body.uploadId },
      });
      expect(pageIntent.target).toEqual({ pageId: pageRow.id });
    });

    it('gives the role refusal of the id form, and 404 to who cannot see the key', async () => {
      const byId = await authPost('/api/attachments/upload-url', viewer.token, {
        ...file,
        target: { projectId: ctx.projectId, issueNumber: 42 },
      });
      const byKey = await uploadUrl(viewer, { issueKey });
      expect(byKey.status).toBe(byId.status);
      expect(byKey.status).toBe(403);

      expect((await uploadUrl(stranger, { issueKey })).status).toBe(404);
      expect((await uploadUrl(member, { issueKey: `${prefix}-99999` })).status).toBe(404);
      expect(
        (await uploadUrl(member, { pageKey: `${mainPageKey.replace('main', hiddenPageSlug)}` }))
          .status,
      ).toBe(404);
    });

    it('refuses a key of the other kind, and both at once', async () => {
      expect((await uploadUrl(member, { issueKey: mainPageKey })).status).toBe(400);
      expect((await uploadUrl(member, { pageKey: issueKey })).status).toBe(400);
      expect((await uploadUrl(member, { issueKey, pageKey: mainPageKey })).status).toBe(400);
    });

    it('checks the parent scope before the key', async () => {
      const raw = await tokenWith(member, ['files:write']);
      const { default: request } = await import('supertest');
      const { default: app } = await import('../index');
      const res = await request(app)
        .post('/api/attachments/upload-url')
        .set('Authorization', `Token ${raw}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ ...file, target: { issueKey: `${prefix}-99999` } });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('SCOPE');
    });

    it('fromUrl takes the key forms too', async () => {
      const res = await authPost('/api/attachments/from-url', stranger.token, {
        url: 'https://127.0.0.1/x',
        target: { issueKey },
      });
      expect(res.status).toBe(404);
      const refused = await authPost('/api/attachments/from-url', member.token, {
        url: 'https://127.0.0.1/x',
        target: { issueKey },
      });
      // Past authorize, to the URL guard
      expect(refused.status).toBe(400);
    });
  });
});
