# Runner Support: `run_workflow` Automation Action with Gitea-Compatible Runners

**Date:** 2026-04-04
**Status:** Draft
**Scope:** New automation action type, Gitea-compatible runner protocol, log streaming, result feedback

---

## 1. Problem

Axiom's automation system supports 8 action types that modify issue state or send notifications. There is no way to trigger external compute -- deploying code, running tests, or executing arbitrary workflows -- in response to issue events.

The existing pipeline system executes workflows as local subprocesses on the Axiom server, which does not scale and cannot leverage container-based execution environments.

## 2. Goal

Add a 9th automation action type (`run_workflow`) that dispatches workflow jobs to external runners compatible with the Gitea Actions runner protocol (`act_runner`). This gives Axiom access to the entire Gitea runner ecosystem (Docker, LXC, host executors) without building a custom runner.

## 3. Non-Goals

- Replacing the existing subprocess-based pipeline runner (it continues to work for simple cases)
- Implementing GitHub Actions marketplace/action resolution (runners handle this via `nektos/act`)
- Scheduled/cron-triggered workflows (future work)
- Matrix strategies or reusable workflow composition

---

## 4. Architecture Overview

```
Automation Rule fires "run_workflow" action
        |
        v
+------------------+
| RunnerTask queue  |  (DB + Redis version counter)
+------------------+
        |
        v  (FetchTask polling)
+------------------+
| act_runner       |  (external, Gitea-compatible)
| (Docker/LXC/host)|
+------------------+
        |
        v  (UpdateTask + UpdateLog)
+------------------+
| Result handler   |  --> comment on issue
|                  |  --> fire workflow:completed / workflow:failed trigger
+------------------+
```

**Data flow:**
1. Automation rule evaluates conditions, fires `run_workflow` action
2. Axiom resolves workflow content (from repo file or pipeline definition)
3. Creates `RunnerTask` record (PENDING), increments Redis `tasks_version`
4. Runner polls `FetchTask`, receives task with workflow YAML + context
5. Runner executes workflow, streams logs via `UpdateLog`, reports status via `UpdateTask`
6. On completion: Axiom posts summary comment on triggering issue, fires `workflow:completed` or `workflow:failed` trigger for downstream automation rules

---

## 5. Database Schema

### 5.1 Runner

```prisma
model Runner {
  id           String       @id @default(cuid())
  uuid         String       @unique
  name         String
  tokenHash    String
  status       RunnerStatus @default(IDLE)
  labels       Json         @default("[]")   // string[]
  version      String       @default("")
  lastSeenAt   DateTime?
  scopeType    RunnerScope                    // ORG, TEAM, PROJECT
  scopeId      String                         // orgId, teamId, or projectId
  tasks        RunnerTask[]
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  @@index([scopeType, scopeId])
  @@index([status])
  @@map("runners")
}

enum RunnerStatus {
  OFFLINE
  IDLE
  ACTIVE
}
// OFFLINE: not seen in 30s. IDLE: declared/registered and polling, no active task. ACTIVE: currently executing a task.

enum RunnerScope {
  ORG
  TEAM
  PROJECT
}
```

### 5.2 RunnerRegistrationToken

```prisma
model RunnerRegistrationToken {
  id        String      @id @default(cuid())
  tokenHash String      @unique
  scopeType RunnerScope
  scopeId   String
  usedBy    String?                          // runnerId if consumed
  expiresAt DateTime
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  @@index([scopeType, scopeId])
  @@map("runner_registration_tokens")
}
```

### 5.3 RunnerTask

