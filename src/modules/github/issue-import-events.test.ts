import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { GithubRepoLink } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';
import { postWebhook } from '../../test/github-webhook';
import { createRule } from '../automation/automation.service';
import { updateIssue } from '../issues/issues.service';

import { hourStartOf, importCapState, LIVE_IMPORT_CAP } from './import-cap';
import { GITHUB_INTEGRATION_USER_ID } from './integration-user';
import { importGithubIssue, type GithubIssuePayload } from './issue-import.service';
import { reconcileRepo } from './reconcile.service';
import { processDelivery } from './webhook.service';
import './github-resolvers';
import './webhook-handlers';

const REPO_ID = 880_720;
const INSTALLATION_ID = 4721;
const FULL_NAME = 'acme-labs/widget';
const FIXTURES = path.join(__dirname, '../../test/__fixtures__/github/import');

type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = (name: string): Payload =>
  (JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as { body: Payload }).body;
const ghIssue = (over: Payload = {}): Payload => ({ ...fixture('get-issue'), ...over });
const repository = {
  id: REPO_ID,
  name: 'widget',
  full_name: FULL_NAME,
  html_url: 'https://github.com/acme-labs/widget',
  owner: { login: 'acme-labs', id: 4001 },
};
const sender = { id: 7001, login: 'voorbeeld-dev' };

const fake = useGithubFake('import');
let ctx: TestContext;
let member: TestUser;
let link: GithubRepoLink;

let lastDeliveryId = '';
async function deliver(event: string, payload: Payload) {
  const deliveryId = randomUUID();
  lastDeliveryId = deliveryId;
  const res = await postWebhook(
    event,
    { repository, sender, installation: { id: INSTALLATION_ID }, ...payload },
    { deliveryId },
  );
  expect(res.status).toBe(202);
  await vi.waitFor(async () => {
    const row = await prisma.githubDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(['PROCESSED', 'IGNORED', 'FAILED']).toContain(row.status);
  });
  const row = await prisma.githubDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
  return row.status;
}
const issuesEvent = (action: string, issue: Payload, extra: Payload = {}) =>
  deliver('issues', { action, issue, ...extra });
const commentEvent = (action: string, comment: Payload, issue: Payload = ghIssue()) =>
  deliver('issue_comment', { action, issue, comment });

const importOf = (number = 31) =>
  prisma.githubIssueImport.findUnique({
    where: { repoLinkId_githubIssueNumber: { repoLinkId: link.id, githubIssueNumber: number } },
  });
async function imported(number = 31) {
  const row = await importOf(number);
  if (!row) throw new Error(`GitHub issue #${number} was not imported`);
  return prisma.issue.findUniqueOrThrow({
    where: { id: row.issueId },
    include: { labels: true, comments: { orderBy: { createdAt: 'asc' } } },
  });
}
const activities = (issueId: string, action: string) =>
  prisma.activity.findMany({ where: { resourceId: issueId, action } });
const comment = (over: Payload = {}): Payload => ({
  id: 9401,
  body: 'Seen on the latest release too.',
  user: { login: 'outside-dev', id: 7002, type: 'User' },
  created_at: '2026-11-07T11:00:00Z',
  updated_at: '2026-11-07T11:00:00Z',
  ...over,
});

beforeAll(async () => {
  await seedGithubApp({ fake });
  fake.addInstallation(INSTALLATION_ID, [FULL_NAME]);
  fake.setRepoId(FULL_NAME, REPO_ID);
  ctx = await createTestContext('gim2');
  member = await addMemberToContext(ctx);
});

beforeEach(async () => {
  fake.setRepoLists(FULL_NAME, {
    issues: [ghIssue(), ghIssue({ number: 33, id: 2200033 }), ghIssue({ number: 34, id: 2200034 })],
    issueComments: {},
  });
  await prisma.automationRule.deleteMany({ where: { projectId: ctx.projectId } });
  await prisma.issue.deleteMany({ where: { projectId: ctx.projectId } });
  await prisma.githubAccount.deleteMany();
  await prisma.githubInstallation.deleteMany();
  await prisma.githubInstallation.create({
    data: { id: BigInt(INSTALLATION_ID), accountLogin: 'acme-labs', accountType: 'Organization' },
  });
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  await prisma.githubDelivery.deleteMany();
  link = await prisma.githubRepoLink.create({
    data: {
      projectId: ctx.projectId,
      repoId: BigInt(REPO_ID),
      installationId: BigInt(INSTALLATION_ID),
      owner: 'acme-labs',
      name: 'widget',
      fullName: FULL_NAME,
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/acme-labs/widget',
      linkedById: ctx.owner.id,
      importIssues: true,
      createdAt: new Date('2026-11-01T00:00:00Z'),
    },
  });
});

