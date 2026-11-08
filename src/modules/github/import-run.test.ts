import crypto from 'node:crypto';

import type { GithubRepoLink } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import type { RealtimeEvent } from '../../realtime/events';
import { setPublishHook } from '../../realtime/publish-hook';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { useGithubFake, type RecordedRequest } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';

import { IMPORT_PACE, configureImport, runDueImports, runImportTick } from './import-run.service';
import { importGithubIssue, postLinkComment } from './issue-import.service';
import { reconcileRepo } from './reconcile.service';
import './github-resolvers';

// One issue's creation fails on demand, before anything of it is stored
const failing = vi.hoisted(() => ({
  titles: new Set<string>(),
  calls: new Map<string, number>(),
  /** Runs after an issue was made */
  after: null as ((title: string) => Promise<void>) | null,
}));
vi.mock('../issues/issues.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../issues/issues.service')>();
  return {
    ...actual,
    createIssue: async (...args: Parameters<typeof actual.createIssue>) => {
      const title = args[2].title;
      failing.calls.set(title, (failing.calls.get(title) ?? 0) + 1);
      if (failing.titles.has(title)) throw new Error('The database went away');
      const issue = await actual.createIssue(...args);
      await failing.after?.(title);
      return issue;
    },
  };
});

const REPO_ID = 880_730;
const INSTALLATION_ID = 4731;
const APP_ID = 1203;
const FULL_NAME = 'acme-labs/widget';
const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const LINK_PREFIX = 'Tracked in Axiom as [';
const SECONDARY_LIMIT = 'You have exceeded a secondary rate limit. Please wait a few minutes.';
const HOUR_MS = 3_600_000;
const refused = (message = 'Validation Failed') => ({ status: 422, body: { message } });
const secondaryLimit = (seconds: number) => ({
  status: 403,
  body: { message: SECONDARY_LIMIT },
  headers: { 'retry-after': String(seconds) },
});

type Item = Record<string, unknown>;
type Lists = { issues: Item[]; issueComments: Record<string, Item[]> };

const fake = useGithubFake('import');
let ctx: TestContext;
let member: TestUser;
let link: GithubRepoLink;
let lists: Lists;
const events: Array<{ room: string; event: RealtimeEvent }> = [];

const createdAt = (n: number) => new Date(Date.UTC(2026, 8, 1) + n * 60_000).toISOString();
const ghIssue = (n: number, over: Item = {}): Item => ({
  id: 3_300_000 + n,
  number: n,
  title: `Widget report ${n}`,
  body: `What goes wrong in report ${n}`,
  state: 'open',
  user: { login: 'voorbeeld-dev', id: 7001, type: 'User' },
  labels: [],
  created_at: createdAt(n),
  updated_at: createdAt(n),
  ...over,
});

/**
 * Open issues 1..count, oldest first, with two pull requests and a closed issue among them, as
 * GitHub's issues list has them.
 * @param count How many open issues
 */
function repository(count: number): Lists {
  const issues: Item[] = [];
  for (let n = 1; n <= count; n++) {
    issues.push(ghIssue(n));
    if (n === 10) issues.push(ghIssue(900, { pull_request: { url: 'x' }, title: 'A pull' }));
    if (n === 20) issues.push(ghIssue(901, { state: 'closed', title: 'Closed long ago' }));
    if (n === 50) issues.push(ghIssue(902, { pull_request: { url: 'y' }, title: 'Another pull' }));
  }
  return { issues, issueComments: {} };
}

// A session's JWT, or an API token (tk_), as an agent sends it
const as = (token: string) => ({
  ...CSRF,
  Authorization: token.startsWith('tk_') ? `Token ${token}` : `Bearer ${token}`,
});
const url = () => `/api/projects/${ctx.projectId}/github/import`;
const enable = (token = ctx.owner.token, enabled = true) =>
  request(app).put(url()).set(as(token)).send({ enabled });

const linkComments = (n: number) =>
  (lists.issueComments[String(n)] ?? []).filter((c) => String(c.body).startsWith(LINK_PREFIX));
const commentPosts = () =>
  fake.requests.filter(
    (r: RecordedRequest) => r.method === 'POST' && /\/issues\/\d+\/comments$/.test(r.path),
  );
const latestRun = () =>
  prisma.githubImportRun.findFirstOrThrow({
    where: { repoLinkId: link.id },
    orderBy: { createdAt: 'desc' },
  });
const importedIssues = () => prisma.issue.count({ where: { projectId: ctx.projectId } });

// A minute passes for the link comment pace: the claims made so far are a minute older
const nextMinute = () => prisma.$executeRaw`
  UPDATE github_issue_imports
  SET "linkCommentClaimedAt" = "linkCommentClaimedAt" - interval '61 seconds'
  WHERE "repoLinkId" = ${link.id} AND "linkCommentClaimedAt" IS NOT NULL`;

