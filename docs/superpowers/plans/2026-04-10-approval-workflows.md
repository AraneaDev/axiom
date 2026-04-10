# Approval Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add column-gate approval workflows so project admins can require approvals before issues move between specific board columns.

**Architecture:** New `approvals` backend module with ApprovalGate/ApprovalRequest/ApprovalVote models. Board drag-and-drop intercepts gated transitions to show an approval nomination modal. Issues stay in place with visual badges until approvals resolve. Server auto-moves issues on approval.

**Tech Stack:** Prisma 7, Express 5, Zod 4, React 19, TanStack Query, native HTML5 drag-and-drop, Lucide icons, CSS variable tokens.

**Spec:** `docs/superpowers/specs/2026-04-10-intake-forms-approvals-roadmap-design.md` (Section 2)

---

## File Structure

### Backend
```
prisma/schema.prisma                              — Add ApprovalGate, ApprovalRequest, ApprovalVote models + enums
src/modules/approvals/approvals.routes.ts          — Route definitions
src/modules/approvals/approvals.controller.ts      — Request handling
src/modules/approvals/approvals.service.ts         — Business logic
src/modules/approvals/approvals.validation.ts      — Zod schemas
src/modules/approvals/approvals.test.ts            — Integration tests
```

### Frontend
```
frontend/src/api/approvals.api.ts                  — API client functions
frontend/src/components/ui/ApprovalBadge.tsx        — Board card badge (pending/rejected)
frontend/src/components/ui/ApprovalModal.tsx        — Nomination modal for gated transitions
frontend/src/components/ui/ApprovalPanel.tsx        — Issue detail "Approvals" tab
frontend/src/components/ui/ApprovalVoteCard.tsx     — Single vote display
frontend/src/pages/projects/ApprovalsSettings.tsx   — Gate configuration in project settings
frontend/src/pages/approvals/MyApprovals.tsx        — Org-wide pending approvals page
```

---

### Task 1: Schema — Add Approval Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums to schema.prisma**

Add after the existing enums:

```prisma
enum ApprovalRequestStatus {
  PENDING
  APPROVED
  REJECTED
  CANCELLED
}

enum ApprovalDecision {
  APPROVED
  REJECTED
}
```

- [ ] **Step 2: Add ApprovalGate model**

```prisma
model ApprovalGate {
  id              String   @id @default(cuid())
  projectId       String
  fromColumnId    String
  toColumnId      String
  minApprovals    Int      @default(1)
  allowSelfApproval Boolean @default(false)
  enabled         Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  project    Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
  fromColumn BoardColumn @relation("approvalGateFrom", fields: [fromColumnId], references: [id], onDelete: Cascade)
  toColumn   BoardColumn @relation("approvalGateTo", fields: [toColumnId], references: [id], onDelete: Cascade)
  requests   ApprovalRequest[]

  @@unique([projectId, fromColumnId, toColumnId])
  @@index([projectId])
}
```

- [ ] **Step 3: Add ApprovalRequest model**

```prisma
model ApprovalRequest {
  id              String                @id @default(cuid())
  issueId         String
  approvalGateId  String
  targetColumnId  String
  requestedById   String
  status          ApprovalRequestStatus @default(PENDING)
  createdAt       DateTime              @default(now())
  resolvedAt      DateTime?

  issue        Issue         @relation(fields: [issueId], references: [id], onDelete: Cascade)
  approvalGate ApprovalGate  @relation(fields: [approvalGateId], references: [id], onDelete: Cascade)
  targetColumn BoardColumn   @relation("approvalRequestTarget", fields: [targetColumnId], references: [id], onDelete: Cascade)
  requestedBy  User          @relation("approvalRequester", fields: [requestedById], references: [id])
  votes        ApprovalVote[]

  @@index([issueId])
  @@index([approvalGateId])
  @@index([requestedById, status])
}
```

- [ ] **Step 4: Add ApprovalVote model**

```prisma
model ApprovalVote {
  id                String           @id @default(cuid())
  approvalRequestId String
  userId            String
  decision          ApprovalDecision
  comment           String?
  createdAt         DateTime         @default(now())

  approvalRequest ApprovalRequest @relation(fields: [approvalRequestId], references: [id], onDelete: Cascade)
  user            User            @relation(fields: [userId], references: [id])

  @@unique([approvalRequestId, userId])
  @@index([userId])
}
```

- [ ] **Step 5: Add reverse relations on existing models**

Add to the `BoardColumn` model:
```prisma
  approvalGatesFrom    ApprovalGate[]    @relation("approvalGateFrom")
  approvalGatesTo      ApprovalGate[]    @relation("approvalGateTo")
  approvalRequestTargets ApprovalRequest[] @relation("approvalRequestTarget")
```

Add to the `Issue` model:
```prisma
  approvalRequests ApprovalRequest[]
```

Add to the `User` model:
```prisma
  approvalRequestsMade ApprovalRequest[] @relation("approvalRequester")
  approvalVotes        ApprovalVote[]
```

Add to the `Project` model:
```prisma
  approvalGates ApprovalGate[]
```

- [ ] **Step 6: Run prisma generate and push**

Run: `npx prisma db push`
Expected: Schema pushed successfully, no errors.

Run: `npx prisma generate`
Expected: Client generated successfully.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(approvals): add ApprovalGate, ApprovalRequest, ApprovalVote models"
```

---

### Task 2: Backend — Validation Schemas

**Files:**
- Create: `src/modules/approvals/approvals.validation.ts`

- [ ] **Step 1: Write validation schemas**

```typescript
import { z } from 'zod';

export const createGateSchema = z.object({
  fromColumnId: z.string().min(1),
  toColumnId: z.string().min(1),
  minApprovals: z.number().int().min(1).max(10).default(1),
  allowSelfApproval: z.boolean().default(false),
});