afterAll(async () => {
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  await prisma.githubInstallation.deleteMany();
  await prisma.githubAccount.deleteMany();
  await cleanupTestContext(ctx);
});

describe('issues events', () => {
  it('imports an opened issue and posts the link comment', async () => {
    expect(await issuesEvent('opened', ghIssue())).toBe('PROCESSED');
    const issue = await imported();
    expect(issue.title).toBe('The widget forgets its colour after a restart');
    expect((await importOf())?.linkCommentId).toBe('5001');
  });

  it('keeps a title edited in Axiom and takes a body edited only on GitHub', async () => {
    await issuesEvent('opened', ghIssue());
    const issue = await imported();
    await updateIssue(ctx.projectId, issue.number, { title: 'Colour lost on restart' }, member.id);

    const status = await issuesEvent(
      'edited',
      ghIssue({
        title: 'The widget loses its colour',
        body: 'New steps from GitHub',
        updated_at: '2026-11-07T12:00:00Z',
      }),
      { changes: { title: { from: 'The widget forgets its colour after a restart' } } },
    );
    expect(status).toBe('PROCESSED');
    const after = await imported();
    expect(after.title).toBe('Colour lost on restart');
    expect(after.body).toBe('New steps from GitHub');
    const conflicts = await activities(issue.id, 'import_conflict');
    expect(conflicts.map((a) => a.details)).toEqual([{ field: 'title' }]);
  });

  it('applies labels added on GitHub while Axiom has not changed them', async () => {
    await issuesEvent('opened', ghIssue());
    const labels = [{ name: 'bug' }, { name: 'needs-triage' }, { name: 'confirmed' }];
    expect(
      await issuesEvent('labeled', ghIssue({ labels, updated_at: '2026-11-07T12:00:00Z' }), {
        label: { name: 'confirmed' },
      }),
    ).toBe('PROCESSED');
    const after = await imported();
    expect(after.labels.map((l) => l.name).sort()).toEqual(['bug', 'confirmed', 'needs-triage']);
    expect(await activities(after.id, 'import_conflict')).toHaveLength(0);
  });

  it('keeps labels changed in Axiom and notes the conflict', async () => {
    await issuesEvent('opened', ghIssue());
    const issue = await imported();
    await updateIssue(ctx.projectId, issue.number, { labels: ['bug'] }, member.id);
    await issuesEvent(
      'unlabeled',
      ghIssue({ labels: [{ name: 'needs-triage' }], updated_at: '2026-11-07T12:00:00Z' }),
    );
    const after = await imported();
    expect(after.labels.map((l) => l.name)).toEqual(['bug']);
    const conflicts = await activities(issue.id, 'import_conflict');
    expect(conflicts.map((a) => a.details)).toEqual([{ field: 'labels' }]);
  });

  it('leaves the Axiom issue where it is when the GitHub issue closes', async () => {
    await issuesEvent('opened', ghIssue());
    const before = await imported();
    const status = await issuesEvent(
      'closed',
      ghIssue({ state: 'closed', closed_at: '2026-11-07T13:00:00Z' }),
    );
    expect(status).toBe('PROCESSED');
    const after = await imported();
    expect(after.columnId).toBe(before.columnId);
    expect(after.title).toBe(before.title);
    expect(await activities(after.id, 'github_closed')).toHaveLength(1);
  });

  it('notes a deleted or transferred GitHub issue without changing the Axiom one', async () => {
    await issuesEvent('opened', ghIssue());
    const before = await imported();
    expect(await issuesEvent('transferred', ghIssue())).toBe('PROCESSED');
    expect(await issuesEvent('deleted', ghIssue())).toBe('PROCESSED');
    const after = await imported();
    expect(after.columnId).toBe(before.columnId);
    expect(await activities(after.id, 'github_transferred')).toHaveLength(1);
    expect(await activities(after.id, 'github_deleted')).toHaveLength(1);
    // Of an issue never imported there is nothing to note
    expect(await issuesEvent('closed', ghIssue({ number: 40, state: 'closed' }))).toBe('IGNORED');
  });

  it('imports an issue reopened after it was closed before the import, and an unknown open one on edit', async () => {
    expect(await issuesEvent('closed', ghIssue({ number: 33, state: 'closed' }))).toBe('IGNORED');
    expect(await issuesEvent('reopened', ghIssue({ number: 33, id: 2200033 }))).toBe('PROCESSED');
    expect((await imported(33)).title).toBe('The widget forgets its colour after a restart');

    fake.setRepoLists(FULL_NAME, {
      issues: [ghIssue({ number: 34, id: 2200034 })],
      issueComments: { '34': [comment()] },
    });
    expect(await issuesEvent('edited', ghIssue({ number: 34, id: 2200034 }))).toBe('PROCESSED');
    const unknown = await imported(34);
    expect(unknown.comments.map((c) => c.body)).toEqual(['Seen on the latest release too.']);
  });

  it('runs issue:created rules for an issue opened after the link, not for one found on edit', async () => {
    await createRule(ctx.projectId, {
      name: 'welcome',
      trigger: 'issue:created',
      actions: [{ type: 'add_comment', body: 'Welcome' }],
    });
    await issuesEvent('opened', ghIssue());
    await vi.waitFor(async () => {
      expect((await imported()).comments.map((c) => c.body)).toEqual(['Welcome']);
    });
    await issuesEvent('edited', ghIssue({ number: 33, id: 2200033 }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await imported(33)).comments).toHaveLength(0);
  });
});

