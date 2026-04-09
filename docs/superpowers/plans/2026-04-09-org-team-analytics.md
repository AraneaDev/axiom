# Org & Team Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add org-level and team-level analytics dashboards showing workload, hours spent, lead times, and backlog health across all teams/projects.

**Architecture:** New `src/modules/analytics/` backend module with two endpoints (org and team analytics) using Prisma aggregation queries. Two new frontend pages (`OrgAnalytics.tsx`, `TeamAnalytics.tsx`) using TanStack Query, plus enhancements to existing org/team pages with analytics navigation. Shared `PeriodSelector` component for time range filtering.

**Tech Stack:** Express 5, Prisma 7, TypeScript, React 19, TanStack Query, Tailwind CSS 4, Lucide React

---

## File Structure

**Backend (new files):**
- `src/modules/analytics/analytics.routes.ts` -- Route definitions
- `src/modules/analytics/analytics.controller.ts` -- Request handling
- `src/modules/analytics/analytics.service.ts` -- Prisma aggregation queries

**Backend (modify):**
- `src/index.ts` -- Mount analytics routes

**Frontend (new files):**
- `frontend/src/api/analytics.api.ts` -- API client functions
- `frontend/src/pages/analytics/OrgAnalytics.tsx` -- Org dashboard page
- `frontend/src/pages/analytics/TeamAnalytics.tsx` -- Team dashboard page
- `frontend/src/components/ui/PeriodSelector.tsx` -- Shared period dropdown

**Frontend (modify):**
- `frontend/src/routes/project-routes.tsx` -- Add analytics routes
- `frontend/src/pages/teams/TeamList.tsx` -- Add analytics nav button
- `frontend/src/pages/teams/TeamDetail.tsx` -- Add analytics nav button

---

### Task 1: Backend analytics service -- period resolution and org analytics

**Files:**
- Create: `src/modules/analytics/analytics.service.ts`

- [ ] **Step 1: Create the analytics service with period resolution and org analytics**

