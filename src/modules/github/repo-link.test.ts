import crypto from 'node:crypto';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { useGithubFake } from '../../test/github-fake';
import { seedGithubApp } from '../../test/github-seed';

import { findRepoLinkByProject, findRepoLinkByRepoId } from './repo-link.service';

// Linking starts a reconcile of the new link; its GitHub calls would race with the assertions
// on the calls linking itself makes. The reconcile has its own tests.
const reconcile = vi.hoisted(() => ({ repoLinkIds: [] as string[] }));
vi.mock('./reconcile.service', () => ({
  reconcileRepo: async (repoLinkId: string) => {
    reconcile.repoLinkIds.push(repoLinkId);
    return { pullRequests: 0, checkRuns: 0, branches: 0, calls: 0, complete: true, reason: null };
  },
}));

const CSRF = { 'X-Requested-With': 'XMLHttpRequest' };
const WIDGET = 'acme-labs/widget';
const GADGET = 'acme-labs/gadget';
const fake = useGithubFake('repo');

let ctx: TestContext;
let other: { id: string };
let teamMember: TestUser;
let teamAdmin: TestUser;
let viewer: TestUser;
let outsider: TestUser;

const as = (user: TestUser) => ({ ...CSRF, Authorization: `Bearer ${user.token}` });
const url = (projectId: string) => `/api/projects/${projectId}/github`;

/**
 * Connects a user's GitHub account with a token that reaches the repositories and has admin
 * rights on some.
 * @param user - Who connects
 * @param repos - The repositories the token reaches
 * @param admin - The ones the person has admin rights on
 */
async function connectAccount(user: TestUser, repos: string[], admin: string[]) {
  const id = `acct-${user.id}`;
  const token = fake.issueUserToken('octo-dev', repos, { admin });
  await prisma.githubAccount.create({
    data: {
      id,
      userId: user.id,
      githubUserId: 9101,
      login: 'octo-dev',
      accessToken: encryptSecret(token, secretContext('githubAccount', 'accessToken', id)),
    },
  });
}

/**
 * An API token for a user, as an agent holds it.
 * @param userId - Its user
 * @param scopes - Its scopes
 */
async function apiToken(userId: string, scopes: string[]): Promise<string> {
  const raw = `tk_${crypto.randomBytes(24).toString('hex')}`;
  await prisma.apiToken.create({
    data: {
      userId,
      name: 'github-agent',
      scopes,
      prefix: raw.slice(0, 11),
      tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
    },
  });
  return raw;
}

beforeAll(async () => {
  ctx = await createTestContext('ghrl');
  teamMember = await addMemberToContext(ctx);
  teamAdmin = await createTestUser();
  await prisma.orgMembership.create({
    data: { orgId: ctx.orgId, userId: teamAdmin.id, role: 'MEMBER' },
  });
  await prisma.teamMembership.create({
    data: { teamId: ctx.teamId, userId: teamAdmin.id, role: 'ADMIN' },
  });
  viewer = await createTestUser();
  await prisma.orgMembership.create({
    data: { orgId: ctx.orgId, userId: viewer.id, role: 'VIEWER' },
  });
  await prisma.teamMembership.create({
    data: { teamId: ctx.teamId, userId: viewer.id, role: 'VIEWER' },
  });
  outsider = await createTestUser();
  other = await prisma.project.create({
    data: {
      name: 'Second project',
      slug: 'second-ghrl',
      prefix: 'SGH',
      teamId: ctx.teamId,
    },
  });
});

beforeEach(async () => {
  await seedGithubApp({ fake });
  fake.removeInstallation(3301);
  fake.addInstallation(3301, [WIDGET, GADGET]);
  fake.setPublicRepos([]);
});

afterEach(async () => {
  await prisma.githubRepoLink.deleteMany();
  await prisma.githubAccount.deleteMany();
  await prisma.apiToken.deleteMany({
    where: { userId: { in: [ctx.owner.id, teamAdmin.id, teamMember.id] } },
  });
  await prisma.githubApp.deleteMany();
});

