/**
 * The failure condition "agents still need too many calls", measured: the developer loop over a
 * real MCP client, with every callTool counted. A scenario over its budget means fixing the action
 * or the include that forces the extra call, never raising the budget.
 */
import { execFile } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { promisify } from 'util';

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../config/database';
import '../modules/github/webhook-handlers';
import { createPage } from '../modules/wiki/wiki.service';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../test/factory';
import { useGithubFake } from '../test/github-fake';
import { seedGithubApp } from '../test/github-seed';
import { postWebhook } from '../test/github-webhook';
import { callTool, connectMcp, serveApp, tokenHeaderFor } from '../test/mcp-client';

const storagePath = path.join(tmpdir(), `axiom-call-budget-${process.pid}`);
process.env.STORAGE_PATH = storagePath;

const TOKEN_NAME = 'budget-agent';
const GITHUB_REPO_ID = 880_700;
const INSTALLATION_ID = 4301;
const HEAD_SHA = '1111111111111111111111111111111111111111';
const FIXTURES = path.join(__dirname, '../test/__fixtures__/github');
const fixture = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));

const png = Buffer.from('89504e470d0a1a0a', 'hex');

/** A client whose callTool invocations are counted. */
interface CountedClient {
  client: Client;
  calls: () => number;
}

describe('call budgets for the developer loop', () => {
  const fake = useGithubFake('checks');
  let ctx: TestContext;
  let member: TestUser;
  let base: string;
  let closeServer: () => Promise<void>;
  let spaceId: string;
  let spaceSlug: string;
  const clients: Client[] = [];
  let nextNumber = 2_000_000;

  /**
   * Connect as a user through a token named TOKEN_NAME, counting what the test asks of callTool.
   * @param user - Who the token belongs to
   */
  async function counted(user: TestUser): Promise<CountedClient> {
    const client = await connectMcp(base, await tokenHeaderFor(user, undefined, TOKEN_NAME));
    clients.push(client);
    let count = 0;
    const original = client.callTool.bind(client);
    client.callTool = ((...args: Parameters<Client['callTool']>) => {
      count++;
      return original(...args);
    }) as Client['callTool'];
    return { client, calls: () => count };
  }

  async function createIssue(title: string) {
    const number = nextNumber--;
    const issue = await prisma.issue.create({
      data: { projectId: ctx.projectId, number, title, body: '', creatorId: ctx.owner.id },
    });
    return { id: issue.id, number, key: `${ctx.projectPrefix}-${number}` };
  }

  const pageKey = (slug: string) => `${ctx.orgSlug}/${ctx.teamSlug}/${spaceSlug}/${slug}`;

  beforeAll(async () => {
    ctx = await createTestContext(`budget${Date.now()}`);
    member = await addMemberToContext(ctx);
    spaceSlug = 'budget-space';
    const space = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Budget', slug: spaceSlug },
    });
    spaceId = space.id;
    await seedGithubApp({ fake });
    fake.addInstallation(INSTALLATION_ID, ['acme-labs/widget']);
    await prisma.githubRepoLink.create({
      data: {
        projectId: ctx.projectId,
        repoId: BigInt(GITHUB_REPO_ID),
        installationId: BigInt(INSTALLATION_ID),
        owner: 'acme-labs',
        name: 'widget',
        fullName: 'acme-labs/widget',
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/acme-labs/widget',
        linkedById: ctx.owner.id,
      },
    });
    ({ base, close: closeServer } = await serveApp());
  });

  /**
   * Delivers a webhook and waits until it is decided
   * @param event
   * @param payload
   */
  async function deliver(event: string, payload: object) {
    const deliveryId = randomUUID();
    expect((await postWebhook(event, payload, { deliveryId })).status).toBe(202);
    await vi.waitFor(async () => {
      const row = await prisma.githubDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
      expect(row.status).toBe('PROCESSED');
    });
  }

  afterAll(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await closeServer();
    await cleanupTestContext(ctx);
    await prisma.user.deleteMany({ where: { id: member.id } });
    await rm(storagePath, { recursive: true, force: true });
  });

  it('picks up a ticket in 1 call, with its comments, links, attachments and related pages', async () => {
    const issue = await createIssue('Pick me up');
    const other = await createIssue('Linked issue');
    await prisma.comment.create({
      data: { issueId: issue.id, authorId: ctx.owner.id, body: 'First thoughts' },
    });
    await prisma.issueLink.create({ data: { fromId: issue.id, toId: other.id, type: 'BLOCKS' } });
    await prisma.attachment.create({
      data: {
        filename: 'stored.txt',
        originalName: 'notes.txt',
        mimeType: 'text/plain',
        size: 5,
        storageKey: 'budget/stored.txt',
        uploaderId: ctx.owner.id,
        issueId: issue.id,
      },
    });
    const linked = await createPage(spaceId, ctx.owner.id, {
      title: 'Linked page',
      slug: 'linked-page',
      body: 'No key in here',
    });
    await prisma.wikiPageIssueLink.create({
      data: { pageId: linked.id, issueId: issue.id, linkType: 'EMBED', createdById: ctx.owner.id },
    });
    // Written through the service, so it holds a mention row
    await createPage(spaceId, ctx.owner.id, {
      title: 'Mentioning page',
      slug: 'mentioning-page',
      body: `Design notes for ${issue.key}.`,
    });
    const restricted = await createPage(spaceId, ctx.owner.id, {
      title: 'Restricted page',
      slug: 'restricted-page',
      body: `Private notes for ${issue.key}.`,
    });
    await prisma.pageRestriction.create({
      data: { pageId: restricted.id, type: 'VIEW', userId: ctx.owner.id },
    });

    const { client, calls } = await counted(member);
    const answer = await callTool(client, 'read', {
      keys: [issue.key],
      include: ['comments', 'links', 'webLinks', 'attachments', 'pages'],
    });

    expect(answer.isError).toBe(false);
    const data = answer.data.items[0].data;
    expect(data.title).toBe('Pick me up');
    expect(data.comments.items.map((c: { body: string }) => c.body)).toEqual(['First thoughts']);
    expect(data.links.items).toEqual([
      expect.objectContaining({ type: 'BLOCKS', direction: 'outward' }),
    ]);
    expect(data.attachments.items.map((a: { name: string }) => a.name)).toEqual(['notes.txt']);
    const slugs = data.pages.items.map((p: { slug: string }) => p.slug).sort();
    expect(slugs).toEqual(['linked-page', 'mentioning-page']);
    expect(calls()).toBe(1);
  });

  it('picks up a ticket with its PRs, reviews and failed CI in 1 call', async () => {
    const issue = await createIssue('Fix the widget');
    const repository = {
      id: GITHUB_REPO_ID,
      name: 'widget',
      full_name: 'acme-labs/widget',
      html_url: 'https://github.com/acme-labs/widget',
      owner: { login: 'acme-labs', id: 4001 },
    };
    const sender = { id: 7001, login: 'voorbeeld-dev' };
    const pullRequest = {
      ...fixture('events/pull_request.opened.json').pull_request,
      number: 61,
      title: 'Budget work',
      body: '',
      head: { ref: `${ctx.projectPrefix.toLowerCase()}-${issue.number}-budget`, sha: HEAD_SHA },
    };
    await deliver('pull_request', {
      action: 'opened',
      number: 61,
      pull_request: pullRequest,
      repository,
      sender,
      installation: { id: INSTALLATION_ID },
    });
    await deliver('pull_request_review', {
      action: 'submitted',
      review: fixture('events/pull_request_review.submitted.json').review,
      pull_request: pullRequest,
      repository,
      sender: { id: 7002, login: 'review-bot' },
      installation: { id: INSTALLATION_ID },
    });
    fake.setJobLog(4401, readFileSync(path.join(FIXTURES, 'checks/job-log.txt'), 'utf8'));
    await deliver('check_run', {
      action: 'completed',
      check_run: {
        id: 4401,
        name: 'test',
        head_sha: HEAD_SHA,
        status: 'completed',
        conclusion: 'failure',
        started_at: '2026-11-06T10:00:05Z',
        completed_at: '2026-11-06T10:03:05Z',
        html_url: 'https://github.com/acme-labs/widget/runs/4401',
        output: { title: null, summary: null, text: null },
        app: { id: 15368, slug: 'github-actions', name: 'GitHub Actions' },
      },
      repository,
      sender,
      installation: { id: INSTALLATION_ID },
    });

    const { client, calls } = await counted(member);
    const seen = fake.requests.length;
    const answer = await callTool(client, 'read', {
      keys: [issue.key],
      include: ['development', 'checks'],
    });
    const used = calls();
    const asked = fake.requests.length - seen;

    expect(answer.isError).toBe(false);
    const data = answer.data.items[0].data;
    const [pr] = data.development.pullRequests.items;
    expect(pr).toMatchObject({ number: 61, state: 'open', headSha: HEAD_SHA });
    expect(pr.reviews).toEqual([
      expect.objectContaining({ state: 'approved', body: 'Looks good' }),
    ]);
    const [check] = data.checks.items;
    expect(check).toMatchObject({
      pullRequest: 61,
      name: 'test',
      conclusion: 'failure',
      failedStep: 'Run tests',
    });
    expect(check.logTail.split('\n').length).toBeLessThanOrEqual(100);
    expect(Buffer.byteLength(check.logTail)).toBeLessThanOrEqual(16384);
    expect(check.logTail).toContain('##[error]Process completed with exit code 1.');
    expect(used).toBe(1);
    // A read answers from what the webhooks stored
    expect(asked).toBe(0);
  });

  it('finishes a ticket in 1 call: status, comment, time and the PR link', async () => {
    const issue = await createIssue('Finish me');
    const { client, calls } = await counted(ctx.owner);
    const pr = 'https://example.com/acme/axiom/pull/7';

    const answer = await callTool(client, 'act', {
      batch: [
        { action: 'issue.update', key: issue.key, input: { status: 'Done' } },
        { action: 'comment.add', key: issue.key, input: { body: 'Shipped' } },
        { action: 'worklog.add', key: issue.key, input: { minutes: 30, description: 'Build' } },
        { action: 'issueWebLink.add', key: issue.key, input: { url: pr, title: 'Pull request' } },
      ],
    });
    const used = calls();

    expect(answer.isError).toBe(false);
    expect(answer.data.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(used).toBe(1);

    const stored = await prisma.issue.findUniqueOrThrow({
      where: { id: issue.id },
      include: { column: true, comments: true, timeEntries: true, webLinks: true },
    });
    expect(stored.column?.name).toBe('Done');
    expect(stored.comments.map((c) => c.body)).toEqual(['Shipped']);
    expect(stored.timeEntries.map((t) => t.minutes)).toEqual([30]);
    expect(stored.webLinks.map((l) => l.url)).toEqual([pr]);

    const activity = await prisma.activity.findMany({
      where: { resourceId: issue.id },
      select: { via: true },
    });
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((a) => a.via === TOKEN_NAME)).toBe(true);
  });

  it('creates a wiki page with a local image in 2 calls', async () => {
    const { client, calls } = await counted(ctx.owner);
    const staged = await callTool(client, 'upload', {
      filename: 'shot.png',
      mimeType: 'image/png',
      size: png.length,
    });
    expect(staged.isError).toBe(false);

    // The agent's own curl, so it is not a tool call
    const contentType = /-H '([^']+)'/.exec(staged.data.curl as string)?.[1];
    expect(contentType).toBe('Content-Type: image/png');
    const put = await fetch(staged.data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: png,
    });
    expect(put.status).toBe(201);

    const slug = `with-image-${Date.now()}`;
    const created = await callTool(client, 'act', {
      action: 'page.create',
      key: `${ctx.orgSlug}/${ctx.teamSlug}/${spaceSlug}`,
      input: {
        title: 'With image',
        slug,
        body: `Look:\n\n![shot](${staged.data.attachmentUrl})\n`,
      },
    });
    const used = calls();

    expect(created.isError).toBe(false);
    expect(used).toBe(2);

    const page = await prisma.page.findFirstOrThrow({
      where: { spaceId, slug },
      include: { attachments: true },
    });
    expect(page.attachments.map((a) => a.originalName)).toEqual(['shot.png']);
    expect(page.attachments[0].stagedAt).toBeNull();

    const download = await fetch(`${base}${staged.data.attachmentUrl}`, {
      headers: { Authorization: await tokenHeaderFor(ctx.owner) },
    });
    expect(download.status).toBe(200);
    expect(Buffer.from(await download.arrayBuffer()).equals(png)).toBe(true);

    const activity = await prisma.activity.findMany({
      where: { resourceId: page.id },
      select: { via: true },
    });
    expect(activity.length).toBeGreaterThan(0);
    expect(activity.every((a) => a.via === TOKEN_NAME)).toBe(true);
  });

  it('creates an issue by project key in 1 call', async () => {
    const { client, calls } = await counted(ctx.owner);
    const created = await callTool(client, 'act', {
      action: 'issue.create',
      key: ctx.projectPrefix,
      input: { title: 'Made by project key' },
    });
    const used = calls();

    expect(created.isError).toBe(false);
    expect(used).toBe(1);
    const stored = await prisma.issue.findFirstOrThrow({
      where: { projectId: ctx.projectId, title: 'Made by project key' },
    });
    expect(stored.creatorId).toBe(ctx.owner.id);
    const activity = await prisma.activity.findMany({
      where: { resourceId: stored.id },
      select: { via: true },
    });
    expect(activity.every((a) => a.via === TOKEN_NAME)).toBe(true);
  });

  it('runs the curl line the upload tool returns', async (testCtx) => {
    const available = await promisify(execFile)('sh', ['-c', 'command -v curl']).then(
      () => true,
      () => false,
    );
    if (!available) testCtx.skip();
    const { client } = await counted(ctx.owner);
    const staged = await callTool(client, 'upload', {
      filename: 'curl.png',
      mimeType: 'image/png',
      size: png.length,
    });
    const local = path.join(tmpdir(), `budget-curl-${randomBytes(6).toString('hex')}.png`);
    await writeFile(local, png);
    try {
      const line = (staged.data.curl as string).replace('@<path>', `@${local}`);
      await promisify(execFile)('sh', ['-c', `${line} --fail --silent --show-error`]);
    } finally {
      await rm(local, { force: true });
    }
    const row = await prisma.attachment.findFirstOrThrow({
      where: { uploaderId: ctx.owner.id, originalName: 'curl.png' },
    });
    expect(row.size).toBe(png.length);
  });

  it('finds an item by key or by exact title in 1 call each', async () => {
    const issue = await createIssue('Find by key');
    const title = `Exact Title ${Date.now()}`;
    const slug = `exact-${Date.now()}`;
    await createPage(spaceId, ctx.owner.id, { title, slug, body: 'Nothing special' });
    await createPage(spaceId, ctx.owner.id, {
      title: `Other ${Date.now()}`,
      slug: `other-${Date.now()}`,
      body: `Text that names ${title} in passing`,
    });

    const byKey = await counted(member);
    const read = await callTool(byKey.client, 'read', { keys: [issue.key] });
    expect(read.data.items[0].data.title).toBe('Find by key');
    expect(byKey.calls()).toBe(1);

    const byTitle = await counted(member);
    const search = await callTool(byTitle.client, 'search', { query: title, type: 'wiki' });
    expect(search.isError).toBe(false);
    expect(search.data[0].items[0].key).toBe(pageKey(slug));
    expect(byTitle.calls()).toBe(1);
  });

  it('shows the status of all active sprints and which issues are blocked in 1 call', async () => {
    const sprint = await prisma.sprint.create({
      data: {
        projectId: ctx.projectId,
        name: 'Budget sprint',
        status: 'ACTIVE',
        startDate: new Date(),
        endDate: new Date(Date.now() + 5 * 86_400_000),
        committedAt: new Date(),
      },
    });
    const waiting = await createIssue('Waiting on a fix');
    const blocker = await createIssue('The fix');
    await prisma.issue.update({ where: { id: waiting.id }, data: { sprintId: sprint.id } });
    await prisma.issueLink.create({
      data: { fromId: waiting.id, toId: blocker.id, type: 'IS_BLOCKED_BY' },
    });

    const agent = await counted(member);
    const overview = await callTool(agent.client, 'act', { action: 'sprint.overview', input: {} });
    expect(overview.isError).toBe(false);
    const entry = overview.data.sprints.find((s: { id: string }) => s.id === sprint.id);
    expect(entry.issues.total).toBe(1);
    expect(entry.blocked[0]).toMatchObject({
      key: waiting.key,
      blockedBy: [{ key: blocker.key, title: 'The fix' }],
    });
    expect(agent.calls()).toBe(1);
  });
});
