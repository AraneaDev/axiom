/**
 * Demo seed script for Axiom.
 *
 * Usage: npx tsx scripts/seed-demo.ts
 *
 * Creates a demo environment with users, org, team, project,
 * issues, comments, and a wiki space.
 *
 * Safe to run multiple times (idempotent via upserts / existence checks).
 */

import '../src/config/load-env';

import fs from 'fs';
import path from 'path';

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Helpers ────────────────────────────────────────────────────

function futureDate(daysFromNow: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.warn('Seeding demo data...\n');

  // ────────────────────────────────────────────────────────────
  // 1. Users
  // ────────────────────────────────────────────────────────────
  console.warn('  [1/10] Users');
  const passwordHash = await bcrypt.hash('password123', 12);

  const userData = [
    { username: 'tim', displayName: 'Tim Schipper', email: 'tim@aranea.dev' },
    { username: 'test', displayName: 'Test User', email: 'test@aranea.dev' },
  ] as const;

  const users: Record<string, { id: string }> = {};
  for (const u of userData) {
    const isAdmin = u.username === 'tim';
    const user = await prisma.user.upsert({
      where: { username: u.username },
      update: { isAdmin },
      create: { ...u, passwordHash, isAdmin },
    });
    users[u.username] = user;
    console.warn(`        ${u.displayName} (${u.email})`);
  }

  // ────────────────────────────────────────────────────────────
  // 2. Organization + memberships
  // ────────────────────────────────────────────────────────────
  console.warn('  [2/10] Organization');
  const org = await prisma.organization.upsert({
    where: { slug: 'aranea-dev' },
    update: {},
    create: {
      name: 'Aranea.Dev',
      slug: 'aranea-dev',
      description: 'Building tools for developers',
    },
  });

  const orgRoles: Record<string, 'OWNER' | 'MEMBER'> = {
    tim: 'OWNER',
    test: 'MEMBER',
  };

  for (const [username, role] of Object.entries(orgRoles)) {
    await prisma.orgMembership.upsert({
      where: { userId_orgId: { userId: users[username].id, orgId: org.id } },
      update: { role },
      create: { userId: users[username].id, orgId: org.id, role },
    });
  }
  console.warn(`        Aranea.Dev (${Object.keys(orgRoles).length} members)`);

  // ────────────────────────────────────────────────────────────
  // 3. Team + memberships
  // ────────────────────────────────────────────────────────────
  console.warn('  [3/10] Team');

  const team = await prisma.team.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'axiom' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'Axiom',
      slug: 'axiom',
      description: 'Axiom platform development',
    },
  });

  const teamRoles: Record<string, 'ADMIN' | 'MEMBER'> = {
    tim: 'ADMIN',
    test: 'MEMBER',
  };

  for (const [username, role] of Object.entries(teamRoles)) {
    await prisma.teamMembership.upsert({
      where: { userId_teamId: { userId: users[username].id, teamId: team.id } },
      update: { role },
      create: { userId: users[username].id, teamId: team.id, role },
    });
  }
  console.warn(`        Axiom (${Object.keys(teamRoles).length} members)`);

  // ────────────────────────────────────────────────────────────
  // 4. Project + board columns + labels
  // ────────────────────────────────────────────────────────────
  console.warn('  [4/10] Project');

  const columnDefs = [
    { name: 'Backlog', position: 0, isDefault: true, isDone: false },
    { name: 'Todo', position: 1, isDefault: false, isDone: false },
    { name: 'In Progress', position: 2, isDefault: false, isDone: false },
    { name: 'Review', position: 3, isDefault: false, isDone: false },
    { name: 'Done', position: 4, isDefault: false, isDone: true },
  ];

  const labelDefs = [
    { name: 'frontend', color: '#6366f1' },
    { name: 'backend', color: '#10b981' },
    { name: 'urgent', color: '#ef4444' },
    { name: 'docs', color: '#f59e0b' },
    { name: 'bug', color: '#dc2626' },
    { name: 'enhancement', color: '#8b5cf6' },
  ];

  const existing = await prisma.project.findUnique({
    where: { teamId_slug: { teamId: team.id, slug: 'axiom-mvp' } },
  });

  let project: { id: string };
  if (existing) {
    project = existing;
  } else {
    project = await prisma.project.create({
      data: {
        teamId: team.id,
        name: 'Axiom MVP',
        slug: 'axiom-mvp',
        prefix: 'AXM',
        description: 'Axiom minimum viable product - project management and documentation',
        columns: { createMany: { data: columnDefs } },
      },
    });
  }

  const cols = await prisma.boardColumn.findMany({ where: { projectId: project.id } });
  const columns: Record<string, string> = {};
  for (const c of cols) columns[c.name] = c.id;

  const labels: Record<string, string> = {};
  for (const ld of labelDefs) {
    const label = await prisma.label.upsert({
      where: { projectId_name: { projectId: project.id, name: ld.name } },
      update: { color: ld.color },
      create: { projectId: project.id, name: ld.name, color: ld.color },
    });
    labels[ld.name] = label.id;
  }
  console.warn(`        Axiom MVP (AXM)`);

  // ────────────────────────────────────────────────────────────
  // 5. Issues
  // ────────────────────────────────────────────────────────────
  console.warn('  [5/10] Issues');

  type IssueSeed = {
    title: string;
    body: string;
    type: 'TASK' | 'BUG' | 'STORY' | 'EPIC';
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    column: string;
    assignee?: string;
    creator: string;
    dueDate?: Date;
    labels?: string[];
  };

  const issues: IssueSeed[] = [
    { title: 'Repository file browser shows empty for folders', body: 'Navigating to a subfolder in the file browser shows nothing. The `git ls-tree` call returns the tree entry itself instead of its contents because the trailing slash is missing from the path.', type: 'BUG', priority: 'CRITICAL', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['backend', 'bug'] },
    { title: 'File view renders blank page', body: 'Opening a file in the repo viewer shows a blank page with no error. The blob query fails silently and the component has no error state or empty state fallback.', type: 'BUG', priority: 'HIGH', column: 'Done', assignee: 'tim', creator: 'test', labels: ['frontend', 'bug'] },
    { title: 'Breadcrumb crash on bare /blob route', body: 'Navigating to `/:org/:team/repos/:repo/blob` without ref/path params causes a crash. FileView needs to guard missing params and redirect.', type: 'BUG', priority: 'HIGH', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['frontend', 'bug'] },
    { title: 'Add commit detail view', body: 'Commits in the repo detail page are static divs with no click action. Need a CommitDetail page that shows metadata, diff, and file stats. Backend API already exists.', type: 'STORY', priority: 'HIGH', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['frontend', 'enhancement'] },
    { title: 'README rendering on repo landing page', body: 'Detect README.md in the tree listing, fetch its blob content, and render it with MarkdownRenderer below the file tree on the repo landing page.', type: 'TASK', priority: 'MEDIUM', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['frontend'] },
    { title: 'Clone URL display with copy button', body: 'Add a "Clone" dropdown to the repo header showing the HTTPS clone URL with a copy-to-clipboard button.', type: 'TASK', priority: 'MEDIUM', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['frontend'] },
    { title: 'Blame view for files', body: 'New page showing file content with blame annotations (author, date, SHA) in a left gutter. Link from the file view with a "Blame" button.', type: 'STORY', priority: 'MEDIUM', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['frontend', 'enhancement'] },
    { title: 'File history view', body: 'Show commit log filtered to a single file path. Add a "History" button to the file view. Backend needs a path filter on the commits endpoint.', type: 'STORY', priority: 'MEDIUM', column: 'Done', assignee: 'tim', creator: 'test', labels: ['frontend', 'backend'] },
    { title: 'Branch comparison view', body: 'New page with two branch selectors showing commit differences between branches. Route: `/:org/:team/repos/:repo/compare`.', type: 'STORY', priority: 'MEDIUM', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['frontend', 'enhancement'] },
    { title: 'Repository settings page', body: 'Settings page for editing repo name, description, visibility, and default branch. Includes danger zone with delete confirmation.', type: 'TASK', priority: 'MEDIUM', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['frontend'] },
    { title: 'Fix TypeScript OOM during backend typecheck', body: 'The `@modelcontextprotocol/sdk` package causes tsc to resolve 430+ files consuming 4GB+ memory. Exclude src/mcp/ from tsconfig and use runtime require() for the MCP import. See: https://github.com/modelcontextprotocol/typescript-sdk/issues/985', type: 'BUG', priority: 'CRITICAL', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['backend', 'bug', 'urgent'] },
    { title: 'Shared useRepoContext hook', body: 'Extract the org->team->repo cascading query pattern duplicated across every repo page into a shared hook at `hooks/useRepoContext.ts`.', type: 'TASK', priority: 'LOW', column: 'Done', assignee: 'tim', creator: 'tim', labels: ['frontend', 'enhancement'] },
    { title: 'Dark mode support', body: 'Add dark mode theme toggle. The CSS variable design token system already supports it, just needs a toggle and persistence.', type: 'TASK', priority: 'MEDIUM', column: 'In Progress', assignee: 'test', creator: 'tim', dueDate: futureDate(7), labels: ['frontend'] },
  ];

  const maxIssue = await prisma.issue.findFirst({
    where: { projectId: project.id },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  let nextNumber = (maxIssue?.number ?? 0) + 1;

  const createdIssues: { id: string; title: string }[] = [];
  let totalIssues = 0;

  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    const existingIssue = await prisma.issue.findFirst({
      where: { projectId: project.id, title: issue.title },
    });
    if (existingIssue) {
      createdIssues.push({ id: existingIssue.id, title: issue.title });
      totalIssues++;
      continue;
    }

    const labelIds = (issue.labels ?? [])
      .filter((l) => labels[l])
      .map((l) => ({ id: labels[l] }));

    const created = await prisma.issue.create({
      data: {
        projectId: project.id,
        number: nextNumber++,
        title: issue.title,
        body: issue.body,
        type: issue.type,
        priority: issue.priority,
        columnId: columns[issue.column] ?? columns['Backlog'],
        assigneeId: issue.assignee ? users[issue.assignee].id : undefined,
        creatorId: users[issue.creator].id,
        dueDate: issue.dueDate ?? null,
        position: i,
        labels: { connect: labelIds },
      },
    });
    createdIssues.push({ id: created.id, title: issue.title });
    totalIssues++;
  }
  console.warn(`        ${totalIssues} issues`);

  // ────────────────────────────────────────────────────────────
  // 6. Comments
  // ────────────────────────────────────────────────────────────
  console.warn('  [6/10] Comments');

  type CommentSeed = {
    issueTitle: string;
    comments: { author: string; body: string }[];
  };

  const commentSeeds: CommentSeed[] = [
    {
      issueTitle: 'Repository file browser shows empty for folders',
      comments: [
        { author: 'tim', body: 'Root cause found: the tree listing returns the entry *for* `frontend`, not its contents. We need to append a trailing `/` to the tree path.\n\nFix is one line in the tree listing helper.' },
        { author: 'test', body: 'Confirmed this also fixes the empty root listing edge case when no default branch exists.' },
      ],
    },
    {
      issueTitle: 'Fix TypeScript OOM during backend typecheck',
      comments: [
        { author: 'tim', body: 'Tracked this down to the MCP SDK. It causes TypeScript to resolve 430+ files (104 `.d.ts`, 9.1MB total) leading to 4GB+ memory consumption. Known issue: https://github.com/modelcontextprotocol/typescript-sdk/issues/985\n\nEven with `skipLibCheck: true`, `skipDefaultLibCheck: true`, `isolatedModules: true`, and `strict: false` it still OOMs.' },
        { author: 'tim', body: 'Fix: exclude `src/mcp/**` from `tsconfig.json` and use `require()` in `src/index.ts` for the MCP import. Only 3 files affected and they are only imported from one place.\n\nAlso fixed ~44 pre-existing type errors that were masked by the OOM:\n- `string | string[]` param issues across 7 controller files\n- implicit `any` on `.map()` callbacks\n- enum string literal mismatches' },
      ],
    },
    {
      issueTitle: 'Add commit detail view',
      comments: [
        { author: 'test', body: 'The diff parser handles the standard unified diff format well. One suggestion: could we add syntax highlighting to the diff hunks in a follow-up?' },
        { author: 'tim', body: 'Good idea. Filed as a follow-up. The current plain diff with color-coded +/- lines is functional for MVP.' },
      ],
    },
    {
      issueTitle: 'Dark mode support',
      comments: [
        { author: 'test', body: 'Working on this. The CSS variable system is already set up with semantic tokens (`--color-surface-primary`, etc.). Just need:\n\n1. A theme toggle component in the navbar\n2. `prefers-color-scheme` media query for system default\n3. Persist choice in localStorage' },
      ],
    },
  ];

  let totalComments = 0;
  for (const cs of commentSeeds) {
    const issue = createdIssues.find((i) => i.title === cs.issueTitle);
    if (!issue) continue;

    const existingCount = await prisma.comment.count({ where: { issueId: issue.id } });
    if (existingCount >= cs.comments.length) continue;

    for (const c of cs.comments.slice(existingCount)) {
      await prisma.comment.create({
        data: {
          issueId: issue.id,
          authorId: users[c.author].id,
          body: c.body,
        },
      });
      totalComments++;
    }
  }
  console.warn(`        ${totalComments} comments`);

  // ────────────────────────────────────────────────────────────
  // 7. Wiki space + pages
  // ────────────────────────────────────────────────────────────
  console.warn('  [7/10] Wiki');

  // Wiki pages are sourced entirely from docs/*.md (auto-import block below)

  const wikiSpace = await prisma.wikiSpace.upsert({
    where: { teamId_slug: { teamId: team.id, slug: 'docs' } },
    update: {},
    create: {
      teamId: team.id,
      name: 'Axiom Documentation',
      slug: 'docs',
      description: 'Platform documentation, architecture, and development guides',
    },
  });

  // Seed built-in page templates (idempotent — skips existing)
  const { seedBuiltInTemplates } = await import('../src/modules/wiki/wiki-templates.service');
  await seedBuiltInTemplates(wikiSpace.id);

  let totalPages = 0;

  // Auto-import markdown files from docs/ as wiki pages
  const docsDir = path.resolve(__dirname, '..', 'docs');
  if (fs.existsSync(docsDir)) {
    const docFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));
    for (const file of docFiles) {
      const slug = file.replace(/\.md$/, '');
      const existingPage = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId: wikiSpace.id, slug } },
      });

      const body = fs.readFileSync(path.join(docsDir, file), 'utf-8');
      // Derive title from first H1, or from filename
      const h1Match = body.match(/^#\s+(.+)$/m);
      const title = h1Match ? h1Match[1] : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      if (existingPage) {
        // Update existing page with latest content from docs/
        await prisma.page.update({
          where: { id: existingPage.id },
          data: { body, title },
        });
        totalPages++;
        continue;
      }

      const page = await prisma.page.create({
        data: {
          spaceId: wikiSpace.id,
          title,
          slug,
          body,
          position: totalPages + 1,
        },
      });

      await prisma.pageVersion.create({
        data: {
          pageId: page.id,
          title,
          body,
          version: 1,
          authorId: users.tim.id,
        },
      });
      totalPages++;
    }
  }

  // Remove wiki pages whose docs/*.md file was deleted or renamed
  if (fs.existsSync(docsDir)) {
    const docSlugs = new Set(
      fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')),
    );
    const allPages = await prisma.page.findMany({
      where: { spaceId: wikiSpace.id },
      select: { id: true, slug: true },
    });
    for (const pg of allPages) {
      if (!docSlugs.has(pg.slug)) {
        await prisma.pageVersion.deleteMany({ where: { pageId: pg.id } });
        await prisma.page.delete({ where: { id: pg.id } });
      }
    }
  }

  console.warn(`        Axiom Documentation (${totalPages} pages)`);

  // ────────────────────────────────────────────────────────────
  // 8. Sprints
  // ────────────────────────────────────────────────────────────
  console.warn('  [8/10] Sprints');

  const sprintStartDate = new Date();
  sprintStartDate.setDate(sprintStartDate.getDate() - 14);
  const sprintEndDate = new Date();
  sprintEndDate.setDate(sprintEndDate.getDate() - 1);

  const existingCompletedSprint = await prisma.sprint.findFirst({
    where: { projectId: project.id, name: 'Sprint 1' },
  });

  let completedSprint: { id: string };
  if (existingCompletedSprint) {
    completedSprint = existingCompletedSprint;
  } else {
    completedSprint = await prisma.sprint.create({
      data: {
        projectId: project.id,
        name: 'Sprint 1',
        goal: 'Complete core browsing features and fix critical bugs',
        startDate: sprintStartDate,
        endDate: sprintEndDate,
        status: 'COMPLETED',
        committedAt: sprintStartDate,
      },
    });

    // Add done issues to completed sprint and record history
    const doneIssues = createdIssues.slice(0, 10);
    for (const issue of doneIssues) {
      await prisma.issue.update({
        where: { id: issue.id },
        data: { sprintId: completedSprint.id },
      });
      await prisma.sprintIssueHistory.create({
        data: {
          sprintId: completedSprint.id,
          issueId: issue.id,
          action: 'ADDED',
          timestamp: sprintStartDate,
        },
      });
    }

    // Simulate mid-sprint scope change: one issue added late
    const lateAddIssue = createdIssues[10];
    if (lateAddIssue) {
      const midSprintDate = new Date(sprintStartDate);
      midSprintDate.setDate(midSprintDate.getDate() + 5);
      await prisma.issue.update({
        where: { id: lateAddIssue.id },
        data: { sprintId: completedSprint.id },
      });
      await prisma.sprintIssueHistory.create({
        data: {
          sprintId: completedSprint.id,
          issueId: lateAddIssue.id,
          action: 'ADDED',
          timestamp: midSprintDate,
        },
      });
    }
  }

  // Active sprint
  const activeSprintStart = new Date();
  activeSprintStart.setDate(activeSprintStart.getDate() - 3);
  const activeSprintEnd = new Date();
  activeSprintEnd.setDate(activeSprintEnd.getDate() + 11);

  const existingActiveSprint = await prisma.sprint.findFirst({
    where: { projectId: project.id, name: 'Sprint 2' },
  });

  if (!existingActiveSprint) {
    const activeSprint = await prisma.sprint.create({
      data: {
        projectId: project.id,
        name: 'Sprint 2',
        goal: 'Dark mode',
        startDate: activeSprintStart,
        endDate: activeSprintEnd,
        status: 'ACTIVE',
        committedAt: activeSprintStart,
      },
    });

    // Add some in-progress/todo issues to active sprint
    const activeIssueIndices = [12]; // Dark mode
    for (const idx of activeIssueIndices) {
      const issue = createdIssues[idx];
      if (!issue) continue;
      await prisma.issue.update({
        where: { id: issue.id },
        data: { sprintId: activeSprint.id },
      });
      await prisma.sprintIssueHistory.create({
        data: {
          sprintId: activeSprint.id,
          issueId: issue.id,
          action: 'ADDED',
          timestamp: activeSprintStart,
        },
      });
    }
    console.warn('        Sprint 1 (COMPLETED), Sprint 2 (ACTIVE)');
  } else {
    console.warn('        Sprints already exist');
  }

  // ────────────────────────────────────────────────────────────
  // 9. Board settings (WIP limits + card colors)
  // ────────────────────────────────────────────────────────────
  console.warn('  [9/10] Board settings');

  // Set WIP limits on Review and In Progress columns
  if (columns['In Progress']) {
    await prisma.boardColumn.update({
      where: { id: columns['In Progress'] },
      data: { wipLimit: 5 },
    });
  }
  if (columns['Review']) {
    await prisma.boardColumn.update({
      where: { id: columns['Review'] },
      data: { wipLimit: 3 },
    });
  }

  // Set card color by priority
  await prisma.project.update({
    where: { id: project.id },
    data: { cardColorBy: 'priority' },
  });
  console.warn('        WIP limits: In Progress=5, Review=3');
  console.warn('        Card colors: by priority');

  // ────────────────────────────────────────────────────────────
  // 10. Space permissions
  // ────────────────────────────────────────────────────────────
  console.warn('  [10/10] Space permissions');

  const existingPerm = await prisma.spacePermission.findFirst({
    where: { spaceId: wikiSpace.id },
  });

  if (!existingPerm) {
    await prisma.spacePermission.create({
      data: {
        spaceId: wikiSpace.id,
        teamRole: 'ADMIN',
        level: 'ADMIN',
      },
    });
    await prisma.spacePermission.create({
      data: {
        spaceId: wikiSpace.id,
        teamRole: 'MEMBER',
        level: 'EDIT',
      },
    });
    console.warn('        ADMIN -> ADMIN, MEMBER -> EDIT');
  } else {
    console.warn('        Permissions already exist');
  }

  console.warn('\nDemo seed complete!');
  console.warn('Login at http://localhost:7000/login');
  console.warn('Credentials: tim / password123\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
