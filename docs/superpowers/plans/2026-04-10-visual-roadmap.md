# Visual Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dual-mode visual roadmap (Timeline/Gantt + customizable Buckets) with hierarchical epic views, interactive dependency arrows, and drag-to-edit dates/buckets.

**Architecture:** New `roadmap` backend module with `RoadmapBucket` model. New `startDate` field on Issue. Timeline view is a custom SVG-based Gantt chart. Bucket view reuses drag-and-drop column patterns from the board. Both views share a filter bar and live under a new project page.

**Tech Stack:** Prisma 7, Express 5, Zod 4, React 19, TanStack Query, custom SVG rendering, native HTML5 drag-and-drop, Lucide icons, CSS variable tokens. No third-party chart libraries.

**Spec:** `docs/superpowers/specs/2026-04-10-intake-forms-approvals-roadmap-design.md` (Section 3)

---

## File Structure

### Backend
```
prisma/schema.prisma                              — Add RoadmapBucket model + Issue.startDate + Issue.roadmapBucketId
src/modules/roadmap/roadmap.routes.ts              — Route definitions
src/modules/roadmap/roadmap.controller.ts          — Request handling
src/modules/roadmap/roadmap.service.ts             — Business logic
src/modules/roadmap/roadmap.validation.ts          — Zod schemas
src/modules/roadmap/roadmap.test.ts                — Integration tests
```

### Frontend
```
frontend/src/api/roadmap.api.ts                    — API client
frontend/src/components/ui/GanttChart.tsx           — Timeline container: zoom, scroll, viewport
frontend/src/components/ui/GanttTimeAxis.tsx        — Time division header with gridlines
frontend/src/components/ui/GanttRow.tsx             — Issue row: bar + expand/collapse
frontend/src/components/ui/GanttBar.tsx             — Draggable/resizable bar
frontend/src/components/ui/GanttMilestone.tsx       — Diamond marker (due date only)
frontend/src/components/ui/DependencyArrow.tsx      — SVG arrow between bars
frontend/src/components/ui/DependencyOverlay.tsx    — SVG layer for all arrows + interaction
frontend/src/components/ui/DragHandle.tsx           — Connector drag handle on bar edges
frontend/src/components/ui/BucketBoard.tsx          — Bucket columns container
frontend/src/components/ui/BucketColumn.tsx         — Single bucket column
frontend/src/components/ui/RoadmapCard.tsx          — Issue card in bucket view
frontend/src/components/ui/ProgressBar.tsx          — Thin completion progress bar
frontend/src/components/ui/TimelineZoom.tsx         — Zoom level selector
frontend/src/components/ui/IssuePickerModal.tsx     — Issue search/select modal
frontend/src/pages/roadmap/Roadmap.tsx              — Main roadmap page with mode toggle
```

---

### Task 1: Schema — Add Roadmap Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add RoadmapBucket model**

```prisma
model RoadmapBucket {
  id        String   @id @default(cuid())
  projectId String
  name      String
  position  Int
  color     String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  issues  Issue[]

  @@index([projectId])
}
```

- [ ] **Step 2: Add fields to Issue model**

```prisma
  startDate       DateTime?
  roadmapBucketId String?
  roadmapBucket   RoadmapBucket? @relation(fields: [roadmapBucketId], references: [id], onDelete: SetNull)
```

- [ ] **Step 3: Add reverse relation to Project**

```prisma
  roadmapBuckets RoadmapBucket[]
```

- [ ] **Step 4: Push schema**

Run: `npx prisma db push && npx prisma generate`
Expected: Success.

- [ ] **Step 5: Update issue validation to accept new fields**

In `src/utils/validation/issue-validators.ts`, add to `updateIssueSchema`:

```typescript
  startDate: z.string().datetime().nullable().optional(),
  roadmapBucketId: z.string().nullable().optional(),
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma src/utils/validation/issue-validators.ts
git commit -m "feat(roadmap): add RoadmapBucket model and Issue.startDate/roadmapBucketId fields"
```

---

### Task 2: Backend — Roadmap Validation

**Files:**
- Create: `src/modules/roadmap/roadmap.validation.ts`

- [ ] **Step 1: Write schemas**

```typescript
import { z } from 'zod';

export const createBucketSchema = z.object({
  name: z.string().min(1).max(100),
  color: z.string().max(50).optional(),
  position: z.number().int().min(0).optional(),
});

export const updateBucketSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(50).nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export const reorderBucketsSchema = z.object({
  bucketIds: z.array(z.string().min(1)).min(1),
});

export const timelineQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  assigneeId: z.string().optional(),
  labelId: z.string().optional(),
  type: z.string().optional(),
  milestoneId: z.string().optional(),
  sprintId: z.string().optional(),
  search: z.string().max(200).optional(),
});

export const bucketsViewQuerySchema = z.object({
  assigneeId: z.string().optional(),
  labelId: z.string().optional(),
  type: z.string().optional(),
  milestoneId: z.string().optional(),
  sprintId: z.string().optional(),
  search: z.string().max(200).optional(),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/roadmap/roadmap.validation.ts
git commit -m "feat(roadmap): add validation schemas"
```

---

### Task 3: Backend — Roadmap Service

**Files:**
- Create: `src/modules/roadmap/roadmap.service.ts`

- [ ] **Step 1: Write bucket CRUD**

