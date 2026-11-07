import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedGithubDemo } from '../../scripts/seed-github-demo';
import { prisma } from '../config/database';
import { cleanupTestContext, createTestContext, type TestContext } from '../test/factory';

let ctx: TestContext;
let issueId: string;

beforeAll(async () => {
  ctx = await createTestContext('seedgh');
  issueId = (
    await prisma.issue.create({
      data: {
        projectId: ctx.projectId,
        number: 1,
        title: 'One',
        body: '',
        creatorId: ctx.owner.id,
      },
    })
  ).id;
});

afterAll(async () => {
  await cleanupTestContext(ctx);
});

const ids = () => ({ projectId: ctx.projectId, issueId, linkedById: ctx.owner.id });

describe('seedGithubDemo', () => {
  it('leaves a project linked to another repository alone', async () => {
    const reconciledAt = new Date('2026-11-01T10:00:00Z');
    const real = await prisma.githubRepoLink.create({
      data: {
        projectId: ctx.projectId,
        repoId: 123456n,
        installationId: 77n,
        owner: 'someone',
        name: 'else',
        fullName: 'someone/else',
        defaultBranch: 'main',
        htmlUrl: 'https://github.com/someone/else',
        linkedById: ctx.owner.id,
        lastReconciledAt: reconciledAt,
        lastReconcileError: 'real trouble',
      },
    });

    expect(await seedGithubDemo(prisma, ids())).toBe('skipped');

    const after = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: real.id } });
    expect(after.lastReconciledAt).toEqual(reconciledAt);
    expect(after.lastReconcileError).toBe('real trouble');
    expect(await prisma.githubPullRequest.count({ where: { repoLinkId: real.id } })).toBe(0);
    expect(await prisma.githubIssueLink.count({ where: { repoLinkId: real.id } })).toBe(0);
    await prisma.githubRepoLink.delete({ where: { id: real.id } });
  });

  it('seeds the demo repository with invented hrefs, twice without change', async () => {
    expect(await seedGithubDemo(prisma, ids())).toBe('seeded');
    const link = await prisma.githubRepoLink.findUniqueOrThrow({
      where: { projectId: ctx.projectId },
    });
    // Ids GitHub can never issue, so a real delivery never lands in the demo project
    expect(link.repoId < 0n).toBe(true);
    expect(link.installationId < 0n).toBe(true);
    // Reconcile fields of an existing link stay as they are on a re-run
    const marker = new Date('2026-11-02T10:00:00Z');
    await prisma.githubRepoLink.update({
      where: { id: link.id },
      data: { lastReconciledAt: marker, lastReconcileError: 'kept' },
    });

    expect(await seedGithubDemo(prisma, ids())).toBe('seeded');

    const again = await prisma.githubRepoLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(again.lastReconciledAt).toEqual(marker);
    expect(again.lastReconcileError).toBe('kept');
    expect(await prisma.githubPullRequest.count({ where: { repoLinkId: link.id } })).toBe(1);
    expect(
      await prisma.githubReview.count({ where: { pullRequest: { repoLinkId: link.id } } }),
    ).toBe(1);
    expect(await prisma.githubCheckRun.count({ where: { repoLinkId: link.id } })).toBe(1);
    expect(await prisma.githubIssueLink.count({ where: { repoLinkId: link.id } })).toBe(2);

    const urls = [
      link.htmlUrl,
      ...(await prisma.githubPullRequest.findMany({ where: { repoLinkId: link.id } })).map(
        (p) => p.htmlUrl,
      ),
      ...(await prisma.githubCheckRun.findMany({ where: { repoLinkId: link.id } })).map(
        (c) => c.htmlUrl,
      ),
    ];
    for (const url of urls) expect(url).toMatch(/^https:\/\/github\.invalid\/acme-labs\/widget/);
  });

  it('brings a demo link with the old positive ids over to the negative ones', async () => {
    await prisma.githubRepoLink.update({
      where: { projectId: ctx.projectId },
      data: { repoId: 910000001n, installationId: 910000002n },
    });

    expect(await seedGithubDemo(prisma, ids())).toBe('seeded');

    const link = await prisma.githubRepoLink.findUniqueOrThrow({
      where: { projectId: ctx.projectId },
    });
    expect(link.repoId).toBe(-910000001n);
    expect(link.installationId).toBe(-910000002n);
  });
});
