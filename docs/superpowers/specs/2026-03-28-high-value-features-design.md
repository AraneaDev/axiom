# High-Value Feature Targets: Design Spec

**Date:** 2026-03-28
**Goal:** User acquisition for small-to-mid teams (5-50 devs)
**Positioning:** All-in-one platform, Markdown everywhere, MCP-native

---

## Strategy

Select ~10 features that do double duty: remove adoption blockers AND showcase the "everything is connected" story. Skip enterprise complexity that small-to-mid teams are fleeing from.

### Tier 1 — Adoption Blockers
1. Development panel in issues
2. Smart commits
3. Space permissions
4. Sprint report

### Tier 2 — Integration Multipliers
5. Auto-link branches to issues
6. PR description templates
7. Smart Links

### Tier 3 — Board Polish
8. WIP limits
9. Card colors

### Cross-cutting
10. Documentation for all features

---

## Feature 1: Development Panel in Issues

### Overview
A sidebar panel on every issue page that aggregates all linked development activity: branches, commits, PRs, and pipeline runs.

### What It Shows
- **Branches** — any branch containing the issue key (e.g., `feature/AXM-42-login`), with status (ahead/behind)
- **Commits** — commits linked via issue key in message or explicit linking
- **Pull Requests** — PRs linked to the issue, with status badge (open/merged/closed) and review state
- **Builds/Pipelines** — latest pipeline run status for linked PRs/branches

### How It Works
- Passive linking via issue key detection in branch names and commit messages (e.g., `AXM-42` anywhere in the string)
- Active linking via the existing issue-PR and issue-commit link models
- New `GET /api/issues/:id/development-summary` endpoint that aggregates all linked dev activity in one call
- Frontend: collapsible panel on the issue detail sidebar, always visible

### Differentiator
- MCP server exposes this as a single tool call — an AI agent can ask "what's the development status of AXM-42?" and get branches, PRs, builds, and commits in one response
- Markdown-rendered commit messages and PR descriptions inline

### Scope
Medium. Frontend aggregation view + auto-detection logic + one new API endpoint. The data relationships mostly exist already.

---

## Feature 2: Smart Commits

### Overview
Parse commit messages to automatically execute actions on issues. A commit message like `AXM-42 #time 2h #comment Fixed the auth bug #resolve` logs time, adds a comment, and transitions the issue.

### Supported Directives
- `#time <duration>` — log time (supports `2h`, `30m`, `1h30m`)
- `#comment <text>` — add a comment (text runs until next `#` directive or end of line)
- `#resolve` / `#close` / `#reopen` — transition issue status
- `#assign <username>` — reassign the issue
- `#label <name>` — add a label

### How It Works
- Hook into the existing git push receive flow (post-receive processing)
- Parse each commit message for issue key patterns (`[A-Z]+-\d+`)
- Extract directives after the issue key
- Execute actions using existing service layer (time tracking, comments, transitions already exist)
- Record which commits were processed to avoid re-processing on force pushes

### Differentiator
- Markdown-native workflow — commit messages are the interface
- MCP server can report on smart commit activity
- Zero configuration — just works if your commit contains an issue key

### Scope
Medium. New parser + git push hook integration. All action execution already exists in the issue service layer.

---

## Feature 3: Space Permissions

### Overview
Granular per-space access control for wiki spaces. Teams can restrict who can view, edit, or admin a space.

### Permission Levels
- **View** — can read pages in the space
- **Edit** — can create/edit pages (implies view)
- **Admin** — can manage space settings, permissions, delete pages (implies edit)

### How It Works
- New `SpacePermission` model linking space + user/team role + permission level
- Permissions checked via middleware on all wiki routes scoped to a space
- Default: space inherits from team visibility (existing team membership = view+edit access)
- Space admins can restrict down from there

### UI
- New "Permissions" tab in space settings
- Table showing current grants (user/role + level)
- Add permission: select user or role, select level
- Lucide lock icon on space sidebar for restricted spaces

### Design Decisions
- No inherited page restrictions — space permissions are the coarse gate, existing per-page restrictions are the fine gate. They don't cascade.
- Team-role based, not individual-only — can grant "all team admins get edit, all members get view"
- No anonymous/public access — enterprise feature, skip for now

### Scope
Medium. New model, permission checking middleware, settings UI. Pattern is well-established from team roles.

---

## Feature 4: Sprint Report

### Overview
A dedicated report showing what happened during a sprint: completed vs incomplete issues, with scope change tracking.

### What It Shows
- **Summary bar** — total committed vs completed (story points and issue count)
- **Completed issues** — list with type, key, title, points, final status
- **Incomplete issues** — same, with where they went (back to backlog, moved to next sprint)
- **Scope changes** — issues added after sprint start (flagged "added mid-sprint") and issues removed before sprint end
- **Scope change timeline** — simple list showing when issues were added/removed

### How It Works
- New `SprintHistory` model (or extend existing) recording `issueId, sprintId, action (added/removed), timestamp`
- Record a history entry whenever an issue is added to or removed from a sprint
- On sprint start, snapshot the current membership as the "committed" set
- New endpoint: `GET /api/sprints/:id/report`
- Frontend: new page accessible from sprint dropdown or reports section

### Design Decisions
- Show both points and count — some teams use points, some don't
- No burndown in this view — existing burndown chart is complementary
- Accessible for past sprints — any completed sprint can be viewed

### Scope
Medium. New history tracking model, one API endpoint, one report page.

---

## Feature 5: Auto-link Branches to Issues

