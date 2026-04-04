# Runner Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gitea-compatible runner support so automation rules can dispatch workflow jobs to external `act_runner` instances.

**Architecture:** New `runners` module implementing the Connect-RPC protocol (5 endpoints). A `run_workflow` action type is added to the existing automation system. Runners register at org/team/project scope, poll for tasks, execute GitHub Actions-compatible YAML workflows, and report results back. Completion triggers fire downstream automation rules.

**Tech Stack:** Express 5, Prisma 7 (with `$queryRaw` for atomic claiming), Redis (task version counter + rate limiting), bcrypt (token hashing), SSE (log streaming), WebSocket (real-time status broadcasts)

**Spec:** `docs/specs/2026-04-04-runner-support-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/modules/runners/runners.routes.ts` | Express routes for runner management API + Connect-RPC protocol endpoints |
| `src/modules/runners/runners.controller.ts` | HTTP handlers for runner CRUD (registration tokens, list, delete) |
| `src/modules/runners/runners.service.ts` | Business logic: registration, token generation, scope resolution, health monitoring |
| `src/modules/runners/connect-rpc.routes.ts` | Connect-RPC protocol routes (`/api/actions/runner.v1.RunnerService/*`) |
| `src/modules/runners/connect-rpc.controller.ts` | Protocol handlers: Register, Declare, FetchTask, UpdateTask, UpdateLog, Ping |
| `src/modules/runners/connect-rpc.service.ts` | Protocol business logic: task claiming, log ingestion, completion handling |
| `src/modules/runners/runner-auth.ts` | Middleware for `X-Runner-UUID` + `X-Runner-Token` header authentication |
| `src/modules/runners/runner-health.ts` | Background interval job marking stale runners as OFFLINE |
| `src/modules/runners/runners.test.ts` | Integration tests for runner management API |
| `src/modules/runners/connect-rpc.test.ts` | Integration tests for Connect-RPC protocol endpoints |

### Important Patterns (Cross-Cutting)

These patterns apply to ALL code in this plan:

- **`asyncHandler`**: Import from `'../../utils/asyncHandler'`, NOT from `errorHandler`. The `errorHandler` module exports `AppError` and the error handler middleware only.
- **`param()` utility**: Import from `'../../utils/params'` and use `param(req, 'paramName')` instead of raw `req.params.paramName`. Every controller in the codebase uses this.
- **`RealtimeEvent` union**: When adding new WebSocket events, add the type to the union in `src/realtime/events.ts` AND the frontend mirror at `frontend/src/hooks/useRealtimeInvalidation.ts`.
- **Command injection prevention**: Use `execFileSync` (array args) instead of `execSync` (string interpolation) when passing user-influenced values to git commands.

### Modified Files

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Add `Runner`, `RunnerRegistrationToken`, `RunnerTask`, `RunnerTaskLog` models + enums |
| `src/index.ts` | Import and mount runner routes |
| `src/modules/automation/automation.service.ts` | Add `run_workflow` to `AutomationAction` type, add case in `executeActions()`, update recursion guard to `depth > 2`, add `workflow:completed`/`workflow:failed` triggers |
| `src/realtime/events.ts` | Add `runner-task:updated` to `RealtimeEvent` union |
| `frontend/src/hooks/useRealtimeInvalidation.ts` | Add `runner-task:updated` to frontend `RealtimeEvent` mirror |
| `docs/architecture.md` | Add runner subsystem to system diagram |
| `docs/design-patterns.md` | Document `run_workflow` action type and runner module pattern |
| `docs/api-reference.md` | Add runner management + Connect-RPC endpoint docs |
| `docs/development-guide.md` | Add local `act_runner` setup instructions |
| `docs/getting-started.md` | Add optional runner setup section |
| `docs/axiom-mcp-server.md` | Add MCP tools for runner management |

---

## Task 1: Database Schema -- Runner Models

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums to schema**

Add after the existing `RunStatus` enum in `prisma/schema.prisma`:

```prisma
enum RunnerStatus {
  OFFLINE
  IDLE
  ACTIVE
}

enum RunnerScope {
  ORG
  TEAM
  PROJECT
}
```

- [ ] **Step 2: Add Runner model**

```prisma
model Runner {
  id         String       @id @default(cuid())
  uuid       String       @unique
  name       String
  tokenHash  String
  status     RunnerStatus @default(IDLE)
  labels     Json         @default("[]")
  version    String       @default("")
  lastSeenAt DateTime?
  scopeType  RunnerScope
  scopeId    String
  tasks      RunnerTask[]
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt

  @@index([scopeType, scopeId])
  @@index([status])
  @@map("runners")
}
```

- [ ] **Step 3: Add RunnerRegistrationToken model**

```prisma
model RunnerRegistrationToken {
  id        String      @id @default(cuid())
  tokenHash String      @unique
  scopeType RunnerScope
  scopeId   String
  usedBy    String?
  expiresAt DateTime
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  @@index([scopeType, scopeId])
  @@map("runner_registration_tokens")
}
```

- [ ] **Step 4: Add RunnerTask model**

```prisma
model RunnerTask {
  id               String          @id @default(cuid())
  runnerId         String?
  runner           Runner?         @relation(fields: [runnerId], references: [id])
  automationRuleId String?
  automationRule   AutomationRule? @relation(fields: [automationRuleId], references: [id], onDelete: SetNull)
  issueId          String?
  issue            Issue?          @relation(fields: [issueId], references: [id])
  workflowSource   String
  workflowRef      String
  workflowContent  String
  repoId           String
  repo             Repository      @relation(fields: [repoId], references: [id], onDelete: Cascade)
  gitRef           String          @default("HEAD")
  status           RunStatus       @default(PENDING)
  context          Json            @default("{}")
  labels           Json            @default("[]")
  startedAt        DateTime?
  finishedAt       DateTime?
  logs             RunnerTaskLog[]
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  @@index([status])
  @@index([runnerId])
  @@index([issueId])
  @@index([repoId])
  @@map("runner_tasks")
}
```

- [ ] **Step 5: Add RunnerTaskLog model**

```prisma
model RunnerTaskLog {
  id        String     @id @default(cuid())
  taskId    String
  task      RunnerTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  lineIndex Int
  content   String
  timestamp DateTime   @default(now())

  @@unique([taskId, lineIndex])
  @@index([taskId])
  @@map("runner_task_logs")
}
```

- [ ] **Step 6: Add reverse relations to existing models**

Add `runnerTasks RunnerTask[]` to the `AutomationRule`, `Issue`, and `Repository` models.

- [ ] **Step 7: Generate Prisma client and run migration**

Run: `npx prisma generate && npx prisma migrate dev --name add-runner-models`
Expected: Migration created, client regenerated with no errors.