afterAll(async () => {
  await prisma.project.deleteMany({ where: { id: other.id } });
  const ids = [teamMember.id, teamAdmin.id, viewer.id, outsider.id];
  await cleanupTestContext(ctx);
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe('githubRepo.link', () => {
  it('links a repository for a team admin who has admin rights on it', async () => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: WIDGET });
    expect(res.status).toBeLessThan(300);
    expect(res.body).toMatchObject({
      repoFullName: WIDGET,
      htmlUrl: 'https://github.com/acme-labs/widget',
      defaultBranch: 'main',
      linkedBy: { id: ctx.owner.id },
    });
    expect(typeof res.body.createdAt).toBe('string');
    const link = await findRepoLinkByProject(ctx.projectId);
    expect(link).toMatchObject({
      owner: 'acme-labs',
      name: 'widget',
      fullName: WIDGET,
      installationId: 3301n,
      linkedById: ctx.owner.id,
    });
    expect((await findRepoLinkByRepoId(Number(link!.repoId)))?.projectId).toBe(ctx.projectId);
    // A fresh link starts reading the repository at once
    await vi.waitFor(() => expect(reconcile.repoLinkIds).toContain(link!.id));
    // The user's rights were checked as the user, the installation as the App
    expect(fake.requests.map((r) => `${r.method} ${r.path} ${r.headers.authorization}`)).toEqual([
      expect.stringMatching(/^GET \/repos\/acme-labs\/widget user:/),
      'GET /repos/acme-labs/widget/installation app',
    ]);
  });

  it('records the installation, so the link is read by the worker and by a manual reconcile', async () => {
    await prisma.githubInstallation.deleteMany();
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const linked = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: WIDGET });
    expect(linked.status).toBeLessThan(300);

    const installation = await prisma.githubInstallation.findUniqueOrThrow({
      where: { id: 3301n },
    });
    expect(installation).toMatchObject({
      accountLogin: 'acme-labs',
      suspendedAt: null,
      removedAt: null,
    });
    expect(installation.accountType).toBeTruthy();

    // The real due list, not the mocked reconcile: a never read link with an installation is due
    const { dueRepoLinkIds } =
      await vi.importActual<typeof import('./reconcile.service')>('./reconcile.service');
    const link = await findRepoLinkByProject(ctx.projectId);
    await prisma.githubRepoLink.update({
      where: { id: link!.id },
      data: { lastReconciledAt: null },
    });
    expect(await dueRepoLinkIds(1000)).toContain(link!.id);

    const manual = await request(app)
      .post(`${url(ctx.projectId)}/reconcile`)
      .set(as(ctx.owner))
      .send({});
    expect(manual.status).toBeLessThan(300);
  });

  it('brings back an installation that was marked removed', async () => {
    await prisma.githubInstallation.deleteMany();
    await prisma.githubInstallation.create({
      data: {
        id: 3301n,
        accountLogin: 'acme-labs',
        accountType: 'Organization',
        removedAt: new Date(),
      },
    });
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    await request(app).post(url(ctx.projectId)).set(as(ctx.owner)).send({ repo: WIDGET });
    expect(
      (await prisma.githubInstallation.findUniqueOrThrow({ where: { id: 3301n } })).removedAt,
    ).toBeNull();
  });

  it('lets a team ADMIN who is only an org member link', async () => {
    await connectAccount(teamAdmin, [WIDGET], [WIDGET]);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(teamAdmin))
      .send({ repo: WIDGET });
    expect(res.status).toBeLessThan(300);
  });

  it('turns a team MEMBER away before any call to GitHub', async () => {
    await connectAccount(teamMember, [WIDGET], [WIDGET]);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(teamMember))
      .send({ repo: WIDGET });
    expect(res.status).toBe(403);
    expect(fake.requests).toEqual([]);
    expect(await prisma.githubRepoLink.count()).toBe(0);
  });

  it('answers 409 GITHUB_NOT_CONNECTED without a connected account', async () => {
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: WIDGET });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_NOT_CONNECTED');
    expect(fake.requests).toEqual([]);
  });

  it('answers 403 GITHUB_NOT_REPO_ADMIN when the person is no admin of the repository', async () => {
    await connectAccount(ctx.owner, [WIDGET], []);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: WIDGET });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GITHUB_NOT_REPO_ADMIN');
    expect(res.body.error.message).toBe(`Linking needs admin rights on ${WIDGET} on GitHub`);
    expect(await prisma.githubRepoLink.count()).toBe(0);
  });

  it('answers 409 GITHUB_APP_NOT_INSTALLED for a public repository without the App', async () => {
    fake.removeInstallation(3301);
    fake.setPublicRepos([WIDGET]);
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: WIDGET });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_APP_NOT_INSTALLED');
    expect(res.body.error.details.installUrl).toBe(
      'https://github.com/apps/acme-axiom/installations/new',
    );
    expect(await prisma.githubRepoLink.count()).toBe(0);
  });

  it('answers one 409 GITHUB_REPO_UNREACHABLE for a private repository without the App', async () => {
    fake.removeInstallation(3301);
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: WIDGET });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_REPO_UNREACHABLE');
    expect(res.body.error.message).toBe(
      `${WIDGET} was not found, you have no access to it, or the GitHub App is not installed on it`,
    );
    expect(res.body.error.details.installUrl).toBe(
      'https://github.com/apps/acme-axiom/installations/new',
    );
    // No App lookup after the user's 404: it would tell a stranger the repository exists
    expect(fake.requests.map((r) => r.headers.authorization)).toEqual([
      expect.stringMatching(/^user:/),
    ]);
  });

  it('answers the same GITHUB_REPO_UNREACHABLE for a repository that does not exist', async () => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: 'acme-labs/nothing' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_REPO_UNREACHABLE');
  });

  it('refuses a suspended installation with 409 GITHUB_APP_SUSPENDED', async () => {
    fake.suspendInstallation(3301);
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: WIDGET });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_APP_SUSPENDED');
    expect(res.body.error.message).toBe('The GitHub App installation for acme-labs is suspended');
    expect(await prisma.githubRepoLink.count()).toBe(0);
  });

  it('checks that the project is linked before any call to GitHub', async () => {
    await connectAccount(ctx.owner, [WIDGET, GADGET], [WIDGET, GADGET]);
    await request(app).post(url(ctx.projectId)).set(as(ctx.owner)).send({ repo: WIDGET });
    fake.requests.length = 0;
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: GADGET });
    expect(res.body.error.code).toBe('GITHUB_PROJECT_LINKED');
    expect(fake.requests).toEqual([]);
  });

  it('lets one of two parallel links win and refuses the other', async () => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const [a, b] = await Promise.all([
      request(app).post(url(ctx.projectId)).set(as(ctx.owner)).send({ repo: WIDGET }),
      request(app).post(url(other.id)).set(as(ctx.owner)).send({ repo: WIDGET }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.code).toBe('GITHUB_REPO_LINKED');
    expect(await prisma.githubRepoLink.count()).toBe(1);
  });

  it.each([
    ['the repository', 'GITHUB_REPO_LINKED'],
    ['the project', 'GITHUB_PROJECT_LINKED'],
  ])('names the constraint a lost race hit: %s', async (which, code) => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    // The row that wins lands after both pre-checks have looked
    const winner =
      which === 'the repository'
        ? { projectId: other.id, repoId: 7301n, fullName: WIDGET }
        : { projectId: ctx.projectId, repoId: 7999n, fullName: GADGET };
    await prisma.githubRepoLink.create({
      data: {
        ...winner,
        installationId: 3301n,
        owner: 'acme-labs',
        name: winner.fullName.split('/')[1],
        defaultBranch: 'main',
        htmlUrl: `https://github.com/${winner.fullName}`,
        linkedById: ctx.owner.id,
      },
    });
    const real = prisma.githubRepoLink.findUnique.bind(prisma.githubRepoLink);
    let calls = 0;
    const spy = vi
      .spyOn(prisma.githubRepoLink, 'findUnique')
      .mockImplementation(((args: never) =>
        ++calls <= 2 ? Promise.resolve(null) : real(args)) as never);
    try {
      const res = await request(app)
        .post(url(ctx.projectId))
        .set(as(ctx.owner))
        .send({ repo: WIDGET });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe(code);
      // Both pre-checks and the re-query ran, and both GitHub calls were made: the insert raced
      expect(spy).toHaveBeenCalledTimes(3);
      expect(fake.requests.map((r) => r.headers.authorization)).toEqual([
        expect.stringMatching(/^user:/),
        'app',
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it('answers 409 GITHUB_REPO_LINKED for a repository of another project, naming none', async () => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    await request(app).post(url(other.id)).set(as(ctx.owner)).send({ repo: WIDGET });
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: WIDGET });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_REPO_LINKED');
    expect(res.body.error.message).toBe('This repository is linked to another project');
    expect(JSON.stringify(res.body)).not.toContain('Second project');
    expect(JSON.stringify(res.body)).not.toContain(other.id);
  });

  it('answers 409 GITHUB_PROJECT_LINKED for a second repository on one project', async () => {
    await connectAccount(ctx.owner, [WIDGET, GADGET], [WIDGET, GADGET]);
    const first = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: WIDGET });
    expect(first.status).toBeLessThan(300);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: GADGET });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('GITHUB_PROJECT_LINKED');
    expect((await findRepoLinkByProject(ctx.projectId))?.fullName).toBe(WIDGET);
  });

  it('rejects a repository that is no owner/name', async () => {
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(as(ctx.owner))
      .send({ repo: 'https://github.com/acme-labs/widget' });
    expect(res.status).toBe(400);
    expect(fake.requests).toEqual([]);
  });

  it('holds a token call for approval and links nothing', async () => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const raw = await apiToken(ctx.owner.id, ['github:write']);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set({ ...CSRF, Authorization: `Token ${raw}` })
      .send({ repo: WIDGET });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.preview).toBe(
      `Link GitHub repository ${WIDGET} to project ${ctx.projectPrefix} "Test Project ghrl": everyone who can read the project will see its pull requests, reviews and CI logs`,
    );
    expect(await prisma.githubRepoLink.count()).toBe(0);
    expect(fake.requests).toEqual([]);
  });
});

