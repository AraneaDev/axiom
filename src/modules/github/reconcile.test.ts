import { readFileSync } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { encryptSecret, secretContext } from '../../lib/secret-box';
import { AppError } from '../../middleware/errorHandler';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';
import { logger } from '../../utils/logger';

import { onGithubOutcome, storeBranch, type GithubEventOutcome } from './github-events';
import './github-resolvers';
import {
  RECONCILE_CALL_BUDGET,
  RECONCILE_INTERVAL_MS,
  dueRepoLinkIds,
  reconcileDueRepos,
  reconcileRepo,
} from './reconcile.service';
import './webhook-handlers';

const REPO_ID = 880_600;
const INSTALLATION_ID = 4601;
const JOB_ID = 4401;
const SHA_A = '1111111111111111111111111111111111111111';
const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const LOG = readFileSync(
  path.join(__dirname, '../../test/__fixtures__/github/checks/job-log.txt'),
  'utf8',
);

const fake = useGithubFake('checks');
let ctx: TestContext;
let member: TestUser;
let repoLinkId: string;
const outcomes: GithubEventOutcome[] = [];

type Payload = Record<string, unknown>;

const PUSHED = new Date('2026-11-06T08:00:00Z');
const sha = (n: number) => n.toString(16).padStart(40, '0');

function pr(n: number, over: Payload = {}): Payload {
  return {
    number: n,
    title: `Change ${n}`,
    body: null,
    state: 'open',
    draft: false,
    merged: false,
    user: { id: 7001, login: 'voorbeeld-dev' },
    head: { ref: `feature-${n}`, sha: sha(n) },
    base: { ref: 'main' },
    requested_reviewers: [],
    html_url: `https://github.com/acme-labs/widget/pull/${n}`,
    created_at: '2026-11-06T09:00:00Z',
    updated_at: '2026-11-06T10:00:00Z',
    merged_at: null,
    closed_at: null,
    ...over,
  };
}

function checkRun(over: Payload = {}): Payload {
  return {
    id: JOB_ID,
    name: 'test',
    head_sha: SHA_A,
    status: 'completed',
    conclusion: 'failure',
    started_at: '2026-11-06T10:00:05Z',
    completed_at: '2026-11-06T10:03:05Z',
    html_url: `https://github.com/acme-labs/widget/runs/${JOB_ID}`,
    details_url: `https://github.com/acme-labs/widget/actions/runs/88100/job/${JOB_ID}`,
    output: { title: null, summary: null, text: null },
    app: { id: 15368, slug: 'github-actions', name: 'GitHub Actions' },
    ...over,
  };
}

async function seedPr(n: number, over: Partial<Record<string, unknown>> = {}) {
  return prisma.githubPullRequest.create({
    data: {
      repoLinkId,
      number: n,
      title: `Change ${n}`,
      state: 'OPEN',
      draft: false,
      authorLogin: 'voorbeeld-dev',
      headRef: `feature-${n}`,
      headSha: sha(n),
      baseRef: 'main',
      requestedReviewers: [],
      htmlUrl: `https://github.com/acme-labs/widget/pull/${n}`,
      openedAt: new Date('2026-11-06T09:00:00Z'),
      githubUpdatedAt: new Date('2026-11-06T10:00:00Z'),
      ...over,
    },
  });
}

const requestsTo = (fragment: string) => fake.requests.filter((r) => r.path.includes(fragment));

beforeAll(async () => {
  await seedGithubApp({ fake });
  fake.addInstallation(INSTALLATION_ID, ['acme-labs/widget']);
  ctx = await createTestContext('rec1');
  member = await addMemberToContext(ctx);
  repoLinkId = (
    await prisma.githubRepoLink.create({
      data: {
        projectId: ctx.projectId,
        repoId: BigInt(REPO_ID),
        installationId: BigInt(INSTALLATION_ID),
        owner: 'acme-labs',
        name: 'widget',
        fullName: 'acme-labs/widget',
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/acme-labs/widget',
        linkedById: ctx.owner.id,
      },
    })
  ).id;
  onGithubOutcome(async (outcome) => {
    if (outcome.repoLinkId === repoLinkId) outcomes.push(outcome);
  });
});

const installationRow = { accountLogin: 'acme-labs', accountType: 'Organization' };

