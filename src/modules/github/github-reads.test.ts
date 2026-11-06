import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';

import { loadChecks, loadDevelopment } from './github-reads';
import { GITHUB_INTEGRATION_USER_ID } from './integration-user';

const SHA_A = '1'.repeat(40);
const SHA_B = '2'.repeat(40);
const SHA_C = 'c'.repeat(40);

let ctx: TestContext;
let bare: TestContext;
let dev: TestUser;
let devName: string;
let repoLinkId: string;
let issueId: string;
let bareIssueId: string;
let nextId = 9_100_000;

async function makePr(
  number: number,
  extra: Partial<Parameters<typeof prisma.githubPullRequest.create>[0]['data']> = {},
) {
  const pr = await prisma.githubPullRequest.create({
    data: {
      repoLinkId,
      number,
      title: `Change ${number}`,
      state: 'OPEN',
      draft: false,
      authorLogin: 'voorbeeld-dev',
      authorUserId: GITHUB_INTEGRATION_USER_ID,
      headRef: `feature-${number}`,
      headSha: SHA_A,
      baseRef: 'main',
      mergeableState: 'clean',
      requestedReviewers: [],
      htmlUrl: `https://github.com/acme-labs/widget/pull/${number}`,
      openedAt: new Date('2026-11-01T10:00:00Z'),
      githubUpdatedAt: new Date('2026-11-01T10:00:00Z'),
      ...extra,
    },
  });
  await prisma.githubIssueLink.create({
    data: {
      issueId,
      repoLinkId,
      targetType: 'PULL_REQUEST',
      targetKey: pr.id,
      sources: ['PR_TITLE'],
    },
  });
  return pr;
}

async function makeBranch(name: string, headSha: string, deleted = false) {
  const branch = await prisma.githubBranch.create({
    data: { repoLinkId, name, headSha, deletedAt: deleted ? new Date() : null },
  });
  await prisma.githubIssueLink.create({
    data: {
      issueId,
      repoLinkId,
      targetType: 'BRANCH',
      targetKey: branch.id,
      sources: ['BRANCH_NAME'],
    },
  });
  return branch;
}

async function makeRun(
  sha: string,
  name: string,
  status: string,
  conclusion: string | null,
  extra: Partial<Parameters<typeof prisma.githubCheckRun.create>[0]['data']> = {},
) {
  const id = String(nextId++);
  return prisma.githubCheckRun.create({
    data: {
      id,
      repoLinkId,
      headSha: sha,
      name,
      appSlug: 'github-actions',
      status,
      conclusion,
      htmlUrl: `https://github.com/acme-labs/widget/runs/${id}`,
      githubUpdatedAt: new Date('2026-11-06T10:00:00Z'),
      ...extra,
    },
  });
}

beforeAll(async () => {
  ctx = await createTestContext('grd1');
  bare = await createTestContext('grd2');
  dev = await createTestUser();
  devName = (await prisma.user.findUniqueOrThrow({ where: { id: dev.id } })).displayName;
  await prisma.githubAccount.create({
    data: {
      userId: dev.id,
      githubUserId: 7_100_001n,
      login: 'review-bot',
      accessToken: 'enc',
    },
  });
  repoLinkId = (
    await prisma.githubRepoLink.create({
      data: {
        projectId: ctx.projectId,
        repoId: 880_500n,
        installationId: 1n,
        owner: 'acme-labs',
        name: 'widget',
        fullName: 'acme-labs/widget',
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/acme-labs/widget',
        linkedById: ctx.owner.id,
      },
    })
  ).id;
  const make = (c: TestContext) =>
    prisma.issue.create({
      data: { projectId: c.projectId, number: 1, title: 'Issue', body: '', creatorId: c.owner.id },
    });
  issueId = (await make(ctx)).id;
  bareIssueId = (await make(bare)).id;
});

