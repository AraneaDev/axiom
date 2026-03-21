# Plan: Consistency, Component Usage & Refactoring

## Devil's Advocate Assessment

The codebase works, ships features fast, and has solid architectural bones (32 modules, clean controller/service/routes separation, TanStack Query everywhere, design tokens). But it has accumulated debt in three categories: **shared component adoption** (102 raw HTML elements bypassing the design system), **god objects** (5 files over 1000 lines), and **validation gaps** (60% of controllers skip input validation). Left unchecked, these create visual inconsistency, make services unmaintainable, and leave the API surface exposed to malformed input.

The counter-argument: most of these are internal quality issues, not user-facing bugs. Refactoring a 1141-line service file doesn't ship features. But the god objects are already causing merge conflicts and making it hard to reason about side effects. The raw HTML elements create subtle visual inconsistency. The validation gaps are a security surface. This work pays compound interest.

---

## Phase 1: Shared Component Compliance (Frontend)

**Goal**: Every interactive element uses the design system. Zero raw `<button>`, `<input>`, `<select>` elements.

### 1A. Replace raw `<button>` with `Button` (63 instances)

Priority files (most violations):
| File | Raw buttons | Notes |
|------|------------|-------|
| `ColumnManager.tsx` | ~8 | Drag handles can stay, action buttons must use Button |
| `IssueList.tsx` | ~6 | Filter chips, sort toggles |
| `Board.tsx` | ~5 | Column headers, drag handles |
| `Backlog.tsx` | ~6 | Sprint actions, issue rows |
| `SearchResults.tsx` | ~4 | Tab buttons, filter toggles |
| `NotificationInbox.tsx` | ~3 | Already fixed some, check remaining |
| `CommitDetail.tsx` | ~3 | Copy SHA, file toggles |
| `CustomFieldSettings.tsx` | ~4 | CRUD actions |
| `LabelsSettings.tsx` | ~4 | Color pickers, CRUD |
| `IssueTemplates.tsx` | ~4 | Template management |
| 12+ other files | ~16 | Scattered single violations |

**Rule**: Every `<button>` must become `<Button>` with a Lucide icon. Icon-only buttons need `title` prop.

### 1B. Replace raw `<input>` with `Input` (35 instances)

Priority files:
- `IssueDetailWorklog.tsx` (4), `IssueDetailSidebar.tsx` (3), `ColumnManager.tsx` (2)
- `IssueListTable.tsx` (3), `BranchProtectionSettings.tsx` (4), `CustomFieldSettings.tsx` (4)
- `LabelsSettings.tsx` (2), `CustomFieldRenderer.tsx` (3)
- `CommandPalette.tsx` (1) -- search input, may need custom styling
- `FileUpload.tsx` (1) -- file input, may need raw element

**Exception**: File inputs (`type="file"`) and hidden inputs can stay raw.

### 1C. Replace raw `<select>` with `Select`/`Dropdown` (4 instances)

- `CreateRepo.tsx`, `CustomFieldSettings.tsx`, `IssueTemplates.tsx`, pagination component

### 1D. Remove inline `style={{}}` attributes (6 files)

- `Roadmap.tsx` (8 instances -- likely for dynamic positioning, needs review)
- `IssueDetailSidebar.tsx`, `Backlog.tsx`, `PageView.tsx`, `InsightsTab.tsx`, `LabelsSettings.tsx`

Replace with Tailwind utilities or CSS variables where possible. Dynamic positioning (e.g., Roadmap timeline) may need inline styles -- mark as exceptions.

---

## Phase 2: Loading & Empty State Standardization (Frontend)

### 2A. Standardize loading patterns

| Context | Pattern |
|---------|---------|
| Full page initial load | `PageLoader` |
| List/table loading | `Skeleton` / `ListSkeleton` |
| Button action pending | `mutation.isPending` + disabled state |
| Lazy route loading | `SuspenseLoader` (already in App.tsx) |

Audit all pages and normalize. ~12 files use inconsistent patterns.

### 2B. Add EmptyState to all data-driven lists

Check every page that renders a list and ensure it shows `<EmptyState>` when the list is empty with an appropriate icon, title, description, and optional action button.

Files to check: `UserManagement`, `AuditLogs`, `PRList`, `SearchResults` (partially done), all settings pages with lists.

---

## Phase 3: Backend God Object Refactoring

### 3A. Split `issues.service.ts` (1141 lines -> 4 files)

| New File | Methods | Lines |
|----------|---------|-------|
| `issues.service.ts` | create, get, list, update, remove, bulkUpdate, exportCsv | ~400 |
| `issue-comments.service.ts` | addComment, updateComment, deleteComment | ~100 |
| `issue-time.service.ts` | logWork, getWorklogs, getTimeReport | ~150 |
| `issue-hierarchy.service.ts` | setParent, getChildren, getIssuePullRequests | ~100 |

Keep `issue-links.service.ts` and `issue-branches.controller.ts` as they already exist.

### 3B. Split `pulls.service.ts` (1011 lines -> 3 files)

