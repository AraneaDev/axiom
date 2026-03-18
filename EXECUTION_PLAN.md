# Axiom -- Execution Plan

This document breaks the PRODUCT_PLAN.md into agent-parallelizable work streams. Each "batch" can run as parallel agents. Batches must execute sequentially (later batches depend on earlier ones).

---

## Batch 0: Infrastructure & Schema (Foundation)

Everything else depends on these. Run first.

### Agent 0A: Database Schema Expansion
**Prisma migration adding all new models at once:**
- `Sprint` (projectId, name, goal, startDate, endDate, status)
- `CustomFieldDefinition` (projectId, name, type, options, required)
- `CustomFieldValue` (issueId, fieldId, value)
- `WorkflowRule` (projectId, fromColumnId, toColumnId, requiredFields)
- `AutomationRule` (projectId, trigger, conditions, actions, enabled)
- `Attachment` (filename, mimeType, size, storageKey, uploaderId, issueId?, pageId?, commentId?)
- `Activity` (resourceType, resourceId, action, userId, details, createdAt)
- `NotificationPreference` (userId, channel, eventType, enabled)
- `DeploymentEnvironment` (repoId, name, url, lastDeployedAt)
- `CommitStatus` (repoId, sha, context, state, targetUrl, description)
- `PageComment` (pageId, userId, body, anchor, resolved)
- `PageLabel` (pageId, label)
- `PageTemplate` (spaceId, name, body, description)
- `SavedFilter` (userId, projectId, name, query)
- `IssueVote` (issueId, userId)
- `IssueWatcher` (issueId, userId)
- Add to Issue: `parentId` (self-relation for epic hierarchy), `storyPoints`, `sprintId`, `timeEstimate`, `timeSpent`
- Add to PullRequest: `mergeStrategy` enum (MERGE, SQUASH, REBASE)
- Add to Repository: `defaultMergeStrategy`, `codeOwnersEnabled`
- Add to User: `notificationEmail`, `ssoProvider`, `ssoExternalId`

### Agent 0B: WebSocket Infrastructure
**Backend:**
- Install `ws` package
- Create `src/realtime/ws-server.ts` -- WebSocket server attached to Express HTTP server
- Create `src/realtime/events.ts` -- typed event system (issue:updated, pr:merged, comment:added, board:moved, etc.)
- Create `src/realtime/broadcast.ts` -- helper to broadcast events to room subscribers
- Room model: users subscribe to `org:{id}`, `team:{id}`, `project:{id}`, `repo:{id}`
- Auth: validate JWT on WebSocket upgrade

**Frontend:**
- Create `frontend/src/hooks/useWebSocket.ts` -- singleton WS connection with auto-reconnect
- Create `frontend/src/hooks/useRealtimeInvalidation.ts` -- listen to WS events, invalidate matching React Query keys
- Wire into App.tsx

### Agent 0C: File Storage Infrastructure
**Backend:**
- Create `src/storage/storage.ts` -- abstract storage interface (put, get, delete, getSignedUrl)
- Create `src/storage/local.ts` -- local filesystem adapter (dev)
- Create `src/storage/s3.ts` -- S3-compatible adapter (prod, MinIO)
- Create `src/modules/attachments/attachments.routes.ts` -- POST upload (multipart), GET download, DELETE
- Create `src/modules/attachments/attachments.controller.ts`
- Create `src/modules/attachments/attachments.service.ts`
- Mount at `/api/attachments`
- Add `multer` for multipart upload handling
- Storage path: `{orgId}/{type}/{resourceId}/{filename}`

**Frontend:**
- Create `frontend/src/api/attachments.api.ts`
- Create `frontend/src/components/ui/FileUpload.tsx` -- drag-and-drop upload zone
- Create `frontend/src/components/ui/AttachmentList.tsx` -- file list with preview/download/delete

---

## Batch 1: Core Features (Parallel -- no interdependencies)

### Agent 1A: Notification System
**Depends on: 0A (schema), 0B (WebSocket)**
**Backend:**
- Create `src/modules/notifications/notifications.service.ts` -- create, list, markRead, markAllRead
- Create `src/modules/notifications/notifications.controller.ts`
- Create `src/modules/notifications/notifications.routes.ts` -- GET /notifications, PATCH /:id/read, POST /read-all
- Create `src/modules/notifications/email.ts` -- nodemailer SMTP sender with HTML templates
- Create notification preferences API (GET/PATCH /users/me/notification-preferences)
- Emit notifications from: issue assignment, PR review request, @mention, comment reply, issue status change
- Broadcast via WebSocket for in-app delivery