```prisma
model RunnerTask {
  id               String          @id @default(cuid())
  runnerId         String?
  runner           Runner?         @relation(fields: [runnerId], references: [id])
  automationRuleId String?
  automationRule   AutomationRule? @relation(fields: [automationRuleId], references: [id], onDelete: SetNull)
  issueId          String?
  issue            Issue?          @relation(fields: [issueId], references: [id])
  workflowSource   String                    // 'repo_file' | 'pipeline'
  workflowRef      String                    // file path or pipelineId
  workflowContent  String                    // resolved YAML content
  repoId           String
  repo             Repository      @relation(fields: [repoId], references: [id], onDelete: Cascade)
  gitRef           String          @default("HEAD")
  status           RunStatus       @default(PENDING)
  context          Json            @default("{}")  // template vars, issue data
  labels           Json            @default("[]") // required runner labels
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

### 5.4 RunnerTaskLog

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

---

## 6. Connect-RPC Endpoints (Gitea-Compatible)

All endpoints use JSON codec (`Content-Type: application/json`) over standard HTTP POST. Request/response shapes match Gitea's protobuf definitions so unmodified `act_runner` binaries work out of the box.

### 6.1 Route Prefix

```
/api/actions/runner.v1.RunnerService/*
/api/actions/ping.v1.PingService/Ping
```

### 6.2 Methods

| Method | Auth | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| `Ping` | None | `{}` | `{ data: "Hello" }` | Health check |
| `Register` | Registration token via body | `{ name, token, labels, version }` | `{ runner: { uuid, token, name } }` | One-time registration |
| `Declare` | Runner token | `{ version, labels }` | `{ runner: { uuid, name, status } }` | Announce capabilities on startup |
| `FetchTask` | Runner token | `{ tasksVersion }` | `{ task?: { id, workflowPayload, context } }` | Poll for pending work |
| `UpdateTask` | Runner token | `{ state: { id, result, stoppedAt } }` | `{ state: { id, result } }` | Report job/step status |
| `UpdateLog` | Runner token | `{ taskId, index, rows: [...], noMore }` | `{ ackIndex }` | Stream log lines |

### 6.3 Authentication

- **Register:** Body contains a registration token (validated against `RunnerRegistrationToken` table, must be unused and not expired)
- **All other methods:** `X-Runner-UUID` + `X-Runner-Token` headers. Token compared via bcrypt against `Runner.tokenHash`. Returns 401 on mismatch.

### 6.4 Task Version Optimization

- Redis key `runner:tasks_version` (global counter)
- Incremented when a new `RunnerTask` is created with status PENDING
- Runner sends its cached `tasksVersion` in `FetchTask`
- If versions match, server returns empty response immediately (no DB query)
- If versions differ, server queries for PENDING tasks matching runner's scope and labels
- **Redis unavailable fallback:** If Redis is disconnected (the existing Redis config treats it as optional), skip the version check and always query the DB. The version optimization is a performance enhancement, not a correctness requirement.

---

## 7. The `run_workflow` Action Type

### 7.1 Action Config Schema

```typescript
interface RunWorkflowAction {
  type: 'run_workflow'
  source: 'repo_file' | 'pipeline'
  // For repo_file source:
  repoId?: string           // defaults to project's primary repo
  workflowPath?: string     // e.g., '.gitea/workflows/deploy.yml'
  // For pipeline source:
  pipelineId?: string
  // Common:
  ref?: string              // git ref, defaults to repo's default branch
  labels?: string[]         // required runner labels (e.g., ['docker', 'linux-amd64'])
  variables?: Record<string, string>  // extra env vars, supports {{template}} syntax
}
```

### 7.2 Type System Update

The `AutomationAction` type union in `automation.service.ts` must be extended to include `'run_workflow'` as a valid action type. The `RunWorkflowAction` interface above is added to the discriminated union, and a new `case 'run_workflow':` branch is added to the `switch` in `executeActions()`.

### 7.3 Execution Flow

1. Automation `executeActions()` encounters `run_workflow` action
2. **Resolve workflow content:**
   - `repo_file`: read blob from git storage at `ref:workflowPath` using existing git helpers
   - `pipeline`: load `Pipeline.yamlContent` from DB
3. **Resolve template variables** in `variables` config using existing `resolveTemplate()`
4. **Build task context:** issue data, actor, template variables, repo info
5. **Create `RunnerTask`** with status PENDING
6. **Increment** Redis `runner:tasks_version`
7. Return immediately (non-blocking, like other async actions)

### 7.4 Runner Selection (Scope Resolution)

When a task is created for a project, available runners are resolved by walking up the scope hierarchy:

1. PROJECT-scoped runners for the task's project
2. TEAM-scoped runners for the project's team
3. ORG-scoped runners for the team's org

Within each scope level, filter by:
- `status` is IDLE or ACTIVE (runner is connected and polling)
- Runner `labels` contain all required labels from the action config

`FetchTask` returns the oldest PENDING task that the requesting runner is eligible for (based on scope + labels). The task is atomically claimed using a raw SQL `UPDATE ... WHERE status = 'PENDING' RETURNING *` query to prevent double-dispatch. This guarantees that only one runner can claim a given task even under concurrent polling -- if a second runner's UPDATE matches zero rows (because the first runner already flipped status to RUNNING), it receives no task and polls again. Prisma's `$queryRaw` is used for this single operation; all other queries use the standard Prisma client.

---

## 8. Result Feedback

### 8.1 Auto-Comment on Issue

When a `RunnerTask` reaches a terminal status (SUCCESS, FAILURE, CANCELLED), post a comment on the linked issue:

```
Workflow `deploy.yml` completed with status **SUCCESS** (12s)
[View logs](/org/team/project/runner-tasks/abc123/logs)
```

Uses existing issue comment creation from `issues.service.ts`. Only posted if `issueId` is set on the task.

### 8.2 New Automation Triggers

Two new trigger types added to `automation.service.ts`:

- `workflow:completed` -- fires when a RunnerTask finishes with SUCCESS
- `workflow:failed` -- fires when a RunnerTask finishes with FAILURE

**Context passed to downstream rules:**

```typescript
{
  issue: { /* full issue with includes */ },
  workflow: {
    name: string,          // workflow file name or pipeline name
    status: 'SUCCESS' | 'FAILURE',
    duration: number,      // seconds
    runnerLabels: string[],
    taskId: string,
  },
  actor: { /* user who created the automation rule */ }
}
```

This enables chaining: "when deploy workflow fails, set status to Blocked" or "when test workflow succeeds, move issue to Done."

### 8.3 Recursion Safety

The existing `automationDepth` guard (`depth > 0` returns early) must be updated to support workflow-triggered chaining. The current guard blocks all depth > 0 execution, which would silently prevent `workflow:completed`/`workflow:failed` triggers from firing any downstream rules.

**Required change to `evaluateRules()`:** Increase the recursion limit from `depth > 0` to `depth > 2`. This allows:
- depth 0: original trigger (e.g., `issue:created` fires `run_workflow`)
- depth 1: workflow completion trigger fires downstream rules (e.g., `set_status`)
- depth 2: if a downstream rule triggers another event, one more level is allowed
- depth 3+: blocked to prevent infinite loops

Additionally, `run_workflow` actions are inherently async (the runner executes later), so the depth counter resets naturally between the original trigger and the workflow completion trigger. The workflow completion handler calls `evaluateRules()` with `automationDepth: 1` (not inheriting from the original trigger's depth) to ensure chaining works while still preventing `run_workflow` -> `workflow:completed` -> `run_workflow` infinite loops at depth 2+.

---

## 9. Log Storage & Streaming

### 9.1 Storage

- `UpdateLog` receives batches of log lines with sequential indices
- Lines stored in `RunnerTaskLog` table with `(taskId, lineIndex)` unique constraint
- Server returns `ackIndex` (highest stored index) so runner can resume on reconnect

### 9.2 Streaming Endpoint

```
GET /api/runner-tasks/:taskId/logs
```

- SSE (Server-Sent Events) using existing pattern from pipeline log streaming
- Polls `RunnerTaskLog` table every 500ms for new lines (matches existing pipeline log interval)
- Returns `{ lines: [{ index, content, timestamp }] }`
- Terminates when task reaches terminal status and `noMore` flag was received

### 9.3 Retention

Log lines are cascade-deleted when the `RunnerTask` is deleted. No automatic retention policy in this iteration (future work).

---

## 10. Runner Management

### 10.1 Admin API Endpoints

Routes follow existing codebase URL conventions with explicit resource paths per scope:

```
# Org-scoped runners
POST   /api/orgs/:orgId/runners/registration-token           -- generate token (1hr expiry)
GET    /api/orgs/:orgId/runners                              -- list runners
GET    /api/orgs/:orgId/runners/:runnerId                    -- runner details
DELETE /api/orgs/:orgId/runners/:runnerId                    -- remove runner

