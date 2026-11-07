/**
 * Demo GitHub data for one project, so the Development panel and the GitHub settings show in dev
 * and e2e without GitHub: a linked repository `acme-labs/widget` with one pull request, one
 * review and one failed check with a short log. Reads need no GitHub App. Idempotent: every row
 * is an upsert on its natural key. All names are invented.
 */
import type { PrismaClient } from '@prisma/client';

const REPO = { owner: 'acme-labs', name: 'widget' } as const;
// `.invalid` never resolves: the demo points at no real account
const HTML_URL = `https://github.invalid/${REPO.owner}/${REPO.name}`;
// Negative ids: GitHub issues positive ones only, so a real delivery can never land in the demo
const DEMO_REPO_ID = -910000001n;
const DEMO_INSTALLATION_ID = -910000002n;
// The ids the demo used before it went negative; such a link is brought over
const LEGACY_DEMO_REPO_ID = 910000001n;
const HEAD_SHA = '3f2a9c71d0b84e56a1c7e2f09b8d4a6c5e1f7b30';
const BRANCH = 'feature/widget-cache';

const LOG_TAIL = [
  'FAIL src/widget-cache.test.ts',
  '  widget cache > returns the stored widget after a restart',
  '    expected 2 widgets, got 3',
  'Test Files  1 failed (1)',
].join('\n');

/**
 * Links a project to the demo repository and attaches a branch, a pull request, a review and a
 * failed check to one of its issues.
 * @param prisma - A client on the database to seed.
 * @param ids - The project, one of its issues, and the user who "linked" it.
 * @param ids.projectId - The project to link.
 * @param ids.issueId - The issue the branch and pull request name.
 * @param ids.linkedById - The user shown as the one who linked the repository.
 * @returns `skipped` when the project is linked to some other repository, else `seeded`.
 */
export async function seedGithubDemo(
  prisma: PrismaClient,
  ids: { projectId: string; issueId: string; linkedById: string },
): Promise<'seeded' | 'skipped'> {
  const now = new Date();
  const existing = await prisma.githubRepoLink.findUnique({ where: { projectId: ids.projectId } });
  if (existing && existing.repoId === LEGACY_DEMO_REPO_ID) {
    await prisma.githubRepoLink.update({
      where: { id: existing.id },
      data: { repoId: DEMO_REPO_ID, installationId: DEMO_INSTALLATION_ID },
    });
    existing.repoId = DEMO_REPO_ID;
  }
  if (existing && existing.repoId !== DEMO_REPO_ID) {
    console.warn(`        GitHub: project is linked to ${existing.fullName}, demo data skipped`);
    return 'skipped';
  }
  // An existing demo link keeps its reconcile fields; only the invented URLs are brought up to date
  const link = await prisma.githubRepoLink.upsert({
    where: { projectId: ids.projectId },
    update: { htmlUrl: HTML_URL },
    create: {
      projectId: ids.projectId,
      repoId: DEMO_REPO_ID,
      installationId: DEMO_INSTALLATION_ID,
      owner: REPO.owner,
      name: REPO.name,
      fullName: `${REPO.owner}/${REPO.name}`,
      defaultBranch: 'main',
      htmlUrl: HTML_URL,
      linkedById: ids.linkedById,
      lastDeliveryAt: now,
      lastReconciledAt: now,
    },
  });

  const branch = await prisma.githubBranch.upsert({
    where: { repoLinkId_name: { repoLinkId: link.id, name: BRANCH } },
    update: {},
    create: { repoLinkId: link.id, name: BRANCH, headSha: HEAD_SHA, lastPushedAt: now },
  });

  const pr = await prisma.githubPullRequest.upsert({
    where: { repoLinkId_number: { repoLinkId: link.id, number: 42 } },
    update: { htmlUrl: `${HTML_URL}/pull/42` },
    create: {
      repoLinkId: link.id,
      number: 42,
      title: 'Add a cache for stored widgets',
      state: 'OPEN',
      draft: false,
      authorLogin: 'mira-dev',
      headRef: BRANCH,
      headSha: HEAD_SHA,
      baseRef: 'main',
      mergeableState: 'clean',
      requestedReviewers: [{ login: 'sam-reviews' }],
      htmlUrl: `${HTML_URL}/pull/42`,
      openedAt: now,
      githubUpdatedAt: now,
    },
  });

  await prisma.githubReview.upsert({
    where: { id: '910000101' },
    update: {},
    create: {
      id: '910000101',
      pullRequestId: pr.id,
      authorLogin: 'jo-rev',
      state: 'changes_requested',
      body: 'Please cover the empty cache case.',
      commitSha: HEAD_SHA,
      submittedAt: now,
    },
  });

  await prisma.githubCheckRun.upsert({
    where: { id: '910000201' },
    update: { htmlUrl: `${HTML_URL}/actions/runs/910000301/job/910000201` },
    create: {
      id: '910000201',
      repoLinkId: link.id,
      headSha: HEAD_SHA,
      name: 'build',
      appSlug: 'github-actions',
      workflowRunId: '910000301',
      status: 'completed',
      conclusion: 'failure',
      htmlUrl: `${HTML_URL}/actions/runs/910000301/job/910000201`,
      startedAt: now,
      completedAt: now,
      failedStep: 'Run unit tests',
      logTail: LOG_TAIL,
      logTruncated: true,
      githubUpdatedAt: now,
    },
  });

  for (const [targetType, targetKey, sources] of [
    ['BRANCH', branch.id, ['BRANCH_NAME']],
    ['PULL_REQUEST', pr.id, ['PR_TITLE']],
  ] as const) {
    await prisma.githubIssueLink.upsert({
      where: { issueId_targetType_targetKey: { issueId: ids.issueId, targetType, targetKey } },
      update: {},
      create: {
        issueId: ids.issueId,
        repoLinkId: link.id,
        targetType,
        targetKey,
        sources: [...sources],
      },
    });
  }
  return 'seeded';
}