```typescript
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

type Period = '7d' | '30d' | '90d' | 'quarter';

function resolvePeriodStart(period: Period): Date {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case '90d':
      return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    case 'quarter': {
      const quarter = Math.floor(now.getMonth() / 3);
      return new Date(now.getFullYear(), quarter * 3, 1);
    }
  }
}

function isValidPeriod(value: string): value is Period {
  return ['7d', '30d', '90d', 'quarter'].includes(value);
}

export function parsePeriod(value?: string): Period {
  if (!value) return '30d';
  if (isValidPeriod(value)) return value;
  return '30d';
}

/**
 * Classify a board column as 'open', 'inProgress', 'inReview', or 'done'.
 */
function classifyColumn(col: { name: string; isDefault: boolean; isDone: boolean }): string {
  if (col.isDone) return 'done';
  if (col.isDefault) return 'open';
  const lower = col.name.toLowerCase();
  if (lower.includes('review') || lower.includes('testen')) return 'inReview';
  if (lower.includes('progress') || lower.includes('ontwikkeling')) return 'inProgress';
  return 'open';
}

export async function getOrgAnalytics(orgId: string, period: Period) {
  const periodStart = resolvePeriodStart(period);

  // Get all teams and projects in the org
  const teams = await prisma.team.findMany({
    where: { orgId },
    include: {
      members: { include: { user: { select: { id: true, displayName: true } } } },
      projects: {
        include: {
          columns: { select: { id: true, name: true, isDefault: true, isDone: true } },
        },
      },
    },
  });

  // Build column classification map
  const columnClassMap = new Map<string, string>();
  const doneColumnIds = new Set<string>();
  for (const team of teams) {
    for (const project of team.projects) {
      for (const col of project.columns) {
        const cls = classifyColumn(col);
        columnClassMap.set(col.id, cls);
        if (cls === 'done') doneColumnIds.add(col.id);
      }
    }
  }

  const allProjectIds = teams.flatMap((t) => t.projects.map((p) => p.id));

  // ── Workload ──
  const issues = await prisma.issue.findMany({
    where: {
      projectId: { in: allProjectIds },
      assigneeId: { not: null },
      columnId: { not: null },
    },
    select: {
      assigneeId: true,
      columnId: true,
      project: { select: { teamId: true } },
    },
  });

  // Build team name map
  const teamNameMap = new Map<string, string>();
  const teamSlugMap = new Map<string, string>();
  const memberTeamMap = new Map<string, string>(); // userId -> teamId
  for (const team of teams) {
    teamNameMap.set(team.id, team.name);
    teamSlugMap.set(team.id, team.slug);
    for (const m of team.members) {
      memberTeamMap.set(m.user.id, team.id);
    }
  }

  // Build user display name map
  const userNameMap = new Map<string, string>();
  for (const team of teams) {
    for (const m of team.members) {
      userNameMap.set(m.user.id, m.user.displayName);
    }
  }

  // Aggregate workload per member
  const workloadMap = new Map<string, { open: number; inProgress: number; inReview: number }>();
  for (const issue of issues) {
    if (!issue.assigneeId || !issue.columnId) continue;
    const cls = columnClassMap.get(issue.columnId);
    if (!cls || cls === 'done') continue;

    if (!workloadMap.has(issue.assigneeId)) {
      workloadMap.set(issue.assigneeId, { open: 0, inProgress: 0, inReview: 0 });
    }
    const entry = workloadMap.get(issue.assigneeId)!;
    if (cls === 'inProgress') entry.inProgress++;
    else if (cls === 'inReview') entry.inReview++;
    else entry.open++;
  }

  const workload = Array.from(workloadMap.entries()).map(([userId, counts]) => {
    const teamId = memberTeamMap.get(userId);
    return {
      userId,
      displayName: userNameMap.get(userId) ?? 'Unknown',
      teamName: teamId ? teamNameMap.get(teamId) ?? '' : '',
      teamSlug: teamId ? teamSlugMap.get(teamId) ?? '' : '',
      ...counts,
      total: counts.open + counts.inProgress + counts.inReview,
    };
  }).sort((a, b) => b.total - a.total);

  // ── Hours ──
  const timeEntries = await prisma.timeEntry.findMany({
    where: {
      issue: { projectId: { in: allProjectIds } },
      loggedAt: { gte: periodStart },
    },
    select: {
      userId: true,
      minutes: true,
      issue: {
        select: {
          project: {
            select: { id: true, name: true, teamId: true },
          },
        },
      },
    },
  });

  const hoursByMember: Record<string, { userId: string; displayName: string; teamName: string; projectName: string; minutes: number }[]> = {};
  const hoursByTeam = new Map<string, number>();
  let totalMinutes = 0;

  for (const entry of timeEntries) {
    totalMinutes += entry.minutes;

    const teamId = entry.issue.project.teamId;
    hoursByTeam.set(teamId, (hoursByTeam.get(teamId) ?? 0) + entry.minutes);

    const key = `${entry.userId}:${entry.issue.project.id}`;
    if (!hoursByMember[key]) {
      hoursByMember[key] = [];
    }
    // Accumulate into existing entry or create new
    const existing = hoursByMember[key].find((h) => h.projectName === entry.issue.project.name);
    if (existing) {
      existing.minutes += entry.minutes;
    } else {
      hoursByMember[key].push({
        userId: entry.userId,
        displayName: userNameMap.get(entry.userId) ?? 'Unknown',
        teamName: teamNameMap.get(teamId) ?? '',
        projectName: entry.issue.project.name,
        minutes: entry.minutes,
      });
    }
  }

  const hours = {
    totalMinutes,
    byMember: Object.values(hoursByMember).flat().sort((a, b) => b.minutes - a.minutes),
    byTeam: Array.from(hoursByTeam.entries()).map(([teamId, minutes]) => ({
      teamName: teamNameMap.get(teamId) ?? '',
      minutes,
    })),
  };

  // ── Lead Times ──
  const completedIssues = await prisma.issue.findMany({
    where: {
      projectId: { in: allProjectIds },
      columnId: { in: Array.from(doneColumnIds) },
      updatedAt: { gte: periodStart },
      type: { not: 'EPIC' },
    },
    select: {
      createdAt: true,
      updatedAt: true,
      project: { select: { name: true, slug: true, team: { select: { slug: true } } } },
    },
  });

  const leadTimesByProject = new Map<string, { totalDays: number; count: number; teamSlug: string }>();
  for (const issue of completedIssues) {
    const days = (issue.updatedAt.getTime() - issue.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const key = issue.project.slug;
    if (!leadTimesByProject.has(key)) {
      leadTimesByProject.set(key, { totalDays: 0, count: 0, teamSlug: issue.project.team.slug });
    }
    const entry = leadTimesByProject.get(key)!;
    entry.totalDays += days;
    entry.count++;
  }

  const leadTimes = Array.from(leadTimesByProject.entries()).map(([slug, data]) => ({
    projectName: completedIssues.find((i) => i.project.slug === slug)?.project.name ?? slug,
    projectSlug: slug,
    teamSlug: data.teamSlug,
    avgLeadTimeDays: Math.round((data.totalDays / data.count) * 10) / 10,
    issuesCompleted: data.count,
  }));

  // ── Backlog Health ──
  const defaultColumnIds = new Set<string>();
  for (const team of teams) {
    for (const project of team.projects) {
      for (const col of project.columns) {
        if (col.isDefault) defaultColumnIds.add(col.id);
      }
    }
  }

  const backlogIssues = await prisma.issue.findMany({
    where: {
      projectId: { in: allProjectIds },
      columnId: { in: Array.from(defaultColumnIds) },
      type: { not: 'EPIC' },
    },
    select: {
      createdAt: true,
      type: true,
      project: { select: { name: true, slug: true, team: { select: { slug: true } } } },
      labels: { select: { name: true } },
    },
  });

  const backlogByProject = new Map<string, {
    projectName: string;
    teamSlug: string;
    backlogSize: number;
    maintenanceCount: number;
    bugCount: number;
    oldestDate: Date;
  }>();

  for (const issue of backlogIssues) {
    const key = issue.project.slug;
    if (!backlogByProject.has(key)) {
      backlogByProject.set(key, {
        projectName: issue.project.name,
        teamSlug: issue.project.team.slug,
        backlogSize: 0,
        maintenanceCount: 0,
        bugCount: 0,
        oldestDate: issue.createdAt,
      });
    }
    const entry = backlogByProject.get(key)!;
    entry.backlogSize++;
    if (issue.labels.some((l) => l.name === 'onderhoud' || l.name === 'maintenance')) entry.maintenanceCount++;
    if (issue.type === 'BUG' || issue.labels.some((l) => l.name === 'bug')) entry.bugCount++;
    if (issue.createdAt < entry.oldestDate) entry.oldestDate = issue.createdAt;
  }

  const now = new Date();
  const backlog = Array.from(backlogByProject.entries()).map(([slug, data]) => ({
    projectName: data.projectName,
    projectSlug: slug,
    teamSlug: data.teamSlug,
    backlogSize: data.backlogSize,
    maintenanceCount: data.maintenanceCount,
    bugCount: data.bugCount,
    oldestItemDays: Math.round((now.getTime() - data.oldestDate.getTime()) / (1000 * 60 * 60 * 24)),
  })).sort((a, b) => b.backlogSize - a.backlogSize);

  return { workload, hours, leadTimes, backlog };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/analytics/analytics.service.ts
git commit -m "feat(analytics): add org analytics service with workload, hours, lead times, backlog"
```

---

### Task 2: Backend analytics service -- team analytics

**Files:**
- Modify: `src/modules/analytics/analytics.service.ts`

- [ ] **Step 1: Add team analytics function**

Append to `analytics.service.ts` after the `getOrgAnalytics` function:

```typescript
export async function getTeamAnalytics(teamId: string, period: Period) {
  const periodStart = resolvePeriodStart(period);

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      members: { include: { user: { select: { id: true, displayName: true } } } },
      projects: {
        include: {
          columns: { select: { id: true, name: true, isDefault: true, isDone: true } },
        },
      },
    },
  });
  if (!team) throw new AppError(404, 'Team not found');

  // Build column classification map
  const columnClassMap = new Map<string, string>();
  const doneColumnIds = new Set<string>();
  const defaultColumnIds = new Set<string>();
  for (const project of team.projects) {
    for (const col of project.columns) {
      const cls = classifyColumn(col);
      columnClassMap.set(col.id, cls);
      if (cls === 'done') doneColumnIds.add(col.id);
      if (col.isDefault) defaultColumnIds.add(col.id);
    }
  }

  const projectIds = team.projects.map((p) => p.id);
  const projectNameMap = new Map<string, string>();
  const projectSlugMap = new Map<string, string>();
  for (const p of team.projects) {
    projectNameMap.set(p.id, p.name);
    projectSlugMap.set(p.id, p.slug);
  }

  const userNameMap = new Map<string, string>();
  for (const m of team.members) {
    userNameMap.set(m.user.id, m.user.displayName);
  }

  // ── Workload by Member with per-project breakdown ──
  const issues = await prisma.issue.findMany({
    where: {
      projectId: { in: projectIds },
      assigneeId: { not: null },
      columnId: { not: null },
    },
    select: {
      assigneeId: true,
      columnId: true,
      projectId: true,
    },
  });

  const workloadMap = new Map<string, Map<string, { open: number; inProgress: number; inReview: number }>>();
  for (const issue of issues) {
    if (!issue.assigneeId || !issue.columnId) continue;
    const cls = columnClassMap.get(issue.columnId);
    if (!cls || cls === 'done') continue;

    if (!workloadMap.has(issue.assigneeId)) workloadMap.set(issue.assigneeId, new Map());
    const userMap = workloadMap.get(issue.assigneeId)!;
    if (!userMap.has(issue.projectId)) userMap.set(issue.projectId, { open: 0, inProgress: 0, inReview: 0 });
    const entry = userMap.get(issue.projectId)!;
    if (cls === 'inProgress') entry.inProgress++;
    else if (cls === 'inReview') entry.inReview++;
    else entry.open++;
  }

  const workload = Array.from(workloadMap.entries()).map(([userId, projectMap]) => {
    let totalOpen = 0, totalInProgress = 0, totalInReview = 0;
    const projects = Array.from(projectMap.entries()).map(([projectId, counts]) => {
      totalOpen += counts.open;
      totalInProgress += counts.inProgress;
      totalInReview += counts.inReview;
      return {
        projectName: projectNameMap.get(projectId) ?? '',
        projectSlug: projectSlugMap.get(projectId) ?? '',
        ...counts,
        total: counts.open + counts.inProgress + counts.inReview,
      };
    });
    return {
      userId,
      displayName: userNameMap.get(userId) ?? 'Unknown',
      projects,
      totalOpen,
      totalInProgress,
      totalInReview,
      total: totalOpen + totalInProgress + totalInReview,
    };
  }).sort((a, b) => b.total - a.total);

  // ── Hours by Member & Project ──
  const timeEntries = await prisma.timeEntry.findMany({
    where: {
      issue: { projectId: { in: projectIds } },
      loggedAt: { gte: periodStart },
    },
    select: {
      userId: true,
      minutes: true,
      issue: { select: { projectId: true } },
    },
  });

  const hoursPerMemberProject = new Map<string, Map<string, number>>();
  const hoursPerProject = new Map<string, number>();
  let totalMinutes = 0;

  for (const entry of timeEntries) {
    totalMinutes += entry.minutes;
    const pid = entry.issue.projectId;

    hoursPerProject.set(pid, (hoursPerProject.get(pid) ?? 0) + entry.minutes);

    if (!hoursPerMemberProject.has(entry.userId)) hoursPerMemberProject.set(entry.userId, new Map());
    const userMap = hoursPerMemberProject.get(entry.userId)!;
    userMap.set(pid, (userMap.get(pid) ?? 0) + entry.minutes);
  }

  const hoursByMember = Array.from(hoursPerMemberProject.entries()).map(([userId, projectMap]) => ({
    userId,
    displayName: userNameMap.get(userId) ?? 'Unknown',
    byProject: Array.from(projectMap.entries()).map(([pid, minutes]) => ({
      projectName: projectNameMap.get(pid) ?? '',
      projectSlug: projectSlugMap.get(pid) ?? '',
      minutes,
    })),
    totalMinutes: Array.from(projectMap.values()).reduce((a, b) => a + b, 0),
  })).sort((a, b) => b.totalMinutes - a.totalMinutes);

  const hours = {
    totalMinutes,
    byMember: hoursByMember,
    byProject: Array.from(hoursPerProject.entries()).map(([pid, minutes]) => ({
      projectName: projectNameMap.get(pid) ?? '',
      projectSlug: projectSlugMap.get(pid) ?? '',
      minutes,
    })),
  };

  // ── Lead Times by Project with type breakdown ──
  const completedIssues = await prisma.issue.findMany({
    where: {
      projectId: { in: projectIds },
      columnId: { in: Array.from(doneColumnIds) },
      updatedAt: { gte: periodStart },
      type: { not: 'EPIC' },
    },
    select: {
      createdAt: true,
      updatedAt: true,
      type: true,
      projectId: true,
    },
  });

  const leadTimeData = new Map<string, Map<string, { totalDays: number; count: number }>>();
  for (const issue of completedIssues) {
    const days = (issue.updatedAt.getTime() - issue.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    const pid = issue.projectId;

    if (!leadTimeData.has(pid)) leadTimeData.set(pid, new Map());
    const typeMap = leadTimeData.get(pid)!;

    // Overall
    if (!typeMap.has('ALL')) typeMap.set('ALL', { totalDays: 0, count: 0 });
    const all = typeMap.get('ALL')!;
    all.totalDays += days;
    all.count++;

    // By type
    if (!typeMap.has(issue.type)) typeMap.set(issue.type, { totalDays: 0, count: 0 });
    const byType = typeMap.get(issue.type)!;
    byType.totalDays += days;
    byType.count++;
  }

  const leadTimes = Array.from(leadTimeData.entries()).map(([pid, typeMap]) => {
    const all = typeMap.get('ALL') ?? { totalDays: 0, count: 0 };
    const byType: Record<string, { avgLeadTimeDays: number; count: number }> = {};
    for (const [type, data] of typeMap.entries()) {
      if (type === 'ALL') continue;
      byType[type] = {
        avgLeadTimeDays: Math.round((data.totalDays / data.count) * 10) / 10,
        count: data.count,
      };
    }
    return {
      projectName: projectNameMap.get(pid) ?? '',
      projectSlug: projectSlugMap.get(pid) ?? '',
      avgLeadTimeDays: all.count > 0 ? Math.round((all.totalDays / all.count) * 10) / 10 : 0,
      issuesCompleted: all.count,
      byType,
    };
  });

  // ── Backlog by Project with issues ──
  const backlogIssues = await prisma.issue.findMany({
    where: {
      projectId: { in: projectIds },
      columnId: { in: Array.from(defaultColumnIds) },
      type: { not: 'EPIC' },
    },
    select: {
      id: true,
      number: true,
      title: true,
      type: true,
      priority: true,
      createdAt: true,
      projectId: true,
      labels: { select: { name: true } },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });

  const backlogByProject = new Map<string, {
    backlogSize: number;
    maintenanceCount: number;
    bugCount: number;
    oldestDate: Date;
    issues: typeof backlogIssues;
  }>();

  const now = new Date();
  for (const issue of backlogIssues) {
    const pid = issue.projectId;
    if (!backlogByProject.has(pid)) {
      backlogByProject.set(pid, { backlogSize: 0, maintenanceCount: 0, bugCount: 0, oldestDate: issue.createdAt, issues: [] });
    }
    const entry = backlogByProject.get(pid)!;
    entry.backlogSize++;
    entry.issues.push(issue);
    if (issue.labels.some((l) => l.name === 'onderhoud' || l.name === 'maintenance')) entry.maintenanceCount++;
    if (issue.type === 'BUG' || issue.labels.some((l) => l.name === 'bug')) entry.bugCount++;
    if (issue.createdAt < entry.oldestDate) entry.oldestDate = issue.createdAt;
  }

  const backlog = Array.from(backlogByProject.entries()).map(([pid, data]) => ({
    projectName: projectNameMap.get(pid) ?? '',
    projectSlug: projectSlugMap.get(pid) ?? '',
    backlogSize: data.backlogSize,
    maintenanceCount: data.maintenanceCount,
    bugCount: data.bugCount,
    oldestItemDays: Math.round((now.getTime() - data.oldestDate.getTime()) / (1000 * 60 * 60 * 24)),
    issues: data.issues.map((i) => ({
      id: i.id,
      number: i.number,
      title: i.title,
      type: i.type,
      priority: i.priority,
      ageDays: Math.round((now.getTime() - i.createdAt.getTime()) / (1000 * 60 * 60 * 24)),
      labels: i.labels.map((l) => l.name),
    })),
  })).sort((a, b) => b.backlogSize - a.backlogSize);

  return { workload, hours, leadTimes, backlog };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/analytics/analytics.service.ts
git commit -m "feat(analytics): add team analytics service with per-project breakdown"
```