# Team-scoped runners
POST   /api/teams/:teamId/runners/registration-token         -- generate token
GET    /api/teams/:teamId/runners                            -- list runners
GET    /api/teams/:teamId/runners/:runnerId                  -- runner details
DELETE /api/teams/:teamId/runners/:runnerId                  -- remove runner

# Project-scoped runners
POST   /api/projects/:projectId/runners/registration-token   -- generate token
GET    /api/projects/:projectId/runners                      -- list runners
GET    /api/projects/:projectId/runners/:runnerId            -- runner details
DELETE /api/projects/:projectId/runners/:runnerId            -- remove runner

# Task endpoints (scope-independent)
GET    /api/runner-tasks/:taskId                             -- task details
GET    /api/runner-tasks/:taskId/logs                        -- log stream (SSE)
```

A shared `runners.service.ts` handles the logic; each scope's controller resolves the scopeType/scopeId from the route params before calling the service.

### 10.2 Runner Health

- `lastSeenAt` updated on every `FetchTask`/`Declare` call
- Background job (setInterval, 30s) marks runners as OFFLINE if `lastSeenAt` > 30s ago
- Status transitions: OFFLINE -> IDLE (on Register/Declare) -> ACTIVE (task claimed) -> IDLE (task complete) -> OFFLINE (30s no contact)

### 10.3 Admin UI Pages

Runner management at each scope:
- **Org settings:** `/:org/settings/runners` -- org-level runners + registration tokens
- **Team settings:** `/:org/:team/settings/runners` -- team-level runners
- **Project settings:** `/:org/:team/:project/settings/runners` -- project-level runners

Each page shows: runner name, status indicator, labels, last seen, current task (if any), and a button to generate registration tokens.

---

## 11. Security

| Concern | Mitigation |
|---------|------------|
| Registration token theft | Tokens are single-use, expire in 1 hour, scoped to org/team/project |
| Runner token storage | Stored as bcrypt hash, never logged or returned after registration |
| Workflow content injection | Workflow YAML read from git storage or pipeline DB record, not from user input at dispatch time |
| Task context data leakage | Context includes only safe issue fields (title, number, labels, assignee display name), no internal secrets |
| Polling abuse | Rate limit `FetchTask` to max 1 request/second per runner via Redis `SET runner:rate:{uuid} 1 EX 1 NX` (simple key-expiry approach; returns null if key exists = rate limited). Falls back to no rate limiting if Redis is unavailable. |
| Scope escalation | Runners can only claim tasks within their registered scope (enforced in FetchTask query) |
| Log injection | Log lines stored as plain text, HTML-escaped on frontend render |

---

## 12. Documentation Updates

The following existing docs must be updated as part of this work:

| Document | Changes |
|----------|---------|
| `docs/architecture.md` | Add runner subsystem to system diagram, describe runner protocol and scope hierarchy |
| `docs/design-patterns.md` | Add `run_workflow` action to automation action types, document runner module pattern |
| `docs/api-reference.md` | Add runner management endpoints, Connect-RPC endpoint summary, SSE log endpoint |
| `docs/axiom-mcp-server.md` | Add MCP tools for runner management (list runners, trigger workflows, view task status/logs) |
| `docs/development-guide.md` | Add instructions for setting up a local `act_runner` for development/testing |
| `docs/getting-started.md` | Add optional runner setup section for new developers |

---

## 13. Testing Strategy

### 13.1 Backend Unit/Integration Tests

- **Runner registration flow:** token generation, registration, token consumption, duplicate rejection
- **FetchTask dispatch:** scope resolution (project -> team -> org), label matching, atomic claiming, version optimization
- **`run_workflow` action:** repo_file source resolution, pipeline source resolution, template variable resolution, task creation
- **UpdateTask/UpdateLog:** status transitions, log line storage, ack indices, completion triggers
- **Result feedback:** auto-comment creation, `workflow:completed`/`workflow:failed` trigger firing, recursion depth guard

### 13.2 E2E Tests

- Register a mock runner, trigger an automation rule with `run_workflow`, verify task appears in `FetchTask`, simulate execution, verify issue comment and downstream trigger

### 13.3 Manual Testing

- Connect a real `act_runner` binary to local dev stack
- Create automation rule with `run_workflow` action
- Trigger via issue label, verify workflow executes in Docker container
- Verify logs stream in UI, completion comment appears on issue