/**
 * Ticks a run, a minute apart, until it is in a state, and gives the link comments each tick
 * posted.
 * @param runId The run
 * @param until The state to stop at
 * @param max The most ticks
 */
async function tickUntil(runId: string, until: string, max = 30): Promise<number[]> {
  const perTick: number[] = [];
  for (let i = 0; i < max; i++) {
    const before = commentPosts().length;
    await runImportTick(runId);
    perTick.push(commentPosts().length - before);
    const run = await prisma.githubImportRun.findUniqueOrThrow({ where: { id: runId } });
    if (run.status === until) return perTick;
    await nextMinute();
  }
  throw new Error(`The run did not reach ${until} in ${max} ticks`);
}

/**
 * Every GitHub issue of 1..count has exactly one link comment, and its Axiom issue exists once.
 * @param count How many
 */
async function expectEachImportedOnce(count: number) {
  const rows = await prisma.githubIssueImport.findMany({ where: { repoLinkId: link.id } });
  expect(rows.map((row) => row.githubIssueNumber).sort((a, b) => a - b)).toEqual(
    Array.from({ length: count }, (_, i) => i + 1),
  );
  expect(await importedIssues()).toBe(count);
  for (let n = 1; n <= count; n++) expect(linkComments(n), `issue #${n}`).toHaveLength(1);
  expect(rows.every((row) => row.linkCommentId !== null)).toBe(true);
}

async function apiToken(userId: string, scopes: string[]): Promise<string> {
  const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({
    data: {
      userId,
      name: 'import-agent',
      scopes,
      prefix: raw.slice(0, 11),
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
    },
  });
  return raw;
}

beforeAll(async () => {
  ctx = await createTestContext('gimr');
  member = await addMemberToContext(ctx);
  setPublishHook((room, event) => void events.push({ room, event }));
});

beforeEach(async () => {
  await seedGithubApp({ appId: APP_ID, fake });
  fake.addInstallation(INSTALLATION_ID, [FULL_NAME]);
  fake.setRepoId(FULL_NAME, REPO_ID);
  lists = repository(130);
  fake.setRepoLists(FULL_NAME, lists);
  failing.titles.clear();
  failing.calls.clear();
  failing.after = null;
  events.length = 0;
  await prisma.issue.deleteMany({ where: { projectId: ctx.projectId } });
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  await prisma.githubInstallation.deleteMany();
  await prisma.githubInstallation.create({
    data: { id: BigInt(INSTALLATION_ID), accountLogin: 'acme-labs', accountType: 'Organization' },
  });
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
      createdAt: new Date('2026-11-01T00:00:00Z'),
    },
  });
});

afterEach(async () => {
  await prisma.agentApproval.deleteMany({ where: { userId: ctx.owner.id } });
  await prisma.apiToken.deleteMany({ where: { userId: { in: [ctx.owner.id, member.id] } } });
});

afterAll(async () => {
  setPublishHook(null);
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
  await prisma.githubInstallation.deleteMany();
  await prisma.githubApp.deleteMany();
  await cleanupTestContext(ctx);
});

