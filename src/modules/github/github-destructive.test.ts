/**
 * Merging, closing and deleting on GitHub wait for approval when a token asks, and run at once for
 * a person in the browser. An approved run goes as the user, with their rights at that moment.
 */
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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
import { authPost } from '../../test/helpers';

import { storeBranch, storePullRequest, type PullRequestPayload } from './github-events';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const WIDGET = 'acme-labs/widget';
const MAIN_SHA = 'a'.repeat(40);
const HEAD_SHA = 'c'.repeat(40);
const MOVED_SHA = 'e'.repeat(40);
const ISSUE = 42;
const OTHER = 77;
const fake = useGithubFake('repo');

let ctx: TestContext;
let member: TestUser;
let viewer: TestUser;
let key: string;
let otherKey: string;
let issueId: string;
let linkId: string;
let raw: string;
let githubToken = '';

const headOf = () => `${key.toLowerCase()}-fix`;
const as = (user: TestUser) => ({ ...CSRF, Authorization: `Bearer ${user.token}` });
const asToken = () => ({ ...CSRF, Authorization: `Token ${raw}` });
const base = (issue = ISSUE) => `/api/projects/${ctx.projectId}/issues/${issue}/github`;
const mergePath = (number: number, issue = ISSUE) => `${base(issue)}/pulls/${number}/merge`;
const closePath = (number: number, issue = ISSUE) => `${base(issue)}/pulls/${number}/close`;
const branchPath = (name: string, issue = ISSUE) =>
  `${base(issue)}/branches/${encodeURIComponent(name)}`;
const written = () => fake.requests.filter((r) => r.method !== 'GET');
const approve = (id: string, user: TestUser = member) =>
  authPost(`/api/agent-approvals/${id}/approve`, user.token);
const merge = (headSha = HEAD_SHA, number = 7, extra: object = {}) =>
  request(app)
    .put(mergePath(number))
    .set(asToken())
    .send({ headSha, method: 'squash', ...extra });

/**
 * Connects the member's GitHub account with a token for the widget repository.
 * @param user Who connects
 */
async function connectAccount(user: TestUser) {
  const id = `acct-${user.id}`;
  githubToken = fake.issueUserToken('octo-dev', [WIDGET]);
  await prisma.githubAccount.create({
    data: {
      id,
      userId: user.id,
      githubUserId: 9101,
      login: 'octo-dev',
      accessToken: encryptSecret(githubToken, secretContext('githubAccount', 'accessToken', id)),
    },
  });
}

/**
 * GitHub's pull request object, as an answer or a webhook carries it.
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
  head: { ref: head, sha: HEAD_SHA },
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
 * A pull request that exists on GitHub and is stored in Axiom, linked to the issue by its branch.
 * @param number The PR number
 * @param head The head branch
 * @param title The title
 */
async function existingPull(number: number, head: string, title: string) {
  const payload = prPayload(number, head, title);
  fake.setRepoLists(WIDGET, { pulls: [payload] });
  await storePullRequest(linkId, payload, { id: 9101, login: 'octo-dev' }, 'webhook');
}

/**
 * A branch that exists on GitHub and is stored in Axiom, linked to the issue by its name.
 * @param name The branch name
 */
async function existingBranch(name: string) {
  fake.setGitRefs(WIDGET, { main: MAIN_SHA, [name]: HEAD_SHA });
  await storeBranch(linkId, { name, sha: HEAD_SHA }, { id: 9101, login: 'octo-dev' }, 'webhook');
}

beforeAll(async () => {
  ctx = await createTestContext('ghdes');
  key = `${ctx.projectPrefix}-${ISSUE}`;
  otherKey = `${ctx.projectPrefix}-${OTHER}`;
  member = await addMemberToContext(ctx);
  viewer = await createTestUser();
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
  fake.setGitRefs(WIDGET, { main: MAIN_SHA });
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
  raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({
    data: {
      userId: member.id,
      name: 'github-agent',
      scopes: ['github:write'],
      prefix: raw.slice(0, 11),
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
    },
  });
  await connectAccount(member);
});

afterEach(async () => {
  await prisma.agentApproval.deleteMany({ where: { userId: member.id } });
  await prisma.githubRepoLink.deleteMany();
  await prisma.githubInstallation.deleteMany();
  await prisma.githubAccount.deleteMany();
  await prisma.apiToken.deleteMany({ where: { userId: member.id } });
  await prisma.githubApp.deleteMany();
  await prisma.teamMembership.updateMany({
    where: { teamId: ctx.teamId, userId: member.id },
    data: { role: 'MEMBER' },
  });
});

