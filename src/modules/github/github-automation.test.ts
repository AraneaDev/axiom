import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
} from '../../test/factory';
import { useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';
import { postWebhook } from '../../test/github-webhook';
import { logger } from '../../utils/logger';
import {
  createRule,
  type AutomationAction,
  type AutomationTrigger,
} from '../automation/automation.service';

import { fireGithubTriggers, registerCommentGuard, TRANSITION_TRIGGERS } from './github-automation';
import { GITHUB_INTEGRATION_USER_ID } from './integration-user';
import './github-resolvers';
import { reconcileRepo } from './reconcile.service';
import './webhook-handlers';

const REPO_ID = 880_700;
const INSTALLATION_ID = 4701;
const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';
const LOG = readFileSync(
  path.join(__dirname, '../../test/__fixtures__/github/checks/job-log.txt'),
  'utf8',
);

const fake = useGithubFake('checks');
let ctx: TestContext;
let repoLinkId: string;
let issue1: string;
let issue2: string;
let doneColumn: string;
let p: string;

type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const repository = {
  id: REPO_ID,
  name: 'widget',
  full_name: 'acme-labs/widget',
  html_url: 'https://github.com/acme-labs/widget',
  owner: { login: 'acme-labs', id: 4001 },
};

function pr(over: Payload = {}): Payload {
  return {
    number: 21,
    title: 'Add the widget',
    body: null,
    state: 'open',
    draft: false,
    merged: false,
    user: { id: 7001, login: 'voorbeeld-dev' },
    head: { ref: `${p}-1-x`, sha: SHA_A },
    base: { ref: 'main' },
    requested_reviewers: [],
    html_url: 'https://github.com/acme-labs/widget/pull/21',
    created_at: '2026-11-06T09:00:00Z',
    updated_at: '2026-11-06T10:00:00Z',
    merged_at: null,
    closed_at: null,
    ...over,
  };
}

function run(id: number, sha = SHA_A, over: Payload = {}): Payload {
  return {
    id,
    name: `job ${id}`,
    head_sha: sha,
    status: 'completed',
    conclusion: 'failure',
    started_at: '2026-11-06T10:00:05Z',
    completed_at: '2026-11-06T10:03:05Z',
    html_url: `https://github.com/acme-labs/widget/runs/${id}`,
    details_url: `https://github.com/acme-labs/widget/actions/runs/88100/job/${id}`,
    output: { title: null, summary: null, text: null },
    app: { id: 15368, slug: 'github-actions', name: 'GitHub Actions' },
    ...over,
  };
}

async function deliver(event: string, payload: Payload) {
  const deliveryId = randomUUID();
  const res = await postWebhook(event, payload, { deliveryId });
  expect(res.status).toBe(202);
  await vi.waitFor(async () => {
    const row = await prisma.githubDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(['PROCESSED', 'IGNORED', 'FAILED']).toContain(row.status);
  });
  return (await prisma.githubDelivery.findUniqueOrThrow({ where: { id: deliveryId } })).status;
}

const sender = { id: 7001, login: 'voorbeeld-dev' };
const prEvent = (action: string, pull: Payload, who: Payload = sender) =>
  deliver('pull_request', {
    action,
    number: pull.number,
    pull_request: pull,
    repository,
    sender: who,
  });
const checkEvent = (job: Payload) => {
  fake.setJobLog(job.id, LOG);
  return deliver('check_run', {
    action: 'completed',
    check_run: job,
    repository,
    sender,
    installation: { id: INSTALLATION_ID },
  });
};

function rule(trigger: AutomationTrigger, actions: AutomationAction[], name = trigger) {
  return createRule(ctx.projectId, { name, trigger, actions });
}
const say = (body: string): AutomationAction[] => [{ type: 'add_comment', body }];
const comments = async (issueId: string) =>
  prisma.comment.findMany({ where: { issueId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  await seedGithubApp({ fake });
  fake.addInstallation(INSTALLATION_ID, ['acme-labs/widget']);
  ctx = await createTestContext('gau1');
  p = ctx.projectPrefix.toLowerCase();
  const columns = await prisma.boardColumn.findMany({
    where: { projectId: ctx.projectId },
    orderBy: { position: 'desc' },
  });
  doneColumn = columns[0].id;
  for (const n of [1, 2]) {
    const row = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: n,
        title: `Issue ${n}`,
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    if (n === 1) issue1 = row.id;
    else issue2 = row.id;
  }
});

beforeEach(async () => {
  await prisma.automationRule.deleteMany({ where: { projectId: ctx.projectId } });
  await prisma.comment.deleteMany({ where: { issue: { projectId: ctx.projectId } } });
  await prisma.githubAccount.deleteMany();
  await prisma.githubInstallation.deleteMany();
  await prisma.githubInstallation.create({
    data: { id: BigInt(INSTALLATION_ID), accountLogin: 'acme-labs', accountType: 'Organization' },
  });
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  await prisma.githubDelivery.deleteMany();
  await prisma.issue.updateMany({ where: { projectId: ctx.projectId }, data: { columnId: null } });
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
        lastReconciledAt: new Date(),
        createdAt: new Date('2026-11-01T00:00:00Z'),
      },
    })
  ).id;
});