describe('races and Axiom deletes', () => {
  it('runs issue:created rules when labeled is processed before opened', async () => {
    await createRule(ctx.projectId, {
      name: 'welcome',
      trigger: 'issue:created',
      actions: [{ type: 'add_comment', body: 'Welcome' }],
    });
    expect(await issuesEvent('labeled', ghIssue(), { label: { name: 'bug' } })).toBe('PROCESSED');
    expect(await issuesEvent('opened', ghIssue())).toBe('PROCESSED');
    await vi.waitFor(async () => {
      expect((await imported()).comments.map((c) => c.body)).toEqual(['Welcome']);
    });
    expect(await prisma.issue.count({ where: { projectId: ctx.projectId } })).toBe(1);
  });

  it('runs no rules for a labeled issue made before the link', async () => {
    await createRule(ctx.projectId, {
      name: 'welcome',
      trigger: 'issue:created',
      actions: [{ type: 'add_comment', body: 'Welcome' }],
    });
    await issuesEvent('labeled', ghIssue({ created_at: '2026-10-01T09:00:00Z' }));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await imported()).comments).toHaveLength(0);
  });

  it('makes one issue from opened and labeled delivered at once', async () => {
    const [a, b] = await Promise.all([
      issuesEvent('opened', ghIssue()),
      issuesEvent('labeled', ghIssue(), { label: { name: 'bug' } }),
    ]);
    expect([a, b]).toEqual(['PROCESSED', 'PROCESSED']);
    expect(await prisma.issue.count({ where: { projectId: ctx.projectId } })).toBe(1);
    expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(1);
  });

  it('notes a body conflict and keeps the Axiom body', async () => {
    await issuesEvent('opened', ghIssue());
    const issue = await imported();
    await updateIssue(ctx.projectId, issue.number, { body: 'Written in Axiom' }, member.id);
    await issuesEvent('edited', ghIssue({ body: 'Rewritten', updated_at: '2026-11-07T12:00:00Z' }));
    expect((await imported()).body).toBe('Written in Axiom');
    const conflicts = await activities(issue.id, 'import_conflict');
    expect(conflicts.map((a) => a.details)).toEqual([{ field: 'body' }]);
  });

  it('leaves an issue deleted in Axiom deleted, whatever GitHub sends', async () => {
    await issuesEvent('opened', ghIssue());
    await prisma.issue.deleteMany({ where: { projectId: ctx.projectId } });
    for (const action of ['edited', 'labeled', 'reopened', 'closed']) {
      expect(await issuesEvent(action, ghIssue({ updated_at: '2026-11-07T12:00:00Z' }))).toBe(
        'IGNORED',
      );
    }
    expect(await commentEvent('created', comment())).toBe('IGNORED');
    expect(await prisma.issue.count({ where: { projectId: ctx.projectId } })).toBe(0);
  });
});