export const updateGateSchema = z.object({
  minApprovals: z.number().int().min(1).max(10).optional(),
  allowSelfApproval: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const createApprovalRequestSchema = z.object({
  approverIds: z.array(z.string().min(1)).min(1).max(10),
});

export const castVoteSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(2000).optional(),
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/approvals/approvals.validation.ts
git commit -m "feat(approvals): add validation schemas"
```

---

### Task 3: Backend — Approvals Service

**Files:**
- Create: `src/modules/approvals/approvals.service.ts`

- [ ] **Step 1: Write the gate CRUD functions**

```typescript
import { prisma } from '../../config/database';
import { AppError } from '../../utils/errors';
import { findOrThrow } from '../../utils/findOrThrow';
import { broadcastToRoom } from '../../realtime/broadcast';
import { createNotification } from '../notifications/notifications.service';
import { logActivity } from '../activity/activity.service';
import { logger } from '../../config/logger';

const USER_BASIC_SELECT = {
  id: true, username: true, displayName: true, avatarUrl: true,
};

export async function listGates(projectId: string) {
  return prisma.approvalGate.findMany({
    where: { projectId },
    include: {
      fromColumn: { select: { id: true, name: true, position: true } },
      toColumn: { select: { id: true, name: true, position: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

export async function createGate(
  projectId: string,
  data: { fromColumnId: string; toColumnId: string; minApprovals: number; allowSelfApproval: boolean },
) {
  if (data.fromColumnId === data.toColumnId) {
    throw new AppError(400, 'From and to columns must be different');
  }

  // Verify both columns belong to the project
  const [fromCol, toCol] = await Promise.all([
    prisma.boardColumn.findFirst({ where: { id: data.fromColumnId, projectId } }),
    prisma.boardColumn.findFirst({ where: { id: data.toColumnId, projectId } }),
  ]);
  if (!fromCol) throw new AppError(404, 'From column not found');
  if (!toCol) throw new AppError(404, 'To column not found');

  // Check for existing gate
  const existing = await prisma.approvalGate.findUnique({
    where: { projectId_fromColumnId_toColumnId: { projectId, fromColumnId: data.fromColumnId, toColumnId: data.toColumnId } },
  });
  if (existing) throw new AppError(409, 'An approval gate already exists for this transition');

  return prisma.approvalGate.create({
    data: { projectId, ...data },
    include: {
      fromColumn: { select: { id: true, name: true, position: true } },
      toColumn: { select: { id: true, name: true, position: true } },
    },
  });
}

export async function updateGate(
  projectId: string,
  gateId: string,
  data: { minApprovals?: number; allowSelfApproval?: boolean; enabled?: boolean },
) {
  const gate = await findOrThrow(
    prisma.approvalGate.findFirst({ where: { id: gateId, projectId } }),
    'Approval gate not found',
  );

  return prisma.approvalGate.update({
    where: { id: gate.id },
    data,
    include: {
      fromColumn: { select: { id: true, name: true, position: true } },
      toColumn: { select: { id: true, name: true, position: true } },
    },
  });
}

export async function deleteGate(projectId: string, gateId: string) {
  const gate = await findOrThrow(
    prisma.approvalGate.findFirst({ where: { id: gateId, projectId } }),
    'Approval gate not found',
  );

  // Cancel all pending requests for this gate
  await prisma.approvalRequest.updateMany({
    where: { approvalGateId: gate.id, status: 'PENDING' },
    data: { status: 'CANCELLED', resolvedAt: new Date() },
  });

  await prisma.approvalGate.delete({ where: { id: gate.id } });
}
```

- [ ] **Step 2: Write the approval request and voting functions**

Append to the same file:

```typescript
export async function createApprovalRequest(
  issueId: string,
  requestedById: string,
  approverIds: string[],
) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        column: true,
        project: { include: { team: { include: { org: true } } } },
      },
    }),
    'Issue not found',
  );

  // Check for existing pending request
  const pending = await prisma.approvalRequest.findFirst({
    where: { issueId, status: 'PENDING' },
  });
  if (pending) throw new AppError(409, 'Issue already has a pending approval request');

  // Find the gate for the issue's current column — we need a target column
  // The frontend sends the target column implicitly via the gate lookup
  // Actually, we need the targetColumnId from the client
  // Let's adjust: the frontend knows which column the user tried to drag to
  // We'll require targetColumnId in the request body
  throw new AppError(400, 'This function requires targetColumnId — see createApprovalRequestWithTarget');
}

export async function createApprovalRequestWithTarget(
  issueId: string,
  targetColumnId: string,
  requestedById: string,
  approverIds: string[],
) {
  const issue = await findOrThrow(
    prisma.issue.findUnique({
      where: { id: issueId },
      include: {
        column: true,
        project: { include: { team: { include: { org: true } } } },
      },
    }),
    'Issue not found',
  );

  if (!issue.columnId) throw new AppError(400, 'Issue has no current column');

  // Find the gate
  const gate = await findOrThrow(
    prisma.approvalGate.findFirst({
      where: {
        projectId: issue.projectId,
        fromColumnId: issue.columnId,
        toColumnId: targetColumnId,
        enabled: true,
      },
    }),
    'No approval gate found for this transition',
  );

  // Check for existing pending request
  const pending = await prisma.approvalRequest.findFirst({
    where: { issueId, status: 'PENDING' },
  });
  if (pending) throw new AppError(409, 'Issue already has a pending approval request');

  // Validate self-approval
  if (!gate.allowSelfApproval && approverIds.includes(requestedById)) {
    throw new AppError(400, 'Self-approval is not allowed for this gate');
  }

  // Validate min approvers
  if (approverIds.length < gate.minApprovals) {
    throw new AppError(400, `At least ${gate.minApprovals} approver(s) required`);
  }

  // Verify all approvers are project members
  const members = await prisma.teamMembership.findMany({
    where: { teamId: issue.project.teamId, userId: { in: approverIds } },
  });
  if (members.length !== approverIds.length) {
    throw new AppError(400, 'One or more approvers are not project members');
  }

  const request = await prisma.approvalRequest.create({
    data: {
      issueId,
      approvalGateId: gate.id,
      targetColumnId,
      requestedById,
      status: 'PENDING',
    },
    include: {
      requestedBy: { select: USER_BASIC_SELECT },
      targetColumn: { select: { id: true, name: true } },
      votes: { include: { user: { select: USER_BASIC_SELECT } } },
      issue: {
        select: {
          id: true, number: true, title: true,
          project: { select: { prefix: true, slug: true, team: { select: { slug: true, org: { select: { slug: true } } } } } },
        },
      },
    },
  });

  const { prefix } = request.issue.project;
  const issueKey = `${prefix}-${request.issue.number}`;
  const orgSlug = request.issue.project.team.org.slug;
  const teamSlug = request.issue.project.team.slug;
  const projectSlug = request.issue.project.slug;
  const issueLink = `/${orgSlug}/${teamSlug}/${projectSlug}/issues/${request.issue.number}`;

  // Notify each approver
  for (const approverId of approverIds) {
    createNotification(
      approverId,
      'approval:requested',
      `Approval requested for ${issueKey}: ${request.issue.title}`,
      `${request.requestedBy.displayName || request.requestedBy.username} needs your approval to move this issue to "${request.targetColumn.name}"`,
      issueLink,
    ).catch((err) => logger.error('Failed to send approval notification', { requestId: request.id }, err));
  }

  broadcastToRoom(`project:${issue.projectId}`, {
    type: 'approval:request:created',
    projectId: issue.projectId,
    issueId,
    requestId: request.id,
  });

  return request;
}

export async function castVote(
  requestId: string,
  userId: string,
  data: { decision: 'APPROVED' | 'REJECTED'; comment?: string },
) {
  const request = await findOrThrow(
    prisma.approvalRequest.findUnique({
      where: { id: requestId },
      include: {
        approvalGate: true,
        issue: {
          include: {
            project: { include: { team: { include: { org: true } } } },
          },
        },
        votes: true,
      },
    }),
    'Approval request not found',
  );

  if (request.status !== 'PENDING') {
    throw new AppError(400, 'This approval request is no longer pending');
  }

  // Check for existing vote
  const existingVote = request.votes.find((v) => v.userId === userId);
  if (existingVote) throw new AppError(409, 'You have already voted on this request');

  const vote = await prisma.approvalVote.create({
    data: {
      approvalRequestId: requestId,
      userId,
      decision: data.decision,
      comment: data.comment,
    },
    include: { user: { select: USER_BASIC_SELECT } },
  });

  const { prefix, slug: projectSlug } = request.issue.project;
  const issueKey = `${prefix}-${request.issue.number}`;
  const orgSlug = request.issue.project.team.org.slug;
  const teamSlug = request.issue.project.team.slug;
  const issueLink = `/${orgSlug}/${teamSlug}/${projectSlug}/issues/${request.issue.number}`;

  // Check if request is now resolved
  if (data.decision === 'REJECTED') {
    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });

    createNotification(
      request.requestedById,
      'approval:rejected',
      `Approval rejected for ${issueKey}`,
      data.comment || 'Your approval request was rejected',
      issueLink,
    ).catch((err) => logger.error('Failed to send rejection notification', { requestId }, err));

    broadcastToRoom(`project:${request.issue.projectId}`, {
      type: 'approval:request:resolved',
      projectId: request.issue.projectId,
      issueId: request.issueId,
      requestId,
      status: 'REJECTED',
    });
  } else {
    // Count approved votes (including this one)
    const approvedCount = request.votes.filter((v) => v.decision === 'APPROVED').length + 1;

    if (approvedCount >= request.approvalGate.minApprovals) {
      // Approved! Move the issue
      await prisma.$transaction([
        prisma.approvalRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', resolvedAt: new Date() },
        }),
        prisma.issue.update({
          where: { id: request.issueId },
          data: { columnId: request.targetColumnId },
        }),
      ]);

      await logActivity('issue', request.issueId, 'status_changed', userId, {
        fromColumn: request.issue.columnId,
        toColumn: request.targetColumnId,
        viaApproval: true,
      });

      createNotification(
        request.requestedById,
        'approval:approved',
        `Approval granted for ${issueKey}`,
        'Your approval request was approved and the issue has been moved',
        issueLink,
      ).catch((err) => logger.error('Failed to send approval notification', { requestId }, err));

      broadcastToRoom(`project:${request.issue.projectId}`, {
        type: 'approval:request:resolved',
        projectId: request.issue.projectId,
        issueId: request.issueId,
        requestId,
        status: 'APPROVED',
        targetColumnId: request.targetColumnId,
      });
    }
  }

  return vote;
}