afterAll(async () => {
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  await prisma.githubInstallation.deleteMany();
  await prisma.githubAccount.deleteMany();
  await cleanupTestContext(ctx);
});

describe('transition map', () => {
  it('maps every transition to a trigger', () => {
    expect(TRANSITION_TRIGGERS).toEqual({
      pr_opened: 'pr:opened',
      pr_reopened: 'pr:opened',
      pr_ready_for_review: 'pr:opened',
      pr_merged: 'pr:merged',
      pr_closed: 'pr:closed',
      reviewers_added: 'pr:review_requested',
      review_added: 'pr:review_submitted',
      checks_failed: 'checks:failed',
      checks_passed: 'checks:passed',
      branch_created: 'branch:created',
    });
  });
});

describe('rule triggers', () => {
  it('accepts each new trigger and rejects an unknown one', async () => {
    const post = (trigger: string) =>
      request(app)
        .post(`/api/projects/${ctx.projectId}/automation-rules`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: trigger, trigger, actions: [] });
    for (const t of [
      'pr:opened',
      'pr:merged',
      'pr:closed',
      'pr:review_requested',
      'pr:review_submitted',
      'checks:failed',
      'checks:passed',
      'branch:created',
    ]) {
      expect((await post(t)).status).toBe(201);
    }
    expect((await post('pr:unknown')).status).toBe(400);
  });
});

