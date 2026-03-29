# Sprint Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sprint report showing completed vs incomplete issues with scope change tracking, so scrum teams can review what happened during a sprint.

**Architecture:** New `SprintIssueHistory` model to track when issues are added/removed from sprints. New report endpoint aggregates this data. Frontend renders as a dedicated report page accessible from sprint dropdown.

**Tech Stack:** Prisma, Express, React, TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-28-high-value-features-design.md` (Feature 4)

---

## File Structure

### Backend (new files)
- `src/modules/sprints/sprint-report.service.ts` — Report data aggregation
- `src/modules/sprints/sprint-report.controller.ts` — Report endpoint
- `src/modules/sprints/sprint-report.test.ts` — Tests

### Backend (modified files)
- `prisma/schema.prisma` — Add `SprintIssueHistory` model
- `src/modules/sprints/sprints.service.ts` — Record history on add/remove issue
- `src/modules/sprints/sprints.routes.ts` — Mount report endpoint

### Frontend (new files)
- `frontend/src/pages/issues/SprintReport.tsx` — Sprint report page
- `frontend/src/api/sprint-report.api.ts` — API client

---

## Task 1: Database Model

**Files:**
- Modify: `prisma/schema.prisma`

### Step 1: Add SprintIssueHistory model

- [ ] Add to `prisma/schema.prisma`:

```prisma
enum SprintIssueAction {
  ADDED
  REMOVED
}

model SprintIssueHistory {
  id        String            @id @default(cuid())
  sprintId  String
  sprint    Sprint            @relation(fields: [sprintId], references: [id], onDelete: Cascade)
  issueId   String
  issue     Issue             @relation(fields: [issueId], references: [id], onDelete: Cascade)
  action    SprintIssueAction
  timestamp DateTime          @default(now())

  @@index([sprintId])
  @@index([issueId])
  @@map("sprint_issue_history")
}
```

- [ ] Add reverse relations:

```prisma
// In Sprint model:
issueHistory SprintIssueHistory[]

// In Issue model:
sprintHistory SprintIssueHistory[]
```

- [ ] Also add a `committedAt` field to the Sprint model to snapshot when the sprint was started:

```prisma
// In Sprint model, add:
committedAt DateTime?  // Set when sprint starts, snapshots the "committed" set
```

### Step 2: Run migration

- [ ] Generate and apply:

```bash
npx prisma migrate dev --name add-sprint-issue-history
```

- [ ] Commit:

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(sprints): add SprintIssueHistory model for scope change tracking"
```

---

## Task 2: Record Sprint History Events

**Files:**
- Modify: `src/modules/sprints/sprints.service.ts`

### Step 1: Add history recording to existing methods

- [ ] In `sprints.service.ts`, modify `addIssuesToSprint` to record ADDED events:

```typescript
// After the existing prisma.issue.updateMany or individual updates:
await prisma.sprintIssueHistory.createMany({
  data: issueIds.map(issueId => ({
    sprintId,
    issueId,
    action: 'ADDED'
  }))
});
```

- [ ] Modify `removeIssueFromSprint` to record REMOVED events:

```typescript
// Before or after the existing prisma.issue.update:
await prisma.sprintIssueHistory.create({
  data: {
    sprintId: issue.sprintId, // capture before clearing
    issueId,
    action: 'REMOVED'
  }
});
```

- [ ] Modify `startSprint` to set `committedAt`:

```typescript
// In the update that transitions status to ACTIVE:
await prisma.sprint.update({
  where: { id: sprintId },
  data: {
    status: 'ACTIVE',
    committedAt: new Date()
  }
});
```

- [ ] Modify `completeSprint` — when moving incomplete issues to another sprint or backlog, record REMOVED events for each:

```typescript
// Before moving issues, record REMOVED for each incomplete issue:
const incompleteIssues = await prisma.issue.findMany({
  where: { sprintId, column: { isDone: false } }
});
if (incompleteIssues.length > 0) {
  await prisma.sprintIssueHistory.createMany({
    data: incompleteIssues.map(issue => ({
      sprintId,
      issueId: issue.id,
      action: 'REMOVED'
    }))
  });
}
```

- [ ] Commit:

```bash
git add src/modules/sprints/sprints.service.ts
git commit -m "feat(sprints): record issue add/remove history events for sprint reports"
```

---

## Task 3: Sprint Report Service and Endpoint

**Files:**
- Create: `src/modules/sprints/sprint-report.service.ts`
- Create: `src/modules/sprints/sprint-report.controller.ts`
- Modify: `src/modules/sprints/sprints.routes.ts`

### Step 1: Write the report service

- [ ] Create the service:

```typescript
// src/modules/sprints/sprint-report.service.ts
import { prisma } from '../../config/database';

export interface SprintReportData {
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    startDate: Date;
    endDate: Date;
    committedAt: Date | null;
    status: string;
  };
  summary: {
    committedCount: number;
    committedPoints: number;
    completedCount: number;
    completedPoints: number;
    incompleteCount: number;
    incompletePoints: number;
    addedMidSprintCount: number;
    removedMidSprintCount: number;
  };
  completedIssues: Array<{
    id: string;
    number: number;
    title: string;
    type: string;
    priority: string;
    storyPoints: number | null;
    columnName: string;
    addedMidSprint: boolean;
  }>;
  incompleteIssues: Array<{
    id: string;
    number: number;
    title: string;
    type: string;
    priority: string;
    storyPoints: number | null;
    columnName: string;
    destination: string; // "backlog" or sprint name
  }>;
  scopeChanges: Array<{
    issueId: string;
    issueNumber: number;
    issueTitle: string;
    action: string;
    timestamp: Date;
  }>;
}

export async function getSprintReport(
  projectId: string,
  sprintId: string
): Promise<SprintReportData> {
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    include: {
      issues: {
        include: {
          column: { select: { name: true, isDone: true } }
        }
      },
      issueHistory: {
        include: {
          issue: { select: { id: true, number: true, title: true } }
        },
        orderBy: { timestamp: 'asc' }
      }
    }
  });

  if (!sprint || sprint.projectId !== projectId) {
    throw new Error('Sprint not found');
  }

  // Determine which issues were "committed" (present when sprint started)
  const committedIssueIds = new Set<string>();
  const addedAfterStart = new Set<string>();

  if (sprint.committedAt) {
    for (const h of sprint.issueHistory) {
      if (h.action === 'ADDED' && h.timestamp <= sprint.committedAt) {
        committedIssueIds.add(h.issueId);
      } else if (h.action === 'ADDED' && h.timestamp > sprint.committedAt) {
        addedAfterStart.add(h.issueId);
      }
    }
  } else {
    // Sprint not yet started or legacy — treat all current issues as committed
    sprint.issues.forEach(i => committedIssueIds.add(i.id));
  }

  const completedIssues = sprint.issues
    .filter(i => i.column?.isDone)
    .map(i => ({
      id: i.id,
      number: i.number,
      title: i.title,
      type: i.type,
      priority: i.priority,
      storyPoints: i.storyPoints,
      columnName: i.column!.name,
      addedMidSprint: addedAfterStart.has(i.id)
    }));

  const incompleteIssues = sprint.issues
    .filter(i => !i.column?.isDone)
    .map(i => ({
      id: i.id,
      number: i.number,
      title: i.title,
      type: i.type,
      priority: i.priority,
      storyPoints: i.storyPoints,
      columnName: i.column?.name || 'Unknown',
      destination: 'current sprint' // Will be updated for completed sprints
    }));

  // For completed sprints, check where incomplete issues went
  if (sprint.status === 'COMPLETED') {
    for (const issue of incompleteIssues) {
      const fullIssue = await prisma.issue.findUnique({
        where: { id: issue.id },
        include: { sprint: { select: { name: true } } }
      });
      issue.destination = fullIssue?.sprint?.name || 'backlog';
    }
  }

  const removedDuringSprint = sprint.issueHistory.filter(
    h => h.action === 'REMOVED' && sprint.committedAt && h.timestamp > sprint.committedAt
  );

  const scopeChanges = sprint.issueHistory
    .filter(h => sprint.committedAt && h.timestamp > sprint.committedAt)
    .map(h => ({
      issueId: h.issue.id,
      issueNumber: h.issue.number,
      issueTitle: h.issue.title,
      action: h.action,
      timestamp: h.timestamp
    }));

  const completedPoints = completedIssues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
  const incompletePoints = incompleteIssues.reduce((sum, i) => sum + (i.storyPoints || 0), 0);
  const committedPoints = completedPoints + incompletePoints; // simplified

  return {
    sprint: {
      id: sprint.id,
      name: sprint.name,
      goal: sprint.goal,
      startDate: sprint.startDate,
      endDate: sprint.endDate,
      committedAt: sprint.committedAt,
      status: sprint.status
    },
    summary: {
      committedCount: committedIssueIds.size,
      committedPoints,
      completedCount: completedIssues.length,
      completedPoints,
      incompleteCount: incompleteIssues.length,
      incompletePoints,
      addedMidSprintCount: addedAfterStart.size,
      removedMidSprintCount: removedDuringSprint.length
    },
    completedIssues,
    incompleteIssues,
    scopeChanges
  };
}
```

### Step 2: Write the controller

- [ ] Create the controller:

```typescript
// src/modules/sprints/sprint-report.controller.ts
import { Request, Response } from 'express';
import { getSprintReport } from './sprint-report.service';

export async function sprintReport(req: Request, res: Response) {
  const { projectId, sprintId } = req.params;
  const report = await getSprintReport(projectId, sprintId);
  res.json(report);
}
```

### Step 3: Mount the route

- [ ] In `src/modules/sprints/sprints.routes.ts`, add:

```typescript
import { sprintReport } from './sprint-report.controller';

// Add alongside existing sprint routes:
router.get('/:projectId/sprints/:sprintId/report', sprintReport);
```

- [ ] Commit:

```bash
git add src/modules/sprints/sprint-report.service.ts src/modules/sprints/sprint-report.controller.ts src/modules/sprints/sprints.routes.ts
git commit -m "feat(sprints): add sprint report endpoint with scope change tracking"
```

---

## Task 4: Sprint Report Frontend

**Files:**
- Create: `frontend/src/api/sprint-report.api.ts`
- Create: `frontend/src/pages/issues/SprintReport.tsx`

### Step 1: Create the API client

- [ ] Create:

```typescript
// frontend/src/api/sprint-report.api.ts
import { get } from './client';

export interface SprintReportData {
  sprint: {
    id: string;
    name: string;
    goal: string | null;
    startDate: string;
    endDate: string;
    committedAt: string | null;
    status: string;
  };
  summary: {
    committedCount: number;
    committedPoints: number;
    completedCount: number;
    completedPoints: number;
    incompleteCount: number;
    incompletePoints: number;
    addedMidSprintCount: number;
    removedMidSprintCount: number;
  };
  completedIssues: Array<{
    id: string;
    number: number;
    title: string;
    type: string;
    priority: string;
    storyPoints: number | null;
    columnName: string;
    addedMidSprint: boolean;
  }>;
  incompleteIssues: Array<{
    id: string;
    number: number;
    title: string;
    type: string;
    priority: string;
    storyPoints: number | null;
    columnName: string;
    destination: string;
  }>;
  scopeChanges: Array<{
    issueId: string;
    issueNumber: number;
    issueTitle: string;
    action: string;
    timestamp: string;
  }>;
}

export const sprintReportApi = {
  get: (projectId: string, sprintId: string) =>
    get<SprintReportData>(`/projects/${projectId}/sprints/${sprintId}/report`),
};
```

### Step 2: Build the sprint report page

- [ ] Create `frontend/src/pages/issues/SprintReport.tsx`:

Key elements:
- **Header:** Sprint name, goal, date range
- **Summary bar:** Four stat cards in a grid — Committed (count/points), Completed, Incomplete, Scope Changes. Use `CheckCircle`, `Circle`, `AlertCircle`, `ArrowUpDown` icons from Lucide.
- **Completed issues table:** Columns: Type icon, Key, Title, Points, Status. Issues added mid-sprint get a badge "Added mid-sprint" using `text-warning`.
- **Incomplete issues table:** Columns: Type icon, Key, Title, Points, Current Status, Destination (backlog or next sprint name).
- **Scope changes section:** Chronological list with timestamp, action (Added/Removed badge), issue key + title. Use `Plus` and `Minus` icons from Lucide.
- All colors via CSS variable tokens. No hardcoded colors.
- Use `useQuery({ queryKey: ['sprint-report', projectId, sprintId] })`

### Step 3: Add navigation to the report

- [ ] Add a "Sprint Report" link/button to the sprint dropdown or `SprintCard.tsx` component. Use `BarChart3` icon from Lucide. Only show for ACTIVE or COMPLETED sprints.

- [ ] Commit:

```bash
git add frontend/src/api/sprint-report.api.ts frontend/src/pages/issues/SprintReport.tsx frontend/src/pages/issues/SprintCard.tsx
git commit -m "feat(sprints): add sprint report UI with summary, issue tables, and scope changes"
```

---

## Task 5: Documentation

**Files:**
- Modify: `docs/api-reference.md`

### Step 1: Update API reference

- [ ] Add to `docs/api-reference.md` under Sprints:

```markdown
### Sprint Report
- `GET /api/projects/:projectId/sprints/:sprintId/report` — Sprint report with committed vs completed issues and scope changes

**Response includes:**
- `summary` — committed/completed/incomplete counts and story points, mid-sprint adds/removes
- `completedIssues` — issues in done columns, flagged if added mid-sprint
- `incompleteIssues` — issues not done, with destination (backlog or next sprint)
- `scopeChanges` — chronological log of issues added/removed after sprint start
```

- [ ] Commit:

```bash
git add docs/api-reference.md
git commit -m "docs: add sprint report API documentation"
```