// Each test imports dozens of issues through the real services, a tick at a time
describe('the backfill of open GitHub Issues', { timeout: 120_000 }, () => {
  it('imports all 130 open issues over two pages at its pace, one link comment each, then is done', async () => {
    const res = await enable();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, run: { status: 'QUEUED', done: 0 } });
    expect(
      (await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } })).importIssues,
    ).toBe(true);
    const run = await latestRun();

    await runImportTick(run.id);
    const first = await latestRun();
    expect(first).toMatchObject({
      status: 'RUNNING',
      total: 130,
      done: 25,
      failed: 0,
      nextPage: 1,
    });
    expect(first.leaseUntil).toBeNull();
    expect(first.startedAt).not.toBeNull();
    expect(await importedIssues()).toBe(IMPORT_PACE.issuesPerTick);
    expect(commentPosts()).toHaveLength(IMPORT_PACE.linkCommentsPerMinute);
    // The progress went to the project room
    expect(events).toContainEqual({
      room: `project:${ctx.projectId}`,
      event: { type: 'github:import-progress', projectId: ctx.projectId, runId: run.id },
    });

    const perTick = await tickUntil(run.id, 'DONE');
    expect(Math.max(...perTick)).toBeLessThanOrEqual(IMPORT_PACE.linkCommentsPerMinute);
    const done = await latestRun();
    expect(done).toMatchObject({ status: 'DONE', total: 130, done: 130, failed: 0 });
    expect(done.finishedAt).not.toBeNull();
    await expectEachImportedOnce(130);
    expect(commentPosts()).toHaveLength(130);

    // GitHub's count and both pages of open issues, oldest first, by repository id
    const search = fake.requests.find((r) => r.path === '/search/issues');
    expect(search?.query.q).toBe(`repo:${FULL_NAME} type:issue state:open`);
    const pages = fake.requests.filter((r) => r.path === `/repositories/${REPO_ID}/issues`);
    expect(new Set(pages.map((r) => r.query.page))).toEqual(new Set(['1', '2']));
    expect(pages[0].query).toMatchObject({
      state: 'open',
      per_page: '100',
      sort: 'created',
      direction: 'asc',
    });
    // Pull requests and closed issues are not imported
    const titles = await prisma.issue.findMany({
      where: {
        projectId: ctx.projectId,
        title: { in: ['A pull', 'Another pull', 'Closed long ago'] },
      },
    });
    expect(titles).toEqual([]);
    // Nothing more once it is done
    fake.requests.length = 0;
    expect(await runDueImports()).toBe(0);
    expect(fake.requests).toEqual([]);
  });

  it("pauses at GitHub's secondary limit on the 21st link comment and posts the rest, each once, after resumeAt", async () => {
    lists = repository(40);
    fake.setRepoLists(FULL_NAME, lists);
    let posts = 0;
    fake.on('POST /repos/:owner/:repo/issues/:number/comments', () => {
      posts++;
      return posts === 21
        ? {
            status: 403,
            body: { message: SECONDARY_LIMIT },
            headers: { 'retry-after': '120' },
          }
        : null;
    });
    await enable();
    const run = await latestRun();

    await runImportTick(run.id);
    expect(commentPosts()).toHaveLength(20);
    await nextMinute();
    const pausedAt = Date.now();
    await runImportTick(run.id);
    const paused = await latestRun();
    expect(paused.status).toBe('PAUSED');
    expect(paused.leaseUntil).toBeNull();
    expect(paused.resumeAt!.getTime()).toBeGreaterThanOrEqual(pausedAt + 115_000);
    expect(paused.resumeAt!.getTime()).toBeLessThanOrEqual(Date.now() + 121_000);
    expect(commentPosts()).toHaveLength(21);

    // Before resumeAt nothing happens
    await nextMinute();
    const before = fake.requests.length;
    await runImportTick(run.id);
    expect(await runDueImports()).toBe(0);
    expect(fake.requests).toHaveLength(before);
    expect((await latestRun()).status).toBe('PAUSED');

    await prisma.githubImportRun.update({
      where: { id: run.id },
      data: { resumeAt: new Date(Date.now() - 1000) },
    });
    await tickUntil(run.id, 'DONE');
    expect(await latestRun()).toMatchObject({ status: 'DONE', done: 40, failed: 0 });
    await expectEachImportedOnce(40);
    // 40 posted, plus the one GitHub refused
    expect(commentPosts()).toHaveLength(41);
  });

  it('resumes a run whose worker died mid-page: no duplicate issues, and the missing link comment is posted', async () => {
    lists = repository(40);
    fake.setRepoLists(FULL_NAME, lists);
    await prisma.githubRepoLink.update({ where: { id: link.id }, data: { importIssues: true } });
    const run = await prisma.githubImportRun.create({
      data: {
        repoLinkId: link.id,
        requestedById: ctx.owner.id,
        status: 'RUNNING',
        total: 40,
        startedAt: new Date(Date.now() - 5 * 60_000),
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });
    // What the tick that died did: issues 1-5 imported, their link comments not yet posted, and
    // the one of #5 posted on GitHub but its id never stored
    const listed = lists.issues.filter((item) => Number(item.number) <= 5);
    for (const item of listed) {
      await importGithubIssue({ ...link, importIssues: true }, item as never, {
        withComments: true,
        linkComment: false,
      });
    }
    const fifth = await prisma.githubIssueImport.findFirstOrThrow({
      where: { repoLinkId: link.id, githubIssueNumber: 5 },
    });
    await postLinkComment(fifth.id);
    await prisma.githubIssueImport.update({
      where: { id: fifth.id },
      data: { linkCommentId: null, linkCommentClaimedAt: new Date(Date.now() - 11 * 60_000) },
    });
    expect(linkComments(5)).toHaveLength(1);

    // Its lease is live: no other tick takes it
    fake.requests.length = 0;
    await runImportTick(run.id);
    expect(fake.requests).toEqual([]);
    expect(await importedIssues()).toBe(5);

    await prisma.githubImportRun.update({
      where: { id: run.id },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    expect(await runDueImports()).toBe(1);
    const resumed = await latestRun();
    // The five made before count, once: 25 new ones were added to them
    expect(resumed).toMatchObject({ status: 'RUNNING', done: 30, nextPage: 1 });
    expect(await importedIssues()).toBe(30);

    await tickUntil(run.id, 'DONE');
    expect(await latestRun()).toMatchObject({ status: 'DONE', total: 40, done: 40 });
    await expectEachImportedOnce(40);
    // #5's comment was found on GitHub rather than posted again
    expect(commentPosts().some((r) => r.path.endsWith('/issues/5/comments'))).toBe(false);
  });

  it('reads the pages once more for issues that moved onto a page already read', async () => {
    await enable();
    const run = await latestRun();
    for (let i = 0; i < 10 && (await latestRun()).nextPage === 1; i++) await runImportTick(run.id);
    expect(await latestRun()).toMatchObject({ nextPage: 2, done: 100 });
    // Three issues of the first page close: #101-#103 move onto it, behind the run
    for (const item of lists.issues) if (Number(item.number) <= 3) item.state = 'closed';

    await tickUntil(run.id, 'DONE');
    const numbers = (
      await prisma.githubIssueImport.findMany({ where: { repoLinkId: link.id } })
    ).map((row) => row.githubIssueNumber);
    expect(numbers).toEqual(expect.arrayContaining([101, 102, 103, 130]));
    expect(numbers).toHaveLength(130);
    // The open issues it found in Axiom: the three that closed are not among them
    expect(await latestRun()).toMatchObject({ status: 'DONE', total: 130, done: 127 });
  });

  it('counts an issue that fails, tries it no more, and goes on', async () => {
    lists = repository(40);
    fake.setRepoLists(FULL_NAME, lists);
    failing.titles.add('Widget report 7');
    await enable();
    const run = await latestRun();
    await tickUntil(run.id, 'DONE');
    expect(await latestRun()).toMatchObject({
      status: 'DONE',
      done: 39,
      failed: 1,
      failedNumbers: [7],
    });
    expect(failing.calls.get('Widget report 7')).toBe(1);
    expect(await importedIssues()).toBe(39);
    expect(linkComments(7)).toHaveLength(0);
  });

  it('cancels the run when import is switched off, and a new one is queued when it is switched on again', async () => {
    await enable();
    const again = await enable();
    expect(again.status).toBe(200);
    expect(await prisma.githubImportRun.count({ where: { repoLinkId: link.id } })).toBe(1);
    const run = await latestRun();
    await runImportTick(run.id);

    const off = await enable(ctx.owner.token, false);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({ enabled: false, run: { status: 'CANCELLED', done: 25 } });
    const cancelled = await latestRun();
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.finishedAt).not.toBeNull();
    expect(
      (await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } })).importIssues,
    ).toBe(false);

    fake.requests.length = 0;
    await nextMinute();
    await runImportTick(run.id);
    expect(await runDueImports()).toBe(0);
    expect(fake.requests).toEqual([]);
    expect(await importedIssues()).toBe(25);

    await enable();
    const next = await latestRun();
    expect(next.id).not.toBe(run.id);
    expect(next.status).toBe('QUEUED');
  });

  it('stops a tick that is under way when the run is cancelled', async () => {
    await enable();
    const run = await latestRun();
    // Switched off while the third issue is being imported
    failing.after = async (title) => {
      if (title === 'Widget report 3') await enable(ctx.owner.token, false);
    };
    await runImportTick(run.id);
    const cancelled = await latestRun();
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled).toMatchObject({ done: 3, leaseUntil: null });
    expect(await importedIssues()).toBe(3);
    expect(commentPosts()).toEqual([]);
  });
});