**Frontend:**
- Create `frontend/src/pages/notifications/NotificationCenter.tsx` -- dropdown from header bell icon
- Add bell icon + unread count badge to Header
- Notification preference settings page
- Toast on new real-time notification

### Agent 1B: Activity Streams
**Depends on: 0A (schema)**
**Backend:**
- Create `src/modules/activity/activity.service.ts` -- logActivity(resourceType, resourceId, action, userId, details)
- Add activity logging calls to: issue create/update/delete, comment add, status change, assignee change, label change, PR create/merge/close, wiki page edit
- Create `src/modules/activity/activity.controller.ts` -- GET /projects/:id/activity, GET /issues/:id/activity
- Create `src/modules/activity/activity.routes.ts`

**Frontend:**
- Create `frontend/src/components/ActivityFeed.tsx` -- timeline component with icons per action type
- Add activity tab to IssueDetail (replace or augment comments section)
- Add activity feed to project dashboard

### Agent 1C: Sprint Planning
**Depends on: 0A (schema)**
**Backend:**
- Create `src/modules/sprints/sprints.service.ts` -- CRUD sprints, add/remove issues, complete sprint
- Create `src/modules/sprints/sprints.controller.ts`
- Create `src/modules/sprints/sprints.routes.ts` -- scoped under /projects/:projectId/sprints
- Sprint completion: move incomplete issues to next sprint or backlog
- Velocity calculation: sum story points of completed issues per sprint

**Frontend:**
- Create `frontend/src/pages/issues/Backlog.tsx` -- draggable backlog + sprint panels
- Create `frontend/src/pages/issues/SprintBoard.tsx` -- board filtered to current sprint
- Create `frontend/src/components/VelocityChart.tsx` -- bar chart of velocity over sprints
- Add sprint selector to board and issue list
- Add story points field to issue detail sidebar
- Add Sprint tab/route: `/:org/:team/:project/sprints`

### Agent 1D: Epic Hierarchy & Roadmap
**Depends on: 0A (schema -- parentId on Issue)**
**Backend:**
- Add `parentId` query support to issues service (list children, get parent chain)
- Create `src/modules/issues/issue-hierarchy.controller.ts` -- GET /:issueNumber/children, PATCH /:issueNumber/parent
- Epic progress endpoint: GET /:issueNumber/progress (% complete, child counts by status)

**Frontend:**
- Create `frontend/src/pages/issues/EpicDetail.tsx` -- epic view with child issue list, progress bar
- Create `frontend/src/pages/issues/Roadmap.tsx` -- timeline view with epic bars (horizontal Gantt-style)
- Add parent issue picker to issue detail sidebar
- Add subtask creation from issue detail
- Add route: `/:org/:team/:project/roadmap`

### Agent 1E: CI/CD Execution Engine
**Depends on: 0A (schema), 0B (WebSocket for log streaming)**
**Backend:**
- Create `src/pipelines/executor.ts` -- Docker-based job runner
- Create `src/pipelines/yaml-parser.ts` -- parse pipeline YAML into job/step DAG
- Create `src/pipelines/runner.ts` -- orchestrate job execution, manage containers
- Create `src/pipelines/log-streamer.ts` -- stream logs via WebSocket
- On git push: check for `.axiom/pipeline.yml`, auto-create run
- On run complete: report commit status check to PRs
- Integrate with branch protection (block merge if checks fail)

**Frontend:**
- Update PipelineRunDetail to show real-time log streaming
- Add status badges on PR page for pipeline checks
- Add pipeline trigger button on commit detail

### Agent 1F: Merge Strategies & PR Enhancements
**Depends on: 0A (schema -- mergeStrategy)**
**Backend:**
- Add merge strategy support to pulls.service.ts (merge, squash, rebase)
- Implement squash merge (combine commits)
- Implement rebase merge (replay commits)
- Add merge check enforcement (required reviews, status checks must pass)
- Default reviewers: auto-assign from repo settings

**Frontend:**
- Add merge strategy dropdown to PR merge button
- Show merge check status on PR page (reviews, CI, branch protection)
- Block merge button when checks fail with explanation
- Add default reviewers setting to repo settings page

---

## Batch 2: Enhanced Features (Parallel)

### Agent 2A: Custom Fields
**Depends on: 0A (schema), Batch 1 stable**
**Backend:**
- Create `src/modules/custom-fields/custom-fields.service.ts` -- CRUD field definitions, set/get values
- Create `src/modules/custom-fields/custom-fields.controller.ts`
- Create `src/modules/custom-fields/custom-fields.routes.ts`
- Include custom field values in issue queries

**Frontend:**
- Create `frontend/src/pages/projects/CustomFieldSettings.tsx` -- field definition manager
- Render custom fields in issue detail sidebar (dynamic by type)
- Add custom field filters to issue list
- Add custom field columns to issue list table view