```typescript
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { findOrThrow } from '../../utils/findOrThrow';

export async function listBuckets(projectId: string) {
  return prisma.roadmapBucket.findMany({
    where: { projectId },
    include: { _count: { select: { issues: true } } },
    orderBy: { position: 'asc' },
  });
}

export async function createBucket(
  projectId: string,
  data: { name: string; color?: string; position?: number },
) {
  const count = await prisma.roadmapBucket.count({ where: { projectId } });
  return prisma.roadmapBucket.create({
    data: {
      projectId,
      name: data.name,
      color: data.color,
      position: data.position ?? count,
    },
    include: { _count: { select: { issues: true } } },
  });
}

export async function updateBucket(
  projectId: string,
  bucketId: string,
  data: { name?: string; color?: string | null; position?: number },
) {
  await findOrThrow(
    prisma.roadmapBucket.findFirst({ where: { id: bucketId, projectId } }),
    'Bucket not found',
  );
  return prisma.roadmapBucket.update({
    where: { id: bucketId },
    data,
    include: { _count: { select: { issues: true } } },
  });
}

export async function deleteBucket(projectId: string, bucketId: string) {
  await findOrThrow(
    prisma.roadmapBucket.findFirst({ where: { id: bucketId, projectId } }),
    'Bucket not found',
  );
  // Unset roadmapBucketId on all issues in this bucket
  await prisma.issue.updateMany({
    where: { roadmapBucketId: bucketId },
    data: { roadmapBucketId: null },
  });
  await prisma.roadmapBucket.delete({ where: { id: bucketId } });
}

export async function reorderBuckets(projectId: string, bucketIds: string[]) {
  const updates = bucketIds.map((id, i) =>
    prisma.roadmapBucket.update({ where: { id }, data: { position: i } }),
  );
  await prisma.$transaction(updates);
}

export async function createDefaultBuckets(projectId: string) {
  const existing = await prisma.roadmapBucket.count({ where: { projectId } });
  if (existing > 0) return listBuckets(projectId);

  const defaults = [
    { name: 'Now', position: 0, color: 'var(--color-success)' },
    { name: 'Next', position: 1, color: 'var(--color-warning)' },
    { name: 'Later', position: 2, color: 'var(--color-text-tertiary)' },
  ];

  await prisma.roadmapBucket.createMany({
    data: defaults.map((d) => ({ projectId, ...d })),
  });

  return listBuckets(projectId);
}
```

- [ ] **Step 2: Write timeline and bucket data queries**

Append to the same file:

```typescript
const TIMELINE_ISSUE_SELECT = {
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
  assignee: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
  column: { select: { id: true, name: true, isDone: true } },
  labels: { select: { id: true, name: true } },
  project: { select: { id: true, prefix: true, slug: true, team: { select: { slug: true, org: { select: { slug: true } } } } } },
  _count: { select: { children: true } },
};

const CHILD_SELECT = {
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
  assignee: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
  column: { select: { id: true, name: true, isDone: true } },
};

function buildIssueFilter(
  projectId: string,
  filters: {
    assigneeId?: string; labelId?: string; type?: string;
    milestoneId?: string; sprintId?: string; search?: string;
  },
) {
  const where: Record<string, unknown> = { projectId };
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.type) where.type = filters.type;
  if (filters.milestoneId) where.milestoneId = filters.milestoneId;
  if (filters.sprintId) where.sprintId = filters.sprintId;
  if (filters.labelId) where.labels = { some: { id: filters.labelId } };
  if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' };
  return where;
}

export async function getTimelineData(
  projectId: string,
  filters: {
    startDate?: string; endDate?: string;
    assigneeId?: string; labelId?: string; type?: string;
    milestoneId?: string; sprintId?: string; search?: string;
  },
) {
  const where = buildIssueFilter(projectId, filters);

  // Timeline shows issues with at least a dueDate
  (where as any).dueDate = { not: null };

  // Only top-level issues (epics and standalone) — children loaded separately
  (where as any).parentId = null;

  // Optional time window filter
  if (filters.startDate || filters.endDate) {
    const dateFilter: Record<string, unknown> = {};
    if (filters.startDate) dateFilter.gte = new Date(filters.startDate);
    if (filters.endDate) dateFilter.lte = new Date(filters.endDate);
    (where as any).dueDate = { ...((where as any).dueDate || {}), ...dateFilter };
  }

  const issues = await prisma.issue.findMany({
    where: where as any,
    select: {
      ...TIMELINE_ISSUE_SELECT,
      children: {
        select: CHILD_SELECT,
        where: { dueDate: { not: null } },
        orderBy: { dueDate: 'asc' },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  // Fetch dependency links for all visible issues
  const allIssueIds = issues.flatMap((i) => [i.id, ...i.children.map((c: any) => c.id)]);
  const links = await prisma.issueLink.findMany({
    where: {
      OR: [
        { fromId: { in: allIssueIds }, type: 'BLOCKS' },
        { toId: { in: allIssueIds }, type: 'BLOCKS' },
      ],
    },
    select: { id: true, fromId: true, toId: true, type: true },
  });

  return { issues, links };
}

export async function getBucketsViewData(
  projectId: string,
  filters: {
    assigneeId?: string; labelId?: string; type?: string;
    milestoneId?: string; sprintId?: string; search?: string;
  },
) {
  const buckets = await listBuckets(projectId);

  const where = buildIssueFilter(projectId, filters);
  // Only top-level issues
  (where as any).parentId = null;

  // Issues with a bucket assigned
  const bucketedIssues = await prisma.issue.findMany({
    where: { ...where as any, roadmapBucketId: { not: null } },
    select: {
      ...TIMELINE_ISSUE_SELECT,
      children: {
        select: CHILD_SELECT,
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { position: 'asc' },
  });

  // Issues explicitly added to roadmap but no bucket (unassigned)
  // We'll define "on roadmap" as: has a bucket OR has startDate OR has dueDate
  const unassignedIssues = await prisma.issue.findMany({
    where: {
      ...where as any,
      roadmapBucketId: null,
      OR: [{ startDate: { not: null } }, { dueDate: { not: null } }],
    },
    select: {
      ...TIMELINE_ISSUE_SELECT,
      children: {
        select: CHILD_SELECT,
        orderBy: { position: 'asc' },
      },
    },
    orderBy: { position: 'asc' },
  });

  // Group bucketed issues by bucket
  const grouped = buckets.map((bucket) => ({
    ...bucket,
    issues: bucketedIssues.filter((i) => i.roadmapBucketId === bucket.id),
  }));

  return { buckets: grouped, unassigned: unassignedIssues };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/roadmap/roadmap.service.ts
git commit -m "feat(roadmap): add roadmap service with bucket CRUD and timeline/bucket data queries"
```