describe('the reconcile beside a backfill', () => {
  it('leaves the link comments to a run under way, and posts what is owed once it is over', async () => {
    lists = repository(3);
    // What else the reconcile reads, empty
    fake.setRepoLists(FULL_NAME, { ...lists, pulls: [], branches: [], checkRuns: {} });
    await enable();
    const run = await latestRun();
    const linked = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } });
    for (const item of lists.issues.filter((i) => !i.pull_request && i.state === 'open')) {
      await importGithubIssue(linked, item as never, { withComments: false, linkComment: false });
    }
    await prisma.githubImportRun.update({
      where: { id: run.id },
      data: { status: 'PAUSED', resumeAt: new Date(Date.now() + 60_000) },
    });

    await reconcileRepo(link.id);
    expect(commentPosts()).toEqual([]);

    await prisma.githubImportRun.update({ where: { id: run.id }, data: { status: 'DONE' } });
    await reconcileRepo(link.id);
    expect(commentPosts()).toHaveLength(3);
    for (const n of [1, 2, 3]) expect(linkComments(n)).toHaveLength(1);
  });
});

describe('githubImport.configure and githubImport.status', () => {
  it('refuses a team MEMBER, who may still read the status', async () => {
    const res = await enable(member.token);
    expect(res.status).toBe(403);
    expect(await prisma.githubImportRun.count({ where: { repoLinkId: link.id } })).toBe(0);
    const status = await request(app).get(url()).set(as(member.token));
    expect(status.status).toBe(200);
    expect(status.body).toEqual({
      enabled: false,
      run: null,
      liveCap: { paused: false, resumesAt: null },
    });
  });

  it('makes a token that switches it on wait for approval, with a preview from stored values', async () => {
    const token = await apiToken(ctx.owner.id, ['github:write']);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: ctx.projectId } });
    const res = await enable(token);
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.preview).toBe(
      `Import the open GitHub Issues of ${FULL_NAME} into project ${project.prefix} "${project.name}" and post one link comment on each, as the GitHub App`,
    );
    expect(await prisma.githubImportRun.count({ where: { repoLinkId: link.id } })).toBe(0);
    expect(
      (await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } })).importIssues,
    ).toBe(false);

    // A count a previous run stored is named
    await prisma.githubImportRun.create({
      data: { repoLinkId: link.id, requestedById: ctx.owner.id, status: 'DONE', total: 130 },
    });
    const counted = await enable(token);
    expect(counted.status).toBe(202);
    expect(counted.body.preview).toContain('Import the 130 open GitHub Issues of');

    // Switching it off destroys nothing: a token does it at once
    const off = await enable(token, false);
    expect(off.status).toBe(200);
    expect(off.body.enabled).toBe(false);
  });

  it('shows the progress of the run', async () => {
    await enable();
    const run = await latestRun();
    await runImportTick(run.id);
    const res = await request(app).get(url()).set(as(member.token));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: true,
      run: { status: 'RUNNING', total: 130, done: 25, failed: 0, finishedAt: null, error: null },
      liveCap: { paused: false, resumesAt: null },
    });
    expect(res.body.run.startedAt).toEqual(expect.any(String));
  });

  it('answers 404 for a project without a linked repository', async () => {
    await prisma.githubRepoLink.deleteMany({ where: { id: link.id } });
    const res = await enable();
    expect(res.status).toBe(404);
  });
});

