import crypto from 'node:crypto';

import { marked } from 'marked';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';
import { encryptSecret, secretContext } from '../../lib/secret-box';
import {
  addMemberToContext,
  cleanupTestContext,
  createTestContext,
  createTestUser,
  type TestContext,
  type TestUser,
} from '../../test/factory';
import { useGithubFake, type RecordedRequest } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';
import { parseIssueRefs, parseMentions } from '../../utils/mentions';

import { codeSpan, RELEASE_MARKER_PREFIX, releaseMarkdown } from './release-notes.service';

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const WIDGET = 'acme-labs/widget';
const REPO_ID = 7301;
const sha = (digit: number) => String(digit).repeat(40);
const fake = useGithubFake('release');
const MARKER_LINE = /^<!-- axiom:release-notes sha256=([0-9a-f]{64}) -->$/;

let ctx: TestContext;
let member: TestUser;
let viewer: TestUser;
let spaceId: string;
let sameTeamSpaceId: string;
let otherSpaceId: string;
let otherTeamId: string;
let linkId: string;
let raw: string;
let rawGithubOnly: string;
const issueIds: string[] = [];

/** The Releases on the fake by tag, as GitHub keeps them */
let releases: Map<string, { id: number; tag_name: string; body: string; created_at: string }>;

const as = (user: TestUser) => ({ ...CSRF, Authorization: `Bearer ${user.token}` });
const asToken = (token = raw) => ({ ...CSRF, Authorization: `Token ${token}` });
const notesPath = () => `/api/projects/${ctx.projectId}/github/release-notes`;
const write = (body: object, headers: Record<string, string> = as(member)) =>
  request(app).post(notesPath()).set(headers).send(body);
const releaseWrites = () =>
  fake.requests.filter((r) => r.method !== 'GET' && r.path.includes('/releases'));
const notesPage = () =>
  prisma.page.findFirst({
    where: { spaceId, title: 'Release v1.2.0' },
    select: { id: true, body: true },
  });
const p = () => ctx.projectPrefix;
const hashOf = (text: string) =>
  crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n').trimEnd()).digest('hex');

/**
 * The marker line of a body and whether its hash is the hash of the rest, computed here
 * independently of the service.
 * @param body A body Axiom wrote
 */
function markerOf(body: string): { line: string; matches: boolean } {
  const cut = body.indexOf('\n');
  const line = body.slice(0, cut);
  const hash = MARKER_LINE.exec(line)?.[1];
  return { line, matches: hash !== undefined && hash === hashOf(body.slice(cut + 1)) };
}

/**
 * Connects a user's GitHub account with a token for the widget repository.
 * @param user Who connects
 * @param login The GitHub login
 * @param githubUserId The GitHub user id
 * @param push The repositories the token may write (all it reaches when unset)
 */
async function connectAccount(
  user: TestUser,
  login = 'octo-dev',
  githubUserId = 9101,
  push?: string[],
) {
  const id = `acct-${user.id}`;
  const token = fake.issueUserToken(login, [WIDGET], push ? { push } : {});
  await prisma.githubAccount.create({
    data: {
      id,
      userId: user.id,
      githubUserId,
      login,
      accessToken: encryptSecret(token, secretContext('githubAccount', 'accessToken', id)),
    },
  });
}

/** Serves the Releases of the widget repository from `releases`, by tag, create and update */
function serveReleases() {
  const url = (tag: string) => `https://github.com/${WIDGET}/releases/tag/${tag}`;
  fake.on('GET /repos/:owner/:repo/releases/tags/:tag', (_req, { tag }) => {
    const found = releases.get(tag);
    return found
      ? { status: 200, body: { ...found, html_url: url(tag), draft: false } }
      : { status: 404, body: { message: 'Not Found' } };
  });
  fake.on('POST /repos/:owner/:repo/releases', (req: RecordedRequest) => {
    const body = req.body as { tag_name: string; body: string };
    const created = {
      id: 5600 + releases.size,
      tag_name: body.tag_name,
      body: body.body,
      created_at: new Date().toISOString(),
    };
    releases.set(body.tag_name, created);
    return { status: 201, body: { ...created, html_url: url(body.tag_name) } };
  });
  fake.on('PATCH /repos/:owner/:repo/releases/:id', (req, { id }) => {
    const found = [...releases.values()].find((r) => r.id === Number(id));
    if (!found) return { status: 404, body: { message: 'Not Found' } };
    found.body = (req.body as { body: string }).body;
    return { status: 200, body: { ...found, html_url: url(found.tag_name) } };
  });
}