| New File | Methods | Lines |
|----------|---------|-------|
| `pulls.service.ts` | create, get, list, update, close, merge, getDiff, getCommits | ~450 |
| `pull-reviews.service.ts` | addReview, getReviews, submitReview | ~250 |
| `pull-comments.service.ts` | addComment, getComments, updateComment, deleteComment, suggestions | ~300 |

### 3C. Split `mcp/server.ts` (1383 lines -> domain files)

| New File | Tools |
|----------|-------|
| `mcp/tools/issues.ts` | Issue-related MCP tools |
| `mcp/tools/repos.ts` | Repo/git MCP tools |
| `mcp/tools/wiki.ts` | Wiki MCP tools |
| `mcp/tools/search.ts` | Search MCP tools |
| `mcp/server.ts` | Server setup, tool registration (~200 lines) |

### 3D. Split large frontend pages (>700 lines)

| File | Lines | Split into |
|------|-------|-----------|
| `PRDetail.tsx` (971) | Extract `PRHeader`, `PRDiffView`, `PRReviewPanel` |
| `Backlog.tsx` (731) | Extract `SprintCard`, `BacklogIssueRow`, `SprintFormModal` |
| `IssueDetailSidebar.tsx` (723) | Extract `LinkedIssuesSection`, `DevelopmentCard` (done), `WorklogSection` |
| `IssueList.tsx` (677) | Already has `IssueListTable`, `IssueListFilters` extracted. Extract remaining filter bar |
| `PageView.tsx` (642) | Extract `PageHeader`, `PageContent`, `PageSidebar` |
| `Board.tsx` (599) | Extract `BoardColumn`, `BoardCard` (partially done), `BoardFilters` |

---

## Phase 4: Error Handling & Validation

### 4A. Fix raw `throw new Error()` (11 instances)

Replace with `AppError(statusCode, message)`:
- `mcp/mcp-permissions.ts` (1)
- `pipelines/executor.ts` (1)
- `pipelines/pipeline-runner.ts` (1)
- `pipelines/pipeline-parser.ts` (2)
- `git/repo-manager.ts` (1)
- `git/ssh-server.ts` (5)

### 4B. Add input validation to 22 unvalidated controllers

Priority (user-facing, accept body/params):
1. `admin.controller.ts` -- updateUser, deleteUser
2. `attachments.controller.ts` -- upload filters
3. `deployments.controller.ts` -- create, update
4. `releases.controller.ts` -- create, update
5. `sprints.controller.ts` -- create, update
6. `workflows/workflow.controller.ts` -- createRule, updateRule

Lower priority (mostly read-only):
7. `activity.controller.ts`
8. `code-owners.controller.ts`
9. `status-checks.controller.ts`

### 4C. Add explicit return types to 14 exported functions

Files: `code-owners.service.ts`, `admin.service.ts`, `teams.service.ts`, `search.service.ts`, `workflows/workflow.service.ts`, `orgs.service.ts`, `labels.service.ts`

---

## Phase 5: Test Coverage Expansion

### Currently untested modules (22):

| Module | Priority | Why |
|--------|----------|-----|
| `notifications` (email integration) | HIGH | New code, needs coverage |
| `deployments` | MEDIUM | CRUD + state machine |
| `releases` | MEDIUM | CRUD + tagging |
| `sprints` | MEDIUM | CRUD + issue association |
| `workflows` | MEDIUM | Rule evaluation logic |
| `automation` | MEDIUM | Trigger/action execution |
| `pipelines` | MEDIUM | Complex executor logic |
| `invitations` | LOW | Simple CRUD |
| `saved-filters` | LOW | Simple CRUD |
| `status-checks` | LOW | Simple CRUD |
| `custom-fields` | LOW | CRUD + validation |
| `labels` | LOW | Simple CRUD |

---

## Phase 6: Code Deduplication

### 6A. Centralize query keys

Create `frontend/src/api/queryKeys.ts`:
```typescript
export const queryKeys = {
  orgs: ['orgs'] as const,
  teams: (orgId: string) => ['teams', orgId] as const,
  projects: (teamId: string) => ['projects', teamId] as const,
  issues: (projectId: string) => ['issues', projectId] as const,
  // ...
};
```

### 6B. Extract repeated Prisma selects

Add to `prisma-selects.ts`:
- `TEAM_WITH_ORG_SELECT` (used in 6+ files)
- `PROJECT_WITH_TEAM_ORG_SELECT` (used in 8+ files)
- `REPO_WITH_TEAM_SELECT` (used in 4+ files)

---

## Execution Order

| Phase | Effort | Risk | Impact |
|-------|--------|------|--------|
| 4A. Fix raw throws | 1h | Low | Security |
| 1A-C. Button/Input/Select | 4h | Low | Visual consistency |
| 2A-B. Loading/Empty states | 2h | Low | UX polish |
| 3A. Split issues.service | 3h | Medium | Maintainability |
| 3B. Split pulls.service | 3h | Medium | Maintainability |
| 4B. Input validation | 4h | Low | Security |
| 3D. Split large pages | 6h | Medium | Maintainability |
| 3C. Split MCP server | 3h | Medium | Maintainability |
| 5. Test coverage | 8h | Low | Reliability |
| 6. Deduplication | 2h | Low | DRY |
| 4C. Return types | 1h | Low | Type safety |

Total: ~37h of focused refactoring work.