beforeEach(async () => {
  await prisma.githubIssueLink.deleteMany({ where: { repoLinkId } });
  await prisma.githubPullRequest.deleteMany({ where: { repoLinkId } });
  await prisma.githubBranch.deleteMany({ where: { repoLinkId } });
  await prisma.githubCheckRun.deleteMany({ where: { repoLinkId } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: dev.id } });
  await cleanupTestContext(ctx);
  await cleanupTestContext(bare);
});

describe('loadDevelopment', () => {
  it('shows a pull request with its reviewers and reviews, and a mapped person without an email', async () => {
    const pr = await makePr(17, {
      authorUserId: dev.id,
      requestedReviewers: [
        { login: 'review-bot', githubId: 7_100_001 },
        { login: 'someone-else', githubId: 7_100_002 },
      ],
    });
    await prisma.githubReview.create({
      data: {
        id: '5001',
        pullRequestId: pr.id,
        authorLogin: 'review-bot',
        authorUserId: dev.id,
        state: 'approved',
        body: 'Looks good',
        commitSha: SHA_A,
        submittedAt: new Date('2026-11-01T12:00:00Z'),
      },
    });
    await makeBranch('feature-17', SHA_A);

    const result = await loadDevelopment(issueId, 20);

    expect(result.branches).toEqual({
      items: [
        {
          name: 'feature-17',
          url: 'https://github.com/acme-labs/widget/tree/feature-17',
          headSha: SHA_A,
          deleted: false,
        },
      ],
      limit: 20,
      truncated: false,
    });
    expect(result.pullRequests.items).toEqual([
      {
        number: 17,
        title: 'Change 17',
        state: 'open',
        draft: false,
        url: 'https://github.com/acme-labs/widget/pull/17',
        author: { login: 'voorbeeld-dev', user: { id: dev.id, displayName: devName } },
        headRef: 'feature-17',
        baseRef: 'main',
        headSha: SHA_A,
        mergeableState: 'clean',
        requestedReviewers: [
          { login: 'review-bot', user: { id: dev.id, displayName: devName } },
          { login: 'someone-else', user: null },
        ],
        reviews: [
          {
            author: { login: 'review-bot', user: { id: dev.id, displayName: devName } },
            state: 'approved',
            body: 'Looks good',
            submittedAt: '2026-11-01T12:00:00.000Z',
          },
        ],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain(dev.email);
  });

  it('shows the integration user as nobody', async () => {
    await makePr(18);
    const { pullRequests } = await loadDevelopment(issueId, 20);
    expect(pullRequests.items[0].author).toEqual({ login: 'voorbeeld-dev', user: null });
  });

  it('caps pull requests at the limit and says so', async () => {
    for (let n = 1; n <= 25; n++) await makePr(n);
    const { pullRequests } = await loadDevelopment(issueId, 20);
    expect(pullRequests.items).toHaveLength(20);
    expect(pullRequests).toMatchObject({ limit: 20, truncated: true });
    // The newest first
    expect(pullRequests.items[0].number).toBe(25);
  });

  it('keeps the latest 20 reviews of a pull request', async () => {
    const pr = await makePr(30);
    await prisma.githubReview.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        id: String(6000 + i),
        pullRequestId: pr.id,
        authorLogin: 'review-bot',
        state: 'commented',
        body: `r${i}`,
        commitSha: SHA_A,
        submittedAt: new Date(Date.UTC(2026, 10, 2, 0, i)),
      })),
    });
    const { pullRequests } = await loadDevelopment(issueId, 20);
    const bodies = pullRequests.items[0].reviews.map((r) => r.body);
    expect(bodies).toHaveLength(20);
    expect(bodies[0]).toBe('r5');
    expect(bodies.at(-1)).toBe('r24');
  });

  it('marks a deleted branch', async () => {
    await makeBranch('gone', SHA_B, true);
    const { branches } = await loadDevelopment(issueId, 20);
    expect(branches.items).toEqual([expect.objectContaining({ name: 'gone', deleted: true })]);
  });

  it('answers empty for an issue in a project with no link', async () => {
    expect(await loadDevelopment(bareIssueId, 20)).toEqual({
      branches: { items: [], limit: 20, truncated: false },
      pullRequests: { items: [], limit: 20, truncated: false },
    });
    expect(await loadChecks(bareIssueId, 50)).toEqual({ items: [], limit: 50, truncated: false });
  });

  it('shows nothing of a link that points into another project', async () => {
    await makePr(40);
    await prisma.issue.update({
      where: { id: issueId },
      data: { projectId: bare.projectId, number: 99 },
    });
    try {
      const { pullRequests } = await loadDevelopment(issueId, 20);
      expect(pullRequests.items).toEqual([]);
    } finally {
      await prisma.issue.update({
        where: { id: issueId },
        data: { projectId: ctx.projectId, number: 1 },
      });
    }
  });
});

