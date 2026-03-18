# Axiom -- Product Plan

**Axiom is a self-hosted developer platform that unifies project management, source code hosting, documentation, and AI-assisted development into a single application.** It replaces the Atlassian stack (Jira + Confluence + Bitbucket) and adds native AI tooling via Model Context Protocol (MCP).

---

## Current State

### What Works Today

#### Project Management (Jira equivalent)
- [x] Organizations, teams, and projects with role-based access (Owner/Admin/Member)
- [x] Issue tracking with types (Task, Bug, Story, Epic), priorities, statuses, labels
- [x] Kanban board with drag-and-drop column moves
- [x] Issue list with search, filtering (status, priority, type, assignee, label), sorting
- [x] Issue comments with markdown
- [x] Issue linking (blocks, is blocked by, duplicates, relates to)
- [x] Issue-to-commit linking via commit message parsing (CLOSES, FIXES, REFS #num)
- [x] Issue branch auto-creation with naming convention
- [x] Issue-to-PR linking
- [x] Board columns (customizable kanban workflow)
- [x] Project-scoped issue numbering with prefix (e.g., AXM-42)
- [x] Due dates on issues

#### Source Code Hosting (Bitbucket equivalent)
- [x] Git repository hosting (bare repos on disk)
- [x] Smart HTTP protocol (git clone/push via HTTP Basic Auth with API tokens)
- [x] SSH protocol (git clone/push via SSH key authentication)
- [x] Repository visibility (Public, Internal, Private)
- [x] File browser with directory navigation
- [x] File viewer with syntax highlighting (lowlight/highlight.js)
- [x] Blame view (line-by-line authorship)
- [x] File history
- [x] Branch management (create, delete, list)
- [x] Branch comparison (diff between branches)
- [x] Commit detail view
- [x] Repository forking
- [x] Repository settings page
- [x] Clone URL display (HTTPS + SSH)

#### Pull Requests & Code Review
- [x] PR creation with source/target branch
- [x] PR diff viewer
- [x] PR commit list
- [x] PR reviews (Approve, Request Changes, Comment)
- [x] PR comments (general + inline on diff)
- [x] PR merge and close
- [x] PR-to-issue linking

#### Branch Protection
- [x] Pattern-based rules (glob: `main`, `release/*`)
- [x] Required review count
- [x] Dismiss stale reviews on new push
- [x] Required status checks (field exists, no CI integration yet)

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

#### CI/CD (Pipelines)
- [x] Pipeline CRUD with YAML config storage
- [x] Pipeline run records (status, started/finished timestamps)
- [x] Manual run triggering
- [x] Run cancellation
- [x] Log retrieval
- [ ] **No actual execution engine** -- runs are recorded but nothing executes the YAML

#### Release Management
- [x] Releases tied to git tags
- [x] Draft and pre-release flags
- [x] Publish workflow
- [x] Changelog comparison between tags
- [x] Release notes (markdown body)

#### Webhooks
- [x] Per-repository webhook configuration
- [x] Event types: push, pr:created, pr:merged, tag:created, branch:deleted
- [x] Secret signing for payload verification
- [x] Webhook CRUD

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
- [x] Organization invites
- [x] User profile editing

#### AI Integration (MCP)
- [x] MCP server with SSE transport
- [x] Tools: list/get/create issues, browse repos, read files, wiki CRUD
- [x] Permission-aware (respects user's org/team access)

#### Platform
- [x] Responsive layout with collapsible sidebar
- [x] Dark/light mode via CSS variables
- [x] Breadcrumbs with friendly names and icons
- [x] Toast notifications
- [x] Error boundaries
- [x] Design token system (no hardcoded colors)

---

## Gap Analysis vs. Atlassian Stack

### Jira Gaps

| Feature | Jira | Axiom | Priority |
|---------|------|-------|----------|
| Sprint planning | Backlog + sprint cycles, velocity tracking | No sprints, backlog, or velocity | HIGH |
| Time tracking | Log work, time estimates, remaining | None | MEDIUM |
| Custom fields | Unlimited custom fields per issue type | Fixed schema only | HIGH |
| Workflows | Configurable status transitions with rules | Free-form column moves, no rules | MEDIUM |
| Epics & hierarchy | Epic > Story > Subtask, parent linking | Epic type exists but no hierarchy view | HIGH |
| Roadmap / timeline | Timeline view with dependency lines | None | MEDIUM |
| Bulk operations | Multi-select issues, bulk edit | None | MEDIUM |
| Issue templates | Per-type templates with required fields | None | LOW |
| SLA tracking | Response/resolution time tracking | None | LOW |
| Advanced JQL search | Structured query language | Basic text + filter dropdowns | MEDIUM |
| Dashboard widgets | Configurable dashboards with charts | Static dashboard only | MEDIUM |
| Automation rules | When X happens, do Y | None | HIGH |
| Activity stream | Timeline of all actions per issue | Comments only, no activity log | MEDIUM |
| Watchers / subscriptions | Watch issues, get notified | Notification model exists, no delivery | MEDIUM |
| Voting | Vote on issues to prioritize | None | LOW |
| Labels management | CRUD labels at project level | Labels on issues but no management UI | LOW |

### Confluence Gaps

| Feature | Confluence | Axiom | Priority |
|---------|------------|-------|----------|
| Page templates | Pre-built templates (meeting notes, decision log, etc.) | None | MEDIUM |
| Inline comments | Comment on specific text ranges | None | MEDIUM |
| Page restrictions | Per-page view/edit permissions | Space-level only | LOW |
| Collaborative editing | Real-time multi-user editing | Single-user only | HIGH |
| Page attachments | Upload files, images | None (images via markdown URLs only) | HIGH |
| Macros / embeds | Jira issue embed, status macro, etc. | Mermaid only | MEDIUM |
| Space permissions | Fine-grained read/write per space | Team-level RBAC only | LOW |
| Full-text search in wiki | Search within page bodies | Basic search only | MEDIUM |
| Page labels / tags | Categorize pages with labels | None | LOW |
| Page move / copy | Move pages between spaces, reorder | None | LOW |
| Favorites / bookmarks | Star pages for quick access | None | LOW |

### Bitbucket Gaps

| Feature | Bitbucket | Axiom | Priority |
|---------|-----------|-------|----------|
| PR approvals with merge checks | Block merge until approvals + CI pass | Approvals exist, no merge blocking | HIGH |
| Merge strategies | Merge commit, squash, fast-forward | Single merge strategy only | MEDIUM |
| PR tasks | Checklist items within PR | None | LOW |
| Code owners | Auto-assign reviewers by file path | None | MEDIUM |
| Diff commenting on specific lines | Inline comments with suggestions | Inline comments exist, no suggestions | MEDIUM |
| Repository permissions | Per-repo user/group access | Visibility levels only (public/internal/private) | MEDIUM |
| LFS support | Large file storage | None | LOW |
| CI/CD integration | Bitbucket Pipelines with actual execution | Pipeline model exists, no executor | HIGH |
| Deployment environments | Dev/staging/prod tracking | None | MEDIUM |
| Repository insights | Commit frequency, contributor stats | None | LOW |
| Commit status checks | External CI reports status on commits | Model exists, no integration | HIGH |
| Default reviewers | Auto-add reviewers to PRs | None | LOW |

### Platform Gaps

| Feature | Atlassian | Axiom | Priority |
|---------|-----------|-------|----------|
| Email notifications | Full email notification system | Notification model, no delivery | HIGH |
| Real-time updates | WebSocket/SSE for live updates | None (poll on navigation) | HIGH |
| Audit logging | Complete audit trail | Model exists, not all mutations logged | MEDIUM |
| SSO / SAML / OIDC | Enterprise identity providers | Username/password + 2FA only | MEDIUM |
| User groups / teams RBAC | Fine-grained permission groups | Org/team roles only | LOW |
| API rate limiting per user | Per-user/token rate limits | Global rate limiting only | LOW |
| File uploads / attachments | Global attachment storage | None | HIGH |
| Backup / export | Full instance backup | Database only, no UI | LOW |
| Admin dashboard | System health, user management | None | MEDIUM |

---

## Implementation Roadmap

### Phase 1: Core Developer Experience (Highest Impact)

**1.1 Real-time Updates (WebSocket)**
- WebSocket server alongside Express
- Broadcast events: issue updated, PR merged, comment added, board moved
- Frontend: React Query automatic cache invalidation on WS events
- Eliminates stale data across tabs/users

**1.2 Email Notifications**
- SMTP integration (nodemailer)
- Notification preferences per user (email, in-app, none)
- Templates: issue assigned, PR review requested, mentioned, comment reply
- Notification center in UI (bell icon in header)
- Mark as read/unread, notification feed

**1.3 File Attachments**
- S3-compatible storage backend (MinIO for self-hosted)
- Upload API with drag-and-drop UI
- Attach files to issues, comments, wiki pages, PR comments
- Image preview in markdown (`![](attachment://id)`)
- Storage quota per org

**1.4 CI/CD Execution Engine**
- Docker-based pipeline executor
- Parse YAML config into job/step graph
- Execute steps in isolated containers
- Stream logs in real-time (WebSocket)
- Report commit status checks back to PRs
- Block PR merge when required checks fail

### Phase 2: Project Management Depth

**2.1 Sprint Planning**
- Sprint model (start date, end date, goal)
- Backlog view (unassigned issues)
- Sprint board (issues in current sprint)
- Velocity chart (story points completed per sprint)
- Sprint retrospective notes

**2.2 Epic Hierarchy**
- Epic > Story > Subtask parent-child relationships
- Epic progress bar (% of child issues closed)
- Epic board view (swimlanes by epic)
- Roadmap timeline view with epic bars

**2.3 Custom Fields**
- Schema: CustomFieldDefinition (name, type, projectId)
- Types: text, number, date, select, multi-select, user
- Per-project field configuration
- Display in issue detail sidebar
- Filterable in issue list

**2.4 Workflow Rules**
- Status transition rules (e.g., "In Progress" can only move to "Review" or "Blocked")
- Auto-actions on transition (e.g., assign reviewer when moved to Review)
- Required fields per status (e.g., require assignee for "In Progress")

**2.5 Automation Rules**
- Trigger: issue created, PR merged, comment added, label applied
- Condition: matches filter (type, priority, label, etc.)
- Action: change status, assign user, add label, add comment, send notification
- Rule builder UI

### Phase 3: Collaboration

**3.1 Collaborative Wiki Editing**
- Yjs or Automerge CRDT for real-time collaboration
- Presence indicators (who's viewing/editing)
- Cursor sharing
- Conflict-free concurrent edits

**3.2 Wiki Enhancements**
- Page templates (meeting notes, ADR, runbook, RFC)
- File attachments on pages (images, PDFs)
- Inline comments on text ranges
- Page labels/tags with search
- Page move/copy between spaces

**3.3 Activity Streams**
- Activity timeline on issues (status changes, assignee changes, label changes, not just comments)
- Activity feed per project/team
- User activity profile

**3.4 Mentions & Cross-references**
- @user mentions in comments/descriptions with notifications
- #issue-key references that auto-link
- Wiki page references in issues and vice versa

### Phase 4: Advanced Code Features

**4.1 Merge Strategies**
- Merge commit (default)
- Squash and merge
- Rebase and merge
- Per-repo default strategy setting

**4.2 Code Owners**
- CODEOWNERS file parsing
- Auto-assign reviewers based on changed files
- Required review from code owners before merge

**4.3 Commit Status Checks**
- API for external CI to report status on commits/PRs
- Status check display on PR page
- Required checks for branch protection

**4.4 PR Suggestions**
- Inline code suggestions in review comments
- One-click apply suggestion (creates commit)

**4.5 Repository Insights**
- Commit frequency graph
- Contributor statistics
- Language breakdown
- Code frequency (additions/deletions over time)

### Phase 5: Enterprise & Scale

**5.1 SSO / OIDC**
- OpenID Connect provider integration
- SAML 2.0 support
- Auto-provision users on first login
- Group-to-team mapping

**5.2 Admin Dashboard**
- System health metrics
- User management (create, disable, delete)
- Storage usage
- License management (if applicable)
- Global settings

**5.3 Advanced Search**
- Full-text search index (PostgreSQL tsvector or Elasticsearch)
- Code search across repositories
- JQL-like query language for issues
- Saved searches / filters

**5.4 API v2**
- REST API with OpenAPI spec
- Pagination on all list endpoints
- Webhook event expansion
- OAuth2 app integration

---

## MCP Integration Roadmap

The MCP server is a differentiator -- no Atlassian product offers native AI tool access.

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