describe('issue_comment events', () => {
  it('imports a comment with its author', async () => {
    await issuesEvent('opened', ghIssue());
    expect(await commentEvent('created', comment())).toBe('PROCESSED');
    const issue = await imported();
    expect(issue.comments).toEqual([
      expect.objectContaining({
        body: 'Seen on the latest release too.',
        authorId: GITHUB_INTEGRATION_USER_ID,
        externalAuthorLogin: 'outside-dev',
      }),
    ]);
  });

  it('imports neither the link comment of the App nor a bot comment', async () => {
    await issuesEvent('opened', ghIssue());
    const row = await importOf();
    const linkComment = fake.requests.find((r) => r.method === 'POST')?.body as { body: string };
    await commentEvent(
      'created',
      comment({
        id: Number(row!.linkCommentId),
        body: linkComment.body,
        user: { login: 'acme-axiom[bot]', id: 9_900_001, type: 'Bot' },
      }),
    );
    await commentEvent(
      'created',
      comment({ id: 9402, user: { login: 'triage-helper[bot]', id: 7003, type: 'Bot' } }),
    );
    expect((await imported()).comments).toHaveLength(0);
  });

  it('updates the Axiom copy of an edited comment until it is edited in Axiom', async () => {
    await issuesEvent('opened', ghIssue());
    await commentEvent('created', comment());
    await commentEvent(
      'edited',
      comment({ body: 'Seen on 2.1 as well.', updated_at: '2026-11-07T12:00:00Z' }),
    );
    let [copy] = (await imported()).comments;
    expect(copy.body).toBe('Seen on 2.1 as well.');

    await prisma.comment.update({ where: { id: copy.id }, data: { body: 'Edited in Axiom' } });
    await commentEvent(
      'edited',
      comment({ body: 'Seen on 2.2 too.', updated_at: '2026-11-07T13:00:00Z' }),
    );
    [copy] = (await imported()).comments;
    expect(copy.body).toBe('Edited in Axiom');
    const conflicts = await activities(copy.issueId, 'import_conflict');
    expect(conflicts.map((a) => a.details)).toEqual([{ field: 'comment', commentId: copy.id }]);
  });

  it('ignores comments on pull requests and on issues that were not imported', async () => {
    await issuesEvent('opened', ghIssue());
    const pull = ghIssue({ pull_request: { url: 'https://api.github.com/repos/x/y/pulls/31' } });
    expect(await commentEvent('created', comment(), pull)).toBe('IGNORED');
    expect(await commentEvent('created', comment(), ghIssue({ number: 33 }))).toBe('IGNORED');
    expect((await imported()).comments).toHaveLength(0);
  });
});

describe('import switched off', () => {
  it('ignores every event', async () => {
    await prisma.githubRepoLink.update({ where: { id: link.id }, data: { importIssues: false } });
    for (const action of ['opened', 'edited', 'labeled', 'reopened', 'closed']) {
      expect(await issuesEvent(action, ghIssue())).toBe('IGNORED');
    }
    expect(await commentEvent('created', comment())).toBe('IGNORED');
    expect(await prisma.issue.count({ where: { projectId: ctx.projectId } })).toBe(0);
    expect(fake.requests.filter((r) => r.method === 'POST')).toHaveLength(0);
  });
});