describe('loadChecks', () => {
  it('lists a failed run of the head of an open pull request, with its step and log', async () => {
    await makePr(17);
    await makeRun(SHA_A, 'test', 'completed', 'failure', {
      failedStep: 'Run tests',
      logTail: 'line 1\n##[error]exit code 1',
      logTruncated: true,
    });
    await makeRun(SHA_A, 'lint', 'completed', 'success');

    const checks = await loadChecks(issueId, 50);

    expect(checks.truncated).toBe(false);
    expect(checks.items.map((c) => c.name)).toEqual(['test', 'lint']);
    expect(checks.items[0]).toEqual({
      pullRequest: 17,
      headSha: SHA_A,
      name: 'test',
      status: 'completed',
      conclusion: 'failure',
      url: expect.stringContaining('https://github.com/acme-labs/widget/runs/'),
      failedStep: 'Run tests',
      logTail: 'line 1\n##[error]exit code 1',
      logTruncated: true,
      logUnavailable: false,
    });
  });

  it('leaves out a failed run that a later run of the same job replaced', async () => {
    await makePr(17);
    await makeRun(SHA_A, 'test', 'completed', 'failure', {
      workflowRunId: '88100',
      logTail: 'old',
    });
    await makeRun(SHA_A, 'test', 'completed', 'success', { workflowRunId: '88100' });
    await makeRun(SHA_A, 'build', 'completed', 'failure', { workflowRunId: '88100' });

    const checks = await loadChecks(issueId, 50);

    expect(checks.items.map((c) => [c.name, c.conclusion])).toEqual([
      ['build', 'failure'],
      ['test', 'success'],
    ]);
  });

  it('ignores runs of a commit that no open pull request has as its head', async () => {
    await makePr(17);
    await makePr(18, { state: 'MERGED', headSha: SHA_B });
    await makeRun(SHA_B, 'test', 'completed', 'failure');
    expect((await loadChecks(issueId, 50)).items).toEqual([]);
  });

  it('falls back to the heads of live branches, at most 5, when no pull request is open', async () => {
    await makePr(17, { state: 'CLOSED' });
    for (let i = 0; i < 7; i++) {
      const sha = String(i).repeat(40);
      await makeBranch(`b-${i}`, sha);
      await makeRun(sha, `job-${i}`, 'completed', 'failure');
    }
    await makeBranch('dead', SHA_C, true);
    await makeRun(SHA_C, 'dead-job', 'completed', 'failure');

    const checks = await loadChecks(issueId, 50);

    expect(checks.items).toHaveLength(5);
    expect(checks.items.every((c) => c.pullRequest === null)).toBe(true);
    expect(checks.items.map((c) => c.name)).not.toContain('dead-job');
  });

  it('caps at the limit, failed runs first', async () => {
    await makePr(17);
    for (let i = 0; i < 5; i++) await makeRun(SHA_A, `ok-${i}`, 'completed', 'success');
    await makeRun(SHA_A, 'bad', 'completed', 'failure');
    const checks = await loadChecks(issueId, 3);
    expect(checks.items).toHaveLength(3);
    expect(checks).toMatchObject({ limit: 3, truncated: true });
    expect(checks.items[0].name).toBe('bad');
  });
});
