/**
 * Demo seed script for Axiom.
 *
 * Usage: npx tsx scripts/seed-demo.ts
 *
 * Creates a demo environment with users, org, team, project,
 * issues, comments, wiki space, and self-referential repository.
 *
 * Safe to run multiple times (idempotent via upserts / existence checks).
 */

import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

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
  console.warn('  [1/8] Users');
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
  console.warn('  [2/8] Organization');
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
  console.warn('  [3/8] Team');

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
  console.warn('  [4/8] Project');

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
        description: 'Axiom minimum viable product - project management, Git hosting, and documentation',
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
  console.warn('  [5/8] Issues');

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
    { title: 'Inline PR comments UI', body: 'Backend supports filePath/line on PR comments but the frontend only shows general comments. Add inline comment rendering on diff hunks.', type: 'STORY', priority: 'HIGH', column: 'Todo', creator: 'tim', labels: ['frontend', 'enhancement'] },
    { title: 'Merge strategy selection', body: 'Allow selecting squash, rebase, or merge commit when merging a PR. Currently only merge commit is supported.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'tim', labels: ['frontend', 'backend'] },
    { title: 'Webhook management UI', body: 'Build a UI for managing repository webhooks. Backend CRUD endpoints already exist.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'tim', labels: ['frontend'] },
    { title: 'Branch protection rules UI', body: 'Frontend for configuring branch protection rules. Backend endpoints exist.', type: 'TASK', priority: 'MEDIUM', column: 'Backlog', creator: 'tim', labels: ['frontend'] },
    { title: 'Download archive (zip/tar)', body: 'Add a download button to the repo page for downloading the current ref as a zip or tar archive.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'test', labels: ['backend', 'frontend'] },
    { title: 'Code search within repository', body: 'Implement code search using `git grep` within a repository. Add a search bar to the repo page.', type: 'STORY', priority: 'MEDIUM', column: 'Backlog', creator: 'tim', labels: ['backend', 'frontend', 'enhancement'] },
    { title: 'Contributor statistics page', body: 'Show contributor stats per repository: commits over time, lines added/removed, top contributors chart.', type: 'TASK', priority: 'LOW', column: 'Backlog', creator: 'test', labels: ['frontend', 'enhancement'] },
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
  console.warn('  [6/8] Comments');

  type CommentSeed = {
    issueTitle: string;
    comments: { author: string; body: string }[];
  };

  const commentSeeds: CommentSeed[] = [
    {
      issueTitle: 'Repository file browser shows empty for folders',
      comments: [
        { author: 'tim', body: 'Root cause found: `git ls-tree -l master -- frontend` returns the entry *for* `frontend`, not its contents. We need to append a trailing `/` to the tree path.\n\nFix is one line in `src/git/git-commands.ts` in `lsTree()`.' },
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
      issueTitle: 'Inline PR comments UI',
      comments: [
        { author: 'tim', body: 'The backend already stores `filePath` and `line` on PR comments. We just need to render them inline on the diff view.\n\nProposed approach:\n1. Group comments by filePath + line\n2. Insert comment threads between diff hunk rows\n3. Add a "+" button on hover over line numbers to start new comments' },
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
  console.warn('  [7/8] Wiki');

  type PageSeed = {
    title: string;
    slug: string;
    body: string;
    position: number;
    author: string;
  };

  const wikiPages: PageSeed[] = [
    {
      title: 'Getting Started',
      slug: 'getting-started',
      position: 1,
      author: 'tim',
      body: `# Getting Started

Welcome to Axiom! This guide will help you get the platform running locally.

## Prerequisites

- Node.js >= 22.0.0
- PostgreSQL 16+
- Git 2.40+

## Installation

\`\`\`bash
# Clone the repository
git clone <repo-url>
cd axiom

# Install dependencies
npm install
cd frontend && npm install && cd ..

# Set up environment
cp .env.example .env
# Edit .env with your database credentials

# Initialize the database
npm run db:push
npm run db:seed

# Start the development stack
npm run docker:dev
\`\`\`

## First Steps

1. Navigate to http://localhost:7000/login
2. Log in with \`tim\` / \`password123\`
3. Explore the Axiom MVP project board
4. Browse the self-hosted repository

## Project Structure

| Directory | Purpose |
|-----------|---------|
| \`src/\` | Backend API server (Express + Prisma) |
| \`frontend/\` | React SPA (Vite + TanStack Query) |
| \`prisma/\` | Database schema and migrations |
| \`scripts/\` | Seed and utility scripts |
| \`e2e/\` | Playwright end-to-end tests |`,
    },
    {
      title: 'Architecture',
      slug: 'architecture',
      position: 2,
      author: 'tim',
      body: `# Architecture Overview

Axiom is a modular monolith combining project management, Git hosting, and documentation.

## System Diagram

\`\`\`mermaid
graph TB
    Client[React SPA] -->|REST API| Gateway[Express Server]
    Gateway --> Auth[Auth Module]
    Gateway --> Issues[Issues Module]
    Gateway --> Wiki[Wiki Module]
    Gateway --> Git[Git Module]
    Gateway --> MCP[MCP Server]
    Auth --> DB[(PostgreSQL)]
    Issues --> DB
    Wiki --> DB
    Git --> Disk[(Git Repos)]
    Git --> DB
\`\`\`

## Key Design Decisions

### Modular Monolith
Each domain module has its own routes, controller, and service layer. Shared database access via Prisma.

### Authentication
- JWT access tokens (15 min expiry)
- HTTP-only refresh tokens (7 day expiry)
- Optional 2FA with TOTP

### Git Hosting
- Bare repositories stored on disk at \`/data/repos/{org}/{team}/{slug}.git\`
- Custom Git Smart HTTP backend for push/pull
- Post-receive hooks for commit-to-issue linking

### Frontend
- React 19 with React Router v7
- TanStack Query for server state
- Zustand for client state
- Tailwind CSS with CSS variable design tokens
- All icons from lucide-react (no emojis)

## Database Schema

Key relationships:
- **Organization** has many **Teams**
- **Team** has many **Projects**, **Repositories**, and **WikiSpaces**
- **Project** has many **Issues** organized into **BoardColumns**
- **Repository** has many **PullRequests** with **Reviews** and **Comments**`,
    },
    {
      title: 'API Reference',
      slug: 'api-reference',
      position: 3,
      author: 'tim',
      body: `# API Reference

Base URL: \`/api\`

All endpoints require authentication via Bearer token unless noted.

## Authentication

### POST /api/auth/login

\`\`\`json
{
  "username": "tim",
  "password": "password123"
}
\`\`\`

Returns \`{ accessToken, refreshToken, user }\`.

## Issues

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/issues/project/:projectId\` | List issues with filters |
| POST | \`/issues/project/:projectId\` | Create issue |
| GET | \`/issues/:id\` | Get issue detail |
| PATCH | \`/issues/:id\` | Update issue |
| DELETE | \`/issues/:id\` | Delete issue |

## Repositories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/repos/team/:teamId\` | List repos |
| POST | \`/repos/team/:teamId\` | Create repo |
| GET | \`/repos/:id/tree/:ref/*\` | Browse tree |
| GET | \`/repos/:id/blob/:ref/*\` | Get file content |
| GET | \`/repos/:id/blame/:ref/*\` | Get blame |
| GET | \`/repos/:id/commits\` | List commits |
| GET | \`/repos/:id/commits/:sha\` | Commit detail + diff |

## Pull Requests

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/repos/:id/pulls\` | List PRs |
| POST | \`/repos/:id/pulls\` | Create PR |
| GET | \`/repos/:id/pulls/:num\` | PR detail |
| POST | \`/repos/:id/pulls/:num/merge\` | Merge PR |

## Error Format

\`\`\`json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed"
  }
}
\`\`\``,
    },
    {
      title: 'Development Guide',
      slug: 'development-guide',
      position: 4,
      author: 'tim',
      body: `# Development Guide

## Running Locally

\`\`\`bash
# Start database and services
npm run docker:dev

# Seed demo data
npm run db:seed

# Run backend tests
npm run test:run

# Run frontend type check
cd frontend && npx tsc --noEmit

# Run backend type check
npm run typecheck

# Run e2e tests (requires dev stack running)
npm run e2e
\`\`\`

## Code Quality

\`\`\`bash
npm run lint        # ESLint
npm run format      # Prettier
npm run typecheck   # TypeScript
npm run check       # All of the above + tests
\`\`\`

## Seed Users

| Username | Password | Role |
|----------|----------|------|
| tim | password123 | OWNER |
| test | password123 | MEMBER |

## Design Rules

- No emojis anywhere (use Lucide icons)
- Every button must include a Lucide icon
- Use CSS variable design tokens, never Tailwind palette colors directly
- Abstract repeated UI patterns into shared components

## Git Conventions

- Branch from \`master\`
- Conventional commit messages: \`feat:\`, \`fix:\`, \`docs:\`, \`refactor:\`
- All PRs require passing typecheck and lint`,
    },
    {
      title: 'Design Patterns',
      slug: 'design-patterns',
      position: 5,
      author: 'tim',
      body: `# Design Patterns

This document is the definitive guide for building new features in Axiom. It covers every shared component, hook, utility, design token, and code pattern available. Follow these patterns to keep the codebase consistent.

---

## Non-Negotiable Rules

1. **No emojis** -- anywhere in source, UI, seed data, or commits
2. **Lucide icons only** -- import from \`lucide-react\`, no other icon libraries or inline SVGs
3. **Every button must have an icon** -- no text-only buttons (icon-only allowed with \`title\` prop)
4. **Design tokens only** -- never use Tailwind palette colors directly (\`text-blue-500\`); use CSS variables (\`text-primary\`)
5. **Shared components first** -- check \`components/ui/\` before building anything

---

## CSS Design Tokens

Use these semantic tokens everywhere. They adapt automatically for dark mode.

### Text
| Token | Purpose |
|---|---|
| \`text-text\` | Primary text |
| \`text-text-secondary\` | Supporting text |
| \`text-text-tertiary\` | Disabled / placeholder |
| \`text-text-inverse\` | Text on dark backgrounds |

### Surfaces
| Token | Purpose |
|---|---|
| \`bg-surface\` | Main background (cards, pages) |
| \`bg-surface-secondary\` | Subtle contrast (table headers, hover) |
| \`bg-surface-tertiary\` | Stronger contrast (code blocks, active states) |
| \`bg-surface-elevated\` | Elevated panels (modals, dropdowns) |

### Borders
| Token | Purpose |
|---|---|
| \`border-border\` | Standard borders |
| \`border-border-light\` | Subtle separators (table row dividers) |
| \`border-border-focus\` | Focus ring borders |

### Semantic Colors
| Token | Purpose |
|---|---|
| \`text-primary\` / \`bg-primary\` | Brand / primary actions |
| \`bg-primary-light\` | Light primary background |
| \`text-danger\` / \`bg-danger\` | Errors, destructive actions |
| \`bg-danger-light\` | Light danger background |
| \`text-warning\` / \`bg-warning\` | Warnings, caution |
| \`text-success\` / \`bg-success\` | Success, positive |

### Sizing Standards
| Element | Standard |
|---|---|
| Card border radius | \`rounded-lg\` |
| Button border radius | \`rounded-md\` |
| Modal border radius | \`rounded-xl\` |
| Avatars, pills | \`rounded-full\` |
| Transition duration | \`duration-150\` (interactions) |
| Focus ring | \`focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1\` |
| Data row hover | \`hover:bg-surface-secondary transition-colors\` (for dense lists, tables) |
| Card hover | \`hover:border-primary/50 hover:shadow-sm transition-all\` (for navigation tiles) |
| Card container | \`rounded-lg border border-border bg-surface overflow-hidden\` |

### Hover Pattern: Cards vs Rows

Use **card hover** for navigation tiles (dashboards, team overview -- few items, prominent):
\`\`\`tsx
<Link className="group rounded-lg border border-border bg-surface p-4 hover:border-primary/50 hover:shadow-sm transition-all">
  ...
  <ArrowRight className="opacity-0 group-hover:opacity-100 transition-opacity" />
</Link>
\`\`\`

Use **row hover** for dense data lists (repo list, PR list, file browser -- many items, scannable):
\`\`\`tsx
<div className="rounded-lg border border-border bg-surface divide-y divide-border">
  <Link className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors">
    ...
  </Link>
</div>
\`\`\`

Never mix these styles within the same page section. If a section uses cards, all items in that section are cards. If it uses rows, all items are rows.

---

## Shared UI Components

All live in \`frontend/src/components/ui/\`. Every component uses \`forwardRef\`, \`cn()\` for className merging, and CSS variable tokens.

### Form Inputs

**Button** -- all clickable actions
\`\`\`tsx
<Button variant="primary" size="md">       // primary, secondary, danger, ghost, outline
  <Plus className="h-4 w-4" /> Create      // sizes: xs, sm, md, lg
</Button>
\`\`\`

**Input** -- text inputs with label, hint, and error support
\`\`\`tsx
<Input label="Email" placeholder="you@example.com" error="Required" hint="We won't share it" />
\`\`\`

**Textarea** -- multi-line text with same label/hint/error API as Input

**Checkbox** -- labeled checkbox
\`\`\`tsx
<Checkbox label="Accept terms" checked={agreed} onChange={setAgreed} />
\`\`\`

**Toggle** -- on/off switch
\`\`\`tsx
<Toggle label="Enable notifications" checked={enabled} onChange={setEnabled} />
\`\`\`

**Select** (from Dropdown) -- form dropdown
\`\`\`tsx
<Select label="Priority" value={priority} onChange={setPriority}
  options={[{ value: 'HIGH', label: 'High' }, { value: 'LOW', label: 'Low' }]} />
\`\`\`

### Display

**Avatar** -- user avatars with fallback initials
\`\`\`tsx
<Avatar name="Jane Doe" src={user.avatarUrl} size="sm" />  // xs, sm, md, lg
\`\`\`

**Badge** -- status chips and labels
\`\`\`tsx
<Badge variant="success" size="sm">Active</Badge>  // default, primary, danger, warning, success, outline
\`\`\`

**Progress** -- progress bars
\`\`\`tsx
<Progress value={75} size="sm" variant="primary" />
\`\`\`

**Spinner / PageLoader** -- loading indicators
\`\`\`tsx
<Spinner className="h-4 w-4" />  // inline
<PageLoader />                    // full page
\`\`\`

**Skeleton / TableSkeleton / ListSkeleton** -- loading placeholders
\`\`\`tsx
<Skeleton className="h-8 w-full" />
<TableSkeleton rows={5} cols={4} />
\`\`\`

**Tooltip** -- hover hints
\`\`\`tsx
<Tooltip content="Delete this item"><Button variant="ghost">...</Button></Tooltip>
\`\`\`

**IssueTypeIcon** -- renders issue type icons (TASK, BUG, STORY, EPIC)
\`\`\`tsx
<IssueTypeIcon type="BUG" className="h-4 w-4" />
\`\`\`

### Overlays

**Modal** -- overlay dialogs via createPortal
\`\`\`tsx
<Modal open={isOpen} onClose={() => setOpen(false)} title="Edit Item" size="md">
  <form>...</form>
  <ModalFooter>
    <Button variant="secondary"><X /> Cancel</Button>
    <Button><Save /> Save</Button>
  </ModalFooter>
</Modal>
\`\`\`

**ConfirmDialog** -- destructive action confirmation
\`\`\`tsx
<ConfirmDialog open={!!target} onClose={() => setTarget(null)}
  onConfirm={() => deleteMutation.mutate(target.id)}
  title="Delete Item" description="This cannot be undone."
  confirmLabel="Delete" loading={deleteMutation.isPending} />
\`\`\`

**Dropdown / DropdownItem** -- contextual menus
\`\`\`tsx
<Dropdown trigger={<Button variant="ghost"><MoreVertical /></Button>}>
  <DropdownItem onClick={handleEdit}><Pencil /> Edit</DropdownItem>
  <DropdownItem onClick={handleDelete}><Trash2 /> Delete</DropdownItem>
</Dropdown>
\`\`\`

### Navigation & Layout

**Tabs** -- tab bar navigation
\`\`\`tsx
<Tabs tabs={[{ key: 'overview', label: 'Overview', icon: <Eye /> }]}
  activeKey={tab} onChange={setTab} />
\`\`\`

**Pagination** -- offset-based page navigation
\`\`\`tsx
<Pagination total={200} limit={25} offset={page * 25}
  onPageChange={(offset) => setPage(Math.floor(offset / 25))} />
\`\`\`

**EmptyState** -- zero-data placeholders
\`\`\`tsx
<EmptyState icon={<Inbox />} title="No items yet"
  description="Create your first item to get started."
  action={<Button><Plus /> Create</Button>} />
\`\`\`

### Data Tables

**Table / Thead / Tbody / TrHead / Tr / Th / Td / TableContainer**
\`\`\`tsx
<TableContainer>         {/* rounded-lg border border-border bg-surface overflow-hidden */}
  <Table>                {/* w-full text-sm */}
    <Thead>
      <TrHead>           {/* border-b bg-surface-secondary */}
        <Th>Name</Th>    {/* px-4 py-3 text-xs font-medium uppercase tracking-wide */}
        <Th className="text-right">Actions</Th>
      </TrHead>
    </Thead>
    <Tbody>              {/* divide-y divide-border-light */}
      <Tr>               {/* hover:bg-surface-secondary transition-colors */}
        <Td>Item</Td>    {/* px-4 py-3 */}
        <Td className="text-right">...</Td>
      </Tr>
    </Tbody>
  </Table>
</TableContainer>
\`\`\`

Use raw \`<table>\` elements only for specialized displays (code diffs, blame views, file listings).

### Editor Components

**MarkdownRenderer** -- renders markdown with syntax highlighting and mermaid diagrams
\`\`\`tsx
<MarkdownRenderer content={markdownString} />
\`\`\`

**MarkdownEditor** -- TipTap WYSIWYG editor with toolbar
\`\`\`tsx
<MarkdownEditor value={body} onChange={setBody} compact />
\`\`\`

### Notifications

**Toast / useToast** -- transient notifications (4s auto-dismiss)
\`\`\`tsx
const toast = useToast();
toast.success('Item created');
toast.error('Something went wrong');
toast.info('Processing...');
\`\`\`

---

## Custom Hooks

| Hook | Purpose | Example |
|---|---|---|
| \`useDebounce(value, delay?)\` | Debounce a value (default 300ms) | \`const q = useDebounce(search)\` |
| \`usePaginatedQuery({ queryKey, queryFn, pageSize? })\` | Pagination + React Query | Returns \`{ data, page, setPage, totalPages, isLoading }\` |
| \`useMutationWithToast(fn, opts?)\` | Mutation + toast + invalidation | \`useMutationWithToast(api.delete, { successMessage: 'Deleted', invalidateKeys: [['items']] })\` |
| \`useRepoContext()\` | Current repo from URL params | Returns \`{ org, teamSlug, repoSlug, basePath }\` |
| \`useKeyboard()\` | Global keyboard shortcuts | Cmd+K search, ? help, / focus |
| \`useDarkMode()\` | Dark mode toggle | Returns \`{ isDark, toggle }\` |
| \`useWebSocket()\` | Singleton WebSocket connection | Auto-reconnect with backoff |
| \`useIssueListFilters(issues)\` | Multi-filter/sort for issue lists | Returns filtered issues + filter state |

---

## Data Fetching Patterns

### Server State: TanStack Query
\`\`\`tsx
// Fetch data
const { data, isLoading } = useQuery({
  queryKey: ['issues', projectId, page],         // always arrays, match resource hierarchy
  queryFn: () => issuesApi.list(projectId, { limit: 25, offset: page * 25 }),
});

// Mutate data
const mutation = useMutation({
  mutationFn: (data) => issuesApi.create(projectId, data),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issues'] }),
});
\`\`\`

### Client State: Zustand
\`\`\`tsx
// Only for UI state -- never for server data
const { sidebarOpen, toggleSidebar } = useUIStore();
const { user, isAuthenticated } = useAuthStore();
\`\`\`

### API Client
\`\`\`tsx
import { get, post, patch, del } from '@/api/client';

export const itemsApi = {
  list: (params) => get<{ items: Item[]; total: number }>('/items?' + new URLSearchParams(params)),
  get: (id: string) => get<Item>(\`/items/\${id}\`),
  create: (data) => post<Item>('/items', data),
  update: (id, data) => patch<Item>(\`/items/\${id}\`, data),
  delete: (id) => del(\`/items/\${id}\`),
};
\`\`\`

---

## Backend Module Pattern

Every feature module follows the same 3-file structure:

### Routes (\`module.routes.ts\`)
\`\`\`typescript
import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as controller from './module.controller';

const router = Router();
router.get('/', authenticate, controller.list);
router.post('/', authenticate, controller.create);
router.patch('/:id', authenticate, controller.update);
router.delete('/:id', authenticate, controller.delete);
export default router;
\`\`\`

### Controller (\`module.controller.ts\`)
\`\`\`typescript
import { Request, Response, NextFunction } from 'express';
import * as service from './module.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.params.projectId, req.query);
    res.json(result);
  } catch (err) { next(err); }
}
\`\`\`

### Service (\`module.service.ts\`)
\`\`\`typescript
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { parseServicePagination } from '../../utils/pagination';

export async function list(projectId: string, opts?: { limit?: number; offset?: number }) {
  const { take, skip } = parseServicePagination(opts);
  const [items, total] = await Promise.all([
    prisma.item.findMany({ where: { projectId }, take, skip, orderBy: { createdAt: 'desc' } }),
    prisma.item.count({ where: { projectId } }),
  ]);
  return { items, total };
}
\`\`\`

### Error Handling
\`\`\`typescript
throw new AppError(404, 'Item not found');
throw new AppError(403, 'Not authorized', 'INSUFFICIENT_PERMISSIONS');
\`\`\`

### Pagination Utility
\`\`\`typescript
import { parseServicePagination } from '../../utils/pagination';
const { take, skip } = parseServicePagination(opts);  // defaults: take=25, skip=0, max take=100
\`\`\`

---

## Building a New Page (Checklist)

1. Create page component in \`frontend/src/pages/feature/\`
2. Add lazy route in \`App.tsx\`
3. Use \`useQuery\` for data fetching with proper query keys
4. Use shared UI components (Button, Input, Table, Modal, etc.)
5. Use design tokens for all colors
6. Add Lucide icons to every button
7. Include loading state (Skeleton or PageLoader)
8. Include empty state (EmptyState component)
9. Include error handling
10. Use \`useMutationWithToast\` for mutations

## Building a New Component (Checklist)

1. Place in \`frontend/src/components/ui/\`
2. Use \`forwardRef\` with proper generic types
3. Use \`cn()\` from \`@/lib/utils\` for className merging
4. Accept \`className\` prop for overrides
5. Use CSS variable tokens for all colors
6. Define variants/sizes as plain objects
7. Export as named export (never default)
8. Follow the Button.tsx pattern

## Building a New API Module (Checklist)

1. Create \`frontend/src/api/feature.api.ts\`
2. Import \`get, post, patch, del\` from \`./client\`
3. Export a named object with typed endpoints
4. Create backend module: routes + controller + service
5. Mount routes in \`src/index.ts\`
6. Use \`parseServicePagination\` for list endpoints
7. Use \`AppError\` for error responses`,
    },
    {
      title: 'MCP Integration Guide',
      slug: 'mcp-integration',
      position: 10,
      author: 'tim',
      body: `# MCP Integration Guide

The Model Context Protocol (MCP) server built into Axiom lets AI assistants such as Claude interact directly with your projects, issues, repositories, and wiki -- without opening a browser. Claude can list issues, create and update them, browse code, open pull requests, manage sprints, and publish wiki pages entirely through natural-language conversation.

## Connecting from Claude Desktop

Add the following to \`claude_desktop_config.json\` (macOS: \`~/Library/Application Support/Claude/claude_desktop_config.json\`):

\`\`\`json
{
  "mcpServers": {
    "axiom": {
      "type": "sse",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-access-token>"
      }
    }
  }
}
\`\`\`

Restart Claude Desktop. "axiom" will appear in the MCP servers panel.

## Connecting from Claude Code

\`\`\`bash
claude mcp add axiom --transport sse http://localhost:3000/api/mcp \\
  --header "Authorization: Bearer <your-access-token>"
\`\`\`

Obtain a token by calling \`POST /api/auth/login\` with your Axiom credentials. The response includes an \`accessToken\` field.

## Discovery Chain

Because most tools need IDs, start by discovering them:

\`\`\`
list_orgs()              -> orgId
list_teams(orgId)        -> teamId
list_projects(teamId)    -> projectId
list_repos(teamId)       -> repoId
list_wiki_spaces(teamId) -> spaceId
\`\`\`

## Example Workflows

### Triage bugs in a sprint

\`\`\`
list_orgs -> list_teams -> list_projects
list_issues(projectId, type: "BUG")
get_issue(projectId, issueNumber)         <- read full detail
update_issue(projectId, issueNumber, priority: "HIGH")
add_comment(projectId, issueNumber, body: "Triaged -- assigning to next sprint")
\`\`\`

### Review and merge a pull request

\`\`\`
list_repos(teamId) -> list_pull_requests(repoId, status: "OPEN")
get_pull_request(repoId, pullNumber)
get_diff(repoId, base, head)
merge_pull_request(repoId, pullNumber, strategy: "squash")
\`\`\`

### Publish documentation

\`\`\`
list_wiki_spaces(teamId) -> get_page_tree(spaceId)
create_wiki_page(spaceId, title, slug, body)
\`\`\`

## Known Limitations

- **Creator attribution**: All resources created via MCP are attributed to the user whose access token is used.
- **Single SSE connection**: Only one active SSE session at a time. Reconnecting replaces the previous session.`,
    },
    {
      title: 'MCP Tool Reference',
      slug: 'mcp-tools',
      position: 11,
      author: 'tim',
      body: `# MCP Tool Reference

Axiom exposes 37 MCP tools across 7 categories.

---

## Organization (3 tools)

| Tool | Description |
|---|---|
| \`list_orgs\` | List organizations the current user belongs to |
| \`list_teams\` | List teams in an organization (\`orgId\`) |
| \`list_projects\` | List projects in a team (\`teamId\`) |

---

## Issues (8 tools)

| Tool | Key Parameters | Description |
|---|---|---|
| \`list_issues\` | \`projectId\`, \`type\`, \`priority\`, \`assigneeId\` | List issues with optional filters |
| \`get_issue\` | \`projectId\`, \`issueNumber\` | Get full issue detail including comments |
| \`create_issue\` | \`projectId\`, \`title\`, \`type\`, \`priority\`, \`assigneeId\` | Create a new issue |
| \`update_issue\` | \`projectId\`, \`issueNumber\`, \`columnId\`, \`priority\`, \`assigneeId\` | Update status, priority, assignee, or sprint |
| \`delete_issue\` | \`projectId\`, \`issueNumber\` | Permanently delete an issue |
| \`add_comment\` | \`projectId\`, \`issueNumber\`, \`body\` | Add a markdown comment to an issue |
| \`list_sprints\` | \`projectId\`, \`status\` | List sprints, optionally filtered by status |
| \`get_sprint\` | \`sprintId\` | Get a sprint with all its issues |

## Sprints (4 tools)

| Tool | Key Parameters | Description |
|---|---|---|
| \`create_sprint\` | \`projectId\`, \`name\`, \`startDate\`, \`endDate\` | Create a sprint in PLANNING status |
| \`start_sprint\` | \`sprintId\` | Move sprint from PLANNING to ACTIVE |
| \`complete_sprint\` | \`sprintId\`, \`incompleteIssueDestination\` | Complete active sprint |
| \`add_issues_to_sprint\` | \`sprintId\`, \`issueIds\` | Add issues to a sprint |

---

## Repositories & Git (7 tools)

| Tool | Key Parameters | Description |
|---|---|---|
| \`list_repos\` | \`teamId\` | List repositories in a team |
| \`browse_files\` | \`repoId\`, \`path\`, \`ref\` | List files/directories at a path |
| \`read_file\` | \`repoId\`, \`filePath\`, \`ref\` | Read file content at a ref |
| \`get_commits\` | \`repoId\`, \`ref\`, \`limit\` | Get recent commits on a branch |
| \`get_branches\` | \`repoId\` | List branches |
| \`list_branches\` | \`repoId\` | List branches with latest commit info |
| \`get_diff\` | \`repoId\`, \`base\`, \`head\` | Get diff between two refs |

---

## Pull Requests (4 tools)

| Tool | Key Parameters | Description |
|---|---|---|
| \`list_pull_requests\` | \`repoId\`, \`status\` | List PRs, optionally filtered by status |
| \`create_pull_request\` | \`repoId\`, \`title\`, \`sourceBranch\`, \`targetBranch\` | Open a new pull request |
| \`get_pull_request\` | \`repoId\`, \`pullNumber\` | Get PR detail including diff stats |
| \`merge_pull_request\` | \`repoId\`, \`pullNumber\`, \`strategy\` | Merge a PR (merge/squash/rebase) |

---

## CI/CD & Releases (4 tools)

| Tool | Key Parameters | Description |
|---|---|---|
| \`list_pipelines\` | \`repoId\` | List CI/CD pipelines for a repository |
| \`trigger_pipeline\` | \`pipelineId\`, \`ref\` | Trigger a pipeline run on a git ref |
| \`list_releases\` | \`repoId\`, \`draft\`, \`prerelease\` | List releases with optional filters |
| \`create_release\` | \`repoId\`, \`tagName\`, \`targetBranch\`, \`name\`, \`body\` | Create a new release |

---

## Wiki (6 tools)

| Tool | Key Parameters | Description |
|---|---|---|
| \`list_wiki_spaces\` | \`teamId\` | List wiki spaces for a team |
| \`get_wiki_page\` | \`spaceId\`, \`pageSlug\` | Get a wiki page by space and slug |
| \`create_wiki_page\` | \`spaceId\`, \`title\`, \`slug\`, \`body\` | Create a new wiki page |
| \`update_wiki_page\` | \`pageId\`, \`title\`, \`body\` | Update page title and/or body |
| \`delete_wiki_page\` | \`pageId\` | Permanently delete a wiki page |
| \`get_page_tree\` | \`spaceId\` | Get the full nested page tree |

---

## Search (1 tool)

| Tool | Key Parameters | Description |
|---|---|---|
| \`search\` | \`query\`, \`type\`, \`limit\` | Search issues and wiki pages by keyword |

\`type\` accepts \`issues\`, \`wiki\`, or \`all\` (default).`,
    },
  ];

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

  let totalPages = 0;
  for (const pg of wikiPages) {
    const existingPage = await prisma.page.findUnique({
      where: { spaceId_slug: { spaceId: wikiSpace.id, slug: pg.slug } },
    });

    if (existingPage) {
      totalPages++;
      continue;
    }

    const page = await prisma.page.create({
      data: {
        spaceId: wikiSpace.id,
        title: pg.title,
        slug: pg.slug,
        body: pg.body,
        position: pg.position,
      },
    });

    await prisma.pageVersion.create({
      data: {
        pageId: page.id,
        title: pg.title,
        body: pg.body,
        version: 1,
        authorId: users[pg.author].id,
      },
    });
    totalPages++;
  }
  console.warn(`        Axiom Documentation (${totalPages} pages)`);

  // ────────────────────────────────────────────────────────────
  // 8. Repository (self-referential bare clone)
  // ────────────────────────────────────────────────────────────
  console.warn('  [8/8] Repository');

  {
    const selfReposBase = process.env.REPOS_PATH ?? '/data/repos';
    const selfDiskPath = path.join(selfReposBase, 'aranea-dev', 'axiom', 'axiom.git');

    const _selfRepo = await prisma.repository.upsert({
      where: { teamId_slug: { teamId: team.id, slug: 'axiom' } },
      update: { diskPath: selfDiskPath, description: 'The Axiom platform source code' },
      create: {
        teamId: team.id,
        name: 'axiom',
        slug: 'axiom',
        description: 'The Axiom platform source code',
        visibility: 'INTERNAL',
        diskPath: selfDiskPath,
        defaultBranch: 'master',
      },
    });

    // Create bare clone on disk if not already present.
    // When running inside the Docker container the source /root/axiom does not
    // exist, so we skip the git operations and rely on init-self-repo.sh having
    // been run on the host first.
    const isInsideDocker = fs.existsSync('/.dockerenv');
    const sourceExists = fs.existsSync('/root/axiom/.git');

    // Only attempt a bare clone when on the host and the source repo has commits.
    let sourceHasCommits = false;
    if (!isInsideDocker && sourceExists) {
      try {
        execSync('git -C /root/axiom rev-parse HEAD', { stdio: 'pipe' });
        sourceHasCommits = true;
      } catch { /* no commits yet */ }
    }

    if (sourceHasCommits) {
      if (!fs.existsSync(selfDiskPath)) {
        fs.mkdirSync(path.dirname(selfDiskPath), { recursive: true });
        execSync(`git clone --bare /root/axiom "${selfDiskPath}"`, { stdio: 'pipe' });
        console.warn(`        axiom (INTERNAL) -- created bare clone at ${selfDiskPath}`);
      } else {
        execSync(`git -C "${selfDiskPath}" fetch /root/axiom '+refs/heads/*:refs/heads/*' --tags --prune`, { stdio: 'ignore' });
        console.warn(`        axiom (INTERNAL) -- updated bare clone at ${selfDiskPath}`);
      }

      // Ensure bare repo accepts pushes
      execSync(`git -C "${selfDiskPath}" config receive.denyCurrentBranch ignore`, { stdio: 'ignore' });
    } else {
      console.warn(`        axiom (INTERNAL) -- DB record upserted (run scripts/init-self-repo.sh on host after committing)`);
    }

    // Dev API token for git push/pull
    // Use a deterministic token so the local .git/config remote stays valid across re-seeds.
    const DEV_TOKEN = 'tk_dev_axiom_local_0000000000000000000000000000000000000000000000';
    const devTokenHash = crypto.createHash('sha256').update(DEV_TOKEN).digest('hex');
    const devTokenPrefix = DEV_TOKEN.slice(0, 11);

    await prisma.apiToken.upsert({
      where: { tokenHash: devTokenHash },
      update: { name: 'dev-git-push' },
      create: {
        userId: users['tim'].id,
        name: 'dev-git-push',
        tokenHash: devTokenHash,
        prefix: devTokenPrefix,
        scopes: ['repo:read', 'repo:write'],
        expiresAt: null,
      },
    });

    // Set up git remote on host so pushes go through the Axiom server
    if (!isInsideDocker && sourceExists) {
      const remoteUrl = 'http://localhost:3000/git/aranea-dev/axiom/axiom.git';
      try {
        const existingRemote = execSync('git -C /root/axiom remote get-url axiom 2>/dev/null', { encoding: 'utf8' }).trim();
        if (existingRemote !== remoteUrl) {
          execSync(`git -C /root/axiom remote set-url axiom "${remoteUrl}"`, { stdio: 'pipe' });
        }
      } catch {
        execSync(`git -C /root/axiom remote add axiom "${remoteUrl}"`, { stdio: 'pipe' });
      }

      // Configure git credential for the Axiom server
      execSync(`git -C /root/axiom config credential."http://localhost:3000".username tim`, { stdio: 'pipe' });
      execSync(`git -C /root/axiom config credential."http://localhost:3000".helper '!f() { echo "password=${DEV_TOKEN}"; }; f'`, { stdio: 'pipe' });

      console.warn(`        dev API token created (deterministic)`);
      console.warn(`        git remote "axiom" -> ${remoteUrl}`);
    }
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