beforeEach(async () => {
  outcomes.length = 0;
  // A link is read only while its installation is known and not removed
  await prisma.githubInstallation.create({
    data: { id: BigInt(INSTALLATION_ID), ...installationRow },
  });
  fake.setJobLog(JOB_ID, LOG);
  await prisma.githubRepoLink.update({
    where: { id: repoLinkId },
    data: {
      lastReconciledAt: null,
      lastReconcileError: null,
      lastReconcileNote: null,
      reconcileLeaseUntil: null,
      reconcileLeaseToken: null,
    },
  });
});

afterEach(async () => {
  await prisma.githubCheckRun.deleteMany({ where: { repoLinkId } });
  await prisma.githubPullRequest.deleteMany({ where: { repoLinkId } });
  await prisma.githubBranch.deleteMany({ where: { repoLinkId } });
  await prisma.githubDelivery.deleteMany({ where: { id: { startsWith: 'rec-del-' } } });
  await prisma.githubInstallation.deleteMany();
});

afterAll(async () => {
  await cleanupTestContext(ctx);
});

describe('reconcileRepo', () => {
  it('stores a PR opened on GitHub that no webhook told of, once', async () => {
    fake.setRepoLists('acme-labs/widget', { pulls: [pr(3)], branches: [], checkRuns: {} });

    const result = await reconcileRepo(repoLinkId);

    expect(result).toMatchObject({ pullRequests: 1, complete: true });
    const row = await prisma.githubPullRequest.findFirstOrThrow({ where: { repoLinkId } });
    expect(row).toMatchObject({ number: 3, state: 'OPEN', headSha: sha(3) });
    expect(outcomes.map((o) => [o.source, o.transitions])).toEqual([['reconcile', ['pr_opened']]]);
    // A second round finds nothing new and tells nobody
    await reconcileRepo(repoLinkId);
    expect(outcomes).toHaveLength(1);
  });

  it('merges a PR that was closed on GitHub while its webhook never arrived, and reports it once', async () => {
    await seedPr(7);
    fake.setRepoLists('acme-labs/widget', {
      pulls: [
        pr(7, {
          state: 'closed',
          merged: true,
          merged_at: '2026-11-06T11:00:00Z',
          closed_at: '2026-11-06T11:00:00Z',
          updated_at: '2026-11-06T11:00:00Z',
        }),
      ],
      branches: [],
      checkRuns: {},
    });

    const result = await reconcileRepo(repoLinkId);

    expect(result.pullRequests).toBe(1);
    const row = await prisma.githubPullRequest.findFirstOrThrow({
      where: { repoLinkId, number: 7 },
    });
    expect(row.state).toBe('MERGED');
    expect(requestsTo('/pulls/7')).toHaveLength(1);
    expect(outcomes.map((o) => [o.source, o.transitions])).toEqual([['reconcile', ['pr_merged']]]);
    await reconcileRepo(repoLinkId);
    expect(outcomes).toHaveLength(1);
  });

  it('stores a failed check the webhook missed, with the end of its log', async () => {
    fake.setRepoLists('acme-labs/widget', {
      pulls: [pr(8, { head: { ref: 'feature-8', sha: SHA_A } })],
      branches: [],
      checkRuns: { [SHA_A]: [checkRun()] },
    });

    const result = await reconcileRepo(repoLinkId);

    expect(result.checkRuns).toBe(1);
    const row = await prisma.githubCheckRun.findUniqueOrThrow({ where: { id: String(JOB_ID) } });
    expect(row).toMatchObject({ conclusion: 'failure', failedStep: 'Run tests', repoLinkId });
    expect(row.logTail!.split('\n').at(-1)).toBe('##[error]Process completed with exit code 1.');
    expect(outcomes.find((o) => o.transitions.includes('checks_failed'))?.source).toBe('reconcile');
    // Every request of the run counts, the job and the log included
    expect(result.calls).toBe(fake.requests.length);
    expect(requestsTo('/logs').length).toBeGreaterThan(0);

    // A run that has not changed reports nothing and fetches nothing
    const seen = outcomes.length;
    const requestsBefore = fake.requests.length;
    const jobRequests = requestsTo('/actions/jobs').length;
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { lastReconciledAt: null },
    });
    await reconcileRepo(repoLinkId);
    expect(outcomes).toHaveLength(seen);
    expect(requestsTo('/actions/jobs')).toHaveLength(jobRequests);
    expect(fake.requests.length).toBeGreaterThan(requestsBefore);
    // As the installation
    expect(requestsTo('/check-runs')[0].headers.authorization).toBe(
      `installation:${INSTALLATION_ID}`,
    );
  });

  it('fetches a log again that was forbidden, within the hour limit', async () => {
    fake.setRepoLists('acme-labs/widget', {
      pulls: [pr(8, { head: { ref: 'feature-8', sha: SHA_A } })],
      branches: [],
      checkRuns: { [SHA_A]: [checkRun()] },
    });
    fake.setJobLog(JOB_ID, LOG, 'gone');
    await reconcileRepo(repoLinkId);
    const first = await prisma.githubCheckRun.findUniqueOrThrow({ where: { id: String(JOB_ID) } });
    expect(first.logTail).toBeNull();
    expect(first.logUnavailable).toBe(true);

    // Not asked again within the hour
    const before = requestsTo('/logs').length;
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { lastReconciledAt: null },
    });
    await reconcileRepo(repoLinkId);
    expect(requestsTo('/logs').length).toBe(before);
  });

  it('marks a branch that was deleted on GitHub as deleted, and keeps the ones it still lists', async () => {
    const gone = await prisma.githubBranch.create({
      data: {
        repoLinkId,
        name: `${ctx.projectPrefix}-1-gone`,
        headSha: sha(90),
        lastPushedAt: PUSHED,
      },
    });
    const kept = await prisma.githubBranch.create({
      data: {
        repoLinkId,
        name: `${ctx.projectPrefix}-2-kept`,
        headSha: sha(91),
        lastPushedAt: PUSHED,
      },
    });
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'One',
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    for (const b of [gone, kept]) {
      await prisma.githubIssueLink.create({
        data: {
          repoLinkId,
          issueId: issue.id,
          targetType: 'BRANCH',
          targetKey: b.id,
          sources: ['BRANCH_NAME'],
        },
      });
    }
    fake.setRepoLists('acme-labs/widget', {
      pulls: [],
      branches: [
        { name: kept.name, sha: sha(92) },
        { name: `${ctx.projectPrefix}-3-new`, sha: sha(93) },
        { name: 'main', sha: sha(94) },
      ],
      checkRuns: {},
    });

    const result = await reconcileRepo(repoLinkId);

    const rows = await prisma.githubBranch.findMany({ where: { repoLinkId } });
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(byName.get(gone.name)?.deletedAt).not.toBeNull();
    // Our clock never becomes the time of a push
    expect(byName.get(gone.name)?.lastPushedAt).toEqual(PUSHED);
    expect(byName.get(kept.name)?.lastPushedAt).toEqual(PUSHED);
    expect(byName.get(kept.name)).toMatchObject({ deletedAt: null, headSha: sha(92) });
    // A branch with a key is stored; one that names no issue is not
    expect(byName.get(`${ctx.projectPrefix}-3-new`)?.headSha).toBe(sha(93));
    expect(byName.has('main')).toBe(false);
    expect(result.branches).toBe(3);
    await prisma.githubIssueLink.deleteMany({ where: { repoLinkId } });
    await prisma.issue.delete({ where: { id: issue.id } });
  });

  it('stops at the call budget, says it is incomplete and still sets lastReconciledAt', async () => {
    const pulls = Array.from({ length: 400 }, (_, i) => pr(i + 1));
    fake.setRepoLists('acme-labs/widget', { pulls, branches: [], checkRuns: {} });

    const result = await reconcileRepo(repoLinkId, { callBudget: 3 });

    // The installation token request counts too
    expect(result).toMatchObject({ complete: false, pullRequests: 300 });
    expect(result.calls).toBe(fake.requests.length);
    expect(result.reason).toContain('budget');
    const link = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } });
    expect(link.lastReconciledAt).not.toBeNull();
    expect(link.reconcileLeaseUntil).toBeNull();
    expect(requestsTo('/pulls').filter((r) => r.path.endsWith('/pulls'))).toHaveLength(3);
    // The list was cut short: a PR missing from it is not taken for closed
    expect(requestsTo('/pulls/')).toHaveLength(0);
  }, 60_000);

  it('has a default budget of 300 calls and a 15 minute interval', () => {
    expect(RECONCILE_CALL_BUDGET).toBe(300);
    expect(RECONCILE_INTERVAL_MS).toBe(15 * 60_000);
  });

  it('lets one of two parallel calls run and answers the other 409', async () => {
    fake.on('GET /repos/:owner/:repo/pulls', { status: 200, body: [], delayMs: 300 });
    fake.setRepoLists('acme-labs/widget', { branches: [] });

    const results = await Promise.allSettled([
      reconcileRepo(repoLinkId),
      reconcileRepo(repoLinkId),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(AppError);
    expect(rejected[0].reason).toMatchObject({
      statusCode: 409,
      code: 'GITHUB_RECONCILE_RUNNING',
    });
  });

  it('frees the lease when it fails, records the message only, and a crashed lease expires', async () => {
    fake.on('GET /repos/:owner/:repo/pulls', { status: 500, body: { message: 'Boom' } });

    // A phase that fails ends alone: the run is over, incomplete, and says why
    const failed = await reconcileRepo(repoLinkId);
    expect(failed.complete).toBe(false);

    const link = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } });
    expect(link.reconcileLeaseUntil).toBeNull();
    expect(link.lastReconcileError).toEqual(expect.any(String));
    expect(link.lastReconciledAt).not.toBeNull();

    // A lease that is still live refuses; one that ran out is taken over
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { reconcileLeaseUntil: new Date(Date.now() + 60_000) },
    });
    await expect(reconcileRepo(repoLinkId)).rejects.toMatchObject({ statusCode: 409 });
    fake.reset();
    fake.setRepoLists('acme-labs/widget', { pulls: [], branches: [], checkRuns: {} });
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { reconcileLeaseUntil: new Date(Date.now() - 1000) },
    });
    await reconcileRepo(repoLinkId);
    const after = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } });
    expect(after.lastReconcileError).toBeNull();
  });

  it('answers 404 for a link that is gone', async () => {
    await expect(reconcileRepo('no-such-link')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('reconcileDueRepos', () => {
  it.each([
    ['no installation row', () => prisma.githubInstallation.deleteMany()],
    [
      'a removed installation',
      () =>
        prisma.githubInstallation.update({
          where: { id: BigInt(INSTALLATION_ID) },
          data: { removedAt: new Date() },
        }),
    ],
  ])('leaves out a due link with %s', async (_name, spoil) => {
    await spoil();
    expect(await dueRepoLinkIds(1000)).not.toContain(repoLinkId);
    const before = requestsTo('/').length;
    await reconcileDueRepos(1000);
    expect(requestsTo('/').length).toBe(before);
  });

  it('takes a repo reconciled 20 minutes ago and skips one reconciled 5 minutes ago', async () => {
    const minutes = (m: number) => new Date(Date.now() - m * 60_000);
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { lastReconciledAt: minutes(5) },
    });
    expect(await dueRepoLinkIds(1000)).not.toContain(repoLinkId);

    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { lastReconciledAt: minutes(20) },
    });
    expect(await dueRepoLinkIds(1000)).toContain(repoLinkId);

    // A live lease keeps it out; a never reconciled link is due
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { reconcileLeaseUntil: new Date(Date.now() + 60_000) },
    });
    expect(await dueRepoLinkIds(1000)).not.toContain(repoLinkId);
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { reconcileLeaseUntil: null, lastReconciledAt: null },
    });
    expect(await dueRepoLinkIds(1000)).toContain(repoLinkId);
  });

  it('reconciles the due ones and counts them', async () => {
    fake.setRepoLists('acme-labs/widget', { pulls: [pr(5)], branches: [], checkRuns: {} });
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { lastReconciledAt: new Date(Date.now() - 20 * 60_000) },
    });

    const count = await reconcileDueRepos(1000);

    expect(count).toBeGreaterThanOrEqual(1);
    const link = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } });
    expect(Date.now() - link.lastReconciledAt!.getTime()).toBeLessThan(60_000);
    expect(await prisma.githubPullRequest.count({ where: { repoLinkId } })).toBe(1);
  });
});