describe('githubRepo.link by a token', () => {
  const tokenHeaders = (raw: string) => ({ ...CSRF, Authorization: `Token ${raw}` });
  const approve = (id: string) =>
    request(app).post(`/api/agent-approvals/${id}/approve`).set(as(ctx.owner));

  it('is refused with 403, not held, for a token of a team MEMBER', async () => {
    await connectAccount(teamMember, [WIDGET], [WIDGET]);
    const raw = await apiToken(teamMember.id, ['github:write']);
    const res = await request(app)
      .post(url(ctx.projectId))
      .set(tokenHeaders(raw))
      .send({ repo: WIDGET });
    expect(res.status).toBe(403);
    expect(fake.requests).toEqual([]);
  });

  it('links when approved, as the requester', async () => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const raw = await apiToken(ctx.owner.id, ['github:write']);
    const held = await request(app)
      .post(url(ctx.projectId))
      .set(tokenHeaders(raw))
      .send({ repo: WIDGET });
    expect(held.status).toBe(202);
    const res = await approve(held.body.approvalId);
    expect(res.status).toBeLessThan(300);
    const link = await findRepoLinkByProject(ctx.projectId);
    expect(link).toMatchObject({ fullName: WIDGET, linkedById: ctx.owner.id });
  });

  it('checks GitHub admin rights again at approval time', async () => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    const raw = await apiToken(ctx.owner.id, ['github:write']);
    const held = await request(app)
      .post(url(ctx.projectId))
      .set(tokenHeaders(raw))
      .send({ repo: WIDGET });
    expect(held.status).toBe(202);
    // The person loses admin rights on GitHub while the call waits
    await prisma.githubAccount.deleteMany();
    await connectAccount(ctx.owner, [WIDGET], []);
    const res = await approve(held.body.approvalId);
    expect(JSON.stringify(res.body)).toContain('GITHUB_NOT_REPO_ADMIN');
    expect(await prisma.githubRepoLink.count()).toBe(0);
  });
});