describe('the hourly cap on live imports', () => {
  const HOUR = 3_600_000;
  const fill = (over: { issues?: number; comments?: number }) =>
    prisma.githubImportCap.create({
      data: { repoLinkId: link.id, hourStart: hourStartOf(new Date()), ...over },
    });
  const lastError = async () =>
    (await prisma.githubDelivery.findUniqueOrThrow({ where: { id: lastDeliveryId } })).error;

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips the 101st new issue of the hour, counts it and reports the pause', async () => {
    await fill({ issues: LIVE_IMPORT_CAP.issues - 1 });
    expect(await issuesEvent('opened', ghIssue())).toBe('PROCESSED');
    expect(await issuesEvent('opened', ghIssue({ number: 33, id: 2200033 }))).toBe('IGNORED');
    expect(await lastError()).toMatch(/hourly import cap of 100 new issues/);
    expect(await importOf(33)).toBeNull();
    // No retry storm: an ignored delivery is not retried
    const row = await prisma.githubDelivery.findUniqueOrThrow({ where: { id: lastDeliveryId } });
    expect(row.nextAttemptAt).toBeNull();

    const state = await importCapState(link.id);
    const hourStart = hourStartOf(new Date());
    expect(state).toEqual({
      paused: true,
      resumesAt: new Date(hourStart.getTime() + HOUR),
      issues: { used: 100, limit: 100, skipped: 1 },
      comments: { used: 0, limit: 300, skipped: 0 },
    });
  });

  it('skips the 301st new comment of the hour and counts it', async () => {
    await issuesEvent('opened', ghIssue());
    await prisma.githubImportCap.update({
      where: { repoLinkId_hourStart: { repoLinkId: link.id, hourStart: hourStartOf(new Date()) } },
      data: { comments: LIVE_IMPORT_CAP.comments - 1 },
    });
    expect(await commentEvent('created', comment())).toBe('PROCESSED');
    expect(await commentEvent('created', comment({ id: 9402 }))).toBe('IGNORED');
    expect(await lastError()).toMatch(/hourly import cap of 300 new comments/);
    expect((await imported()).comments).toHaveLength(1);
    const state = await importCapState(link.id);
    expect(state.paused).toBe(true);
    expect(state.comments).toEqual({ used: 300, limit: 300, skipped: 1 });
  });

  it('does not cap updates of what is imported, nor the backfill', async () => {
    await issuesEvent('opened', ghIssue());
    await commentEvent('created', comment());
    await prisma.githubImportCap.updateMany({
      where: { repoLinkId: link.id },
      data: { issues: LIVE_IMPORT_CAP.issues, comments: LIVE_IMPORT_CAP.comments },
    });
    expect(
      await issuesEvent(
        'edited',
        ghIssue({ title: 'Renamed', updated_at: '2026-11-07T12:00:00Z' }),
      ),
    ).toBe('PROCESSED');
    expect((await imported()).title).toBe('Renamed');
    expect(
      await commentEvent(
        'edited',
        comment({ body: 'Edited on GitHub', updated_at: '2026-11-07T12:00:00Z' }),
      ),
    ).toBe('PROCESSED');
    expect((await imported()).comments[0].body).toBe('Edited on GitHub');
    // The backfill leaves `live` unset
    const backfilled = await importGithubIssue(
      link,
      ghIssue({ number: 33, id: 2200033 }) as GithubIssuePayload,
      { withComments: false },
    );
    expect(backfilled?.created).toBe(true);
    expect((await importCapState(link.id)).issues.skipped).toBe(0);
  });

  it('opens again in the next hour', async () => {
    await fill({ issues: LIVE_IMPORT_CAP.issues });
    expect(await issuesEvent('opened', ghIssue())).toBe('IGNORED');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(hourStartOf(new Date()).getTime() + HOUR + 1000);
    expect((await importCapState(link.id)).paused).toBe(false);
    expect(await issuesEvent('opened', ghIssue())).toBe('PROCESSED');
    expect(await importOf()).not.toBeNull();
  });

  it('lets the reconcile after the pause import what the cap turned away', async () => {
    await issuesEvent('opened', ghIssue());
    await prisma.githubImportCap.updateMany({
      where: { repoLinkId: link.id },
      data: { issues: LIVE_IMPORT_CAP.issues, comments: LIVE_IMPORT_CAP.comments },
    });
    const recent = new Date().toISOString();
    const missed = ghIssue({ number: 33, id: 2200033, updated_at: recent });
    const missedComment = comment({ id: 9405, updated_at: recent, created_at: recent });
    fake.setRepoLists(FULL_NAME, {
      issues: [ghIssue(), missed],
      issueComments: { '31': [missedComment] },
      pulls: [],
      branches: [],
      checkRuns: {},
    });
    expect(await issuesEvent('opened', missed)).toBe('IGNORED');
    expect(await commentEvent('created', missedComment)).toBe('IGNORED');

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(hourStartOf(new Date()).getTime() + HOUR + 1000);
    await reconcileRepo(link.id);
    expect(await importOf(33)).not.toBeNull();
    expect((await imported()).comments.map((c) => c.body)).toEqual([missedComment.body]);
    const state = await importCapState(link.id);
    expect(state.issues.used).toBe(1);
    expect(state.comments.used).toBe(1);
  });
});