---

### Task 3: Backend analytics controller and routes

**Files:**
- Create: `src/modules/analytics/analytics.controller.ts`
- Create: `src/modules/analytics/analytics.routes.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Create the controller**

```typescript
// src/modules/analytics/analytics.controller.ts
import { Request, Response } from 'express';

import { asyncHandler } from '../../middleware/errorHandler';
import { param } from '../../utils/params';

import * as analyticsService from './analytics.service';

export const getOrgAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const orgId = param(req, 'orgId');
  const period = analyticsService.parsePeriod(req.query.period as string | undefined);
  const data = await analyticsService.getOrgAnalytics(orgId, period);
  res.json(data);
});

export const getTeamAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const teamId = param(req, 'teamId');
  const period = analyticsService.parsePeriod(req.query.period as string | undefined);
  const data = await analyticsService.getTeamAnalytics(teamId, period);
  res.json(data);
});
```

- [ ] **Step 2: Create the routes**

```typescript
// src/modules/analytics/analytics.routes.ts
import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import { requireOrgPermission, requireTeamPermission } from '../../middleware/rbac';

import * as analyticsController from './analytics.controller';

const router = Router();

router.use(authenticate);

// Org-level analytics -- any org member can view
router.get('/orgs/:orgId/analytics', requireOrgPermission('org:read'), analyticsController.getOrgAnalytics);

// Team-level analytics -- any team member can view
router.get('/teams/:teamId/analytics', requireTeamPermission('team:read'), analyticsController.getTeamAnalytics);

export default router;
```

- [ ] **Step 3: Mount routes in src/index.ts**

Add after the existing admin routes (around line 155):

```typescript
import analyticsRoutes from './modules/analytics/analytics.routes';
```

And in the route mounting section:

```typescript
app.use('/api', analyticsRoutes);
```

- [ ] **Step 4: Verify backend compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/analytics/analytics.controller.ts src/modules/analytics/analytics.routes.ts src/index.ts
git commit -m "feat(analytics): add analytics controller, routes, and mount in app"
```

---

### Task 4: Backend analytics test

**Files:**
- Create: `src/modules/analytics/analytics.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';

import app from '../../index';
import { prisma } from '../../config/database';
import { getTestToken } from '../../test-utils/auth';

describe('Analytics API', () => {
  let token: string;
  let orgId: string;
  let teamId: string;

  beforeAll(async () => {
    // Use existing seeded data (tim user, aranea-dev org, axiom team)
    token = await getTestToken('tim', 'password123');

    const org = await prisma.organization.findUnique({ where: { slug: 'aranea-dev' } });
    expect(org).toBeTruthy();
    orgId = org!.id;

    const team = await prisma.team.findFirst({ where: { orgId: org!.id, slug: 'axiom' } });
    expect(team).toBeTruthy();
    teamId = team!.id;
  });

  describe('GET /api/orgs/:orgId/analytics', () => {
    it('should return org analytics with all sections', async () => {
      const res = await request(app)
        .get(`/api/orgs/${orgId}/analytics`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('workload');
      expect(res.body).toHaveProperty('hours');
      expect(res.body).toHaveProperty('leadTimes');
      expect(res.body).toHaveProperty('backlog');
      expect(Array.isArray(res.body.workload)).toBe(true);
      expect(res.body.hours).toHaveProperty('totalMinutes');
      expect(Array.isArray(res.body.leadTimes)).toBe(true);
      expect(Array.isArray(res.body.backlog)).toBe(true);
    });

    it('should accept period query parameter', async () => {
      const res = await request(app)
        .get(`/api/orgs/${orgId}/analytics?period=7d`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
    });

    it('should require authentication', async () => {
      const res = await request(app).get(`/api/orgs/${orgId}/analytics`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/teams/:teamId/analytics', () => {
    it('should return team analytics with per-project breakdown', async () => {
      const res = await request(app)
        .get(`/api/teams/${teamId}/analytics`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('workload');
      expect(res.body).toHaveProperty('hours');
      expect(res.body).toHaveProperty('leadTimes');
      expect(res.body).toHaveProperty('backlog');

      // Team analytics should have byMember with byProject breakdown
      expect(res.body.hours).toHaveProperty('byMember');
      expect(res.body.hours).toHaveProperty('byProject');
    });

    it('should require authentication', async () => {
      const res = await request(app).get(`/api/teams/${teamId}/analytics`);
      expect(res.status).toBe(401);
    });
  });
});
```