describe('githubRepo.reconcile and githubRepo.health', () => {
  const url = (suffix: string) => `/api/projects/${ctx.projectId}/github/${suffix}`;
  const asOwner = () => ({ ...CSRF, Authorization: `Bearer ${ctx.owner.token}` });
  const asMember = () => ({ ...CSRF, Authorization: `Bearer ${member.token}` });

  it('refuses a team MEMBER the reconcile with 403 and lets the owner run it', async () => {
    fake.setRepoLists('acme-labs/widget', { pulls: [pr(4)], branches: [], checkRuns: {} });

    const refused = await request(app).post(url('reconcile')).set(asMember()).send({});
    expect(refused.status).toBe(403);

    const ok = await request(app).post(url('reconcile')).set(asOwner()).send({});
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ pullRequests: 1, complete: true });
  });

  it('answers 404 when the project is not linked', async () => {
    const unlinked = await createTestContext('rec2');
    try {
      const res = await request(app)
        .post(`/api/projects/${unlinked.projectId}/github/reconcile`)
        .set({ ...CSRF, Authorization: `Bearer ${unlinked.owner.token}` })
        .send({});
      expect(res.status).toBe(404);
    } finally {
      await cleanupTestContext(unlinked);
    }
  });

  it('lists a failed delivery of this repo and never shows its payload', async () => {
    await prisma.githubDelivery.createMany({
      data: [
        {
          id: 'rec-del-failed-1',
          event: 'pull_request',
          action: 'closed',
          repoId: BigInt(REPO_ID),
          status: 'FAILED',
          attempts: 5,
          error: 'The handler failed',
          payload: { secret_marker: 'do-not-show' },
        },
        {
          id: 'rec-del-old',
          event: 'push',
          repoId: BigInt(REPO_ID),
          status: 'FAILED',
          attempts: 5,
          receivedAt: new Date(Date.now() - 8 * 24 * 3600_000),
        },
        { id: 'rec-del-ok', event: 'push', repoId: BigInt(REPO_ID), status: 'PROCESSED' },
        { id: 'rec-del-other', event: 'push', repoId: BigInt(REPO_ID + 1), status: 'FAILED' },
      ],
    });

    const res = await request(app).get(url('health')).set(asMember());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      linked: true,
      repoFullName: 'acme-labs/widget',
      appInstalled: true,
      installationSuspended: false,
      appSecretUnreadable: false,
    });
    expect(res.body.recentFailures).toEqual([
      expect.objectContaining({
        deliveryId: 'rec-del-failed-1',
        event: 'pull_request',
        action: 'closed',
        error: 'The handler failed',
        attempts: 5,
      }),
    ]);
    expect(JSON.stringify(res.body)).not.toContain('do-not-show');
    expect(res.body.recentFailures[0]).not.toHaveProperty('payload');
  });

  it('reports an installation that is suspended or gone', async () => {
    await prisma.githubInstallation.deleteMany();
    const gone = await request(app).get(url('health')).set(asOwner());
    expect(gone.body).toMatchObject({ linked: true, appInstalled: false });

    await prisma.githubInstallation.create({
      data: { id: BigInt(INSTALLATION_ID), ...installationRow, suspendedAt: new Date() },
    });
    const suspended = await request(app).get(url('health')).set(asOwner());
    expect(suspended.body).toMatchObject({ appInstalled: true, installationSuspended: true });
  });

  it('reports a GitHub App whose secrets cannot be opened', async () => {
    await prisma.githubApp.update({
      where: { id: 1 },
      data: {
        privateKey: encryptSecret('x', secretContext('githubApp', 'privateKey', '2')),
        createdAt: new Date(),
      },
    });
    try {
      const res = await request(app).get(url('health')).set(asOwner());
      expect(res.status).toBe(200);
      expect(res.body.appSecretUnreadable).toBe(true);
    } finally {
      await seedGithubApp({ fake });
    }
  });

  it('answers linked: false for a project without a link', async () => {
    const unlinked = await createTestContext('rec3');
    try {
      const res = await request(app)
        .get(`/api/projects/${unlinked.projectId}/github/health`)
        .set({ ...CSRF, Authorization: `Bearer ${unlinked.owner.token}` });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ linked: false, recentFailures: [] });
    } finally {
      await cleanupTestContext(unlinked);
    }
  });
});

