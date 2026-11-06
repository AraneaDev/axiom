import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { cleanupTestContext, createTestContext, type TestContext } from '../../test/factory';
import { SLOW_BLOB_MS, useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';
import { postWebhook } from '../../test/github-webhook';

import {
  FAILED_CONCLUSIONS,
  checkStateOf,
  recordCheckRun,
  type CheckRunPayload,
} from './checks.service';
import { clearInstallationTokens } from './github-app.service';
import { githubRequest, githubText } from './github-client';
import { onGithubOutcome, type GithubEventOutcome } from './github-events';
import './github-resolvers';
import { LOG_TAIL_LIMITS } from './log-tail';
import './webhook-handlers';

const REPO_ID = 880_400;
const INSTALLATION_ID = 4101;
const AUTH = { kind: 'installation', installationId: INSTALLATION_ID } as const;
const JOB_ID = 4401;
const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';
const LOG = readFileSync(
  path.join(__dirname, '../../test/__fixtures__/github/checks/job-log.txt'),
  'utf8',
);

const fake = useGithubFake('checks');
let ctx: TestContext;
let repoLinkId: string;
let issueId: string;
const outcomes: GithubEventOutcome[] = [];

type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function checkRun(overrides: Payload = {}): CheckRunPayload {
  return {
    id: JOB_ID,
    name: 'test',
    head_sha: SHA_A,
    status: 'completed',
    conclusion: 'failure',
    started_at: '2026-11-06T10:00:05Z',
    completed_at: '2026-11-06T10:03:05Z',
    html_url: `https://github.com/acme-labs/widget/runs/${overrides.id ?? JOB_ID}`,
    output: { title: null, summary: null, text: null },
    app: { id: 15368, slug: 'github-actions', name: 'GitHub Actions' },
    ...overrides,
  } as CheckRunPayload;
}

function event(run: CheckRunPayload, action = 'completed', repoId = REPO_ID): Payload {
  return {
    action,
    check_run: run,
    repository: { id: repoId, name: 'widget', full_name: 'acme-labs/widget' },
    sender: { id: 7001, login: 'voorbeeld-dev' },
    installation: { id: INSTALLATION_ID },
  };
}

async function deliver(payload: Payload, deliveryId: string = randomUUID()) {
  const res = await postWebhook('check_run', payload, { deliveryId });
  expect(res.status).toBe(202);
  let status = '';
  await vi.waitFor(async () => {
    const row = await prisma.githubDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    status = row.status;
    expect(['PROCESSED', 'IGNORED', 'FAILED']).toContain(row.status);
  });
  return status;
}

const stored = (id = JOB_ID) => prisma.githubCheckRun.findUnique({ where: { id: String(id) } });
const requestsTo = (fragment: string) => fake.requests.filter((r) => r.path.includes(fragment));
const transitions = () => outcomes.flatMap((o) => o.transitions);

async function seedRun(id: number, sha: string, status: string, conclusion: string | null) {
  await prisma.githubCheckRun.create({
    data: {
      id: String(id),
      repoLinkId,
      headSha: sha,
      name: `job ${id}`,
      appSlug: 'github-actions',
      status,
      conclusion,
      htmlUrl: `https://github.com/acme-labs/widget/runs/${id}`,
      githubUpdatedAt: new Date('2026-11-06T10:00:00Z'),
    },
  });
}

beforeAll(async () => {
  await seedGithubApp({ fake });
  fake.addInstallation(INSTALLATION_ID, ['acme-labs/widget']);
  ctx = await createTestContext('chk1');
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
  issueId = (
    await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'Issue 1',
        body: '',
        creatorId: ctx.owner.id,
      },
    })
  ).id;
  onGithubOutcome(async (outcome) => {
    if (outcome.repoLinkId === repoLinkId) outcomes.push(outcome);
  });
});

beforeEach(async () => {
  outcomes.length = 0;
  await prisma.githubCheckRun.deleteMany({ where: { repoLinkId } });
  await prisma.githubPullRequest.deleteMany({ where: { repoLinkId } });
  fake.setJobLog(JOB_ID, LOG);
});

afterAll(async () => {
  await cleanupTestContext(ctx);
});

