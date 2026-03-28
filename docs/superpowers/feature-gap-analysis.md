# Axiom vs Jira + Confluence + Bitbucket: Feature Gap Analysis

## Legend
- [x] Axiom has this feature
- [~] Axiom has partial support
- [ ] Missing from Axiom

---

## 1. Issue Tracking (vs Jira)

### Issue Types & Fields
- [x] Epic, Story, Task, Bug
- [x] **Sub-tasks** -- child issues under any issue type (generic parentId/children hierarchy on all issues, with ParentIssuePicker UI)
- [ ] **Custom issue types** -- admin-defined types with their own workflows
- [ ] **Issue type schemes** -- map which types are available per project
- [x] Priority levels (Critical, High, Medium, Low)
- [ ] **Blocker/Trivial priorities** -- Jira has 5 levels, Axiom has 4
- [x] Assignee, creator, due dates, story points
- [ ] **Reporter** (separate from creator)
- [ ] **Components** -- project-scoped categories (Backend, Frontend, API) with lead and default assignee
- [ ] **Fix Version / Affects Version** -- link issues to release versions
- [ ] **Environment field** -- free-text field for bug context
- [~] **Flagged/Impediment** -- custom fields of type SELECT can implement flags (no dedicated boolean, but infrastructure exists)
- [x] Watchers
- [x] Votes
- [x] Labels
- [x] Issue linking (blocks, relates to, duplicates)
- [x] Attachments
- [x] Time tracking (estimates, time spent)

### Workflows
- [x] Board columns as statuses
- [ ] **Named workflow transitions** -- directional links with names (e.g., "Start Progress")
- [ ] **Global transitions** -- move to a status from any other status
- [ ] **Transition conditions** -- gate who can execute (only assignee, only role X)
- [ ] **Transition validators** -- enforce data before completing (resolution required, field required)
- [ ] **Post-functions** -- side effects after transition (assign, send email, trigger webhook)
- [ ] **Workflow schemes** -- map different workflows to different issue types
- [ ] **Visual workflow editor** -- drag-and-drop designer
- [~] Workflow rules exist in schema but appear basic

### Boards
- [x] Kanban board with columns
- [ ] **Scrum board** -- separate board type with sprint-centric views
- [x] **Swimlanes** -- groupIssues() supports groupBy assignee, priority, epic, type with dropdown UI
- [ ] **Quick filters** -- toggleable JQL-based filters on boards
- [ ] **WIP limits** -- column constraints with visual indicators
- [ ] **Sub-columns** -- split a column (e.g., "In Progress" > "Working" + "Peer Review")
- [ ] **Card layout configuration** -- choose which fields display on cards
- [ ] **Card colors** -- color by priority, type, assignee, or custom rule
- [x] Board filtering with type, priority, assignee filters and saved quick filters (SavedFilter model fully implemented)

### Sprints & Backlog
- [x] Sprint creation, start, complete
- [x] Sprint backlog
- [x] **Sprint goal** -- Sprint model has goal field with inline editing UI in SprintCard
- [x] **Backlog ranking** -- Issue model has position field, updateable via issue update endpoint
- [x] **Multiple future sprints** -- backlog view shows PLANNING sprints alongside ACTIVE sprint
- [ ] **Sprint capacity planning** -- points/hours capacity per team member
- [x] Incomplete issue handling -- completeSprint() moves incomplete issues to another sprint or backlog via moveToSprintId

### Search & Filters
- [x] Full-text search
- [x] Saved filters
- [ ] **Query language (JQL equivalent)** -- structured query language with operators, functions, keywords
- [ ] **Basic search UI** -- form-based search that generates queries
- [ ] **Filter subscriptions** -- scheduled email delivery of filter results
- [ ] **Board-backed filters** -- every board backed by a query

### Dashboards & Gadgets
- [~] Dashboard exists with widgets
- [ ] **Custom dashboards** -- user-created dashboards with drag-and-drop gadgets
- [ ] **Dashboard sharing** -- share with team, project, or public
- [ ] **Wallboard mode** -- full-screen rotating dashboard
- [ ] **Gadget library** -- pie charts, 2D filter stats, created vs resolved, activity stream, etc.