async function seedLinkedBranch(name: string, headSha: string, lastPushedAt: Date | null = PUSHED) {
  const branch = await prisma.githubBranch.create({
    data: { repoLinkId, name, headSha, lastPushedAt },
  });
  const issue = await prisma.issue.create({
    data: {
      projectId: ctx.projectId,
      number: Math.floor(Math.random() * 1_000_000) + 100,
      title: 'Branch issue',
      body: '',
      creatorId: ctx.owner.id,
    },
  });
  await prisma.githubIssueLink.create({
    data: {
      repoLinkId,
      issueId: issue.id,
      targetType: 'BRANCH',
      targetKey: branch.id,
      sources: ['BRANCH_NAME'],
    },
  });
  return branch;
}

const waitForRequest = (fragment: string) =>
  vi.waitFor(() => expect(requestsTo(fragment).length).toBeGreaterThan(0));

describe('push ordering of branches', () => {
  afterEach(async () => {
    await prisma.githubIssueLink.deleteMany({ where: { repoLinkId } });
    await prisma.issue.deleteMany({ where: { projectId: ctx.projectId } });
  });

  it('does not delete a branch that was pushed after the list was asked for', async () => {
    const name = `${ctx.projectPrefix}-5-race`;
    await seedLinkedBranch(name, sha(60));
    fake.setRepoLists('acme-labs/widget', { pulls: [], checkRuns: {} });
    fake.on('GET /repos/:owner/:repo/branches', { status: 200, body: [], delayMs: 400 });

    const run = reconcileRepo(repoLinkId);
    await waitForRequest('/branches');
    // The branch was re-created while GitHub was still answering the list
    await storeBranch(repoLinkId, { name, sha: sha(61) }, null, 'webhook', {
      event: 'push',
      at: new Date(Date.now() + 1000),
    });
    await run;

    const row = await prisma.githubBranch.findFirstOrThrow({ where: { repoLinkId, name } });
    expect(row).toMatchObject({ deletedAt: null, headSha: sha(61) });
  });

  it('does not revive a branch that was deleted after the list was asked for', async () => {
    const name = `${ctx.projectPrefix}-6-race`;
    await seedLinkedBranch(name, sha(62));
    fake.setRepoLists('acme-labs/widget', { pulls: [], checkRuns: {} });
    fake.on('GET /repos/:owner/:repo/branches', {
      status: 200,
      body: [{ name, commit: { sha: sha(63) } }],
      delayMs: 400,
    });

    const run = reconcileRepo(repoLinkId);
    await waitForRequest('/branches');
    await storeBranch(repoLinkId, { name, sha: null }, null, 'webhook', {
      event: 'delete',
      at: new Date(Date.now() + 1000),
    });
    await run;

    const row = await prisma.githubBranch.findFirstOrThrow({ where: { repoLinkId, name } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.headSha).toBe(sha(62));
    expect(outcomes.some((o) => o.transitions.includes('branch_created'))).toBe(false);
  });

  it('revives a branch GitHub lists again when nothing newer was written, keeping its push time', async () => {
    const name = `${ctx.projectPrefix}-7-back`;
    const branch = await seedLinkedBranch(name, sha(64));
    await prisma.githubBranch.update({ where: { id: branch.id }, data: { deletedAt: new Date() } });
    fake.setRepoLists('acme-labs/widget', {
      pulls: [],
      checkRuns: {},
      branches: [{ name, sha: sha(65) }],
    });

    await reconcileRepo(repoLinkId);

    const row = await prisma.githubBranch.findFirstOrThrow({ where: { repoLinkId, name } });
    expect(row).toMatchObject({ deletedAt: null, headSha: sha(65), lastPushedAt: PUSHED });
  });
});

describe('the lease', () => {
  it('does not clear, or write over, a lease another run holds now', async () => {
    fake.setRepoLists('acme-labs/widget', { checkRuns: {}, branches: [] });
    fake.on('GET /repos/:owner/:repo/pulls', { status: 200, body: [], delayMs: 400 });

    const run = reconcileRepo(repoLinkId);
    await waitForRequest('/pulls');
    // This run's lease ran out and a newer run took the link over
    const until = new Date(Date.now() + 5 * 60_000);
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { reconcileLeaseToken: 'newer-run', reconcileLeaseUntil: until },
    });

    await expect(run).rejects.toMatchObject({ code: 'GITHUB_RECONCILE_LEASE_LOST' });

    const link = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } });
    expect(link).toMatchObject({
      reconcileLeaseToken: 'newer-run',
      reconcileLeaseUntil: until,
      lastReconciledAt: null,
      lastReconcileError: null,
    });
  });

  it('extends the lease between phases', async () => {
    fake.setRepoLists('acme-labs/widget', { checkRuns: {} });
    fake.on('GET /repos/:owner/:repo/pulls', { status: 200, body: [], delayMs: 300 });
    fake.on('GET /repos/:owner/:repo/branches', { status: 200, body: [], delayMs: 500 });
    const soon = new Date(Date.now() + 2_000);

    const run = reconcileRepo(repoLinkId);
    await vi.waitFor(async () => {
      const link = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } });
      expect(link.reconcileLeaseToken).not.toBeNull();
    });
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { reconcileLeaseUntil: soon },
    });
    await waitForRequest('/branches');
    const link = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } });
    expect(link.reconcileLeaseUntil!.getTime()).toBeGreaterThan(Date.now() + 5 * 60_000);
    await run;
  });
});