describe('pull request triggers', () => {
  it('fires pr:opened for an issue named in the branch and not for one named only in the body', async () => {
    await rule('pr:opened', say('opened'));
    await prEvent('opened', pr({ body: `Mentions ${ctx.projectPrefix}-2` }));
    expect(await comments(issue1)).toHaveLength(1);
    expect(await comments(issue2)).toHaveLength(0);
  });

  it('fires nothing for a draft until it is ready for review', async () => {
    await rule('pr:opened', say('opened'));
    await prEvent('opened', pr({ draft: true }));
    expect(await comments(issue1)).toHaveLength(0);
    await prEvent('ready_for_review', pr({ draft: false, updated_at: '2026-11-06T10:05:00Z' }));
    expect(await comments(issue1)).toHaveLength(1);
  });

  it('fires pr:merged on a merge and pr:closed on a close without merging', async () => {
    await rule('pr:merged', say('merged'));
    await rule('pr:closed', say('closed'));
    await prEvent('opened', pr());
    await prEvent(
      'closed',
      pr({
        state: 'closed',
        merged: true,
        merged_at: '2026-11-06T11:00:00Z',
        closed_at: '2026-11-06T11:00:00Z',
        updated_at: '2026-11-06T11:00:00Z',
      }),
    );
    expect((await comments(issue1)).map((c) => c.body)).toEqual(['merged']);
    await prEvent('opened', pr({ number: 22, head: { ref: `${p}-2-y`, sha: SHA_B } }));
    await prEvent(
      'closed',
      pr({
        number: 22,
        head: { ref: `${p}-2-y`, sha: SHA_B },
        state: 'closed',
        closed_at: '2026-11-06T11:00:00Z',
        updated_at: '2026-11-06T11:00:00Z',
      }),
    );
    expect((await comments(issue2)).map((c) => c.body)).toEqual(['closed']);
  });

  it('fires review_requested and review_submitted', async () => {
    await rule('pr:review_requested', say('asked'));
    await rule('pr:review_submitted', say('{{github.review.author}} {{github.review.state}}'));
    await prEvent('opened', pr());
    await prEvent(
      'review_requested',
      pr({
        requested_reviewers: [{ id: 7002, login: 'review-bot' }],
        updated_at: '2026-11-06T10:01:00Z',
      }),
    );
    await deliver('pull_request_review', {
      action: 'submitted',
      review: {
        id: 5001,
        user: { id: 7002, login: 'review-bot' },
        state: 'approved',
        body: 'ok',
        commit_id: SHA_A,
        submitted_at: '2026-11-06T12:00:00Z',
      },
      pull_request: pr({ updated_at: '2026-11-06T10:01:00Z' }),
      repository,
      sender: { id: 7002, login: 'review-bot' },
    });
    expect((await comments(issue1)).map((c) => c.body)).toEqual(['asked', 'review\\-bot approved']);
  });

  it('resolves a template over the pull request', async () => {
    await rule(
      'pr:merged',
      say('Merged in {{github.pr.url}} by {{github.actorLogin}} on {{github.repo}}'),
    );
    await prEvent('opened', pr());
    await prEvent(
      'closed',
      pr({
        state: 'closed',
        merged: true,
        merged_at: '2026-11-06T11:00:00Z',
        closed_at: '2026-11-06T11:00:00Z',
        updated_at: '2026-11-06T11:00:00Z',
      }),
    );
    expect((await comments(issue1)).map((c) => c.body)).toEqual([
      'Merged in https://github.com/acme-labs/widget/pull/21 by voorbeeld\\-dev on acme\\-labs/widget',
    ]);
  });

  it('fires once when the same merge arrives by webhook and then by reconcile', async () => {
    await rule('pr:merged', say('merged'));
    await prEvent('opened', pr());
    const merged = pr({
      state: 'closed',
      merged: true,
      merged_at: '2026-11-06T11:00:00Z',
      closed_at: '2026-11-06T11:00:00Z',
      updated_at: '2026-11-06T11:00:00Z',
    });
    await prEvent('closed', merged);
    fake.setRepoLists('acme-labs/widget', { pulls: [merged], branches: [], checkRuns: {} });
    await reconcileRepo(repoLinkId);
    expect(await comments(issue1)).toHaveLength(1);
  });
});

describe('check triggers', () => {
  it('fires checks:failed once for two failed runs at one SHA and again after a new push fails', async () => {
    await rule('checks:failed', say('failed: {{github.checks.failedNames}}'));
    await prEvent('opened', pr());
    await checkEvent(run(4701));
    await checkEvent(run(4702));
    expect((await comments(issue1)).map((c) => c.body)).toEqual(['failed: job 4701']);
    await prEvent(
      'synchronize',
      pr({ head: { ref: `${p}-1-x`, sha: SHA_B }, updated_at: '2026-11-06T10:30:00Z' }),
    );
    await checkEvent(run(4703, SHA_B));
    expect(await comments(issue1)).toHaveLength(2);
  });

  it('reports a failed check stored before its pull request when the PR is stored (R1)', async () => {
    await rule('checks:failed', say('late {{github.checks.headSha}}'));
    await checkEvent(run(4704));
    expect(await comments(issue1)).toHaveLength(0);
    await prEvent('opened', pr());
    expect((await comments(issue1)).map((c) => c.body)).toEqual([`late ${SHA_A}`]);
    // The same head again reports nothing
    await prEvent('edited', pr({ title: 'Renamed', updated_at: '2026-11-06T10:10:00Z' }));
    expect(await comments(issue1)).toHaveLength(1);
  });

  it('fires checks:passed for a new head whose checks already passed', async () => {
    await rule('checks:passed', say('green'));
    await checkEvent(run(4705, SHA_A, { conclusion: 'success' }));
    await prEvent('opened', pr());
    expect((await comments(issue1)).map((c) => c.body)).toEqual(['green']);
  });
});