describe('GitHub Actions runs', () => {
  it('stores the failed step and the end of the log of a failed run', async () => {
    expect(await deliver(event(checkRun()))).toBe('PROCESSED');

    const row = await stored();
    expect(row).toMatchObject({
      repoLinkId,
      headSha: SHA_A,
      name: 'test',
      appSlug: 'github-actions',
      workflowRunId: '88100',
      status: 'completed',
      conclusion: 'failure',
      failedStep: 'Run tests',
      logTruncated: true,
      logUnavailable: false,
      htmlUrl: `https://github.com/acme-labs/widget/runs/${JOB_ID}`,
    });
    expect(row?.startedAt?.toISOString()).toBe('2026-11-06T10:00:05.000Z');
    expect(row?.completedAt?.toISOString()).toBe('2026-11-06T10:03:05.000Z');
    const lines = row!.logTail!.split('\n');
    expect(lines).toHaveLength(100);
    expect(lines.at(-1)).toBe('##[error]Process completed with exit code 1.');
    expect(row!.logTail).not.toContain('Post job cleanup.');
  });

  it('asks GitHub as the installation, and sends nothing to the blob host but the request', async () => {
    await deliver(event(checkRun()));

    const [job, logs] = requestsTo('/actions/jobs/');
    expect(job.path).toBe(`/repos/acme-labs/widget/actions/jobs/${JOB_ID}`);
    expect(job.headers.authorization).toBe(`installation:${INSTALLATION_ID}`);
    expect(logs.path).toBe(`/repos/acme-labs/widget/actions/jobs/${JOB_ID}/logs`);
    expect(logs.headers.authorization).toBe(`installation:${INSTALLATION_ID}`);
    const [blob] = requestsTo('/blob/');
    expect(blob.headers.authorization).toBeUndefined();
    expect(blob.headers.host).toMatch(/^localhost:/);
    expect(blob.headers.host).not.toBe(new URL(fake.url).host);
    // The blob host refuses a request that carries a credential, so the log arrived without one
    expect((await stored())?.logUnavailable).toBe(false);
  });

  it.each([
    ['gone', 'a 410 for expired logs'],
    ['not-found', 'a 404'],
  ] as const)(
    'marks the log unavailable on %s and still processes the delivery (%s)',
    async (mode) => {
      fake.setJobLog(JOB_ID, LOG, mode);

      expect(await deliver(event(checkRun()))).toBe('PROCESSED');

      expect(await stored()).toMatchObject({
        failedStep: 'Run tests',
        logTail: null,
        logUnavailable: true,
        conclusion: 'failure',
      });
    },
  );

  it('marks the log unavailable when GitHub fails on the job or the log, without failing the delivery', async () => {
    fake.on('GET /repos/:owner/:repo/actions/jobs/:job_id', {
      status: 502,
      body: { message: 'Bad gateway' },
    });
    expect(await deliver(event(checkRun()))).toBe('PROCESSED');
    expect(await stored()).toMatchObject({ failedStep: null, logTail: null, logUnavailable: true });

    fake.reset();
    fake.setJobLog(4402, LOG);
    fake.on('GET /repos/:owner/:repo/actions/jobs/:job_id/logs', {
      status: 503,
      body: { message: 'Down' },
    });
    expect(await deliver(event(checkRun({ id: 4402 })))).toBe('PROCESSED');
    expect(await stored(4402)).toMatchObject({
      failedStep: 'Run tests',
      logTail: null,
      logUnavailable: true,
    });
  });

  it('waits for a slow blob host and keeps the log', async () => {
    fake.setJobLog(JOB_ID, LOG, 'slow');
    const started = Date.now();

    expect(await deliver(event(checkRun()))).toBe('PROCESSED');

    expect(Date.now() - started).toBeGreaterThanOrEqual(SLOW_BLOB_MS);
    expect((await stored())?.logTail).toContain('##[error]Process completed');
  });

  it('keeps only the end of a log far bigger than the download cap', async () => {
    const big = `${Array.from({ length: 90_000 }, (_, i) => `2026-11-06T10:00:00.0000000Z row ${i} ${'x'.repeat(30)}`).join('\r\n')}\r\n2026-11-06T10:00:01.0000000Z ##[error]boom\r\n`;
    expect(Buffer.byteLength(big)).toBeGreaterThan(LOG_TAIL_LIMITS.downloadBytes * 3);
    fake.setJobLog(JOB_ID, big);

    const raw = await githubText(
      AUTH,
      `/repos/acme-labs/widget/actions/jobs/${JOB_ID}/logs`,
      LOG_TAIL_LIMITS.downloadBytes,
    );
    expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(LOG_TAIL_LIMITS.downloadBytes);
    expect(Buffer.byteLength(raw)).toBeGreaterThan(LOG_TAIL_LIMITS.downloadBytes - 4);
    expect(big.endsWith(raw)).toBe(true);

    await deliver(event(checkRun()));
    const row = await stored();
    expect(row?.logTruncated).toBe(true);
    expect(Buffer.byteLength(row!.logTail!)).toBeLessThanOrEqual(LOG_TAIL_LIMITS.bytes);
    expect(row!.logTail!.endsWith('##[error]boom')).toBe(true);
  });

  it('does not fetch again for a redelivery or a second event about the same failure', async () => {
    await deliver(event(checkRun()));
    const calls = requestsTo('/actions/jobs/').length;
    expect(calls).toBe(2);

    await deliver(event(checkRun()));
    await deliver(event(checkRun(), 'rerequested'));

    expect(requestsTo('/actions/jobs/')).toHaveLength(calls);
    expect(requestsTo('/blob/')).toHaveLength(1);
    expect((await stored())?.failedStep).toBe('Run tests');
  });

  it('fetches nothing for a run that did not fail', async () => {
    await deliver(event(checkRun({ conclusion: 'success' })));

    expect(requestsTo('/actions/')).toHaveLength(0);
    expect(await stored()).toMatchObject({
      conclusion: 'success',
      failedStep: null,
      logTail: null,
    });
  });

  it('fetches nothing for a run that is still going', async () => {
    await deliver(
      event(checkRun({ status: 'in_progress', conclusion: null, completed_at: null }), 'created'),
    );

    expect(requestsTo('/actions/')).toHaveLength(0);
    expect(await stored()).toMatchObject({
      status: 'in_progress',
      conclusion: null,
      completedAt: null,
    });
  });

  it.each(FAILED_CONCLUSIONS)('treats %s as a failure worth a log', async (conclusion) => {
    await deliver(event(checkRun({ conclusion })));

    expect((await stored())?.failedStep).toBe('Run tests');
  });
});

