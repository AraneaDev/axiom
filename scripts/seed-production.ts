/**
 * Production seed script for Axiom.
 *
 * Usage: npx tsx scripts/seed-production.ts
 *
 * Creates the Aranea.Dev org, Axiom team, Axiom MVP project,
 * board columns, labels, and the tim admin user.
 *
 * Requires ADMIN_PASSWORD env var.
 * Safe to run multiple times (idempotent via upserts).
 */

import '../src/config/load-env';

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD env var is required (min 8 characters).');
  console.error('Usage: ADMIN_PASSWORD=your-secure-password npx tsx scripts/seed-production.ts');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.warn('Seeding production data...\n');

  // -- 1. User ---------------------------------------------------------------
  console.warn('  [1/7] User');
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD!, 12);

  const tim = await prisma.user.upsert({
    where: { username: 'tim' },
    update: { passwordHash, isAdmin: true },
    create: {
      username: 'tim',
      displayName: 'Tim Schipper',
      email: 'tim@aranea.dev',
      passwordHash,
      isAdmin: true,
    },
  });
  console.warn('        Tim Schipper (tim@aranea.dev)');

  // -- 2. Organization -------------------------------------------------------
  console.warn('  [2/7] Organization');
  const org = await prisma.organization.upsert({
    where: { slug: 'aranea-dev' },
    update: {},
    create: {
      name: 'Aranea.Dev',
      slug: 'aranea-dev',
      description: 'Building tools for developers',
    },
  });

  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: tim.id, orgId: org.id } },
    update: { role: 'OWNER' },
    create: { userId: tim.id, orgId: org.id, role: 'OWNER' },
  });
  console.warn('        Aranea.Dev (tim = OWNER)');

  // -- 3. Team ---------------------------------------------------------------
  console.warn('  [3/7] Team');
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

  await prisma.teamMembership.upsert({
    where: { userId_teamId: { userId: tim.id, teamId: team.id } },
    update: { role: 'ADMIN' },
    create: { userId: tim.id, teamId: team.id, role: 'ADMIN' },
  });
  console.warn('        Axiom (tim = ADMIN)');

  // -- 4. Project + Board Columns --------------------------------------------
  console.warn('  [4/7] Project');

  const columnDefs = [
    { name: 'Backlog', position: 0, isDefault: true, isDone: false },
    { name: 'Todo', position: 1, isDefault: false, isDone: false },
    { name: 'In Progress', position: 2, isDefault: false, isDone: false },
    { name: 'Review', position: 3, isDefault: false, isDone: false },
    { name: 'Done', position: 4, isDefault: false, isDone: true },
  ];

  const existing = await prisma.project.findUnique({
    where: { teamId_slug: { teamId: team.id, slug: 'axiom-mvp' } },
  });

  if (!existing) {
    await prisma.project.create({
      data: {
        teamId: team.id,
        name: 'Axiom MVP',
        slug: 'axiom-mvp',
        prefix: 'AXM',
        description: 'Axiom minimum viable product - project management, Git hosting, and documentation',
        columns: { createMany: { data: columnDefs } },
        cardColorBy: 'priority',
      },
    });
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { teamId_slug: { teamId: team.id, slug: 'axiom-mvp' } },
  });

  // Set WIP limits
  const cols = await prisma.boardColumn.findMany({ where: { projectId: project.id } });
  for (const col of cols) {
    if (col.name === 'In Progress') {
      await prisma.boardColumn.update({ where: { id: col.id }, data: { wipLimit: 5 } });
    }
    if (col.name === 'Review') {
      await prisma.boardColumn.update({ where: { id: col.id }, data: { wipLimit: 3 } });
    }
  }
  console.warn('        Axiom MVP (AXM) with board columns');

  // -- 5. Labels -------------------------------------------------------------
  console.warn('  [5/7] Labels');

  const labelDefs = [
    { name: 'frontend', color: '#6366f1' },
    { name: 'backend', color: '#10b981' },
    { name: 'urgent', color: '#ef4444' },
    { name: 'docs', color: '#f59e0b' },
    { name: 'bug', color: '#dc2626' },
    { name: 'enhancement', color: '#8b5cf6' },
  ];

  for (const ld of labelDefs) {
    await prisma.label.upsert({
      where: { projectId_name: { projectId: project.id, name: ld.name } },
      update: { color: ld.color },
      create: { projectId: project.id, name: ld.name, color: ld.color },
    });
  }
  console.warn(`        ${labelDefs.length} labels`);

  // -- 6. Repository record --------------------------------------------------
  console.warn('  [6/7] Repository');

  const reposBase = process.env.REPOS_PATH ?? '/data/repos';
  const diskPath = path.join(reposBase, 'aranea-dev', 'axiom', 'axiom.git');

  const repo = await prisma.repository.upsert({
    where: { teamId_slug: { teamId: team.id, slug: 'axiom' } },
    update: { diskPath, description: 'The Axiom platform source code' },
    create: {
      teamId: team.id,
      name: 'axiom',
      slug: 'axiom',
      description: 'The Axiom platform source code',
      visibility: 'INTERNAL',
      diskPath,
      defaultBranch: 'master',
    },
  });

  // Init bare repo on disk if it doesn't exist
  if (!fs.existsSync(diskPath)) {
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    execSync(`git init --bare --initial-branch master "${diskPath}"`, { stdio: 'pipe' });
    console.warn(`        Initialized bare repo at ${diskPath}`);
  }

  // PR template
  await prisma.repository.update({
    where: { id: repo.id },
    data: {
      prTemplate: `## Summary\n\nWhat does this PR do? Why is it needed?\n\n## Changes\n\n-\n\n## Testing\n\n- [ ] Unit tests added/updated\n- [ ] Manual testing done\n- [ ] No regressions found\n\n## Screenshots\n\n(if applicable)\n`,
    },
  });

  console.warn(`        axiom (INTERNAL) at ${diskPath}`);

  // -- 7. Wiki space ---------------------------------------------------------
  console.warn('  [7/7] Wiki');

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

  // Space permissions
  const existingPerm = await prisma.spacePermission.findFirst({
    where: { spaceId: wikiSpace.id },
  });
  if (!existingPerm) {
    await prisma.spacePermission.create({
      data: { spaceId: wikiSpace.id, teamRole: 'ADMIN', level: 'ADMIN' },
    });
    await prisma.spacePermission.create({
      data: { spaceId: wikiSpace.id, teamRole: 'MEMBER', level: 'EDIT' },
    });
  }

  // Auto-import docs/*.md as wiki pages
  const docsDir = path.resolve(__dirname, '..', 'docs');
  let totalPages = 0;
  if (fs.existsSync(docsDir)) {
    const docFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));
    for (const file of docFiles) {
      const slug = file.replace(/\.md$/, '');
      const body = fs.readFileSync(path.join(docsDir, file), 'utf-8');
      const h1Match = body.match(/^#\s+(.+)$/m);
      const title = h1Match ? h1Match[1] : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      const existingPage = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId: wikiSpace.id, slug } },
      });

      if (existingPage) {
        await prisma.page.update({
          where: { id: existingPage.id },
          data: { body, title },
        });
      } else {
        const page = await prisma.page.create({
          data: { spaceId: wikiSpace.id, title, slug, body, position: totalPages + 1 },
        });
        await prisma.pageVersion.create({
          data: { pageId: page.id, title, body, version: 1, authorId: tim.id },
        });
      }
      totalPages++;
    }
  }
  console.warn(`        Axiom Documentation (${totalPages} pages)`);

  console.warn('\nProduction seed complete!');
  console.warn(`Login at ${process.env.FRONTEND_URL || 'https://aranea.dev'}/login`);
  console.warn('Credentials: tim / <ADMIN_PASSWORD>\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