afterAll(async () => {
  await cleanupTestContext(ctx);
  await prisma.user.deleteMany({ where: { id: { in: [member.id, viewer.id] } } });
});

describe('githubPr.merge', () => {
  beforeEach(() => existingPull(7, headOf(), 'Fix login'));

  it('waits for approval when a token asks, with the preview, and sends nothing to GitHub', async () => {
    const res = await merge();
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.preview).toBe(
      `Merge pull request #7 "Fix login" in ${WIDGET} (${headOf()} into main) at ccccccc using squash, linked to ${key}`,
    );
    expect(fake.requests).toEqual([]);
    expect(await prisma.githubPullRequest.findFirstOrThrow({ where: { number: 7 } })).toMatchObject(
      { state: 'OPEN' },
    );
  });

  it('merges on approval with the sha the approver saw, then stores the merged PR fetched fresh', async () => {
    const pending = await merge(HEAD_SHA, 7, {
      commitTitle: 'Fix login (#7)',
      commitMessage: 'Body',
    });
    const done = await approve(pending.body.approvalId);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('EXECUTED');
    expect(
      fake.requests.map((r) => `${r.method} ${r.path.replace(`/repos/${WIDGET}`, '')}`),
    ).toEqual(['PUT /pulls/7/merge', 'GET /pulls/7']);
    expect(fake.requests[0].body).toEqual({
      sha: HEAD_SHA,
      merge_method: 'squash',
      commit_title: 'Fix login (#7)',
      commit_message: 'Body',
    });
    expect(fake.requests[0].headers.authorization).toMatch(/^user:/);
    expect(await prisma.githubPullRequest.findFirstOrThrow({ where: { number: 7 } })).toMatchObject(
      { state: 'MERGED' },
    );
    expect(done.body.result).toMatchObject({ number: 7, state: 'merged' });
  });

  it('merges with the merge method by default', async () => {
    const pending = await request(app).put(mergePath(7)).set(asToken()).send({ headSha: HEAD_SHA });
    expect(pending.body.preview).toContain('using merge, linked to');
    await approve(pending.body.approvalId);
    expect((fake.requests[0].body as { merge_method: string }).merge_method).toBe('merge');
  });

  it('fails the approval with GITHUB_HEAD_MOVED when new commits arrived since', async () => {
    const pending = await merge();
    const moved = prPayload(7, headOf(), 'Fix login');
    moved.head.sha = MOVED_SHA;
    fake.setRepoLists(WIDGET, { pulls: [moved] });
    const done = await approve(pending.body.approvalId);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('FAILED');
    expect(done.body.error).toMatchObject({ status: 409, code: 'GITHUB_HEAD_MOVED' });
    expect(done.body.error.message).toBe(
      'The pull request has new commits since this merge was requested',
    );
    expect(written()).toHaveLength(1);
    expect(await prisma.githubPullRequest.findFirstOrThrow({ where: { number: 7 } })).toMatchObject(
      { state: 'OPEN' },
    );
  });

  it("fails the approval with GITHUB_NOT_MERGEABLE and GitHub's message on a 405, whatever was stored", async () => {
    const blocked = { ...prPayload(7, headOf(), 'Fix login'), mergeable: false };
    fake.setRepoLists(WIDGET, { pulls: [blocked] });
    const pending = await merge();
    const done = await approve(pending.body.approvalId);
    expect(done.body.status).toBe('FAILED');
    expect(done.body.error).toMatchObject({ status: 409, code: 'GITHUB_NOT_MERGEABLE' });
    expect(done.body.error.message).toContain('Pull Request is not mergeable');
  });

  it('fails the approval with GITHUB_NOT_CONNECTED when the user disconnected GitHub since', async () => {
    const pending = await merge();
    await prisma.githubAccount.deleteMany({ where: { userId: member.id } });
    const done = await approve(pending.body.approvalId);
    expect(done.body.status).toBe('FAILED');
    expect(done.body.error).toMatchObject({ status: 409, code: 'GITHUB_NOT_CONNECTED' });
    expect(fake.requests).toEqual([]);
  });

  it('fails the approval with 403 when the user lost the right to edit the issue since, with no request', async () => {
    const pending = await merge();
    await prisma.teamMembership.updateMany({
      where: { teamId: ctx.teamId, userId: member.id },
      data: { role: 'VIEWER' },
    });
    const done = await approve(pending.body.approvalId);
    expect(done.body.status).toBe('FAILED');
    expect(done.body.error.status).toBe(403);
    expect(fake.requests).toEqual([]);
  });

  it('fails the approval with 404 when the PR is no longer linked to the issue, with no request', async () => {
    const pending = await merge();
    await prisma.githubIssueLink.deleteMany({ where: { issueId } });
    const done = await approve(pending.body.approvalId);
    expect(done.body.status).toBe('FAILED');
    expect(done.body.error).toMatchObject({ status: 404, code: 'GITHUB_NOT_LINKED_TO_ISSUE' });
    expect(fake.requests).toEqual([]);
  });

  it('merges at once for a person in the browser, as themselves', async () => {
    const res = await request(app)
      .put(mergePath(7))
      .set(as(member))
      .send({ headSha: HEAD_SHA, method: 'rebase' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ number: 7, state: 'merged' });
    expect((fake.requests[0].body as { merge_method: string }).merge_method).toBe('rebase');
    expect(await prisma.agentApproval.count({ where: { userId: member.id } })).toBe(0);
  });

  it('answers 409 GITHUB_HEAD_MOVED to a browser whose sha is stale', async () => {
    const res = await request(app)
      .put(mergePath(7))
      .set(as(member))
      .send({ headSha: 'd'.repeat(40) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_HEAD_MOVED');
  });

  it('refuses a viewer and a PR of another issue before approval or any request', async () => {
    await existingPull(8, `${otherKey.toLowerCase()}-x`, 'Other');
    fake.requests.length = 0;
    const view = await request(app).put(mergePath(7)).set(as(viewer)).send({ headSha: HEAD_SHA });
    expect(view.status).toBe(403);
    const other = await merge(HEAD_SHA, 8);
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('GITHUB_NOT_LINKED_TO_ISSUE');
    expect(fake.requests).toEqual([]);
    expect(await prisma.agentApproval.count({ where: { userId: member.id } })).toBe(0);
  });

  it('refuses a sha that is not 40 lower-case hex digits and an unknown method', async () => {
    for (const body of [
      { headSha: 'C'.repeat(40) },
      { headSha: 'c'.repeat(39) },
      { headSha: HEAD_SHA, method: 'fast-forward' },
      {},
    ]) {
      const res = await request(app).put(mergePath(7)).set(asToken()).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(fake.requests).toEqual([]);
    expect(await prisma.agentApproval.count({ where: { userId: member.id } })).toBe(0);
  });
});

describe('githubPr.close', () => {
  beforeEach(() => existingPull(7, headOf(), 'Fix login'));

  it('waits for approval when a token asks, then closes without merging and stores it', async () => {
    const pending = await request(app).post(closePath(7)).set(asToken()).send({});
    expect(pending.status).toBe(202);
    expect(pending.body.preview).toBe(
      `Close pull request #7 "Fix login" in ${WIDGET} without merging, linked to ${key}`,
    );
    expect(fake.requests).toEqual([]);
    const done = await approve(pending.body.approvalId);
    expect(done.body.status).toBe('EXECUTED');
    expect(
      fake.requests.map((r) => `${r.method} ${r.path.replace(`/repos/${WIDGET}`, '')}`),
    ).toEqual(['PATCH /pulls/7', 'GET /pulls/7']);
    expect(fake.requests[0].body).toEqual({ state: 'closed' });
    expect(await prisma.githubPullRequest.findFirstOrThrow({ where: { number: 7 } })).toMatchObject(
      { state: 'CLOSED' },
    );
  });

  it('closes at once for a person in the browser', async () => {
    const res = await request(app).post(closePath(7)).set(as(member)).send({});
    expect(res.status).toBeLessThan(300);
    expect(res.body).toMatchObject({ number: 7, state: 'closed' });
  });

  it("refuses a viewer and another issue's PR with no request and no approval", async () => {
    await existingPull(8, `${otherKey.toLowerCase()}-x`, 'Other');
    fake.requests.length = 0;
    expect((await request(app).post(closePath(7)).set(as(viewer)).send({})).status).toBe(403);
    const other = await request(app).post(closePath(8)).set(asToken()).send({});
    expect(other.status).toBe(404);
    expect(fake.requests).toEqual([]);
    expect(await prisma.agentApproval.count({ where: { userId: member.id } })).toBe(0);
  });
});

describe('githubBranch.delete', () => {
  beforeEach(() => existingBranch(headOf()));

  it('waits for approval when a token asks, then deletes the ref and marks the branch deleted', async () => {
    const pending = await request(app).delete(branchPath(headOf())).set(asToken()).send();
    expect(pending.status).toBe(202);
    expect(pending.body.preview).toBe(`Delete branch ${headOf()} in ${WIDGET}, linked to ${key}`);
    expect(fake.requests).toEqual([]);
    const done = await approve(pending.body.approvalId);
    expect(done.body.status).toBe('EXECUTED');
    expect(written().map((r) => `${r.method} ${r.path.replace(`/repos/${WIDGET}`, '')}`)).toEqual([
      `DELETE /git/refs/heads/${headOf()}`,
    ]);
    const row = await prisma.githubBranch.findFirstOrThrow({ where: { name: headOf() } });
    expect(row.deletedAt).not.toBeNull();
  });

  it('names an open pull request on the branch in the preview', async () => {
    await existingPull(7, headOf(), 'Fix login');
    const pending = await request(app).delete(branchPath(headOf())).set(asToken()).send();
    expect(pending.body.preview).toBe(
      `Delete branch ${headOf()} in ${WIDGET}, linked to ${key}; this closes open pull request #7`,
    );
  });

  it('answers 400 for the default branch with no request and no approval, token or browser', async () => {
    fake.requests.length = 0;
    for (const headers of [asToken(), as(member)]) {
      const res = await request(app).delete(branchPath('main')).set(headers).send();
      expect(res.status).toBe(400);
    }
    expect(fake.requests).toEqual([]);
    expect(await prisma.agentApproval.count({ where: { userId: member.id } })).toBe(0);
  });

  it('deletes at once for a person in the browser', async () => {
    const res = await request(app).delete(branchPath(headOf())).set(as(member)).send();
    expect(res.status).toBeLessThan(300);
    expect(written()).toHaveLength(1);
  });

  it('refuses a viewer, a branch of another issue and a malformed name, with no request', async () => {
    await existingBranch(`${otherKey.toLowerCase()}-x`);
    fake.requests.length = 0;
    expect((await request(app).delete(branchPath(headOf())).set(as(viewer)).send()).status).toBe(
      403,
    );
    const other = await request(app)
      .delete(branchPath(`${otherKey.toLowerCase()}-x`))
      .set(asToken())
      .send();
    expect(other.status).toBe(404);
    expect(other.body.error.code).toBe('GITHUB_NOT_LINKED_TO_ISSUE');
    expect((await request(app).delete(branchPath('bad..name')).set(asToken()).send()).status).toBe(
      400,
    );
    expect(fake.requests).toEqual([]);
    expect(await prisma.agentApproval.count({ where: { userId: member.id } })).toBe(0);
  });

  it('fails the approval with 404 when the branch is no longer linked to the issue', async () => {
    const pending = await request(app).delete(branchPath(headOf())).set(asToken()).send();
    await prisma.githubIssueLink.deleteMany({ where: { issueId } });
    const done = await approve(pending.body.approvalId);
    expect(done.body.status).toBe('FAILED');
    expect(done.body.error).toMatchObject({ status: 404, code: 'GITHUB_NOT_LINKED_TO_ISSUE' });
    expect(written()).toEqual([]);
  });
});

describe('what the approval rows hold', () => {
  it('holds no GitHub token or Axiom token, in the preview, input, result or error', async () => {
    await existingPull(7, headOf(), 'Fix login');
    await existingBranch(headOf());
    const a = await merge();
    await approve(a.body.approvalId);
    const b = await request(app).delete(branchPath(headOf())).set(asToken()).send();
    await approve(b.body.approvalId);
    const rows = JSON.stringify(
      await prisma.agentApproval.findMany({ where: { userId: member.id } }),
    );
    expect(rows).not.toContain(githubToken);
    expect(rows).not.toContain(raw);
    expect(JSON.stringify([a.body, b.body])).not.toContain(githubToken);
  });
});

describe('flags and reach', () => {
  it('lists the three under github:write and flags them destructive', async () => {
    const reach = JSON.parse(
      readFileSync(path.join(__dirname, '../../actions/token-reach.json'), 'utf8'),
    ) as Record<string, string[]>;
    const { listActions } = await import('../../actions/registry');
    const defs = listActions();
    for (const name of ['githubPr.merge', 'githubPr.close', 'githubBranch.delete']) {
      expect(reach[name], name).toEqual(['github:write']);
      const def = defs.find((d) => d.name === name);
      expect(def?.destructive, name).toBe(true);
      expect(def?.preview, name).toBeTypeOf('function');
    }
  });
});
