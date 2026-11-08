import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { GithubRepoLink } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { GITHUB_INTEGRATION_USER_ID } from './integration-user';
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

async function deliver(event: string, payload: Payload) {
  const deliveryId = randomUUID();
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