### Agent 2B: Workflow & Automation Rules
**Depends on: 0A (schema), 1B (activity for triggers)**
**Backend:**
- Create `src/modules/workflows/workflow.service.ts` -- validate transitions, check required fields
- Create `src/modules/automation/automation.service.ts` -- evaluate rules on events, execute actions
- Create `src/modules/automation/automation.controller.ts` / routes
- Hook automation engine into activity events

**Frontend:**
- Create `frontend/src/pages/projects/WorkflowEditor.tsx` -- visual column transition rules
- Create `frontend/src/pages/projects/AutomationRules.tsx` -- rule builder (trigger + condition + action)
- Add to project settings

### Agent 2C: Wiki Enhancements
**Depends on: 0C (file attachments)**
**Backend:**
- Create page templates service (CRUD templates per space)
- Create inline page comments (anchor-based, resolvable)
- Add page labels/tags with search
- Add page move/copy between spaces and reorder within tree

**Frontend:**
- Create template picker when creating new page
- Create `frontend/src/components/wiki/InlineCommentSidebar.tsx`
- Add label/tag chips to page view
- Add page move/copy in page actions dropdown
- Add drag-and-drop reorder to page tree sidebar

### Agent 2D: Commit Status Checks & Code Owners
**Depends on: 0A (schema)**
**Backend:**
- Create `src/modules/status-checks/status-checks.controller.ts` -- POST /repos/:id/statuses (external CI reports)
- Parse CODEOWNERS file from repo on PR creation
- Auto-assign reviewers from CODEOWNERS
- Enforce code owner approval in branch protection

**Frontend:**
- Show status check badges on PR page and commit detail
- Show code owner review requirements on PR
- Add CODEOWNERS documentation to repo settings

### Agent 2E: Mentions & Cross-references
**Depends on: 1A (notifications)**
**Backend:**
- Parse @username mentions in comments/descriptions, create notifications
- Parse #AXM-123 issue references, auto-link in rendered markdown
- Parse [[PageName]] wiki references

**Frontend:**
- Create `frontend/src/components/MentionInput.tsx` -- autocomplete dropdown for @mentions
- Render @mentions as linked user chips
- Render #issue references as linked badges
- Use MentionInput in comment editors and issue description

### Agent 2F: Time Tracking & Bulk Operations
**Depends on: 0A (schema)**
**Backend:**
- Add time tracking endpoints: POST /issues/:num/worklogs, GET /issues/:num/worklogs
- Add bulk operations: PATCH /projects/:id/issues/bulk (update status, assignee, labels, sprint)

**Frontend:**
- Add time tracking widget to issue detail sidebar (log work, view total)
- Add multi-select mode to issue list (checkboxes)
- Add bulk action toolbar (change status, assign, move to sprint, add label)

---

## Batch 3: Collaboration & Polish (Parallel)

### Agent 3A: Collaborative Wiki Editing
**Depends on: WebSocket (0B)**
- Install `yjs` + `y-websocket`
- Create `src/realtime/collaboration.ts` -- Yjs document provider backed by wiki page content
- Presence indicators (cursors, user avatars)
- Integrate with TipTap editor (TipTap has Yjs extension)
- Save merged document on disconnect

