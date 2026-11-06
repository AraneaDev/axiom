import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import * as broadcast from '../../realtime/broadcast';
import {
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
} from '../../test/factory';
import { seedGithubApp } from '../../test/github-seed';
import { postWebhook } from '../../test/github-webhook';

import { deleteApp } from './github-app.service';
import {
  onGithubOutcome,
  storePullRequest,
  storeReview,
  type GithubEventOutcome,
  type PullRequestPayload,
} from './github-events';
import { GITHUB_INTEGRATION_USER_ID } from './integration-user';
import './webhook-handlers';

const REPO_ID = 880_100;
const FIXTURES = path.join(__dirname, '../../test/__fixtures__/github/events');

let ctx: TestContext;
let other: TestContext;
let repoLinkId: string;
const issueIds: Record<number, string> = {};
const outcomes: GithubEventOutcome[] = [];

type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

// A fixture with the project's prefix and the repository id filled in
function fixture(name: string, mutate?: (payload: Payload) => void, project = ctx): Payload {
  const text = readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')
    .replaceAll('{{P}}', project.projectPrefix)
    .replaceAll('{{p}}', project.projectPrefix.toLowerCase())
    .replace('"__REPO_ID__"', String(REPO_ID));
  const payload = JSON.parse(text) as Payload;
  mutate?.(payload);
  return payload;
}

// Delivers a payload through the webhook and waits until its delivery has been decided
async function deliver(event: string, payload: Payload, deliveryId: string = randomUUID()) {
  const res = await postWebhook(event, payload, { deliveryId });
  expect(res.status).toBe(202);
  let status = '';
  await vi.waitFor(async () => {
    const row = await prisma.githubDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    status = row.status;
    expect(['PROCESSED', 'IGNORED', 'FAILED']).toContain(row.status);
  });
  return status;
}

const prs = () => prisma.githubPullRequest.findMany({ where: { repoLinkId } });
const linksOf = async (type: 'BRANCH' | 'PULL_REQUEST' | 'COMMIT', key?: string) =>
  (
    await prisma.githubIssueLink.findMany({
      where: { repoLinkId, targetType: type, ...(key ? { targetKey: key } : {}) },
    })
  ).map((l) => ({ ...l, sources: l.sources.slice().sort() }));
const transitionsOf = () => outcomes.flatMap((o) => o.transitions);

async function createLink(project: TestContext, repoId = REPO_ID) {
  return (
    await prisma.githubRepoLink.create({
      data: {
        projectId: project.projectId,
        repoId: BigInt(repoId),
        installationId: 1n,
        owner: 'acme-labs',
        name: 'widget',
        fullName: 'acme-labs/widget',
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/acme-labs/widget',
        linkedById: project.owner.id,
      },
    })
  ).id;
}

beforeAll(async () => {
  await seedGithubApp();
  await prisma.githubApp.updateMany({ data: { createdAt: new Date(0) } });
  ctx = await createTestContext('gev1');
  other = await createTestContext('gev2');
  for (const n of [1, 2, 3]) {
    issueIds[n] = (
      await prisma.issue.create({
        data: {
          projectId: ctx.projectId,
          number: n,
          title: `Issue ${n}`,
          body: '',
          creatorId: ctx.owner.id,
        },
      })
    ).id;
  }
  await prisma.issue.create({
    data: {
      projectId: other.projectId,
      number: 2,
      title: 'x',
      body: '',
      creatorId: other.owner.id,
    },
  });
  onGithubOutcome(async (o) => {
    outcomes.push(o);
  });
});

beforeEach(async () => {
  outcomes.length = 0;
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  await prisma.githubDelivery.deleteMany();
  repoLinkId = await createLink(ctx);
});

afterAll(async () => {
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  await prisma.githubDelivery.deleteMany();
  await cleanupTestContext(ctx);
  await cleanupTestContext(other);
  await deleteApp().catch(() => undefined);
});

