import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runAct } from '../../actions/batch';
import { prisma } from '../../config/database';
import app from '../../index';
import { encryptSecret, secretContext } from '../../lib/secret-box';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';

import { assertBranchName, assertRefName, branchNameFor } from './github-actions.helpers';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const WIDGET = 'acme-labs/widget';
const MAIN_SHA = 'a'.repeat(40);
const RELEASE_SHA = 'b'.repeat(40);
const fake = useGithubFake('repo');

let ctx: TestContext;
let member: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let unlinked: { id: string };
let key: string;
let issueId: string;
let linkId: string;
const ISSUE = 42;

const as = (user: TestUser) => ({ ...CSRF, Authorization: `Bearer ${user.token}` });
const url = (projectId: string, number = ISSUE) =>
  `/api/projects/${projectId}/issues/${number}/github/branches`;
const create = (user: TestUser, body: object = {}, projectId = ctx.projectId, number = ISSUE) =>
  request(app).post(url(projectId, number)).set(as(user)).send(body);
const gitCalls = () => fake.requests.filter((r) => r.path.includes('/git/'));

/**
 * Connects a user's GitHub account with a token for the widget repository.
 * @param user Who connects
 * @param opts What the token may do on GitHub
 * @param opts.push The repositories it may write (all it reaches when unset)
 * @param opts.admin The repositories the person administers
 */
async function connectAccount(user: TestUser, opts: { push?: string[]; admin?: string[] } = {}) {
  const id = `acct-${user.id}`;
  const token = fake.issueUserToken('octo-dev', [WIDGET], opts);
  await prisma.githubAccount.create({
    data: {
      id,
      userId: user.id,
      githubUserId: 9101,
      login: 'octo-dev',
      accessToken: encryptSecret(token, secretContext('githubAccount', 'accessToken', id)),
    },
  });
  return token;
}

beforeAll(async () => {
  ctx = await createTestContext('ghbr');
  key = `${ctx.projectPrefix}-${ISSUE}`;
  member = await addMemberToContext(ctx);
  viewer = await createTestUser();
  await prisma.orgMembership.create({
    data: { orgId: ctx.orgId, userId: viewer.id, role: 'VIEWER' },
  });
  await prisma.teamMembership.create({
    data: { teamId: ctx.teamId, userId: viewer.id, role: 'VIEWER' },
  });
  outsider = await createTestUser();
  unlinked = await prisma.project.create({
    data: { name: 'No link', slug: 'no-link-ghbr', prefix: 'NLK', teamId: ctx.teamId },
  });
  await prisma.issue.create({
    data: { projectId: unlinked.id, number: 1, title: 'Alone', body: '', creatorId: ctx.owner.id },
  });
  issueId = (
    await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: ISSUE,
        title: 'Fix login timeout!',
        body: '',
        creatorId: ctx.owner.id,
      },
    })
  ).id;
});

beforeEach(async () => {
  await seedGithubApp({ fake });
  fake.removeInstallation(3301);
  fake.addInstallation(3301, [WIDGET]);
  fake.setPublicRepos([]);
  fake.setGitRefs(WIDGET, {
    main: MAIN_SHA,
    'release/1.0': RELEASE_SHA,
    'release/v#1': RELEASE_SHA,
  });
  linkId = (
    await prisma.githubRepoLink.create({
      data: {
        projectId: ctx.projectId,
        repoId: 7301n,
        installationId: 3301n,
        owner: 'acme-labs',
        name: 'widget',
        fullName: WIDGET,
        defaultBranch: 'main',
        htmlUrl: `https://github.com/${WIDGET}`,
        linkedById: ctx.owner.id,
      },
    })
  ).id;
});