describe('runs of other apps', () => {
  const lint = (overrides: Payload = {}) =>
    checkRun({
      id: 4410,
      name: 'lint',
      app: { id: 777, slug: 'acme-lint', name: 'Acme Lint' },
      output: {
        title: '3 problems found',
        summary: 'Found 3 problems in 2 files',
        text: 'src/a.ts:1 unexpected any\nsrc/b.ts:9 unused variable',
      },
      ...overrides,
    });

  it('uses the output title as the failed step and the output as the log, with no call to GitHub', async () => {
    expect(await deliver(event(lint()))).toBe('PROCESSED');

    expect(fake.requests).toHaveLength(0);
    expect(await stored(4410)).toMatchObject({
      appSlug: 'acme-lint',
      workflowRunId: null,
      failedStep: '3 problems found',
      logTail: 'Found 3 problems in 2 files\nsrc/a.ts:1 unexpected any\nsrc/b.ts:9 unused variable',
      logTruncated: false,
      logUnavailable: false,
    });
  });

  it('copes with an output that has nothing in it', async () => {
    await deliver(event(lint({ output: { title: null, summary: null, text: null } })));
    expect(await stored(4410)).toMatchObject({ failedStep: null, logTail: null });

    await deliver(event(lint({ id: 4411, output: undefined })));
    expect(await stored(4411)).toMatchObject({ failedStep: null, logTail: null });
  });

  it('cuts a long output to the tail limits', async () => {
    const text = Array.from({ length: 300 }, (_, i) => `finding ${i}`).join('\n');
    await deliver(event(lint({ output: { title: 'many', summary: 'Summary', text } })));

    const row = await stored(4410);
    expect(row?.logTail?.split('\n')).toHaveLength(LOG_TAIL_LIMITS.lines);
    expect(row?.logTail?.endsWith('finding 299')).toBe(true);
    expect(row?.logTruncated).toBe(true);
  });

  it('keeps no log for a run that passed', async () => {
    await deliver(event(lint({ conclusion: 'success' })));

    expect(await stored(4410)).toMatchObject({ failedStep: null, logTail: null });
  });
});