describe('fix round 3', () => {
  const HOUR = 3_600_000;
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const quiet = () => ({ pulls: [], branches: [], checkRuns: {} });
  const fillIssues = (issues: number) =>
    prisma.githubImportCap.upsert({
      where: { repoLinkId_hourStart: { repoLinkId: link.id, hourStart: hourStartOf(new Date()) } },
      create: { repoLinkId: link.id, hourStart: hourStartOf(new Date()), issues },
      update: { issues },
    });
  const linkRow = () => prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('imports the comments on the retry of a delivery whose comment read failed', async () => {
    fake.on('GET /repos/:owner/:repo/issues/:number/comments', {
      status: 502,
      body: { message: 'Bad Gateway' },
    });
    expect(await issuesEvent('opened', ghIssue())).toBe('FAILED');
    const failed = lastDeliveryId;
    fake.reset();
    fake.setRepoLists(FULL_NAME, { issues: [ghIssue()], issueComments: { '31': [comment()] } });
    await prisma.githubDelivery.update({ where: { id: failed }, data: { nextAttemptAt: null } });
    await processDelivery(failed);
    const row = await prisma.githubDelivery.findUniqueOrThrow({ where: { id: failed } });
    expect(row.status).toBe('PROCESSED');
    expect((await imported()).comments.map((c) => c.body)).toEqual([comment().body]);
  });

  it('lets the reconcile post the link comment of a claim a dead run left', async () => {
    await issuesEvent('opened', ghIssue());
    await prisma.githubIssueImport.updateMany({
      where: { repoLinkId: link.id },
      data: { linkCommentId: null, linkCommentClaimedAt: new Date(Date.now() - 11 * 60_000) },
    });
    fake.setRepoLists(FULL_NAME, { issues: [ghIssue()], issueComments: {}, ...quiet() });
    fake.requests.length = 0;
    await reconcileRepo(link.id);
    const posts = fake.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/comments'));
    expect(posts).toHaveLength(1);
    expect((await importOf())?.linkCommentId).not.toBeNull();
  });

  it('gives the slot back when the creation fails, and counts a capped issue once', async () => {
    const column = await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: ctx.projectId, isDefault: true },
    });
    const other = await prisma.boardColumn.findFirstOrThrow({
      where: { projectId: ctx.projectId, isDefault: false },
    });
    const gate = await prisma.approvalGate.create({
      data: { projectId: ctx.projectId, fromColumnId: other.id, toColumnId: column.id },
    });
    expect(await issuesEvent('opened', ghIssue())).toBe('FAILED');
    expect((await importCapState(link.id)).issues.used).toBe(0);
    await prisma.approvalGate.delete({ where: { id: gate.id } });

    await fillIssues(LIVE_IMPORT_CAP.issues);
    await issuesEvent('opened', ghIssue({ number: 33, id: 2200033 }));
    await issuesEvent('labeled', ghIssue({ number: 33, id: 2200033 }), { label: { name: 'bug' } });
    await issuesEvent('labeled', ghIssue({ number: 33, id: 2200033 }), { label: { name: 'x' } });
    expect((await importCapState(link.id)).issues.skipped).toBe(1);
  });

  it('resumes the catch-up from its cursor, oldest first, without advancing past the cap', async () => {
    const a = ghIssue({
      number: 51,
      id: 2200051,
      created_at: ago(3 * HOUR),
      updated_at: ago(3 * HOUR),
    });
    const b = ghIssue({
      number: 52,
      id: 2200052,
      created_at: ago(2.5 * HOUR),
      updated_at: ago(2.5 * HOUR),
    });
    const c = ghIssue({
      number: 53,
      id: 2200053,
      created_at: ago(60_000),
      updated_at: ago(60_000),
    });
    fake.setRepoLists(FULL_NAME, { issues: [c, a, b], issueComments: {}, ...quiet() });
    await prisma.githubRepoLink.update({
      where: { id: link.id },
      data: { importIssuesSeenAt: new Date(Date.now() - 4 * HOUR) },
    });
    await fillIssues(LIVE_IMPORT_CAP.issues - 1);
    await reconcileRepo(link.id);
    expect(await importOf(51)).not.toBeNull();
    expect(await importOf(52)).toBeNull();
    expect(await importOf(53)).toBeNull();
    expect((await linkRow()).importIssuesSeenAt?.toISOString()).toBe(a.updated_at);
    expect((await linkRow()).lastReconcileNote).toMatch(/hourly import cap/);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(hourStartOf(new Date()).getTime() + HOUR + 1000);
    await reconcileRepo(link.id);
    expect(await importOf(52)).not.toBeNull();
    expect(await importOf(53)).not.toBeNull();
    expect((await linkRow()).importIssuesSeenAt!.getTime()).toBeGreaterThanOrEqual(
      Date.parse(c.updated_at),
    );
  });

  it('looks back at most 72 hours and says so', async () => {
    fake.setRepoLists(FULL_NAME, { issues: [], issueComments: {}, ...quiet() });
    await prisma.githubRepoLink.update({
      where: { id: link.id },
      data: { importIssuesSeenAt: new Date(Date.now() - 5 * 24 * HOUR) },
    });
    await reconcileRepo(link.id);
    const read = fake.requests.find(
      (r) => r.method === 'GET' && r.path === `/repositories/${REPO_ID}/issues`,
    );
    expect(Date.parse(read!.query.since)).toBeGreaterThanOrEqual(Date.now() - 72 * HOUR - 60_000);
    expect(read!.query.direction).toBe('asc');
    expect((await linkRow()).lastReconcileNote).toMatch(/72 hours/);
  });

  it('stops the catch-up when the call budget is spent', async () => {
    fake.setRepoLists(FULL_NAME, { issues: [], issueComments: {}, ...quiet() });
    await prisma.githubRepoLink.update({ where: { id: link.id }, data: { importIssues: false } });
    await reconcileRepo(link.id);
    const baseline = (await reconcileRepo(link.id)).calls;
    await prisma.githubRepoLink.update({ where: { id: link.id }, data: { importIssues: true } });
    const a = ghIssue({ number: 61, id: 2200061, updated_at: ago(10 * 60_000) });
    const b = ghIssue({ number: 62, id: 2200062, updated_at: ago(5 * 60_000) });
    fake.setRepoLists(FULL_NAME, { issues: [a, b], issueComments: {}, ...quiet() });
    // The lists before it, and the issue list itself: nothing left for an issue's comment read
    await reconcileRepo(link.id, { callBudget: baseline });
    expect(await importOf(62)).toBeNull();
    expect((await linkRow()).importIssuesSeenAt).toBeNull();
  });

  it('runs issue:created rules for a caught-up issue made after the link, not for an older one', async () => {
    await createRule(ctx.projectId, {
      name: 'welcome',
      trigger: 'issue:created',
      actions: [{ type: 'add_comment', body: 'Welcome' }],
    });
    const fresh = ghIssue({
      number: 71,
      id: 2200071,
      created_at: ago(HOUR),
      updated_at: ago(HOUR),
    });
    const old = ghIssue({
      number: 72,
      id: 2200072,
      created_at: '2026-10-01T09:00:00Z',
      updated_at: ago(HOUR),
    });
    fake.setRepoLists(FULL_NAME, { issues: [fresh, old], issueComments: {}, ...quiet() });
    await reconcileRepo(link.id);
    await vi.waitFor(async () => {
      expect((await imported(71)).comments.map((c) => c.body)).toEqual(['Welcome']);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await imported(72)).comments).toHaveLength(0);
    expect((await importCapState(link.id)).issues.used).toBe(2);
  });
});