describe('link comments that GitHub keeps refusing', { timeout: 120_000 }, () => {
  it('moves a refused one to the back of the queue and gives it up after 5 tries', async () => {
    lists = repository(25);
    fake.setRepoLists(FULL_NAME, lists);
    // The first 20 issues refuse every link comment; the last five take theirs
    fake.on('POST /repos/:owner/:repo/issues/:number/comments', (_req, params) =>
      Number(params.number) <= 20 ? refused() : null,
    );
    await enable();
    const run = await latestRun();
    await runImportTick(run.id);
    // All 20 tried failed, but they were not all that is owed: the run goes on
    expect((await latestRun()).status).toBe('RUNNING');
    await nextMinute();
    await runImportTick(run.id);
    for (const n of [21, 22, 23, 24, 25]) expect(linkComments(n), `#${n}`).toHaveLength(1);

    // The run is done once each refused one was given up after its fifth refusal
    await tickUntil(run.id, 'DONE');
    const rows = await prisma.githubIssueImport.findMany({
      where: { repoLinkId: link.id, githubIssueNumber: { lte: 20 } },
    });
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      expect(row).toMatchObject({ linkCommentId: null, linkCommentFailures: 5 });
      expect(row.linkCommentGivenUpAt).not.toBeNull();
    }
    const tries = commentPosts().filter((r) => /\/issues\/(\d|1\d|20)\/comments$/.test(r.path));
    expect(tries).toHaveLength(100);
  });

  it('is done only once nothing is owed: refused ones are tried until they are given up', async () => {
    lists = repository(3);
    fake.setRepoLists(FULL_NAME, lists);
    fake.on('POST /repos/:owner/:repo/issues/:number/comments', refused());
    await enable();
    const run = await latestRun();
    await runImportTick(run.id);
    expect(await latestRun()).toMatchObject({ status: 'RUNNING', done: 3 });
    await tickUntil(run.id, 'DONE');
    const rows = await prisma.githubIssueImport.findMany({ where: { repoLinkId: link.id } });
    for (const row of rows) {
      expect(row.linkCommentFailures).toBe(5);
      expect(row.linkCommentGivenUpAt).not.toBeNull();
    }
    expect(commentPosts()).toHaveLength(15);
  });

  it('gives a link comment up after five refusals, never for five failures that may pass', async () => {
    lists = repository(2);
    fake.setRepoLists(FULL_NAME, lists);
    const linked = { ...link, importIssues: true };
    for (const item of lists.issues.filter((i) => Number(i.number) <= 2)) {
      await importGithubIssue(linked, item as never, { withComments: false, linkComment: false });
    }
    fake.on('POST /repos/:owner/:repo/issues/:number/comments', (_req, params) =>
      params.number === '1' ? { status: 502 } : refused(),
    );
    const rowOf = (n: number) =>
      prisma.githubIssueImport.findFirstOrThrow({
        where: { repoLinkId: link.id, githubIssueNumber: n },
      });
    for (let i = 0; i < 5; i++) {
      for (const n of [1, 2]) await expect(postLinkComment((await rowOf(n)).id)).rejects.toThrow();
    }
    const transient = await rowOf(1);
    expect(transient).toMatchObject({ linkCommentFailures: 0, linkCommentGivenUpAt: null });
    const refusedRow = await rowOf(2);
    expect(refusedRow.linkCommentFailures).toBe(5);
    expect(refusedRow.linkCommentGivenUpAt).not.toBeNull();
    // A 502 still sends the row to the back of the queue
    expect(transient.lastImportedAt.getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect(await postLinkComment(refusedRow.id)).toBe('skipped');
  });
});