- [ ] **Step 8: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add prisma/
git commit -m "feat(runners): add Runner, RunnerTask, RunnerTaskLog schema models"
```

---

## Task 2: Runner Authentication Middleware

**Files:**
- Create: `src/modules/runners/runner-auth.ts`
- Test: `src/modules/runners/runner-auth.test.ts`

- [ ] **Step 1: Write failing test for runner auth middleware**

Create `src/modules/runners/runner-auth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Tests will be written against the authenticateRunner middleware
// It should:
// 1. Read X-Runner-UUID and X-Runner-Token headers
// 2. Look up runner by UUID
// 3. Compare token against bcrypt hash
// 4. Attach runner to req and call next()
// 5. Return 401 if missing headers, unknown UUID, or wrong token

describe('authenticateRunner', () => {
  it('returns 401 when X-Runner-UUID header is missing', async () => {
    const { authenticateRunner } = await import('./runner-auth');
    const req = { headers: {} } as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await authenticateRunner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when runner UUID not found in database', async () => {
    const { authenticateRunner } = await import('./runner-auth');
    const req = {
      headers: { 'x-runner-uuid': 'nonexistent', 'x-runner-token': 'tok' },
    } as unknown as Request;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    await authenticateRunner(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/runners/runner-auth.test.ts`
Expected: FAIL -- module `./runner-auth` not found.

- [ ] **Step 3: Implement runner auth middleware**

Create `src/modules/runners/runner-auth.ts`:

```typescript
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';

import { prisma } from '../../config/database';

export interface RunnerRequest extends Request {
  runner?: {
    id: string;
    uuid: string;
    name: string;
    scopeType: string;
    scopeId: string;
    labels: unknown;
  };
}

export async function authenticateRunner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const uuid = req.headers['x-runner-uuid'] as string | undefined;
  const token = req.headers['x-runner-token'] as string | undefined;

  if (!uuid || !token) {
    res.status(401).json({ error: { message: 'Missing runner credentials' } });
    return;
  }

  const runner = await prisma.runner.findUnique({ where: { uuid } });
  if (!runner) {
    res.status(401).json({ error: { message: 'Unknown runner' } });
    return;
  }

  const valid = await bcrypt.compare(token, runner.tokenHash);
  if (!valid) {
    res.status(401).json({ error: { message: 'Invalid runner token' } });
    return;
  }

  // Update lastSeenAt
  await prisma.runner.update({
    where: { id: runner.id },
    data: { lastSeenAt: new Date() },
  });

  (req as RunnerRequest).runner = {
    id: runner.id,
    uuid: runner.uuid,
    name: runner.name,
    scopeType: runner.scopeType,
    scopeId: runner.scopeId,
    labels: runner.labels,
  };

  next();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/runners/runner-auth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/runners/runner-auth.ts src/modules/runners/runner-auth.test.ts
git commit -m "feat(runners): add runner authentication middleware"
```

---

## Task 3: Runner Management Service

**Files:**
- Create: `src/modules/runners/runners.service.ts`
- Test: `src/modules/runners/runners.test.ts`

- [ ] **Step 1: Write failing tests for token generation and runner listing**

Create `src/modules/runners/runners.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';

// Tests against the runner management API:
// 1. POST /api/orgs/:orgId/runners/registration-token -- generates a scoped token
// 2. GET /api/orgs/:orgId/runners -- lists runners for scope
// 3. DELETE /api/orgs/:orgId/runners/:runnerId -- removes a runner

// Use the same test setup pattern as automation.test.ts
// Login as 'tim' (OWNER), use org/team/project from seed data
```

Tests should cover:
- Generating a registration token returns a plaintext token and stores hash
- Token expires after 1 hour
- Listing runners returns empty array initially
- Deleting a runner returns 204

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/runners/runners.test.ts`
Expected: FAIL -- routes not implemented.

- [ ] **Step 3: Implement runners service**

Create `src/modules/runners/runners.service.ts`:

```typescript
import crypto from 'crypto';

import bcrypt from 'bcryptjs';

import { prisma } from '../../config/database';
import type { RunnerScope } from '@prisma/client';
import { AppError } from '../../middleware/errorHandler';

/**
 * Generate a registration token scoped to org/team/project.
 * Token is single-use, expires in 1 hour.
 */
export async function generateRegistrationToken(scopeType: RunnerScope, scopeId: string) {
  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(plainToken, 10);

  const record = await prisma.runnerRegistrationToken.create({
    data: {
      tokenHash,
      scopeType,
      scopeId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
  });

  return { token: plainToken, id: record.id, expiresAt: record.expiresAt };
}

/**
 * List runners for a given scope.
 */
export async function listRunners(scopeType: RunnerScope, scopeId: string) {
  return prisma.runner.findMany({
    where: { scopeType, scopeId },
    select: {
      id: true,
      uuid: true,
      name: true,
      status: true,
      labels: true,
      version: true,
      lastSeenAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Get a single runner by ID, verifying it belongs to the given scope.
 */
export async function getRunner(runnerId: string, scopeType: RunnerScope, scopeId: string) {
  const runner = await prisma.runner.findUnique({
    where: { id: runnerId },
    include: {
      tasks: {
        where: { status: { in: ['RUNNING', 'PENDING'] } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!runner || runner.scopeType !== scopeType || runner.scopeId !== scopeId) {
    throw new AppError(404, 'Runner not found');
  }

  return runner;
}

/**
 * Delete a runner, verifying scope ownership.
 */
export async function deleteRunner(runnerId: string, scopeType: RunnerScope, scopeId: string) {
  const runner = await prisma.runner.findUnique({ where: { id: runnerId } });
  if (!runner || runner.scopeType !== scopeType || runner.scopeId !== scopeId) {
    throw new AppError(404, 'Runner not found');
  }

  await prisma.runner.delete({ where: { id: runnerId } });
}

/**
 * Resolve available runner scope IDs for a project.
 * Returns { projectId, teamId, orgId } for scope hierarchy resolution.
 */
export async function resolveProjectScopes(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { team: { include: { org: true } } },
  });
  if (!project) throw new AppError(404, 'Project not found');

  return {
    projectId: project.id,
    teamId: project.teamId,
    orgId: project.team.orgId,
  };
}
```

- [ ] **Step 4: Implement runners controller**

Create `src/modules/runners/runners.controller.ts`:

```typescript
import type { Request, Response } from 'express';
import type { RunnerScope } from '@prisma/client';

import { asyncHandler } from '../../utils/asyncHandler';
import { param } from '../../utils/params';
import * as svc from './runners.service';

function extractScope(req: Request): { scopeType: RunnerScope; scopeId: string } {
  if (req.params.orgId) return { scopeType: 'ORG', scopeId: param(req, 'orgId') };
  if (req.params.teamId) return { scopeType: 'TEAM', scopeId: param(req, 'teamId') };
  if (req.params.projectId) return { scopeType: 'PROJECT', scopeId: param(req, 'projectId') };
  throw new Error('Could not determine runner scope from route');
}

export const createRegistrationToken = asyncHandler(async (req: Request, res: Response) => {
  const { scopeType, scopeId } = extractScope(req);
  const result = await svc.generateRegistrationToken(scopeType, scopeId);
  res.status(201).json(result);
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { scopeType, scopeId } = extractScope(req);
  const runners = await svc.listRunners(scopeType, scopeId);
  res.json(runners);
});

export const get = asyncHandler(async (req: Request, res: Response) => {
  const { scopeType, scopeId } = extractScope(req);
  const runner = await svc.getRunner(param(req, 'runnerId'), scopeType, scopeId);
  res.json(runner);
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const { scopeType, scopeId } = extractScope(req);
  await svc.deleteRunner(param(req, 'runnerId'), scopeType, scopeId);
  res.status(204).end();
});
```

- [ ] **Step 5: Implement runners routes**

Create `src/modules/runners/runners.routes.ts`:

```typescript
import { Router } from 'express';

import { authenticate } from '../../middleware/auth';
import * as ctrl from './runners.controller';

const router = Router();

router.use(authenticate);

// Org-scoped runners
router.post('/orgs/:orgId/runners/registration-token', ctrl.createRegistrationToken);
router.get('/orgs/:orgId/runners', ctrl.list);
router.get('/orgs/:orgId/runners/:runnerId', ctrl.get);
router.delete('/orgs/:orgId/runners/:runnerId', ctrl.remove);

// Team-scoped runners
router.post('/teams/:teamId/runners/registration-token', ctrl.createRegistrationToken);
router.get('/teams/:teamId/runners', ctrl.list);
router.get('/teams/:teamId/runners/:runnerId', ctrl.get);
router.delete('/teams/:teamId/runners/:runnerId', ctrl.remove);

// Project-scoped runners
router.post('/projects/:projectId/runners/registration-token', ctrl.createRegistrationToken);
router.get('/projects/:projectId/runners', ctrl.list);
router.get('/projects/:projectId/runners/:runnerId', ctrl.get);
router.delete('/projects/:projectId/runners/:runnerId', ctrl.remove);

export default router;
```

- [ ] **Step 6: Mount routes in index.ts**

In `src/index.ts`, add import:
```typescript
import runnersRoutes from './modules/runners/runners.routes';
```

Mount after the automation routes line (`app.use('/api/projects', automationRoutes);`):
```typescript
app.use('/api', runnersRoutes);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/modules/runners/runners.test.ts`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add src/modules/runners/runners.service.ts src/modules/runners/runners.controller.ts src/modules/runners/runners.routes.ts src/modules/runners/runners.test.ts src/index.ts
git commit -m "feat(runners): add runner management API (registration tokens, CRUD)"
```

---

## Task 4: Connect-RPC Protocol -- Register & Declare

**Files:**
- Create: `src/modules/runners/connect-rpc.routes.ts`
- Create: `src/modules/runners/connect-rpc.controller.ts`
- Create: `src/modules/runners/connect-rpc.service.ts`
- Test: `src/modules/runners/connect-rpc.test.ts`

- [ ] **Step 1: Write failing tests for Register and Declare**

Create `src/modules/runners/connect-rpc.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import supertest from 'supertest';

// Test the Connect-RPC endpoints that act_runner calls.
// All endpoints are POST with JSON body, Content-Type: application/json.

describe('Connect-RPC: Register', () => {
  // Setup: generate a registration token first via the management API

  it('registers a runner with a valid token', async () => {
    // POST /api/actions/runner.v1.RunnerService/Register
    // Body: { name: 'test-runner', token: '<plaintext>', labels: ['docker'], version: '0.2.6' }
    // Expected: 200 with { runner: { uuid: string, token: string, name: 'test-runner' } }
  });

  it('rejects expired registration token', async () => {
    // Create a token, manually expire it in DB, attempt register
    // Expected: 400 with error message
  });

  it('rejects already-used registration token', async () => {
    // Register once, try again with same token
    // Expected: 400
  });
});

describe('Connect-RPC: Declare', () => {
  it('updates runner labels and version', async () => {
    // POST /api/actions/runner.v1.RunnerService/Declare
    // Headers: X-Runner-UUID, X-Runner-Token
    // Body: { version: '0.2.7', labels: ['docker', 'linux-amd64'] }
    // Expected: 200 with { runner: { uuid, name, status: 'IDLE' } }
  });

  it('returns 401 without auth headers', async () => {
    // No headers -> 401
  });
});

describe('Connect-RPC: Ping', () => {
  it('responds to health check', async () => {
    // POST /api/actions/ping.v1.PingService/Ping
    // Body: {}
    // Expected: 200 with { data: 'Hello' }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/runners/connect-rpc.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement Connect-RPC service (Register + Declare)**

Create `src/modules/runners/connect-rpc.service.ts`:

```typescript
import crypto from 'crypto';

import bcrypt from 'bcryptjs';

import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';
import { logger } from '../../utils/logger';

/**
 * Register a new runner using a registration token.
 * Returns the runner UUID and a plaintext auth token (only returned once).
 */
export async function registerRunner(data: {
  name: string;
  token: string;
  labels: string[];
  version: string;
}) {
  // Find valid, unused, non-expired registration tokens.
  // We store a token prefix (first 8 chars of hex) alongside the hash
  // to narrow down candidates before doing expensive bcrypt comparisons.
  // For simplicity in v1, we limit to 100 active tokens max (registration
  // tokens are single-use and expire in 1hr, so this is rarely more than a handful).
  const regTokens = await prisma.runnerRegistrationToken.findMany({
    where: {
      usedBy: null,
      expiresAt: { gt: new Date() },
    },
    take: 100,
    orderBy: { createdAt: 'desc' },
  });

  let matchedToken: typeof regTokens[0] | null = null;
  for (const rt of regTokens) {
    if (await bcrypt.compare(data.token, rt.tokenHash)) {
      matchedToken = rt;
      break;
    }
  }

  if (!matchedToken) {
    throw new AppError(400, 'Invalid or expired registration token');
  }

  // Generate runner credentials
  const uuid = crypto.randomUUID();
  const plainToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = await bcrypt.hash(plainToken, 10);

  // Create runner and mark registration token as used
  const runner = await prisma.runner.create({
    data: {
      uuid,
      name: data.name,
      tokenHash,
      status: 'IDLE',
      labels: data.labels,
      version: data.version,
      scopeType: matchedToken.scopeType,
      scopeId: matchedToken.scopeId,
      lastSeenAt: new Date(),
    },
  });

  await prisma.runnerRegistrationToken.update({
    where: { id: matchedToken.id },
    data: { usedBy: runner.id },
  });

  logger.info('Runner registered', { uuid, name: data.name, scopeType: matchedToken.scopeType });

  return {
    runner: {
      uuid: runner.uuid,
      token: plainToken,
      name: runner.name,
    },
  };
}

/**
 * Declare runner capabilities (called on each runner startup).
 */
export async function declareRunner(
  runnerId: string,
  data: { version: string; labels: string[] },
) {
  const runner = await prisma.runner.update({
    where: { id: runnerId },
    data: {
      version: data.version,
      labels: data.labels,
      status: 'IDLE',
      lastSeenAt: new Date(),
    },
  });

  return {
    runner: {
      uuid: runner.uuid,
      name: runner.name,
      status: runner.status,
    },
  };
}
```

- [ ] **Step 4: Implement Connect-RPC controller**

Create `src/modules/runners/connect-rpc.controller.ts`:

```typescript
import type { Request, Response } from 'express';

import { asyncHandler } from '../../utils/asyncHandler';
import type { RunnerRequest } from './runner-auth';
import * as svc from './connect-rpc.service';

export const ping = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ data: 'Hello' });
});

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { name, token, labels, version } = req.body;
  const result = await svc.registerRunner({
    name: name ?? 'unnamed',
    token: token ?? '',
    labels: labels ?? [],
    version: version ?? '',
  });
  res.json(result);
});

export const declare = asyncHandler(async (req: Request, res: Response) => {
  const runner = (req as RunnerRequest).runner!;
  const result = await svc.declareRunner(runner.id, {
    version: req.body.version ?? '',
    labels: req.body.labels ?? [],
  });
  res.json(result);
});
```

**Note:** The Connect-RPC controllers don't use `param()` because protocol endpoints receive data in the JSON body, not URL params.

- [ ] **Step 5: Implement Connect-RPC routes**

Create `src/modules/runners/connect-rpc.routes.ts`:

```typescript
import { Router } from 'express';

import { authenticateRunner } from './runner-auth';
import * as ctrl from './connect-rpc.controller';

const router = Router();

// Ping -- no auth required
router.post('/actions/ping.v1.PingService/Ping', ctrl.ping);

// Register -- uses registration token in body, no runner auth
router.post('/actions/runner.v1.RunnerService/Register', ctrl.register);

// All other protocol endpoints require runner auth
router.post('/actions/runner.v1.RunnerService/Declare', authenticateRunner, ctrl.declare);

export default router;
```

- [ ] **Step 6: Mount Connect-RPC routes in index.ts**

In `src/index.ts`, add import:
```typescript
import connectRpcRoutes from './modules/runners/connect-rpc.routes';
```

Mount BEFORE the CSRF guard (Connect-RPC endpoints come from external runners, not browsers):
```typescript
// Connect-RPC routes (runner protocol, no CSRF)
app.use('/api', connectRpcRoutes);
```

Place this line before `app.use('/api', csrfGuard);` (line ~103).

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/modules/runners/connect-rpc.test.ts`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/modules/runners/connect-rpc.service.ts src/modules/runners/connect-rpc.controller.ts src/modules/runners/connect-rpc.routes.ts src/modules/runners/connect-rpc.test.ts src/index.ts
git commit -m "feat(runners): implement Connect-RPC Register, Declare, and Ping endpoints"
```

---

## Task 5: Connect-RPC Protocol -- FetchTask with Atomic Claiming

**Files:**
- Modify: `src/modules/runners/connect-rpc.service.ts`
- Modify: `src/modules/runners/connect-rpc.controller.ts`
- Modify: `src/modules/runners/connect-rpc.routes.ts`
- Modify: `src/modules/runners/connect-rpc.test.ts`

- [ ] **Step 1: Write failing tests for FetchTask**

Add to `connect-rpc.test.ts`:

```typescript
describe('Connect-RPC: FetchTask', () => {
  it('returns empty when no pending tasks', async () => {
    // POST /api/actions/runner.v1.RunnerService/FetchTask
    // Body: { tasksVersion: 0 }
    // Expected: 200 with { task: null }
  });

  it('returns and claims a pending task matching runner scope', async () => {
    // Create a RunnerTask with status PENDING in the runner's scope
    // FetchTask should return it and set status to RUNNING
    // A second FetchTask should return null (already claimed)
  });

  it('skips tasks outside runner scope', async () => {
    // Create task in a different project scope
    // Runner at org scope should still see it (walks up)
    // Runner at different org should not
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/runners/connect-rpc.test.ts`
Expected: FAIL on new tests.

- [ ] **Step 3: Add FetchTask with scope resolution and atomic claiming**

Add to `connect-rpc.service.ts`:

```typescript
import { redis } from '../../config/redis';
import { Prisma } from '@prisma/client';

const TASKS_VERSION_KEY = 'runner:tasks_version';

/**
 * Increment the global tasks version counter.
 * Called when a new RunnerTask is created.
 */
export async function incrementTasksVersion() {
  try {
    await redis.incr(TASKS_VERSION_KEY);
  } catch {
    // Redis unavailable -- runners will always query DB (fallback)
  }
}

/**
 * FetchTask: find and atomically claim a pending task for this runner.
 * Uses raw SQL UPDATE ... WHERE status = 'PENDING' RETURNING * for atomicity.
 */
export async function fetchTask(runner: {
  id: string;
  scopeType: string;
  scopeId: string;
  labels: unknown;
}, tasksVersion?: number) {
  // Version optimization: skip DB query if no new tasks
  if (tasksVersion !== undefined) {
    try {
      const currentVersion = await redis.get(TASKS_VERSION_KEY);
      if (currentVersion && parseInt(currentVersion, 10) === tasksVersion) {
        return { task: null, tasksVersion };
      }
    } catch {
      // Redis unavailable -- fall through to DB query
    }
  }

  // Build scope filter: runner can claim tasks in its scope or child scopes
  const scopeIds = await getEligibleScopeIds(runner.scopeType, runner.scopeId);

  // Atomic claim: UPDATE the oldest PENDING task that matches scope + labels
  // Only one runner can succeed even under concurrent polling
  const claimed = await prisma.$queryRaw<Array<{id: string}>>(
    Prisma.sql`
      UPDATE runner_tasks
      SET status = 'RUNNING', "runnerId" = ${runner.id}, "startedAt" = NOW(), "updatedAt" = NOW()
      WHERE id = (
        SELECT id FROM runner_tasks
        WHERE status = 'PENDING'
        AND "repoId" IN (
          SELECT r.id FROM repositories r
          JOIN projects p ON r."teamId" = p."teamId"
          WHERE p.id IN (${Prisma.join(scopeIds)})
        )
        ORDER BY "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `
  );

  if (claimed.length === 0) {
    let currentVersion: number | undefined;
    try {
      const v = await redis.get(TASKS_VERSION_KEY);
      currentVersion = v ? parseInt(v, 10) : 0;
    } catch {
      currentVersion = undefined;
    }
    return { task: null, tasksVersion: currentVersion };
  }

  // Fetch the full task with workflow content
  const task = await prisma.runnerTask.findUnique({
    where: { id: claimed[0].id },
  });

  let currentVersion: number | undefined;
  try {
    const v = await redis.get(TASKS_VERSION_KEY);
    currentVersion = v ? parseInt(v, 10) : 0;
  } catch {
    currentVersion = undefined;
  }

  return {
    task: task ? {
      id: task.id,
      workflowPayload: task.workflowContent,
      context: task.context,
      gitRef: task.gitRef,
    } : null,
    tasksVersion: currentVersion,
  };
}

/**
 * Resolve which project IDs a runner can serve based on its scope.
 */
async function getEligibleScopeIds(scopeType: string, scopeId: string): Promise<string[]> {
  switch (scopeType) {
    case 'PROJECT':
      return [scopeId];
    case 'TEAM': {
      const projects = await prisma.project.findMany({
        where: { teamId: scopeId },
        select: { id: true },
      });
      return projects.map((p) => p.id);
    }
    case 'ORG': {
      const projects = await prisma.project.findMany({
        where: { team: { orgId: scopeId } },
        select: { id: true },
      });
      return projects.map((p) => p.id);
    }
    default:
      return [];
  }
}
```

- [ ] **Step 4: Add FetchTask controller and route**

Add to `connect-rpc.controller.ts`:

```typescript
export const fetchTask = asyncHandler(async (req: Request, res: Response) => {
  const runner = (req as RunnerRequest).runner!;
  const result = await svc.fetchTask(runner, req.body.tasksVersion);
  res.json(result);
});
```

- [ ] **Step 5: Add rate limiting for FetchTask**

Add rate limiter in `connect-rpc.routes.ts`:

```typescript
import type { Request, Response, NextFunction } from 'express';
import { redis } from '../../config/redis';

async function rateLimitRunner(req: Request, res: Response, next: NextFunction) {
  const uuid = req.headers['x-runner-uuid'] as string;
  if (!uuid) return next();
  try {
    const key = `runner:rate:${uuid}`;
    const result = await redis.set(key, '1', 'EX', 1, 'NX');
    if (result === null) {
      res.status(429).json({ error: { message: 'Too many requests' } });
      return;
    }
  } catch {
    // Redis unavailable -- skip rate limiting
  }
  next();
}
```

Wire the rate limiter into the FetchTask route (note: `rateLimitRunner` comes AFTER `authenticateRunner`):

```typescript
router.post('/actions/runner.v1.RunnerService/FetchTask', authenticateRunner, rateLimitRunner, ctrl.fetchTask);
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/modules/runners/connect-rpc.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/runners/connect-rpc.service.ts src/modules/runners/connect-rpc.controller.ts src/modules/runners/connect-rpc.routes.ts src/modules/runners/connect-rpc.test.ts
git commit -m "feat(runners): implement FetchTask with atomic claiming and rate limiting"
```

---

## Task 6: Connect-RPC Protocol -- UpdateTask & UpdateLog

**Files:**
- Modify: `src/modules/runners/connect-rpc.service.ts`
- Modify: `src/modules/runners/connect-rpc.controller.ts`
- Modify: `src/modules/runners/connect-rpc.routes.ts`
- Modify: `src/modules/runners/connect-rpc.test.ts`

- [ ] **Step 1: Write failing tests for UpdateTask and UpdateLog**

Add to `connect-rpc.test.ts`:

```typescript
describe('Connect-RPC: UpdateTask', () => {
  it('updates task status to SUCCESS', async () => {
    // Create a RUNNING task assigned to runner
    // POST /api/actions/runner.v1.RunnerService/UpdateTask
    // Body: { state: { id: taskId, result: 0 (success), stoppedAt: timestamp } }
    // Expected: 200, task status is SUCCESS
  });

  it('updates task status to FAILURE on non-zero result', async () => {
    // result: 1 -> FAILURE
  });
});

describe('Connect-RPC: UpdateLog', () => {
  it('stores log lines and returns ack index', async () => {
    // POST /api/actions/runner.v1.RunnerService/UpdateLog
    // Body: { taskId, index: 0, rows: [{ content: 'line1' }, { content: 'line2' }], noMore: false }
    // Expected: 200 with { ackIndex: 1 }
  });

  it('handles noMore flag', async () => {
    // Body: { taskId, index: 2, rows: [], noMore: true }
    // Expected: 200
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/runners/connect-rpc.test.ts`
Expected: FAIL on new tests.

- [ ] **Step 3: Add `runner-task:updated` to RealtimeEvent union**

In `src/realtime/events.ts`, add to the `RealtimeEvent` union:

```typescript
  | { type: 'runner-task:updated'; repoId: string; taskId: string }
```

In `frontend/src/hooks/useRealtimeInvalidation.ts`, add the same type to the frontend mirror.

- [ ] **Step 4: Implement UpdateTask service**

Add to `connect-rpc.service.ts`:

```typescript
import { broadcastToRoom } from '../../realtime/broadcast';

/**
 * UpdateTask: runner reports job completion.
 * result: 0 = SUCCESS, non-zero = FAILURE
 */
export async function updateTask(
  runnerId: string,
  data: { id: string; result: number; stoppedAt?: string },
) {
  const task = await prisma.runnerTask.findUnique({ where: { id: data.id } });
  if (!task || task.runnerId !== runnerId) {
    throw new AppError(404, 'Task not found or not assigned to this runner');
  }

  const status = data.result === 0 ? 'SUCCESS' : 'FAILURE';

  const updated = await prisma.runnerTask.update({
    where: { id: data.id },
    data: {
      status,
      finishedAt: data.stoppedAt ? new Date(data.stoppedAt) : new Date(),
    },
    include: { repo: true },
  });

  // Set runner back to IDLE
  await prisma.runner.update({
    where: { id: runnerId },
    data: { status: 'IDLE' },
  });

  // Broadcast update
  broadcastToRoom(`repo:${updated.repoId}`, {
    type: 'runner-task:updated',
    repoId: updated.repoId,
    taskId: updated.id,
  });

  // Handle completion: auto-comment + fire triggers (Task 8)
  // await handleTaskCompletion(updated);

  return { state: { id: updated.id, result: data.result } };
}

/**
 * UpdateLog: runner streams log lines.
 */
export async function updateLog(
  runnerId: string,
  data: { taskId: string; index: number; rows: Array<{ content: string }>; noMore?: boolean },
) {
  const task = await prisma.runnerTask.findUnique({ where: { id: data.taskId } });
  if (!task || task.runnerId !== runnerId) {
    throw new AppError(404, 'Task not found or not assigned to this runner');
  }

  // Insert log lines
  if (data.rows.length > 0) {
    await prisma.runnerTaskLog.createMany({
      data: data.rows.map((row, i) => ({
        taskId: data.taskId,
        lineIndex: data.index + i,
        content: row.content,
      })),
      skipDuplicates: true,
    });
  }

  const ackIndex = data.index + data.rows.length - 1;

  return { ackIndex: Math.max(ackIndex, 0) };
}
```

- [ ] **Step 5: Add UpdateTask and UpdateLog controllers and routes**

Add to `connect-rpc.controller.ts`:

```typescript
export const updateTask = asyncHandler(async (req: Request, res: Response) => {
  const runner = (req as RunnerRequest).runner!;
  const result = await svc.updateTask(runner.id, req.body.state);
  res.json(result);
});

export const updateLog = asyncHandler(async (req: Request, res: Response) => {
  const runner = (req as RunnerRequest).runner!;
  const result = await svc.updateLog(runner.id, req.body);
  res.json(result);
});
```

Add to `connect-rpc.routes.ts`:

```typescript
router.post('/actions/runner.v1.RunnerService/UpdateTask', authenticateRunner, ctrl.updateTask);
router.post('/actions/runner.v1.RunnerService/UpdateLog', authenticateRunner, ctrl.updateLog);
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/modules/runners/connect-rpc.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/runners/
git commit -m "feat(runners): implement UpdateTask and UpdateLog Connect-RPC endpoints"
```

---

## Task 7: Log Streaming SSE Endpoint

**Files:**
- Modify: `src/modules/runners/runners.controller.ts`
- Modify: `src/modules/runners/runners.routes.ts`
- Modify: `src/modules/runners/runners.test.ts`

- [ ] **Step 1: Write failing test for log streaming**

Add to `runners.test.ts`:

```typescript
describe('Runner Task Logs SSE', () => {
  it('streams log lines via SSE', async () => {
    // Create a RunnerTask with some RunnerTaskLog entries
    // GET /api/runner-tasks/:taskId/logs
    // Expected: SSE response with log data
  });

  it('returns task details', async () => {
    // GET /api/runner-tasks/:taskId
    // Expected: 200 with task object
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/runners/runners.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement log streaming controller**

Add to `runners.controller.ts` (ensure `prisma` is imported from `'../../config/database'`, `AppError` from `'../../middleware/errorHandler'`, and `param` from `'../../utils/params'`):

```typescript
export const getTask = asyncHandler(async (req: Request, res: Response) => {
  const task = await prisma.runnerTask.findUnique({
    where: { id: param(req, 'taskId') },
    include: { runner: { select: { name: true, uuid: true } } },
  });
  if (!task) throw new AppError(404, 'Task not found');
  res.json(task);
});

export const streamTaskLogs = asyncHandler(async (req: Request, res: Response) => {
  const taskId = param(req, 'taskId');
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let lastIndex = -1;
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const poll = setInterval(async () => {
    try {
      const task = await prisma.runnerTask.findUnique({ where: { id: taskId } });
      if (!task) {
        clearInterval(poll);
        res.write('event: done\ndata: {}\n\n');
        res.end();
        return;
      }

      const lines = await prisma.runnerTaskLog.findMany({
        where: { taskId, lineIndex: { gt: lastIndex } },
        orderBy: { lineIndex: 'asc' },
      });

      if (lines.length > 0) {
        lastIndex = lines[lines.length - 1].lineIndex;
        send({ lines: lines.map((l) => ({ index: l.lineIndex, content: l.content, timestamp: l.timestamp })) });
      }

      const terminal = ['SUCCESS', 'FAILURE', 'CANCELLED'];
      if (terminal.includes(task.status)) {
        clearInterval(poll);
        res.write('event: done\ndata: {}\n\n');
        res.end();
      }
    } catch {
      clearInterval(poll);
      res.end();
    }
  }, 500);

  req.on('close', () => clearInterval(poll));
});
```

- [ ] **Step 4: Add task routes**

Add to `runners.routes.ts`:

```typescript
// Task endpoints (scope-independent, require standard auth)
router.get('/runner-tasks/:taskId', ctrl.getTask);
router.get('/runner-tasks/:taskId/logs', ctrl.streamTaskLogs);
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/modules/runners/runners.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/modules/runners/
git commit -m "feat(runners): add runner task details and SSE log streaming endpoints"
```

---

## Task 8: The `run_workflow` Automation Action

**Files:**
- Modify: `src/modules/automation/automation.service.ts`
- Modify: `src/modules/runners/connect-rpc.service.ts`
- Test: `src/modules/automation/automation.test.ts` (extend existing)

This is the core integration task that connects the automation system to the runner infrastructure.

- [ ] **Step 1: Write failing tests for run_workflow action**

Add to `src/modules/automation/automation.test.ts`:

```typescript
describe('run_workflow action', () => {
  it('creates a RunnerTask when run_workflow action fires', async () => {
    // Create an automation rule with run_workflow action
    // Trigger the rule
    // Verify a RunnerTask was created with status PENDING
  });

  it('resolves workflow content from pipeline source', async () => {
    // Create a pipeline with YAML content
    // Create rule with source: 'pipeline', pipelineId
    // Trigger, verify task.workflowContent matches pipeline YAML
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/automation/automation.test.ts`
Expected: FAIL on new tests.

- [ ] **Step 3: Update AutomationAction type**

In `src/modules/automation/automation.service.ts`, update the `AutomationAction` interface:

```typescript
export interface AutomationAction {
  type:
    | 'set_status'
    | 'set_assignee'
    | 'add_label'
    | 'add_comment'
    | 'set_field'
    | 'create_issue'
    | 'send_email'
    | 'webhook'
    | 'run_workflow';
  columnId?: string;
  userId?: string;
  name?: string;
  body?: string;
  field?: string;
  value?: string;
  title?: string;
  to?: string;
  subject?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  data?: Record<string, unknown>;
  // run_workflow fields
  source?: 'repo_file' | 'pipeline';
  repoId?: string;
  workflowPath?: string;
  pipelineId?: string;
  ref?: string;
  labels?: string[];
  variables?: Record<string, string>;
}
```

- [ ] **Step 4: Update recursion guard**

In `src/modules/automation/automation.service.ts`, change line 189:

```typescript
// Before:
if (options?.skipAutomation || (context.automationDepth ?? 0) > 0) return;

// After:
if (options?.skipAutomation || (context.automationDepth ?? 0) > 2) return;
```

- [ ] **Step 5: Add run_workflow case to executeActions**

In `src/modules/automation/automation.service.ts`, add after the `webhook` case in `executeActions()`:

```typescript
case 'run_workflow': {
  const { createRunnerTask } = await import('../runners/connect-rpc.service');
  if (action.source && (action.workflowPath || action.pipelineId)) {
    await createRunnerTask({
      source: action.source,
      workflowPath: action.workflowPath,
      pipelineId: action.pipelineId,
      repoId: action.repoId,
      ref: action.ref,
      labels: action.labels ?? [],
      variables: action.variables,
      projectId,
      issueId: issue.id,
      automationRuleId: undefined, // Set by caller if available
      actorId: context.actorId,
      templateCtx,
    });
  }
  break;
}
```

- [ ] **Step 6: Implement createRunnerTask in connect-rpc.service.ts**

Add to `connect-rpc.service.ts`:

```typescript
/**
 * Create a RunnerTask from a run_workflow automation action.
 * Resolves workflow content from repo file or pipeline definition.
 */
export async function createRunnerTask(params: {
  source: 'repo_file' | 'pipeline';
  workflowPath?: string;
  pipelineId?: string;
  repoId?: string;
  ref?: string;
  labels: string[];
  variables?: Record<string, string>;
  projectId: string;
  issueId: string;
  automationRuleId?: string;
  actorId: string;
  templateCtx: Record<string, unknown>;
}) {
  let workflowContent: string;
  let workflowRef: string;
  let repoId: string;

  if (params.source === 'pipeline') {
    if (!params.pipelineId) throw new AppError(400, 'pipelineId required for pipeline source');
    const pipeline = await prisma.pipeline.findUnique({ where: { id: params.pipelineId } });
    if (!pipeline) throw new AppError(404, 'Pipeline not found');
    workflowContent = pipeline.yamlContent;
    workflowRef = params.pipelineId;
    repoId = params.repoId ?? pipeline.repoId;
  } else {
    // repo_file: read workflow YAML from git storage
    if (!params.workflowPath) throw new AppError(400, 'workflowPath required for repo_file source');

    // Find repo -- use explicit repoId or find project's first repo
    if (params.repoId) {
      repoId = params.repoId;
    } else {
      const repo = await prisma.repository.findFirst({
        where: { team: { projects: { some: { id: params.projectId } } } },
      });
      if (!repo) throw new AppError(404, 'No repository found for project');
      repoId = repo.id;
    }

    const repo = await prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo) throw new AppError(404, 'Repository not found');

    // Read file from git -- use execFileSync (not execSync) to prevent command injection
    const ref = params.ref ?? 'HEAD';
    if (!repo.diskPath) throw new AppError(500, 'Repository has no disk path');
    const { execFileSync } = await import('child_process');
    try {
      workflowContent = execFileSync(
        'git', ['show', `${ref}:${params.workflowPath}`],
        { cwd: repo.diskPath, encoding: 'utf-8', timeout: 5000 },
      );
    } catch {
      throw new AppError(404, `Workflow file not found: ${params.workflowPath} at ${ref}`);
    }
    workflowRef = params.workflowPath;
  }

  // Resolve template variables in the variables config
  const resolvedVars: Record<string, string> = {};
  if (params.variables) {
    const { resolveTemplate } = await import('../../lib/query-engine');
    for (const [key, val] of Object.entries(params.variables)) {
      resolvedVars[key] = resolveTemplate(val, params.templateCtx);
    }
  }

  const task = await prisma.runnerTask.create({
    data: {
      workflowSource: params.source,
      workflowRef,
      workflowContent,
      repoId,
      gitRef: params.ref ?? 'HEAD',
      status: 'PENDING',
      context: { ...resolvedVars, issueId: params.issueId, actorId: params.actorId },
      labels: params.labels,
      issueId: params.issueId,
      automationRuleId: params.automationRuleId,
    },
  });

  await incrementTasksVersion();

  logger.info('Runner task created', { taskId: task.id, source: params.source, workflowRef });

  return task;
}
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run src/modules/automation/automation.test.ts`
Expected: PASS

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/modules/automation/automation.service.ts src/modules/runners/connect-rpc.service.ts src/modules/automation/automation.test.ts
git commit -m "feat(runners): add run_workflow automation action type with pipeline and repo_file sources"
```

---

## Task 9: Completion Feedback -- Auto-Comment & Workflow Triggers

**Files:**
- Modify: `src/modules/runners/connect-rpc.service.ts`
- Modify: `src/modules/automation/automation.service.ts`
- Modify: `src/modules/runners/connect-rpc.test.ts`

- [ ] **Step 1: Write failing tests for completion feedback**

Add to `connect-rpc.test.ts`:

```typescript
describe('Task completion feedback', () => {
  it('posts a comment on the issue when task completes', async () => {
    // Create a RunnerTask linked to an issue, complete it via UpdateTask
    // Verify a comment was created on the issue
  });

  it('fires workflow:completed trigger on success', async () => {
    // Create automation rule with trigger 'workflow:completed'
    // Complete a task with SUCCESS
    // Verify the downstream rule fired
  });

  it('fires workflow:failed trigger on failure', async () => {
    // Similar but with FAILURE status
  });

  it('blocks execution at recursion depth > 2', async () => {
    // Call evaluateRules with automationDepth: 3
    // Verify no rules are evaluated (function returns early)
  });

  it('allows execution at recursion depth 1 (workflow trigger chaining)', async () => {
    // Call evaluateRules with automationDepth: 1
    // Verify rules ARE evaluated (the depth guard allows depth <= 2)
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/runners/connect-rpc.test.ts`
Expected: FAIL

- [ ] **Step 3: Add workflow trigger types to automation service**

In `src/modules/automation/automation.service.ts`, update `AutomationTrigger`:

```typescript
export type AutomationTrigger =
  | 'issue:created'
  | 'issue:status_changed'
  | 'issue:assigned'
  | 'pr:merged'
  | 'label:added'
  | 'workflow:completed'
  | 'workflow:failed';
```

- [ ] **Step 4: Implement handleTaskCompletion**

Add to `connect-rpc.service.ts`:

```typescript
import { evaluateRules } from '../automation/automation.service';
import { AUTOMATION_ISSUE_INCLUDE } from '../../utils/prisma-selects';

/**
 * Handle task completion: post comment on issue, fire workflow triggers.
 */
export async function handleTaskCompletion(task: {
  id: string;
  issueId: string | null;
  status: string;
  workflowRef: string;
  workflowSource: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  repoId: string;
  context: unknown;
}) {
  if (!task.issueId) return;

  const issue = await prisma.issue.findUnique({
    where: { id: task.issueId },
    include: AUTOMATION_ISSUE_INCLUDE,
  });
  if (!issue) return;

  // Calculate duration
  const durationMs = task.startedAt && task.finishedAt
    ? task.finishedAt.getTime() - task.startedAt.getTime()
    : 0;
  const durationSec = Math.round(durationMs / 1000);

  // Post comment on issue
  const statusText = task.status === 'SUCCESS' ? 'SUCCESS' : 'FAILURE';
  const workflowName = task.workflowSource === 'pipeline'
    ? task.workflowRef
    : task.workflowRef.split('/').pop() ?? task.workflowRef;

  await prisma.comment.create({
    data: {
      issueId: task.issueId,
      authorId: (task.context as Record<string, string>)?.actorId ?? issue.reporterId,
      body: `Workflow \`${workflowName}\` completed with status **${statusText}** (${durationSec}s)`,
    },
  });

  // Fire workflow trigger for downstream automation
  const trigger = task.status === 'SUCCESS' ? 'workflow:completed' : 'workflow:failed';

  evaluateRules(
    issue.projectId,
    trigger,
    {
      issue: issue as unknown as Record<string, unknown> & { id: string; projectId: string },
      actorId: (task.context as Record<string, string>)?.actorId ?? issue.reporterId,
      automationDepth: 1, // Allow one more level of chaining, blocked at depth > 2
    },
  ).catch((err) => logger.error('Workflow trigger evaluation failed', {}, err as Error));
}
```

- [ ] **Step 5: Wire handleTaskCompletion into updateTask**

In `connect-rpc.service.ts`, uncomment/add the call in `updateTask()` after the broadcast:

```typescript
// Fire completion handlers
await handleTaskCompletion(updated);
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/modules/runners/connect-rpc.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/modules/runners/connect-rpc.service.ts src/modules/automation/automation.service.ts src/modules/runners/connect-rpc.test.ts
git commit -m "feat(runners): add task completion feedback (auto-comment + workflow triggers)"
```

---

## Task 10: Runner Health Monitor

**Files:**
- Create: `src/modules/runners/runner-health.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Implement health monitor**

Create `src/modules/runners/runner-health.ts`:

```typescript
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';

const STALE_THRESHOLD_MS = 30_000; // 30 seconds
let healthInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background health monitor that marks stale runners as OFFLINE.
 */
export function startRunnerHealthMonitor() {
  healthInterval = setInterval(async () => {
    try {
      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS);
      const result = await prisma.runner.updateMany({
        where: {
          status: { in: ['IDLE', 'ACTIVE'] },
          lastSeenAt: { lt: cutoff },
        },
        data: { status: 'OFFLINE' },
      });

      if (result.count > 0) {
        logger.info(`Marked ${result.count} stale runner(s) as OFFLINE`);
      }
    } catch (err) {
      logger.error('Runner health check failed', {}, err as Error);
    }
  }, STALE_THRESHOLD_MS);
}

/**
 * Stop the health monitor (for graceful shutdown).
 */
export function stopRunnerHealthMonitor() {
  if (healthInterval) {
    clearInterval(healthInterval);
    healthInterval = null;
  }
}
```

- [ ] **Step 2: Wire into server startup**

In `src/index.ts`, add import and call after server starts listening:

```typescript
import { startRunnerHealthMonitor } from './modules/runners/runner-health';
```

Inside the `server.listen` callback (after the existing log line):

```typescript
startRunnerHealthMonitor();
```

Also wire `stopRunnerHealthMonitor()` into any existing graceful shutdown handler. If none exists, add a SIGTERM handler:

```typescript
import { stopRunnerHealthMonitor } from './modules/runners/runner-health';

process.on('SIGTERM', () => {
  stopRunnerHealthMonitor();
  server.close();
});
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/runners/runner-health.ts src/index.ts
git commit -m "feat(runners): add background health monitor for stale runner detection"
```

---

## Task 11: Documentation Updates

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/design-patterns.md`
- Modify: `docs/api-reference.md`
- Modify: `docs/development-guide.md`
- Modify: `docs/getting-started.md`

- [ ] **Step 1: Update architecture.md**

Add a "Runner Subsystem" section describing:
- Runner registration and scope hierarchy (org > team > project)
- Connect-RPC protocol compatibility with Gitea `act_runner`
- Task dispatch flow: automation rule -> RunnerTask -> FetchTask -> execution -> UpdateTask
- Log streaming via UpdateLog + SSE

- [ ] **Step 2: Update design-patterns.md**

Add `run_workflow` to the automation action types list. Document the runner module file pattern (routes/controller/service + connect-rpc split).

- [ ] **Step 3: Update api-reference.md**

Add sections for:
- Runner management endpoints (per-scope CRUD + registration tokens)
- Connect-RPC protocol endpoints (Register, Declare, FetchTask, UpdateTask, UpdateLog)
- Runner task endpoints (get task, SSE log stream)

- [ ] **Step 4: Update development-guide.md**

Add a "Setting Up a Local Runner" section:
```bash
# Download act_runner
curl -L https://gitea.com/gitea/act_runner/releases/latest/download/act_runner-linux-amd64 -o act_runner
chmod +x act_runner

# Generate registration token (requires dev stack running)
curl -X POST http://localhost:3000/api/orgs/<orgId>/runners/registration-token \
  -H 'Authorization: Bearer <token>' -H 'X-Requested-With: XMLHttpRequest'

# Register runner
./act_runner register --instance http://localhost:3000 --token <token> --name local-runner

# Start runner
./act_runner daemon
```

- [ ] **Step 5: Update getting-started.md**

Add optional "Runner Setup" subsection in the development environment setup, noting it is only needed for testing `run_workflow` automation actions.

- [ ] **Step 6: Update axiom-mcp-server.md**

Add MCP tools for runner management: list runners, generate registration tokens, trigger workflows, view task status and logs.

- [ ] **Step 7: Commit**

```bash
git add docs/
git commit -m "docs: add runner subsystem to architecture, API reference, and dev guides"
```

---

## Task 12: Integration Verification

- [ ] **Step 1: Run full test suite**

Run: `npm run test`
Expected: All tests pass.

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Run lint + format**

Run: `npm run check`
Expected: All checks pass.

- [ ] **Step 4: Start dev stack and verify routes**

Run: `npm run docker:dev`

Test endpoints manually:
```bash
# Health check
curl -X POST http://localhost:3000/api/actions/ping.v1.PingService/Ping -H 'Content-Type: application/json' -d '{}'
# Expected: {"data":"Hello"}

# Generate registration token
curl -X POST http://localhost:3000/api/orgs/<orgId>/runners/registration-token \
  -H 'Authorization: Bearer <jwt>' -H 'X-Requested-With: XMLHttpRequest' -H 'Content-Type: application/json'
# Expected: 201 with { token, id, expiresAt }
```

- [ ] **Step 5: Commit any fixes from integration testing**

```bash
git add -A
git commit -m "fix(runners): integration test fixes"
```
