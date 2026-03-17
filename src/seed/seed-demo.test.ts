import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('seed-demo', () => {
  beforeAll(() => {
    execSync('npx tsx scripts/seed-demo.ts', {
      cwd: '/root/axiom',
      stdio: 'pipe',
      timeout: 60_000,
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Users ──────────────────────────────────────────────────

  it('creates 5 users', async () => {
    const users = await prisma.user.findMany({
      where: {
        username: {
          in: ['admin', 'sarah-chen', 'marcus-kim', 'anika-patel', 'alex-rivera'],
        },
      },
    });
    expect(users).toHaveLength(5);
  });

  // ── Organization ───────────────────────────────────────────

  it('creates the Axiom organization', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'axiom' } });
    expect(org).toBeTruthy();
    expect(org!.name).toBe('Axiom');
  });

  it('creates org memberships for all users', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'axiom' } });
    const memberships = await prisma.orgMembership.findMany({ where: { orgId: org!.id } });
    expect(memberships).toHaveLength(5);
  });

  // ── Teams ──────────────────────────────────────────────────

  it('creates 3 teams with correct slugs', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'axiom' } });
    const teams = await prisma.team.findMany({ where: { orgId: org!.id } });
    expect(teams).toHaveLength(3);
    expect(teams.map((t) => t.slug).sort()).toEqual(['core', 'frontend', 'infra']);
  });

  // ── Projects ───────────────────────────────────────────────

  it('creates 5 projects with board columns', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'axiom' } });
    const teams = await prisma.team.findMany({ where: { orgId: org!.id } });
    const projects = await prisma.project.findMany({
      where: { teamId: { in: teams.map((t) => t.id) } },
    });
    expect(projects).toHaveLength(5);

    // Each project should have 5 board columns
    for (const project of projects) {
      const columns = await prisma.boardColumn.findMany({ where: { projectId: project.id } });
      expect(columns).toHaveLength(5);
    }
  });

  it('creates labels for every project', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'axiom' } });
    const teams = await prisma.team.findMany({ where: { orgId: org!.id } });
    const projects = await prisma.project.findMany({
      where: { teamId: { in: teams.map((t) => t.id) } },
    });

    for (const project of projects) {
      const labels = await prisma.label.findMany({ where: { projectId: project.id } });
      expect(labels.length).toBeGreaterThanOrEqual(6);
    }
  });

  // ── Issues ─────────────────────────────────────────────────

  it('creates 43 issues across projects', async () => {
    const issueCount = await prisma.issue.count();
    expect(issueCount).toBeGreaterThanOrEqual(43);
  });

  // ── Comments ───────────────────────────────────────────────

  it('creates comments on issues', async () => {
    const commentCount = await prisma.comment.count();
    // 10 comment-seed groups totalling 19 individual comments
    expect(commentCount).toBeGreaterThanOrEqual(19);
  });

  // ── Wiki ───────────────────────────────────────────────────

  it('creates 3 wiki spaces', async () => {
    const spaces = await prisma.wikiSpace.count();
    expect(spaces).toBeGreaterThanOrEqual(3);
  });

  it('creates 9 wiki pages', async () => {
    const pages = await prisma.page.count();
    expect(pages).toBeGreaterThanOrEqual(9);
  });

  it('creates page versions for every page', async () => {
    const pages = await prisma.page.findMany();
    for (const page of pages) {
      const versions = await prisma.pageVersion.findMany({ where: { pageId: page.id } });
      expect(versions.length).toBeGreaterThanOrEqual(1);
    }
  });

  // ── Repositories ───────────────────────────────────────────

  it('creates 3 repositories', async () => {
    const repos = await prisma.repository.count();
    expect(repos).toBeGreaterThanOrEqual(3);
  });

  // ── Pull Requests ──────────────────────────────────────────

  it('creates 4 pull requests', async () => {
    const prs = await prisma.pullRequest.count();
    expect(prs).toBeGreaterThanOrEqual(4);
  });

  it('creates PR reviews', async () => {
    const reviews = await prisma.pRReview.count();
    // 2+1+2+1 = 6 reviews
    expect(reviews).toBeGreaterThanOrEqual(6);
  });

  it('creates PR comments', async () => {
    const comments = await prisma.pRComment.count();
    // 3+2+2+2 = 9 PR comments
    expect(comments).toBeGreaterThanOrEqual(9);
  });

  // ── Idempotency ────────────────────────────────────────────

  it('is idempotent on re-run', async () => {
    const beforeUsers = await prisma.user.count();
    const beforeIssues = await prisma.issue.count();
    const beforeComments = await prisma.comment.count();
    const beforePRs = await prisma.pullRequest.count();

    execSync('npx tsx scripts/seed-demo.ts', {
      cwd: '/root/axiom',
      stdio: 'pipe',
      timeout: 60_000,
    });

    const afterUsers = await prisma.user.count();
    const afterIssues = await prisma.issue.count();
    const afterComments = await prisma.comment.count();
    const afterPRs = await prisma.pullRequest.count();

    expect(afterUsers).toBe(beforeUsers);
    expect(afterIssues).toBe(beforeIssues);
    expect(afterComments).toBe(beforeComments);
    expect(afterPRs).toBe(beforePRs);
  }, 120_000);
});