describe('pull_request', () => {
  it('stores the PR and links its branch, title and body with their own sources', async () => {
    expect(await deliver('pull_request', fixture('pull_request.opened'))).toBe('PROCESSED');
    const [pr] = await prs();
    expect(pr).toMatchObject({
      number: 17,
      state: 'OPEN',
      draft: false,
      authorLogin: 'voorbeeld-dev',
      headRef: `${ctx.projectPrefix.toLowerCase()}-1-x`,
      baseRef: 'main',
    });
    expect(pr.requestedReviewers).toEqual([{ login: 'review-bot', githubId: 7002 }]);
    const links = await linksOf('PULL_REQUEST', pr.id);
    expect(Object.fromEntries(links.map((l) => [l.issueId, l.sources]))).toEqual({
      [issueIds[1]]: ['BRANCH_NAME'],
      [issueIds[2]]: ['PR_TITLE'],
      [issueIds[3]]: ['PR_BODY'],
    });
    expect(
      (await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: repoLinkId } })).lastDeliveryAt,
    ).not.toBeNull();
  });

  it('maps the author to a connected user and keeps the login of an unknown one', async () => {
    const user = await createTestUser();
    await prisma.githubAccount.create({
      data: {
        id: `acct-${user.id}`,
        userId: user.id,
        githubUserId: 7001,
        login: 'voorbeeld-dev',
        accessToken: 'unused',
      },
    });
    try {
      await deliver('pull_request', fixture('pull_request.opened'));
      expect((await prs())[0].authorUserId).toBe(user.id);
      await deliver(
        'pull_request',
        fixture('pull_request.opened', (p) => {
          p.pull_request.number = 18;
          p.pull_request.user = { id: 9999, login: 'onbekend-dev' };
        }),
      );
      const unknown = (await prs()).find((p) => p.number === 18)!;
      expect(unknown).toMatchObject({
        authorLogin: 'onbekend-dev',
        authorUserId: GITHUB_INTEGRATION_USER_ID,
      });
      expect(outcomes.at(-1)!.actor).toMatchObject({ mapped: true, login: 'voorbeeld-dev' });
    } finally {
      await prisma.githubAccount.deleteMany({ where: { userId: user.id } });
    }
  });

  it('removes a link when an edit drops the key', async () => {
    await deliver('pull_request', fixture('pull_request.opened'));
    await deliver(
      'pull_request',
      fixture('pull_request.opened', (p) => {
        p.action = 'edited';
        p.pull_request.title = 'add the widget';
        p.pull_request.updated_at = '2026-11-01T11:00:00Z';
      }),
    );
    const [pr] = await prs();
    const linked = (await linksOf('PULL_REQUEST', pr.id)).map((l) => l.issueId).sort();
    expect(linked).toEqual([issueIds[1], issueIds[3]].sort());
    expect(outcomes.at(-1)!.linkedIssueIds.sort()).toEqual([issueIds[1], issueIds[3]].sort());
  });

  it('changes nothing for a delivery older than the stored state', async () => {
    await deliver('pull_request', fixture('pull_request.opened'));
    await deliver(
      'pull_request',
      fixture('pull_request.opened', (p) => {
        p.action = 'synchronize';
        p.pull_request.title = 'older title';
        p.pull_request.head.sha = 'f'.repeat(40);
        p.pull_request.updated_at = '2026-11-01T09:00:00Z';
      }),
    );
    const [pr] = await prs();
    expect(pr.title).toBe(`${ctx.projectPrefix}-2 add the widget`);
    expect(pr.headSha).toBe('1'.repeat(40));
    expect(pr.githubUpdatedAt.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(await linksOf('PULL_REQUEST', pr.id)).toHaveLength(3);
  });

  it('keeps the newest state when two deliveries race', async () => {
    const [a, b] = [
      fixture('pull_request.opened', (p) => {
        p.pull_request.title = 'older';
        p.pull_request.updated_at = '2026-11-01T10:00:00Z';
      }),
      fixture('pull_request.opened', (p) => {
        p.pull_request.title = 'newer';
        p.pull_request.updated_at = '2026-11-01T10:05:00Z';
      }),
    ];
    await Promise.all([
      storePullRequest(repoLinkId, a.pull_request as PullRequestPayload, null, 'webhook'),
      storePullRequest(repoLinkId, b.pull_request as PullRequestPayload, null, 'webhook'),
    ]);
    expect((await prs())[0].title).toBe('newer');
  });

  it('records a merge: MERGED, mergedAt and the merge commit', async () => {
    await deliver('pull_request', fixture('pull_request.opened'));
    await deliver('pull_request', fixture('pull_request.closed-merged'));
    const [pr] = await prs();
    expect(pr.state).toBe('MERGED');
    expect(pr.mergedAt?.toISOString()).toBe('2026-11-02T09:00:00.000Z');
    expect(pr.mergeCommitSha).toBe('2'.repeat(40));
  });

  it('reports pr_opened once: the same payload under a new delivery id reports nothing', async () => {
    await deliver('pull_request', fixture('pull_request.opened'));
    expect(transitionsOf()).toEqual(expect.arrayContaining(['pr_opened', 'reviewers_added']));
    expect(outcomes[0]).toMatchObject({
      event: 'pull_request',
      action: 'opened',
      source: 'webhook',
    });
    outcomes.length = 0;
    await deliver('pull_request', fixture('pull_request.opened'));
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].transitions).toEqual([]);
  });

  it('reports pr_merged once, also when the same change is stored twice at once', async () => {
    await deliver('pull_request', fixture('pull_request.opened'));
    outcomes.length = 0;
    const merged = fixture('pull_request.closed-merged').pull_request as PullRequestPayload;
    await Promise.all([
      storePullRequest(repoLinkId, merged, null, 'webhook'),
      storePullRequest(repoLinkId, merged, null, 'reconcile'),
    ]);
    expect(transitionsOf().filter((t) => t === 'pr_merged')).toHaveLength(1);
  });

  const prPayload = (mutate: (pr: Payload) => void = () => {}) =>
    fixture('pull_request.opened', (p) => mutate(p.pull_request))
      .pull_request as PullRequestPayload;

  it('ends with the links of the newest title when two deliveries race, and reports once', async () => {
    for (let n = 40; n < 46; n++) {
      const older = prPayload((pr) => {
        pr.number = n;
        pr.title = `${ctx.projectPrefix}-1 older`;
        pr.body = '';
        pr.head.ref = 'x';
        pr.updated_at = '2026-11-01T10:00:00Z';
      });
      const newer = prPayload((pr) => {
        pr.number = n;
        pr.title = `${ctx.projectPrefix}-2 newer`;
        pr.body = '';
        pr.head.ref = 'x';
        pr.updated_at = '2026-11-01T10:05:00Z';
      });
      outcomes.length = 0;
      await Promise.all([
        storePullRequest(repoLinkId, newer, null, 'webhook'),
        storePullRequest(repoLinkId, older, null, 'webhook'),
      ]);
      const row = await prisma.githubPullRequest.findFirstOrThrow({
        where: { repoLinkId, number: n },
      });
      expect(row.title).toContain('newer');
      expect((await linksOf('PULL_REQUEST', row.id)).map((l) => l.issueId)).toEqual([issueIds[2]]);
      expect(transitionsOf().filter((t) => t === 'pr_opened')).toHaveLength(1);
    }
  });

  it.each([
    ['open', {}, 'pr_opened'],
    ['merged', { state: 'closed', merged: true, merged_at: '2026-11-01T11:00:00Z' }, 'pr_merged'],
    ['closed', { state: 'closed', closed_at: '2026-11-01T11:00:00Z' }, 'pr_closed'],
  ])('reports the transition of the state a new %s PR is stored in', async (_name, patch, want) => {
    const outcome = await storePullRequest(
      repoLinkId,
      prPayload((pr) => Object.assign(pr, patch, { requested_reviewers: [] })),
      null,
      'webhook',
    );
    expect(outcome.transitions).toEqual([want]);
  });

  it('never moves a merged PR out of MERGED, not even by a payload of the same second', async () => {
    await storePullRequest(
      repoLinkId,
      fixture('pull_request.closed-merged').pull_request as PullRequestPayload,
      null,
      'webhook',
    );
    outcomes.length = 0;
    for (const updated of ['2026-11-02T09:00:00Z', '2026-11-03T09:00:00Z']) {
      const late = await storePullRequest(
        repoLinkId,
        prPayload((pr) => {
          pr.updated_at = updated;
        }),
        null,
        'webhook',
      );
      expect(late.transitions).toEqual([]);
    }
    const [pr] = await prs();
    expect(pr.state).toBe('MERGED');
    expect(pr.mergeCommitSha).toBe('2'.repeat(40));
    expect(transitionsOf()).toEqual([]);
  });

  it('keeps the mergeable state when a payload carries none', async () => {
    await deliver('pull_request', fixture('pull_request.opened'));
    expect((await prs())[0].mergeableState).toBe('clean');
    await deliver(
      'pull_request_review',
      fixture('pull_request_review.submitted', (p) => {
        delete p.pull_request.mergeable_state;
        p.pull_request.updated_at = '2026-11-01T13:00:00Z';
      }),
    );
    expect((await prs())[0].mergeableState).toBe('clean');
  });

  it('compares requested reviewers by GitHub id: a renamed reviewer is not added again', async () => {
    await storePullRequest(repoLinkId, prPayload(), null, 'webhook');
    const outcome = await storePullRequest(
      repoLinkId,
      prPayload((pr) => {
        pr.requested_reviewers = [{ id: 7002, login: 'review-bot-renamed' }];
        pr.updated_at = '2026-11-01T10:30:00Z';
      }),
      null,
      'webhook',
    );
    expect(outcome.transitions).toEqual([]);
    const added = await storePullRequest(
      repoLinkId,
      prPayload((pr) => {
        pr.requested_reviewers = [
          { id: 7002, login: 'review-bot-renamed' },
          { id: 7003, login: 'second-reviewer' },
        ];
        pr.updated_at = '2026-11-01T10:40:00Z';
      }),
      null,
      'webhook',
    );
    expect(added.transitions).toEqual(['reviewers_added']);
  });

  it('stores only https links, and builds the link from the repository otherwise', async () => {
    await storePullRequest(
      repoLinkId,
      prPayload((pr) => {
        pr.html_url = 'javascript:alert(1)';
      }),
      null,
      'webhook',
    );
    expect((await prs())[0].htmlUrl).toBe('https://github.com/acme-labs/widget/pull/17');
    await deliver(
      'push',
      fixture('push', (p) => {
        p.commits[0].url = 'data:text/html,x';
      }),
    );
    const commit = await prisma.githubCommit.findFirstOrThrow({
      where: { repoLinkId, sha: '1'.repeat(40) },
    });
    expect(commit.htmlUrl).toBe(`https://github.com/acme-labs/widget/commit/${'1'.repeat(40)}`);
  });

  it('strips NUL characters from titles, refs and logins', async () => {
    await storePullRequest(
      repoLinkId,
      prPayload((pr) => {
        pr.title = 'a\u0000b';
        pr.head.ref = 'r\u0000ef';
        pr.user = { id: 9998, login: 'lo\u0000gin' };
      }),
      null,
      'webhook',
    );
    expect((await prs())[0]).toMatchObject({ title: 'ab', headRef: 'ref', authorLogin: 'login' });
  });

  it('is ignored for a repository nobody linked', async () => {
    const status = await deliver(
      'pull_request',
      fixture('pull_request.opened', (p) => {
        p.repository.id = REPO_ID + 1;
      }),
    );
    expect(status).toBe('IGNORED');
    expect(await prs()).toHaveLength(0);
  });

  it('lands on the link that replaced the one it was received for', async () => {
    await deliver('pull_request', fixture('pull_request.opened'));
    await prisma.githubRepoLink.delete({ where: { id: repoLinkId } });
    const newLinkId = await createLink(other);
    const payload = fixture(
      'pull_request.opened',
      (p) => {
        p.pull_request.number = 31;
        p.pull_request.title = `${other.projectPrefix}-2 late`;
        p.pull_request.head.ref = 'late';
        p.pull_request.body = '';
      },
      other,
    );
    expect(await deliver('pull_request', payload)).toBe('PROCESSED');
    expect(await prisma.githubPullRequest.count({ where: { repoLinkId } })).toBe(0);
    const landed = await prisma.githubPullRequest.findMany({ where: { repoLinkId: newLinkId } });
    expect(landed.map((p) => p.number)).toEqual([31]);
    expect(await prisma.githubIssueLink.count({ where: { repoLinkId } })).toBe(0);
    expect(await prisma.githubIssueLink.count({ where: { repoLinkId: newLinkId } })).toBe(1);
    expect(outcomes.at(-1)!.projectId).toBe(other.projectId);
  });
});