describe('what is stored of the payload', () => {
  it.each([
    ['javascript:alert(1)'],
    ['http://github.com/acme-labs/widget/runs/4401'],
    ['/acme-labs/widget/runs/4401'],
    [null],
    ['https://'],
  ])('builds the link from the repository when GitHub sent %s', async (htmlUrl) => {
    await deliver(event(checkRun({ conclusion: 'success', html_url: htmlUrl })));

    expect((await stored())?.htmlUrl).toBe('https://github.com/acme-labs/widget/runs/4401');
  });

  it('keeps an https link as it is', async () => {
    await deliver(
      event(
        checkRun({
          conclusion: 'success',
          html_url: 'https://github.com/acme-labs/widget/runs/4401?check_suite_focus=true',
        }),
      ),
    );

    expect((await stored())?.htmlUrl).toBe(
      'https://github.com/acme-labs/widget/runs/4401?check_suite_focus=true',
    );
  });

  it('strips NUL from every text', async () => {
    // Called directly: the webhook service already replaces NUL in the payload it stores
    await recordCheckRun(
      repoLinkId,
      checkRun({
        id: 4412,
        name: 'te\u0000st',
        head_sha: `${SHA_B}\u0000`,
        conclusion: 'failure',
        app: { id: 1, slug: 'acme\u0000-lint' },
        output: { title: 'bro\u0000ken', summary: 'su\u0000m', text: 'te\u0000xt' },
      }),
      AUTH,
    );

    expect(await stored(4412)).toMatchObject({
      name: 'test',
      headSha: SHA_B,
      appSlug: 'acme-lint',
      failedStep: 'broken',
      logTail: 'sum\ntext',
    });
  });

  it('ignores an event about a repository that is not linked, and an action it has no use for', async () => {
    expect(await deliver(event(checkRun(), 'completed', REPO_ID + 1))).toBe('IGNORED');
    expect(await deliver(event(checkRun(), 'requested_action'))).toBe('IGNORED');
    expect(
      await deliver({
        action: 'completed',
        check_run: { id: 'not-a-number' },
        repository: { id: REPO_ID },
      }),
    ).toBe('IGNORED');

    expect(await stored()).toBeNull();
  });
});

describe('older and newer payloads', () => {
  it('does not let an older payload overwrite a newer one', async () => {
    await deliver(event(checkRun({ conclusion: 'failure', completed_at: '2026-11-06T10:05:00Z' })));
    await deliver(event(checkRun({ conclusion: 'success', completed_at: '2026-11-06T10:01:00Z' })));

    expect(await stored()).toMatchObject({ conclusion: 'failure' });
  });

  it('never takes a completed run back to a running one', async () => {
    await deliver(event(checkRun({ conclusion: 'success' })));
    await deliver(
      event(checkRun({ status: 'in_progress', conclusion: null, completed_at: null }), 'created'),
    );

    expect(await stored()).toMatchObject({ status: 'completed', conclusion: 'success' });
  });

  it('takes a queued run on to running and to completed', async () => {
    await deliver(
      event(
        checkRun({ status: 'queued', conclusion: null, started_at: null, completed_at: null }),
        'created',
      ),
    );
    expect((await stored())?.status).toBe('queued');
    await deliver(
      event(checkRun({ status: 'in_progress', conclusion: null, completed_at: null }), 'created'),
    );
    expect((await stored())?.status).toBe('in_progress');
    await deliver(event(checkRun({ conclusion: 'success' })));
    expect(await stored()).toMatchObject({ status: 'completed', conclusion: 'success' });
  });

  it('does not report the failure of a stale payload', async () => {
    await deliver(event(checkRun({ conclusion: 'success', completed_at: '2026-11-06T10:05:00Z' })));
    outcomes.length = 0;
    await deliver(
      event(checkRun({ id: JOB_ID, conclusion: 'failure', completed_at: '2026-11-06T10:01:00Z' })),
    );

    expect(outcomes).toHaveLength(0);
    expect(requestsTo('/actions/')).toHaveLength(0);
  });
});

