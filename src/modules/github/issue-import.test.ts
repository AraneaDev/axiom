import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { GithubRepoLink } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';

import { instanceOrigin } from './github-app.service';
import { GITHUB_INTEGRATION_USER_ID } from './integration-user';
import {
  importComment,
  importGithubIssue,
  postLinkComment,
  type GithubIssuePayload,
} from './issue-import.service';
import './github-resolvers';

const REPO_ID = 880_710;
const INSTALLATION_ID = 4711;
const APP_ID = 1201;
const FULL_NAME = 'acme-labs/widget';
const FIXTURES = path.join(__dirname, '../../test/__fixtures__/github/import');

type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const fixture = (name: string): Payload =>
  (JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8')) as { body: Payload }).body;
const issue = (over: Payload = {}): GithubIssuePayload =>
  ({ ...fixture('get-issue'), ...over }) as GithubIssuePayload;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const fake = useGithubFake('import');
let ctx: TestContext;
let member: TestUser;
let outsider: TestUser;
let link: GithubRepoLink;

const commentPosts = () =>
  fake.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/comments'));

async function issueUrl(issueId: string): Promise<{ key: string; url: string }> {
  const row = await prisma.issue.findUniqueOrThrow({
    where: { id: issueId },
    include: { project: { include: { team: { include: { org: true } } } } },
  });
  const { project } = row;
  return {
    key: `${project.prefix}-${row.number}`,
    url: `${instanceOrigin()}/${project.team.org.slug}/${project.team.slug}/${project.slug}/issues/${row.number}`,
  };
}

beforeAll(async () => {
  await seedGithubApp({ appId: APP_ID, fake });
  fake.addInstallation(INSTALLATION_ID, [FULL_NAME]);
  fake.setRepoId(FULL_NAME, REPO_ID);
  ctx = await createTestContext('gim1');
  member = await addMemberToContext(ctx);
  outsider = await createTestUser();
});

beforeEach(async () => {
  fake.setRepoLists(FULL_NAME, { issues: [issue()] });
  await prisma.issue.deleteMany({ where: { projectId: ctx.projectId } });
  await prisma.notification.deleteMany({ where: { userId: { in: [member.id, ctx.owner.id] } } });
  await prisma.githubAccount.deleteMany();
  await prisma.githubInstallation.deleteMany();
  await prisma.githubInstallation.create({
    data: { id: BigInt(INSTALLATION_ID), accountLogin: 'acme-labs', accountType: 'Organization' },
  });
  await prisma.githubRepoLink.deleteMany({ where: { repoId: BigInt(REPO_ID) } });
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
  await prisma.user.deleteMany({ where: { id: outsider.id } });
  await cleanupTestContext(ctx);
});

const connect = (userId: string, githubUserId: number, login: string) =>
  prisma.githubAccount.create({
    data: { userId, githubUserId: BigInt(githubUserId), login, accessToken: 'x' },
  });

describe('importGithubIssue: a new issue', () => {
  it('creates the Axiom issue with title, body, labels, a web link and the mapped creator', async () => {
    await connect(member.id, 7001, 'voorbeeld-dev');
    const result = await importGithubIssue(link, issue(), { withComments: false });
    expect(result).toMatchObject({ created: true, conflicts: [] });

    const row = await prisma.issue.findUniqueOrThrow({
      where: { id: result!.issueId },
      include: { labels: true, webLinks: true, column: true },
    });
    expect(row.projectId).toBe(ctx.projectId);
    expect(row.title).toBe('The widget forgets its colour after a restart');
    expect(row.body).toBe(fixture('get-issue').body);
    expect(row.labels.map((l) => l.name).sort()).toEqual(['bug', 'needs-triage']);
    expect(row.column?.isDefault).toBe(true);
    expect(row.creatorId).toBe(member.id);
    expect(row.externalAuthorLogin).toBeNull();
    expect(row.webLinks).toEqual([
      expect.objectContaining({
        title: 'GitHub issue #31',
        url: 'https://github.com/acme-labs/widget/issues/31',
      }),
    ]);

    const imported = await prisma.githubIssueImport.findUniqueOrThrow({
      where: { issueId: row.id },
    });
    expect(imported).toMatchObject({
      repoLinkId: link.id,
      githubIssueNumber: 31,
      githubIssueId: '2200031',
      mirroredTitle: row.title,
      mirroredBodyHash: sha(row.body),
      githubUpdatedAt: new Date('2026-11-07T10:00:00Z'),
    });
    expect([...imported.mirroredLabels].sort()).toEqual(['bug', 'needs-triage']);
    const activity = await prisma.activity.findMany({
      where: { resourceId: row.id, action: 'imported' },
    });
    expect(activity).toHaveLength(1);
  });

  it('makes an unmapped author the integration user with the GitHub login kept', async () => {
    const result = await importGithubIssue(link, issue(), { withComments: false });
    const row = await prisma.issue.findUniqueOrThrow({ where: { id: result!.issueId } });
    expect(row.creatorId).toBe(GITHUB_INTEGRATION_USER_ID);
    expect(row.externalAuthorLogin).toBe('voorbeeld-dev');
  });

  it('does not map a connected user outside the project org', async () => {
    await connect(outsider.id, 7001, 'voorbeeld-dev');
    const result = await importGithubIssue(link, issue(), { withComments: false });
    const row = await prisma.issue.findUniqueOrThrow({ where: { id: result!.issueId } });
    expect(row.creatorId).toBe(GITHUB_INTEGRATION_USER_ID);
    expect(row.externalAuthorLogin).toBe('voorbeeld-dev');
  });

  it('notifies nobody it mentions', async () => {
    await importGithubIssue(link, issue({ body: `Asked @${member.username} about it` }), {
      withComments: false,
    });
    // The notifier runs after the write without being awaited: give it the time it would take
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await prisma.notification.count({ where: { userId: member.id } })).toBe(0);
  });

  it('cuts the title and keeps at most 20 labels, names cut to the label limit', async () => {
    const labels = Array.from({ length: 25 }, (_, i) => ({ name: `${'l'.repeat(120)}${i}` }));
    const result = await importGithubIssue(
      link,
      issue({ title: 'T'.repeat(250), body: null, labels }),
      { withComments: false },
    );
    const row = await prisma.issue.findUniqueOrThrow({
      where: { id: result!.issueId },
      include: { labels: true },
    });
    expect(row.title).toBe('T'.repeat(200));
    expect(row.body).toBe('');
    expect(row.labels).toHaveLength(1);
    expect(row.labels[0].name).toBe('l'.repeat(100));
    const many = Array.from({ length: 25 }, (_, i) => ({ name: `label-${i}` }));
    fake.setRepoLists(FULL_NAME, { issues: [issue(), issue({ number: 32, id: 2200032 })] });
    const second = await importGithubIssue(link, issue({ number: 32, id: 2200032, labels: many }), {
      withComments: false,
    });
    const labelled = await prisma.issue.findUniqueOrThrow({
      where: { id: second!.issueId },
      include: { labels: true },
    });
    expect(labelled.labels).toHaveLength(20);
  });

  it('imports neither a closed issue nor a pull request', async () => {
    expect(await importGithubIssue(link, issue({ state: 'closed' }), { withComments: true })).toBe(
      null,
    );
    const pull = issue({
      pull_request: { url: 'https://api.github.com/repos/acme-labs/widget/pulls/31' },
    });
    expect(await importGithubIssue(link, pull, { withComments: true })).toBe(null);
    expect(await prisma.issue.count({ where: { projectId: ctx.projectId } })).toBe(0);
    expect(commentPosts()).toHaveLength(0);
  });

  it('imports the comments with their authors and skips bots', async () => {
    await connect(member.id, 7002, 'outside-dev');
    const result = await importGithubIssue(link, issue(), { withComments: true });
    const comments = await prisma.comment.findMany({ where: { issueId: result!.issueId } });
    expect(comments).toEqual([
      expect.objectContaining({
        body: 'I can reproduce this on the latest release.',
        authorId: member.id,
        externalAuthorLogin: null,
      }),
    ]);
    const mirror = await prisma.githubImportedComment.findUniqueOrThrow({
      where: { githubCommentId: '9301' },
    });
    expect(mirror.commentId).toBe(comments[0].id);
    expect(mirror.mirroredBodyHash).toBe(sha(comments[0].body));
    const read = fake.requests.find((r) => r.method === 'GET' && r.path.endsWith('/comments'));
    expect(read?.path).toBe(`/repositories/${REPO_ID}/issues/31/comments`);
    expect(read?.headers.authorization).toBe(`installation:${INSTALLATION_ID}`);
  });

  it('gives an unmapped commenter the integration user and the login', async () => {
    const result = await importGithubIssue(link, issue(), { withComments: true });
    const [comment] = await prisma.comment.findMany({ where: { issueId: result!.issueId } });
    expect(comment.authorId).toBe(GITHUB_INTEGRATION_USER_ID);
    expect(comment.externalAuthorLogin).toBe('outside-dev');
  });
});