afterEach(async () => {
  await prisma.githubRepoLink.deleteMany();
  await prisma.githubAccount.deleteMany();
  await prisma.apiToken.deleteMany({ where: { userId: member.id } });
  await prisma.githubApp.deleteMany();
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: unlinked.id } });
  const ids = [member.id, viewer.id, outsider.id];
  await cleanupTestContext(ctx);
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe('branch names', () => {
  it('builds the default name from the key and the title', () => {
    expect(branchNameFor('AXM', 42, 'Fix login timeout!')).toBe('axm-42-fix-login-timeout');
    expect(branchNameFor('AXM', 7, '!!!')).toBe('axm-7');
    expect(branchNameFor('AXM', 7, 'Zażółć gęślą')).toMatch(/^axm-7-za/);
  });

  it('cuts a long title at a hyphen within 40 slug characters', () => {
    const title = 'Make the login screen remember the last used account after a timeout';
    const name = branchNameFor('AXM', 42, title);
    const slug = name.slice('axm-42-'.length);
    expect(slug).toBe('make-the-login-screen-remember-the-last');
    expect(slug.length).toBeLessThanOrEqual(40);
    // A word that ends exactly at 40 stays whole
    const exact = branchNameFor('AXM', 1, `${'a'.repeat(39)} b`);
    expect(exact).toBe(`axm-1-${'a'.repeat(39)}`);
    // No hyphen to cut at: cut hard
    expect(branchNameFor('AXM', 1, 'x'.repeat(60))).toBe(`axm-1-${'x'.repeat(40)}`);
  });

  it('names the issue in the default name, so the branch links', () => {
    for (const title of ['Fix login timeout!', 'x'.repeat(90), 'Ünïcode ✓ title']) {
      const name = branchNameFor('AXM', 42, title);
      expect(() => assertBranchName(name, 'AXM-42')).not.toThrow();
    }
  });

  it.each([
    ['..', 'AXM-42..x'],
    ['a space', 'AXM-42 x'],
    ['a leading -', '-AXM-42'],
    ['a trailing .lock', 'AXM-42.lock'],
    ['a part with .lock', 'AXM-42.lock/x'],
    ['a trailing /', 'AXM-42/'],
    ['a leading /', '/AXM-42'],
    ['an empty part', 'a//AXM-42'],
    ['~', 'AXM-42~1'],
    ['^', 'AXM-42^'],
    [':', 'AXM-42:x'],
    ['?', 'AXM-42?'],
    ['*', 'AXM-42*'],
    ['[', 'AXM-42['],
    ['a backslash', 'AXM-42\\x'],
    ['@{', 'AXM-42@{x}'],
    ['a leading dot in a part', 'a/.AXM-42'],
    ['a trailing dot', 'AXM-42.'],
    ['a control character', 'AXM-42\u0007'],
    ['a newline', 'AXM-42\nx'],
    ['201 characters', `AXM-42-${'x'.repeat(194)}`],
  ])('refuses a name with %s', (_what, name) => {
    expect(() => assertBranchName(name, 'AXM-42')).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_BRANCH_NAME' }),
    );
  });

  it('accepts a name of 200 characters that names the issue, in any case', () => {
    expect(() => assertBranchName(`feature/axm-42-${'x'.repeat(185)}`, 'AXM-42')).not.toThrow();
    expect(() => assertRefName('release/1.0')).not.toThrow();
  });

  it('refuses a name that does not name the issue, or only a longer key', () => {
    for (const name of ['fix-login', 'AXM-43-x', 'AXMX-42-x', 'AXM-420-x', 'AXM-42x']) {
      expect(() => assertBranchName(name, 'AXM-42')).toThrow(
        expect.objectContaining({ statusCode: 400, code: 'INVALID_BRANCH_NAME' }),
      );
    }
  });
});