- [ ] **Step 2: Check if test-utils/auth exists, adapt if needed**

Run: `ls src/test-utils/ 2>/dev/null || echo "no test-utils dir"`

If it doesn't exist, look at existing test files to see how they get auth tokens. Check `src/modules/issues/issues.test.ts` for the pattern and adapt the test accordingly.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/modules/analytics/analytics.test.ts`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/modules/analytics/analytics.test.ts
git commit -m "test(analytics): add integration tests for org and team analytics"
```

---

### Task 5: Frontend API client and types

**Files:**
- Create: `frontend/src/api/analytics.api.ts`

- [ ] **Step 1: Create the API client with types**

```typescript
import { get } from './client';

export interface WorkloadEntry {
  userId: string;
  displayName: string;
  teamName: string;
  teamSlug: string;
  open: number;
  inProgress: number;
  inReview: number;
  total: number;
}

export interface HoursEntry {
  userId: string;
  displayName: string;
  teamName: string;
  projectName: string;
  minutes: number;
}

export interface OrgHours {
  totalMinutes: number;
  byMember: HoursEntry[];
  byTeam: { teamName: string; minutes: number }[];
}

export interface LeadTimeEntry {
  projectName: string;
  projectSlug: string;
  teamSlug: string;
  avgLeadTimeDays: number;
  issuesCompleted: number;
}

export interface BacklogEntry {
  projectName: string;
  projectSlug: string;
  teamSlug: string;
  backlogSize: number;
  maintenanceCount: number;
  bugCount: number;
  oldestItemDays: number;
}

export interface OrgAnalytics {
  workload: WorkloadEntry[];
  hours: OrgHours;
  leadTimes: LeadTimeEntry[];
  backlog: BacklogEntry[];
}

// Team-level types (more granular)
export interface TeamWorkloadProject {
  projectName: string;
  projectSlug: string;
  open: number;
  inProgress: number;
  inReview: number;
  total: number;
}

export interface TeamWorkloadEntry {
  userId: string;
  displayName: string;
  projects: TeamWorkloadProject[];
  totalOpen: number;
  totalInProgress: number;
  totalInReview: number;
  total: number;
}

export interface TeamHoursMember {
  userId: string;
  displayName: string;
  byProject: { projectName: string; projectSlug: string; minutes: number }[];
  totalMinutes: number;
}

export interface TeamHours {
  totalMinutes: number;
  byMember: TeamHoursMember[];
  byProject: { projectName: string; projectSlug: string; minutes: number }[];
}

export interface TeamLeadTimeEntry {
  projectName: string;
  projectSlug: string;
  avgLeadTimeDays: number;
  issuesCompleted: number;
  byType: Record<string, { avgLeadTimeDays: number; count: number }>;
}

export interface BacklogIssue {
  id: string;
  number: number;
  title: string;
  type: string;
  priority: string;
  ageDays: number;
  labels: string[];
}

export interface TeamBacklogEntry {
  projectName: string;
  projectSlug: string;
  backlogSize: number;
  maintenanceCount: number;
  bugCount: number;
  oldestItemDays: number;
  issues: BacklogIssue[];
}

export interface TeamAnalytics {
  workload: TeamWorkloadEntry[];
  hours: TeamHours;
  leadTimes: TeamLeadTimeEntry[];
  backlog: TeamBacklogEntry[];
}

export type Period = '7d' | '30d' | '90d' | 'quarter';