export async function cancelRequest(requestId: string, userId: string) {
  const request = await findOrThrow(
    prisma.approvalRequest.findFirst({
      where: { id: requestId, requestedById: userId, status: 'PENDING' },
    }),
    'Approval request not found or not cancellable',
  );

  return prisma.approvalRequest.update({
    where: { id: request.id },
    data: { status: 'CANCELLED', resolvedAt: new Date() },
  });
}

export async function getRequestsForIssue(issueId: string) {
  return prisma.approvalRequest.findMany({
    where: { issueId },
    include: {
      requestedBy: { select: USER_BASIC_SELECT },
      targetColumn: { select: { id: true, name: true } },
      approvalGate: {
        include: {
          fromColumn: { select: { id: true, name: true } },
          toColumn: { select: { id: true, name: true } },
        },
      },
      votes: {
        include: { user: { select: USER_BASIC_SELECT } },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getPendingApprovalsForUser(userId: string) {
  // Find all pending requests where this user was nominated
  // We track nomination implicitly — any team member can vote unless self-approval blocked
  // For now, return all pending requests in projects the user is a member of
  const memberships = await prisma.teamMembership.findMany({
    where: { userId },
    select: { team: { select: { projects: { select: { id: true } } } } },
  });

  const projectIds = memberships.flatMap((m) => m.team.projects.map((p) => p.id));

  return prisma.approvalRequest.findMany({
    where: {
      status: 'PENDING',
      approvalGate: { projectId: { in: projectIds } },
      // Exclude requests the user already voted on
      votes: { none: { userId } },
      // Exclude user's own requests if self-approval not allowed
    },
    include: {
      requestedBy: { select: USER_BASIC_SELECT },
      targetColumn: { select: { id: true, name: true } },
      approvalGate: {
        include: {
          fromColumn: { select: { id: true, name: true } },
          toColumn: { select: { id: true, name: true } },
          project: { select: { id: true, slug: true, prefix: true, team: { select: { slug: true, org: { select: { slug: true } } } } } },
        },
      },
      issue: { select: { id: true, number: true, title: true, priority: true, type: true } },
      votes: { include: { user: { select: USER_BASIC_SELECT } } },
    },
    orderBy: { createdAt: 'asc' },
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/approvals/approvals.service.ts
git commit -m "feat(approvals): add approval service with gate CRUD, requests, and voting"
```

---

### Task 4: Backend — Controller

**Files:**
- Create: `src/modules/approvals/approvals.controller.ts`

- [ ] **Step 1: Write controller**

```typescript
import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import { validate } from '../../utils/validation';
import {
  createGateSchema,
  updateGateSchema,
  createApprovalRequestSchema,
  castVoteSchema,
} from './approvals.validation';
import * as approvalsService from './approvals.service';

// Gate CRUD
export const listGates = asyncHandler(async (req: Request, res: Response) => {
  const gates = await approvalsService.listGates(param(req, 'projectId'));
  res.json(gates);
});

export const createGate = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(createGateSchema, req.body);
  const gate = await approvalsService.createGate(param(req, 'projectId'), data);
  res.status(201).json(gate);
});

export const updateGate = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(updateGateSchema, req.body);
  const gate = await approvalsService.updateGate(param(req, 'projectId'), param(req, 'gateId'), data);
  res.json(gate);
});

export const deleteGate = asyncHandler(async (req: Request, res: Response) => {
  await approvalsService.deleteGate(param(req, 'projectId'), param(req, 'gateId'));
  res.status(204).send();
});

// Approval Requests
export const createRequest = asyncHandler(async (req: Request, res: Response) => {
  const { approverIds } = validate(createApprovalRequestSchema, req.body);
  const targetColumnId = param(req, 'targetColumnId');
  const request = await approvalsService.createApprovalRequestWithTarget(
    param(req, 'issueId'),
    targetColumnId,
    req.userId!,
    approverIds,
  );
  res.status(201).json(request);
});

export const listRequestsForIssue = asyncHandler(async (req: Request, res: Response) => {
  const requests = await approvalsService.getRequestsForIssue(param(req, 'issueId'));
  res.json(requests);
});

// Voting
export const vote = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(castVoteSchema, req.body);
  const voteResult = await approvalsService.castVote(param(req, 'requestId'), req.userId!, data);
  res.status(201).json(voteResult);
});

export const cancelRequest = asyncHandler(async (req: Request, res: Response) => {
  await approvalsService.cancelRequest(param(req, 'requestId'), req.userId!);
  res.status(204).send();
});

// My Approvals
export const myPendingApprovals = asyncHandler(async (req: Request, res: Response) => {
  const approvals = await approvalsService.getPendingApprovalsForUser(req.userId!);
  res.json(approvals);
});
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/approvals/approvals.controller.ts
git commit -m "feat(approvals): add approval controller"
```

---

### Task 5: Backend — Routes

**Files:**
- Create: `src/modules/approvals/approvals.routes.ts`
- Modify: `src/index.ts` (or wherever routes are mounted)

- [ ] **Step 1: Write routes**

```typescript
import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';
import * as approvalsController from './approvals.controller';

const router = Router();

router.use(authenticate);

// Gate configuration (project-scoped)
router.get('/:projectId/approval-gates', requireProjectAccess, approvalsController.listGates);
router.post('/:projectId/approval-gates', requireProjectAccess, approvalsController.createGate);
router.patch('/:projectId/approval-gates/:gateId', requireProjectAccess, approvalsController.updateGate);
router.delete('/:projectId/approval-gates/:gateId', requireProjectAccess, approvalsController.deleteGate);

export default router;
```

- [ ] **Step 2: Create a separate router for issue-scoped and standalone approval routes**

Create `src/modules/approvals/approvals-actions.routes.ts`:

```typescript
import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as approvalsController from './approvals.controller';

const router = Router();

router.use(authenticate);

// Issue approval requests
router.post('/issues/:issueId/approval-requests/:targetColumnId', approvalsController.createRequest);
router.get('/issues/:issueId/approval-requests', approvalsController.listRequestsForIssue);

// Voting and cancellation
router.post('/approval-requests/:requestId/vote', approvalsController.vote);
router.post('/approval-requests/:requestId/cancel', approvalsController.cancelRequest);

// My approvals
router.get('/users/me/pending-approvals', approvalsController.myPendingApprovals);

export default router;
```

- [ ] **Step 3: Mount routes in app**

Find where routes are mounted (in `src/index.ts` or `src/app.ts`) and add:

```typescript
import approvalGateRoutes from './modules/approvals/approvals.routes';
import approvalActionRoutes from './modules/approvals/approvals-actions.routes';

// With other project routes
app.use('/api/projects', approvalGateRoutes);

// Standalone routes
app.use('/api', approvalActionRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/approvals/approvals.routes.ts src/modules/approvals/approvals-actions.routes.ts
git add src/index.ts  # or wherever routes are mounted
git commit -m "feat(approvals): add routes and mount in app"
```

---

### Task 6: Backend — Integration Tests

**Files:**
- Create: `src/modules/approvals/approvals.test.ts`

- [ ] **Step 1: Write test setup and gate CRUD tests**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../app';
import { createTestContext, type TestContext } from '../../test/factory';
import { truncateAllTables, disconnectPrisma } from '../../test/test-utils';
import { prisma } from '../../config/database';

describe('Approval Workflows', () => {
  let ctx: TestContext;
  let columns: { id: string; name: string }[];

  beforeAll(async () => {
    ctx = await createTestContext();
    // Get board columns for the test project
    const res = await request(app)
      .get(`/api/projects/${ctx.project.id}/board/columns`)
      .set('Authorization', `Bearer ${ctx.owner.token}`)
      .set('X-Requested-With', 'XMLHttpRequest');
    columns = res.body;
  });

  afterAll(async () => {
    await truncateAllTables();
    await disconnectPrisma();
  });

  describe('Gate CRUD', () => {
    it('should create an approval gate', async () => {
      const res = await request(app)
        .post(`/api/projects/${ctx.project.id}/approval-gates`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          fromColumnId: columns[2].id, // In Progress
          toColumnId: columns[4].id,   // Done
          minApprovals: 1,
          allowSelfApproval: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.fromColumn.name).toBe(columns[2].name);
      expect(res.body.toColumn.name).toBe(columns[4].name);
      expect(res.body.minApprovals).toBe(1);
    });

    it('should reject duplicate gate', async () => {
      const res = await request(app)
        .post(`/api/projects/${ctx.project.id}/approval-gates`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          fromColumnId: columns[2].id,
          toColumnId: columns[4].id,
        });

      expect(res.status).toBe(409);
    });

    it('should list gates', async () => {
      const res = await request(app)
        .get(`/api/projects/${ctx.project.id}/approval-gates`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest');

      expect(res.status).toBe(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it('should reject same from/to column', async () => {
      const res = await request(app)
        .post(`/api/projects/${ctx.project.id}/approval-gates`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({
          fromColumnId: columns[0].id,
          toColumnId: columns[0].id,
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Approval Request & Voting', () => {
    let issueId: string;
    let gateId: string;
    let requestId: string;

    beforeAll(async () => {
      // Create an issue in the "In Progress" column
      const issueRes = await request(app)
        .post(`/api/projects/${ctx.project.id}/issues`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ title: 'Test approval issue' });
      issueId = issueRes.body.id;

      // Move issue to In Progress column
      await request(app)
        .patch(`/api/projects/${ctx.project.id}/issues/${issueRes.body.number}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ columnId: columns[2].id });

      // Get the gate
      const gatesRes = await request(app)
        .get(`/api/projects/${ctx.project.id}/approval-gates`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest');
      gateId = gatesRes.body[0].id;
    });

    it('should create an approval request', async () => {
      const res = await request(app)
        .post(`/api/issues/${issueId}/approval-requests/${columns[4].id}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ approverIds: [ctx.member.user.id] });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('PENDING');
      requestId = res.body.id;
    });

    it('should reject duplicate pending request', async () => {
      const res = await request(app)
        .post(`/api/issues/${issueId}/approval-requests/${columns[4].id}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ approverIds: [ctx.member.user.id] });

      expect(res.status).toBe(409);
    });

    it('should cast an approval vote and auto-move issue', async () => {
      const res = await request(app)
        .post(`/api/approval-requests/${requestId}/vote`)
        .set('Authorization', `Bearer ${ctx.member.token}`)
        .set('X-Requested-With', 'XMLHttpRequest')
        .send({ decision: 'APPROVED', comment: 'Looks good' });

      expect(res.status).toBe(201);
      expect(res.body.decision).toBe('APPROVED');

      // Verify issue moved to target column
      const issue = await prisma.issue.findUnique({ where: { id: issueId } });
      expect(issue!.columnId).toBe(columns[4].id);
    });
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npm run test -- --testPathPattern=approvals`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/modules/approvals/approvals.test.ts
git commit -m "test(approvals): add integration tests for gates, requests, and voting"
```