describe('fix round 4', () => {
  const HOUR = 3_600_000;
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
  const quiet = () => ({ pulls: [], branches: [], checkRuns: {} });
  const fillComments = (comments: number) =>
    prisma.githubImportCap.upsert({
      where: { repoLinkId_hourStart: { repoLinkId: link.id, hourStart: hourStartOf(new Date()) } },
      create: { repoLinkId: link.id, hourStart: hourStartOf(new Date()), comments },
      update: { comments },
    });
  const linkRow = () => prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } });
  const nextHour = () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(hourStartOf(new Date()).getTime() + HOUR + 1000);
  };
  const commentReads = () =>
    fake.requests
      .filter((r) => r.method === 'GET')
      .map((r) => /\/issues\/(\d+)\/comments$/.exec(r.path)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number);
  // Old comments: older than the comments catch-up looks back, so only a read of the issue's own
  // comments finds them
  const oldComments = [
    comment({ created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-01T09:00:00Z' }),
    comment({
      id: 9402,
      body: 'Second',
      created_at: '2026-11-01T09:05:00Z',
      updated_at: '2026-11-01T09:05:00Z',
    }),
  ];
  const backfill = async (number: number, lastImportedAt: Date) => {
    await importGithubIssue(link, ghIssue({ number, id: 2200000 + number }) as GithubIssuePayload, {
      withComments: false,
    });
    await prisma.githubIssueImport.updateMany({
      where: { repoLinkId: link.id, githubIssueNumber: number },
      data: { lastImportedAt },
    });
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads the rest of the comments the cap cut short on a webhook import', async () => {
    fake.setRepoLists(FULL_NAME, {
      issues: [ghIssue()],
      issueComments: { '31': oldComments },
      ...quiet(),
    });
    await fillComments(LIVE_IMPORT_CAP.comments - 1);
    expect(await issuesEvent('opened', ghIssue())).toBe('PROCESSED');
    expect((await imported()).comments).toHaveLength(1);
    expect((await importOf())?.commentsImportedAt).toBeNull();

    // The issue does not change on GitHub again, so no list brings it back
    fake.setRepoLists(FULL_NAME, { issues: [], issueComments: { '31': oldComments }, ...quiet() });
    nextHour();
    await reconcileRepo(link.id);
    expect((await imported()).comments.map((c) => c.body)).toEqual([oldComments[0].body, 'Second']);
    expect((await importOf())?.commentsImportedAt).not.toBeNull();
  });

  it('reads the rest of the comments the cap cut short on a caught-up issue', async () => {
    const caught = ghIssue({ created_at: ago(HOUR), updated_at: ago(HOUR) });
    fake.setRepoLists(FULL_NAME, {
      issues: [caught],
      issueComments: { '31': oldComments },
      ...quiet(),
    });
    await fillComments(LIVE_IMPORT_CAP.comments - 1);
    await reconcileRepo(link.id);
    expect((await imported()).comments).toHaveLength(1);
    expect((await importOf())?.commentsImportedAt).toBeNull();
    expect((await linkRow()).lastReconcileNote).toMatch(/hourly import cap/);
    // The catch-up moved past the issue: its next round does not list it again
    expect((await linkRow()).importIssuesSeenAt!.getTime()).toBeGreaterThan(
      Date.parse(caught.updated_at),
    );

    nextHour();
    await reconcileRepo(link.id);
    expect((await imported()).comments.map((c) => c.body)).toEqual([oldComments[0].body, 'Second']);
    expect((await importOf())?.commentsImportedAt).not.toBeNull();
  });

  it('reads at most 10 issues of comments a round, the longest waiting first', async () => {
    fake.setRepoLists(FULL_NAME, { issues: [], issueComments: {}, ...quiet() });
    const numbers = Array.from({ length: 11 }, (_, i) => 101 + i);
    for (const number of numbers) {
      await backfill(number, new Date(Date.parse('2026-11-07T00:00:00Z') + number * 60_000));
    }
    fake.requests.length = 0;
    await reconcileRepo(link.id);
    expect(commentReads()).toEqual(numbers.slice(0, 10));
    const left = await prisma.githubIssueImport.findMany({
      where: { repoLinkId: link.id, commentsImportedAt: null },
      select: { githubIssueNumber: true },
    });
    expect(left.map((row) => row.githubIssueNumber)).toEqual([111]);
  });

  it('stops reading comments when the call budget is spent', async () => {
    fake.setRepoLists(FULL_NAME, { issues: [], issueComments: {}, ...quiet() });
    await backfill(121, new Date('2026-11-07T01:00:00Z'));
    await backfill(122, new Date('2026-11-07T02:00:00Z'));
    await prisma.githubIssueImport.updateMany({
      where: { repoLinkId: link.id },
      data: { commentsImportedAt: new Date() },
    });
    await reconcileRepo(link.id);
    const baseline = (await reconcileRepo(link.id)).calls;
    await prisma.githubIssueImport.updateMany({
      where: { repoLinkId: link.id },
      data: { commentsImportedAt: null },
    });
    fake.requests.length = 0;
    // One call more than the rest of the round needs: one issue's comments
    await reconcileRepo(link.id, { callBudget: baseline + 1 });
    expect(commentReads()).toEqual([121]);
    expect((await importOf(121))?.commentsImportedAt).not.toBeNull();
    expect((await importOf(122))?.commentsImportedAt).toBeNull();
    expect((await linkRow()).lastReconcileNote).toMatch(/call budget/);
  });

  it('stops reading the comments of an issue GitHub no longer has', async () => {
    fake.setRepoLists(FULL_NAME, { issues: [], issueComments: {}, ...quiet() });
    await backfill(131, new Date('2026-11-07T01:00:00Z'));
    fake.on('GET /repos/:owner/:repo/issues/:number/comments', {
      status: 404,
      body: { message: 'Not Found' },
    });
    await reconcileRepo(link.id);
    expect((await importOf(131))?.commentsImportedAt).not.toBeNull();
    fake.requests.length = 0;
    await reconcileRepo(link.id);
    expect(commentReads()).toEqual([]);
  });

  it.each([
    ['rate limited', { status: 429, body: { message: 'Too many requests' } }],
    ['unavailable', { status: 502, body: { message: 'Bad Gateway' } }],
  ])('stops the catch-up without moving its cursor when GitHub is %s', async (_, reply) => {
    const a = ghIssue({ number: 91, id: 2200091, created_at: ago(HOUR), updated_at: ago(HOUR) });
    const b = ghIssue({
      number: 92,
      id: 2200092,
      created_at: ago(HOUR / 2),
      updated_at: ago(HOUR / 2),
    });
    fake.setRepoLists(FULL_NAME, { issues: [a, b], issueComments: {}, ...quiet() });
    fake.on('GET /repos/:owner/:repo/issues/:number/comments', reply);
    await reconcileRepo(link.id);
    expect(await importOf(92)).toBeNull();
    expect((await linkRow()).importIssuesSeenAt).toBeNull();
    expect((await linkRow()).lastReconcileNote).toMatch(/unavailable or rate limited/);
  });
});