describe('branch trigger', () => {
  it('fires branch:created for a branch that names the issue', async () => {
    await rule('branch:created', say('branch {{github.branch.name}} {{github.branch.url}}'));
    await deliver('create', {
      ref: `${p}-1-x`,
      ref_type: 'branch',
      master_branch: 'main',
      repository,
      sender,
    });
    expect((await comments(issue1)).map((c) => c.body)).toEqual([
      `branch ${p}\\-1\\-x https://github.com/acme-labs/widget/tree/${p}-1-x`,
    ]);
  });
});

describe('actor', () => {
  const connect = (userId: string, githubUserId: number) =>
    prisma.githubAccount.create({
      data: {
        userId,
        githubUserId: BigInt(githubUserId),
        login: 'voorbeeld-dev',
        accessToken: 'x',
      },
    });

  it('is the mapped user when they belong to the project org', async () => {
    const member = await addMemberToContext(ctx);
    await connect(member.id, 7001);
    await rule('pr:opened', say('hi'));
    await prEvent('opened', pr());
    expect((await comments(issue1))[0].authorId).toBe(member.id);
  });

  it('is the integration user for an unknown sender', async () => {
    await rule('pr:opened', say('hi'));
    await prEvent('opened', pr());
    expect((await comments(issue1))[0].authorId).toBe(GITHUB_INTEGRATION_USER_ID);
  });

  it('is the integration user for a mapped user outside the project org (R2)', async () => {
    const outsider = await createTestUser();
    await connect(outsider.id, 7001);
    await rule('pr:opened', say('hi'));
    await prEvent('opened', pr());
    expect((await comments(issue1))[0].authorId).toBe(GITHUB_INTEGRATION_USER_ID);
  });
});