/**
 * A token of the member with these scopes.
 * @param scopes The scopes
 */
async function mintToken(scopes: string[]): Promise<string> {
  const token = `tk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({
    data: {
      userId: member.id,
      name: `release-agent-${scopes.length}`,
      scopes,
      prefix: token.slice(0, 11),
      tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
    },
  });
  return token;
}

/**
 * A Release of v1.2.0 that already exists on GitHub.
 * @param body Its body
 * @param createdAt When it was created
 */
const existingRelease = (body: string, createdAt = '2026-11-02T00:00:00Z') =>
  releases.set('v1.2.0', { id: 5590, tag_name: 'v1.2.0', body, created_at: createdAt });

beforeAll(async () => {
  ctx = await createTestContext('ghrn');
  member = await addMemberToContext(ctx);
  viewer = await createTestUser();
  await prisma.orgMembership.create({
    data: { orgId: ctx.orgId, userId: viewer.id, role: 'VIEWER' },
  });
  await prisma.teamMembership.create({
    data: { teamId: ctx.teamId, userId: viewer.id, role: 'VIEWER' },
  });
  spaceId = (
    await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Releases', slug: 'releases-ghrn' },
    })
  ).id;
  sameTeamSpaceId = (
    await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Notes', slug: 'notes-ghrn' },
    })
  ).id;
  otherTeamId = (
    await prisma.team.create({ data: { orgId: ctx.orgId, name: 'Other', slug: 'other-ghrn' } })
  ).id;
  otherSpaceId = (
    await prisma.wikiSpace.create({
      data: { teamId: otherTeamId, name: 'Elsewhere', slug: 'elsewhere-ghrn' },
    })
  ).id;
  await prisma.teamMembership.create({
    data: { teamId: otherTeamId, userId: member.id, role: 'MEMBER' },
  });
  const columns = await prisma.boardColumn.findMany({ where: { projectId: ctx.projectId } });
  const column = (name: string) => columns.find((c) => c.name === name)?.id;
  const tickets: Array<[number, string, string]> = [
    [1, 'Login times out', 'Done'],
    [2, 'Export fails for @acme-labs/ops #3', 'In Review'],
    [3, 'Keep the export file ![x](https://img.invalid/a.png)', 'Done'],
    // Named in a PR title only: the page must not link it
    [4, 'Unrelated work', 'To Do'],
  ];
  for (const [number, title, status] of tickets) {
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number,
        title,
        body: '',
        creatorId: ctx.owner.id,
        columnId: column(status),
      },
    });
    issueIds.push(issue.id);
  }
});

/** The title of PR #9: every kind of text that could link, mention or render */
const hostileTitle = () =>
  `Retry the export for @acme-labs/ops #3 \`now\` <span class="mention">@Voorbeeld</span> ` +
  `^${p()}-4 ${p()}-4 www.evil.invalid [x](https://evil.invalid/a)`;

beforeEach(async () => {
  await seedGithubApp({ fake });
  fake.removeInstallation(3301);
  fake.addInstallation(3301, [WIDGET]);
  fake.setRepoId(WIDGET, REPO_ID);
  fake.setPublicRepos([]);
  releases = new Map();
  serveReleases();
  linkId = (
    await prisma.githubRepoLink.create({
      data: {
        projectId: ctx.projectId,
        repoId: BigInt(REPO_ID),
        installationId: 3301n,
        owner: 'acme-labs',
        name: 'widget',
        fullName: WIDGET,
        defaultBranch: 'main',
        htmlUrl: `https://github.com/${WIDGET}`,
        linkedById: ctx.owner.id,
        releaseNotesSpaceId: spaceId,
      },
    })
  ).id;
  const pull = (number: number, title: string, merge: string, login: string) =>
    prisma.githubPullRequest.create({
      data: {
        repoLinkId: linkId,
        number,
        title,
        state: 'MERGED',
        draft: false,
        authorLogin: login,
        headRef: `axm-${number}`,
        headSha: sha(9),
        baseRef: 'main',
        mergeCommitSha: merge,
        requestedReviewers: [],
        htmlUrl: `https://github.com/${WIDGET}/pull/${number}`,
        openedAt: new Date('2026-10-10T00:00:00Z'),
        mergedAt: new Date('2026-10-20T00:00:00Z'),
        githubUpdatedAt: new Date('2026-10-20T00:00:00Z'),
      },
    });
  const seven = await pull(7, 'Fix the login timeout', sha(1), 'octo-dev');
  const nine = await pull(9, hostileTitle(), sha(3), 'review-bot');
  // Merged before v1.1.0: its merge commit is not in the compare
  await pull(5, 'Older work', sha(8), 'octo-dev');
  const links: Array<[string, number]> = [
    [seven.id, 0],
    [seven.id, 1],
    [nine.id, 1],
    [nine.id, 2],
  ];
  for (const [pullId, ticket] of links) {
    await prisma.githubIssueLink.create({
      data: {
        issueId: issueIds[ticket],
        repoLinkId: linkId,
        targetType: 'PULL_REQUEST',
        targetKey: pullId,
        sources: ['PR_TITLE'],
      },
    });
  }
  raw = await mintToken(['github:write', 'wiki:write']);
  rawGithubOnly = await mintToken(['github:write']);
  await connectAccount(member);
});

afterEach(async () => {
  await prisma.agentApproval.deleteMany({ where: { userId: member.id } });
  await prisma.page.deleteMany({
    where: { spaceId: { in: [spaceId, sameTeamSpaceId, otherSpaceId] } },
  });
  await prisma.spacePermission.deleteMany({ where: { spaceId } });
  await prisma.githubRepoLink.deleteMany();
  await prisma.githubAccount.deleteMany();
  await prisma.apiToken.deleteMany({ where: { userId: member.id } });
  await prisma.githubApp.deleteMany();
});

afterAll(async () => {
  await prisma.team.deleteMany({ where: { id: otherTeamId } });
  await cleanupTestContext(ctx);
  await prisma.user.deleteMany({ where: { id: { in: [member.id, viewer.id] } } });
});

describe('githubRelease.writeNotes', () => {
  it('writes the merged pull requests and their tickets to a new page and a new Release, as the user', async () => {
    const before = await prisma.activity.count({ where: { resourceId: { in: issueIds } } });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      pullRequests: 2,
      tickets: 3,
      truncated: false,
      releaseUrl: `https://github.com/${WIDGET}/releases/tag/v1.2.0`,
    });
    expect(res.body.pageUrl).toMatch(
      new RegExp(`/${ctx.orgSlug}/${ctx.teamSlug}/wiki/releases-ghrn/release-v1-2-0$`),
    );

    // Every call goes to the repository by id, as the user
    expect(fake.requests.length).toBeGreaterThan(0);
    for (const req of fake.requests) {
      expect(
        req.path === `/repositories/${REPO_ID}` || req.path.startsWith(`/repositories/${REPO_ID}/`),
      ).toBe(true);
      expect(req.headers.authorization).toMatch(/^user:/);
    }
    // The two commits no stored merge commit matched were looked up, the matched ones were not
    const lookups = fake.requests.filter((r) => r.path.endsWith('/pulls')).map((r) => r.path);
    expect(lookups.sort()).toEqual([
      `/repositories/${REPO_ID}/commits/${sha(2)}/pulls`,
      `/repositories/${REPO_ID}/commits/${sha(4)}/pulls`,
    ]);

    const [created] = releaseWrites();
    expect(created).toMatchObject({ method: 'POST', path: `/repositories/${REPO_ID}/releases` });
    expect(created.body).toMatchObject({ tag_name: 'v1.2.0', name: 'v1.2.0', draft: false });
    const releaseBody = (created.body as { body: string }).body;
    expect(markerOf(releaseBody).matches).toBe(true);
    expect(releaseBody.slice(releaseBody.indexOf('\n') + 1)).toBe(
      [
        '',
        '## v1.2.0',
        '',
        '### Pull requests',
        '',
        `- #7 \`Fix the login timeout\` by @octo-dev (${p()}-1, ${p()}-2)`,
        `- #9 \`\`${hostileTitle()}\`\` by @review-bot (${p()}-2, ${p()}-3)`,
        '',
        '### Tickets',
        '',
        `- ${p()}-1 \`Login times out\` (Done)`,
        `- ${p()}-2 \`Export fails for @acme-labs/ops #3\` (In Review)`,
        `- ${p()}-3 \`Keep the export file ![x](https://img.invalid/a.png)\` (Done)`,
        '',
      ].join('\n'),
    );

    const page = await notesPage();
    expect(page).not.toBeNull();
    const body = page?.body ?? '';
    expect(body.startsWith(RELEASE_MARKER_PREFIX)).toBe(true);
    expect(body).toContain(`- #7 \`Fix the login timeout\` by \`@octo-dev\` (${p()}-1, ${p()}-2)`);
    expect(body).toContain(`- ${p()}-2 \`Export fails for @acme-labs/ops #3\` (In Review)`);

    // As the frontend renders it: nothing of GitHub's text is a link, image, mention or ref
    const html = await marked.parse(body, { gfm: true });
    expect(html).not.toMatch(/<a\s/);
    expect(html).not.toMatch(/<img\s/);
    expect(html).not.toMatch(/<span/);
    expect(parseMentions(body)).toEqual([]);
    expect(parseIssueRefs(body)).toEqual([]);
    // The page links the three tickets, not the issue a PR title names
    const mentions = await prisma.wikiPageIssueLink.findMany({
      where: { pageId: page?.id, linkType: 'MENTION' },
      select: { issueId: true },
    });
    expect(mentions.map((m) => m.issueId).sort()).toEqual(issueIds.slice(0, 3).sort());

    // No activity on the tickets (R16)
    expect(await prisma.activity.count({ where: { resourceId: { in: issueIds } } })).toBe(before);
  });

  it('updates the page and the Release when run again', async () => {
    expect((await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' })).status).toBe(201);
    await prisma.githubPullRequest.updateMany({
      where: { repoLinkId: linkId, number: 7 },
      data: { title: 'Fix the login timeout for good' },
    });
    fake.requests.length = 0;
    const again = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(again.status).toBe(201);
    const writes = releaseWrites();
    expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual([
      `PATCH /repositories/${REPO_ID}/releases/5600`,
    ]);
    expect(releases.get('v1.2.0')?.body).toContain('`Fix the login timeout for good`');
    expect(markerOf(releases.get('v1.2.0')?.body ?? '').matches).toBe(true);
    expect(await prisma.page.count({ where: { spaceId, title: 'Release v1.2.0' } })).toBe(1);
    expect((await notesPage())?.body).toContain('Fix the login timeout for good');
  });

  it('refuses a Release body a person wrote, and writes no page', async () => {
    existingRelease('Hand-written notes');
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_RELEASE_BODY_EXISTS');
    expect(await notesPage()).toBeNull();
    expect(releaseWrites()).toEqual([]);
    expect(releases.get('v1.2.0')?.body).toBe('Hand-written notes');
  });

  it('refuses a body Axiom wrote that a person then edited', async () => {
    expect((await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' })).status).toBe(201);
    const release = releases.get('v1.2.0');
    if (release) release.body += '\n\nThanks to everyone who tested the beta.';
    fake.requests.length = 0;
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_RELEASE_BODY_EXISTS');
    expect(releaseWrites()).toEqual([]);
    expect(releases.get('v1.2.0')?.body).toContain('Thanks to everyone');
    // A marker without its hash is no proof either
    existingRelease(`${RELEASE_MARKER_PREFIX} -->\nold notes`);
    expect((await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' })).status).toBe(409);
  });

  it('replaces a body a person wrote with replaceBody from a session', async () => {
    existingRelease('Hand-written notes');
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0', replaceBody: true });
    expect(res.status).toBe(201);
    expect(releaseWrites().map((r) => `${r.method} ${r.path}`)).toEqual([
      `PATCH /repositories/${REPO_ID}/releases/5590`,
    ]);
    expect(markerOf(releases.get('v1.2.0')?.body ?? '').matches).toBe(true);
  });

  it("refuses a person's body to a token that does not ask to replace it, and writes nothing", async () => {
    existingRelease('Hand-written notes');
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' }, asToken());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_RELEASE_BODY_EXISTS');
    expect(await notesPage()).toBeNull();
    expect(releaseWrites()).toEqual([]);
  });

  it('waits for approval when a token asks to replace the body, and calls GitHub not at all', async () => {
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0', replaceBody: true }, asToken());
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.preview).toBe(
      `Replace the body of GitHub release v1.2.0 in ${WIDGET} with release notes`,
    );
    expect(fake.requests).toEqual([]);
    expect(await notesPage()).toBeNull();
  });

  it('runs at once for a token with github:write and wiki:write that replaces nothing', async () => {
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' }, asToken());
    expect(res.status).toBe(201);
    expect(res.body.pullRequests).toBe(2);
  });

  it('refuses a token without wiki:write before any GitHub call', async () => {
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' }, asToken(rawGithubOnly));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SCOPE');
    expect(fake.requests).toEqual([]);
    expect(await notesPage()).toBeNull();
  });

  it('refuses an existing page Axiom did not write, unless asked to replace it', async () => {
    await prisma.page.create({
      data: { spaceId, title: 'Release v1.2.0', slug: 'release-v1-2-0', body: 'Our own notes' },
    });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('RELEASE_PAGE_EXISTS');
    expect(fake.requests).toEqual([]);
    expect((await notesPage())?.body).toBe('Our own notes');
    const replaced = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0', replaceBody: true });
    expect(replaced.status).toBe(201);
    expect((await notesPage())?.body.startsWith(RELEASE_MARKER_PREFIX)).toBe(true);
  });

  it('refuses an existing page the caller may not edit before any GitHub call', async () => {
    const page = await prisma.page.create({
      data: {
        spaceId,
        title: 'Release v1.2.0',
        slug: 'release-v1-2-0',
        body: `${RELEASE_MARKER_PREFIX} -->\n`,
      },
    });
    await prisma.pageRestriction.create({
      data: { pageId: page.id, type: 'EDIT', userId: ctx.owner.id },
    });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(403);
    expect(fake.requests).toEqual([]);
  });

  it('asks for a space when the project has none configured and the request names none', async () => {
    await prisma.githubRepoLink.update({
      where: { id: linkId },
      data: { releaseNotesSpaceId: null },
    });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_NOTES_SPACE_REQUIRED');
    expect(fake.requests).toEqual([]);
  });

  it("writes to the space of the project's team the request names", async () => {
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0', spaceId: sameTeamSpaceId });
    expect(res.status).toBe(201);
    expect(res.body.pageUrl).toContain('/wiki/notes-ghrn/release-v1-2-0');
    expect(await prisma.page.count({ where: { spaceId: sameTeamSpaceId } })).toBe(1);
    expect(await notesPage()).toBeNull();
  });

  it('refuses a space of another team, even one the caller can edit', async () => {
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0', spaceId: otherSpaceId });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_NOTES_SPACE_INVALID');
    expect(fake.requests).toEqual([]);
    expect(await prisma.page.count({ where: { spaceId: otherSpaceId } })).toBe(0);
  });

  it('refuses a user without edit on the configured space before any GitHub call', async () => {
    await prisma.spacePermission.create({
      data: { spaceId, teamRole: 'MEMBER', level: 'VIEW' },
    });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(403);
    expect(fake.requests).toEqual([]);
    const named = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0', spaceId });
    expect(named.status).toBe(403);
    expect(fake.requests).toEqual([]);
    expect(await notesPage()).toBeNull();
  });

  it('refuses a user without issue edit on the project before any GitHub call', async () => {
    await connectAccount(viewer, 'viewer-dev', 9103);
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' }, as(viewer));
    expect(res.status).toBe(403);
    expect(fake.requests).toEqual([]);
  });

  it('refuses a user without a connected GitHub account', async () => {
    await prisma.githubAccount.deleteMany({ where: { userId: member.id } });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_NOT_CONNECTED');
    expect(fake.requests).toEqual([]);
    expect(await notesPage()).toBeNull();
  });

  it('refuses a user who may not push to the repository, and writes nothing', async () => {
    await prisma.githubAccount.deleteMany({ where: { userId: member.id } });
    await connectAccount(member, 'octo-dev', 9101, []);
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GITHUB_FORBIDDEN');
    expect(await notesPage()).toBeNull();
    expect(releaseWrites()).toEqual([]);
    expect(fake.requests.map((r) => r.path)).toEqual([`/repositories/${REPO_ID}`]);
  });

  it('takes the previous tag from the newest earlier published Release', async () => {
    const res = await write({ tag: 'v1.2.0' });
    expect(res.status).toBe(201);
    expect(fake.requests.map((r) => r.path)).toContain(
      `/repositories/${REPO_ID}/compare/v1.1.0...v1.2.0`,
    );
  });

  it("compares with the Release created before the tag's own", async () => {
    existingRelease('', '2026-09-15T00:00:00Z');
    const res = await write({ tag: 'v1.2.0' });
    // The fixtures hold no compare from v1.0.0: GitHub answers 404 for it
    expect(res.status).toBe(404);
    expect(fake.requests.map((r) => r.path)).toContain(
      `/repositories/${REPO_ID}/compare/v1.0.0...v1.2.0`,
    );
  });

  it('asks for the previous tag when no earlier Release is published', async () => {
    fake.on('GET /repos/:owner/:repo/releases', {
      status: 200,
      body: [
        {
          id: 5503,
          tag_name: 'v1.3.0-rc',
          draft: true,
          created_at: '2026-11-01T10:00:00Z',
          published_at: null,
        },
      ],
    });
    const res = await write({ tag: 'v1.2.0' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_PREVIOUS_TAG_REQUIRED');
    expect(releaseWrites()).toEqual([]);
    expect(await notesPage()).toBeNull();
  });

  it('answers 404 for a tag GitHub does not have, before the compare, and writes nothing', async () => {
    // `main` is a branch, not a tag: the compare would resolve it, the tag lookup does not
    for (const tag of ['v9.9.9', 'main']) {
      fake.requests.length = 0;
      const res = await write({ tag, previousTag: 'v1.1.0' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('GITHUB_TAG_NOT_FOUND');
      expect(fake.requests.some((r) => r.path.includes('/compare/'))).toBe(false);
      expect(releaseWrites()).toEqual([]);
      expect(await prisma.page.count({ where: { spaceId } })).toBe(0);
    }
  });

  it('refuses notes with no commits between the tags, and writes nothing', async () => {
    fake.on('GET /repos/:owner/:repo/compare/:basehead', {
      status: 200,
      body: { status: 'identical', total_commits: 0, commits: [] },
    });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('RELEASE_NO_CHANGES');
    expect(releaseWrites()).toEqual([]);
    expect(await notesPage()).toBeNull();
  });

  it('lists only stored pull requests merged into the default branch', async () => {
    await prisma.githubPullRequest.updateMany({
      where: { repoLinkId: linkId, number: 7 },
      data: { baseRef: 'feature/login' },
    });
    // GitHub agrees for the commit of its branch
    fake.on(`GET /repos/:owner/:repo/commits/${sha(2)}/pulls`, {
      status: 200,
      body: [
        {
          number: 7,
          title: 'Fix the login timeout',
          merged_at: '2026-10-20T09:00:00Z',
          user: { login: 'octo-dev' },
          base: { ref: 'feature/login' },
        },
      ],
    });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(201);
    expect(res.body.pullRequests).toBe(1);
    expect(releases.get('v1.2.0')?.body).not.toContain('#7 ');
  });

  it('looks up at most 100 commits and says the notes are incomplete', async () => {
    const shas = Array.from({ length: 105 }, (_, i) => i.toString(16).padStart(40, 'e'));
    fake.on('GET /repos/:owner/:repo/compare/:basehead', {
      status: 200,
      body: { commits: shas.map((s) => ({ sha: s })) },
    });
    fake.on('GET /repos/:owner/:repo/commits/:sha/pulls', { status: 200, body: [] });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(201);
    expect(res.body.truncated).toBe(true);
    expect(fake.requests.filter((r) => r.path.endsWith('/pulls'))).toHaveLength(100);
    const incomplete = /These notes may be incomplete/;
    expect(releases.get('v1.2.0')?.body.trimEnd().split('\n').at(-1)).toMatch(incomplete);
    expect((await notesPage())?.body.trimEnd().split('\n').at(-1)).toMatch(incomplete);
  });

  it('says the notes are incomplete when the compare is cut', async () => {
    fake.on('GET /repos/:owner/:repo/compare/:basehead', (req) => {
      const page = Number(req.query.page ?? 1);
      return {
        status: 200,
        body: { commits: [{ sha: page.toString(16).padStart(40, 'f') }] },
        headers: {
          link: `<${fake.url}/repositories/${REPO_ID}/compare/v1.1.0...v1.2.0?per_page=100&page=${page + 1}>; rel="next"`,
        },
      };
    });
    fake.on('GET /repos/:owner/:repo/commits/:sha/pulls', { status: 200, body: [] });
    const res = await write({ tag: 'v1.2.0', previousTag: 'v1.1.0' });
    expect(res.status).toBe(201);
    expect(res.body.truncated).toBe(true);
    expect(fake.requests.filter((r) => r.path.includes('/compare/'))).toHaveLength(10);
  });

  it('refuses a tag that is no valid ref name', async () => {
    const res = await write({ tag: 'v1 2\nreplace' });
    expect(res.status).toBe(400);
    expect(fake.requests).toEqual([]);
  });
});

describe('githubRepo.update', () => {
  const update = (body: object, user: TestUser = ctx.owner) =>
    request(app).patch(`/api/projects/${ctx.projectId}/github`).set(as(user)).send(body);

  it("stores a space of the project's team, and clears it", async () => {
    await prisma.githubRepoLink.update({
      where: { id: linkId },
      data: { releaseNotesSpaceId: null },
    });
    const res = await update({ releaseNotesSpaceId: spaceId });
    expect(res.status).toBe(200);
    expect(res.body.releaseNotesSpaceId).toBe(spaceId);
    const got = await request(app).get(`/api/projects/${ctx.projectId}/github`).set(as(member));
    expect(got.body.releaseNotesSpaceId).toBe(spaceId);
    expect((await update({ releaseNotesSpaceId: null })).body.releaseNotesSpaceId).toBeNull();
  });

  it('refuses a space of another team, or one that does not exist', async () => {
    for (const id of [otherSpaceId, 'no-such-space']) {
      const res = await update({ releaseNotesSpaceId: id });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('RELEASE_NOTES_SPACE_INVALID');
    }
    const link = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.releaseNotesSpaceId).toBe(spaceId);
  });

  it('forgets the space when it is deleted', async () => {
    const gone = await prisma.wikiSpace.create({
      data: { teamId: ctx.teamId, name: 'Short lived', slug: 'short-lived-ghrn' },
    });
    expect((await update({ releaseNotesSpaceId: gone.id })).status).toBe(200);
    await prisma.wikiSpace.delete({ where: { id: gone.id } });
    const link = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: linkId } });
    expect(link.releaseNotesSpaceId).toBeNull();
  });

  it('is for the admins of the team', async () => {
    const res = await update({ releaseNotesSpaceId: null }, member);
    expect(res.status).toBe(403);
  });
});

describe('release markdown', () => {
  it('puts a text holding backticks in a longer fence', () => {
    expect(codeSpan('plain', 200)).toBe('`plain`');
    expect(codeSpan('a `b` c', 200)).toBe('``a `b` c``');
    expect(codeSpan('``x', 200)).toBe('``` ``x ```');
    expect(codeSpan('two\nlines', 200)).toBe('`two lines`');
  });

  it('says None for an empty list, under a marker that hashes the rest', () => {
    const body = releaseMarkdown('v1.0.0', [], [], 'github', false);
    expect(markerOf(body).matches).toBe(true);
    expect(body.slice(body.indexOf('\n') + 1)).toBe(
      '\n## v1.0.0\n\n### Pull requests\n\nNone\n\n### Tickets\n\nNone\n',
    );
  });

  it('credits a login that is no plain GitHub login as code', () => {
    const body = releaseMarkdown(
      'v1.0.0',
      [{ number: 3, title: 'Bump', login: 'dependabot[bot]', keys: [] }],
      [],
      'github',
      false,
    );
    expect(body).toContain('- #3 `Bump` by `dependabot[bot]`');
  });

  it('puts a tag that is not plain in a code span in the heading', () => {
    for (const target of ['github', 'wiki'] as const) {
      expect(releaseMarkdown('v2@acme-labs#12', [], [], target, false)).toContain(
        '\n## `v2@acme-labs#12`\n',
      );
      expect(releaseMarkdown('release/v2.0_rc-1', [], [], target, false)).toContain(
        '\n## release/v2.0_rc-1\n',
      );
    }
  });
});
