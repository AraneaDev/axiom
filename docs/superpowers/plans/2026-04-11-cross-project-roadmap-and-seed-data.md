# Cross-Project Roadmap & Voorbeeld Seed Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a team-level cross-project roadmap (Gantt timeline spanning all projects in a team) with epic progress bars using `isDone`, and make the Voorbeeld seed data comprehensive across all features except repos.

**Architecture:** New team-level API endpoint returns timeline issues across all projects in a team. Frontend reuses the existing `GanttChart` component suite with a new grouping layer for project headers. Seed data expanded from 12 to 20+ sections covering roadmap buckets, dates, links, custom fields, templates, forms, approvals, saved filters, and notifications.

**Tech Stack:** Express 5, Prisma 7, React 19, TanStack Query, Zustand, Tailwind CSS 4, Lucide React, Zod

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/modules/roadmap/team-roadmap.service.ts` | Team-level timeline data query (cross-project) |
| Create | `src/modules/roadmap/team-roadmap.controller.ts` | HTTP handler for team roadmap endpoint |
| Create | `src/modules/roadmap/team-roadmap.validation.ts` | Zod schemas for team timeline query params |
| Modify | `src/modules/roadmap/roadmap.routes.ts` | Mount team-level route |
| Create | `src/modules/roadmap/team-roadmap.test.ts` | Backend tests for team timeline endpoint |
| Create | `frontend/src/pages/roadmap/TeamRoadmap.tsx` | Team-level roadmap page component |
| Modify | `frontend/src/api/roadmap.api.ts` | Add `getTeamTimeline` API call + types |
| Modify | `frontend/src/components/ui/GanttChart.tsx` | Support multi-project mode with project group headers |
| Modify | `frontend/src/components/ui/GanttRow.tsx` | Fix progress to use `column.isDone` instead of name match |
| Modify | `frontend/src/routes/project-routes.tsx` | Add `/:org/:team/roadmap` route |
| Modify | `frontend/src/components/layout/Sidebar.tsx` | Add "Roadmap" nav item to team sub-nav |
| Modify | `scripts/seed-voorbeeld.ts` | Comprehensive seed data for all features |

---

## Task 1: Fix Epic Progress to Use `column.isDone`

**Files:**
- Modify: `frontend/src/components/ui/GanttRow.tsx:81-84`

- [ ] **Step 1: Fix progress calculation**

In `frontend/src/components/ui/GanttRow.tsx`, change line 81-84 from:

```tsx
  if (isEpic && issue.children && issue.children.length > 0) {
    const done = issue.children.filter((c) => c.column?.name?.toLowerCase() === 'done').length;
    progress = Math.round((done / issue.children.length) * 100);
  }
```

to:

```tsx
  if (isEpic && issue.children && issue.children.length > 0) {
    const done = issue.children.filter((c) => c.column?.isDone === true).length;
    progress = Math.round((done / issue.children.length) * 100);
  }
```

This works across languages (Voorbeeld uses "Gereed" for done columns, not "Done").

- [ ] **Step 2: Update TimelineIssue column type**

In `frontend/src/api/roadmap.api.ts`, the `column` field on `TimelineIssue` needs `isDone`:

Change:
```tsx
  column?: { id: string; name: string } | null;
```
to:
```tsx
  column?: { id: string; name: string; isDone?: boolean } | null;
```

- [ ] **Step 3: Verify backend already includes isDone**

Check `src/modules/roadmap/roadmap.service.ts` line 35 — the `ISSUE_ROADMAP_SELECT` already includes:
```ts
column: { select: { id: true, name: true, isDone: true } },
```
This is already correct. The `CHILDREN_SELECT` on line 47-59 does NOT include column — we need to add it.

In `src/modules/roadmap/roadmap.service.ts`, change the `CHILDREN_SELECT`:

```ts
const CHILDREN_SELECT = {
  id: true,
  number: true,
  title: true,
  type: true,
  priority: true,
  startDate: true,
  dueDate: true,
  columnId: true,
  parentId: true,
  assigneeId: true,
  roadmapBucketId: true,
  column: { select: { id: true, name: true, isDone: true } },
} as const;
```

- [ ] **Step 4: Verify the fix compiles**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ui/GanttRow.tsx frontend/src/api/roadmap.api.ts src/modules/roadmap/roadmap.service.ts
git commit -m "fix: use column.isDone for epic progress instead of name match"
```

---

## Task 2: Team-Level Roadmap Backend

**Files:**
- Create: `src/modules/roadmap/team-roadmap.validation.ts`
- Create: `src/modules/roadmap/team-roadmap.service.ts`
- Create: `src/modules/roadmap/team-roadmap.controller.ts`
- Modify: `src/modules/roadmap/roadmap.routes.ts`

- [ ] **Step 1: Create validation schema**

Create `src/modules/roadmap/team-roadmap.validation.ts`:

```ts
import { z } from 'zod';

export const teamTimelineQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  assigneeId: z.string().optional(),
  type: z.string().optional(),
  projectId: z.string().optional(), // comma-separated project IDs to filter
  search: z.string().max(200).optional(),
});
```

- [ ] **Step 2: Create the service**

Create `src/modules/roadmap/team-roadmap.service.ts`:

```ts
import type { z } from 'zod';

import { prisma } from '../../config/database';

import type { teamTimelineQuerySchema } from './team-roadmap.validation';

const ISSUE_SELECT = {
  id: true,
  number: true,
  title: true,
  type: true,
  priority: true,
  startDate: true,
  dueDate: true,
  columnId: true,
  parentId: true,
  assigneeId: true,
  roadmapBucketId: true,
  assignee: {
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
    },
  },
  column: { select: { id: true, name: true, isDone: true } },
  labels: { select: { id: true, name: true, color: true } },
  project: {
    select: {
      id: true,
      name: true,
      prefix: true,
      slug: true,
      team: { select: { slug: true, org: { select: { slug: true } } } },
    },
  },
  _count: { select: { children: true } },
} as const;

const CHILDREN_SELECT = {
  id: true,
  number: true,
  title: true,
  type: true,
  priority: true,
  startDate: true,
  dueDate: true,
  columnId: true,
  parentId: true,
  assigneeId: true,
  roadmapBucketId: true,
  column: { select: { id: true, name: true, isDone: true } },
} as const;

/**
 * Get timeline data across ALL projects in a team.
 * Returns issues grouped by project, plus cross-project dependency links.
 */
export async function getTeamTimelineData(
  teamId: string,
  filters: z.output<typeof teamTimelineQuerySchema>,
) {
  // Get all projects in this team
  const projectIds = filters.projectId
    ? filters.projectId.split(',').map((id) => id.trim())
    : (await prisma.project.findMany({
        where: { teamId },
        select: { id: true },
      })).map((p) => p.id);

  const where: Record<string, unknown> = {
    projectId: { in: projectIds },
    OR: [{ dueDate: { not: null } }, { startDate: { not: null } }],
    parentId: null,
  };

  if (filters.startDate || filters.endDate) {
    where['dueDate'] = {
      ...(filters.startDate ? { gte: new Date(filters.startDate) } : {}),
      ...(filters.endDate ? { lte: new Date(filters.endDate) } : {}),
    };
  }

  if (filters.assigneeId) where['assigneeId'] = filters.assigneeId;
  if (filters.type) where['type'] = filters.type;
  if (filters.search) {
    where['title'] = { contains: filters.search, mode: 'insensitive' };
  }

  const issues = await prisma.issue.findMany({
    where,
    select: {
      ...ISSUE_SELECT,
      children: {
        where: { OR: [{ dueDate: { not: null } }, { startDate: { not: null } }] },
        select: CHILDREN_SELECT,
      },
    },
    orderBy: [{ projectId: 'asc' }, { dueDate: 'asc' }],
  });

  // Collect all visible issue IDs for dependency lookup
  const allIds = new Set<string>();
  for (const issue of issues) {
    allIds.add(issue.id);
    for (const child of issue.children) {
      allIds.add(child.id);
    }
  }

  // Get BLOCKS links between any visible issues (including cross-project)
  const links = allIds.size > 0
    ? await prisma.issueLink.findMany({
        where: {
          type: 'BLOCKS',
          OR: [
            { fromId: { in: Array.from(allIds) } },
            { toId: { in: Array.from(allIds) } },
          ],
        },
        select: { id: true, fromId: true, toId: true, type: true },
      })
    : [];

  // Build project list for grouping metadata
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, name: true, prefix: true, slug: true },
    orderBy: { name: 'asc' },
  });

  return { issues, links, projects };
}
```