### Overview
When a branch name contains an issue key (e.g., `feature/AXM-42-login-fix`), automatically create a link between the branch and the issue.

### How It Works
- On git push, scan the pushed ref name for issue key patterns (`[A-Z]+-\d+`)
- If found, create an issue-branch link using existing linking infrastructure
- Same detection runs on branch creation via the API
- Idempotent — if the link already exists, skip

### Pairs With
- Development panel — auto-linked branches show up immediately
- Smart commits — branch-level context enriches commit parsing
- MCP — "what branches are active for AXM-42?" just works

### Scope
Small. Regex match + call to existing linking logic, hooked into git push flow alongside smart commits.

---

## Feature 6: PR Description Templates

### Overview
Per-repo Markdown templates that pre-fill the PR description when creating a new pull request.

### How It Works
- New `prTemplate` text field on the Repository model (stored as Markdown)
- Repo settings UI: "PR Template" tab with a Markdown editor
- When creating a PR, frontend pre-fills the description with the template if one exists
- User can edit freely before submitting

### Design Decisions
- Single template per repo — no multiple templates by branch pattern
- Stored in DB, not in-repo file — consistent with pipeline config storage
- No variable interpolation — just static Markdown. Teams add their own section headers and checklists.

### Differentiator
- Template IS Markdown — checklists, headings, sections just work
- MCP can read/update templates programmatically

### Scope
Small. One field on the model, a settings tab, pre-fill on PR creation.

---

## Feature 7: Smart Links

### Overview
When a user pastes an Axiom URL into any rich text editor, it renders as a rich inline preview instead of a plain URL.

### Preview Content
- **Issues:** icon + key + title + status badge + assignee avatar
- **PRs:** icon + repo + PR number + title + status (open/merged/closed)
- **Wiki pages:** icon + space + page title
- **Commits:** icon + short SHA + first line of message

### How It Works
- TipTap extension that intercepts paste events containing Axiom URLs
- Parses the URL to determine resource type and ID
- Fetches metadata via new `GET /api/resolve-link?url=...` endpoint
- Renders as a custom inline TipTap node with preview data
- Falls back to plain link if resource doesn't exist or user lacks access

### Where It Works
- Issue descriptions and comments
- Wiki pages
- PR descriptions and comments
- Anywhere TipTap is used

### Design Decisions
- Fetch on paste, cache in node — preview data snapshotted, not live-updating
- Internal URLs only — no external URL unfurling
- Respects permissions — shows "Restricted" badge if viewer can't access the linked resource

### Scope
Medium. New TipTap extension, one API endpoint, custom node rendering.

---

## Feature 8: WIP Limits

### Overview
Set a maximum number of issues per board column. Visual warning when exceeded.

### How It Works
- New `wipLimit` integer field on board column model (nullable — no limit by default)
- Board settings UI: inline editable number next to each column name
- When column issue count exceeds limit, column header shows warning color and count like `5 / 3`
- Advisory, not enforced — issues can still be dragged into over-limit columns

### Design Decisions
- Advisory, not blocking — visual warning is what most teams want
- Count-based only — no story-point-based limits
- No per-swimlane limits — applies to whole column

### Scope
Small. One field, minor board settings UI, conditional styling.

---

## Feature 9: Card Colors

### Overview
Color-coded left border on issue cards in board view, based on a configurable attribute.

### How It Works
- Board setting: "Color cards by" dropdown — priority, type, or none (default: none)
- Each priority/type gets a consistent color mapped via CSS variables (e.g., `--card-color-critical`, `--card-color-bug`)
- Rendered as a 4px left border on the card
- Small legend at top of board showing the color mapping

### Design Decisions
- Left border, not full background — keeps cards readable
- Board-level setting, not per-user — whole team sees same colors
- Two modes only — priority and type. No custom field coloring.
- Colors from design tokens — follows existing CSS variable system

### Scope
Small. One board setting, color mapping object, conditional border styling.

---

## Feature 10: Documentation

### Approach
Each feature gets documented alongside its implementation, not batched at the end.

### Where Docs Go
- **API Reference** (`docs/api-reference.md`) — new endpoints for development panel, smart commits, sprint report, resolve-link
- **MCP Server** (`docs/axiom-mcp-server.md`) — new/updated MCP tools exposing development panel, smart commits, sprint report
- **Architecture** (`docs/architecture.md`) — smart commit processing in git push flow, space permissions model
- **Design Patterns** (`docs/design-patterns.md`) — Smart Link TipTap extension, card color token mapping
- **Feature guide** (`docs/features.md`) — new file covering all 9 features with usage examples, written for end users

Each implementation task includes an "update docs" sub-step.

---

## Dependencies & Ordering

```
Auto-link branches ──┐
                     ├──> Development panel (needs branch + commit linking working)
Smart commits ───────┘

Space permissions ──────> (independent)
Sprint report ──────────> (independent)
PR description templates > (independent)
Smart Links ────────────> (independent, but benefits from all other features existing)
WIP limits ─────────────> (independent)
Card colors ────────────> (independent)
```

**Recommended build order:**
1. Auto-link branches + Smart commits (git push hooks, build together)
2. Development panel (consumes the linking from step 1)
3. Space permissions (independent, high value)
4. Sprint report (independent, high value)
5. PR description templates (small, quick win)
6. WIP limits + Card colors (small, can parallelize)
7. Smart Links (benefits from all other features existing for richer previews)
8. Documentation finalized (ongoing, but final pass at end)