describe('budget and phases', () => {
  it('counts a renewed token and its retry', async () => {
    fake.setRepoLists('acme-labs/widget', { pulls: [pr(1)], branches: [], checkRuns: {} });
    // GitHub revoked the cached token early: the first request is refused, renewed and repeated
    fake.revokeInstallationTokens(INSTALLATION_ID);

    const result = await reconcileRepo(repoLinkId);

    expect(result.calls).toBe(fake.requests.length);
    expect(requestsTo('/access_tokens').length).toBeGreaterThan(0);
  });

  it('lets a phase that fails end alone, and records the error', async () => {
    fake.setRepoLists('acme-labs/widget', {
      pulls: [pr(8, { head: { ref: 'feature-8', sha: SHA_A } })],
      branches: [{ name: `${ctx.projectPrefix}-9-next`, sha: sha(70) }],
    });
    fake.on('GET /repos/:owner/:repo/commits/:sha/check-runs', {
      status: 403,
      body: { message: 'Resource not accessible by integration' },
    });

    const result = await reconcileRepo(repoLinkId);

    expect(result.complete).toBe(false);
    expect(result.reason).toContain('check runs');
    expect(await prisma.githubBranch.count({ where: { repoLinkId } })).toBe(1);
    const link = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } });
    expect(link.lastReconcileError).toEqual(expect.any(String));
    expect(link.lastReconcileNote).toContain('check runs');
  });

  it('keeps a share of the budget for the branches', async () => {
    const pulls = Array.from({ length: 70 }, (_, i) =>
      pr(i + 1, { head: { ref: `f-${i}`, sha: sha(1000 + i) } }),
    );
    fake.setRepoLists('acme-labs/widget', {
      pulls,
      checkRuns: {},
      branches: [{ name: `${ctx.projectPrefix}-9-last`, sha: sha(71) }],
    });

    const result = await reconcileRepo(repoLinkId, { callBudget: 60 });

    expect(result.complete).toBe(false);
    expect(result.reason).toContain('budget');
    expect(await prisma.githubBranch.count({ where: { repoLinkId } })).toBe(1);
  }, 60_000);

  it('asks about the least recently updated open PRs first', async () => {
    for (const [n, hour] of [
      [10, 12],
      [11, 11],
      [12, 9],
    ] as const) {
      await seedPr(n, {
        githubUpdatedAt: new Date(`2026-11-06T${String(hour).padStart(2, '0')}:00:00Z`),
      });
    }
    fake.setRepoLists('acme-labs/widget', { pulls: [], branches: [], checkRuns: {} });

    await reconcileRepo(repoLinkId);

    expect(requestsTo('/pulls/').map((r) => r.path.split('/').pop())).toEqual(['12', '11', '10']);
  });

  it('says in health that only the first 500 open PRs were read', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      // Five full pages that never end: every item is skipped as unreadable, cheaply
      fake.on('GET /repos/:owner/:repo/pulls', (req) => {
        const page = Number(req.query.page ?? 1);
        const headers: Record<string, string> = {};
        const next = new URL(req.path, fake.url);
        next.searchParams.set('page', String(page + 1));
        headers.link = `<${next.toString()}>; rel="next"`;
        return { status: 200, body: Array.from({ length: 100 }, () => ({})), headers };
      });
      fake.setRepoLists('acme-labs/widget', { branches: [], checkRuns: {} });

      const result = await reconcileRepo(repoLinkId);
      expect(result.complete).toBe(false);
      expect(result.reason).toContain('first 500');
    } finally {
      warn.mockRestore();
    }
    const health = await request(app)
      .get(`/api/projects/${ctx.projectId}/github/health`)
      .set({ ...CSRF, Authorization: `Bearer ${ctx.owner.token}` });
    expect(health.body.reconcileComplete).toBe(false);
    expect(health.body.reconcileIncompleteReason).toContain('first 500');
  }, 60_000);
});