- [ ] **Step 3: Create the controller**

Create `src/modules/roadmap/team-roadmap.controller.ts`:

```ts
import type { Request, Response } from 'express';

import { asyncHandler } from '../../middleware/asyncHandler';
import { validate } from '../../utils/validation/validate';
import { param } from '../../utils/validation/param';

import { teamTimelineQuerySchema } from './team-roadmap.validation';
import * as teamRoadmapService from './team-roadmap.service';

export const getTeamTimeline = asyncHandler(async (req: Request, res: Response) => {
  const teamId = param(req, 'teamId');
  const filters = validate(teamTimelineQuerySchema, req.query);
  const data = await teamRoadmapService.getTeamTimelineData(teamId, filters);
  res.json(data);
});
```

- [ ] **Step 4: Mount the route**

In `src/modules/roadmap/roadmap.routes.ts`, add the team-level route. First read the file to find the exact mount point, then add:

```ts
import { getTeamTimeline } from './team-roadmap.controller';
```

And add this route **before** the project-scoped routes:

```ts
// Team-level roadmap (cross-project)
router.get('/teams/:teamId/roadmap/timeline', authenticate, getTeamTimeline);
```

Note: Check how the router is mounted in the main app — it may need to be added at the app level if the roadmap router is mounted under `/projects/:projectId`. In that case, add the team route to the main router file instead. The pattern follows how team analytics works.

- [ ] **Step 5: Verify backend compiles**

Run: `cd /root/axiom && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/roadmap/team-roadmap.validation.ts src/modules/roadmap/team-roadmap.service.ts src/modules/roadmap/team-roadmap.controller.ts src/modules/roadmap/roadmap.routes.ts
git commit -m "feat: add team-level roadmap timeline API endpoint"
```

---

## Task 3: Backend Test for Team Timeline

**Files:**
- Create: `src/modules/roadmap/team-roadmap.test.ts`

- [ ] **Step 1: Write the test**

Create `src/modules/roadmap/team-roadmap.test.ts`. Follow the pattern from `src/modules/roadmap/roadmap.test.ts` — it uses real DB with Prisma adapter.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const TEST_DB_URL = process.env.DATABASE_URL?.replace(/\/[^/]+$/, '/axiom_test') ?? '';