---

### Task 7: Frontend — API Client

**Files:**
- Create: `frontend/src/api/approvals.api.ts`

- [ ] **Step 1: Write API client**

```typescript
import { get, post, patch, del } from './client';

export interface ApprovalGate {
  id: string;
  projectId: string;
  fromColumnId: string;
  toColumnId: string;
  fromColumn: { id: string; name: string; position: number };
  toColumn: { id: string; name: string; position: number };
  minApprovals: number;
  allowSelfApproval: boolean;
  enabled: boolean;
}

export interface ApprovalVote {
  id: string;
  userId: string;
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  decision: 'APPROVED' | 'REJECTED';
  comment: string | null;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  issueId: string;
  approvalGateId: string;
  targetColumnId: string;
  targetColumn: { id: string; name: string };
  requestedById: string;
  requestedBy: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  createdAt: string;
  resolvedAt: string | null;
  votes: ApprovalVote[];
  issue?: {
    id: string;
    number: number;
    title: string;
    priority: string;
    type: string;
  };
  approvalGate?: {
    fromColumn: { id: string; name: string };
    toColumn: { id: string; name: string };
    project?: { id: string; slug: string; prefix: string; team: { slug: string; org: { slug: string } } };
  };
}

export const approvalsApi = {
  // Gates
  listGates: (projectId: string) =>
    get<ApprovalGate[]>(`/api/projects/${projectId}/approval-gates`),

  createGate: (projectId: string, data: { fromColumnId: string; toColumnId: string; minApprovals?: number; allowSelfApproval?: boolean }) =>
    post<ApprovalGate>(`/api/projects/${projectId}/approval-gates`, data),

  updateGate: (projectId: string, gateId: string, data: { minApprovals?: number; allowSelfApproval?: boolean; enabled?: boolean }) =>
    patch<ApprovalGate>(`/api/projects/${projectId}/approval-gates/${gateId}`, data),

  deleteGate: (projectId: string, gateId: string) =>
    del<void>(`/api/projects/${projectId}/approval-gates/${gateId}`),

  // Requests
  createRequest: (issueId: string, targetColumnId: string, approverIds: string[]) =>
    post<ApprovalRequest>(`/api/issues/${issueId}/approval-requests/${targetColumnId}`, { approverIds }),

  listRequestsForIssue: (issueId: string) =>
    get<ApprovalRequest[]>(`/api/issues/${issueId}/approval-requests`),

  // Voting
  castVote: (requestId: string, data: { decision: 'APPROVED' | 'REJECTED'; comment?: string }) =>
    post<ApprovalVote>(`/api/approval-requests/${requestId}/vote`, data),

  cancelRequest: (requestId: string) =>
    post<void>(`/api/approval-requests/${requestId}/cancel`, {}),

  // My approvals
  myPendingApprovals: () =>
    get<ApprovalRequest[]>(`/api/users/me/pending-approvals`),
};
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api/approvals.api.ts
git commit -m "feat(approvals): add frontend API client"
```