### Reports
- [x] Velocity chart
- [x] Burndown chart
- [x] Time reports
- [ ] **Sprint report** -- completed vs incomplete with scope change tracking
- [ ] **Cumulative flow diagram** -- stacked area chart of statuses over time
- [ ] **Control chart** -- cycle time / lead time per issue
- [ ] **Epic report** -- progress across sprints
- [ ] **Epic burndown** -- remaining work in epic over time
- [ ] **Release burndown** -- work remaining toward a version
- [ ] **Version report** -- progress of issues in a version
- [ ] **Average age report** -- average unresolved issue age
- [ ] **Created vs resolved chart** -- trend comparison
- [ ] **Resolution time report** -- average time to resolve
- [ ] **Workload chart** -- distribution across assignees

### Roadmaps & Timeline
- [x] **Timeline view** -- Gantt-style timeline in Roadmap.tsx with week markers, today marker, and child issue progress bars
- [ ] **Dependency mapping** -- finish-to-start links between issues visualized
- [ ] **Multi-project planning** -- cross-project roadmap
- [ ] **Scenario planning** -- what-if plans without affecting live data
- [ ] **Auto-scheduling** -- based on dependencies, capacity, priorities

### Automation
- [x] **Automation rules** -- full engine with trigger evaluation, condition matching, and action execution (transition, assign, add label, add comment)
- [~] **Rich trigger types** -- evaluateRules() accepts trigger parameter and matches against enabled rules (may not cover all Jira events)
- [~] **Condition engine** -- matchesConditions() evaluates conditions array against context (not full JQL-style, but field matching exists)
- [~] **Action library** -- executeActions() supports transition, assign user, add label, add comment (not email/Slack/create issue)
- [ ] **Branching/loops** -- for-each over linked issues, sub-tasks
- [ ] **Smart values** -- template expressions for dynamic field access
- [ ] **Automation audit log** -- execution history with status and errors

### Permissions
- [x] Org roles (Owner, Admin, Member, Viewer, Guest)
- [x] Team roles (Admin, Member, Viewer)
- [ ] **Project roles** -- separate from team roles
- [ ] **Permission schemes** -- granular per-project permission mapping
- [ ] **Issue security levels** -- restrict issue visibility to specific roles/groups
- [ ] **Field-level permissions** -- restrict who can see/edit specific fields
- [ ] **Granular permissions** -- separate permissions for create, edit, delete, assign, transition, link, move issues

### Notifications
- [x] Notification inbox
- [x] Notification preferences
- [ ] **Notification schemes** -- per-project event-to-recipient mapping
- [x] **@mentions** -- parseMentions() + notifyMentions() with TipTap mention extension and autocomplete UI
- [x] **Email notifications** -- email queue system with HTML templates for mentions and other notification types
- [ ] **Notification batching/digest** -- reduce volume

### Other Jira Features
- [x] Bulk operations
- [x] CSV export
- [ ] **CSV import** -- bulk create issues from CSV
- [ ] **Bulk transition** -- move multiple issues through workflow
- [ ] **Bulk move** -- move issues between projects with field remapping
- [ ] **Versions/Releases management** -- create, track, release versions tied to issues
- [ ] **Components** -- categorize issues by architectural area
- [ ] **Issue archiving** -- archive old issues to reduce clutter

---

## 2. Wiki / Documentation (vs Confluence)

### Spaces & Pages
- [x] Wiki spaces (team-level)
- [x] Page hierarchy (parent-child)
- [x] Page templates
- [ ] **Space types** -- personal spaces, knowledge base spaces
- [ ] **Space categories** -- tag spaces for filtering
- [ ] **Space directory** -- searchable listing of all spaces
- [ ] **Space archive** -- soft-hide inactive spaces
- [ ] **Page aliases** -- alternative URLs
- [x] **Page copying** -- copyPage() duplicates to same or different space with new slug
- [x] **Page moving** -- movePage() relocates to different parent/space with slug uniqueness and circular reference checks
- [ ] **Page archiving** -- soft-remove from tree
- [x] **Unpublished drafts** -- Page model has isDraft field, supported in create and update operations