describe('checkStateOf', () => {
  it('is none for a commit with no runs', async () => {
    expect(await checkStateOf(repoLinkId, SHA_A)).toBe('none');
  });

  it('is failed with one failed run and one pending', async () => {
    await seedRun(1, SHA_A, 'completed', 'failure');
    await seedRun(2, SHA_A, 'in_progress', null);

    expect(await checkStateOf(repoLinkId, SHA_A)).toBe('failed');
  });

  it('is pending while a run is still going and none failed', async () => {
    await seedRun(1, SHA_A, 'completed', 'success');
    await seedRun(2, SHA_A, 'queued', null);

    expect(await checkStateOf(repoLinkId, SHA_A)).toBe('pending');
  });

  it('is passed with two successes and a skipped run', async () => {
    await seedRun(1, SHA_A, 'completed', 'success');
    await seedRun(2, SHA_A, 'completed', 'success');
    await seedRun(3, SHA_A, 'completed', 'skipped');

    expect(await checkStateOf(repoLinkId, SHA_A)).toBe('passed');
  });

  it.each(FAILED_CONCLUSIONS)('is failed for %s', async (conclusion) => {
    await seedRun(1, SHA_A, 'completed', 'success');
    await seedRun(2, SHA_A, 'completed', conclusion);

    expect(await checkStateOf(repoLinkId, SHA_A)).toBe('failed');
  });

  it('looks at one commit and one repository only', async () => {
    await seedRun(1, SHA_B, 'completed', 'failure');
    await seedRun(2, SHA_A, 'completed', 'success');

    expect(await checkStateOf(repoLinkId, SHA_A)).toBe('passed');
    expect(await checkStateOf('some-other-link', SHA_B)).toBe('none');
  });
});