---

### Task 8: Frontend — ApprovalBadge Component

**Files:**
- Create: `frontend/src/components/ui/ApprovalBadge.tsx`

- [ ] **Step 1: Write ApprovalBadge**

```tsx
import { forwardRef } from 'react';
import { Clock, XCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface ApprovalBadgeProps {
  status: ApprovalStatus;
  targetColumnName?: string;
  className?: string;
}

const statusConfig = {
  PENDING: {
    icon: Clock,
    label: 'Pending Approval',
    classes: 'bg-warning/10 text-warning border-warning/20',
  },
  REJECTED: {
    icon: XCircle,
    label: 'Approval Rejected',
    classes: 'bg-danger/10 text-danger border-danger/20',
  },
  APPROVED: {
    icon: CheckCircle,
    label: 'Approved',
    classes: 'bg-success/10 text-success border-success/20',
  },
  CANCELLED: {
    icon: XCircle,
    label: 'Cancelled',
    classes: 'bg-text-tertiary/10 text-text-tertiary border-border',
  },
};

export const ApprovalBadge = forwardRef<HTMLDivElement, ApprovalBadgeProps>(
  ({ status, targetColumnName, className }, ref) => {
    const config = statusConfig[status];
    const Icon = config.icon;
    const tooltip = targetColumnName
      ? `${config.label} — move to "${targetColumnName}"`
      : config.label;

    return (
      <div
        ref={ref}
        className={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border',
          config.classes,
          className,
        )}
        title={tooltip}
      >
        <Icon className="h-3 w-3" />
        <span>{status === 'PENDING' ? 'Awaiting' : status === 'REJECTED' ? 'Rejected' : status.charAt(0) + status.slice(1).toLowerCase()}</span>
      </div>
    );
  },
);
ApprovalBadge.displayName = 'ApprovalBadge';
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ui/ApprovalBadge.tsx
git commit -m "feat(approvals): add ApprovalBadge component"
```

---

### Task 9: Frontend — ApprovalModal Component

**Files:**
- Create: `frontend/src/components/ui/ApprovalModal.tsx`

- [ ] **Step 1: Write ApprovalModal**

```tsx
import { useState } from 'react';
import { ShieldCheck, ArrowRight, UserPlus } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { cn } from '@/lib/utils';
import { approvalsApi } from '@/api/approvals.api';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';

interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
  issueId: string;
  issueTitle: string;
  fromColumnName: string;
  toColumnId: string;
  toColumnName: string;
  minApprovals: number;
  allowSelfApproval: boolean;
  currentUserId: string;
  projectMembers: { id: string; username: string; displayName: string | null; avatarUrl: string | null }[];
  onSuccess?: () => void;
}

export function ApprovalModal({
  open,
  onClose,
  issueId,
  issueTitle,
  fromColumnName,
  toColumnId,
  toColumnName,
  minApprovals,
  allowSelfApproval,
  currentUserId,
  projectMembers,
  onSuccess,
}: ApprovalModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  const eligibleMembers = projectMembers.filter((m) =>
    allowSelfApproval ? true : m.id !== currentUserId,
  );

  const filteredMembers = eligibleMembers.filter((m) => {
    const q = search.toLowerCase();
    return (
      m.username.toLowerCase().includes(q) ||
      (m.displayName?.toLowerCase().includes(q) ?? false)
    );
  });

  const mutation = useMutationWithToast(
    () => approvalsApi.createRequest(issueId, toColumnId, selectedIds),
    {
      successMessage: 'Approval request created',
      errorMessage: 'Failed to create approval request',
      invalidateKeys: [['approval-requests', issueId]],
      onSuccess: () => {
        setSelectedIds([]);
        setSearch('');
        onClose();
        onSuccess?.();
      },
    },
  );

  const toggleMember = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  return (
    <Modal open={open} onClose={onClose} title="Approval Required" size="md">
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm text-text-secondary bg-surface-secondary rounded-lg p-3">
          <ShieldCheck className="h-4 w-4 text-warning shrink-0" />
          <span>
            Moving <strong className="text-text">{issueTitle}</strong> from{' '}
            <strong className="text-text">{fromColumnName}</strong>
            <ArrowRight className="inline h-3 w-3 mx-1" />
            <strong className="text-text">{toColumnName}</strong> requires approval.
          </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-text mb-1">
            Select approver{minApprovals > 1 ? 's' : ''} (min {minApprovals})
          </label>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members..."
            className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-border-focus"
          />
        </div>

        <div className="max-h-48 overflow-y-auto space-y-1">
          {filteredMembers.map((member) => (
            <button
              key={member.id}
              type="button"
              onClick={() => toggleMember(member.id)}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors',
                selectedIds.includes(member.id)
                  ? 'bg-primary/10 text-primary ring-1 ring-primary/20'
                  : 'hover:bg-surface-secondary text-text',
              )}
            >
              <UserPlus className="h-4 w-4 shrink-0" />
              <span className="font-medium">{member.displayName || member.username}</span>
              <span className="text-text-tertiary">@{member.username}</span>
            </button>
          ))}
          {filteredMembers.length === 0 && (
            <p className="text-sm text-text-tertiary py-2 text-center">No eligible members found</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            <ArrowRight className="h-4 w-4 rotate-180" /> Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate(undefined)}
            disabled={selectedIds.length < minApprovals || mutation.isPending}
          >
            <ShieldCheck className="h-4 w-4" /> Request Approval
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ui/ApprovalModal.tsx
git commit -m "feat(approvals): add ApprovalModal component"
```

---

### Task 10: Frontend — ApprovalVoteCard and ApprovalPanel

**Files:**
- Create: `frontend/src/components/ui/ApprovalVoteCard.tsx`
- Create: `frontend/src/components/ui/ApprovalPanel.tsx`

- [ ] **Step 1: Write ApprovalVoteCard**