describe('the manual reconcile and links made through the action', () => {
  const url = () => `/api/projects/${ctx.projectId}/github/reconcile`;
  const asOwner = () => ({ ...CSRF, Authorization: `Bearer ${ctx.owner.token}` });

  it('refuses a second run within a minute with 429 and a retry time', async () => {
    fake.setRepoLists('acme-labs/widget', { pulls: [], branches: [], checkRuns: {} });
    expect((await request(app).post(url()).set(asOwner()).send({})).status).toBe(201);

    const again = await request(app).post(url()).set(asOwner()).send({});

    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe('GITHUB_RECONCILE_COOLDOWN');
    expect(again.body.error.details.retryAfter).toBeGreaterThan(0);
    expect(again.body.error.details.retryAfter).toBeLessThanOrEqual(60);
  });

  it.each([
    ['unknown', () => prisma.githubInstallation.deleteMany()],
    [
      'removed',
      () =>
        prisma.githubInstallation.update({
          where: { id: BigInt(INSTALLATION_ID) },
          data: { removedAt: new Date() },
        }),
    ],
  ])('answers 409 GITHUB_APP_NOT_INSTALLED when the installation is %s', async (_n, spoil) => {
    await spoil();
    const before = fake.requests.length;
    const res = await request(app).post(url()).set(asOwner()).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_APP_NOT_INSTALLED');
    expect(fake.requests.length).toBe(before);
    const health = await request(app)
      .get(`/api/projects/${ctx.projectId}/github/health`)
      .set(asOwner());
    expect(health.body.appInstalled).toBe(false);
    expect(health.body.installationRemoved).toBe(spoil.toString().includes('removedAt'));
  });

  it('really reconciles a link made through githubRepo.link', async () => {
    const linked = await createTestContext('rec4');
    const accountId = `acct-${linked.owner.id}`;
    try {
      fake.addInstallation(INSTALLATION_ID, ['acme-labs/widget', 'acme-labs/gadget']);
      const userToken = fake.issueUserToken('octo-dev', ['acme-labs/gadget'], {
        admin: ['acme-labs/gadget'],
      });
      await prisma.githubAccount.create({
        data: {
          id: accountId,
          userId: linked.owner.id,
          githubUserId: 9301,
          login: 'octo-dev',
          accessToken: encryptSecret(
            userToken,
            secretContext('githubAccount', 'accessToken', accountId),
          ),
        },
      });
      fake.setRepoLists('acme-labs/gadget', { pulls: [pr(1)], branches: [], checkRuns: {} });

      const res = await request(app)
        .post(`/api/projects/${linked.projectId}/github`)
        .set({ ...CSRF, Authorization: `Bearer ${linked.owner.token}` })
        .send({ repo: 'acme-labs/gadget' });
      expect(res.status).toBeLessThan(300);

      await vi.waitFor(async () => {
        expect(
          await prisma.githubPullRequest.count({
            where: { repoLink: { projectId: linked.projectId } },
          }),
        ).toBe(1);
      });
      const link = await prisma.githubRepoLink.findFirstOrThrow({
        where: { projectId: linked.projectId },
      });
      await vi.waitFor(async () => {
        const fresh = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } });
        expect(fresh.lastReconciledAt).not.toBeNull();
        expect(fresh.lastReconcileError).toBeNull();
      });
    } finally {
      await prisma.githubAccount.deleteMany({ where: { id: accountId } });
      await cleanupTestContext(linked);
    }
  });
});