---

### Task 4: Backend — Controller and Routes

**Files:**
- Create: `src/modules/roadmap/roadmap.controller.ts`
- Create: `src/modules/roadmap/roadmap.routes.ts`

- [ ] **Step 1: Write controller**

```typescript
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation';
import {
  createBucketSchema, updateBucketSchema, reorderBucketsSchema,
  timelineQuerySchema, bucketsViewQuerySchema,
} from './roadmap.validation';
import * as roadmapService from './roadmap.service';

export const listBuckets = asyncHandler(async (req: Request, res: Response) => {
  const buckets = await roadmapService.listBuckets(param(req, 'projectId'));
  res.json(buckets);
});

export const createBucket = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createBucketSchema, req.body);
  const bucket = await roadmapService.createBucket(param(req, 'projectId'), data);
  res.status(201).json(bucket);
});

export const updateBucket = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateBucketSchema, req.body);
  const bucket = await roadmapService.updateBucket(param(req, 'projectId'), param(req, 'id'), data);
  res.json(bucket);
});

export const deleteBucket = asyncHandler(async (req: Request, res: Response) => {
  await roadmapService.deleteBucket(param(req, 'projectId'), param(req, 'id'));
  res.status(204).send();
});

export const reorderBuckets = asyncHandler(async (req: Request, res: Response) => {
  const { bucketIds } = validate(reorderBucketsSchema, req.body);
  await roadmapService.reorderBuckets(param(req, 'projectId'), bucketIds);
  res.status(204).send();
});

export const createDefaults = asyncHandler(async (req: Request, res: Response) => {
  const buckets = await roadmapService.createDefaultBuckets(param(req, 'projectId'));
  res.json(buckets);
});

export const getTimeline = asyncHandler(async (req: Request, res: Response) => {
  const filters = validate(timelineQuerySchema, req.query);
  const data = await roadmapService.getTimelineData(param(req, 'projectId'), filters);
  res.json(data);
});

export const getBucketsView = asyncHandler(async (req: Request, res: Response) => {
  const filters = validate(bucketsViewQuerySchema, req.query);
  const data = await roadmapService.getBucketsViewData(param(req, 'projectId'), filters);
  res.json(data);
});
```

- [ ] **Step 2: Write routes**

```typescript
import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import * as roadmapController from './roadmap.controller';

const router = Router();
router.use(authenticate);

// Bucket CRUD
router.get('/:projectId/roadmap/buckets', requireProjectAccess, roadmapController.listBuckets);
router.post('/:projectId/roadmap/buckets', requireProjectAccess, roadmapController.createBucket);
router.post('/:projectId/roadmap/buckets/defaults', requireProjectAccess, roadmapController.createDefaults);
router.post('/:projectId/roadmap/buckets/reorder', requireProjectAccess, roadmapController.reorderBuckets);
router.patch('/:projectId/roadmap/buckets/:id', requireProjectAccess, roadmapController.updateBucket);
router.delete('/:projectId/roadmap/buckets/:id', requireProjectAccess, roadmapController.deleteBucket);

// Data endpoints
router.get('/:projectId/roadmap/timeline', requireProjectAccess, roadmapController.getTimeline);
router.get('/:projectId/roadmap/buckets-view', requireProjectAccess, roadmapController.getBucketsView);

export default router;
```

- [ ] **Step 3: Mount routes**

In the app route mounting file:

```typescript
import roadmapRoutes from './modules/roadmap/roadmap.routes';

app.use('/api/projects', roadmapRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/roadmap/roadmap.controller.ts src/modules/roadmap/roadmap.routes.ts
git add <route-mounting-file>
git commit -m "feat(roadmap): add controller, routes, and mount in app"
```

---

### Task 5: Backend — Integration Tests