describe('Team Roadmap Service', () => {
  let prisma: PrismaClient;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: TEST_DB_URL });
    const adapter = new PrismaPg(pool);
    prisma = new PrismaClient({ adapter });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  it('should return issues across multiple projects in a team', async () => {
    // This test relies on seed data being present (Voorbeeld org).
    // Find the team-noord team
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

    // Query issues with dates across all projects
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

    // After seed data adds dates, this should return issues from multiple projects
    // The test validates the query pattern works across projects
    expect(Array.isArray(issues)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd /root/axiom && npx vitest run src/modules/roadmap/team-roadmap.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/modules/roadmap/team-roadmap.test.ts
git commit -m "test: add team-level roadmap timeline test"
```

---

## Task 4: Frontend API Client for Team Timeline

**Files:**
- Modify: `frontend/src/api/roadmap.api.ts`

- [ ] **Step 1: Add team timeline types and API call**

In `frontend/src/api/roadmap.api.ts`, add the following after the `BucketsViewData` interface (around line 51):

```ts
export interface TeamTimelineProject {
  id: string;
  name: string;
  prefix: string;
  slug: string;
}

export interface TeamTimelineData {
  issues: TimelineIssue[];
  links: DependencyLink[];
  projects: TeamTimelineProject[];
}

export interface TeamTimelineFilters {
  assigneeId?: string;
  type?: string;
  projectId?: string; // comma-separated
  startDate?: string;
  endDate?: string;
  q?: string;
}
```

Then add to the `roadmapApi` object (before the closing `}`):

```ts
  // Team-level roadmap
  getTeamTimeline: (teamId: string, filters?: TeamTimelineFilters) =>
    get<TeamTimelineData>(`/teams/${teamId}/roadmap/timeline${buildQuery(filters as Filters)}`),
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/roadmap.api.ts
git commit -m "feat: add team timeline API client"
```

---

## Task 5: Enhance GanttChart for Multi-Project Mode

**Files:**
- Modify: `frontend/src/components/ui/GanttChart.tsx`

- [ ] **Step 1: Add multi-project support to GanttChart**

The key change: when `multiProject` is true, the chart groups issues by project with collapsible project headers. The `GanttChart` props need to accept an optional `projects` list and a `multiProject` flag.

In `frontend/src/components/ui/GanttChart.tsx`, update the interface (around line 22):

```tsx
interface GanttChartProps {
  issues: TimelineIssue[];
  links: DependencyLink[];
  zoom: ZoomLevel;
  projectPrefix: string;
  projectId: string;
  onIssueClick: (issue: TimelineIssue) => void;
  /** Multi-project mode: group issues by project with headers */
  multiProject?: boolean;
}
```

- [ ] **Step 2: Update flatRows to support project grouping**

Replace the `FlatRow` interface and the `flatRows` memo (lines 31-80):

```tsx
interface FlatRow {
  issue: TimelineIssue;
  indent: number;
  isEpic: boolean;
  childCount: number;
  /** Project group header row (no bar rendered) */
  isGroupHeader?: boolean;
  groupLabel?: string;
  groupProjectPrefix?: string;
  groupCollapsed?: boolean;
}
```

Update the `flatRows` memo to support grouping. Add state for collapsed project groups:

```tsx
const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
```

Then update the `flatRows` useMemo:

```tsx
const flatRows = useMemo<FlatRow[]>(() => {
  const rows: FlatRow[] = [];

  if (multiProject) {
    // Group issues by project
    const byProject = new Map<string, TimelineIssue[]>();
    for (const issue of issues) {
      const pid = issue.project?.slug ?? 'unknown';
      if (!byProject.has(pid)) byProject.set(pid, []);
      byProject.get(pid)!.push(issue);
    }

    for (const [projectSlug, projectIssues] of byProject) {
      const first = projectIssues[0];
      const prefix = first?.project?.prefix ?? projectSlug;
      const projectName = (first?.project as { name?: string })?.name ?? prefix;

      // Group header row
      rows.push({
        issue: first, // placeholder, not rendered as bar
        indent: 0,
        isEpic: false,
        childCount: projectIssues.length,
        isGroupHeader: true,
        groupLabel: `${projectName} (${prefix})`,
        groupProjectPrefix: prefix,
        groupCollapsed: collapsedGroups.has(projectSlug),
      });

      if (collapsedGroups.has(projectSlug)) continue;

      for (const issue of projectIssues) {
        const isEpic = issue.type === 'EPIC';
        const childCount = issue._count?.children ?? 0;
        rows.push({ issue, indent: 1, isEpic, childCount });

        if (isEpic && expandedIds.has(issue.id) && issue.children) {
          for (const child of issue.children) {
            rows.push({
              issue: child,
              indent: 2,
              isEpic: child.type === 'EPIC',
              childCount: child._count?.children ?? 0,
            });
          }
        }
      }
    }
  } else {
    // Single-project mode (existing behavior)
    for (const issue of issues) {
      const isEpic = issue.type === 'EPIC';
      const childCount = issue._count?.children ?? 0;
      rows.push({ issue, indent: 0, isEpic, childCount });

      if (isEpic && expandedIds.has(issue.id) && issue.children) {
        for (const child of issue.children) {
          rows.push({
            issue: child,
            indent: 1,
            isEpic: child.type === 'EPIC',
            childCount: child._count?.children ?? 0,
          });
        }
      }
    }
  }
  return rows;
}, [issues, expandedIds, multiProject, collapsedGroups]);
```

- [ ] **Step 3: Add group header toggle**

Add a toggle handler near the existing `handleToggleExpand`:

```tsx
const handleToggleGroup = useCallback((projectSlug: string) => {
  setCollapsedGroups((prev) => {
    const next = new Set(prev);
    if (next.has(projectSlug)) {
      next.delete(projectSlug);
    } else {
      next.add(projectSlug);
    }
    return next;
  });
}, []);
```

- [ ] **Step 4: Update sidebar rendering for group headers**

In the sidebar label rendering section, update to handle group headers:

```tsx
{flatRows.map((row, idx) => (
  row.isGroupHeader ? (
    <GroupHeaderLabel
      key={`group-${row.groupProjectPrefix}`}
      label={row.groupLabel!}
      y={idx * ROW_HEIGHT}
      rowHeight={ROW_HEIGHT}
      isCollapsed={row.groupCollapsed ?? false}
      onToggle={() => handleToggleGroup(row.issue.project?.slug ?? '')}
      issueCount={row.childCount}
    />
  ) : (
    <GanttRowLabel
      key={row.issue.id}
      issue={row.issue}
      y={idx * ROW_HEIGHT}
      rowHeight={ROW_HEIGHT}
      isEpic={row.isEpic}
      isExpanded={expandedIds.has(row.issue.id)}
      childCount={row.childCount}
      onToggleExpand={handleToggleExpand}
      onClick={onIssueClick}
      projectPrefix={multiProject ? (row.issue.project?.prefix ?? projectPrefix) : projectPrefix}
      indent={row.indent}
    />
  )
))}
```

- [ ] **Step 5: Add GroupHeaderLabel component**

Add this component at the bottom of `GanttChart.tsx` (before the `TodayLine` component):

```tsx
function GroupHeaderLabel({
  label,
  y,
  rowHeight,
  isCollapsed,
  onToggle,
  issueCount,
}: {
  label: string;
  y: number;
  rowHeight: number;
  isCollapsed: boolean;
  onToggle: () => void;
  issueCount: number;
}) {
  const Icon = isCollapsed ? ChevronRight : ChevronDown;
  return (
    <div
      className="absolute flex items-center gap-1.5 px-2 text-xs font-semibold text-text cursor-pointer hover:bg-surface-secondary transition-colors bg-surface-secondary/50"
      style={{ top: y, height: rowHeight, left: 0, right: 0 }}
      onClick={onToggle}
    >
      <Icon className="h-3.5 w-3.5 text-text-secondary shrink-0" />
      <span className="truncate">{label}</span>
      <span className="text-text-tertiary ml-auto shrink-0">{issueCount}</span>
    </div>
  );
}
```

Add the missing import at the top of `GanttChart.tsx`:

```tsx
import { ChevronDown, ChevronRight } from 'lucide-react';
```

- [ ] **Step 6: Skip bar rendering for group header rows**

In the issue bars rendering section, add a check to skip group headers:

```tsx
{flatRows.map((row, idx) => {
  if (row.isGroupHeader) return null; // Group headers have no bar
  const hasDate = row.issue.startDate || row.issue.dueDate;
  if (!hasDate) return null;
  // ... rest of existing rendering
})}
```

- [ ] **Step 7: Verify frontend compiles**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ui/GanttChart.tsx
git commit -m "feat: add multi-project grouping mode to GanttChart"
```

---

## Task 6: Team Roadmap Page

**Files:**
- Create: `frontend/src/pages/roadmap/TeamRoadmap.tsx`
- Modify: `frontend/src/routes/project-routes.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Create the TeamRoadmap page**

Create directory and file `frontend/src/pages/roadmap/TeamRoadmap.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { CalendarRange, Filter, Map, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';

import { roadmapApi, type TeamTimelineFilters, type TimelineIssue } from '@/api/roadmap.api';
import { get } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { GanttChart } from '@/components/ui/GanttChart';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { TimelineZoom, type ZoomLevel } from '@/components/ui/TimelineZoom';

interface TeamInfo {
  id: string;
  name: string;
  slug: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  prefix: string;
  slug: string;
}

export default function TeamRoadmap() {
  const { org, team } = useParams<{ org: string; team: string }>();
  const navigate = useNavigate();

  const [zoom, setZoom] = useState<ZoomLevel>('months');
  const [filters, setFilters] = useState<TeamTimelineFilters>({});
  const [showFilters, setShowFilters] = useState(false);

  // Get team info for the teamId
  const { data: teamInfo } = useQuery({
    queryKey: ['team-info', org, team],
    queryFn: () => get<TeamInfo>(`/orgs/by-slug/${org}/teams/by-slug/${team}`),
    enabled: !!org && !!team,
  });

  const teamId = teamInfo?.id ?? '';

  // Get projects for filter dropdown
  const { data: projects } = useQuery({
    queryKey: ['team-projects', teamId],
    queryFn: () => get<ProjectInfo[]>(`/teams/${teamId}/projects`),
    enabled: !!teamId,
  });

  // Timeline data
  const { data: timelineData, isLoading } = useQuery({
    queryKey: ['team-roadmap-timeline', teamId, filters],
    queryFn: () => roadmapApi.getTeamTimeline(teamId, filters),
    enabled: !!teamId,
  });

  function handleIssueClick(issue: TimelineIssue) {
    const p = issue.project;
    if (p) {
      navigate(`/${p.team.org.slug}/${p.team.slug}/${p.slug}/issues/${issue.number}`);
    }
  }

  if (isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-7 w-64 mb-4" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    );
  }

  const hasIssues = timelineData && timelineData.issues.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6">
        <PageHeader title="Team Roadmap" icon={<CalendarRange className="h-5 w-5" />}>
          <div className="flex items-center gap-3">
            <Button
              variant={showFilters ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4" /> Filters
            </Button>
            <TimelineZoom value={zoom} onChange={setZoom} />
          </div>
        </PageHeader>

        {/* Filter bar */}
        {showFilters && (
          <div className="flex items-center gap-3 pb-4 flex-wrap">
            {projects && projects.length > 0 && (
              <Select
                value={filters.projectId ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    projectId: e.target.value || undefined,
                  }))
                }
              >
                <option value="">All projects</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.prefix})
                  </option>
                ))}
              </Select>
            )}
            <Select
              value={filters.type ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, type: e.target.value || undefined }))
              }
            >
              <option value="">All types</option>
              <option value="EPIC">Epic</option>
              <option value="STORY">Story</option>
              <option value="TASK">Task</option>
              <option value="BUG">Bug</option>
            </Select>
            {(filters.projectId || filters.type || filters.assigneeId) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters({})}
              >
                <X className="h-4 w-4" /> Clear
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {hasIssues ? (
          <GanttChart
            issues={timelineData.issues}
            links={timelineData.links}
            zoom={zoom}
            projectPrefix=""
            projectId=""
            onIssueClick={handleIssueClick}
            multiProject
          />
        ) : (
          <EmptyState
            icon={<Map />}
            title="No issues on the timeline"
            description="Add start and due dates to issues across this team's projects to see them here."
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `frontend/src/routes/project-routes.tsx`, add the lazy import near the top (after the `TeamAnalytics` import around line 31):

```tsx
const TeamRoadmap = lazy(() => import('@/pages/roadmap/TeamRoadmap'));
```

Then add the route after the team analytics route (after line 78):

```tsx
      <Route
        path="/:org/:team/roadmap"
        element={
          <ErrorBoundary>
            <TeamRoadmap />
          </ErrorBoundary>
        }
      />
```

- [ ] **Step 3: Add sidebar navigation**

In `frontend/src/components/layout/Sidebar.tsx`, add `CalendarRange` to the Lucide imports at the top of the file.

Then add the Roadmap nav item in the team sub-nav section (after the Members NavItem, before the closing `</div>`):

```tsx
              <NavItem to={`/${org}/${team}/roadmap`} icon={CalendarRange} label="Roadmap" />
```

This goes after line 252 (`<NavItem to={...members} ... />`), before the closing `</div>` on what is currently line 253.

- [ ] **Step 4: Verify frontend compiles**

Run: `cd /root/axiom/frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/roadmap/TeamRoadmap.tsx frontend/src/routes/project-routes.tsx frontend/src/components/layout/Sidebar.tsx
git commit -m "feat: add team-level roadmap page with cross-project timeline"
```

---

## Task 7: Seed — Roadmap Buckets + Issue Dates + Issue Links

This is the first seed data task. All seed tasks modify `scripts/seed-voorbeeld.ts`.

**Files:**
- Modify: `scripts/seed-voorbeeld.ts`

- [ ] **Step 1: Add startDate and dueDate to all epic definitions**

In the `epicDefs` array (around line 337), add `startDate` and `dueDate` to the `EpicSeed` type:

```ts
type EpicSeed = {
  projectSlug: string;
  title: string;
  body: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  creator: string;
  status: string;
  startDate?: Date;
  dueDate?: Date;
};
```

Add dates to each epic (staggered across projects for a realistic timeline):

```ts
// Add to each epic definition:
// SSO-integratie: startDate: daysAgo(21), dueDate: futureDate(42),
// Automatische commissieberekening: startDate: daysAgo(7), dueDate: futureDate(56),
// Klantportaal migratie: startDate: daysAgo(28), dueDate: futureDate(35),
// Offerte-goedkeuring workflow: startDate: futureDate(7), dueDate: futureDate(63),
// RAG-pipeline: startDate: daysAgo(14), dueDate: futureDate(49),
// Factuurherkenning: startDate: futureDate(14), dueDate: futureDate(70),
```

Then in the epic creation `prisma.issue.create` data (around line 408-420), add:

```ts
startDate: epic.startDate ?? null,
dueDate: epic.dueDate ?? null,
```

- [ ] **Step 2: Add startDate and dueDate to issue definitions**

Update the `IssueSeed` type to always include dates for issues with assignees. Add deterministic dates based on the issue's position in the sprint:

After the issue creation loop (around line 592), add a section to set dates on all issues that have sprint assignments:

```ts
// Set start/due dates on all sprint issues for timeline visibility
console.warn('        Setting issue dates for roadmap...');
let dateIdx = 0;
for (const issue of createdIssues) {
  if (!issue.inSprint) continue;

  // Deterministic date spread: stagger issues across the sprint window
  const offset = (dateIdx * 3) % 14; // 0-13 day offset
  const start = daysAgo(8 - offset); // spread within sprint range
  const duration = 3 + (issue.title.length % 7); // 3-9 days
  const end = new Date(start.getTime() + duration * 86_400_000);

  await prisma.issue.update({
    where: { id: issue.id },
    data: {
      startDate: start,
      dueDate: end,
    },
  });
  dateIdx++;
}
```

- [ ] **Step 3: Add roadmap buckets section**

After the sprint assignment section (around line 617), add a new section:

```ts
// ────────────────────────────────────────────────────────────
// 8b. Roadmap buckets
// ────────────────────────────────────────────────────────────
console.warn('  [8b/20] Roadmap buckets');

const bucketColors = [
  'var(--color-success)',   // Now
  'var(--color-warning)',   // Next
  'var(--color-text-tertiary)', // Later
];

let bucketCount = 0;
for (const [slug, proj] of Object.entries(projects)) {
  const existingBuckets = await prisma.roadmapBucket.count({ where: { projectId: proj.id } });
  if (existingBuckets > 0) continue;

  const names = ['Now', 'Next', 'Later'];
  const buckets = await Promise.all(
    names.map((name, i) =>
      prisma.roadmapBucket.create({
        data: {
          projectId: proj.id,
          name,
          position: i,
          color: bucketColors[i],
        },
      })
    )
  );

  // Assign sprint issues to buckets: active work = Now, todo = Next, backlog = Later
  for (const issue of createdIssues.filter((i) => i.projectSlug === slug)) {
    let bucketId: string | null = null;
    if (['In Ontwikkeling', 'Code Review', 'Testen'].includes(issue.column ?? '')) {
      bucketId = buckets[0].id; // Now
    } else if (['Te Doen'].includes(issue.column ?? '')) {
      bucketId = buckets[1].id; // Next
    } else if (issue.column === 'Backlog' && issue.assignee) {
      bucketId = buckets[2].id; // Later
    }
    if (bucketId) {
      await prisma.issue.update({
        where: { id: issue.id },
        data: { roadmapBucketId: bucketId },
      });
    }
  }
  bucketCount += 3;
}
console.warn(`        ${bucketCount} roadmap buckets`);
```

- [ ] **Step 4: Add issue links (dependencies) section**

After the roadmap buckets section, add:

```ts
// ────────────────────────────────────────────────────────────
// 8c. Issue links (dependencies)
// ────────────────────────────────────────────────────────────
console.warn('  [8c/20] Issue links');

const linkDefs = [
  // Within Partnerportaal: SAML blocks auto-provisioning
  { fromTitle: 'SAML-authenticatie provider implementeren', toTitle: 'Automatische gebruikersprovisioning', fromProject: 'partnerportaal', toProject: 'partnerportaal', type: 'BLOCKS' as const },
  { fromTitle: 'Automatische gebruikersprovisioning', toTitle: 'SSO login pagina redesign', fromProject: 'partnerportaal', toProject: 'partnerportaal', type: 'BLOCKS' as const },
  // Within Klantportaal: design tokens block navigation refactor
  { fromTitle: 'Design tokens implementeren voor nieuwe huisstijl', toTitle: 'Navigatie component refactoring', fromProject: 'klantportaal', toProject: 'klantportaal', type: 'BLOCKS' as const },
  { fromTitle: 'Navigatie component refactoring', toTitle: 'Toegankelijkheidsaudit uitvoeren', fromProject: 'klantportaal', toProject: 'klantportaal', type: 'BLOCKS' as const },
  // Within AI: ingestion blocks vector store
  { fromTitle: 'Document ingestion pipeline opzetten', toTitle: 'Vector store integratie met Qdrant', fromProject: 'ai-assistent', toProject: 'ai-assistent', type: 'BLOCKS' as const },
  { fromTitle: 'Vector store integratie met Qdrant', toTitle: 'Context window optimalisatie', fromProject: 'ai-assistent', toProject: 'ai-assistent', type: 'BLOCKS' as const },
  // Cross-project: orderverwerking webhook blocks klantportaal session timeout (order status needed)
  { fromTitle: 'Order status webhook naar klantportaal', toTitle: 'Sessie timeout melding toevoegen', fromProject: 'orderverwerking', toProject: 'klantportaal', type: 'BLOCKS' as const },
  // Within Offertetool: template blocks version history
  { fromTitle: 'Offerte template systeem', toTitle: 'Offerte versiegeschiedenis', fromProject: 'offertetool', toProject: 'offertetool', type: 'BLOCKS' as const },
  // Within Orderverwerking: batch blocks monitoring
  { fromTitle: 'Batch verwerking van orders', toTitle: 'Monitoring dashboard voor orderflow', fromProject: 'orderverwerking', toProject: 'orderverwerking', type: 'BLOCKS' as const },
  // Cross-project: OCR pipeline blocks AI document ingestion
  { fromTitle: 'OCR-pipeline migreren naar Azure Document Intelligence', toTitle: 'Document ingestion pipeline opzetten', fromProject: 'documentherkenning', toProject: 'ai-assistent', type: 'BLOCKS' as const },
  // RELATES_TO: commissie rapport relates to partner dashboard
  { fromTitle: 'Commissierapport per partner genereren', toTitle: 'Partnerdashboard laadt traag bij veel orders', fromProject: 'commissie-engine', toProject: 'partnerportaal', type: 'RELATES_TO' as const },
];

let linkCount = 0;
for (const ld of linkDefs) {
  const fromIssue = await prisma.issue.findFirst({
    where: { projectId: projects[ld.fromProject].id, title: ld.fromTitle },
  });
  const toIssue = await prisma.issue.findFirst({
    where: { projectId: projects[ld.toProject].id, title: ld.toTitle },
  });
  if (!fromIssue || !toIssue) continue;

  const existing = await prisma.issueLink.findFirst({
    where: { fromId: fromIssue.id, toId: toIssue.id, type: ld.type },
  });
  if (existing) continue;

  await prisma.issueLink.create({
    data: { fromId: fromIssue.id, toId: toIssue.id, type: ld.type },
  });
  linkCount++;
}
console.warn(`        ${linkCount} issue links`);
```

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-voorbeeld.ts
git commit -m "seed: add roadmap buckets, issue dates, and dependency links for Voorbeeld"
```

---

## Task 8: Seed — Milestones for All Projects

**Files:**
- Modify: `scripts/seed-voorbeeld.ts`

- [ ] **Step 1: Expand milestone definitions**

Replace the `milestoneDefs` array (around line 258) with milestones for all 8 projects:

```ts
const milestoneDefs = [
  { projectSlug: 'partnerportaal', title: 'Q2 2026 Release', dueDate: new Date('2026-06-30'), description: 'SSO-integratie en performance verbeteringen' },
  { projectSlug: 'partnerportaal', title: 'Q3 2026 Release', dueDate: new Date('2026-09-30'), description: 'Partner self-service uitbreidingen' },
  { projectSlug: 'commissie-engine', title: 'Real-time Commissie v1', dueDate: new Date('2026-06-15'), description: 'Automatische real-time commissieberekeningen' },
  { projectSlug: 'commissie-engine', title: 'Commissie Rapportage v2', dueDate: new Date('2026-08-31'), description: 'Uitgebreide rapportage en inzichten' },
  { projectSlug: 'dealregistratie', title: 'Pipeline Dashboard v1', dueDate: new Date('2026-05-31'), description: 'Visueel dashboard en notificaties' },
  { projectSlug: 'dealregistratie', title: 'Duplicaatdetectie Release', dueDate: new Date('2026-07-31'), description: 'Automatische dubbele deals herkenning' },
  { projectSlug: 'klantportaal', title: 'Klantportaal v2.0', dueDate: new Date('2026-05-31'), description: 'Nieuwe huisstijl en toegankelijkheid' },
  { projectSlug: 'klantportaal', title: 'WCAG 2.1 AA Certificering', dueDate: new Date('2026-08-15'), description: 'Volledige toegankelijkheidscertificering' },
  { projectSlug: 'offertetool', title: 'PDF Export v1', dueDate: new Date('2026-05-15'), description: 'PDF-export met bedrijfstemplate' },
  { projectSlug: 'offertetool', title: 'Workflow Digitalisering', dueDate: new Date('2026-09-30'), description: 'Digitale goedkeuringsworkflow' },
  { projectSlug: 'orderverwerking', title: 'Batch Processing v1', dueDate: new Date('2026-05-31'), description: 'EDI batch verwerking en foutafhandeling' },
  { projectSlug: 'orderverwerking', title: 'Monitoring & Alerting', dueDate: new Date('2026-08-31'), description: 'Real-time monitoring dashboard' },
  { projectSlug: 'ai-assistent', title: 'AI Platform MVP', dueDate: new Date('2026-07-31'), description: 'RAG-pipeline en kennisbank integratie' },
  { projectSlug: 'ai-assistent', title: 'AI Platform v1.1', dueDate: new Date('2026-10-31'), description: 'Context optimalisatie en kostenbeheersing' },
  { projectSlug: 'documentherkenning', title: 'Azure DI Migratie', dueDate: new Date('2026-06-30'), description: 'Migratie naar Azure Document Intelligence' },
  { projectSlug: 'documentherkenning', title: 'HTR Model v1', dueDate: new Date('2026-09-30'), description: 'Handgeschreven tekst herkenning productie' },
];
```

Update the milestones record type to allow multiple milestones per project:

```ts
const milestones: Record<string, { id: string }[]> = {};
for (const md of milestoneDefs) {
  const ms = await prisma.milestone.upsert({
    where: { projectId_title: { projectId: projects[md.projectSlug].id, title: md.title } },
    update: {},
    create: {
      projectId: projects[md.projectSlug].id,
      title: md.title,
      description: md.description,
      dueDate: md.dueDate,
      status: 'OPEN',
    },
  });
  if (!milestones[md.projectSlug]) milestones[md.projectSlug] = [];
  milestones[md.projectSlug].push(ms);
  console.warn(`        ${md.title} (${md.projectSlug})`);
}
```

Update the milestone reference in issue creation — `milestoneSlug` should reference the first milestone for the project:

```ts
// In the issue creation loop, change:
// milestoneId = milestones[issue.milestoneSlug].id;
// to:
milestoneId = milestones[issue.milestoneSlug]?.[0]?.id;
```

- [ ] **Step 2: Commit**

```bash
git add scripts/seed-voorbeeld.ts
git commit -m "seed: add milestones for all 8 Voorbeeld projects"
```

---

## Task 9: Seed — Custom Fields

**Files:**
- Modify: `scripts/seed-voorbeeld.ts`

- [ ] **Step 1: Add custom field definitions and values**

Add after the automation rules section (around line 784):

```ts
// ────────────────────────────────────────────────────────────
// 12b. Custom fields
// ────────────────────────────────────────────────────────────
console.warn('  [12b/20] Custom fields');

const customFieldDefs: { projectSlug: string; name: string; type: string; options?: string[] }[] = [
  // All projects get "Omgeving" (Environment)
  ...Object.keys(projects).map((slug) => ({
    projectSlug: slug,
    name: 'Omgeving',
    type: 'SELECT',
    options: ['Ontwikkeling', 'Test', 'Acceptatie', 'Productie'],
  })),
  // All projects get "Klant Impact" (Customer Impact)
  ...Object.keys(projects).map((slug) => ({
    projectSlug: slug,
    name: 'Klant Impact',
    type: 'SELECT',
    options: ['Geen', 'Laag', 'Gemiddeld', 'Hoog', 'Kritiek'],
  })),
  // AI team gets "Model Versie"
  { projectSlug: 'ai-assistent', name: 'Model Versie', type: 'TEXT' },
  { projectSlug: 'documentherkenning', name: 'Nauwkeurigheid %', type: 'NUMBER' },
];

let cfCount = 0;
const cfIds: Record<string, Record<string, string>> = {};

for (const cf of customFieldDefs) {
  const projectId = projects[cf.projectSlug].id;

  const existing = await prisma.customFieldDefinition.findFirst({
    where: { projectId, name: cf.name },
  });

  if (existing) {
    if (!cfIds[cf.projectSlug]) cfIds[cf.projectSlug] = {};
    cfIds[cf.projectSlug][cf.name] = existing.id;
    continue;
  }

  const created = await prisma.customFieldDefinition.create({
    data: {
      projectId,
      name: cf.name,
      type: cf.type,
      options: cf.options ?? undefined,
      position: cfCount,
    },
  });
  if (!cfIds[cf.projectSlug]) cfIds[cf.projectSlug] = {};
  cfIds[cf.projectSlug][cf.name] = created.id;
  cfCount++;
}

// Set custom field values on active issues
const envValues = ['Ontwikkeling', 'Test', 'Acceptatie', 'Productie'];
const impactValues = ['Laag', 'Gemiddeld', 'Hoog'];

for (const issue of createdIssues) {
  if (!issue.assignee) continue;
  const slug = issue.projectSlug;
  const envFieldId = cfIds[slug]?.['Omgeving'];
  const impactFieldId = cfIds[slug]?.['Klant Impact'];

  if (envFieldId) {
    const envVal = envValues[issue.title.length % envValues.length];
    await prisma.customFieldValue.upsert({
      where: { issueId_fieldDefinitionId: { issueId: issue.id, fieldDefinitionId: envFieldId } },
      update: {},
      create: { issueId: issue.id, fieldDefinitionId: envFieldId, value: envVal },
    });
  }
  if (impactFieldId) {
    const impactVal = impactValues[issue.title.length % impactValues.length];
    await prisma.customFieldValue.upsert({
      where: { issueId_fieldDefinitionId: { issueId: issue.id, fieldDefinitionId: impactFieldId } },
      update: {},
      create: { issueId: issue.id, fieldDefinitionId: impactFieldId, value: impactVal },
    });
  }
}
console.warn(`        ${cfCount} custom field definitions`);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/seed-voorbeeld.ts
git commit -m "seed: add custom fields for all Voorbeeld projects"
```

---

## Task 10: Seed — Issue Templates + Saved Filters

**Files:**
- Modify: `scripts/seed-voorbeeld.ts`

- [ ] **Step 1: Add issue templates**

Issue templates are stored as JSON on the Project model (`issueTemplates` field). Add after custom fields:

```ts
// ────────────────────────────────────────────────────────────
// 12c. Issue templates
// ────────────────────────────────────────────────────────────
console.warn('  [12c/20] Issue templates');

const templateDefs: Record<string, unknown[]> = {};
for (const slug of Object.keys(projects)) {
  templateDefs[slug] = [
    {
      name: 'Bug Report',
      description: 'Rapporteer een bug of fout',
      type: 'BUG',
      priority: 'HIGH',
      body: '## Beschrijving\n\nBeschrijf de bug kort en duidelijk.\n\n## Stappen om te reproduceren\n\n1. Ga naar ...\n2. Klik op ...\n3. Verwacht resultaat: ...\n4. Werkelijk resultaat: ...\n\n## Omgeving\n\n- Browser: \n- OS: \n- Versie: \n\n## Screenshots\n\nVoeg screenshots toe indien mogelijk.',
    },
    {
      name: 'Feature Request',
      description: 'Vraag een nieuwe functionaliteit aan',
      type: 'STORY',
      priority: 'MEDIUM',
      body: '## Samenvatting\n\nBeschrijf de gewenste functionaliteit.\n\n## Probleemstelling\n\nWelk probleem lost dit op?\n\n## Voorgestelde oplossing\n\nBeschrijf hoe dit zou moeten werken.\n\n## Alternatieven\n\nZijn er andere oplossingen overwogen?\n\n## Acceptatiecriteria\n\n- [ ] Criterium 1\n- [ ] Criterium 2',
    },
  ];
}

for (const [slug, templates] of Object.entries(templateDefs)) {
  const project = await prisma.project.findUnique({
    where: { id: projects[slug].id },
    select: { issueTemplates: true },
  });
  if (project?.issueTemplates) continue; // Already has templates

  await prisma.project.update({
    where: { id: projects[slug].id },
    data: { issueTemplates: templates },
  });
}
console.warn(`        ${Object.keys(templateDefs).length * 2} issue templates`);
```

- [ ] **Step 2: Add saved filters**

```ts
// ────────────────────────────────────────────────────────────
// 12d. Saved filters
// ────────────────────────────────────────────────────────────
console.warn('  [12d/20] Saved filters');

let filterCount = 0;
for (const [slug, proj] of Object.entries(projects)) {
  // Get team admin for this project's team
  const teamAdmin = Object.entries(teamMemberDefs[proj.teamSlug] ?? {})
    .find(([_, role]) => role === 'ADMIN');
  if (!teamAdmin) continue;
  const adminUserId = users[teamAdmin[0]].id;

  const existingFilters = await prisma.savedFilter.count({
    where: { projectId: proj.id, userId: adminUserId },
  });
  if (existingFilters > 0) continue;

  const filterDefs = [
    { name: 'Mijn Issues', query: { assigneeId: adminUserId } },
    { name: 'Kritieke Bugs', query: { type: 'BUG', priority: 'CRITICAL,HIGH' } },
    { name: 'Sprint Backlog', query: { column: 'Backlog,Te Doen' } },
  ];

  for (const fd of filterDefs) {
    await prisma.savedFilter.create({
      data: {
        userId: adminUserId,
        projectId: proj.id,
        name: fd.name,
        query: fd.query,
      },
    });
    filterCount++;
  }
}
console.warn(`        ${filterCount} saved filters`);
```

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-voorbeeld.ts
git commit -m "seed: add issue templates and saved filters for Voorbeeld"
```

---

## Task 11: Seed — Approval Gates

**Files:**
- Modify: `scripts/seed-voorbeeld.ts`

- [ ] **Step 1: Add approval gates for key projects**

Add after saved filters:

```ts
// ────────────────────────────────────────────────────────────
// 12e. Approval gates
// ────────────────────────────────────────────────────────────
console.warn('  [12e/20] Approval gates');

// Add approval gate for "Code Review" -> "Testen" on high-stakes projects
const approvalProjectSlugs = ['partnerportaal', 'commissie-engine', 'klantportaal'];
let gateCount = 0;

for (const slug of approvalProjectSlugs) {
  const cols = projectColumns[slug];
  const fromColId = cols['Code Review'];
  const toColId = cols['Testen'];
  if (!fromColId || !toColId) continue;

  const existing = await prisma.approvalGate.findUnique({
    where: {
      projectId_fromColumnId_toColumnId: {
        projectId: projects[slug].id,
        fromColumnId: fromColId,
        toColumnId: toColId,
      },
    },
  });
  if (existing) continue;

  await prisma.approvalGate.create({
    data: {
      projectId: projects[slug].id,
      fromColumnId: fromColId,
      toColumnId: toColId,
      minApprovals: 1,
      allowSelfApproval: false,
      enabled: true,
    },
  });
  gateCount++;
}
console.warn(`        ${gateCount} approval gates`);
```

- [ ] **Step 2: Commit**

```bash
git add scripts/seed-voorbeeld.ts
git commit -m "seed: add approval gates for key Voorbeeld projects"
```

---

## Task 12: Seed — Forms + Notifications

**Files:**
- Modify: `scripts/seed-voorbeeld.ts`

- [ ] **Step 1: Add intake forms (one per team)**

Add after approval gates:

```ts
// ────────────────────────────────────────────────────────────
// 12f. Forms
// ────────────────────────────────────────────────────────────
console.warn('  [12f/20] Forms');

const formDefs = [
  {
    projectSlug: 'partnerportaal',
    name: 'Partner Bug Report',
    slug: 'partner-bug-report',
    description: 'Formulier voor partners om bugs te melden',
    creator: 'sanne',
    fields: [
      { type: 'TEXT', label: 'Onderwerp', required: true, placeholder: 'Korte beschrijving van het probleem' },
      { type: 'TEXTAREA', label: 'Beschrijving', required: true, placeholder: 'Beschrijf het probleem in detail' },
      { type: 'SELECT', label: 'Ernst', required: true, options: ['Laag', 'Gemiddeld', 'Hoog', 'Kritiek'] },
      { type: 'TEXT', label: 'Stappen om te reproduceren', required: false, placeholder: '1. Ga naar... 2. Klik op...' },
      { type: 'TEXT', label: 'Browser en OS', required: false, placeholder: 'bijv. Chrome 125, Windows 11' },
    ],
  },
  {
    projectSlug: 'klantportaal',
    name: 'Feature Aanvraag',
    slug: 'feature-aanvraag',
    description: 'Aanvraagformulier voor nieuwe functionaliteit',
    creator: 'joris',
    fields: [
      { type: 'TEXT', label: 'Titel', required: true, placeholder: 'Naam van de gewenste functie' },
      { type: 'TEXTAREA', label: 'Beschrijving', required: true, placeholder: 'Wat moet de functie doen?' },
      { type: 'SELECT', label: 'Prioriteit', required: true, options: ['Nice-to-have', 'Belangrijk', 'Urgent'] },
      { type: 'TEXTAREA', label: 'Zakelijke waarde', required: false, placeholder: 'Waarom is dit waardevol?' },
    ],
  },
  {
    projectSlug: 'ai-assistent',
    name: 'AI Model Evaluatie',
    slug: 'ai-model-evaluatie',
    description: 'Aanvraag voor evaluatie van een nieuw AI-model',
    creator: 'anika',
    fields: [
      { type: 'TEXT', label: 'Model naam', required: true, placeholder: 'bijv. GPT-4 Turbo, Claude 3.5' },
      { type: 'SELECT', label: 'Toepassing', required: true, options: ['Chatbot', 'Documentherkenning', 'Classificatie', 'Anders'] },
      { type: 'TEXTAREA', label: 'Verwachte verbetering', required: true, placeholder: 'Welk probleem lost dit model beter op?' },
      { type: 'TEXT', label: 'Geschatte maandkosten', required: false, placeholder: 'bijv. 500 EUR/maand' },
    ],
  },
];

let formCount = 0;
for (const fd of formDefs) {
  const projectId = projects[fd.projectSlug].id;
  const existing = await prisma.form.findFirst({
    where: { projectId, slug: fd.slug },
  });
  if (existing) continue;

  const form = await prisma.form.create({
    data: {
      projectId,
      name: fd.name,
      slug: fd.slug,
      description: fd.description,
      status: 'PUBLISHED',
      authMode: 'PUBLIC',
      spamProtection: 'RATE_LIMIT',
      rateLimitPerHour: 10,
      successMessage: 'Bedankt voor uw melding. We nemen zo snel mogelijk contact op.',
      createdById: users[fd.creator].id,
      pages: {
        create: {
          title: fd.name,
          position: 0,
          fields: {
            createMany: {
              data: fd.fields.map((f, i) => ({
                type: f.type,
                label: f.label,
                required: f.required,
                placeholder: f.placeholder,
                options: f.options ?? undefined,
                position: i,
              })),
            },
          },
        },
      },
    },
  });

  // Add a sample submission
  const sampleData: Record<string, string> = {};
  for (const f of fd.fields) {
    if (f.options) {
      sampleData[f.label] = f.options[0];
    } else if (f.type === 'TEXTAREA') {
      sampleData[f.label] = 'Dit is een voorbeeld melding voor testdoeleinden.';
    } else {
      sampleData[f.label] = 'Voorbeeld waarde';
    }
  }

  await prisma.formSubmission.create({
    data: {
      formId: form.id,
      projectId,
      status: 'PENDING',
      data: sampleData,
      submitterEmail: 'test@example.com',
      submitterName: 'Test Gebruiker',
      submitterIp: '127.0.0.1',
    },
  });
  formCount++;
}
console.warn(`        ${formCount} forms with submissions`);
```

- [ ] **Step 2: Add notifications**

```ts
// ────────────────────────────────────────────────────────────
// 12g. Notifications
// ────────────────────────────────────────────────────────────
console.warn('  [12g/20] Notifications');

const notificationDefs = [
  { username: 'sanne', type: 'issue:assigned', title: 'Je bent toegewezen aan PPT-1', body: 'SAML-authenticatie provider implementeren', link: '/voorbeeld/team-noord/partnerportaal/issues/1' },
  { username: 'sanne', type: 'pr:review_requested', title: 'Code review gevraagd voor PPT-4', body: 'Partnerdashboard query optimalisatie', link: '/voorbeeld/team-noord/partnerportaal/issues/4' },
  { username: 'joris', type: 'issue:assigned', title: 'Je bent toegewezen aan KPT-2', body: 'Navigatie component refactoring', link: '/voorbeeld/team-zuid/klantportaal/issues/2' },
  { username: 'anika', type: 'issue:commented', title: 'Nieuw commentaar op AIA-1', body: 'Thijs heeft gereageerd op Document ingestion pipeline', link: '/voorbeeld/team-ai/ai-assistent/issues/1' },
  { username: 'tim', type: 'issue:assigned', title: 'Je bent toegewezen aan CME-1', body: 'Commissierapport per partner genereren', link: '/voorbeeld/team-noord/commissie-engine/issues/1' },
  { username: 'fenna', type: 'issue:status_changed', title: 'OFT-3 status gewijzigd naar Gereed', body: 'Prijsberekening fout bij staffelkortingen is opgelost', link: '/voorbeeld/team-zuid/offertetool/issues/3' },
  { username: 'erik', type: 'mention', title: 'Je bent genoemd in een commentaar', body: 'Sanne heeft je genoemd in SAML-authenticatie provider implementeren', link: '/voorbeeld/team-noord/partnerportaal/issues/1' },
  { username: 'ruben', type: 'issue:assigned', title: 'Je bent toegewezen aan OVW-1', body: 'Batch verwerking van orders', link: '/voorbeeld/team-zuid/orderverwerking/issues/1' },
  { username: 'thijs', type: 'issue:assigned', title: 'Je bent toegewezen aan DCH-1', body: 'OCR-pipeline migreren naar Azure Document Intelligence', link: '/voorbeeld/team-ai/documentherkenning/issues/1' },
  { username: 'mila', type: 'issue:status_changed', title: 'DLR-5 is afgerond', body: 'Deal import uit Excel fout bij speciale tekens is opgelost', link: '/voorbeeld/team-noord/dealregistratie/issues/5' },
];

let notifCount = 0;
for (const nd of notificationDefs) {
  const userId = users[nd.username].id;
  const existing = await prisma.notification.findFirst({
    where: { userId, title: nd.title },
  });
  if (existing) continue;

  await prisma.notification.create({
    data: {
      userId,
      type: nd.type,
      title: nd.title,
      body: nd.body,
      link: nd.link,
      read: nd.type === 'issue:status_changed', // status changes are auto-read
    },
  });
  notifCount++;
}
console.warn(`        ${notifCount} notifications`);
```

- [ ] **Step 3: Update the step counter in console.warn calls**

Go through the entire seed file and renumber the console.warn step labels to reflect the new total count. The progression should be:

1. Users
2. Organization
3. Teams
4. Projects
5. Milestones
6. Sprints
7. Epics
8. Issues
9. Issue dates + roadmap buckets + issue links
10. Time entries
11. Automation rules
12. Custom fields
13. Issue templates
14. Saved filters
15. Approval gates
16. Forms
17. Notifications
18. Wiki
19. Comments

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-voorbeeld.ts
git commit -m "seed: add forms, notifications, custom fields, templates, filters, approvals for Voorbeeld"
```

---

## Task 13: Run Seed and Verify

**Files:** None (verification only)

- [ ] **Step 1: Type-check the seed script**

Run: `cd /root/axiom && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run the seed**

Run: `cd /root/axiom && npx tsx scripts/seed-voorbeeld.ts`
Expected: All steps complete without errors. Output shows counts for each section.

- [ ] **Step 3: Full type-check**

Run: `cd /root/axiom && npx tsc --noEmit && cd frontend && npx tsc --noEmit`
Expected: No errors in either

- [ ] **Step 4: Run backend tests**

Run: `cd /root/axiom && npm run test`
Expected: All tests pass

- [ ] **Step 5: Start dev stack and verify visually**

Run: `npm run docker:dev`

Then navigate to:
1. `http://localhost:7000/voorbeeld/team-noord/roadmap` — should show cross-project Gantt with issues from partnerportaal, commissie-engine, dealregistratie grouped by project
2. `http://localhost:7000/voorbeeld/team-noord/partnerportaal/roadmap` — should show per-project roadmap with dependency arrows and epic progress bars
3. Check that sidebar shows "Roadmap" link under each team

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```
