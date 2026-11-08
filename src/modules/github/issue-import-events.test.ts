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