### Editor & Content
- [x] Rich text editing (TipTap)
- [x] Real-time collaborative editing (Yjs)
- [x] Markdown support
- [x] **Slash commands** -- SlashCommandExtension with `/` menu for quick insert of headings, lists, code blocks, callouts, tables, etc.
- [ ] **Layouts** -- two/three-column page layouts
- [x] **Tables** -- TipTap Table extension with TableRow, TableCell, TableHeader; insertTable() with 3x3 default; serializes as markdown pipe tables
- [x] **Info/warning/note panels** -- CalloutExtension with info, warning, note, success, error types; serializes as GFM alerts (`> [!NOTE]`)
- [x] **Expand/collapse sections** -- CollapsibleExtension with custom title; serializes as `> [!DETAILS]` markdown
- [x] **Table of contents** -- TableOfContentsExtension auto-generated from headings; serializes as `[TOC]` marker
- [ ] **Status lozenges** -- inline colored status labels
- [ ] **Date picker** -- inline date stamps
- [x] **Task lists** -- TaskList/TaskItem extensions with checkboxes; serializes as `- [ ]` markdown
- [ ] **Media embeds** -- YouTube, Figma, Loom, Miro, etc.
- [x] **Code blocks** -- CodeBlockLowlight with syntax highlighting, plus MermaidBlock for diagram rendering
- [x] **Markdown export** -- all editor content (callouts, collapsibles, TOC, tables) serializes as pure markdown for MCP/AI consumption

### Templates & Blueprints
- [x] Page templates (basic)
- [ ] **Template variables** -- prompt users for values when creating from template
- [x] **Built-in blueprints** -- meeting notes, retrospective, decision record, product requirements, runbook (5 blueprints with template picker UI on new pages)
- [x] **Create from template button** -- template picker shown on new page creation with preview pane and built-in/custom sections

### Comments
- [x] Page comments
- [x] Inline comments
- [x] **Comment resolution** -- PageComment has resolved field with resolveComment() toggle endpoint
- [ ] **Reactions** -- emoji reactions on comments
- [x] **@mentions in comments** -- TipTap mention extension used in all editors including comments, with backend notification

### Search
- [x] Full-text search across wiki pages
- [ ] **CQL (query language)** -- structured queries for content
- [ ] **Search filters** -- by space, contributor, date, content type
- [x] **Search within space** -- search input in wiki sidebar filters pages within the current space
- [ ] **Attachment content search** -- index file contents

### Labels & Organization
- [x] Page labels
- [ ] **Content by label** -- dynamic lists matching label criteria
- [ ] **Popular labels** -- most-used labels across spaces
- [x] **Starred/favorite pages** -- toggleStar/checkStarred/getStarredPages endpoints with star button in page header

### Versioning & History
- [x] Page version history
- [x] **Version comparison** -- diffVersions() API compares any two versions
- [x] **Version restore** -- restoreVersion() API reverts to any previous version
- [x] **Change description** -- changeDescription field on page update, shown in version history

### Permissions
- [ ] **Space permissions** -- granular per-space (view, add, edit, delete, admin)
- [x] **Page restrictions** -- per-page view/edit restrictions with getRestrictions/setRestrictions/removeRestriction endpoints and UI
- [ ] **Inherited restrictions** -- child pages inherit parent restrictions
- [ ] **Anonymous/public access** -- for public-facing spaces
- [ ] **Public share links** -- share without login

### Export
- [x] **PDF export** -- exportPage() supports pdf format
- [x] **Word export** -- exportPage() supports docx format
- [x] **HTML export** -- exportPage() supports html format (also epub, latex, plain)
- [ ] **Print view** -- print-friendly rendering

