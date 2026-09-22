# Axiom Architecture

## Table of Contents

1. [System Overview](#system-overview)
2. [Backend Architecture](#backend-architecture)
3. [Shared Libraries](#shared-libraries)
4. [Database Schema](#database-schema)
5. [Authentication and Authorization](#authentication-and-authorization)
6. [Real-time Architecture](#real-time-architecture)
7. [Git Hosting Architecture](#git-hosting-architecture)
8. [Frontend Architecture](#frontend-architecture)
9. [Caching Strategy](#caching-strategy)
10. [File Storage](#file-storage)
11. [Email](#email)
12. [Error Handling](#error-handling)
13. [Security Model](#security-model)
14. [Development Infrastructure](#development-infrastructure)

---

## System Overview

Axiom is a self-hosted software development platform providing Git hosting, issue tracking, wiki, CI/CD pipelines, and project management. It is built as a monorepo with a Node.js/Express API backend and a React single-page application frontend.

**Key versions:**
- Node.js 25
- Express 5.2
- Prisma 7.5 (with `@prisma/adapter-pg` driver adapter)
- PostgreSQL 16
- Redis 7
- React 19.2
- Vite 8.0
- React Router 7.13
- TanStack Query 5.95
- Zustand 5.0
- TipTap 3.20 (editor)
- Yjs 13.6 (CRDT collaboration)

```mermaid
graph TD
    subgraph Client
        Browser["Browser (React 19 SPA)"]
    end

    subgraph Docker["Docker Compose (dev)"]
        Web["web :7000\nVite / React"]
        API["api :3000\nExpress 5"]
        GitSSH["git-ssh :2222\nssh2, ssh profile"]
        Worker["worker\nEmail queue, runner monitor"]
        Migrate["migrate\nprisma migrate deploy, one-shot"]
        DB["db :5432\nPostgreSQL 16"]
        Redis["redis :6379\nRedis 7"]
        Mail["mailserver :25\nPostfix SMTP"]
    end

    Browser -->|HTTP/WS| Web
    Web -->|HTTP proxy| API
    API -->|Prisma + pg pool| DB
    API -->|ioredis| Redis
    API -->|nodemailer| Mail
    API -->|"spawn git-upload-pack\ngit-receive-pack"| BareRepos[".data/repos\nBare Git repos"]
    GitSSH -->|"SSH :2222"| BareRepos
    Worker -->|Prisma + pg pool| DB
    Worker -->|ioredis| Redis
    Migrate -->|Prisma + pg pool| DB
```

### Containers

One image, one codebase. Each container runs a different entry point.

| Service | Entry point | Volumes | Ports | Role |
|---|---|---|---|---|
| `migrate` | `node dist/migrate.js` (one-shot) | `git_repos` | none | Runs `prisma migrate deploy`, then reinstalls the post-receive hook in every repository. Exits 0. |
| `api` | `node dist/index.js` | `git_repos`, `uploads` | internal 3000 | REST, WebSocket, git smart HTTP, MCP, internal hook endpoint. |
| `git-ssh` | `node dist/ssh.js` | `git_repos`, `ssh_host_key` | `${SSH_PORT:-2222}:2222` | SSH git transport only. Runs only with the `ssh` compose profile. |
| `worker` | `node dist/worker.js` | none | none | Email queue consumer, runner health monitor. |
| `web` | nginx | none | `${PORT:-7000}:80` | Frontend, unchanged. |
| `db`, `redis` | images | `pgdata`, `redis_data` | internal | `redis` requires `REDIS_PASSWORD`. |

`api`, `git-ssh`, and `worker` each declare `depends_on: migrate: condition: service_completed_successfully`, so migrations and hook reinstallation finish before any of them start.

---

## Backend Architecture

### Entry Point

`src/index.ts` creates the Express app, registers all middleware and routes, attaches the WebSocket server, and starts the HTTP server. The server only listens when run directly (not when imported by tests).

### Middleware Pipeline

Requests pass through the following middleware in order:

1. `helmet` — sets security-related HTTP headers
2. `cors` — allows configured origins with credentials
3. `morgan` — HTTP request logging (`dev` format in development, `combined` in production)
4. `express.json({ limit: '5mb' })` — JSON body parsing
5. `globalLimiter` — 300 requests/minute per IP (skipped in test env)
6. `authLimiter` — 15 requests/minute on `/api/auth/login`, `/api/auth/refresh`, `/api/auth/register`
7. `csrfGuard` — applied to all `/api/*` routes (see [Security Model](#security-model))
8. `auditMiddleware` — registers a `finish` listener to log mutating API requests to `AuditLog`
9. Route handlers
10. `errorHandler` — global error handler (must be last)

### Module System

All feature code lives under `src/modules/`. Each module follows the pattern:

```
src/modules/<feature>/
  <feature>.routes.ts     # Express Router — mounts at /api/...
  <feature>.controller.ts # Request handlers — delegates to service
  <feature>.service.ts    # Business logic — interacts with Prisma
```

Controllers receive `req`/`res` and call service functions. Services never touch `req`/`res` and throw `AppError` on failure.

**Registered modules (route prefix → module):**

| Prefix | Module |
|--------|--------|
| `/api/auth` | auth |
| `/api/users` | users |
| `/api/orgs` | orgs |
| `/api/teams` | teams |
| `/api/projects` | projects, issues, activity, sprints, custom-fields, workflows, automation, labels, issue-templates, milestones |
| `/api/wiki` | wiki |
| `/api/search` | search |
| `/api/repos` | repos, insights, pulls, protection, webhooks, releases, pipelines, status-checks, code-owners, deployments |
| `/api/attachments` | attachments |
| `/api/notifications` | notifications |
| `/api/saved-filters` | saved-filters |
| `/api/admin` | admin, audit |
| `/api/orgs/:orgId/runners`, `/api/teams/:teamId/runners`, `/api/projects/:projectId/runners` | runners (management) |
| `/api/actions` | runners (Connect-RPC protocol) |
| `/api/runner-tasks` | runner-tasks (task status + log streaming) |
| `/api/internal/hooks` | git post-receive hook handler |
| `/git/*` | smart HTTP git protocol |
| `/api/mcp` | Model Context Protocol SSE endpoint (authenticated) |

### Supporting Infrastructure

- `src/git/` — Git protocol, SSH server, bare repo lifecycle
- `src/realtime/` — WebSocket server, Yjs collaboration
- `src/storage/` — File storage abstraction
- `src/email/` — BullMQ-backed email queue (started only when `SMTP_HOST` is set)
- `src/mcp/` — Model Context Protocol server (loaded dynamically to handle missing SDK gracefully)
- `src/lib/` — Shared cross-cutting libraries (query engine, etc.)
- `src/utils/` — Logger, Pandoc export, param helpers, validation
- `src/config/` — `database.ts` (Prisma), `redis.ts` (ioredis), `env.ts` (typed env vars)

---

## Shared Libraries

### Query Engine (`src/lib/query-engine/`)

The query engine is a reusable text-query compiler used by issue search, automation conditions, and wiki template resolution. It exposes a single structured pipeline:

```
Query string
    │
    ▼
Lexer  (tokenises field:value, operators, quoted strings, parentheses)
    │
    ▼
Parser  (recursive-descent, builds AST nodes: AND / OR / NOT / Comparison / FullText)
    │
    ▼
AST
    │
    ├──► Prisma Compiler  (AST → Prisma WhereInput, used by issue search)
    │
    ├──► Boolean Evaluator  (AST → evaluates against a hydrated object, used by automation conditions)
    │
    └──► Template Resolver  (resolves {{expression}} placeholders in action strings / wiki templates)
```

**Two compiler backends:**

| Backend | Input | Output | Used by |
|---------|-------|--------|---------|
| Prisma compiler | Query AST | `Prisma.IssueWhereInput` | Issue list / search endpoint |
| Boolean evaluator | Query AST + issue object | `true` / `false` | Automation condition matching |

**Field registry:** Each backend registers a set of known field names and their type mappings. Adding support for a new filterable field means registering it in the field registry — the lexer, parser, and AST are unaffected.

**Template expression resolver:** Handles `{{expression}}` substitution in automation action values and wiki page templates. Expressions are evaluated against a typed context object and may reference context properties or built-in functions.

```mermaid
graph TD
    IssueSearch["Issue Search\n/api/projects/:id/issues?q=..."] -->|query string| QE
    AutomationEngine["Automation Engine\nsrc/modules/automation/"] -->|condition string| QE
    WikiTemplates["Wiki Templates\n/api/wiki/templates/:id/resolve"] -->|template body| QE

    subgraph QE["Query Engine (src/lib/query-engine/)"]
        Lexer --> Parser --> AST
        AST --> PrismaCompiler["Prisma Compiler"]
        AST --> BooleanEval["Boolean Evaluator"]
        AST --> TemplateResolver["Template Resolver"]
    end

    PrismaCompiler -->|WhereInput| Prisma["Prisma ORM"]
    BooleanEval -->|true/false| AutomationEngine
    TemplateResolver -->|resolved string| AutomationEngine
    TemplateResolver -->|resolved body| WikiTemplates
```

### Automation Architecture

Automation rules are stored as `AutomationRule` records and evaluated at trigger sites throughout the codebase. The automation module lives in `src/modules/automation/`.

**Condition format:** Rule conditions are stored as query strings in `AutomationRule.condition` (e.g., `status:open AND priority:high`). These strings are compiled by the query engine's boolean evaluator against a hydrated issue object at trigger time. The legacy `AutomationRule.conditions` JSON field is retained for backward-compatibility migration only.

**Trigger sites:** Automation is triggered from issue mutation services (create, update, status change, assignment, label change). Each trigger site:
1. Fetches a fully hydrated issue using the `AUTOMATION_ISSUE_INCLUDE` constant (ensures all relation fields needed by condition evaluation are present)
2. Evaluates each active rule's condition string against the issue object
3. For matching rules, executes each action in order
4. Passes a `skipAutomation` flag on internal mutations to prevent infinite loops

**Action types:**

| Action type | Description |
|-------------|-------------|
| `set_status` | Change issue status to a named column |
| `set_assignee` | Assign or unassign the issue |
| `add_label` | Add a label by name |
| `add_comment` | Post a comment (body supports `{{...}}` templates) |
| `set_field` | Set a custom field value |
| `create_issue` | Create a linked child issue |
| `send_email` | Send an email to a specified address |
| `webhook` | POST a JSON payload to an external URL (SSRF-protected) |
| `run_workflow` | Dispatch a workflow to an external Gitea-compatible runner |

**Template expressions in actions:** Action field values support `{{expression}}` syntax resolved via the template resolver. At execution time the resolver receives an `AutomationTemplateContext` containing the triggering issue and actor.

**SSRF protection:** The `webhook` action validates the target URL against a blocklist of private IP ranges and loopback addresses before dispatching the request.

### Runner Subsystem

The runner subsystem enables Axiom to dispatch workflow tasks to external execution environments via Gitea-compatible `act_runner` instances. Runners register at three scope levels -- organization, team, or project -- and inherit downward (an org-level runner can pick up tasks from any project in that org).

**Protocol:** Runners communicate using a Connect-RPC protocol compatible with Gitea's `act_runner`. Six RPC endpoints handle the full lifecycle:

1. `Ping` -- runner heartbeat
2. `Register` -- exchange a registration token for persistent runner credentials
3. `Declare` -- runner advertises its labels (capabilities)
4. `FetchTask` -- runner polls for available work (atomic claim via database transaction)
5. `UpdateTask` -- runner reports execution progress and final status
6. `UpdateLog` -- runner streams log lines during execution

**Task dispatch flow:** When an automation rule fires a `run_workflow` action, the automation engine creates a `RunnerTask` record in the database. A runner matching the task's scope calls `FetchTask`, which atomically claims the task. During execution the runner streams logs via `UpdateLog` and reports completion via `UpdateTask`. On completion, the system posts an auto-comment on the triggering issue and re-evaluates automation rules against the updated issue state.

**Log streaming:** Logs are stored as `RunnerTaskLog` rows (one per line) and served to the frontend via a Server-Sent Events (SSE) endpoint (`GET /api/runner-tasks/:taskId/logs`). New log lines are pushed in real-time as they arrive from the runner.

**Health monitoring:** A background monitor runs on a configurable interval (default: 60 seconds) and marks runners as `offline` if no heartbeat has been received within the stale threshold (default: 5 minutes). Runners that have been offline beyond the dead threshold (default: 24 hours) are marked as `dead`.

### Template Variables

The `{{expression}}` syntax is shared between automation actions and wiki page templates. The template resolver parses content for `{{...}}` blocks and substitutes each expression against the supplied context.

**Context types:**

| Context | Used by | Available as |
|---------|---------|--------------|
| `AutomationTemplateContext` | Automation actions | `issue`, `actor` |
| `WikiTemplateContext` | Wiki template resolution | `currentUser`, `page` |

**Built-in functions available in all contexts:**

| Function | Returns |
|----------|---------|
| `currentUser()` | Display name of the authenticated user |
| `now()` | Current timestamp (ISO 8601) |
| `empty()` | Empty string (useful for clearing fields) |
| `currentSprint()` | Name of the active sprint in the current project |
| `startOfDay()` | Midnight of the current day (ISO 8601) |
| `startOfWeek()` | Midnight of the current Monday (ISO 8601) |

**Wiki template resolution endpoint:** `POST /api/wiki/templates/:id/resolve` accepts a `WikiTemplateContext` payload and returns the template body with all `{{...}}` expressions substituted. This allows the frontend to preview a resolved template before inserting it into a page.

---

## Database Schema

Axiom uses PostgreSQL 16 via Prisma 7 with the `@prisma/adapter-pg` driver adapter (connection pooling via `pg.Pool`). All IDs are CUIDs.

### Entity Relationship Overview

```mermaid
erDiagram
    User ||--o{ OrgMembership : "belongs to"
    User ||--o{ TeamMembership : "belongs to"
    User ||--o{ ApiToken : has
    User ||--o{ SshKey : has
    User ||--o{ RefreshToken : has

    Organization ||--o{ OrgMembership : has
    Organization ||--o{ Team : has

    Team ||--o{ TeamMembership : has
    Team ||--o{ Repository : owns
    Team ||--o{ Project : owns
    Team ||--o{ WikiSpace : owns

    Project ||--o{ Issue : contains
    Project ||--o{ BoardColumn : has
    Project ||--o{ Sprint : has
    Project ||--o{ Milestone : has
    Project ||--o{ Label : has
    Project ||--o{ CustomFieldDefinition : has

    Issue ||--o{ Comment : has
    Issue ||--o{ IssueLink : "links to"
    Issue ||--o{ IssueBranch : has
    Issue ||--o{ IssueCommit : has
    Issue ||--o{ IssuePullRequest : "linked to"
    Issue }o--|| BoardColumn : "placed in"
    Issue }o--o| Sprint : "assigned to"
    Issue }o--o| Milestone : "assigned to"
    Issue }o--o| Issue : "child of (epic)"

    Repository ||--o{ PullRequest : has
    Repository ||--o{ Pipeline : has
    Repository ||--o{ Release : has
    Repository ||--o{ BranchProtection : has
    Repository ||--o{ Webhook : has
    Repository ||--o{ DeploymentEnvironment : has

    PullRequest ||--o{ PRReview : has
    PullRequest ||--o{ PRComment : has

    Pipeline ||--o{ PipelineRun : has
    PipelineRun ||--o{ PipelineJob : has
    PipelineJob ||--o{ PipelineStep : has

    WikiSpace ||--o{ Page : contains
    Page }o--o| Page : "child of"
    Page ||--o{ PageVersion : has
```

### Schema Groups

**Identity and Auth:** `User`, `ApiToken`, `SshKey`, `RefreshToken`, `PasswordResetToken`, `InviteLink`, `Invitation`

**Organizations and Teams:** `Organization`, `OrgMembership` (roles: OWNER/ADMIN/MEMBER/VIEWER/GUEST), `Team`, `TeamMembership` (roles: ADMIN/MEMBER/VIEWER)

**Repositories:** `Repository` (visibility: PRIVATE/INTERNAL/PUBLIC), `PullRequest`, `PRReview`, `PRComment`, `Webhook`, `WebhookDelivery`, `BranchProtection`, `CommitStatus`

**Projects and Issues:** `Project`, `BoardColumn`, `Issue` (types: TASK/BUG/STORY/EPIC; priorities: CRITICAL/HIGH/MEDIUM/LOW), `Label`, `Comment`, `IssueLink` (types: BLOCKS/IS_BLOCKED_BY/RELATES_TO/DUPLICATES), `IssueCommit`, `IssuePullRequest`, `IssueBranch`, `IssueVote`, `IssueWatcher`, `TimeEntry`

**Planning:** `Sprint`, `Milestone`, `CustomFieldDefinition`, `CustomFieldValue`, `WorkflowRule`, `AutomationRule` (`condition String?` — query string format; `conditions Json?` — deprecated, kept for migration), `SavedFilter`

**Wiki:** `WikiSpace`, `Page`, `PageVersion`, `PageComment`, `PageLabel`, `PageTemplate`

**CI/CD and Deployments:** `Pipeline`, `PipelineRun`, `PipelineJob`, `PipelineStep`, `Release`, `DeploymentEnvironment`, `Deployment`, `EnvironmentVariable`

**Platform:** `Notification`, `NotificationPreference`, `Attachment`, `Activity`, `AuditLog`

---

## Authentication and Authorization

### Authentication Methods

Axiom supports three authentication methods, all resolved in `src/middleware/auth.ts`:

**1. JWT Bearer tokens (browser sessions)**
- Short-lived access tokens signed with `JWT_SECRET`
- `Authorization: Bearer eyJ...`
- Payload: `{ userId: string }`
- Auto-refresh: the frontend API client intercepts 401 responses, calls `POST /api/auth/refresh`, and retries the original request. Concurrent 401s share a single refresh promise to avoid token races.

**2. API tokens (programmatic / git HTTP)**
- Long-lived tokens with the prefix `tk_`, stored as SHA-256 hashes in the `api_tokens` table
- `Authorization: Token tk_...`
- Support optional expiry and scopes (e.g., `["repo:read", "issues:write"]`)
- Git smart HTTP uses HTTP Basic Auth with the API token as the password (username is ignored)

**3. SSH keys (git SSH)**
- Public keys stored with SHA-256 fingerprints in `ssh_keys`
- SSH server authenticates by looking up the fingerprint from the connecting client's public key

### JWT Refresh Flow

```mermaid
sequenceDiagram
    participant Client
    participant API

    Client->>API: GET /api/... (Bearer access_token)
    API-->>Client: 401 Unauthorized
    Client->>API: POST /api/auth/refresh {refreshToken}
    API-->>Client: {accessToken, refreshToken}
    Client->>API: GET /api/... (Bearer new_access_token)
    API-->>Client: 200 OK
```

Refresh tokens are stored as SHA-256 hashes in the `refresh_tokens` table with an expiry date. On logout, the token record is deleted from the database. If refresh fails, `localStorage` is cleared and the user is redirected to `/login`.

### Two-Factor Authentication (TOTP)

Users can enable TOTP 2FA. The TOTP secret is stored on the `User` record (`twoFactorSecret`). When `twoFactorEnabled` is true, the login endpoint returns an error with `code: 'TWO_FACTOR_REQUIRED'` and the client must re-submit with a `twoFactorCode`. The `otplib` library handles TOTP generation and verification.

### Authorization (RBAC)

RBAC is enforced at the route level via middleware in `src/middleware/rbac.ts` and `src/middleware/requireProjectAccess.ts`. The permission model has two levels:

**Org-level roles:** OWNER > ADMIN > MEMBER > VIEWER > GUEST

**Team-level roles:** ADMIN > MEMBER > VIEWER

Org-level admins and owners bypass team-level checks — they have implicit permission on all teams in their org. The `requireTeamPermission(action)` middleware checks team membership first, then falls back to the org role.

The `hasPermission(orgRole, teamRole, action)` and `hasOrgPermission(orgRole, action)` utilities in `src/utils/permissions.ts` define the permission matrix.

Platform admins (`User.isAdmin = true`) bypass all RBAC checks.

---

## Real-time Architecture

Axiom uses two WebSocket servers attached to the same HTTP server instance, routed during the HTTP upgrade event by URL path.

```mermaid
graph LR
    Client -->|"WS /ws?token=JWT"| MainWS["Main WS Server\nsrc/realtime/ws-server.ts"]
    Client -->|"WS /ws/wiki/{pageId}?token=JWT"| CollabWS["Collaboration WS Server\nsrc/realtime/collaboration.ts"]

    MainWS --> Rooms["Room subscriptions\nuser:{id}, project:{id}, repo:{id}"]
    CollabWS --> YjsDocs["In-memory Y.Doc per page\n+ PostgreSQL persistence"]
```

### Main WebSocket Server (`/ws`)

- Authenticates via JWT from `?token=` query param or `Authorization: Bearer` header
- Each connection maintains a `Set<string>` of subscribed room names
- On connect, auto-subscribes to `user:{userId}`
- Clients send `{ type: 'subscribe', rooms: [...] }` and `{ type: 'unsubscribe', rooms: [...] }` messages
- Server broadcasts `RealtimeEvent` payloads to all clients subscribed to a matching room
- Heartbeat: pings every 30 seconds, terminates connections that do not respond with a pong

**Event types:**

| Event type | Triggered by | Room |
|------------|-------------|------|
| `issue:updated` | Issue mutation | `project:{projectId}` |
| `issue:created` | New issue | `project:{projectId}` |
| `comment:added` | New comment | `project:{projectId}` |
| `board:moved` | Column change | `project:{projectId}` |
| `pr:updated` | PR mutation | `repo:{repoId}` |
| `pr:merged` | PR merge | `repo:{repoId}` |
| `wiki:updated` | Page save | `wiki:{spaceId}` |
| `notification` | Any notification | `user:{userId}` |
| `pipeline:updated` | Pipeline run change | `repo:{repoId}` |

The frontend hook `useRealtimeInvalidation` subscribes to relevant rooms and calls `queryClient.invalidateQueries()` on matching events, keeping TanStack Query caches fresh without polling.

### Collaboration WebSocket Server (`/ws/wiki/{pageId}`)

Implements the Yjs sync protocol for real-time collaborative wiki editing:

- One `Y.Doc` per wiki page, keyed by `pageId`, stored in a server-side `Map<string, CollabRoom>`
- `y-protocols/sync` (ESM-only, dynamically imported and cached) handles CRDT merge via the three-message handshake: sync step 1 (server sends state vector) → sync step 2 (client sends missing updates) → subsequent updates broadcast to all peers
- `y-protocols/awareness` propagates cursor positions and user presence; each client's display name is fetched from the database on connect
- On connect: server sends sync step 1 and current awareness state to the new client
- Document updates are debounce-persisted to PostgreSQL via `scheduleSave`; on the last client disconnect, `forceSave` is called immediately
- Rooms are destroyed and memory freed when the last client disconnects

---

## Git Hosting Architecture

Bare Git repositories are stored at `{REPOS_PATH}/{orgSlug}/{teamSlug}/{repoSlug}.git`. In development, `REPOS_PATH` is `.data/repos` (bind-mounted into the container). In production, it is a Docker named volume at `/data/repos`.

### Smart HTTP (`/git/*`)

Implemented in `src/git/smart-http.ts` and mounted at the Express `/git` prefix.

- **Authentication:** HTTP Basic Auth with an API token (`tk_...`) as the password; username field is ignored
- **Clone/fetch:** `GET /git/{org}/{team}/{repo}.git/info/refs?service=git-upload-pack`
- **Push:** `POST /git/{org}/{team}/{repo}.git/git-receive-pack`
- Git processes (`git-upload-pack`, `git-receive-pack`) are spawned via `child_process.spawn` with stdio piped directly to the HTTP request/response streams
- Write access requires the user to have appropriate org membership; the API token is validated against the `api_tokens` table

### SSH Server

Implemented in `src/git/ssh-server.ts` using the `ssh2` library, and run as the dedicated `git-ssh` container (`node dist/ssh.js`). Listens on `SSH_LISTEN_PORT` (default 2222).

- **Authentication:** public key only. The connecting key's SHA-256 fingerprint is looked up in the `ssh_keys` table, and the client's signature over the auth request is verified against that key before the connection is accepted
- Only `git-upload-pack` and `git-receive-pack` exec commands are allowed; anything else is rejected
- Parses exec commands of the form `git-upload-pack '/org/team/repo.git'` and `git-receive-pack '/org/team/repo.git'`
- Spawns the appropriate git process and pipes its stdin/stdout through the SSH channel
- Host key is loaded from `SSH_HOST_KEY` (default `/data/ssh/host_key`), generated on first start if it does not exist

### Post-Receive Hook

`POST /api/internal/hooks/post-receive` (in `src/git/hook-handler.ts`) is called by the `post-receive` hook script installed in each bare repo. It is mounted early in `src/index.ts`, exempt from CSRF, and secured by a shared `HOOK_SECRET` value sent in the `X-Hook-Secret` header.

The installed hook script is POSIX `sh` and contains only the repository id; it carries no secrets. It execs `post-receive-hook.ts` (`AXIOM_HOOK_ENTRY`, defaulting to `/app/dist/git/post-receive-hook.js`), which reads `oldrev newrev refname` lines from stdin and POSTs each to `${AXIOM_INTERNAL_URL}/api/internal/hooks/post-receive` with `X-Hook-Secret: ${HOOK_SECRET}`. Both `AXIOM_INTERNAL_URL` and `HOOK_SECRET` come from the environment of the git process (inherited from `api` or `git-ssh`, whichever spawned `git-receive-pack`), not from the hook file. A failed call is written to stderr and never fails the push.

Push data flow, for both transports:

```
git push ──► api (/git, HTTP)  ─┐
git push ──► git-ssh (ssh2)    ─┴─► git-receive-pack (child process, inherits env)
                                        │
                                        ▼
                               hooks/post-receive  (#!/bin/sh)
                                        │  exec node $AXIOM_HOOK_ENTRY <repoId>
                                        ▼
                         POST $AXIOM_INTERNAL_URL/api/internal/hooks/post-receive
                              X-Hook-Secret: $HOOK_SECRET (from env, not file)
                                        │
                                        ▼
                         api: webhooks, pipelines, smart commits (unchanged)
```

On each push, the hook handler:
1. **Auto-links branches** -- Scans branch name for issue keys (e.g., `feature/AXM-42-fix`), creates `IssueBranch` records
2. Parses commit messages for issue references (`Closes AXM-42`, `Fixes AXM-7`, `Refs AXM-3`)
3. Creates `IssueCommit` records linking commits to issues with the appropriate `CommitRefType`
4. Closes issues when `CLOSES` or `FIXES` ref types are detected
5. **Executes smart commit directives** -- Parses `#time`, `#comment`, `#resolve`, `#close`, `#reopen`, `#assign`, `#label` directives and applies them to referenced issues (via `smart-commits.executor.ts`)
6. Triggers pipeline runs via `triggerPipelineOnPush`
7. Dispatches outbound webhooks to all active webhook URLs configured on the repository
8. Invalidates relevant Redis cache keys via `cacheInvalidate`

### Repo Manager

`src/git/repo-manager.ts` handles bare repo lifecycle: creating new repos (`git init --bare`), computing disk paths, and installing the post-receive hook script into each new repo.

---

## Frontend Architecture

### Technology Stack

| Concern | Library | Version |
|---------|---------|---------|
| UI framework | React | 19.2 |
| Build tool | Vite | 8.0 |
| Routing | React Router | 7.13 |
| Server state | TanStack Query | 5.95 |
| Client state | Zustand | 5.0 |
| Editor | TipTap | 3.20 |
| CRDT | Yjs | 13.6 |
| Icons | lucide-react | 1.7 |
| CSS | Tailwind CSS | 4.x |
| TypeScript | 5.8 | |

### Directory Structure

```
frontend/src/
  App.tsx               # Root component: auth loading, route tree
  api/                  # API client + per-module API helpers
    client.ts           # fetch wrapper with auto token refresh
  components/
    layout/             # AppShell, Sidebar, Header, Breadcrumbs
    ui/                 # Shared components (Button, Modal, Input, etc.)
    editor/             # MarkdownRenderer, MarkdownEditor (TipTap)
  pages/                # Route components (lazy-loaded)
  routes/               # Route group definitions (project-routes, repo-routes, admin-routes)
  stores/               # Zustand stores
  hooks/                # Custom hooks
  lib/                  # Types, utils, guards
```

### Routing

React Router v7 is used throughout. All imports come from `'react-router'` (not `'react-router-dom'`). Routes are organized into groups:

- **Guest routes** (`GuestGuard`): `/login`, `/register`, `/forgot-password`, `/reset-password/:token`
- **Authenticated routes** (`AuthGuard` + `AppShell`):
  - `/` — Dashboard
  - `/:org` — Team list for org
  - `/:org/:team` — Team detail
  - `/:org/:team/repos/:repo/*` — Repository routes (files, commits, branches, PRs, releases, pipelines, settings)
  - `/:org/:team/:project/*` — Project routes (issues, board, backlog, sprints, wiki, settings)
  - `/admin/*` — Platform admin routes

All page components are lazy-loaded with `React.lazy` and wrapped in `<Suspense fallback={<PageLoader />}>` and `<ErrorBoundary>`.

### State Management

**Server state** is managed entirely by TanStack Query. Query keys follow the resource hierarchy (e.g., `['issue', projectId, issueNumber]`). Mutations invalidate related queries — for example, updating an issue invalidates `['issue']`, `['board']`, and `['issues']`.

**Client state** uses two Zustand stores:

- `useAuthStore` — `user`, `isAuthenticated`, `isLoading`; actions: `login`, `logout`, `register`, `loadUser`
- `useUIStore` — sidebar state, command palette visibility, keyboard shortcut help panel state

On app load, `App.tsx` calls `loadUser()`. If an access token exists in `localStorage`, it fetches `GET /api/users/me` to rehydrate the user; otherwise it sets `isAuthenticated: false` immediately.

### API Client

`frontend/src/api/client.ts` provides `get`, `post`, `patch`, `del` helpers built on `fetch`. Every request automatically:
- Attaches `Authorization: Bearer {accessToken}`
- Attaches `X-Requested-With: XMLHttpRequest` (CSRF header required by the server)
- On 401: triggers a shared `refreshPromise` (deduplicating concurrent refreshes), then retries the original request once
- On refresh failure: clears `localStorage` and redirects to `/login`

Tokens are stored in `localStorage` (both access and refresh). An in-module variable `accessToken` caches the value to avoid repeated `localStorage.getItem` calls.

Binary downloads (e.g., Pandoc wiki exports) use raw `fetch` with a manual `Authorization` header rather than the `api()` helper, as they require a `Blob` response rather than JSON.

---

## Caching Strategy

Redis 7 is used via `ioredis` for server-side caching. The client is configured in `src/config/redis.ts` with lazy connect and a retry strategy that gives up after 3 attempts. If Redis is unavailable, the application logs a warning and continues without caching (graceful degradation — `connected` flag gates all cache reads/writes).

Cache operations are centralized through `cacheGet(key)` and `cacheSet(key, value, ttl)` helpers exposed from `src/config/redis.ts`. The default TTL is 60 seconds. `cacheInvalidate(key)` is called from the post-receive hook handler and from service mutations to bust stale entries.

On the frontend, TanStack Query provides client-side caching of all server state with configurable `staleTime` and `gcTime` per query. The `useRealtimeInvalidation` hook bridges WebSocket events to query invalidation, ensuring the cache stays fresh without polling.

---

## File Storage

File uploads are handled by the `attachments` module using `multer` for multipart parsing. The storage layer is abstracted behind a `StorageBackend` interface in `src/storage/storage.ts`:

```typescript
interface StorageBackend {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
```

The default (and currently only) backend is `LocalStorageBackend` (`src/storage/local.ts`), which writes files to `STORAGE_PATH` on disk (default `.data/uploads`, bind-mounted in dev). The backend is a lazy singleton returned by `getStorage()`.

Storage keys follow the pattern `attachments/{year}/{month}/{cuid}.{ext}`. The `Attachment` database record links a storage key to its uploader and to one of: an issue, a wiki page, or a comment.

`attachments.service.ts` also uses Pandoc (via `execFile`) to convert certain uploaded document formats (DOCX, ODT, EPUB, HTML, CSV, RST, LaTeX, Org) at download time.

---

## Email

Outbound email is sent via `nodemailer` through a configurable SMTP server (`SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`). In the dev Docker stack, a Postfix-based `docker-mailserver` container handles local delivery.

Email sending is backed by a BullMQ queue (`src/email/queue.ts`) using Redis as the broker. The email worker is started only when `SMTP_HOST` is set in the environment, allowing the API to operate without email in environments that do not need it.

---

## Error Handling

### Backend

Services throw `new AppError(statusCode, message, code?)`. The global error handler in `src/middleware/errorHandler.ts` is registered as the last middleware and handles three cases:

- `AppError` — responds with `{ error: { message, code } }` at the specified HTTP status code
- `ZodError` — responds with `400 { error: { message: 'Validation failed', code: 'VALIDATION_ERROR', details: issues[] } }`
- All other errors — logged via `logger.error`, responds with `500 { error: { message: 'Internal server error', code: 'INTERNAL_ERROR' } }`

All error responses share the shape `{ error: { message: string, code?: string } }`.

### Frontend

- `ErrorBoundary` components wrap all lazy-loaded route components to catch React render errors
- `ApiError` (thrown by the API client) carries `status`, `message`, and optional `code`
- The `useToast` hook (`toast.success()`, `toast.error()`, `toast.info()`) surfaces transient errors and confirmations to the user
- Unrecoverable auth failures (refresh token expired) redirect to `/login` via `window.location.href`

---

## Security Model

### CSRF Protection

`csrfGuard` middleware is applied to all `/api/*` routes. It rejects state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) that do not include `X-Requested-With: XMLHttpRequest`. This custom header cannot be sent cross-origin without a CORS preflight, blocking simple cross-site form submission attacks against the JWT/`localStorage` auth scheme. The API client sets this header automatically on every request.

### Rate Limiting

`express-rate-limit` enforces two tiers (both disabled in the test environment):

| Limiter | Routes | Window | Limit |
|---------|--------|--------|-------|
| Global | All routes | 60 s | 300 requests |
| Auth | `/api/auth/login`, `/api/auth/refresh`, `/api/auth/register` | 60 s | 15 requests |

Standard `RateLimit-*` response headers are sent; legacy `X-RateLimit-*` headers are disabled.

### RBAC

Every mutating API route operating on an org, team, repo, or project resource is protected by one or more guard middleware:

- `authenticate` — verifies JWT or API token, sets `req.userId`
- `requireOrgPermission(action)` — checks `OrgMembership.role` against the permission matrix
- `requireTeamPermission(action)` — checks `TeamMembership.role` with org-level fallback
- `requireRepoAccess()` — verifies org membership for the repo's owning org
- `requireWikiSpaceAccess()` / `requireWikiPageAccess()` / `requireWikiCommentAccess()` / `requireWikiTemplateAccess()` — org membership checks for wiki resources
- `requireProjectAccess` — verifies project membership

### HTTP Security Headers

`helmet` is applied globally and sets headers including `Content-Security-Policy`, `X-Content-Type-Options`, `X-Frame-Options`, and `Strict-Transport-Security`.

### Secrets and Credentials

- `JWT_SECRET` and `JWT_REFRESH_SECRET` must each be at least 32 characters
- API token raw values are never stored; only their SHA-256 hashes are persisted in `api_tokens`
- Refresh tokens are stored as SHA-256 hashes with an expiry timestamp in `refresh_tokens`
- SSH host private key is stored at the path in `SSH_HOST_KEY` (default `/data/ssh/host_key`), inside the `ssh_host_key` volume (`ssh-host-key` in dev), generated on the `git-ssh` container's first start
- Deployment environment variable values are stored encrypted in `EnvironmentVariable.encryptedValue`
- The post-receive hook is authenticated by a `HOOK_SECRET` random value shared between the API process and each bare repo's installed hook script

---

## Development Infrastructure

The dev stack is defined in `docker-compose.dev.yml` and started with `npm run docker:dev`.

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `db` | postgres:16-alpine | 5432 | Primary database |
| `redis` | redis:7-alpine | 6379 | Cache and email queue broker, password `axiom_dev_redis` |
| `mailserver` | docker-mailserver | 25 | Local SMTP for email testing |
| `migrate` | Custom (Dockerfile.dev) | none | Runs `prisma migrate deploy` and reinstalls hooks, then exits (one-shot) |
| `api` | Custom (Dockerfile.dev) | 3000 | Express API with `tsx` watch |
| `git-ssh` | Custom (Dockerfile.dev) | 2222 | SSH git transport with `tsx` watch (Docker profile: `ssh`) |
| `worker` | Custom (Dockerfile.dev) | none | Email queue consumer and runner health monitor with `tsx` watch |
| `web` | Custom (Dockerfile.dev) | 7000 | Vite dev server |
| `tunnel` | cloudflare/cloudflared | — | Optional Cloudflare tunnel (Docker profile: `tunnel`) |

Source directories are bind-mounted into the containers so that code changes on the host are reflected immediately without rebuilding images.

A test database `axiom_test` is created by `scripts/init-test-db.sql` during PostgreSQL initialization. Integration tests connect to `axiom_test` via a separate `createPrismaClient(url)` call and never touch the `axiom` development database.
