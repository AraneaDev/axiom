import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { logger } from '../../utils/logger';

import {
  onGithubOutcome,
  storePullRequest,
  type GithubEventOutcome,
  type PullRequestPayload,
} from './github-events';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const WIDGET = 'acme-labs/widget';
const MAIN_SHA = 'a'.repeat(40);
const fake = useGithubFake('repo');

let ctx: TestContext;
let member: TestUser;
let viewer: TestUser;
let reviewer: TestUser;
let strayReviewer: TestUser;
let outsideReviewer: TestUser;
let noGithub: TestUser;
let key: string;
let otherKey: string;
let issueId: string;
let linkId: string;
const ISSUE = 42;
const OTHER = 77;

const as = (user: TestUser) => ({ ...CSRF, Authorization: `Bearer ${user.token}` });
const pullsUrl = (number?: number, tail = '', projectId = ctx.projectId, issue = ISSUE) =>
  `/api/projects/${projectId}/issues/${issue}/github/pulls${number ? `/${number}` : ''}${tail}`;
const open = (user: TestUser, body: object) =>
  request(app).post(pullsUrl()).set(as(user)).send(body);
const update = (user: TestUser, number: number, body: object) =>
  request(app).patch(pullsUrl(number)).set(as(user)).send(body);
const reviewers = (user: TestUser, number: number, body: object) =>
  request(app).post(pullsUrl(number, '/reviewers')).set(as(user)).send(body);
const comment = (user: TestUser, number: number, body: object) =>
  request(app).post(pullsUrl(number, '/comments')).set(as(user)).send(body);
const written = () => fake.requests.filter((r) => r.method !== 'GET');

/**
 * Connects a user's GitHub account with a token for the widget repository.
 * @param user Who connects
 * @param opts What the token may do on GitHub, and the GitHub identity
 * @param opts.push The repositories it may write (all it reaches when unset)
 * @param opts.login The GitHub login
 * @param opts.githubUserId The GitHub id
 */
async function connectAccount(
  user: TestUser,
  opts: { push?: string[]; login?: string; githubUserId?: number } = {},
) {
  const id = `acct-${user.id}`;
  const login = opts.login ?? 'octo-dev';
  const token = fake.issueUserToken(login, [WIDGET], { push: opts.push });
  await prisma.githubAccount.create({
    data: {
      id,
      userId: user.id,
      githubUserId: opts.githubUserId ?? 9101,
      login,
      accessToken: encryptSecret(token, secretContext('githubAccount', 'accessToken', id)),
    },
  });
  return token;
}

/**
 * GitHub's pull request object, as a webhook or an answer carries it.
 * @param number The PR number
 * @param head The head branch
 * @param title The title
 */
const prPayload = (number: number, head: string, title: string): PullRequestPayload => ({
  number,
  title,
  body: null,
  state: 'open',
  draft: false,
  user: { id: 9101, login: 'octo-dev' },
  head: { ref: head, sha: 'c'.repeat(40) },
  base: { ref: 'main' },
  mergeable_state: 'clean',
  requested_reviewers: [],
  html_url: `https://github.com/${WIDGET}/pull/${number}`,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  merged_at: null,
  closed_at: null,
});

/**
 * A pull request that exists on GitHub and is stored in Axiom, as a webhook would have left it.
 * @param number The PR number
 * @param head The head branch
 * @param title The title
 * @param others The PRs GitHub lists besides this one
 */
async function existingPull(number: number, head: string, title: string, others: number[] = []) {
  const payload = prPayload(number, head, title);
  fake.setRepoLists(WIDGET, {
    pulls: [payload, ...others.map((n) => prPayload(n, `side-${n}`, `Side ${n}`))],
  });
  await storePullRequest(linkId, payload, { id: 9101, login: 'octo-dev' }, 'webhook');
}

const headOf = () => `${key.toLowerCase()}-search`;