describe('githubRepo.get', () => {
  it('answers null when nothing is linked, and the link to a VIEWER', async () => {
    const empty = await request(app).get(url(ctx.projectId)).set(as(viewer));
    expect(empty.status).toBe(200);
    expect(empty.body).toBeNull();

    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    await request(app).post(url(ctx.projectId)).set(as(ctx.owner)).send({ repo: WIDGET });
    const res = await request(app).get(url(ctx.projectId)).set(as(viewer));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      repoFullName: WIDGET,
      htmlUrl: 'https://github.com/acme-labs/widget',
      defaultBranch: 'main',
    });
    expect(res.body.linkedBy.id).toBe(ctx.owner.id);
    expect(typeof res.body.createdAt).toBe('string');
    expect(res.body.linkedIssueCount).toBe(0);

    const link = await prisma.githubRepoLink.findFirstOrThrow({
      where: { projectId: ctx.projectId },
    });
    const issue = await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'One',
        body: '',
        creatorId: ctx.owner.id,
      },
    });
    await prisma.githubIssueLink.create({
      data: {
        issueId: issue.id,
        repoLinkId: link.id,
        targetType: 'BRANCH',
        targetKey: 'b1',
        sources: [],
      },
    });
    await prisma.githubIssueLink.create({
      data: {
        issueId: issue.id,
        repoLinkId: link.id,
        targetType: 'BRANCH',
        targetKey: 'b2',
        sources: [],
      },
    });
    const counted = await request(app).get(url(ctx.projectId)).set(as(viewer));
    // Distinct issues, not links
    expect(counted.body.linkedIssueCount).toBe(1);
  });

  it('is closed to someone outside the team', async () => {
    const res = await request(app).get(url(ctx.projectId)).set(as(outsider));
    expect(res.status).toBe(403);
  });
});