describe('githubBranch.create', () => {
  it('creates the default branch as a member, with their own credential, and stores it', async () => {
    const token = await connectAccount(member, { push: [WIDGET] });
    const res = await create(member);
    const name = `${ctx.projectPrefix.toLowerCase()}-${ISSUE}-fix-login-timeout`;
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      name,
      url: `https://github.com/${WIDGET}/tree/${name}`,
      headSha: MAIN_SHA,
    });
    const calls = fake.requests.map((r) => `${r.method} ${r.path}`);
    expect(calls).toEqual([
      `GET /repos/${WIDGET}/git/ref/heads/main`,
      `POST /repos/${WIDGET}/git/refs`,
    ]);
    expect(fake.requests.every((r) => r.headers.authorization?.startsWith('user:'))).toBe(true);
    expect(fake.requests[1].body).toEqual({ ref: `refs/heads/${name}`, sha: MAIN_SHA });

    const branch = await prisma.githubBranch.findFirstOrThrow({ where: { name } });
    expect(branch).toMatchObject({ repoLinkId: linkId, headSha: MAIN_SHA, deletedAt: null });
    const links = await prisma.githubIssueLink.findMany({ where: { issueId } });
    expect(links).toEqual([
      expect.objectContaining({
        targetType: 'BRANCH',
        targetKey: branch.id,
        sources: ['BRANCH_NAME'],
      }),
    ]);

    // The issue shows it without another GitHub call
    const seen = fake.requests.length;
    const read = await request(app)
      .post('/api/read')
      .set(as(member))
      .send({ keys: [key], include: ['development'] });
    expect(read.status).toBe(200);
    expect(read.body.items[0].data.development.branches.items).toEqual([
      expect.objectContaining({ name, headSha: MAIN_SHA }),
    ]);
    expect(fake.requests.length).toBe(seen);

    // No credential in the answer, the audit rows or the stored rows
    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { userId: member.id } }));
    const haystack = [JSON.stringify(res.body), audits, JSON.stringify(branch)].join('\n');
    expect(haystack).not.toContain(token);
    expect(haystack).not.toContain(token.slice(4));
  });

  it('creates a named branch from another branch, with each path part encoded', async () => {
    await connectAccount(member);
    const name = `feature/${key.toLowerCase()}-search`;
    const res = await create(member, { name, from: 'release/v#1' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name,
      headSha: RELEASE_SHA,
      url: `https://github.com/${WIDGET}/tree/${name}`,
    });
    expect(fake.requests[0].path).toBe(`/repos/${WIDGET}/git/ref/heads/release/v%231`);
    expect(fake.requests[1].body).toEqual({ ref: `refs/heads/${name}`, sha: RELEASE_SHA });
  });

  it('refuses a name git refuses or that lacks the key, before any GitHub request', async () => {
    await connectAccount(member);
    for (const name of [
      `${key}..x`,
      `${key} x`,
      `-${key}`,
      `${key}.lock`,
      `${key}~1`,
      'no-key-here',
    ]) {
      const res = await create(member, { name });
      expect(res.status, name).toBe(400);
      expect(res.body.error.code).toBe('INVALID_BRANCH_NAME');
    }
    const bad = await create(member, { from: 'main..x' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_BRANCH_NAME');
    expect(fake.requests).toEqual([]);
    expect(await prisma.githubBranch.count()).toBe(0);
  });

  it('answers 403 for a viewer who is admin on GitHub, with no GitHub request', async () => {
    await connectAccount(viewer, { admin: [WIDGET] });
    const res = await create(viewer);
    expect(res.status).toBe(403);
    expect(fake.requests).toEqual([]);
    expect(await prisma.githubBranch.count()).toBe(0);
  });

  it('answers without a GitHub request for a stranger and for a wrong issue', async () => {
    await connectAccount(outsider);
    const stranger = await create(outsider);
    expect([403, 404]).toContain(stranger.status);
    await connectAccount(member).catch(() => undefined);
    const wrong = await create(member, {}, ctx.projectId, 999);
    expect(wrong.status).toBe(404);
    expect(fake.requests).toEqual([]);
  });

  it('answers 409 GITHUB_NOT_CONNECTED without an account, with no GitHub request', async () => {
    const res = await create(member);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_NOT_CONNECTED');
    expect(fake.requests).toEqual([]);
  });

  it('answers 409 GITHUB_NOT_LINKED for a project without a link', async () => {
    await connectAccount(ctx.owner);
    const res = await create(ctx.owner, {}, unlinked.id, 1);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'GITHUB_NOT_LINKED',
      message: 'This project has no linked GitHub repository',
    });
    expect(fake.requests).toEqual([]);
  });

  it('answers 409 GITHUB_BRANCH_EXISTS for a name that is taken, and stores nothing', async () => {
    await connectAccount(member);
    const name = `${key.toLowerCase()}-taken`;
    fake.setGitRefs(WIDGET, { main: MAIN_SHA, [name]: MAIN_SHA });
    const res = await create(member, { name });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_BRANCH_EXISTS');
    expect(await prisma.githubBranch.count()).toBe(0);
    expect(await prisma.githubIssueLink.count()).toBe(0);
  });

  it('answers 403 GITHUB_FORBIDDEN with GitHub refusing the push, and stores nothing', async () => {
    await connectAccount(member, { push: [] });
    const res = await create(member);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GITHUB_FORBIDDEN');
    expect(gitCalls().map((r) => r.method)).toEqual(['GET', 'POST']);
    expect(await prisma.githubBranch.count()).toBe(0);
  });

  it('answers 404 GITHUB_BASE_NOT_FOUND for a missing base branch, and creates nothing', async () => {
    await connectAccount(member);
    const res = await create(member, { from: 'gone' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GITHUB_BASE_NOT_FOUND');
    expect(fake.requests.map((r) => r.method)).toEqual(['GET']);
  });

  it('takes the issue from a key in act', async () => {
    await connectAccount(member);
    const out = (await runAct(
      { action: 'githubBranch.create', key, input: {} },
      { userId: member.id, channel: 'ui' },
    )) as unknown as { name: string };
    expect(out).toBeDefined();
    expect(JSON.stringify(out)).toContain(
      `${ctx.projectPrefix.toLowerCase()}-${ISSUE}-fix-login-timeout`,
    );
    expect(await prisma.githubBranch.count()).toBe(1);
  });

  it('runs for an API token with github:write without waiting for approval', async () => {
    await connectAccount(member);
    const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
    await prisma.apiToken.create({
      data: {
        userId: member.id,
        name: 'github-agent',
        scopes: ['github:write'],
        prefix: raw.slice(0, 11),
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
      },
    });
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(CSRF)
      .set('Authorization', `Token ${raw}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.headSha).toBe(MAIN_SHA);
  });

  it('is listed under github:write in token-reach.json', () => {
    const reach = JSON.parse(
      readFileSync(path.join(__dirname, '../../actions/token-reach.json'), 'utf8'),
    ) as Record<string, string[]>;
    expect(reach['githubBranch.create']).toEqual(['github:write']);
  });
});