**Files:**
- Create: `src/modules/roadmap/roadmap.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { createTestContext, type TestContext } from '../../test/factory';
import { truncateAllTables, disconnectPrisma } from '../../test/test-utils';
import { prisma } from '../../config/database';

describe('Roadmap', () => {
  let ctx: TestContext;
  let bucketId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await truncateAllTables();
    await disconnectPrisma();
  });

  describe('Buckets', () => {
    it('should create default buckets', async () => {
      const res = await request(app)
        .post(`/api/projects/${ctx.project.id}/roadmap/buckets/defaults`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(3);
      expect(res.body[0].name).toBe('Now');
      expect(res.body[1].name).toBe('Next');
      expect(res.body[2].name).toBe('Later');
      bucketId = res.body[0].id;
    });

    it('should not duplicate defaults', async () => {
      const res = await request(app)
        .post(`/api/projects/${ctx.project.id}/roadmap/buckets/defaults`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.length).toBe(3);
    });

    it('should create a custom bucket', async () => {
      const res = await request(app)
        .post(`/api/projects/${ctx.project.id}/roadmap/buckets`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ name: 'Q1 2026', color: 'var(--color-primary)' });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Q1 2026');
    });

    it('should delete a bucket and unset issues', async () => {
      // Create an issue with this bucket
      const issueRes = await request(app)
        .post(`/api/projects/${ctx.project.id}/issues`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Roadmap test issue' });

      await prisma.issue.update({
        where: { id: issueRes.body.id },
        data: { roadmapBucketId: bucketId },
      });

      await request(app)
        .delete(`/api/projects/${ctx.project.id}/roadmap/buckets/${bucketId}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .expect(204);

      const issue = await prisma.issue.findUnique({ where: { id: issueRes.body.id } });
      expect(issue!.roadmapBucketId).toBeNull();
    });
  });

  describe('Timeline', () => {
    it('should return issues with dates and dependency links', async () => {
      // Create issues with dates
      const epic = await request(app)
        .post(`/api/projects/${ctx.project.id}/issues`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Epic for roadmap', type: 'EPIC', dueDate: '2026-06-01T00:00:00.000Z' });

      await prisma.issue.update({
        where: { id: epic.body.id },
        data: { startDate: new Date('2026-04-01') },
      });

      const res = await request(app)
        .get(`/api/projects/${ctx.project.id}/roadmap/timeline`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.issues).toBeDefined();
      expect(res.body.links).toBeDefined();
      expect(res.body.issues.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Buckets View', () => {
    it('should return issues grouped by bucket', async () => {
      const res = await request(app)
        .get(`/api/projects/${ctx.project.id}/roadmap/buckets-view`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.buckets).toBeDefined();
      expect(res.body.unassigned).toBeDefined();
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npm run test -- --testPathPattern=roadmap`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/modules/roadmap/roadmap.test.ts
git commit -m "test(roadmap): add integration tests for buckets and timeline/bucket views"
```

---

### Task 6: Frontend — API Client

**Files:**
- Create: `frontend/src/api/roadmap.api.ts`

- [ ] **Step 1: Write API client**

```typescript
import { get, post, patch, del } from './client';

export interface RoadmapBucket {
  id: string;
  projectId: string;
  name: string;
  position: number;
  color: string | null;
  _count: { issues: number };
}

export interface TimelineIssue {
  id: string;
  number: number;
  title: string;
  type: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  columnId: string | null;
  parentId: string | null;
  assigneeId: string | null;
  roadmapBucketId: string | null;
  assignee: { id: string; username: string; displayName: string | null; avatarUrl: string | null } | null;
  column: { id: string; name: string; isDone: boolean } | null;
  labels: { id: string; name: string }[];
  project: { id: string; prefix: string; slug: string; team: { slug: string; org: { slug: string } } };
  _count: { children: number };
  children?: TimelineIssue[];
}

export interface DependencyLink {
  id: string;
  fromId: string;
  toId: string;
  type: string;
}

export interface TimelineData {
  issues: TimelineIssue[];
  links: DependencyLink[];
}

export interface BucketsViewData {
  buckets: (RoadmapBucket & { issues: TimelineIssue[] })[];
  unassigned: TimelineIssue[];
}

type Filters = {
  assigneeId?: string;
  labelId?: string;
  type?: string;
  milestoneId?: string;
  sprintId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
};

function buildQuery(filters?: Filters): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const roadmapApi = {
  // Buckets
  listBuckets: (projectId: string) =>
    get<RoadmapBucket[]>(`/api/projects/${projectId}/roadmap/buckets`),
  createBucket: (projectId: string, data: { name: string; color?: string }) =>
    post<RoadmapBucket>(`/api/projects/${projectId}/roadmap/buckets`, data),
  createDefaults: (projectId: string) =>
    post<RoadmapBucket[]>(`/api/projects/${projectId}/roadmap/buckets/defaults`, {}),
  updateBucket: (projectId: string, bucketId: string, data: { name?: string; color?: string | null }) =>
    patch<RoadmapBucket>(`/api/projects/${projectId}/roadmap/buckets/${bucketId}`, data),
  deleteBucket: (projectId: string, bucketId: string) =>
    del<void>(`/api/projects/${projectId}/roadmap/buckets/${bucketId}`),
  reorderBuckets: (projectId: string, bucketIds: string[]) =>
    post<void>(`/api/projects/${projectId}/roadmap/buckets/reorder`, { bucketIds }),

  // Data
  getTimeline: (projectId: string, filters?: Filters) =>
    get<TimelineData>(`/api/projects/${projectId}/roadmap/timeline${buildQuery(filters)}`),
  getBucketsView: (projectId: string, filters?: Filters) =>
    get<BucketsViewData>(`/api/projects/${projectId}/roadmap/buckets-view${buildQuery(filters)}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/roadmap.api.ts
git commit -m "feat(roadmap): add frontend API client"
```

---

### Task 7: Frontend — Shared Utility Components

**Files:**
- Create: `frontend/src/components/ui/ProgressBar.tsx`
- Create: `frontend/src/components/ui/TimelineZoom.tsx`
- Create: `frontend/src/components/ui/IssuePickerModal.tsx`

- [ ] **Step 1: Write ProgressBar**

```tsx
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ProgressBarProps {
  value: number; // 0-100
  className?: string;
  color?: string; // CSS variable
}

export const ProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ value, className, color }, ref) => {
    const clamped = Math.min(100, Math.max(0, value));
    return (
      <div ref={ref} className={cn('h-1.5 w-full bg-surface-secondary rounded-full overflow-hidden', className)}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${clamped}%`,
            backgroundColor: color || 'var(--color-primary)',
          }}
        />
      </div>
    );
  },
);
ProgressBar.displayName = 'ProgressBar';
```

- [ ] **Step 2: Write TimelineZoom**

```tsx
import { ZoomIn } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ZoomLevel = 'weeks' | 'months' | 'quarters';

interface TimelineZoomProps {
  value: ZoomLevel;
  onChange: (level: ZoomLevel) => void;
}

const levels: { key: ZoomLevel; label: string }[] = [
  { key: 'weeks', label: 'Weeks' },
  { key: 'months', label: 'Months' },
  { key: 'quarters', label: 'Quarters' },
];

export function TimelineZoom({ value, onChange }: TimelineZoomProps) {
  return (
    <div className="inline-flex items-center gap-1 bg-surface-secondary rounded-lg p-0.5">
      <ZoomIn className="h-3.5 w-3.5 text-text-tertiary ml-1.5" />
      {levels.map((level) => (
        <button
          key={level.key}
          onClick={() => onChange(level.key)}
          className={cn(
            'px-2.5 py-1 rounded-md text-xs font-medium transition-colors',
            value === level.key
              ? 'bg-surface text-text shadow-sm'
              : 'text-text-secondary hover:text-text',
          )}
        >
          {level.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write IssuePickerModal**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Plus } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { IssueTypeIcon } from './IssueTypeIcon';
import { PriorityBadge } from './PriorityBadge';

interface IssuePickerModalProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onSelect: (issueId: string) => void;
  fetchIssues: (projectId: string, search: string) => Promise<{ issues: { id: string; number: number; title: string; type: string; priority: string }[] }>;
}

export function IssuePickerModal({ open, onClose, projectId, onSelect, fetchIssues }: IssuePickerModalProps) {
  const [search, setSearch] = useState('');

  const { data } = useQuery({
    queryKey: ['issue-picker', projectId, search],
    queryFn: () => fetchIssues(projectId, search),
    enabled: open && search.length >= 1,
  });

  return (
    <Modal open={open} onClose={onClose} title="Add Issue to Roadmap" size="md">
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues..."
            className="w-full pl-9 pr-3 py-2 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30"
            autoFocus
          />
        </div>

        <div className="max-h-64 overflow-y-auto space-y-1">
          {data?.issues.map((issue) => (
            <button
              key={issue.id}
              onClick={() => { onSelect(issue.id); onClose(); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-surface-secondary transition-colors"
            >
              <IssueTypeIcon type={issue.type} className="h-4 w-4 shrink-0" />
              <span className="text-xs text-text-tertiary font-mono">#{issue.number}</span>
              <span className="text-sm text-text flex-1 truncate">{issue.title}</span>
              <PriorityBadge priority={issue.priority} />
              <Plus className="h-4 w-4 text-text-tertiary" />
            </button>
          ))}
          {search && data?.issues.length === 0 && (
            <p className="text-sm text-text-tertiary text-center py-4">No issues found</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/ProgressBar.tsx frontend/src/components/ui/TimelineZoom.tsx frontend/src/components/ui/IssuePickerModal.tsx
git commit -m "feat(roadmap): add ProgressBar, TimelineZoom, and IssuePickerModal components"
```

---

### Task 8: Frontend — Gantt Chart Components

**Files:**
- Create: `frontend/src/components/ui/GanttTimeAxis.tsx`
- Create: `frontend/src/components/ui/GanttBar.tsx`
- Create: `frontend/src/components/ui/GanttMilestone.tsx`
- Create: `frontend/src/components/ui/DragHandle.tsx`
- Create: `frontend/src/components/ui/GanttRow.tsx`
- Create: `frontend/src/components/ui/DependencyArrow.tsx`
- Create: `frontend/src/components/ui/DependencyOverlay.tsx`
- Create: `frontend/src/components/ui/GanttChart.tsx`

This is the most complex UI task. All components are custom SVG + HTML. No third-party chart libraries.

- [ ] **Step 1: Write GanttTimeAxis**

Renders the time header with divisions and vertical gridlines. Takes `startDate`, `endDate`, `zoom` level, and `dayWidth` (pixels per day). Renders column headers (week numbers, month names, or quarter labels) and vertical grid lines.

Key implementation: calculate visible date range, divide into intervals based on zoom, render `<div>` labels and `<div>` gridlines positioned absolutely within the scrollable container.

- [ ] **Step 2: Write GanttBar**

A horizontally positioned bar representing an issue. Props: `x` (pixel start), `width` (pixel width), `y` (pixel row position), `color`, `label`, `progress` (0-100 for epics). Renders as a `<div>` with absolute positioning. Supports:
- Drag left edge: resize start date (`onResizeStart`)
- Drag right edge: resize due date (`onResizeEnd`)
- Drag entire bar: move both dates (`onMove`)
- Click: select issue (`onClick`)
- Hover: show tooltip

Uses `onPointerDown`/`onPointerMove`/`onPointerUp` for cross-browser drag support. Throttle position updates to 60fps via `requestAnimationFrame`.

- [ ] **Step 3: Write GanttMilestone**

Diamond-shaped marker for issues with only a due date (no start date). Props: `x`, `y`, `color`, `label`. Rendered as a rotated square `<div>` with absolute positioning.

- [ ] **Step 4: Write DragHandle**

Small circle that appears on bar edges on hover. Used for creating dependency links. Props: `x`, `y`, `onDragStart`. Rendered as a `<circle>` in the SVG overlay.

- [ ] **Step 5: Write GanttRow**

A single row representing an issue. Renders either `GanttBar` or `GanttMilestone` depending on whether the issue has a start date. For epics, shows an expand/collapse toggle. When expanded, renders child issue rows below with indentation.

Props: `issue`, `dayWidth`, `startDate`, `y`, `isExpanded`, `onToggleExpand`, `onDateChange`, `onClick`.

Date-to-pixel conversion: `(date - viewStartDate) / msPerDay * dayWidth`.

- [ ] **Step 6: Write DependencyArrow**

SVG `<path>` element drawing a right-angle connector between two bars. Props: `from: {x, y}`, `to: {x, y}`, `isViolation` (boolean — blocked issue starts before blocker ends). Uses a simple path: horizontal from source end, vertical to target row, horizontal to target start. Arrow head via SVG marker. Color: `var(--color-text-tertiary)` normal, `var(--color-danger)` for violations.

- [ ] **Step 7: Write DependencyOverlay**

SVG overlay positioned on top of the Gantt chart. Manages all `DependencyArrow` components. Handles:
- Rendering arrows from `links` data
- Hit testing on click (select an arrow for deletion)
- Drag-to-create: when user drags from a `DragHandle`, tracks mouse position and shows a temporary arrow. On drop over another bar, calls `onCreateLink(fromId, toId)`.

- [ ] **Step 8: Write GanttChart container**

The main container component. Manages:
- Scroll position (horizontal scrolling over time)
- Zoom level → dayWidth calculation (weeks: 40px/day, months: 12px/day, quarters: 4px/day)
- View date range calculation from scroll position
- Row layout (y positions for each issue, accounting for expanded epics)
- Renders: `GanttTimeAxis` (sticky top), issue label column (sticky left), `GanttRow` components, `DependencyOverlay`
- Debounced scroll handler for loading additional data when scrolling near edges

Structure:
```
<div className="relative overflow-auto" style={{ height: '100%' }}>
  <GanttTimeAxis ... /> {/* sticky top */}
  <div className="relative" style={{ width: totalWidth, minHeight: totalHeight }}>
    {rows.map(row => <GanttRow ... />)}
    <DependencyOverlay ... /> {/* SVG absolute overlay */}
  </div>
</div>
```

Each of these sub-steps is significant. The implementing agent should create one component at a time, verify it compiles, then move on.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/ui/GanttTimeAxis.tsx frontend/src/components/ui/GanttBar.tsx
git add frontend/src/components/ui/GanttMilestone.tsx frontend/src/components/ui/DragHandle.tsx
git add frontend/src/components/ui/GanttRow.tsx frontend/src/components/ui/DependencyArrow.tsx
git add frontend/src/components/ui/DependencyOverlay.tsx frontend/src/components/ui/GanttChart.tsx
git commit -m "feat(roadmap): add custom Gantt chart components"
```

---

### Task 9: Frontend — Bucket View Components

**Files:**
- Create: `frontend/src/components/ui/RoadmapCard.tsx`
- Create: `frontend/src/components/ui/BucketColumn.tsx`
- Create: `frontend/src/components/ui/BucketBoard.tsx`

- [ ] **Step 1: Write RoadmapCard**

```tsx
import { ChevronDown, ChevronRight } from 'lucide-react';
import { IssueTypeIcon } from './IssueTypeIcon';
import { PriorityBadge } from './PriorityBadge';
import { Avatar } from './Avatar';
import { ProgressBar } from './ProgressBar';
import { cn } from '@/lib/utils';
import type { TimelineIssue } from '@/api/roadmap.api';

interface RoadmapCardProps {
  issue: TimelineIssue;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  onClick: () => void;
  projectPrefix: string;
}

export function RoadmapCard({ issue, isExpanded, onToggleExpand, onClick, projectPrefix }: RoadmapCardProps) {
  const hasChildren = (issue._count?.children ?? 0) > 0;
  const childCount = issue.children?.length ?? issue._count?.children ?? 0;
  const doneChildren = issue.children?.filter((c) => c.column?.isDone).length ?? 0;
  const progress = childCount > 0 ? Math.round((doneChildren / childCount) * 100) : 0;

  return (
    <div>
      <div
        className={cn(
          'bg-surface border border-border rounded-lg p-3 cursor-pointer hover:border-border-focus transition-colors',
          'group',
        )}
        onClick={onClick}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/json', JSON.stringify({ issueId: issue.id }));
          e.dataTransfer.effectAllowed = 'move';
        }}
      >
        <div className="flex items-start gap-2">
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleExpand?.(); }}
              className="mt-0.5 text-text-tertiary hover:text-text"
            >
              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1">
              <IssueTypeIcon type={issue.type} className="h-4 w-4 shrink-0" />
              <span className="text-xs text-text-tertiary font-mono">{projectPrefix}-{issue.number}</span>
              <PriorityBadge priority={issue.priority} />
            </div>
            <p className="text-sm font-medium text-text truncate">{issue.title}</p>
          </div>
          {issue.assignee && (
            <Avatar src={issue.assignee.avatarUrl} name={issue.assignee.displayName || issue.assignee.username} size="xs" />
          )}
        </div>
        {hasChildren && (
          <div className="mt-2">
            <ProgressBar value={progress} />
            <span className="text-xs text-text-tertiary mt-0.5">{doneChildren}/{childCount} done</span>
          </div>
        )}
      </div>

      {/* Expanded children */}
      {isExpanded && issue.children && (
        <div className="ml-6 mt-1 space-y-1">
          {issue.children.map((child: TimelineIssue) => (
            <div
              key={child.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-surface-secondary cursor-pointer"
              onClick={onClick}
            >
              <IssueTypeIcon type={child.type} className="h-3.5 w-3.5" />
              <span className="text-xs text-text-tertiary font-mono">{projectPrefix}-{child.number}</span>
              <span className="text-text truncate flex-1">{child.title}</span>
              <PriorityBadge priority={child.priority} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Write BucketColumn**

```tsx
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { RoadmapCard } from './RoadmapCard';
import type { TimelineIssue } from '@/api/roadmap.api';

interface BucketColumnProps {
  name: string;
  color: string | null;
  issues: TimelineIssue[];
  projectPrefix: string;
  onDropIssue: (issueId: string) => void;
  onIssueClick: (issue: TimelineIssue) => void;
}

export function BucketColumn({ name, color, issues, projectPrefix, onDropIssue, onIssueClick }: BucketColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div
      className={cn(
        'flex flex-col min-w-[280px] max-w-[320px] bg-surface-secondary rounded-lg',
        isDragOver && 'ring-2 ring-primary/30 bg-primary/5',
      )}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        try {
          const data = JSON.parse(e.dataTransfer.getData('application/json'));
          if (data.issueId) onDropIssue(data.issueId);
        } catch {}
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
        {color && <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: color }} />}
        <span className="text-sm font-semibold text-text">{name}</span>
        <span className="text-xs text-text-tertiary ml-auto">{issues.length}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {issues.map((issue) => (
          <RoadmapCard
            key={issue.id}
            issue={issue}
            projectPrefix={projectPrefix}
            isExpanded={expandedIds.has(issue.id)}
            onToggleExpand={() => toggleExpand(issue.id)}
            onClick={() => onIssueClick(issue)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write BucketBoard**

```tsx
import { BucketColumn } from './BucketColumn';
import type { BucketsViewData, TimelineIssue } from '@/api/roadmap.api';

interface BucketBoardProps {
  data: BucketsViewData;
  projectPrefix: string;
  onMoveToBucket: (issueId: string, bucketId: string | null) => void;
  onIssueClick: (issue: TimelineIssue) => void;
}

export function BucketBoard({ data, projectPrefix, onMoveToBucket, onIssueClick }: BucketBoardProps) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4 h-full">
      {data.buckets.map((bucket) => (
        <BucketColumn
          key={bucket.id}
          name={bucket.name}
          color={bucket.color}
          issues={bucket.issues}
          projectPrefix={projectPrefix}
          onDropIssue={(issueId) => onMoveToBucket(issueId, bucket.id)}
          onIssueClick={onIssueClick}
        />
      ))}

      {/* Unassigned column */}
      {data.unassigned.length > 0 && (
        <BucketColumn
          name="Unassigned"
          color={null}
          issues={data.unassigned}
          projectPrefix={projectPrefix}
          onDropIssue={(issueId) => onMoveToBucket(issueId, null)}
          onIssueClick={onIssueClick}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/RoadmapCard.tsx frontend/src/components/ui/BucketColumn.tsx frontend/src/components/ui/BucketBoard.tsx
git commit -m "feat(roadmap): add bucket view components"
```

---

### Task 10: Frontend — Roadmap Page

**Files:**
- Create: `frontend/src/pages/roadmap/Roadmap.tsx`

- [ ] **Step 1: Write Roadmap page**

```tsx
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Map, Plus, Settings } from 'lucide-react';
import { useProjectContext } from '@/hooks/useProjectContext';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { roadmapApi, type TimelineIssue } from '@/api/roadmap.api';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { TimelineZoom, type ZoomLevel } from '@/components/ui/TimelineZoom';
import { GanttChart } from '@/components/ui/GanttChart';
import { BucketBoard } from '@/components/ui/BucketBoard';
import { IssuePickerModal } from '@/components/ui/IssuePickerModal';

type Mode = 'timeline' | 'buckets';

export default function Roadmap() {
  const { currentProject } = useProjectContext();
  const projectId = currentProject!.id;
  const projectPrefix = currentProject!.prefix;
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>('timeline');
  const [zoom, setZoom] = useState<ZoomLevel>('months');
  const [showIssuePicker, setShowIssuePicker] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});

  // Timeline data
  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ['roadmap-timeline', projectId, filters],
    queryFn: () => roadmapApi.getTimeline(projectId, filters),
    enabled: mode === 'timeline',
  });

  // Buckets data
  const { data: bucketsData, isLoading: bucketsLoading } = useQuery({
    queryKey: ['roadmap-buckets-view', projectId, filters],
    queryFn: () => roadmapApi.getBucketsView(projectId, filters),
    enabled: mode === 'buckets',
  });

  // Check if buckets exist
  const { data: buckets } = useQuery({
    queryKey: ['roadmap-buckets', projectId],
    queryFn: () => roadmapApi.listBuckets(projectId),
  });

  const createDefaultsMutation = useMutationWithToast(
    () => roadmapApi.createDefaults(projectId),
    {
      successMessage: 'Default buckets created',
      errorMessage: 'Failed to create buckets',
      invalidateKeys: [['roadmap-buckets', projectId], ['roadmap-buckets-view', projectId]],
    },
  );

  const moveToBucketMutation = useMutationWithToast(
    ({ issueId, bucketId }: { issueId: string; bucketId: string | null }) =>
      // Uses the existing issue PATCH endpoint
      import('@/api/client').then(({ patch }) =>
        patch(`/api/projects/${projectId}/issues/${issueId}`, { roadmapBucketId: bucketId }),
      ),
    {
      successMessage: null,
      errorMessage: 'Failed to move issue',
      invalidateKeys: [['roadmap-buckets-view', projectId]],
    },
  );

  const isLoading = mode === 'timeline' ? timelineLoading : bucketsLoading;
  const tabs = [
    { key: 'timeline' as const, label: 'Timeline' },
    { key: 'buckets' as const, label: 'Buckets' },
  ];

  const handleIssueClick = (issue: TimelineIssue) => {
    const { slug, team } = issue.project;
    window.location.href = `/${team.org.slug}/${team.slug}/${slug}/issues/${issue.number}`;
  };

  // Show setup prompt if in buckets mode and no buckets exist
  if (mode === 'buckets' && buckets && buckets.length === 0) {
    return (
      <div className="h-full flex flex-col">
        <RoadmapToolbar mode={mode} onModeChange={setMode} zoom={zoom} onZoomChange={setZoom} onAddIssue={() => setShowIssuePicker(true)} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Map className="h-10 w-10 text-text-tertiary mx-auto" />
            <h2 className="text-lg font-semibold text-text">Set up your roadmap</h2>
            <p className="text-sm text-text-secondary max-w-md">Create buckets to organize your roadmap. Start with defaults or customize your own.</p>
            <div className="flex items-center justify-center gap-2">
              <Button onClick={() => createDefaultsMutation.mutate(undefined)} disabled={createDefaultsMutation.isPending}>
                <Plus className="h-4 w-4" /> Now / Next / Later
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <RoadmapToolbar mode={mode} onModeChange={setMode} zoom={zoom} onZoomChange={setZoom} onAddIssue={() => setShowIssuePicker(true)} />

      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full"><Spinner /></div>
        ) : mode === 'timeline' && timelineData ? (
          timelineData.issues.length === 0 ? (
            <EmptyState
              icon={Map}
              title="No issues on the timeline"
              description="Add issues with due dates to see them on the timeline."
            />
          ) : (
            <GanttChart
              issues={timelineData.issues}
              links={timelineData.links}
              zoom={zoom}
              projectPrefix={projectPrefix}
              projectId={projectId}
              onIssueClick={handleIssueClick}
            />
          )
        ) : mode === 'buckets' && bucketsData ? (
          <BucketBoard
            data={bucketsData}
            projectPrefix={projectPrefix}
            onMoveToBucket={(issueId, bucketId) => moveToBucketMutation.mutate({ issueId, bucketId })}
            onIssueClick={handleIssueClick}
          />
        ) : null}
      </div>

      <IssuePickerModal
        open={showIssuePicker}
        onClose={() => setShowIssuePicker(false)}
        projectId={projectId}
        onSelect={(issueId) => {
          // For now, just invalidate to show updated data
          queryClient.invalidateQueries({ queryKey: ['roadmap-timeline', projectId] });
          queryClient.invalidateQueries({ queryKey: ['roadmap-buckets-view', projectId] });
        }}
        fetchIssues={async (pid, search) => {
          const { get: apiGet } = await import('@/api/client');
          return apiGet(`/api/projects/${pid}/issues?q=${encodeURIComponent(search)}&limit=20`);
        }}
      />
    </div>
  );
}

// Toolbar sub-component
function RoadmapToolbar({
  mode, onModeChange, zoom, onZoomChange, onAddIssue,
}: {
  mode: Mode; onModeChange: (m: Mode) => void;
  zoom: ZoomLevel; onZoomChange: (z: ZoomLevel) => void;
  onAddIssue: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface">
      <Tabs
        tabs={[
          { key: 'timeline', label: 'Timeline' },
          { key: 'buckets', label: 'Buckets' },
        ]}
        activeKey={mode}
        onChange={(key) => onModeChange(key as Mode)}
      />

      {mode === 'timeline' && (
        <TimelineZoom value={zoom} onChange={onZoomChange} />
      )}

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onAddIssue}>
          <Plus className="h-4 w-4" /> Add to Roadmap
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register route and nav link**

```typescript
const Roadmap = lazy(() => import('@/pages/roadmap/Roadmap'));

// In project routes, between Board and Backlog:
<Route path="/:org/:team/:project/roadmap" element={<Roadmap />} />
```

Add sidebar nav link:
```tsx
<NavItem to={`/${org}/${team}/${project}/roadmap`} icon={Map}>
  Roadmap
</NavItem>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/roadmap/Roadmap.tsx
git add <route-file> <sidebar-file>
git commit -m "feat(roadmap): add Roadmap page with timeline and bucket modes"
```

---

### Task 11: Typecheck and Final Verification

- [ ] **Step 1: Run backend typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: All pass including roadmap tests.

- [ ] **Step 4: Run full check**

Run: `npm run check`
Expected: All pass.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(roadmap): resolve typecheck and lint issues"
```