describe('health of the installation and the secrets', () => {
  const health = () =>
    request(app)
      .get(`/api/projects/${ctx.projectId}/github/health`)
      .set({ ...CSRF, Authorization: `Bearer ${ctx.owner.token}` });

  it('tells a removed installation from a suspended one', async () => {
    await prisma.githubInstallation.update({
      where: { id: BigInt(INSTALLATION_ID) },
      data: { removedAt: new Date() },
    });
    expect((await health()).body).toMatchObject({
      appInstalled: false,
      installationRemoved: true,
      installationSuspended: false,
    });
  });

  it('opens the App secrets once per App generation, not on every read', async () => {
    await seedGithubApp({ fake });
    expect((await health()).body.appSecretUnreadable).toBe(false);
    // The row is spoiled without a new generation: the answer is the cached one
    await prisma.githubApp.update({
      where: { id: 1 },
      data: { privateKey: encryptSecret('x', secretContext('githubApp', 'privateKey', '2')) },
    });
    try {
      expect((await health()).body.appSecretUnreadable).toBe(false);
      // A re-created App is a new generation and is looked at again
      await prisma.githubApp.update({ where: { id: 1 }, data: { createdAt: new Date() } });
      expect((await health()).body.appSecretUnreadable).toBe(true);
    } finally {
      await seedGithubApp({ fake });
    }
  });
});
