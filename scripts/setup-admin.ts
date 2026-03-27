/**
 * Setup script: creates an admin user, org, and team for development.
 *
 * Usage: npx tsx scripts/setup-admin.ts
 *
 * Creates:
 *   - Admin user: admin / admin@axiom.local / password: admin1234
 *   - Organization: Axiom (slug: axiom)
 *   - Team: Core (slug: core)
 *   - Project: Platform (slug: platform, prefix: PLAT) with default board columns
 *   - Wiki space: Docs (slug: docs)
 */

import '../src/config/load-env';

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Setting up Axiom admin environment...\n');

  // 1. Create admin user
  const passwordHash = await bcrypt.hash('admin1234', 12);
  const user = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      email: 'admin@axiom.local',
      username: 'admin',
      displayName: 'Admin',
      passwordHash,
    },
  });
  console.log(`  User:    admin / admin@axiom.local / admin1234`);

  // 2. Create organization
  const org = await prisma.organization.upsert({
    where: { slug: 'axiom' },
    update: {},
    create: {
      name: 'Axiom',
      slug: 'axiom',
      description: 'Default organization',
      members: {
        create: { userId: user.id, role: 'OWNER' },
      },
    },
  });
  console.log(`  Org:     Axiom (/${org.slug})`);

  // Ensure membership exists (upsert may skip create)
  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: user.id, orgId: org.id } },
    update: {},
    create: { userId: user.id, orgId: org.id, role: 'OWNER' },
  });

  // 3. Create team
  const team = await prisma.team.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'core' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'Core',
      slug: 'core',
      description: 'Core platform team',
      members: {
        create: { userId: user.id, role: 'ADMIN' },
      },
    },
  });
  console.log(`  Team:    Core (/${org.slug}/${team.slug})`);

  await prisma.teamMembership.upsert({
    where: { userId_teamId: { userId: user.id, teamId: team.id } },
    update: {},
    create: { userId: user.id, teamId: team.id, role: 'ADMIN' },
  });

  // 4. Create project with board columns
  const existingProject = await prisma.project.findUnique({
    where: { teamId_slug: { teamId: team.id, slug: 'platform' } },
  });
  if (!existingProject) {
    const project = await prisma.project.create({
      data: {
        teamId: team.id,
        name: 'Platform',
        slug: 'platform',
        prefix: 'PLAT',
        description: 'Core platform development',
        columns: {
          createMany: {
            data: [
              { name: 'Backlog', position: 0, isDefault: true, isDone: false },
              { name: 'To Do', position: 1, isDefault: false, isDone: false },
              { name: 'In Progress', position: 2, isDefault: false, isDone: false },
              { name: 'In Review', position: 3, isDefault: false, isDone: false },
              { name: 'Done', position: 4, isDefault: false, isDone: true },
            ],
          },
        },
      },
    });
    console.log(`  Project: Platform (${project.prefix})`);

    // Create sample issues
    const backlogCol = await prisma.boardColumn.findFirst({
      where: { projectId: project.id, isDefault: true },
    });
    const sampleIssues = [
      { title: 'Set up CI/CD pipeline', type: 'TASK' as const, priority: 'HIGH' as const },
      { title: 'Add rate limiting to API', type: 'TASK' as const, priority: 'MEDIUM' as const },
      { title: 'Login page shows blank on slow connection', type: 'BUG' as const, priority: 'CRITICAL' as const },
      { title: 'User profile editing', type: 'STORY' as const, priority: 'MEDIUM' as const },
      { title: 'Dark mode support', type: 'STORY' as const, priority: 'LOW' as const },
    ];
    for (let i = 0; i < sampleIssues.length; i++) {
      await prisma.issue.create({
        data: {
          projectId: project.id,
          number: i + 1,
          title: sampleIssues[i].title,
          body: '',
          type: sampleIssues[i].type,
          priority: sampleIssues[i].priority,
          creatorId: user.id,
          columnId: backlogCol?.id,
        },
      });
    }
    console.log(`  Issues:  ${sampleIssues.length} sample issues created`);
  } else {
    console.log(`  Project: Platform (already exists)`);
  }

  // 5. Create wiki space with a page
  const existingSpace = await prisma.wikiSpace.findUnique({
    where: { teamId_slug: { teamId: team.id, slug: 'docs' } },
  });
  if (!existingSpace) {
    const space = await prisma.wikiSpace.create({
      data: {
        teamId: team.id,
        name: 'Docs',
        slug: 'docs',
        description: 'Team documentation',
      },
    });
    const page = await prisma.page.create({
      data: {
        spaceId: space.id,
        title: 'Getting Started',
        slug: 'getting-started',
        body: '# Getting Started\n\nWelcome to Axiom! This is your team documentation space.\n\n## Quick Links\n\n- [Issues](/axiom/core/platform/issues) — Track work\n- [Board](/axiom/core/platform/board) — Kanban view\n- [Wiki](/axiom/core/wiki/docs) — Documentation\n',
        position: 1,
        versions: {
          create: {
            version: 1,
            title: 'Getting Started',
            body: '# Getting Started\n\nWelcome to Axiom!',
            authorId: user.id,
          },
        },
      },
    });
    console.log(`  Wiki:    Docs space with "Getting Started" page`);
  } else {
    console.log(`  Wiki:    Docs (already exists)`);
  }

  console.log('\n  Setup complete! Login at http://localhost:5173/login');
  console.log('  Credentials: admin / admin1234\n');
}

main()
  .catch((e) => {
    console.error('Setup failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