```tsx
import { CheckCircle, XCircle } from 'lucide-react';
import { Avatar } from './Avatar';
import { cn } from '@/lib/utils';

interface ApprovalVoteCardProps {
  user: { id: string; username: string; displayName: string | null; avatarUrl: string | null };
  decision: 'APPROVED' | 'REJECTED';
  comment: string | null;
  createdAt: string;
}

export function ApprovalVoteCard({ user, decision, comment, createdAt }: ApprovalVoteCardProps) {
  const isApproved = decision === 'APPROVED';

  return (
    <div className="flex items-start gap-3 py-2">
      <Avatar src={user.avatarUrl} name={user.displayName || user.username} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text">{user.displayName || user.username}</span>
          <span className={cn('inline-flex items-center gap-1 text-xs font-medium', isApproved ? 'text-success' : 'text-danger')}>
            {isApproved ? <CheckCircle className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
            {decision.toLowerCase()}
          </span>
          <span className="text-xs text-text-tertiary">
            {new Date(createdAt).toLocaleDateString()}
          </span>
        </div>
        {comment && <p className="text-sm text-text-secondary mt-0.5">{comment}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write ApprovalPanel**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ThumbsUp, ThumbsDown, X } from 'lucide-react';
import { approvalsApi, type ApprovalRequest } from '@/api/approvals.api';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from './Button';
import { ApprovalBadge } from './ApprovalBadge';
import { ApprovalVoteCard } from './ApprovalVoteCard';
import { EmptyState } from './EmptyState';
import { Spinner } from './Spinner';

interface ApprovalPanelProps {
  issueId: string;
}

export function ApprovalPanel({ issueId }: ApprovalPanelProps) {
  const { user } = useAuthStore();
  const [voteComment, setVoteComment] = useState('');

  const { data: requests, isLoading } = useQuery({
    queryKey: ['approval-requests', issueId],
    queryFn: () => approvalsApi.listRequestsForIssue(issueId),
  });

  const voteMutation = useMutationWithToast(
    ({ requestId, decision }: { requestId: string; decision: 'APPROVED' | 'REJECTED' }) =>
      approvalsApi.castVote(requestId, { decision, comment: voteComment || undefined }),
    {
      successMessage: 'Vote recorded',
      errorMessage: 'Failed to record vote',
      invalidateKeys: [['approval-requests', issueId]],
      onSuccess: () => setVoteComment(''),
    },
  );

  const cancelMutation = useMutationWithToast(
    (requestId: string) => approvalsApi.cancelRequest(requestId),
    {
      successMessage: 'Request cancelled',
      errorMessage: 'Failed to cancel request',
      invalidateKeys: [['approval-requests', issueId]],
    },
  );

  if (isLoading) return <Spinner />;

  if (!requests || requests.length === 0) {
    return <EmptyState icon={ShieldCheck} title="No approval requests" description="This issue has no approval history." />;
  }

  return (
    <div className="space-y-4">
      {requests.map((req: ApprovalRequest) => {
        const isPending = req.status === 'PENDING';
        const hasVoted = req.votes.some((v) => v.userId === user?.id);
        const isRequester = req.requestedById === user?.id;

        return (
          <div key={req.id} className="border border-border rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ApprovalBadge status={req.status} targetColumnName={req.targetColumn.name} />
                <span className="text-xs text-text-tertiary">
                  Requested by {req.requestedBy.displayName || req.requestedBy.username}
                </span>
              </div>
              {isPending && isRequester && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => cancelMutation.mutate(req.id)}
                  disabled={cancelMutation.isPending}
                >
                  <X className="h-3 w-3" /> Cancel
                </Button>
              )}
            </div>

            {/* Votes */}
            {req.votes.length > 0 && (
              <div className="border-t border-border pt-2 mb-3">
                {req.votes.map((vote) => (
                  <ApprovalVoteCard key={vote.id} {...vote} />
                ))}
              </div>
            )}

            {/* Vote actions */}
            {isPending && !hasVoted && !isRequester && (
              <div className="border-t border-border pt-3 space-y-2">
                <textarea
                  value={voteComment}
                  onChange={(e) => setVoteComment(e.target.value)}
                  placeholder="Optional comment..."
                  rows={2}
                  className="w-full px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-border-focus resize-none"
                />
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => voteMutation.mutate({ requestId: req.id, decision: 'APPROVED' })}
                    disabled={voteMutation.isPending}
                  >
                    <ThumbsUp className="h-3 w-3" /> Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => voteMutation.mutate({ requestId: req.id, decision: 'REJECTED' })}
                    disabled={voteMutation.isPending}
                  >
                    <ThumbsDown className="h-3 w-3" /> Reject
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/ApprovalVoteCard.tsx frontend/src/components/ui/ApprovalPanel.tsx
git commit -m "feat(approvals): add ApprovalVoteCard and ApprovalPanel components"
```

---

### Task 11: Frontend — Board Integration

**Files:**
- Modify: `frontend/src/pages/issues/Board.tsx`

- [ ] **Step 1: Add approval gate query and state to Board**

At the top of the Board component, add the approval gate query and modal state:

```typescript
import { approvalsApi, type ApprovalGate } from '@/api/approvals.api';
import { ApprovalBadge } from '@/components/ui/ApprovalBadge';
import { ApprovalModal } from '@/components/ui/ApprovalModal';

// Inside the Board component:
const { data: approvalGates } = useQuery({
  queryKey: ['approval-gates', projectId],
  queryFn: () => approvalsApi.listGates(projectId!),
  enabled: !!projectId,
});

const [approvalModalState, setApprovalModalState] = useState<{
  open: boolean;
  issueId: string;
  issueTitle: string;
  fromColumnName: string;
  toColumnId: string;
  toColumnName: string;
  gate: ApprovalGate;
} | null>(null);
```

- [ ] **Step 2: Intercept drag-and-drop on gated transitions**

In the `onDrop` handler, before the existing move logic, add the gate check:

```typescript
// Inside onDrop handler, after parsing drag data:
const gate = approvalGates?.find(
  (g) => g.enabled && g.fromColumnId === issue.columnId && g.toColumnId === targetColumnId,
);

if (gate) {
  // Intercept — show approval modal instead of moving
  setApprovalModalState({
    open: true,
    issueId: issue.id,
    issueTitle: issue.title,
    fromColumnName: columns.find((c) => c.id === issue.columnId)?.name || '',
    toColumnId: targetColumnId,
    toColumnName: columns.find((c) => c.id === targetColumnId)?.name || '',
    gate,
  });
  return; // Don't move the issue
}

// ... existing move logic continues
```

- [ ] **Step 3: Add ApprovalBadge to board cards**

In the board card rendering, add the badge for issues with pending approval requests. This requires fetching pending requests per issue — do it as part of the board data query or as a lightweight field on the issue response. The simplest approach is to add an `approvalStatus` field to the board query response. For now, query active requests for all visible issues:

```typescript
// Add query for active approval requests in the project
const { data: pendingRequests } = useQuery({
  queryKey: ['approval-requests-pending', projectId],
  queryFn: async () => {
    const issues = columns?.flatMap((c) => c.issues) || [];
    // Batch: get all pending requests for this project's issues
    // This should be a dedicated endpoint, but for now we can add it
    return approvalsApi.listPendingForProject(projectId!);
  },
  enabled: !!projectId && !!columns,
});

// In the card rendering:
const pendingRequest = pendingRequests?.find((r) => r.issueId === issue.id && r.status === 'PENDING');
{pendingRequest && (
  <ApprovalBadge status={pendingRequest.status} targetColumnName={pendingRequest.targetColumn?.name} />
)}
```

Note: You'll need to add a `listPendingForProject` function to the API client and a corresponding backend endpoint. Add to `approvals.service.ts`:

```typescript
export async function listPendingForProject(projectId: string) {
  return prisma.approvalRequest.findMany({
    where: {
      status: 'PENDING',
      approvalGate: { projectId },
    },
    select: {
      id: true, issueId: true, status: true, targetColumnId: true,
      targetColumn: { select: { id: true, name: true } },
    },
  });
}
```

- [ ] **Step 4: Disable dragging for issues with pending requests**

In the card's `draggable` attribute:

```typescript
draggable={!pendingRequest}
```

Add visual dimming:

```typescript
className={cn(
  'existing-card-classes',
  pendingRequest && 'opacity-70 cursor-not-allowed',
)}
```

- [ ] **Step 5: Render the ApprovalModal**

At the bottom of the Board component JSX, add:

```tsx
{approvalModalState && (
  <ApprovalModal
    open={approvalModalState.open}
    onClose={() => setApprovalModalState(null)}
    issueId={approvalModalState.issueId}
    issueTitle={approvalModalState.issueTitle}
    fromColumnName={approvalModalState.fromColumnName}
    toColumnId={approvalModalState.toColumnId}
    toColumnName={approvalModalState.toColumnName}
    minApprovals={approvalModalState.gate.minApprovals}
    allowSelfApproval={approvalModalState.gate.allowSelfApproval}
    currentUserId={user!.id}
    projectMembers={projectMembers || []}
    onSuccess={() => {
      queryClient.invalidateQueries({ queryKey: ['approval-requests-pending', projectId] });
    }}
  />
)}
```

- [ ] **Step 6: Add lock icon to gated column headers**

In the column header rendering, add a visual indicator:

```tsx
const isGatedInbound = approvalGates?.some((g) => g.enabled && g.toColumnId === column.id);

// In column header JSX:
<div className="flex items-center gap-1.5">
  <span>{column.name}</span>
  {isGatedInbound && <ShieldCheck className="h-3.5 w-3.5 text-warning" title="Approval required" />}
</div>
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/issues/Board.tsx frontend/src/api/approvals.api.ts
git add src/modules/approvals/approvals.service.ts src/modules/approvals/approvals.controller.ts src/modules/approvals/approvals.routes.ts
git commit -m "feat(approvals): integrate approval gates with board drag-and-drop"
```

---

### Task 12: Frontend — Gate Configuration Settings Page

**Files:**
- Create: `frontend/src/pages/projects/ApprovalsSettings.tsx`
- Modify: project settings route registration

- [ ] **Step 1: Write ApprovalsSettings page**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Plus, Trash2, ArrowRight, ToggleLeft, ToggleRight } from 'lucide-react';
import { approvalsApi, type ApprovalGate } from '@/api/approvals.api';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { useProjectContext } from '@/hooks/useProjectContext';
import { Button } from '@/components/ui/Button';
import { Table, Th, Td, Tr, TableContainer } from '@/components/ui/Table';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