describe('failures', () => {
  it('logs a rule failure without the payload and does not throw', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    vi.spyOn(prisma.githubRepoLink, 'findUnique').mockRejectedValueOnce(new Error('boom'));
    onTestFinished(() => vi.restoreAllMocks());
    await expect(
      fireGithubTriggers({
        repoLinkId,
        projectId: ctx.projectId,
        event: 'pull_request',
        action: 'opened',
        source: 'webhook',
        actor: { userId: GITHUB_INTEGRATION_USER_ID, login: 'x', mapped: false },
        linkedIssueIds: [issue1],
        removedIssueIds: [],
        drivingIssueIds: [issue1],
        transitions: ['pr_merged'],
        payload: { secret: 'do-not-log' },
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toContain('do-not-log');
  });

  it('fires nothing for an outcome without transitions', async () => {
    await rule('pr:merged', say('merged'));
    await fireGithubTriggers({
      repoLinkId,
      projectId: ctx.projectId,
      event: 'pull_request',
      action: 'edited',
      source: 'webhook',
      actor: { userId: GITHUB_INTEGRATION_USER_ID, login: 'x', mapped: false },
      linkedIssueIds: [issue1],
      removedIssueIds: [],
      drivingIssueIds: [issue1],
      transitions: [],
      payload: {},
    });
    expect(await comments(issue1)).toHaveLength(0);
  });
});

describe('comment guard', () => {
  it('is composable: a registered guard that says false suppresses the comment', async () => {
    const remove = registerCommentGuard(() => false);
    onTestFinished(remove);
    await rule('pr:opened', say('opened'));
    await prEvent('opened', pr());
    expect(await comments(issue1)).toHaveLength(0);
    remove();
    await prEvent('edited', pr({ number: 24, head: { ref: `${p}-1-q`, sha: SHA_B } }));
    expect(await comments(issue1)).toHaveLength(1);
  });
});

const OLD = { created_at: '2026-10-01T09:00:00Z', updated_at: '2026-10-01T10:00:00Z' };
const MERGE = {
  state: 'closed',
  merged: true,
  merged_at: '2026-11-06T11:00:00Z',
  closed_at: '2026-11-06T11:00:00Z',
  updated_at: '2026-11-06T11:00:00Z',
};
const moveAndSay = (): AutomationAction[] => [
  { type: 'set_status', columnId: doneColumn },
  ...say('opened'),
];
const columnOf = async (id: string) =>
  (await prisma.issue.findUniqueOrThrow({ where: { id } })).columnId;

describe('comments by age of the event', () => {
  it('moves the ticket of a PR opened before the link but posts no comment (webhook first)', async () => {
    await rule('pr:opened', moveAndSay());
    await prEvent('opened', pr(OLD));
    expect(await columnOf(issue1)).toBe(doneColumn);
    expect(await comments(issue1)).toHaveLength(0);
  });

  it('comments on a merge after the link of a PR opened before it', async () => {
    await rule('pr:merged', say('merged'));
    await prEvent('opened', pr(OLD));
    await prEvent('closed', pr({ ...OLD, ...MERGE }));
    expect((await comments(issue1)).map((c) => c.body)).toEqual(['merged']);
  });

  it('posts no comment for old PRs in a big first sync that runs out of budget, nor in run two', async () => {
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { lastReconciledAt: null },
    });
    await rule('pr:opened', moveAndSay());
    await rule('checks:failed', say('failed'), 'ci');
    fake.setJobLog(4710, LOG);
    const pulls = [
      pr({ ...OLD }),
      pr({ ...OLD, number: 22, head: { ref: `${p}-2-y`, sha: SHA_B } }),
    ];
    const lists = {
      pulls,
      branches: [],
      checkRuns: { [SHA_A]: [run(4710, SHA_A, { completed_at: '2026-10-01T10:03:05Z' })] },
    };
    fake.setRepoLists('acme-labs/widget', lists);
    await reconcileRepo(repoLinkId, { callBudget: 2 });
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { reconcileLeaseUntil: null },
    });
    await reconcileRepo(repoLinkId);
    expect(await columnOf(issue1)).toBe(doneColumn);
    expect(await columnOf(issue2)).toBe(doneColumn);
    expect(await comments(issue1)).toHaveLength(0);
    expect(await comments(issue2)).toHaveLength(0);
  });

  it('always comments on a change after the link, whichever store reports it first', async () => {
    await rule('pr:opened', say('opened'));
    const fresh = pr({ created_at: '2026-11-03T09:00:00Z', updated_at: '2026-11-03T09:00:00Z' });
    fake.setRepoLists('acme-labs/widget', { pulls: [fresh], branches: [], checkRuns: {} });
    await reconcileRepo(repoLinkId);
    await prEvent('opened', fresh);
    expect((await comments(issue1)).map((c) => c.body)).toEqual(['opened']);
    // and the other way round
    const second = pr({
      number: 25,
      head: { ref: `${p}-2-w`, sha: SHA_B },
      created_at: '2026-11-03T09:00:00Z',
      updated_at: '2026-11-03T09:00:00Z',
    });
    await prEvent('opened', second);
    fake.setRepoLists('acme-labs/widget', { pulls: [fresh, second], branches: [], checkRuns: {} });
    await prisma.githubRepoLink.update({
      where: { id: repoLinkId },
      data: { reconcileLeaseUntil: null, lastReconciledAt: new Date(0) },
    });
    await reconcileRepo(repoLinkId);
    expect((await comments(issue2)).map((c) => c.body)).toEqual(['opened']);
  });

  it('says GitHub, not ghost, as the actor of a change reconcile found', async () => {
    await rule('pr:merged', say('by {{github.actorLogin}}'));
    await prEvent('opened', pr());
    fake.setRepoLists('acme-labs/widget', { pulls: [pr(MERGE)], branches: [], checkRuns: {} });
    await reconcileRepo(repoLinkId);
    const [c] = await comments(issue1);
    expect(c.body).toBe('by GitHub');
    expect(c.authorId).toBe(GITHUB_INTEGRATION_USER_ID);
  });
});