### Agent 3B: PR Suggestions & Review UX
**Depends on: existing PR system**
- Add suggestion syntax in review comments (```suggestion blocks)
- One-click "apply suggestion" button (creates commit on source branch)
- Batch apply multiple suggestions as single commit
- Side-by-side diff view option (currently unified only)

### Agent 3C: Repository Insights
**Depends on: existing git commands**
**Backend:**
- Create `src/modules/repos/insights.service.ts` -- commit frequency, contributor stats, language breakdown
- Endpoints: GET /repos/:id/insights/contributors, /commits-over-time, /languages

**Frontend:**
- Create `frontend/src/pages/repos/InsightsTab.tsx`
- Commit frequency chart (line graph)
- Contributor list with commit counts
- Language breakdown pie chart
- Add Insights tab to repo detail

### Agent 3D: Dashboard Widgets & Saved Filters
**Depends on: 0A (schema), sprints, activity**
**Frontend:**
- Redesign Dashboard.tsx with configurable widget grid
- Widgets: assigned issues, recent activity, sprint burndown, PR review requests, upcoming due dates
- Saved filters: save current issue list filter as named filter
- Quick filter buttons on issue list

### Agent 3E: Labels Management & Issue Templates
**Depends on: existing label system**
**Backend:**
- Create `src/modules/labels/labels.service.ts` -- CRUD labels at project level (name, color, description)
- Create issue templates service (per project, per issue type)

**Frontend:**
- Create `frontend/src/pages/projects/LabelsSettings.tsx` -- label manager with color picker
- Create `frontend/src/pages/projects/IssueTemplates.tsx` -- template editor
- Show template picker on issue create page

### Agent 3F: Advanced Search
**Depends on: existing search**
**Backend:**
- Add PostgreSQL tsvector full-text indexing on issues (title, body), wiki pages (body), repos (name, description)
- Add code search: `git grep` across repos
- Add structured query parsing (assignee:tim status:open priority:high)
- Saved searches CRUD

**Frontend:**
- Upgrade SearchResults.tsx with tabbed results (Issues, Code, Wiki, Repos)
- Add structured query input with autocomplete
- Add "Save this search" button
- Code search results with file path and line preview

---

## Batch 4: Enterprise (Parallel)

### Agent 4A: SSO / OIDC
- Install `openid-client` package
- Create `src/modules/auth/sso.service.ts` -- OIDC provider configuration, callback handling
- Create `src/modules/auth/sso.controller.ts` -- GET /auth/sso/:provider, GET /auth/sso/callback
- Auto-provision users on first SSO login
- Link existing users to SSO identity
- Admin UI for configuring OIDC providers

### Agent 4B: Admin Dashboard
- Create `src/modules/admin/admin.controller.ts` -- system stats, user management
- Create admin routes (require OWNER role)
- Endpoints: GET /admin/stats, GET /admin/users, PATCH /admin/users/:id, GET /admin/storage

**Frontend:**
- Create `frontend/src/pages/admin/AdminDashboard.tsx` -- user count, storage usage, system health
- Create `frontend/src/pages/admin/UserManagement.tsx` -- list, disable, delete users
- Create `frontend/src/pages/admin/SystemSettings.tsx` -- SMTP config, storage config, SSO config
- Add Admin link to sidebar (visible to owners only)

### Agent 4C: Deployment Environments
**Depends on: 0A (schema), CI/CD engine**
- Create `src/modules/deployments/deployments.service.ts`
- Track deployments per environment (dev, staging, prod)
- Link deployments to pipeline runs and commits
- Environment protection rules (require approval for prod)

**Frontend:**
- Create `frontend/src/pages/repos/Environments.tsx` -- environment list with last deployed info
- Add deployment history view
- Add environment badge on commit/PR

### Agent 4D: Audit Logging
**Depends on: 0A (schema)**
- Create `src/modules/audit/audit.service.ts` -- structured audit log creation
- Add audit logging middleware for all mutating API endpoints
- Create admin audit log viewer
- Filterable by user, action, resource type, date range

### Agent 4E: MCP Tools Expansion
**Depends on: new features from Batches 1-3**
- Add tools: update_issue, create_pull_request, review_pull_request, search, run_pipeline, create_release, bulk_update_issues, get_sprint, get_metrics
- Add MCP resources: board state, PR diffs, sprint data, pipeline logs
- Add MCP prompts: "summarize sprint", "triage issues", "review PR"

### Agent 4F: API v2 & Pagination
- Add cursor-based pagination to all list endpoints
- Generate OpenAPI spec from routes
- Add pagination UI components (frontend)
- Add API documentation page
- OAuth2 app registration for third-party integrations

---

## Execution Summary

| Batch | Agents | Can Parallelize | Estimated Scope |
|-------|--------|-----------------|-----------------|
| 0 | 3 | Yes (all parallel) | Schema + WebSocket + Storage infra |
| 1 | 6 | Yes (all parallel) | Notifications, Activity, Sprints, Epics, CI/CD, PR merge |
| 2 | 6 | Yes (all parallel) | Custom fields, Automation, Wiki++, Status checks, Mentions, Time tracking |
| 3 | 6 | Yes (all parallel) | Collab editing, PR suggestions, Insights, Dashboard, Labels, Search |
| 4 | 6 | Yes (all parallel) | SSO, Admin, Deployments, Audit, MCP++, API v2 |
| **Total** | **27 agents** | **5 sequential batches** | |

### Dependency Graph
```
Batch 0 (infra) ──> Batch 1 (core) ──> Batch 2 (enhanced) ──> Batch 3 (polish) ──> Batch 4 (enterprise)
   0A Schema ──────> 1A,1B,1C,1D,1E,1F
   0B WebSocket ───> 1A,1E,3A
   0C Attachments ─> 2C
```

### Per-Agent Deliverables
Each agent must deliver:
1. Prisma schema changes (if any) with migration
2. Backend service + controller + routes
3. Frontend API client + pages/components
4. TypeScript passes (`npx tsc --noEmit` for both backend and frontend)