beforeAll(async () => {
  ctx = await createTestContext('ghpr');
  key = `${ctx.projectPrefix}-${ISSUE}`;
  otherKey = `${ctx.projectPrefix}-${OTHER}`;
  member = await addMemberToContext(ctx);
  reviewer = await addMemberToContext(ctx);
  strayReviewer = await addMemberToContext(ctx);
  noGithub = await addMemberToContext(ctx);
  viewer = await createTestUser();
  outsideReviewer = await createTestUser();
  await prisma.orgMembership.create({
    data: { orgId: ctx.orgId, userId: viewer.id, role: 'VIEWER' },
  });
  await prisma.teamMembership.create({
    data: { teamId: ctx.teamId, userId: viewer.id, role: 'VIEWER' },
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
  await prisma.issue.create({
    data: {
      projectId: ctx.projectId,
      number: OTHER,
      title: 'Other',
      body: '',
      creatorId: ctx.owner.id,
    },
  });
});

beforeEach(async () => {
  await seedGithubApp({ fake });
  fake.removeInstallation(3301);
  fake.addInstallation(3301, [WIDGET]);
  fake.setPublicRepos([]);
  fake.setGitRefs(WIDGET, { main: MAIN_SHA, [headOf()]: 'd'.repeat(40), 'no-key-here': MAIN_SHA });
  await prisma.githubInstallation.create({
    data: { id: 3301n, accountLogin: 'acme-labs', accountType: 'Organization' },
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
  await prisma.githubInstallation.deleteMany();
  await prisma.githubAccount.deleteMany();
  await prisma.apiToken.deleteMany({ where: { userId: member.id } });
  await prisma.githubApp.deleteMany();
});

afterAll(async () => {
  const ids = [member, viewer, reviewer, strayReviewer, outsideReviewer, noGithub].map((u) => u.id);
  await cleanupTestContext(ctx);
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe('githubPr.open', () => {
  it('opens with the defaults, stores the PR linked by title and branch, and shows it at once', async () => {
    const token = await connectAccount(member);
    const res = await open(member, { head: headOf() });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      number: 1,
      title: `${key} Fix login timeout!`,
      state: 'open',
      draft: false,
      url: `https://github.com/${WIDGET}/pull/1`,
      headRef: headOf(),
      baseRef: 'main',
      author: { login: 'octo-dev' },
    });
    // One write, as the caller; GitHub's answer is the whole PR, so nothing is fetched after it
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST /repos/${WIDGET}/pulls`,
    ]);
    expect(fake.requests[0].headers.authorization).toMatch(/^user:/);
    expect(fake.requests[0].body).toEqual({
      title: `${key} Fix login timeout!`,
      head: headOf(),
      base: 'main',
    });

    const row = await prisma.githubPullRequest.findFirstOrThrow({ where: { repoLinkId: linkId } });
    expect(row).toMatchObject({ number: 1, state: 'OPEN', headRef: headOf(), baseRef: 'main' });
    const links = await prisma.githubIssueLink.findMany({ where: { issueId } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ targetType: 'PULL_REQUEST', targetKey: row.id });
    expect([...links[0].sources].sort()).toEqual(['BRANCH_NAME', 'PR_TITLE']);

    const seen = fake.requests.length;
    const read = await request(app)
      .post('/api/read')
      .set(as(member))
      .send({ keys: [key], include: ['development'] });
    expect(read.body.items[0].data.development.pullRequests.items).toEqual([
      expect.objectContaining({ number: 1, headRef: headOf() }),
    ]);
    expect(fake.requests.length).toBe(seen);

    const audits = JSON.stringify(await prisma.auditLog.findMany({ where: { userId: member.id } }));
    expect(`${JSON.stringify(res.body)}${audits}`).not.toContain(token.slice(4));
  });

  it('sends a given title, base, body and draft flag', async () => {
    await connectAccount(member);
    const res = await open(member, {
      head: 'no-key-here',
      base: 'main',
      title: `${key}: search`,
      body: 'Adds search.',
      draft: true,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: `${key}: search`, draft: true });
    expect(fake.requests[0].body).toEqual({
      title: `${key}: search`,
      head: 'no-key-here',
      base: 'main',
      body: 'Adds search.',
      draft: true,
    });
  });

  it('fetches the PR when the answer is not the whole object', async () => {
    await connectAccount(member);
    fake.on(`POST /repos/:owner/:repo/pulls`, { status: 201, body: { number: 9 } });
    fake.setRepoLists(WIDGET, { pulls: [prPayload(9, headOf(), `${key} Fix`)] });
    const res = await open(member, { head: headOf() });
    expect(res.status).toBe(201);
    expect(res.body.number).toBe(9);
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `POST /repos/${WIDGET}/pulls`,
      `GET /repos/${WIDGET}/pulls/9`,
    ]);
    expect(await prisma.githubPullRequest.count()).toBe(1);
  });

  it('answers 400 when neither the head branch nor the title names the issue, with no request', async () => {
    await connectAccount(member);
    const res = await open(member, { head: 'no-key-here', title: 'Search' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain(key);
    // The key of another issue does not count
    const other = await open(member, { head: 'no-key-here', title: `${otherKey} Search` });
    expect(other.status).toBe(400);
    expect(fake.requests).toEqual([]);
    expect(await prisma.githubPullRequest.count()).toBe(0);
  });

  it('answers 400 for a bad head, a bad base and a body over 65536 characters, with no request', async () => {
    await connectAccount(member);
    for (const body of [
      { head: `${key}..x` },
      { head: headOf(), base: 'bad base' },
      { head: headOf(), body: 'x'.repeat(65537) },
      { head: headOf(), title: '' },
    ]) {
      const res = await open(member, body);
      expect(res.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(fake.requests).toEqual([]);
  });

  it('accepts a body of exactly 65536 characters', async () => {
    await connectAccount(member);
    const res = await open(member, { head: headOf(), body: 'x'.repeat(65536) });
    expect(res.status).toBe(201);
  });

  it('answers 403 GITHUB_FORBIDDEN when GitHub refuses the push, and stores nothing', async () => {
    await connectAccount(member, { push: [] });
    const res = await open(member, { head: headOf() });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GITHUB_FORBIDDEN');
    expect(res.body.error.message).toContain('Resource not accessible by integration');
    expect(written()).toHaveLength(1);
    expect(await prisma.githubPullRequest.count()).toBe(0);
    expect(await prisma.githubIssueLink.count()).toBe(0);
  });

  it('answers 409 GITHUB_PR_EXISTS with the number of the open PR for the branch', async () => {
    await connectAccount(member);
    await existingPull(5, headOf(), `${key} Already`);
    const res = await open(member, { head: headOf() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_PR_EXISTS');
    expect(res.body.error.message).toContain('#5');
    expect(res.body.error.details).toMatchObject({ number: 5 });
    expect(await prisma.githubPullRequest.count()).toBe(1);
  });

  it('answers 409 GITHUB_PR_EXISTS without a number when GitHub does not give it', async () => {
    await connectAccount(member);
    fake.on(`POST /repos/:owner/:repo/pulls`, {
      status: 422,
      body: {
        message: 'Validation Failed',
        errors: [
          {
            resource: 'PullRequest',
            code: 'custom',
            message: 'A pull request already exists for acme-labs:x.',
          },
        ],
      },
    });
    fake.on(`GET /repos/:owner/:repo/pulls`, { status: 500, body: { message: 'boom' } });
    const res = await open(member, { head: headOf() });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_PR_EXISTS');
    expect(res.body.error.details).toBeUndefined();
  });

  it('answers 422 GITHUB_INVALID for a head GitHub does not have', async () => {
    await connectAccount(member);
    const res = await open(member, { head: `${key.toLowerCase()}-gone` });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('GITHUB_INVALID');
  });

  it('answers 409 GITHUB_NOT_CONNECTED, and 403 for a viewer, with no GitHub request', async () => {
    const none = await open(noGithub, { head: headOf() });
    expect(none.status).toBe(409);
    expect(none.body.error.code).toBe('GITHUB_NOT_CONNECTED');
    await connectAccount(viewer);
    const denied = await open(viewer, { head: headOf() });
    expect(denied.status).toBe(403);
    expect(fake.requests).toEqual([]);
  });

  it("answers 201 from GitHub's answer when the store fails after GitHub opened the PR", async () => {
    await connectAccount(member);
    const warn = vi.spyOn(logger, 'warn');
    // A date the store cannot take: the PR exists on GitHub, the webhook repairs the row
    fake.on(`POST /repos/:owner/:repo/pulls`, {
      status: 201,
      body: { ...prPayload(3, headOf(), `${key} x`), created_at: 'not a date' },
    });
    try {
      const res = await open(member, { head: headOf() });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        number: 3,
        title: `${key} x`,
        headRef: headOf(),
        state: 'open',
      });
      expect(await prisma.githubPullRequest.count()).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        'github pull request changed but not stored',
        expect.objectContaining({ repoLinkId: linkId, pullRequest: 3 }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('answers 201 when the follow-up GET fails after a successful write', async () => {
    await connectAccount(member);
    fake.on(`POST /repos/:owner/:repo/pulls`, { status: 201, body: { number: 9 } });
    fake.on(`GET /repos/:owner/:repo/pulls/:n`, { status: 500, body: { message: 'boom' } });
    const res = await open(member, { head: headOf() });
    expect(res.status).toBe(201);
    expect(res.body.number).toBe(9);
  });

  it('reports pr_opened with source action, and the webhook that follows reports nothing', async () => {
    await connectAccount(member);
    const outcomes: GithubEventOutcome[] = [];
    const off = onGithubOutcome(async (o) => {
      if (o.repoLinkId === linkId) outcomes.push(o);
    });
    try {
      const res = await open(member, { head: headOf() });
      expect(res.status).toBe(201);
      expect(outcomes.map((o) => [o.source, o.transitions])).toEqual([['action', ['pr_opened']]]);
      const same = {
        ...prPayload(1, headOf(), `${key} Fix login timeout!`),
        updated_at: '2999-01-01T00:00:00Z',
      };
      await storePullRequest(linkId, same, { id: 9101, login: 'octo-dev' }, 'webhook');
      expect(outcomes.slice(1).flatMap((o) => o.transitions)).toEqual([]);
    } finally {
      off();
    }
  });

  it('reports a fork head as unsupported with a hint', async () => {
    await connectAccount(member);
    const res = await open(member, { head: `someone:${key.toLowerCase()}-x` });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/fork/i);
    expect(fake.requests).toEqual([]);
  });
});

describe('githubPr.update', () => {
  it('answers 400 for nothing to change, with no request', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    fake.requests.length = 0;
    const res = await update(member, 4, {});
    expect(res.status).toBe(400);
    expect(fake.requests).toEqual([]);
  });

  it('changes the title, body and base and stores the answer', async () => {
    await connectAccount(member);
    fake.setGitRefs(WIDGET, { main: MAIN_SHA, release: MAIN_SHA, [headOf()]: 'd'.repeat(40) });
    await existingPull(4, headOf(), `${key} Fix`);
    fake.requests.length = 0;
    const res = await update(member, 4, { title: `${key} Better`, body: 'More.', base: 'release' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ number: 4, title: `${key} Better`, baseRef: 'release' });
    expect(fake.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      `PATCH /repos/${WIDGET}/pulls/4`,
    ]);
    expect(fake.requests[0].body).toEqual({
      title: `${key} Better`,
      body: 'More.',
      base: 'release',
    });
    expect(fake.requests[0].headers.authorization).toMatch(/^user:/);
    const row = await prisma.githubPullRequest.findFirstOrThrow({ where: { number: 4 } });
    expect(row).toMatchObject({ title: `${key} Better`, baseRef: 'release' });
  });

  it('syncs the links from the answer: a title that drops the key keeps the branch link only', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    const before = await prisma.githubIssueLink.findMany({ where: { issueId } });
    expect([...before[0].sources].sort()).toEqual(['BRANCH_NAME', 'PR_TITLE']);
    const res = await update(member, 4, { title: 'Renamed' });
    expect(res.status).toBe(200);
    const after = await prisma.githubIssueLink.findMany({ where: { issueId } });
    expect(after).toHaveLength(1);
    expect(after[0].sources).toEqual(['BRANCH_NAME']);
  });

  it('answers 404 GITHUB_NOT_LINKED_TO_ISSUE for a PR of another issue, with no request', async () => {
    await connectAccount(member);
    await existingPull(8, `${otherKey.toLowerCase()}-x`, `${otherKey} Other`);
    fake.requests.length = 0;
    const res = await update(member, 8, { title: 'Hijack' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GITHUB_NOT_LINKED_TO_ISSUE');
    const missing = await update(member, 999, { title: 'Nope' });
    expect(missing.status).toBe(404);
    expect(fake.requests).toEqual([]);
  });

  it('answers 403 for a viewer and for a token without push, and stores nothing new', async () => {
    await existingPull(4, headOf(), `${key} Fix`);
    await connectAccount(viewer, { githubUserId: 9301, login: 'view-dev' });
    expect((await update(viewer, 4, { title: 'x' })).status).toBe(403);
    expect(fake.requests).toEqual([]);
    await connectAccount(member, { push: [] });
    const res = await update(member, 4, { title: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GITHUB_FORBIDDEN');
    expect(res.body.error.message).toContain('Resource not accessible by integration');
    const row = await prisma.githubPullRequest.findFirstOrThrow({ where: { number: 4 } });
    expect(row.title).toBe(`${key} Fix`);
  });
});

describe('githubPr.requestReviewers', () => {
  beforeEach(async () => {
    // The fake gives a requested reviewer the id GitHub knows them by
    fake.issueAuthorizationCode('review-bot', { githubUserId: 9202 });
    await prisma.githubAccount.createMany({
      data: [
        {
          id: 'acct-rev',
          userId: reviewer.id,
          githubUserId: 9202,
          login: 'review-bot',
          accessToken: 'x',
        },
        {
          id: 'acct-out',
          userId: outsideReviewer.id,
          githubUserId: 9203,
          login: 'outside-dev',
          accessToken: 'x',
        },
      ],
    });
  });

  it('sends the login of a connected user of the org, and logins as given', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    fake.requests.length = 0;
    const res = await reviewers(member, 4, { userIds: [reviewer.id], logins: ['code-owl'] });
    expect(res.status).toBe(201);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      method: 'POST',
      path: `/repos/${WIDGET}/pulls/4/requested_reviewers`,
      body: { reviewers: ['code-owl', 'review-bot'] },
    });
    expect(res.body.requestedReviewers.map((r: { login: string }) => r.login).sort()).toEqual([
      'code-owl',
      'review-bot',
    ]);
    const mine = res.body.requestedReviewers.find(
      (r: { login: string }) => r.login === 'review-bot',
    );
    expect(mine.user).toEqual({ id: reviewer.id, displayName: reviewer.username });
    const row = await prisma.githubPullRequest.findFirstOrThrow({ where: { number: 4 } });
    expect(JSON.stringify(row.requestedReviewers)).toContain('review-bot');
  });

  it('answers 400 naming a user who has not connected GitHub, with no request', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    fake.requests.length = 0;
    const res = await reviewers(member, 4, { userIds: [reviewer.id, strayReviewer.id] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain(strayReviewer.username);
    expect(fake.requests).toEqual([]);
  });

  it('answers one generic 400 for an outside user and an unknown id, naming neither', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    fake.requests.length = 0;
    const generic =
      "Some reviewers can't be requested: they are not connected to GitHub or not in this organization";
    const outside = await reviewers(member, 4, { userIds: [outsideReviewer.id] });
    const unknown = await reviewers(member, 4, { userIds: ['no-such-user-id'] });
    for (const res of [outside, unknown]) {
      expect(res.status).toBe(400);
      expect(res.body.error.message).toBe(generic);
      expect(res.body.error.message).not.toContain(outsideReviewer.username);
    }
    expect(fake.requests).toEqual([]);
  });

  it('answers 422 for the PR author and for someone who is not a collaborator', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    fake.setCollaborators(WIDGET, ['octo-dev', 'review-bot']);
    const author = await reviewers(member, 4, { logins: ['octo-dev'] });
    expect(author.status).toBe(422);
    expect(author.body.error.code).toBe('GITHUB_INVALID');
    expect(author.body.error.message).toMatch(/author/i);
    const stranger = await reviewers(member, 4, { logins: ['code-owl'] });
    expect(stranger.status).toBe(422);
    expect(stranger.body.error.message).toMatch(/collaborator/i);
  });

  it('refuses a viewer, with no request', async () => {
    await existingPull(4, headOf(), `${key} Fix`);
    await connectAccount(viewer, { githubUserId: 9301, login: 'view-dev' });
    fake.requests.length = 0;
    expect((await reviewers(viewer, 4, { logins: ['code-owl'] })).status).toBe(403);
    expect(fake.requests).toEqual([]);
  });

  it('answers 400 for none, more than 15 together, and a login that is none', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    fake.requests.length = 0;
    const many = Array.from({ length: 16 }, (_, i) => `dev-${i}`);
    for (const body of [
      {},
      { logins: [] },
      { logins: many },
      { logins: many.slice(0, 15), userIds: [reviewer.id] },
      { logins: ['bad login'] },
      { logins: ['-lead'] },
    ]) {
      const res = await reviewers(member, 4, body);
      expect(res.status, JSON.stringify(body).slice(0, 50)).toBe(400);
    }
    expect(fake.requests).toEqual([]);
    const ok = await reviewers(member, 4, { logins: many.slice(0, 15) });
    expect(ok.status).toBe(201);
  });

  it('answers 404 GITHUB_NOT_LINKED_TO_ISSUE for a PR of another issue, with no request', async () => {
    await connectAccount(member);
    await existingPull(8, `${otherKey.toLowerCase()}-x`, `${otherKey} Other`);
    fake.requests.length = 0;
    const res = await reviewers(member, 8, { logins: ['code-owl'] });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GITHUB_NOT_LINKED_TO_ISSUE');
    expect(fake.requests).toEqual([]);
  });

  it('answers 403 without push rights on GitHub', async () => {
    await existingPull(4, headOf(), `${key} Fix`);
    await connectAccount(member, { push: [] });
    const res = await reviewers(member, 4, { logins: ['code-owl'] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GITHUB_FORBIDDEN');
    expect(res.body.error.message).toContain('Resource not accessible by integration');
    const row = await prisma.githubPullRequest.findFirstOrThrow({ where: { number: 4 } });
    expect(JSON.stringify(row.requestedReviewers)).not.toContain('code-owl');
  });
});

describe('githubPr.comment', () => {
  it('posts the comment as the caller and returns its URL', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    fake.requests.length = 0;
    const res = await comment(member, 4, { body: 'Looks good to me.' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: '5001',
      url: `https://github.com/${WIDGET}/pull/4#issuecomment-5001`,
    });
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toMatchObject({
      method: 'POST',
      path: `/repos/${WIDGET}/issues/4/comments`,
      body: { body: 'Looks good to me.' },
    });
    expect(fake.requests[0].headers.authorization).toMatch(/^user:/);
  });

  it('answers 400 for an empty body and one over 65536 characters, with no request', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    fake.requests.length = 0;
    expect((await comment(member, 4, { body: '' })).status).toBe(400);
    expect((await comment(member, 4, { body: 'x'.repeat(65537) })).status).toBe(400);
    expect(fake.requests).toEqual([]);
    expect((await comment(member, 4, { body: 'x'.repeat(65536) })).status).toBe(201);
  });

  it('answers 404 GITHUB_NOT_LINKED_TO_ISSUE for a PR of another issue, with no request', async () => {
    await connectAccount(member);
    await existingPull(8, `${otherKey.toLowerCase()}-x`, `${otherKey} Other`);
    fake.requests.length = 0;
    const res = await comment(member, 8, { body: 'Hi' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GITHUB_NOT_LINKED_TO_ISSUE');
    expect(fake.requests).toEqual([]);
  });

  it("answers 403 with GitHub's reason without push rights, and for a viewer without a request", async () => {
    await existingPull(4, headOf(), `${key} Fix`);
    await connectAccount(viewer, { githubUserId: 9301, login: 'view-dev' });
    fake.requests.length = 0;
    expect((await comment(viewer, 4, { body: 'Hi' })).status).toBe(403);
    expect(fake.requests).toEqual([]);
    await connectAccount(member, { push: [] });
    const res = await comment(member, 4, { body: 'Hi' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GITHUB_FORBIDDEN');
    expect(res.body.error.message).toContain('Resource not accessible by integration');
  });

  it('runs for an API token with github:write without approval, audited with the token name', async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
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
    const send = (action: string, input: object) =>
      request(app)
        .post('/api/act')
        .set(CSRF)
        .set('Authorization', `Token ${raw}`)
        .send({ action, input });
    const res = await send('githubPr.comment', {
      projectId: ctx.projectId,
      issueNumber: ISSUE,
      pullNumber: 4,
      body: 'From an agent',
    });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe(`https://github.com/${WIDGET}/pull/4#issuecomment-5001`);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'githubPr.comment', userId: member.id },
    });
    expect(audit.via).toBe('github-agent');
  });
});

describe('githubChecks.rerun', () => {
  const HEAD = 'c'.repeat(40);
  const rerun = (user: TestUser, number: number) =>
    request(app).post(pullsUrl(number, '/checks/rerun')).set(as(user)).send({});
  const run = (
    id: number,
    name: string,
    conclusion: string | null,
    extra: { workflowRunId?: string; appSlug?: string; suite?: bigint; headSha?: string } = {},
  ) =>
    prisma.githubCheckRun.create({
      data: {
        id: String(id),
        repoLinkId: linkId,
        headSha: extra.headSha ?? HEAD,
        name,
        appSlug: extra.appSlug ?? 'github-actions',
        checkSuiteId: extra.suite ?? null,
        workflowRunId: extra.workflowRunId ?? null,
        status: conclusion ? 'completed' : 'in_progress',
        conclusion,
        htmlUrl: `https://github.com/${WIDGET}/runs/${id}`,
        githubUpdatedAt: new Date('2026-11-01T10:00:00Z'),
      },
    });
  const calls = () => written().map((r) => `${r.method} ${r.path.replace(`/repos/${WIDGET}`, '')}`);

  beforeEach(async () => {
    await connectAccount(member);
    await existingPull(4, headOf(), `${key} Fix`);
    fake.setWorkflowRuns(WIDGET, [900, 901, 902]);
    fake.requests.length = 0;
  });

  it('re-runs two failed jobs of one workflow run with one request', async () => {
    await run(11, 'unit', 'failure', { workflowRunId: '900' });
    await run(12, 'lint', 'timed_out', { workflowRunId: '900' });
    await run(13, 'build', 'success', { workflowRunId: '900' });
    const res = await rerun(member, 4);
    expect(res.status).toBe(201);
    expect(calls()).toEqual(['POST /actions/runs/900/rerun-failed-jobs']);
    expect(res.body.rerun).toEqual([
      { name: 'unit', via: 'workflow' },
      { name: 'lint', via: 'workflow' },
    ]);
    expect(fake.requests[0].headers.authorization).toMatch(/^user:/);
  });

  it('re-runs each workflow run once and lists a failed check of another app as not re-runnable', async () => {
    await run(11, 'unit', 'failure', { workflowRunId: '900' });
    await run(21, 'e2e', 'failure', { workflowRunId: '901' });
    await run(31, 'deploy-preview', 'failure', { appSlug: 'acme-ci', suite: 7n });
    const res = await rerun(member, 4);
    expect(res.status).toBe(201);
    expect(calls()).toEqual([
      'POST /actions/runs/900/rerun-failed-jobs',
      'POST /actions/runs/901/rerun-failed-jobs',
    ]);
    expect(res.body.rerun).toEqual([
      { name: 'unit', via: 'workflow' },
      { name: 'e2e', via: 'workflow' },
    ]);
    expect(res.body.refused).toEqual([]);
    expect(res.body.notRerunnable).toEqual([
      {
        name: 'deploy-preview',
        url: `https://github.com/${WIDGET}/runs/31`,
        reason: 'only the app that created this check can re-run it',
      },
    ]);
    expect(fake.requests.some((r) => r.path.includes('rerequest'))).toBe(false);
  });

  it('answers 201 with only not-rerunnable checks, and asks GitHub for nothing', async () => {
    await run(31, 'deploy-preview', 'failure', { appSlug: 'acme-ci', suite: 7n });
    const res = await rerun(member, 4);
    expect(res.status).toBe(201);
    expect(res.body.rerun).toEqual([]);
    expect(res.body.notRerunnable).toHaveLength(1);
    expect(fake.requests).toEqual([]);
  });

  it('keeps what was re-run when a later workflow run is refused', async () => {
    await run(11, 'unit', 'failure', { workflowRunId: '900' });
    await run(21, 'e2e', 'failure', { workflowRunId: '901' });
    fake.on('POST /repos/:owner/:repo/actions/runs/:id/rerun-failed-jobs', (_req, params) =>
      params.id === '901'
        ? { status: 403, body: { message: 'Resource not accessible by integration' } }
        : { status: 201, body: {} },
    );
    const res = await rerun(member, 4);
    expect(res.status).toBe(201);
    expect(res.body.rerun).toEqual([{ name: 'unit', via: 'workflow' }]);
    expect(res.body.refused).toEqual([
      expect.objectContaining({
        name: 'e2e',
        message: expect.stringContaining('Resource not accessible by integration'),
      }),
    ]);
  });

  it('answers the first refusal when every attempt was refused', async () => {
    await run(11, 'unit', 'failure', { workflowRunId: '900' });
    fake.on('POST /repos/:owner/:repo/actions/runs/:id/rerun-failed-jobs', {
      status: 403,
      body: { message: 'Resource not accessible by integration' },
    });
    const res = await rerun(member, 4);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GITHUB_FORBIDDEN');
    expect(res.body.error.message).toContain('Resource not accessible by integration');
  });

  it('answers 404 when GitHub does not know the workflow run', async () => {
    await run(12, 'late', 'failure', { workflowRunId: '999' });
    const res = await rerun(member, 4);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GITHUB_NOT_FOUND');
  });

  it('leaves out a failed run that a newer run replaced, and runs on other commits', async () => {
    await run(11, 'unit', 'failure', { workflowRunId: '900' });
    // The re-run of the same job in the same workflow run has a new id and passed
    await run(41, 'unit', 'success', { workflowRunId: '900' });
    await run(51, 'old-ci', 'failure', { appSlug: 'acme-ci', suite: 8n });
    await run(52, 'old-ci', 'success', { appSlug: 'acme-ci', suite: 8n });
    await run(61, 'elsewhere', 'failure', { workflowRunId: '777', headSha: 'e'.repeat(40) });
    const res = await rerun(member, 4);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_NOTHING_TO_RERUN');
    expect(fake.requests).toEqual([]);
  });

  it('re-runs the newest failed run of a name, not the one it replaced', async () => {
    await run(11, 'unit', 'failure', { workflowRunId: '900' });
    await run(41, 'unit', 'failure', { workflowRunId: '900' });
    const res = await rerun(member, 4);
    expect(res.status).toBe(201);
    expect(res.body.rerun).toEqual([{ name: 'unit', via: 'workflow' }]);
    expect(calls()).toEqual(['POST /actions/runs/900/rerun-failed-jobs']);
  });

  it('answers 409 GITHUB_NOTHING_TO_RERUN with passing and running checks only', async () => {
    await run(11, 'unit', 'success', { workflowRunId: '900' });
    await run(12, 'lint', null, { workflowRunId: '900' });
    await run(13, 'skipme', 'skipped', { workflowRunId: '900' });
    const res = await rerun(member, 4);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_NOTHING_TO_RERUN');
    expect(fake.requests).toEqual([]);
  });

  it('answers 404 GITHUB_NOT_LINKED_TO_ISSUE for a PR of another issue, with no request', async () => {
    await existingPull(8, `${otherKey.toLowerCase()}-x`, `${otherKey} Other`);
    await run(11, 'unit', 'failure', { workflowRunId: '900' });
    fake.requests.length = 0;
    const res = await rerun(member, 8);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('GITHUB_NOT_LINKED_TO_ISSUE');
    expect(fake.requests).toEqual([]);
  });

  it('refuses a viewer, with no request', async () => {
    await run(11, 'unit', 'failure', { workflowRunId: '900' });
    await connectAccount(viewer, { githubUserId: 9301, login: 'view-dev' });
    expect((await rerun(viewer, 4)).status).toBe(403);
    expect(fake.requests).toEqual([]);
  });

  it('runs for an API token with github:write without approval', async () => {
    await run(11, 'unit', 'failure', { workflowRunId: '900' });
    const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
    await prisma.apiToken.create({
      data: {
        userId: member.id,
        name: 'ci-agent',
        scopes: ['github:write'],
        prefix: raw.slice(0, 11),
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
      },
    });
    const res = await request(app)
      .post(pullsUrl(4, '/checks/rerun'))
      .set(CSRF)
      .set('Authorization', `Token ${raw}`)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.rerun).toEqual([{ name: 'unit', via: 'workflow' }]);
    expect(calls()).toEqual(['POST /actions/runs/900/rerun-failed-jobs']);
    expect(await prisma.agentApproval.count({ where: { userId: member.id } })).toBe(0);
  });
});

describe('token reach', () => {
  it('lists the PR actions and the re-run under github:write', () => {
    const reach = JSON.parse(
      readFileSync(path.join(__dirname, '../../actions/token-reach.json'), 'utf8'),
    ) as Record<string, string[]>;
    for (const name of ['open', 'update', 'requestReviewers', 'comment']) {
      expect(reach[`githubPr.${name}`]).toEqual(['github:write']);
    }
    expect(reach['githubChecks.rerun']).toEqual(['github:write']);
  });
});