describe('push, create and delete', () => {
  it('stores the branch and the commits and links only the commit that names an issue', async () => {
    await deliver('push', fixture('push'));
    const branch = await prisma.githubBranch.findFirstOrThrow({ where: { repoLinkId } });
    expect(branch).toMatchObject({ headSha: '3'.repeat(40), deletedAt: null });
    expect(await prisma.githubCommit.count({ where: { repoLinkId } })).toBe(3);
    const commitLinks = await linksOf('COMMIT');
    expect(commitLinks.map((l) => [l.targetKey, l.issueId, l.sources])).toEqual([
      ['1'.repeat(40), issueIds[1], ['COMMIT_MESSAGE']],
    ]);
    const branchLinks = await linksOf('BRANCH', branch.id);
    expect(branchLinks.map((l) => [l.issueId, l.sources])).toEqual([
      [issueIds[1], ['BRANCH_NAME']],
    ]);
    expect(outcomes.at(-1)).toMatchObject({
      event: 'push',
      branchId: branch.id,
      headSha: '3'.repeat(40),
    });
    expect(outcomes.at(-1)!.transitions).toEqual(['branch_created']);
    expect(outcomes.at(-1)!.drivingIssueIds).toEqual([issueIds[1]]);
  });

  it('cuts a commit message at 2048 bytes on a character boundary', async () => {
    await deliver(
      'push',
      fixture('push', (p) => {
        p.commits[1].message = '€'.repeat(1000);
      }),
    );
    const commit = await prisma.githubCommit.findFirstOrThrow({
      where: { repoLinkId, sha: '2'.repeat(40) },
    });
    expect(Buffer.byteLength(commit.message)).toBe(2046);
    expect(commit.message).toBe('€'.repeat(682));
  });

  it('creates a branch from a create event and does not report it twice', async () => {
    await deliver('create', fixture('create-branch'));
    expect(await prisma.githubBranch.count({ where: { repoLinkId, deletedAt: null } })).toBe(1);
    expect(transitionsOf()).toEqual(['branch_created']);
    outcomes.length = 0;
    await deliver('create', fixture('create-branch'));
    expect(transitionsOf()).toEqual([]);
  });

  const pushAt = (seconds: number, sha: string) =>
    fixture('push', (p) => {
      p.repository.pushed_at = seconds;
      p.after = sha;
    });
  const branchRow = () => prisma.githubBranch.findFirstOrThrow({ where: { repoLinkId } });

  it('marks a deleted branch and keeps its links', async () => {
    await deliver('push', fixture('push'));
    const branch = await branchRow();
    await deliver('delete', fixture('delete-branch'));
    const gone = await branchRow();
    expect(gone.deletedAt).not.toBeNull();
    expect(gone.headSha).toBe('3'.repeat(40));
    expect(await linksOf('BRANCH', branch.id)).toHaveLength(1);
  });

  it('brings a deleted branch back with a push newer than the delete, on the new head', async () => {
    await deliver('push', pushAt(1000, 'a'.repeat(40)));
    await deliver('delete', fixture('delete-branch'));
    outcomes.length = 0;
    await deliver('push', pushAt(Math.floor(Date.now() / 1000) + 60, 'b'.repeat(40)));
    const back = await branchRow();
    expect(back.deletedAt).toBeNull();
    expect(back.headSha).toBe('b'.repeat(40));
    expect(transitionsOf()).toEqual(['branch_created']);
  });

  it('skips a push older than the delete: the branch stays deleted', async () => {
    await deliver('push', pushAt(1000, 'a'.repeat(40)));
    await deliver('delete', fixture('delete-branch'));
    outcomes.length = 0;
    await deliver('push', pushAt(1500, 'b'.repeat(40)));
    const row = await branchRow();
    expect(row.deletedAt).not.toBeNull();
    expect(row.headSha).toBe('a'.repeat(40));
    expect(transitionsOf()).toEqual([]);
  });

  it('skips a push older than the stored head', async () => {
    await deliver('push', pushAt(2000, 'a'.repeat(40)));
    await deliver('push', pushAt(1000, 'b'.repeat(40)));
    expect((await branchRow()).headSha).toBe('a'.repeat(40));
  });

  it('never lets a create event bring a deleted branch back', async () => {
    await deliver('push', pushAt(1000, 'a'.repeat(40)));
    await deliver('delete', fixture('delete-branch'));
    outcomes.length = 0;
    await deliver('create', fixture('create-branch'));
    expect((await branchRow()).deletedAt).not.toBeNull();
    expect(transitionsOf()).toEqual([]);
  });

  it('does not sync a commit it has stored before', async () => {
    await deliver('push', fixture('push'));
    await prisma.githubIssueLink.deleteMany({ where: { repoLinkId, targetType: 'COMMIT' } });
    await deliver('push', fixture('push'));
    expect(await linksOf('COMMIT')).toHaveLength(0);
  });

  it('ignores a push to something other than a branch', async () => {
    expect(
      await deliver(
        'push',
        fixture('push', (p) => {
          p.ref = 'refs/tags/v1';
        }),
      ),
    ).toBe('IGNORED');
    expect(await prisma.githubBranch.count({ where: { repoLinkId } })).toBe(0);
  });
});

