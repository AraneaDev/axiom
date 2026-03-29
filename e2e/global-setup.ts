import { execSync } from 'child_process';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const E2E_DB_URL = 'postgresql://axiom:axiom_dev@localhost:5432/axiom_e2e?schema=public';

export default async function globalSetup() {
  // 1. Create axiom_e2e database if it doesn't exist
  const adminPool = new Pool({ connectionString: 'postgresql://axiom:axiom_dev@localhost:5432/postgres' });
  try {
    await adminPool.query('CREATE DATABASE axiom_e2e OWNER axiom');
  } catch (e: any) {
    if (!e.message.includes('already exists')) throw e;
  }
  await adminPool.end();

  // 2. Push Prisma schema to E2E database
  execSync(`DATABASE_URL="${E2E_DB_URL}" npx prisma db push`, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  // 3. Seed E2E test data
  const pool = new Pool({ connectionString: E2E_DB_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as any);

  try {
    // Clean existing data (idempotent re-runs) — order respects foreign keys
    await prisma.issue.deleteMany();
    await prisma.automationRule.deleteMany();
    await prisma.pageTemplate.deleteMany();
    await prisma.page.deleteMany();
    await prisma.wikiSpace.deleteMany();
    await prisma.boardColumn.deleteMany();
    await prisma.project.deleteMany();
    await prisma.teamMembership.deleteMany();
    await prisma.team.deleteMany();
    await prisma.orgMembership.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    // Create users (all with password123 to match e2e/helpers.ts)
    const passwordHash = await bcrypt.hash('password123', 12);

    const admin = await prisma.user.create({
      data: {
        email: 'admin@axiom.local',
        username: 'admin',
        displayName: 'Admin User',
        passwordHash,
      },
    });

    const sarah = await prisma.user.create({
      data: {
        email: 'sarah@axiom.local',
        username: 'sarah-chen',
        displayName: 'Sarah Chen',
        passwordHash,
      },
    });

    const marcus = await prisma.user.create({
      data: {
        email: 'marcus@axiom.local',
        username: 'marcus-kim',
        displayName: 'Marcus Kim',
        passwordHash,
      },
    });

    // Organization
    const org = await prisma.organization.create({
      data: {
        name: 'Axiom',
        slug: 'axiom',
        description: 'E2E test organization',
        members: {
          createMany: {
            data: [
              { userId: admin.id, role: 'OWNER' },
              { userId: sarah.id, role: 'MEMBER' },
              { userId: marcus.id, role: 'MEMBER' },
            ],
          },
        },
      },
    });

    // Team
    const team = await prisma.team.create({
      data: {
        orgId: org.id,
        name: 'Core',
        slug: 'core',
        description: 'Core platform team',
        members: {
          createMany: {
            data: [
              { userId: admin.id, role: 'ADMIN' },
              { userId: sarah.id, role: 'MEMBER' },
              { userId: marcus.id, role: 'MEMBER' },
            ],
          },
        },
      },
    });

    // Project with board columns
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

    // Get backlog column for issues
    const backlogCol = await prisma.boardColumn.findFirst({
      where: { projectId: project.id, isDefault: true },
    });

    // Sample issues (diverse types/priorities for query testing)
    const issues = [
      { title: 'Set up CI/CD pipeline', type: 'TASK' as const, priority: 'HIGH' as const },
      { title: 'Add rate limiting to API', type: 'TASK' as const, priority: 'MEDIUM' as const },
      { title: 'Login page shows blank on slow connection', type: 'BUG' as const, priority: 'CRITICAL' as const },
      { title: 'User profile editing', type: 'STORY' as const, priority: 'MEDIUM' as const },
      { title: 'Dark mode support', type: 'STORY' as const, priority: 'LOW' as const },
      { title: 'Fix broken search indexing', type: 'BUG' as const, priority: 'HIGH' as const },
      { title: 'API response caching', type: 'TASK' as const, priority: 'LOW' as const },
    ];

    for (let i = 0; i < issues.length; i++) {
      await prisma.issue.create({
        data: {
          projectId: project.id,
          number: i + 1,
          title: issues[i].title,
          body: '',
          type: issues[i].type,
          priority: issues[i].priority,
          creatorId: admin.id,
          columnId: backlogCol?.id,
        },
      });
    }

    // Wiki space with built-in templates
    const space = await prisma.wikiSpace.create({
      data: {
        teamId: team.id,
        name: 'Docs',
        slug: 'docs',
        description: 'Team documentation',
      },
    });

    // Seed built-in templates inline (can't import TS service from Playwright)
    const blueprints = [
      { name: 'Meeting Notes', description: 'Capture attendees, agenda, discussion notes, and action items', body: '## Date\n\n{{now()}}\n\n## Facilitator\n\n{{currentUser.displayName}}\n\n## Team\n\n{{team.name}}\n\n## Attendees\n\n- @\n\n## Agenda\n\n1. \n\n## Discussion Notes\n\n## Action Items\n\n- [Owner] - [Task] - [Due Date]\n\n## Decisions Made\n' },
      { name: 'Retrospective', description: 'Sprint retrospective with what went well, improvements, and action items', body: '## Sprint Retrospective\n\n**Date:** {{now()}}\n**Facilitator:** {{currentUser.displayName}}\n**Team:** {{team.name}}\n\n## What Went Well\n\n- \n\n## What Could Be Improved\n\n- \n\n## Action Items\n\n- [ ] \n' },
      { name: 'Decision Record', description: 'Document a decision with context, options considered, and consequences', body: '## Decision Record\n\n**Date:** {{now()}}\n**Author:** {{currentUser.displayName}}\n**Status:** Proposed\n\n## Context\n\n## Options Considered\n\n### Option 1\n\n### Option 2\n\n## Decision\n\n## Consequences\n' },
      { name: 'Product Requirements', description: 'Define goals, user stories, technical requirements, and timeline', body: '## Product Requirements\n\n**Author:** {{currentUser.displayName}}\n**Date:** {{now()}}\n**Project:** {{project.name}}\n\n## Goals\n\n## User Stories\n\n## Technical Requirements\n\n## Timeline\n' },
      { name: 'Runbook', description: 'Operational runbook with common issues, monitoring, and contacts', body: '## Runbook\n\n**Team:** {{team.name}}\n**Last Updated:** {{now()}}\n\n## Architecture\n\n## Common Issues\n\n## Monitoring\n\n## Contacts\n' },
    ];
    await prisma.pageTemplate.createMany({
      data: blueprints.map((bp) => ({
        spaceId: space.id,
        name: bp.name,
        body: bp.body,
        description: bp.description,
        isBuiltIn: true,
      })),
    });

    // Create a sample wiki page
    await prisma.page.create({
      data: {
        spaceId: space.id,
        title: 'Getting Started',
        slug: 'getting-started',
        body: '# Getting Started\n\nWelcome to Axiom!',
        position: 1,
        versions: {
          create: {
            version: 1,
            title: 'Getting Started',
            body: '# Getting Started\n\nWelcome to Axiom!',
            authorId: admin.id,
          },
        },
      },
    });

    // Create an automation rule for testing
    await prisma.automationRule.create({
      data: {
        projectId: project.id,
        name: 'Auto-label critical bugs',
        trigger: 'issue:created',
        conditions: [
          { field: 'type', operator: 'equals', value: 'Bug' },
          { field: 'priority', operator: 'equals', value: 'Critical' },
        ],
        actions: [{ type: 'add_label', name: 'needs-triage' }],
        enabled: true,
      },
    });

    console.log(
      'E2E seed complete: 3 users, 1 org, 1 team, 1 project, 7 issues, 1 wiki space, 5 templates, 1 automation rule',
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}