describe('a run that keeps failing', { timeout: 120_000 }, () => {
  const due = (runId: string) =>
    prisma.githubImportRun.update({
      where: { id: runId },
      data: { resumeAt: new Date(Date.now() - 1000) },
    });

  it('pauses a minute with the error after a failure that may pass, and clears it on the next good tick', async () => {
    let calls = 0;
    fake.on('GET /repos/:owner/:repo/issues', () => (++calls === 1 ? { status: 502 } : null));
    await enable();
    const run = await latestRun();
    const at = Date.now();
    await runImportTick(run.id);
    const paused = await latestRun();
    expect(paused).toMatchObject({ status: 'PAUSED', errorTicks: 1 });
    expect(paused.error).toBe('GitHub answered with status 502.');
    expect(paused.resumeAt!.getTime()).toBeGreaterThanOrEqual(at + 59_000);
    expect(paused.resumeAt!.getTime()).toBeLessThanOrEqual(Date.now() + 61_000);

    await due(run.id);
    await runImportTick(run.id);
    expect(await latestRun()).toMatchObject({
      status: 'RUNNING',
      error: null,
      errorTicks: 0,
      done: 25,
    });
  });

  it('fails after 10 failing ticks in a row, and the reconcile then posts what it owes', async () => {
    lists = repository(3);
    fake.setRepoLists(FULL_NAME, { ...lists, pulls: [], branches: [], checkRuns: {} });
    await enable();
    const run = await latestRun();
    const linked = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } });
    await importGithubIssue(linked, lists.issues[0] as never, {
      withComments: false,
      linkComment: false,
    });
    fake.on('GET /repos/:owner/:repo/issues', { status: 502 });
    for (let i = 0; i < 9; i++) {
      await runImportTick(run.id);
      expect((await latestRun()).status).toBe('PAUSED');
      // Paused by an error: the reconcile does not wait on it
      if (i === 0) {
        await reconcileRepo(link.id);
        expect(linkComments(1)).toHaveLength(1);
      }
      await due(run.id);
    }
    await runImportTick(run.id);
    const failed = await latestRun();
    expect(failed).toMatchObject({
      status: 'FAILED',
      errorTicks: 10,
      error: 'GitHub answered with status 502.',
    });
    expect(failed.finishedAt).not.toBeNull();
  });

  it('fails when it has not moved on for a day', async () => {
    await enable();
    const run = await latestRun();
    await prisma.githubImportRun.update({
      where: { id: run.id },
      data: {
        status: 'PAUSED',
        startedAt: new Date(Date.now() - 30 * HOUR_MS),
        progressAt: new Date(Date.now() - 25 * HOUR_MS),
        resumeAt: new Date(Date.now() - 1000),
      },
    });
    fake.on('GET /repos/:owner/:repo/issues', secondaryLimit(60));
    await runImportTick(run.id);
    expect(await latestRun()).toMatchObject({ status: 'FAILED' });
  });

  it('fails at once when GitHub no longer shows the repository', async () => {
    fake.on('GET /repos/:owner/:repo/issues', { status: 404, body: { message: 'Not Found' } });
    await enable();
    const run = await latestRun();
    await runImportTick(run.id);
    const failed = await latestRun();
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toBe('GitHub has no such resource, or this connection cannot see it.');
    expect(failed.finishedAt).not.toBeNull();
  });

  it('does not pause for the count of open issues, and asks for it again', async () => {
    let searches = 0;
    fake.on('GET /search/issues', () => (++searches === 1 ? secondaryLimit(60) : null));
    await enable();
    const run = await latestRun();
    await runImportTick(run.id);
    expect(await latestRun()).toMatchObject({ status: 'RUNNING', total: null, done: 25 });
    await nextMinute();
    await runImportTick(run.id);
    expect(await latestRun()).toMatchObject({ status: 'RUNNING', total: 130, done: 50 });
  });
});