describe('untrusted text', () => {
  it('renders a hostile title as literal text', async () => {
    await rule('pr:opened', say('{{github.pr.title}}'));
    await prEvent('opened', pr({ title: '![x](https://tracker.invalid/a) @tim ^AXM-1 # Heading' }));
    const [c] = await comments(issue1);
    expect(c.body).toBe(
      '\\!\\[x\\]\\(https://tracker\\.invalid/a\\) \\@tim \\^AXM\\-1 \\# Heading',
    );
    expect(c.body).not.toMatch(/(^|[^\\])!\[/);
    expect(c.body).not.toContain('](');
  });

  it('collapses newlines and cuts long titles', async () => {
    await rule('pr:opened', say('{{github.pr.title}}'));
    await prEvent('opened', pr({ title: `line one\nline two ${'x'.repeat(400)}` }));
    const [c] = await comments(issue1);
    expect(c.body).not.toContain('\n');
    expect(c.body.length).toBeLessThanOrEqual(200);
  });
});

describe('check results after the PR is closed', () => {
  it('fires no checks transition for a merged PR', async () => {
    await rule('checks:failed', say('failed'));
    await prEvent('opened', pr());
    await prEvent('closed', pr(MERGE));
    await checkEvent(run(4711));
    expect(await comments(issue1)).toHaveLength(0);
  });
});

describe('the review that fired', () => {
  it('reads its own review, not the newest', async () => {
    await rule('pr:review_submitted', say('{{github.review.author}} {{github.review.state}}'));
    await prEvent('opened', pr());
    const review = (id: number, login: string, state: string, at: string) =>
      ({
        action: 'submitted',
        review: {
          id,
          user: { id: 7000 + id, login },
          state,
          body: '',
          commit_id: SHA_A,
          submitted_at: at,
        },
        pull_request: pr(),
        repository,
        sender: { id: 7000 + id, login },
      }) as Payload;
    // The newer review is stored first; the older one is delivered after it
    await deliver(
      'pull_request_review',
      review(5002, 'second-dev', 'changes_requested', '2026-11-06T13:00:00Z'),
    );
    await deliver(
      'pull_request_review',
      review(5001, 'first-dev', 'approved', '2026-11-06T12:00:00Z'),
    );
    expect((await comments(issue1)).map((c) => c.body).sort()).toEqual([
      'first\\-dev approved',
      'second\\-dev changes\\_requested',
    ]);
  });
});

describe('a rule that throws', () => {
  it('is logged and the other issue still gets its rules', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    onTestFinished(() => vi.restoreAllMocks());
    await rule('pr:opened', say('opened'));
    const real = prisma.automationRule.findMany.bind(prisma.automationRule);
    vi.spyOn(prisma.automationRule, 'findMany').mockRejectedValueOnce(new Error('boom'));
    void real;
    await prEvent('opened', pr({ title: `${ctx.projectPrefix}-2 both` }));
    const total = (await comments(issue1)).length + (await comments(issue2)).length;
    expect(total).toBe(1);
    expect(warn).toHaveBeenCalled();
  });
});
