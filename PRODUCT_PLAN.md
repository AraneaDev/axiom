# Axiom -- Product Plan

**Axiom is a self-hosted developer platform that unifies project management, source code hosting, documentation, and AI-assisted development into a single application.** It replaces the Atlassian stack (Jira + Confluence + Bitbucket) and adds native AI tooling via Model Context Protocol (MCP).

---

## Current State (Updated 2026-03-20)

### What Works Today

#### Project Management (Jira equivalent)
- [x] Organizations, teams, and projects with role-based access (Owner/Admin/Member)
- [x] Issue tracking with types (Task, Bug, Story, Epic), priorities, statuses, labels
- [x] Kanban board with drag-and-drop column moves, swimlanes, filters
- [x] Issue list with search, filtering (status, priority, type, assignee, label), sorting
- [x] Issue comments with markdown, @mentions, #issue references
- [x] Issue linking (blocks, is blocked by, duplicates, relates to)
- [x] Issue-to-commit linking via commit message parsing (CLOSES, FIXES, REFS #num)
- [x] Issue branch auto-creation with naming convention
- [x] Issue-to-PR linking
- [x] Board columns (customizable kanban workflow)
- [x] Project-scoped issue numbering with prefix (e.g., AXM-42)
- [x] Due dates on issues
- [x] Sprint planning with backlog, velocity chart, burndown chart, sprint progress bars
- [x] Custom fields (text, number, date, select, multi-select, user)
- [x] Workflow rules with status transitions and auto-actions
- [x] Automation rules (trigger/condition/action)
- [x] Issue templates per project
- [x] Epic hierarchy with parent/child relationships, progress tracking
- [x] Roadmap timeline view with epic bars and priority coloring
- [x] Saved filters per project
- [x] Issue votes and watchers with notification triggers
- [x] Labels management UI per project
- [x] Time tracking (log work, estimates, time report page, CSV export)
- [x] Project analytics (cycle time, lead time, activity trends, workload)
- [x] Team workload visualization with capacity warnings

#### Source Code Hosting (Bitbucket equivalent)
- [x] Git repository hosting (bare repos on disk)
- [x] Smart HTTP protocol (git clone/push via HTTP Basic Auth with API tokens)
- [x] SSH protocol (git clone/push via SSH key authentication)
- [x] Repository visibility (Public, Internal, Private)
- [x] File browser with directory navigation and branch switcher dropdown
- [x] File viewer with syntax highlighting (lowlight/highlight.js)
- [x] Blame view (line-by-line authorship)
- [x] File history
- [x] Branch management (create, delete, list)
- [x] Branch comparison (diff between branches)
- [x] Commit list with pagination (30 per page, load more)
- [x] Commit detail with file carousel (prev/next navigation, keyboard shortcuts)
- [x] Repository forking
- [x] Repository settings page (wider layout)
- [x] Clone URL display (HTTPS + SSH with copy buttons)
- [x] URL-based tab routing (/branches, /commits, /pipelines, /releases, etc.)

#### Pull Requests & Code Review
- [x] PR creation with source/target branch
- [x] PR diff viewer with inline comments
- [x] PR commit list
- [x] PR reviews (Approve, Request Changes, Comment)
- [x] PR comments (general + inline on diff)
- [x] PR merge and close with merge strategy selection (merge/squash/rebase)
- [x] PR-to-issue linking
- [x] "Needs My Review" filter on PR list
- [x] Cross-repo open PRs view on team page

#### Branch Protection
- [x] Pattern-based rules (glob: `main`, `release/*`)
- [x] Required review count
- [x] Require CI status checks
- [x] Prevent force push, direct push, non-linear history
- [x] Frontend settings UI with add/edit/delete

#### Documentation (Confluence equivalent)
- [x] Wiki spaces scoped to teams
- [x] Page CRUD with markdown body
- [x] Page tree (parent/child hierarchy)
- [x] Page version history
- [x] Breadcrumb navigation
- [x] Table of contents generation from headings
- [x] Mermaid diagram rendering
- [x] TipTap WYSIWYG markdown editor
- [x] Export to HTML, DOCX, EPUB, PDF, LaTeX, plain text (pandoc + weasyprint)
- [x] Mermaid diagrams rendered as images in PDF/DOCX exports
- [x] Real-time collaborative editing (Yjs CRDT + WebSocket)
- [x] Page labels/tags
- [x] Page move and copy
- [x] Rich space index with welcome preview and page cards
- [x] File attachments on pages

#### CI/CD (Pipelines)
- [x] Pipeline CRUD with YAML config storage
- [x] Pipeline run records (status, started/finished timestamps)
- [x] Manual run triggering and re-run
- [x] Run cancellation
- [x] Log retrieval with real-time streaming (SSE)
- [x] Job/step detail with expandable output
- [ ] **No actual execution engine** -- runs are recorded but nothing executes the YAML

#### Release Management
- [x] Releases tied to git tags
- [x] Draft and pre-release flags
- [x] Publish workflow
- [x] Changelog comparison between tags
- [x] Release notes (markdown body)
- [x] Deploy to environments with status tracking
- [x] Deployment history per release

#### Environments & Secrets
- [x] Deployment environments (dev/staging/prod)
- [x] Environment variables with AES-256-CBC encryption
- [x] Masked values in API responses
- [x] Variable CRUD UI

#### Webhooks
- [x] Per-repository webhook configuration
- [x] Event types: push, pr:created, pr:merged, tag:created, branch:deleted
- [x] Secret signing for payload verification
- [x] Webhook CRUD
- [x] Delivery history with status codes, timing, request/response bodies
- [x] Redeliver failed webhooks

#### Search
- [x] Global search across issues, repositories, wiki pages
- [x] Filters: type, priority, status, assignee
- [x] Command palette (Cmd+K) for quick navigation

#### Authentication & User Management
- [x] Username/password registration and login
- [x] JWT access + refresh token flow
- [x] Two-factor authentication (TOTP)
- [x] SSH key management
- [x] API token management (for git + API access)
- [x] Organization invites with token-based accept flow
- [x] User profile editing
- [x] Global admin via User.isAdmin field

#### Notifications
- [x] In-app notification center (bell icon in header)
- [x] Notification inbox page with filter tabs (All, Unread, Mentions, Watching)
- [x] Mark as read/unread, mark all as read
- [x] Click-to-navigate to linked entity
- [x] Notification preferences per user
- [x] WebSocket-based real-time notification delivery
- [ ] **No email notification delivery** (SMTP not integrated)

#### Real-time
- [x] WebSocket server with JWT authentication
- [x] Event broadcasting: issue:created/updated, pr:updated/merged, wiki:updated, board:moved, pipeline:updated, notification
- [x] useRealtimeInvalidation hook for automatic query cache invalidation
- [x] Zero polling -- all data updates via WebSocket events
- [x] Collaborative wiki editing via Yjs CRDT

#### AI Integration (MCP)
- [x] MCP server with SSE transport
- [x] Tools: list/get/create issues, browse repos, read files, wiki CRUD
- [x] Permission-aware (respects user's org/team access)

#### Platform & Infrastructure
- [x] Redis caching layer with cache-aside pattern (graceful degradation)
- [x] System health endpoint (GET /api/health) with DB + Redis status
- [x] Docker healthchecks on all containers (db, redis, api, web)
- [x] Admin dashboard with live health panel, system stats, storage breakdown
- [x] Audit logging with filterable log viewer
- [x] Responsive layout with collapsible sidebar
- [x] Dark/light mode via CSS variables
- [x] Breadcrumbs with friendly names and icons
- [x] Toast notifications
- [x] Error boundaries (page-level isolation)
- [x] Design token system (no hardcoded colors)
- [x] Skeleton loading states on all data-heavy pages
- [x] Settings sidebar navigation (user settings + project settings)
- [x] Team activity feed and member profile pages

---

## Remaining Gaps vs. Atlassian Stack

### HIGH Priority (Critical for parity)

| Feature | Status | Notes |
|---------|--------|-------|
| Email notifications (SMTP) | NOT STARTED | Notification model exists, need nodemailer + SMTP config + templates |
| CI/CD execution engine | NOT STARTED | Pipeline model complete, need Docker-based executor to actually run YAML |
| File attachments on issues/comments | NOT STARTED | Attachment model exists for wiki, need to extend to issues + comments with drag-and-drop UI |
| Code search across repositories | NOT STARTED | Only issue/wiki search exists, need source code indexing |

### MEDIUM Priority (Important for usability)

| Feature | Status | Notes |
|---------|--------|-------|
| Bulk issue operations | NOT STARTED | Multi-select + batch edit (status, assignee, labels) |
| SLA tracking | NOT STARTED | Response/resolution time targets per priority |
| Advanced query language | NOT STARTED | JQL-like structured search for issues |
| Configurable dashboard widgets | NOT STARTED | Static dashboard only, need drag-and-drop widget layout |
| Default PR reviewers | NOT STARTED | Auto-assign reviewers on PR creation |
| Code Owners (CODEOWNERS) | PARTIAL | Backend parsing exists, no frontend UI or auto-assign |
| Page restrictions | NOT STARTED | Per-page view/edit permissions |
| Repository insights | NOT STARTED | Commit frequency, contributor stats, language breakdown |
| Scheduled reports | NOT STARTED | Auto-generate and email sprint/project reports |

### LOW Priority (Nice-to-have)

| Feature | Status | Notes |
|---------|--------|-------|
| SSO / SAML / OIDC | NOT STARTED | Enterprise identity provider integration |
| LFS support | NOT STARTED | Large file storage for git |
| PR tasks/checklists | NOT STARTED | Checklist items within PRs |
| Wiki page favorites/bookmarks | NOT STARTED | Star pages for quick access |
| Custom report builder | NOT STARTED | Drag-and-drop report creation |
| OAuth2 app integrations | NOT STARTED | Third-party app authorization |

---

## Implementation Roadmap (Remaining Work)

### Phase A: Email & Attachments (Next)

**A.1 Email Notifications**
- SMTP integration (nodemailer)
- Email templates: issue assigned, PR review requested, mentioned, comment reply
- Delivery preferences per user (email, in-app, none)
- Batch digest option (immediate vs daily summary)

**A.2 Issue/Comment File Attachments**
- Extend existing Attachment model to support issues and comments
- Drag-and-drop upload UI in issue description and comment editors
- Image preview in markdown (`![](attachment://id)`)
- Storage quota per org

### Phase B: CI/CD Execution

**B.1 Docker-based Pipeline Executor**
- Parse YAML config into job/step graph
- Execute steps in isolated Docker containers
- Stream logs in real-time via existing SSE infrastructure
- Report commit status checks back to PRs
- Block PR merge when required checks fail

### Phase C: Advanced Search & Code Intelligence

**C.1 Code Search**
- Index repository file contents (trigram or Elasticsearch)
- Search code across all team repos
- Syntax-aware search results with file context

**C.2 Advanced Query Language**
- JQL-like structured queries for issues
- Auto-complete field names and values
- Save and share queries

### Phase D: Enterprise Features

**D.1 SSO / OIDC**
- OpenID Connect provider integration
- SAML 2.0 support
- Auto-provision users on first login
- Group-to-team mapping

**D.2 Advanced Admin**
- Configurable dashboard widgets
- Scheduled report generation
- Backup/restore UI
- License management

---

## MCP Integration Roadmap

### Current MCP Tools
- list_orgs, list_teams, list_projects
- list_issues, get_issue, create_issue, add_comment
- list_wiki_spaces, get_wiki_page, create_wiki_page, get_page_tree
- list_repos, browse_files, read_file, get_commits

### Planned MCP Tools
- **update_issue** -- change status, priority, assignee, labels
- **create_pull_request** -- open PR from branch
- **review_pull_request** -- approve/request changes with comments
- **search** -- global search across all resources
- **run_pipeline** -- trigger CI/CD run
- **create_release** -- tag and publish release
- **bulk_update_issues** -- batch operations
- **get_sprint** -- sprint planning data
- **get_metrics** -- velocity, burndown, contributor stats

### MCP Resources (read-only context)
- Project board state
- PR diff content
- Wiki space structure
- Pipeline run logs
- Repository file tree

This positions Axiom as the first developer platform where AI assistants are first-class citizens with full read/write access to the entire development lifecycle.