describe('one link comment per issue', { timeout: 120_000 }, () => {
  it('looks from the first failed claim when a later lookup fails too, so a long pause posts none twice', async () => {
    lists = repository(1);
    fake.setRepoLists(FULL_NAME, lists);
    const linked = { ...link, importIssues: true };
    await importGithubIssue(linked, lists.issues[0] as never, {
      withComments: false,
      linkComment: false,
    });
    const row = await prisma.githubIssueImport.findFirstOrThrow({ where: { repoLinkId: link.id } });
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // GitHub makes the comment but the answer is lost
      fake.on('POST /repos/:owner/:repo/issues/:number/comments', (req) => {
        (lists.issueComments['1'] ??= []).push({
          id: 6001,
          body: (req.body as { body: string }).body,
          user: { login: 'acme-axiom[bot]', id: 9_900_001, type: 'Bot' },
          performed_via_github_app: { id: APP_ID },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        return { status: 502 };
      });
      await expect(postLinkComment(row.id)).rejects.toThrow();
      fake.reset();
      fake.setRepoLists(FULL_NAME, lists);

      // 15 minutes on, the lookup before the retry hits the rate limit
      vi.setSystemTime(start + 15 * 60_000);
      fake.on('GET /repos/:owner/:repo/issues/:number/comments', secondaryLimit(3600));
      await expect(postLinkComment(row.id)).rejects.toThrow();
      fake.reset();
      fake.setRepoLists(FULL_NAME, lists);

      // An hour later it goes through
      vi.setSystemTime(start + 80 * 60_000);
      await postLinkComment(row.id);
    } finally {
      vi.useRealTimers();
    }
    expect(linkComments(1)).toHaveLength(1);
    expect(commentPosts()).toEqual([]);
    expect(
      await prisma.githubIssueImport.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ linkCommentId: '6001' });
  });

  it('leaves the link comments to a run paused at the rate limit: live imports post none meanwhile', async () => {
    lists = repository(2);
    fake.setRepoLists(FULL_NAME, lists);
    await enable();
    const run = await latestRun();
    await prisma.githubImportRun.update({
      where: { id: run.id },
      data: { status: 'PAUSED', resumeAt: new Date(Date.now() + 60_000) },
    });
    const linked = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } });
    await importGithubIssue(linked, lists.issues[0] as never, { withComments: false, live: true });
    expect(commentPosts()).toEqual([]);
    expect(
      await prisma.githubIssueImport.findFirstOrThrow({ where: { repoLinkId: link.id } }),
    ).toMatchObject({ linkCommentId: null, linkCommentClaimedAt: null });

    await prisma.githubImportRun.update({
      where: { id: run.id },
      data: { resumeAt: new Date(Date.now() - 1000) },
    });
    await tickUntil(run.id, 'DONE');
    for (const n of [1, 2]) expect(linkComments(n)).toHaveLength(1);
  });

  it('is done with a live claim still out, and the reconcile stores the comment that claim made', async () => {
    lists = repository(2);
    fake.setRepoLists(FULL_NAME, { ...lists, pulls: [], branches: [], checkRuns: {} });
    await enable();
    const run = await latestRun();
    const linked = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } });
    await importGithubIssue(linked, lists.issues[0] as never, {
      withComments: false,
      linkComment: false,
    });
    // A worker posted #1's comment and died before it stored the id: its claim is a minute old
    const row = await prisma.githubIssueImport.findFirstOrThrow({ where: { repoLinkId: link.id } });
    await postLinkComment(row.id);
    const comment = linkComments(1)[0];
    await prisma.githubIssueImport.update({
      where: { id: row.id },
      data: { linkCommentId: null, linkCommentClaimedAt: new Date(Date.now() - 60_000) },
    });
    fake.requests.length = 0;

    await tickUntil(run.id, 'DONE');
    expect(linkComments(1)).toHaveLength(1);
    expect(linkComments(2)).toHaveLength(1);

    // Ten minutes on, the claim is stale: the reconcile finds the comment and posts nothing
    await prisma.githubIssueImport.update({
      where: { id: row.id },
      data: { linkCommentClaimedAt: new Date(Date.now() - 11 * 60_000) },
    });
    const posts = commentPosts().length;
    await reconcileRepo(link.id);
    expect(commentPosts()).toHaveLength(posts);
    expect(
      await prisma.githubIssueImport.findUniqueOrThrow({ where: { id: row.id } }),
    ).toMatchObject({ linkCommentId: String(comment.id) });
    expect(linkComments(1)).toHaveLength(1);
  });

  it('goes on importing when the link has posted 400 link comments in the hour, and posts them after it', async () => {
    lists = repository(30);
    fake.setRepoLists(FULL_NAME, lists);
    // 400 link comments of the last hour, the oldest 50 minutes ago (imports deleted since)
    const oldest = new Date(Date.now() - 50 * 60_000);
    await prisma.githubIssueImport.createMany({
      data: Array.from({ length: IMPORT_PACE.linkCommentsPerHour }, (_, i) => ({
        repoLinkId: link.id,
        githubIssueNumber: 10_000 + i,
        githubIssueId: String(9_000_000 + i),
        mirroredTitle: 't',
        mirroredBodyHash: 'h',
        mirroredLabels: [],
        linkCommentId: String(80_000 + i),
        linkCommentClaimedAt: new Date(oldest.getTime() + i * 1000),
        githubUpdatedAt: new Date(),
        lastImportedAt: new Date(),
      })),
    });
    const opensAt = new Date(oldest.getTime() + HOUR_MS);
    await enable();
    const run = await latestRun();
    await runImportTick(run.id);
    expect(await latestRun()).toMatchObject({
      status: 'RUNNING',
      done: 25,
      error: null,
      linkCommentsWaitUntil: opensAt,
    });
    await runImportTick(run.id);
    expect(await latestRun()).toMatchObject({ status: 'RUNNING', done: 30, pass: 3 });
    expect(await importedIssues()).toBe(30);
    expect(commentPosts()).toEqual([]);
    const status = await request(app).get(url()).set(as(member.token));
    expect(status.body.run).toMatchObject({
      status: 'RUNNING',
      linkCommentsWaitUntil: opensAt.toISOString(),
    });
    // With only link comments left, the worker leaves it until the hour frees a place
    expect(await runDueImports()).toBe(0);

    // A live import shares the hour: its link comment waits too
    lists.issues.push(ghIssue(31));
    const linked = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } });
    await importGithubIssue(linked, ghIssue(31) as never, { withComments: false, live: true });
    expect(commentPosts()).toEqual([]);

    // The hour passes for the oldest 20
    await prisma.$executeRaw`
      UPDATE github_issue_imports SET "linkCommentClaimedAt" = "linkCommentClaimedAt" - interval '11 minutes'
      WHERE "repoLinkId" = ${link.id} AND "githubIssueNumber" >= 10000 AND "githubIssueNumber" < 10020`;
    await prisma.githubImportRun.update({
      where: { id: run.id },
      data: { linkCommentsWaitUntil: new Date(Date.now() - 1000) },
    });
    expect(await runDueImports()).toBe(1);
    expect(commentPosts()).toHaveLength(20);
    const after = await latestRun();
    expect(after.status).toBe('RUNNING');
    expect(after.linkCommentsWaitUntil).not.toBeNull();
  });
});