describe('the link comment', () => {
  it('is posted once, as the installation, addressed by repository id', async () => {
    const result = await importGithubIssue(link, issue(), { withComments: false });
    const { key, url } = await issueUrl(result!.issueId);
    const posts = commentPosts();
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe(`/repositories/${REPO_ID}/issues/31/comments`);
    expect(posts[0].headers.authorization).toBe(`installation:${INSTALLATION_ID}`);
    expect(posts[0].body).toEqual({ body: `Tracked in Axiom as [${key}](${url})` });
    const row = await prisma.githubIssueImport.findUniqueOrThrow({
      where: { issueId: result!.issueId },
    });
    expect(row.linkCommentId).toBe('5001');

    const again = await importGithubIssue(link, issue(), { withComments: false });
    expect(again).toMatchObject({ issueId: result!.issueId, created: false });
    await postLinkComment(row.id);
    expect(commentPosts()).toHaveLength(1);
  });

  it('is not posted while another run holds a fresh claim', async () => {
    const result = await importGithubIssue(link, issue(), { withComments: false });
    const row = await prisma.githubIssueImport.update({
      where: { issueId: result!.issueId },
      data: { linkCommentId: null, linkCommentClaimedAt: new Date(Date.now() - 60_000) },
    });
    fake.requests.length = 0;
    await postLinkComment(row.id);
    expect(commentPosts()).toHaveLength(0);
    expect(
      (await prisma.githubIssueImport.findUniqueOrThrow({ where: { id: row.id } })).linkCommentId,
    ).toBeNull();
  });

  it('takes over a stale claim and keeps the comment the App already made', async () => {
    const result = await importGithubIssue(link, issue(), { withComments: false });
    const { key, url } = await issueUrl(result!.issueId);
    const row = await prisma.githubIssueImport.update({
      where: { issueId: result!.issueId },
      data: { linkCommentId: null, linkCommentClaimedAt: new Date(Date.now() - 11 * 60_000) },
    });
    fake.setRepoLists(FULL_NAME, {
      issues: [issue()],
      issueComments: {
        '31': [
          {
            id: 9399,
            body: `Tracked in Axiom as [${key}](${url})`,
            user: { login: 'acme-axiom[bot]', id: 9_900_001, type: 'Bot' },
            performed_via_github_app: { id: APP_ID, slug: 'acme-axiom' },
          },
        ],
      },
    });
    fake.requests.length = 0;
    await postLinkComment(row.id);
    expect(commentPosts()).toHaveLength(0);
    const read = fake.requests.find((r) => r.method === 'GET');
    expect(read?.path).toBe(`/repositories/${REPO_ID}/issues/31/comments`);
    expect(
      (await prisma.githubIssueImport.findUniqueOrThrow({ where: { id: row.id } })).linkCommentId,
    ).toBe('9399');
  });

  it('posts on a stale claim when GitHub has no comment of the App', async () => {
    const result = await importGithubIssue(link, issue(), { withComments: false });
    const row = await prisma.githubIssueImport.update({
      where: { issueId: result!.issueId },
      data: { linkCommentId: null, linkCommentClaimedAt: new Date(Date.now() - 11 * 60_000) },
    });
    fake.setRepoLists(FULL_NAME, { issues: [issue()], issueComments: {} });
    fake.requests.length = 0;
    await postLinkComment(row.id);
    expect(commentPosts()).toHaveLength(1);
  });
});