export const analyticsApi = {
  orgAnalytics: (orgId: string, period: Period = '30d') =>
    get<OrgAnalytics>(`/orgs/${orgId}/analytics?period=${period}`),

  teamAnalytics: (teamId: string, period: Period = '30d') =>
    get<TeamAnalytics>(`/teams/${teamId}/analytics?period=${period}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/analytics.api.ts
git commit -m "feat(analytics): add frontend API client and TypeScript types"
```

---

### Task 6: PeriodSelector shared component

**Files:**
- Create: `frontend/src/components/ui/PeriodSelector.tsx`

- [ ] **Step 1: Create the component**

```typescript
import { ChevronDown } from 'lucide-react';

import type { Period } from '@/api/analytics.api';
import { cn } from '@/lib/utils';

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'quarter', label: 'This quarter' },
];

interface PeriodSelectorProps {
  value: Period;
  onChange: (period: Period) => void;
  className?: string;
}

export function PeriodSelector({ value, onChange, className }: PeriodSelectorProps) {
  return (
    <div className={cn('relative inline-block', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Period)}
        className="appearance-none rounded-md border border-[var(--color-border)] bg-[var(--color-surface-primary)] px-3 py-1.5 pr-8 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      >
        {PERIOD_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-secondary)]" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ui/PeriodSelector.tsx
git commit -m "feat(ui): add PeriodSelector component"
```

---

### Task 7: OrgAnalytics page

**Files:**
- Create: `frontend/src/pages/analytics/OrgAnalytics.tsx`

- [ ] **Step 1: Create the org analytics page**

```typescript
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Clock,
  Timer,
  Archive,
  BarChart3,
  ArrowRight,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import { analyticsApi } from '@/api/analytics.api';
import type { Period } from '@/api/analytics.api';
import { orgsApi } from '@/api/orgs.api';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { PeriodSelector } from '@/components/ui/PeriodSelector';
import { STABLE_STALE_TIME } from '@/lib/constants';
import { cn } from '@/lib/utils';

function formatMinutes(m: number): string {
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function loadColor(total: number): string {
  if (total >= 8) return 'text-[var(--color-error)]';
  if (total >= 5) return 'text-[var(--color-warning)]';
  return 'text-[var(--color-success)]';
}

function ageColor(days: number): string {
  if (days >= 30) return 'text-[var(--color-error)]';
  if (days >= 14) return 'text-[var(--color-warning)]';
  return 'text-[var(--color-text-secondary)]';
}

export default function OrgAnalytics() {
  const { org } = useParams();
  const [period, setPeriod] = useState<Period>('30d');

  const { data: orgs } = useQuery({
    queryKey: ['orgs'],
    queryFn: orgsApi.list,
    staleTime: STABLE_STALE_TIME,
  });
  const currentOrg = orgs?.find((o) => o.slug === org);

  const { data, isLoading } = useQuery({
    queryKey: ['org-analytics', currentOrg?.id, period],
    queryFn: () => analyticsApi.orgAnalytics(currentOrg!.id, period),
    enabled: !!currentOrg?.id,
  });

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-surface-secondary)]" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-lg bg-[var(--color-surface-secondary)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-[var(--color-text-secondary)]" />
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            Organization Analytics
          </h1>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Workload Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Workload Overview</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.workload.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No assigned issues found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                  <th className="pb-2 font-medium">Member</th>
                  <th className="pb-2 font-medium">Team</th>
                  <th className="pb-2 text-right font-medium">Open</th>
                  <th className="pb-2 text-right font-medium">In Progress</th>
                  <th className="pb-2 text-right font-medium">In Review</th>
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.workload.map((w) => (
                  <tr key={w.userId} className="border-b border-[var(--color-border-subtle)]">
                    <td className="py-2 font-medium text-[var(--color-text-primary)]">{w.displayName}</td>
                    <td className="py-2">
                      <Link
                        to={`/${org}/${w.teamSlug}/analytics`}
                        className="text-[var(--color-accent)] hover:underline"
                      >
                        {w.teamName}
                      </Link>
                    </td>
                    <td className="py-2 text-right">{w.open}</td>
                    <td className="py-2 text-right">{w.inProgress}</td>
                    <td className="py-2 text-right">{w.inReview}</td>
                    <td className={cn('py-2 text-right font-semibold', loadColor(w.total))}>{w.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Hours Spent */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Hours Spent</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex gap-4">
            <div className="rounded-md bg-[var(--color-surface-secondary)] px-4 py-2">
              <p className="text-xs text-[var(--color-text-tertiary)]">Total</p>
              <p className="text-lg font-semibold text-[var(--color-text-primary)]">{formatMinutes(data.hours.totalMinutes)}</p>
            </div>
            {data.hours.byTeam.map((t) => (
              <div key={t.teamName} className="rounded-md bg-[var(--color-surface-secondary)] px-4 py-2">
                <p className="text-xs text-[var(--color-text-tertiary)]">{t.teamName}</p>
                <p className="text-lg font-semibold text-[var(--color-text-primary)]">{formatMinutes(t.minutes)}</p>
              </div>
            ))}
          </div>
          {data.hours.byMember.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                  <th className="pb-2 font-medium">Member</th>
                  <th className="pb-2 font-medium">Team</th>
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody>
                {data.hours.byMember.map((h, i) => (
                  <tr key={i} className="border-b border-[var(--color-border-subtle)]">
                    <td className="py-2 text-[var(--color-text-primary)]">{h.displayName}</td>
                    <td className="py-2">{h.teamName}</td>
                    <td className="py-2">{h.projectName}</td>
                    <td className="py-2 text-right font-medium">{formatMinutes(h.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Lead Times */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Lead Times</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.leadTimes.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No completed issues in this period.</p>
          ) : (
            <>
              <table className="mb-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                    <th className="pb-2 font-medium">Project</th>
                    <th className="pb-2 text-right font-medium">Avg Lead Time</th>
                    <th className="pb-2 text-right font-medium">Completed</th>
                    <th className="pb-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.leadTimes.map((lt) => (
                    <tr key={lt.projectSlug} className="border-b border-[var(--color-border-subtle)]">
                      <td className="py-2 font-medium text-[var(--color-text-primary)]">{lt.projectName}</td>
                      <td className="py-2 text-right">{lt.avgLeadTimeDays}d</td>
                      <td className="py-2 text-right">{lt.issuesCompleted}</td>
                      <td className="py-2 text-right">
                        <Link
                          to={`/${org}/${lt.teamSlug}/analytics`}
                          className="inline-flex items-center gap-1 text-[var(--color-accent)] hover:underline"
                        >
                          Details <ArrowRight className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Bar chart */}
              <div className="space-y-2">
                {data.leadTimes.map((lt) => {
                  const max = Math.max(...data.leadTimes.map((l) => l.avgLeadTimeDays));
                  const pct = max > 0 ? (lt.avgLeadTimeDays / max) * 100 : 0;
                  return (
                    <div key={lt.projectSlug} className="flex items-center gap-3">
                      <span className="w-32 truncate text-xs text-[var(--color-text-secondary)]">{lt.projectName}</span>
                      <div className="h-4 flex-1 rounded-full bg-[var(--color-surface-secondary)]">
                        <div
                          className="h-full rounded-full bg-[var(--color-accent)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-xs font-medium">{lt.avgLeadTimeDays}d</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Backlog Health */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Backlog Health</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.backlog.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No backlog items found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 text-right font-medium">Backlog</th>
                  <th className="pb-2 text-right font-medium">Maintenance</th>
                  <th className="pb-2 text-right font-medium">Bugs</th>
                  <th className="pb-2 text-right font-medium">Oldest</th>
                </tr>
              </thead>
              <tbody>
                {data.backlog.map((b) => (
                  <tr key={b.projectSlug} className="border-b border-[var(--color-border-subtle)]">
                    <td className="py-2 font-medium text-[var(--color-text-primary)]">{b.projectName}</td>
                    <td className="py-2 text-right">{b.backlogSize}</td>
                    <td className="py-2 text-right">{b.maintenanceCount}</td>
                    <td className="py-2 text-right">{b.bugCount}</td>
                    <td className={cn('py-2 text-right', ageColor(b.oldestItemDays))}>{b.oldestItemDays}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/analytics/OrgAnalytics.tsx
git commit -m "feat(analytics): add OrgAnalytics page with workload, hours, lead times, backlog"
```

---

### Task 8: TeamAnalytics page

**Files:**
- Create: `frontend/src/pages/analytics/TeamAnalytics.tsx`

- [ ] **Step 1: Create the team analytics page**

```typescript
import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Clock,
  Timer,
  Archive,
  BarChart3,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';

import { analyticsApi } from '@/api/analytics.api';
import type { Period } from '@/api/analytics.api';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { PeriodSelector } from '@/components/ui/PeriodSelector';
import { useTeamContext } from '@/hooks/useTeamContext';
import { cn } from '@/lib/utils';

function formatMinutes(m: number): string {
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function loadColor(total: number): string {
  if (total >= 8) return 'text-[var(--color-error)]';
  if (total >= 5) return 'text-[var(--color-warning)]';
  return 'text-[var(--color-success)]';
}

function ageColor(days: number): string {
  if (days >= 30) return 'text-[var(--color-error)]';
  if (days >= 14) return 'text-[var(--color-warning)]';
  return 'text-[var(--color-text-secondary)]';
}

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'text-[var(--color-error)]',
  HIGH: 'text-[var(--color-warning)]',
  MEDIUM: 'text-[var(--color-text-primary)]',
  LOW: 'text-[var(--color-text-tertiary)]',
};

export default function TeamAnalytics() {
  const { org } = useParams();
  const { currentTeam } = useTeamContext();
  const [period, setPeriod] = useState<Period>('30d');
  const [expandedMembers, setExpandedMembers] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['team-analytics', currentTeam?.id, period],
    queryFn: () => analyticsApi.teamAnalytics(currentTeam!.id, period),
    enabled: !!currentTeam?.id,
  });

  const toggleMember = (userId: string) => {
    setExpandedMembers((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleProject = (slug: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-[var(--color-surface-secondary)]" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-lg bg-[var(--color-surface-secondary)]" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-[var(--color-text-secondary)]" />
          <h1 className="text-2xl font-semibold text-[var(--color-text-primary)]">
            {currentTeam?.name} Analytics
          </h1>
        </div>
        <PeriodSelector value={period} onChange={setPeriod} />
      </div>

      {/* Workload by Member */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Workload by Member</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.workload.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No assigned issues found.</p>
          ) : (
            <div className="space-y-1">
              {data.workload.map((w) => (
                <div key={w.userId}>
                  <button
                    onClick={() => toggleMember(w.userId)}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[var(--color-surface-secondary)]"
                  >
                    {expandedMembers.has(w.userId) ? (
                      <ChevronDown className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    )}
                    <span className="flex-1 font-medium text-[var(--color-text-primary)]">{w.displayName}</span>
                    <span className="w-16 text-right text-[var(--color-text-secondary)]">Open: {w.totalOpen}</span>
                    <span className="w-24 text-right text-[var(--color-text-secondary)]">In Progress: {w.totalInProgress}</span>
                    <span className="w-20 text-right text-[var(--color-text-secondary)]">Review: {w.totalInReview}</span>
                    <span className={cn('w-16 text-right font-semibold', loadColor(w.total))}>{w.total}</span>
                  </button>
                  {expandedMembers.has(w.userId) && (
                    <div className="ml-8 space-y-1 pb-2">
                      {w.projects.map((p) => (
                        <div key={p.projectSlug} className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                          <span className="flex-1">{p.projectName}</span>
                          <span className="w-16 text-right">Open: {p.open}</span>
                          <span className="w-24 text-right">In Progress: {p.inProgress}</span>
                          <span className="w-20 text-right">Review: {p.inReview}</span>
                          <span className="w-16 text-right font-medium">{p.total}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hours by Member & Project */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Hours by Member & Project</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-md bg-[var(--color-surface-secondary)] px-4 py-2 inline-block">
            <p className="text-xs text-[var(--color-text-tertiary)]">Total</p>
            <p className="text-lg font-semibold text-[var(--color-text-primary)]">{formatMinutes(data.hours.totalMinutes)}</p>
          </div>
          {data.hours.byMember.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                  <th className="pb-2 font-medium">Member</th>
                  {data.hours.byProject.map((p) => (
                    <th key={p.projectSlug} className="pb-2 text-right font-medium">{p.projectName}</th>
                  ))}
                  <th className="pb-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.hours.byMember.map((m) => (
                  <tr key={m.userId} className="border-b border-[var(--color-border-subtle)]">
                    <td className="py-2 font-medium text-[var(--color-text-primary)]">{m.displayName}</td>
                    {data.hours.byProject.map((p) => {
                      const entry = m.byProject.find((bp) => bp.projectSlug === p.projectSlug);
                      return (
                        <td key={p.projectSlug} className="py-2 text-right">
                          {entry ? formatMinutes(entry.minutes) : '-'}
                        </td>
                      );
                    })}
                    <td className="py-2 text-right font-semibold">{formatMinutes(m.totalMinutes)}</td>
                  </tr>
                ))}
                <tr className="border-t border-[var(--color-border)] font-semibold">
                  <td className="py-2">Total</td>
                  {data.hours.byProject.map((p) => (
                    <td key={p.projectSlug} className="py-2 text-right">{formatMinutes(p.minutes)}</td>
                  ))}
                  <td className="py-2 text-right">{formatMinutes(data.hours.totalMinutes)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Lead Times by Project */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Timer className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Lead Times by Project</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.leadTimes.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No completed issues in this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-secondary)]">
                  <th className="pb-2 font-medium">Project</th>
                  <th className="pb-2 text-right font-medium">Avg Lead Time</th>
                  <th className="pb-2 text-right font-medium">Completed</th>
                  <th className="pb-2 text-right font-medium">Task</th>
                  <th className="pb-2 text-right font-medium">Bug</th>
                  <th className="pb-2 text-right font-medium">Story</th>
                </tr>
              </thead>
              <tbody>
                {data.leadTimes.map((lt) => (
                  <tr key={lt.projectSlug} className="border-b border-[var(--color-border-subtle)]">
                    <td className="py-2 font-medium text-[var(--color-text-primary)]">{lt.projectName}</td>
                    <td className="py-2 text-right">{lt.avgLeadTimeDays}d</td>
                    <td className="py-2 text-right">{lt.issuesCompleted}</td>
                    <td className="py-2 text-right text-[var(--color-text-secondary)]">
                      {lt.byType.TASK ? `${lt.byType.TASK.avgLeadTimeDays}d (${lt.byType.TASK.count})` : '-'}
                    </td>
                    <td className="py-2 text-right text-[var(--color-text-secondary)]">
                      {lt.byType.BUG ? `${lt.byType.BUG.avgLeadTimeDays}d (${lt.byType.BUG.count})` : '-'}
                    </td>
                    <td className="py-2 text-right text-[var(--color-text-secondary)]">
                      {lt.byType.STORY ? `${lt.byType.STORY.avgLeadTimeDays}d (${lt.byType.STORY.count})` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Backlog by Project */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-[var(--color-text-secondary)]" />
            <h2 className="text-lg font-medium">Backlog by Project</h2>
          </div>
        </CardHeader>
        <CardContent>
          {data.backlog.length === 0 ? (
            <p className="text-sm text-[var(--color-text-tertiary)]">No backlog items found.</p>
          ) : (
            <div className="space-y-1">
              {data.backlog.map((b) => (
                <div key={b.projectSlug}>
                  <button
                    onClick={() => toggleProject(b.projectSlug)}
                    className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm hover:bg-[var(--color-surface-secondary)]"
                  >
                    {expandedProjects.has(b.projectSlug) ? (
                      <ChevronDown className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-[var(--color-text-tertiary)]" />
                    )}
                    <span className="flex-1 font-medium text-[var(--color-text-primary)]">{b.projectName}</span>
                    <span className="text-[var(--color-text-secondary)]">{b.backlogSize} items</span>
                    <span className="text-[var(--color-text-secondary)]">{b.maintenanceCount} maintenance</span>
                    <span className="text-[var(--color-text-secondary)]">{b.bugCount} bugs</span>
                    <span className={cn(ageColor(b.oldestItemDays))}>oldest: {b.oldestItemDays}d</span>
                  </button>
                  {expandedProjects.has(b.projectSlug) && (
                    <div className="ml-8 space-y-1 pb-2">
                      {b.issues.map((issue) => (
                        <div key={issue.id} className="flex items-center gap-2 text-xs">
                          <span className={cn('w-16', PRIORITY_COLORS[issue.priority] ?? '')}>{issue.priority}</span>
                          <span className="w-12 text-[var(--color-text-tertiary)]">{issue.type}</span>
                          <span className="flex-1 text-[var(--color-text-primary)]">{issue.title}</span>
                          <span className={cn('w-12 text-right', ageColor(issue.ageDays))}>{issue.ageDays}d</span>
                          {issue.labels.length > 0 && (
                            <span className="text-[var(--color-text-tertiary)]">{issue.labels.join(', ')}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/analytics/TeamAnalytics.tsx
git commit -m "feat(analytics): add TeamAnalytics page with per-project/per-member breakdown"
```

---

### Task 9: Add frontend routes and navigation links

**Files:**
- Modify: `frontend/src/routes/project-routes.tsx`
- Modify: `frontend/src/pages/teams/TeamList.tsx`
- Modify: `frontend/src/pages/teams/TeamDetail.tsx`

- [ ] **Step 1: Add routes to project-routes.tsx**

Add lazy imports at the top of the file (after existing lazy imports):

```typescript
const OrgAnalytics = lazy(() => import('@/pages/analytics/OrgAnalytics'));
const TeamAnalytics = lazy(() => import('@/pages/analytics/TeamAnalytics'));
```

Add routes inside the `projectRoutes()` function, BEFORE the `<Route path="/:org/:team/:project"` block (these are org/team level, not project level):

```tsx
{/* Org and Team analytics -- outside project layout */}
<Route
  path="/:org/analytics"
  element={
    <ErrorBoundary>
      <OrgAnalytics />
    </ErrorBoundary>
  }
/>
<Route
  path="/:org/:team/analytics"
  element={
    <ErrorBoundary>
      <TeamAnalytics />
    </ErrorBoundary>
  }
/>
```

- [ ] **Step 2: Add analytics button to TeamList.tsx (org page)**

Read the current file, then add a `BarChart3` icon import and an analytics link button next to the "Create Team" button in the header. Add import:

```typescript
import { BarChart3 } from 'lucide-react';
```

And add a Link next to the existing create button:

```tsx
<Link to={`/${org}/analytics`}>
  <Button variant="outline" size="sm">
    <BarChart3 className="mr-1.5 h-4 w-4" />
    Analytics
  </Button>
</Link>
```

- [ ] **Step 3: Add analytics button to TeamDetail.tsx (team page)**

Read the current file, then add a `BarChart3` icon import and an analytics link button. Add import:

```typescript
import { BarChart3 } from 'lucide-react';
```

And add a Link in the header area:

```tsx
<Link to={`/${org}/${teamSlug}/analytics`}>
  <Button variant="outline" size="sm">
    <BarChart3 className="mr-1.5 h-4 w-4" />
    Analytics
  </Button>
</Link>
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/routes/project-routes.tsx frontend/src/pages/teams/TeamList.tsx frontend/src/pages/teams/TeamDetail.tsx
git commit -m "feat(analytics): add routes and navigation links for org/team analytics"
```

---

### Task 10: Full verification

**Files:**
- No changes (verification only)

- [ ] **Step 1: Run backend typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run backend tests**

Run: `npm run test`
Expected: All tests pass including new analytics tests

- [ ] **Step 4: Verify in browser**

1. Login as `erik / password123`
2. Navigate to Voorbeeld org page -- verify "Analytics" button appears
3. Click Analytics -- verify OrgAnalytics page loads with all 4 sections
4. Change period selector -- verify data updates
5. Click a team link -- verify TeamAnalytics page loads
6. Expand workload member rows -- verify per-project breakdown
7. Expand backlog project rows -- verify individual issues
8. Login as `tim / password123` -- verify analytics works for both orgs

- [ ] **Step 5: Commit any fixes**

If issues found:

```bash
git add -A
git commit -m "fix(analytics): address issues found during verification"
```
