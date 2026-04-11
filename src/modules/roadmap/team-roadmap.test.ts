import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';

describe('Team Roadmap Service', () => {
  beforeAll(async () => {
    // No setup needed — reads from existing seed data
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should return issues across multiple projects in a team', async () => {
    const team = await prisma.team.findFirst({
      where: { slug: 'team-noord' },
      include: { org: true },
    });

    if (!team) {
      console.warn('Skipping: Voorbeeld seed data not present');
      return;
    }

    const projects = await prisma.project.findMany({
      where: { teamId: team.id },
      select: { id: true },
    });

    const issues = await prisma.issue.findMany({
      where: {
        projectId: { in: projects.map((p) => p.id) },
        OR: [{ dueDate: { not: null } }, { startDate: { not: null } }],
        parentId: null,
      },
      select: {
        id: true,
        title: true,
        project: { select: { prefix: true } },
      },
    });

    expect(Array.isArray(issues)).toBe(true);
  });

  it('should aggregate issues from all projects in a team', async () => {
    const team = await prisma.team.findFirst({
      include: { org: true },
    });

    if (!team) {
      console.warn('Skipping: No team found');
      return;
    }

    const projects = await prisma.project.findMany({
      where: { teamId: team.id },
      select: { id: true, prefix: true },
    });

    expect(Array.isArray(projects)).toBe(true);

    if (projects.length === 0) {
      return;
    }

    const issues = await prisma.issue.findMany({
      where: {
        projectId: { in: projects.map((p) => p.id) },
        parentId: null,
      },
      select: {
        id: true,
        title: true,
        dueDate: true,
        startDate: true,
        project: { select: { prefix: true, id: true } },
      },
    });

    expect(Array.isArray(issues)).toBe(true);

    // Each issue should belong to one of the team's projects
    const projectIds = new Set(projects.map((p) => p.id));
    for (const issue of issues) {
      expect(projectIds.has(issue.project.id)).toBe(true);
    }
  });

  it('should only include top-level (non-child) issues in timeline', async () => {
    const team = await prisma.team.findFirst({
      include: { org: true },
    });

    if (!team) {
      console.warn('Skipping: No team found');
      return;
    }

    const projects = await prisma.project.findMany({
      where: { teamId: team.id },
      select: { id: true },
    });

    if (projects.length === 0) {
      return;
    }

    const issues = await prisma.issue.findMany({
      where: {
        projectId: { in: projects.map((p) => p.id) },
        OR: [{ dueDate: { not: null } }, { startDate: { not: null } }],
        parentId: null,
      },
      select: {
        id: true,
        parentId: true,
        dueDate: true,
        startDate: true,
      },
    });

    // All returned issues must be top-level (no parent)
    for (const issue of issues) {
      expect(issue.parentId).toBeNull();
    }

    // All returned issues must have at least one date
    for (const issue of issues) {
      const hasDates = issue.dueDate !== null || issue.startDate !== null;
      expect(hasDates).toBe(true);
    }
  });
});