describe('transitions', () => {
  it('reports checks_failed once, and not again for a second failed run at the same commit', async () => {
    await deliver(event(checkRun()));
    expect(transitions()).toEqual(['checks_failed']);

    await deliver(event(checkRun({ id: 4420, name: 'build', app: { id: 1, slug: 'acme-ci' } })));
    await deliver(event(checkRun({ id: 4421, name: 'deploy', app: { id: 1, slug: 'acme-ci' } })));

    expect(transitions()).toEqual(['checks_failed']);
    expect(outcomes).toHaveLength(3);
  });

  it('reports a redelivery of the failure once', async () => {
    const payload = event(checkRun());
    await deliver(payload);
    await deliver(payload);
    await deliver(payload, 'same-delivery-twice-' + randomUUID());

    expect(transitions()).toEqual(['checks_failed']);
  });

  it('reports checks_passed when the last pending run succeeds, and not before', async () => {
    await deliver(event(checkRun({ id: 4430, conclusion: 'success' })));
    expect(transitions()).toEqual(['checks_passed']);
    outcomes.length = 0;

    await deliver(
      event(
        checkRun({ id: 4431, status: 'in_progress', conclusion: null, completed_at: null }),
        'created',
      ),
    );
    expect(transitions()).toEqual([]);
    await deliver(event(checkRun({ id: 4431, conclusion: 'success' })));
    expect(transitions()).toEqual(['checks_passed']);
  });

  it('reports nothing for a pending state, and a failure that was passed before reports checks_failed', async () => {
    await deliver(
      event(
        checkRun({
          id: 4440,
          status: 'queued',
          conclusion: null,
          started_at: null,
          completed_at: null,
        }),
        'created',
      ),
    );
    expect(transitions()).toEqual([]);
    await deliver(event(checkRun({ id: 4441, conclusion: 'success' })));
    expect(transitions()).toEqual([]);
    await deliver(
      event(checkRun({ id: 4440, conclusion: 'failure', app: { id: 1, slug: 'acme-ci' } })),
    );
    expect(transitions()).toEqual(['checks_failed']);
  });

  it('keeps commits apart', async () => {
    await deliver(
      event(checkRun({ id: 4450, conclusion: 'failure', app: { id: 1, slug: 'acme-ci' } })),
    );
    await deliver(
      event(
        checkRun({
          id: 4451,
          head_sha: SHA_B,
          conclusion: 'failure',
          app: { id: 1, slug: 'acme-ci' },
        }),
      ),
    );

    expect(transitions()).toEqual(['checks_failed', 'checks_failed']);
    expect(outcomes.map((o) => o.headSha)).toEqual([SHA_A, SHA_B]);
  });

  it('reports a failure once when several failed runs of one commit are stored at the same time', async () => {
    const auth = AUTH;
    const runs = Array.from({ length: 8 }, (_, i) =>
      checkRun({ id: 4460 + i, name: `job ${i}`, app: { id: 1, slug: 'acme-ci' } }),
    );

    await Promise.all(runs.map((run) => recordCheckRun(repoLinkId, run, auth)));

    expect(await prisma.githubCheckRun.count({ where: { repoLinkId, headSha: SHA_A } })).toBe(8);
    expect(transitions()).toEqual(['checks_failed']);
  });

  it('tells the listeners the commit and the issues of the pull requests at that commit', async () => {
    const pr = await prisma.githubPullRequest.create({
      data: {
        repoLinkId,
        number: 17,
        title: `${ctx.projectPrefix}-1 add the widget`,
        state: 'OPEN',
        draft: false,
        authorLogin: 'voorbeeld-dev',
        headRef: 'x',
        headSha: SHA_A,
        baseRef: 'main',
        requestedReviewers: [],
        htmlUrl: 'https://github.com/acme-labs/widget/pull/17',
        openedAt: new Date(),
        githubUpdatedAt: new Date(),
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

    await deliver(event(checkRun()));

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({
      repoLinkId,
      projectId: ctx.projectId,
      event: 'check_run',
      action: 'completed',
      source: 'webhook',
      headSha: SHA_A,
      pullRequestId: pr.id,
      linkedIssueIds: [issueId],
      drivingIssueIds: [issueId],
      transitions: ['checks_failed'],
    });
    expect(outcomes[0].actor.login).toBe('voorbeeld-dev');
  });

  it('names no issue for a commit no pull request has as its head', async () => {
    await deliver(event(checkRun()));

    expect(outcomes[0]).toMatchObject({
      headSha: SHA_A,
      linkedIssueIds: [],
      pullRequestId: undefined,
    });
  });
});

describe('a refused installation token (Ruling P3)', () => {
  const mints = () => requestsTo('/access_tokens').length;
  const jobPath = `/repos/acme-labs/widget/actions/jobs/${JOB_ID}`;

  beforeEach(() => clearInstallationTokens());

  it('clears the cached token and retries a request once', async () => {
    await githubRequest(AUTH, 'GET', jobPath);
    expect(mints()).toBe(1);
    fake.revokeInstallationTokens(INSTALLATION_ID);

    const answer = await githubRequest<{ id: number }>(AUTH, 'GET', jobPath);

    expect(answer.data.id).toBe(JOB_ID);
    expect(mints()).toBe(2);
    expect(requestsTo(`${jobPath}`).filter((r) => r.method === 'GET')).toHaveLength(3);
  });

  it('clears the cached token and retries a text download once', async () => {
    await githubRequest(AUTH, 'GET', jobPath);
    fake.revokeInstallationTokens(INSTALLATION_ID);

    const text = await githubText(AUTH, `${jobPath}/logs`, 1_000_000);

    expect(text).toBe(LOG);
    expect(mints()).toBe(2);
    expect(requestsTo('/blob/')).toHaveLength(1);
    expect(requestsTo('/blob/')[0].headers.authorization).toBeUndefined();
  });

  it('gives up after the one retry when the new token is refused as well', async () => {
    await githubRequest(AUTH, 'GET', jobPath);
    fake.on('GET /repos/:owner/:repo/actions/jobs/:job_id', {
      status: 401,
      body: { message: 'Bad credentials' },
    });
    const before = requestsTo(jobPath).length;

    const error = await githubRequest(AUTH, 'GET', jobPath).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('GITHUB_APP_AUTH');
    expect(requestsTo(jobPath).length - before).toBe(2);
    expect(mints()).toBe(2);
  });

  it('lets a delivery recover from a revoked token', async () => {
    await githubRequest(AUTH, 'GET', jobPath);
    fake.revokeInstallationTokens(INSTALLATION_ID);

    expect(await deliver(event(checkRun()))).toBe('PROCESSED');

    expect(await stored()).toMatchObject({ failedStep: 'Run tests', logUnavailable: false });
  });
});