### Blog Posts
- [ ] **Blog posts** -- date-stamped posts within spaces
- [ ] **Blog feed** -- chronological listing

### Analytics
- [x] **Page analytics** -- recordView/getAnalytics endpoints tracking view count and unique viewers with UI in page header
- [ ] **Space analytics** -- most viewed pages, active contributors
- [ ] **Content gap analysis** -- stale/unvisited pages

### Macros
- [ ] **Macro system** -- embeddable content widgets (Jira issues, charts, children display, page tree, recently updated, content by label, galleries, RSS, etc.)

---

## 3. Git Hosting (vs Bitbucket)

### Repository Management
- [x] Create, list, update, delete repos
- [x] Visibility (private, internal, public)
- [x] Fork repos
- [x] Default branch configuration
- [x] Merge strategy defaults (merge, squash, rebase)
- [ ] **Repository archiving** -- mark as read-only
- [ ] **Repository transfer** -- move between teams
- [ ] **Branching model** -- define branch type prefixes (feature/, bugfix/, release/, hotfix/)
- [x] **README rendering** -- auto-detects README.md in file tree, renders with MarkdownRenderer on repo landing page

### Code Browsing
- [x] File tree browsing at any ref
- [x] File contents with syntax highlighting
- [x] Blame view
- [x] Commit history
- [x] Branch management (list, create, delete)
- [x] Tag listing
- [x] Diff between refs
- [ ] **Image diff** -- visual comparison for image changes
- [ ] **Directory README** -- auto-render in directory views
- [ ] **Commit graph** -- visual branch/merge history
- [ ] **Raw file download**

### Pull Requests
- [x] Create PRs with source/target branches
- [x] PR statuses (open, merged, closed)
- [x] Merge strategies (merge, squash, rebase)
- [x] Link issues to PRs
- [ ] **PR description templates** -- default template per repo
- [ ] **Default reviewers** -- auto-assign reviewers per branch pattern
- [ ] **Auto-merge** -- merge when all checks pass
- [ ] **Close source branch** -- option to delete branch on merge
- [ ] **PR activity feed** -- chronological log of comments, approvals, builds, pushes