describe('the lease and the switch', { timeout: 120_000 }, () => {
  it('lets a tick whose lease was taken over write nothing and stop', async () => {
    await enable();
    const run = await latestRun();
    let second: Promise<void> | null = null;
    failing.after = async (title) => {
      if (title !== 'Widget report 3' || second) return;
      // The first tick stalls past its lease; another worker takes the run over
      await prisma.githubImportRun.update({
        where: { id: run.id },
        data: { leaseUntil: new Date(Date.now() - 1000) },
      });
      second = runImportTick(run.id);
      await second;
    };
    await runImportTick(run.id);
    expect(second).not.toBeNull();
    const after = await latestRun();
    // What the second tick wrote stands: #1-#3 known, 25 more made
    expect(after).toMatchObject({ status: 'RUNNING', done: 28, leaseUntil: null });
    expect(await importedIssues()).toBe(28);
    expect(commentPosts()).toHaveLength(IMPORT_PACE.linkCommentsPerMinute);
  });

  it('queues one run for two calls at once', async () => {
    await Promise.all([
      configureImport(ctx.owner.id, ctx.projectId, true),
      configureImport(ctx.owner.id, ctx.projectId, true),
    ]);
    expect(await prisma.githubImportRun.count({ where: { repoLinkId: link.id } })).toBe(1);
  });

  it('queues nothing when import is on and the last run is done, and says so', async () => {
    await enable();
    const run = await latestRun();
    await prisma.githubImportRun.update({
      where: { id: run.id },
      data: { status: 'DONE', total: 130, done: 130 },
    });
    const again = await enable();
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ enabled: true, queued: false, run: { status: 'DONE' } });
    expect(await prisma.githubImportRun.count({ where: { repoLinkId: link.id } })).toBe(1);

    const token = await apiToken(ctx.owner.id, ['github:write']);
    const asked = await enable(token);
    expect(asked.status).toBe(202);
    expect(asked.body.preview).toMatch(
      new RegExp(
        `^GitHub Issues of ${FULL_NAME} are imported into project .* already: nothing is imported or posted$`,
      ),
    );
  });
});