describe('pull_request_review', () => {
  it('stores the review, cut at 4096 bytes on a character boundary, and reports it once', async () => {
    expect(
      await deliver(
        'pull_request_review',
        fixture('pull_request_review.submitted', (p) => {
          p.review.body = '€'.repeat(2000);
        }),
      ),
    ).toBe('PROCESSED');
    const review = await prisma.githubReview.findUniqueOrThrow({ where: { id: '5001' } });
    expect(Buffer.byteLength(review.body)).toBe(4095);
    expect(review).toMatchObject({ state: 'approved', authorLogin: 'review-bot' });
    expect(transitionsOf()).toContain('review_added');
    outcomes.length = 0;
    await deliver(
      'pull_request_review',
      fixture('pull_request_review.submitted', (p) => {
        p.action = 'edited';
        p.review.body = 'shorter';
      }),
    );
    expect((await prisma.githubReview.findUniqueOrThrow({ where: { id: '5001' } })).body).toBe(
      'shorter',
    );
    expect(transitionsOf()).not.toContain('review_added');
  });

  it('never sets a dismissed review back to its earlier state', async () => {
    await deliver('pull_request_review', fixture('pull_request_review.submitted'));
    await deliver(
      'pull_request_review',
      fixture('pull_request_review.submitted', (p) => {
        p.action = 'dismissed';
        p.review.state = 'dismissed';
      }),
    );
    expect((await prisma.githubReview.findUniqueOrThrow({ where: { id: '5001' } })).state).toBe(
      'dismissed',
    );
    // A `submitted` delivered late, with the review's own submitted_at
    await deliver('pull_request_review', fixture('pull_request_review.submitted'));
    expect((await prisma.githubReview.findUniqueOrThrow({ where: { id: '5001' } })).state).toBe(
      'dismissed',
    );
  });

  it('lets a later state of a review replace an earlier one', async () => {
    await deliver('pull_request_review', fixture('pull_request_review.submitted'));
    await deliver(
      'pull_request_review',
      fixture('pull_request_review.submitted', (p) => {
        p.action = 'edited';
        p.review.state = 'changes_requested';
        p.review.submitted_at = '2026-11-01T12:00:05Z';
      }),
    );
    expect((await prisma.githubReview.findUniqueOrThrow({ where: { id: '5001' } })).state).toBe(
      'changes_requested',
    );
  });

  it('stores a review of a PR it has not seen yet', async () => {
    await deliver('pull_request_review', fixture('pull_request_review.submitted'));
    expect(await prs()).toHaveLength(1);
  });

  it('stores a review with no body and reports review_added through storeReview', async () => {
    const pr = fixture('pull_request.opened').pull_request as PullRequestPayload;
    await storePullRequest(repoLinkId, pr, null, 'webhook');
    const stored = (await prs())[0];
    const first = await storeReview(
      stored.id,
      {
        id: 6001,
        user: { id: 7002, login: 'review-bot' },
        state: 'commented',
        body: null,
        commit_id: 'a'.repeat(40),
        submitted_at: '2026-11-01T12:00:00Z',
      },
      null,
      'reconcile',
    );
    expect(first.transitions).toEqual(['review_added']);
    expect((await prisma.githubReview.findUniqueOrThrow({ where: { id: '6001' } })).body).toBe('');
  });
});