describe('githubRepo.unlink', () => {
  it('deletes the link, and the repository can be linked to another project', async () => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    await request(app).post(url(ctx.projectId)).set(as(ctx.owner)).send({ repo: WIDGET });
    const res = await request(app).delete(url(ctx.projectId)).set(as(ctx.owner));
    expect(res.status).toBeLessThan(300);
    expect(await prisma.githubRepoLink.count({ where: { projectId: ctx.projectId } })).toBe(0);

    const again = await request(app).post(url(other.id)).set(as(ctx.owner)).send({ repo: WIDGET });
    expect(again.status).toBeLessThan(300);
    expect(await prisma.githubRepoLink.count()).toBe(1);
    expect(await findRepoLinkByProject(ctx.projectId)).toBeNull();
  });

  it('turns a team MEMBER away', async () => {
    const res = await request(app).delete(url(ctx.projectId)).set(as(teamMember));
    expect(res.status).toBe(403);
  });

  it('holds a token call for approval with a preview, and keeps the link', async () => {
    await connectAccount(ctx.owner, [WIDGET], [WIDGET]);
    await request(app).post(url(ctx.projectId)).set(as(ctx.owner)).send({ repo: WIDGET });
    const raw = await apiToken(ctx.owner.id, ['github:write']);
    const res = await request(app)
      .delete(url(ctx.projectId))
      .set({ ...CSRF, Authorization: `Token ${raw}` });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe('pending_approval');
    expect(res.body.preview).toBe(
      `Unlink ${WIDGET} from project ${ctx.projectPrefix} "Test Project ghrl": its branches, pull requests and checks disappear from 0 issues`,
    );
    expect(await prisma.githubRepoLink.count({ where: { projectId: ctx.projectId } })).toBe(1);
  });
});