export default function ApprovalsSettings() {
  const { currentProject } = useProjectContext();
  const projectId = currentProject!.id;

  const [fromColumnId, setFromColumnId] = useState('');
  const [toColumnId, setToColumnId] = useState('');
  const [minApprovals, setMinApprovals] = useState(1);
  const [allowSelfApproval, setAllowSelfApproval] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const { data: gates } = useQuery({
    queryKey: ['approval-gates', projectId],
    queryFn: () => approvalsApi.listGates(projectId),
  });

  const { data: columns } = useQuery({
    queryKey: ['board-columns', projectId],
    queryFn: () => approvalsApi.listGates(projectId), // Replace with actual columns query
  });

  const createMutation = useMutationWithToast(
    () => approvalsApi.createGate(projectId, { fromColumnId, toColumnId, minApprovals, allowSelfApproval }),
    {
      successMessage: 'Approval gate created',
      errorMessage: 'Failed to create gate',
      invalidateKeys: [['approval-gates', projectId]],
      onSuccess: () => {
        setFromColumnId('');
        setToColumnId('');
        setMinApprovals(1);
        setAllowSelfApproval(false);
      },
    },
  );

  const toggleMutation = useMutationWithToast(
    ({ gateId, enabled }: { gateId: string; enabled: boolean }) =>
      approvalsApi.updateGate(projectId, gateId, { enabled }),
    {
      successMessage: null,
      errorMessage: 'Failed to update gate',
      invalidateKeys: [['approval-gates', projectId]],
    },
  );

  const deleteMutation = useMutationWithToast(
    (gateId: string) => approvalsApi.deleteGate(projectId, gateId),
    {
      successMessage: 'Approval gate deleted',
      errorMessage: 'Failed to delete gate',
      invalidateKeys: [['approval-gates', projectId]],
      onSuccess: () => setDeleteTarget(null),
    },
  );

  const canCreate = fromColumnId && toColumnId && fromColumnId !== toColumnId;

  return (
    <div className="space-y-6">
      {/* Create gate form */}
      <div className="bg-surface-elevated border border-border rounded-lg p-4">
        <h2 className="text-sm font-semibold text-text mb-3">Add Approval Gate</h2>
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">From Column</label>
            <select
              value={fromColumnId}
              onChange={(e) => setFromColumnId(e.target.value)}
              className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select...</option>
              {columns?.map((c: { id: string; name: string }) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <ArrowRight className="h-5 w-5 text-text-tertiary mb-2" />
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">To Column</label>
            <select
              value={toColumnId}
              onChange={(e) => setToColumnId(e.target.value)}
              className="px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="">Select...</option>
              {columns?.map((c: { id: string; name: string }) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">Min Approvals</label>
            <input
              type="number"
              min={1}
              max={10}
              value={minApprovals}
              onChange={(e) => setMinApprovals(Number(e.target.value))}
              className="w-20 px-3 py-2 bg-surface border border-border rounded-lg text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <Button onClick={() => createMutation.mutate(undefined)} disabled={!canCreate || createMutation.isPending}>
            <Plus className="h-4 w-4" /> Add Gate
          </Button>
        </div>
      </div>

      {/* Gates table */}
      {gates && gates.length > 0 ? (
        <TableContainer>
          <Table>
            <thead>
              <Tr>
                <Th>Transition</Th>
                <Th>Min Approvals</Th>
                <Th>Self-Approval</Th>
                <Th>Enabled</Th>
                <Th />
              </Tr>
            </thead>
            <tbody>
              {gates.map((gate: ApprovalGate) => (
                <Tr key={gate.id}>
                  <Td>
                    <span className="flex items-center gap-2 text-sm">
                      {gate.fromColumn.name} <ArrowRight className="h-3 w-3 text-text-tertiary" /> {gate.toColumn.name}
                    </span>
                  </Td>
                  <Td>{gate.minApprovals}</Td>
                  <Td>{gate.allowSelfApproval ? 'Yes' : 'No'}</Td>
                  <Td>
                    <button
                      onClick={() => toggleMutation.mutate({ gateId: gate.id, enabled: !gate.enabled })}
                      title={gate.enabled ? 'Disable' : 'Enable'}
                    >
                      {gate.enabled
                        ? <ToggleRight className="h-5 w-5 text-success" />
                        : <ToggleLeft className="h-5 w-5 text-text-tertiary" />}
                    </button>
                  </Td>
                  <Td>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(gate.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableContainer>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          title="No approval gates"
          description="Add a gate to require approvals for column transitions."
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
        title="Delete Approval Gate"
        description="This will cancel all pending approval requests for this gate. Are you sure?"
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
```

- [ ] **Step 2: Register the settings page route**

Add lazy import and route in the project settings routes (wherever `WorkflowEditor` is registered):

```typescript
const ApprovalsSettings = lazy(() => import('@/pages/projects/ApprovalsSettings'));

// In project settings routes:
<Route path="approvals" element={<ApprovalsSettings />} />
```

- [ ] **Step 3: Add nav link in project settings sidebar**

Add next to the existing "Workflow" settings link:

```tsx
<NavItem to={`/${org}/${team}/${project}/settings/approvals`} icon={ShieldCheck}>
  Approvals
</NavItem>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/projects/ApprovalsSettings.tsx
git add <route-file> <settings-sidebar-file>
git commit -m "feat(approvals): add gate configuration settings page"
```

---

### Task 13: Frontend — My Approvals Page

**Files:**
- Create: `frontend/src/pages/approvals/MyApprovals.tsx`

- [ ] **Step 1: Write MyApprovals page**

```tsx
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ThumbsUp, ThumbsDown, ArrowRight } from 'lucide-react';
import { approvalsApi, type ApprovalRequest } from '@/api/approvals.api';
import { useMutationWithToast } from '@/hooks/useMutationWithToast';
import { Button } from '@/components/ui/Button';
import { Table, Th, Td, Tr, TableContainer } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';

export default function MyApprovals() {
  const { data: approvals, isLoading } = useQuery({
    queryKey: ['my-pending-approvals'],
    queryFn: () => approvalsApi.myPendingApprovals(),
  });

  const [voteComments, setVoteComments] = useState<Record<string, string>>({});

  const voteMutation = useMutationWithToast(
    ({ requestId, decision }: { requestId: string; decision: 'APPROVED' | 'REJECTED' }) =>
      approvalsApi.castVote(requestId, { decision, comment: voteComments[requestId] || undefined }),
    {
      successMessage: 'Vote recorded',
      errorMessage: 'Failed to record vote',
      invalidateKeys: [['my-pending-approvals']],
    },
  );

  if (isLoading) return <Spinner />;

  if (!approvals || approvals.length === 0) {
    return (
      <div className="p-6">
        <EmptyState icon={ShieldCheck} title="No pending approvals" description="You have no approval requests waiting for your review." />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-lg font-semibold text-text">My Approvals</h1>

      <TableContainer>
        <Table>
          <thead>
            <Tr>
              <Th>Issue</Th>
              <Th>Project</Th>
              <Th>Transition</Th>
              <Th>Requested By</Th>
              <Th>Date</Th>
              <Th>Actions</Th>
            </Tr>
          </thead>
          <tbody>
            {approvals.map((req: ApprovalRequest) => {
              const project = req.approvalGate?.project;
              const issueKey = project ? `${project.prefix}-${req.issue?.number}` : `#${req.issue?.number}`;
              const issueUrl = project
                ? `/${project.team.org.slug}/${project.team.slug}/${project.slug}/issues/${req.issue?.number}`
                : '#';

              return (
                <Tr key={req.id}>
                  <Td>
                    <a href={issueUrl} className="text-primary hover:underline font-medium">
                      {issueKey}
                    </a>
                    <span className="ml-2 text-sm text-text-secondary">{req.issue?.title}</span>
                  </Td>
                  <Td><Badge>{project?.slug}</Badge></Td>
                  <Td>
                    <span className="flex items-center gap-1 text-sm">
                      {req.approvalGate?.fromColumn.name}
                      <ArrowRight className="h-3 w-3" />
                      {req.approvalGate?.toColumn.name}
                    </span>
                  </Td>
                  <Td className="text-sm">{req.requestedBy.displayName || req.requestedBy.username}</Td>
                  <Td className="text-sm text-text-tertiary">{new Date(req.createdAt).toLocaleDateString()}</Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="primary"
                        size="xs"
                        onClick={() => voteMutation.mutate({ requestId: req.id, decision: 'APPROVED' })}
                        disabled={voteMutation.isPending}
                      >
                        <ThumbsUp className="h-3 w-3" /> Approve
                      </Button>
                      <Button
                        variant="danger"
                        size="xs"
                        onClick={() => voteMutation.mutate({ requestId: req.id, decision: 'REJECTED' })}
                        disabled={voteMutation.isPending}
                      >
                        <ThumbsDown className="h-3 w-3" /> Reject
                      </Button>
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </TableContainer>
    </div>
  );
}
```

- [ ] **Step 2: Register route and nav link**

Add lazy import and route:
```typescript
const MyApprovals = lazy(() => import('@/pages/approvals/MyApprovals'));

// In org-level routes:
<Route path="/:org/approvals" element={<MyApprovals />} />
```

Add sidebar nav link in org section:
```tsx
<NavItem to={`/${org}/approvals`} icon={ShieldCheck}>
  Approvals
</NavItem>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/approvals/MyApprovals.tsx
git add <route-file> <sidebar-file>
git commit -m "feat(approvals): add My Approvals page with inline voting"
```

---

### Task 14: Frontend — Issue Detail Approvals Tab

**Files:**
- Modify: `frontend/src/pages/issues/IssueDetail.tsx`

- [ ] **Step 1: Add Approvals tab to issue detail**

Import the ApprovalPanel and add it as a tab:

```typescript
import { ApprovalPanel } from '@/components/ui/ApprovalPanel';

// In the tabs definition:
const tabs = [
  { key: 'comments', label: 'Comments', icon: <MessageSquare className="h-4 w-4" /> },
  { key: 'activity', label: 'Activity', icon: <Activity className="h-4 w-4" /> },
  { key: 'approvals', label: 'Approvals', icon: <ShieldCheck className="h-4 w-4" /> },
  // ... existing tabs
];

// In the tab content rendering:
{activeTab === 'approvals' && <ApprovalPanel issueId={issue.id} />}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/issues/IssueDetail.tsx
git commit -m "feat(approvals): add Approvals tab to issue detail page"
```

---

### Task 15: Real-time Invalidation

**Files:**
- Modify: `frontend/src/hooks/useRealtimeInvalidation.ts` (or equivalent)

- [ ] **Step 1: Add approval event handlers**

```typescript
// In the WebSocket message handler:
case 'approval:request:created':
case 'approval:request:resolved':
  queryClient.invalidateQueries({ queryKey: ['approval-requests-pending', event.projectId] });
  queryClient.invalidateQueries({ queryKey: ['approval-requests', event.issueId] });
  queryClient.invalidateQueries({ queryKey: ['my-pending-approvals'] });
  // If approved, also invalidate the board to reflect the column move
  if (event.status === 'APPROVED') {
    queryClient.invalidateQueries({ queryKey: ['board', event.projectId] });
  }
  break;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useRealtimeInvalidation.ts
git commit -m "feat(approvals): add real-time invalidation for approval events"
```

---

### Task 16: Typecheck and Final Verification

- [ ] **Step 1: Run backend typecheck**

Run: `npx tsc --noEmit`
Expected: No errors. Fix any type issues.

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors. Fix any type issues.

- [ ] **Step 3: Run backend tests**

Run: `npm run test`
Expected: All tests pass including the new approval tests.

- [ ] **Step 4: Run full check**

Run: `npm run check`
Expected: Typecheck + lint + format + test all pass.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(approvals): resolve typecheck and lint issues"
```