describe('importGithubIssue: an imported issue', () => {
  it('ignores a payload older than the last import', async () => {
    const result = await importGithubIssue(link, issue(), { withComments: false });
    const older = await importGithubIssue(
      link,
      issue({ title: 'An older title', updated_at: '2026-11-07T08:00:00Z' }),
      { withComments: false },
    );
    expect(older).toMatchObject({ issueId: result!.issueId, created: false, conflicts: [] });
    const row = await prisma.issue.findUniqueOrThrow({ where: { id: result!.issueId } });
    expect(row.title).toBe('The widget forgets its colour after a restart');
  });

  it('skips the App link comment and bot comments in importComment', async () => {
    const result = await importGithubIssue(link, issue(), { withComments: false });
    const row = await prisma.githubIssueImport.findUniqueOrThrow({
      where: { issueId: result!.issueId },
    });
    await importComment(row, {
      id: Number(row.linkCommentId),
      body: 'Tracked in Axiom',
      user: { login: 'someone', id: 1, type: 'User' },
      created_at: '2026-11-07T11:00:00Z',
      updated_at: '2026-11-07T11:00:00Z',
    });
    await importComment(row, {
      id: 9500,
      body: 'Beep',
      user: { login: 'helper[bot]', id: 2, type: 'Bot' },
      created_at: '2026-11-07T11:00:00Z',
      updated_at: '2026-11-07T11:00:00Z',
    });
    expect(await prisma.comment.count({ where: { issueId: result!.issueId } })).toBe(0);
  });
});