describe('listeners', () => {
  it('broadcasts issue:development-updated once to the project room, naming every linked issue', async () => {
    const spy = vi.spyOn(broadcast, 'broadcastToRoom').mockImplementation(() => {});
    try {
      await deliver('pull_request', fixture('pull_request.opened'));
      await vi.waitFor(() => expect(spy).toHaveBeenCalled());
      const calls = spy.mock.calls.filter(([, e]) => e.type === 'issue:development-updated');
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe(`project:${ctx.projectId}`);
      const event = calls[0][1] as { projectId: string; issueIds: string[] };
      expect(event.projectId).toBe(ctx.projectId);
      expect(event.issueIds.slice().sort()).toEqual(Object.values(issueIds).slice().sort());
    } finally {
      spy.mockRestore();
    }
  });

  it('counts the delivery as processed when a listener throws, and logs without the payload', async () => {
    const { logger } = await import('../../utils/logger');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
    const off = onGithubOutcome(async () => {
      throw new Error('listener broke');
    });
    try {
      expect(await deliver('pull_request', fixture('pull_request.opened'))).toBe('PROCESSED');
      expect(warn).toHaveBeenCalled();
      expect(JSON.stringify(warn.mock.calls)).not.toContain('voorbeeld-dev');
    } finally {
      off();
      warn.mockRestore();
    }
  });
});