### Code Review
- [x] PR reviews (approved, changes requested, commented)
- [x] Inline comments on files/lines
- [ ] **Comment threads** -- nested replies on comments
- [ ] **PR tasks** -- create actionable tasks from comments; block merge until resolved
- [x] **Code suggestions** -- ```suggestion blocks parsed and applied via applySuggestion() with one-click apply in PR UI
- [ ] **Outdated comments** -- flag comments on subsequently modified code
- [ ] **Review status per file** -- mark files as viewed/reviewed
- [ ] **File tree in PR** -- navigate changed files via tree

### Branch Protection
- [x] Branch protection rules
- [x] Commit status enforcement
- [x] Code owner approval
- [x] **Minimum approvals count** -- BranchProtection requiredReviews field, enforced before merge
- [ ] **No unresolved tasks** -- block merge until PR tasks resolved
- [x] **Force push restrictions** -- BranchProtection noForcePush field enforced in protection service
- [~] **Branch deletion restrictions** -- default branch deletion prevented (not arbitrary branch patterns)
- [ ] **Signed commits required**

### CI/CD Pipelines
- [x] Pipeline definitions per repo
- [x] Pipeline triggers on refs
- [x] Pipeline structure (run > job > step)
- [x] Commit status integration
- [~] **Pipeline config file** -- Pipeline model has yamlContent field with YAML parsing (stored in DB, not read from repo file)
- [ ] **Parallel steps** -- run steps concurrently
- [ ] **Docker-based steps** -- each step in a specified Docker image
- [ ] **Service containers** -- spin up databases/caches alongside builds
- [ ] **Dependency caching** -- cache node_modules, pip, etc. across builds
- [ ] **Artifacts** -- pass files between steps; downloadable
- [ ] **Pipeline variables** -- repo/workspace/deployment-level variables (with masking)
- [ ] **Self-hosted runners** -- run on own infrastructure
- [ ] **Pipes/reusable components** -- pre-built pipeline plugins
- [ ] **Conditional steps** -- based on branch, variable, file changes
- [ ] **Pipeline badges** -- build status badges for README
- [ ] **Scheduled pipelines** -- cron-triggered builds
- [x] **Manual triggers** -- TriggerType enum includes MANUAL, used in pipeline service
- [ ] **Pipeline dashboard** -- filter by branch/status

### Deployments
- [x] Deployment environments
- [x] Environment variables
- [x] Deployment history
- [ ] **Deployment dashboard** -- current state of each environment
- [~] **Deployment gates** -- DeploymentEnvironment has protectionRules Json field (enforcement may not be fully implemented)
- [ ] **Deployment permissions** -- restrict who can deploy to production
- [ ] **Rollback** -- re-run previous deployment

### Releases
- [x] Releases with tag, notes, draft/prerelease flags
- [ ] **Binary attachments** -- attach build artifacts to releases
- [ ] **Auto-generated release notes** -- from commits/PRs since last release

### Other Bitbucket Features
- [ ] **Snippets** -- shareable code fragments (like GitHub Gists)
- [x] **Code search** -- searchCode() for cross-repo code search with dedicated API endpoint
- [ ] **Smart commits** -- trigger Jira actions from commit messages
- [ ] **Code insights** -- display coverage, SAST, analysis results inline in PR diffs
- [ ] **Git LFS** -- large file storage support
- [ ] **Access/deploy keys** -- per-repo read-only SSH keys for CI
- [ ] **IP allowlisting** -- restrict access by IP range
- [ ] **Commit comments** -- comment on specific lines in any commit (not just PRs)

---

## 4. Cross-Product Integration Gaps

- [ ] **Smart Links** -- rich previews when pasting URLs across products
- [ ] **Development panel in issues** -- unified view of branches, commits, PRs, builds, deployments linked to an issue
- [ ] **Smart commits** -- update issues from commit messages (`AXM-123 #time 2h #comment Fixed #resolve`)
- [ ] **Auto-link branches to issues** -- via issue key in branch name
- [x] **Cross-product search** -- cross-resource search across issues, wiki pages, repos, and code with SearchResults UI
- [x] Issue-PR linking (manual)
- [x] Issue-commit linking
- [x] Issue-branch linking
- [ ] **Wiki-issue linking** -- embed issue lists/status in wiki pages

---

## 5. Priority Recommendations

### High Priority (Core Workflow Gaps)
1. **Query language** -- power users need structured search (JQL equivalent)
2. **PR comment threads** -- nested replies for code review discussions
3. ~~**Version comparison in wiki**~~ -- DONE: diffVersions API
4. ~~**Page restrictions**~~ -- DONE: per-page view/edit restrictions
5. **PR description templates** -- consistency in code review

### Medium Priority (Productivity Gaps)
6. Components for issues
7. Fix Version / Affects Version
8. WIP limits on board columns
9. Card layout configuration
10. Quick filters on boards
11. Dashboard customization with gadgets
12. More report types (cumulative flow, control chart, epic report)

### Lower Priority (Nice-to-Have)
13. Blog posts in wiki
14. Snippets (code sharing)
15. Smart commits
16. Macros system for wiki
17. Space categories/directory
18. Code insights / analysis annotations
19. Git LFS
20. Scenario planning / advanced roadmaps

---

## 6. Gap Summary by Product

| Product | Implemented [x] | Partial [~] | Missing [ ] | Total | Coverage |
|---------|-----------------|-------------|-------------|-------|----------|
| Issue Tracking (vs Jira) | 35 | 6 | 60 | 101 | 35% |
| Wiki (vs Confluence) | 36 | 0 | 28 | 64 | 56% |
| Git Hosting (vs Bitbucket) | 35 | 3 | 43 | 81 | 43% |
| Cross-Product Integration | 4 | 0 | 5 | 9 | 44% |
| **Total** | **110** | **9** | **136** | **255** | **43%** |
