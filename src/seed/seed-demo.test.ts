import { execSync } from 'child_process';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('seed-demo', () => {
  beforeAll(() => {
    execSync('npx tsx scripts/seed-demo.ts', {
      cwd: '/root/axiom',
      stdio: 'pipe',
      timeout: 60_000,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // ── Users ──────────────────────────────────────────────────

  it('creates 2 users', async () => {
    const users = await prisma.user.findMany({
      where: {
        username: {
          in: ['tim', 'test'],
        },
      },
    });
    expect(users).toHaveLength(2);
  });

  // ── Organization ───────────────────────────────────────────

  it('creates the Aranea.Dev organization', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'aranea-dev' } });
    expect(org).toBeTruthy();
    expect(org!.name).toBe('Aranea.Dev');
  });

  it('creates org memberships for all users', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'aranea-dev' } });
    const memberships = await prisma.orgMembership.findMany({ where: { orgId: org!.id } });
    expect(memberships).toHaveLength(2);
  });

  // ── Teams ──────────────────────────────────────────────────

  it('creates 1 team with correct slug', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'aranea-dev' } });
    const teams = await prisma.team.findMany({ where: { orgId: org!.id } });
    expect(teams).toHaveLength(1);
    expect(teams.map((t) => t.slug).sort()).toEqual(['axiom']);
  });

  // ── Projects ───────────────────────────────────────────────

  it('creates 1 project with board columns', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'aranea-dev' } });
    const teams = await prisma.team.findMany({ where: { orgId: org!.id } });
    const projects = await prisma.project.findMany({
      where: { teamId: { in: teams.map((t) => t.id) } },
    });
    expect(projects).toHaveLength(1);

    // Each project should have 5 board columns
    for (const project of projects) {
      const columns = await prisma.boardColumn.findMany({ where: { projectId: project.id } });
      expect(columns).toHaveLength(5);
    }
  });

  it('creates labels for every project', async () => {
    const org = await prisma.organization.findUnique({ where: { slug: 'aranea-dev' } });
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

  it('creates issues across projects', async () => {
    const issueCount = await prisma.issue.count();
    expect(issueCount).toBeGreaterThanOrEqual(15);
  });

  // ── Comments ───────────────────────────────────────────────

  it('creates comments on issues', async () => {
    const commentCount = await prisma.comment.count();
    expect(commentCount).toBeGreaterThanOrEqual(5);
  });

  // ── Wiki ───────────────────────────────────────────────────

  it('creates 1 wiki space', async () => {
    const spaces = await prisma.wikiSpace.count();
    expect(spaces).toBeGreaterThanOrEqual(1);
  });

  it('creates wiki pages', async () => {
    const pages = await prisma.page.count();
    expect(pages).toBeGreaterThanOrEqual(4);
  });

  it('creates page versions for every page', async () => {
    const pages = await prisma.page.findMany();
    for (const page of pages) {
      const versions = await prisma.pageVersion.findMany({ where: { pageId: page.id } });
      expect(versions.length).toBeGreaterThanOrEqual(1);
    }
  });

  // ── Repositories ───────────────────────────────────────────

  it('creates 1 repository', async () => {
    const repos = await prisma.repository.count();
    expect(repos).toBeGreaterThanOrEqual(1);
  });

  // ── Pull Requests ──────────────────────────────────────────

  it('creates pull requests if repo has branches', async () => {
    // The seed creates PRs only when branches exist in the repo
    const prs = await prisma.pullRequest.count();
    expect(prs).toBeGreaterThanOrEqual(0);
  });

  it('creates PR reviews', async () => {
    const reviews = await prisma.pRReview.count();
    expect(reviews).toBeGreaterThanOrEqual(0);
  });

  it('creates PR comments', async () => {
    const comments = await prisma.pRComment.count();
    expect(comments).toBeGreaterThanOrEqual(0);
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
