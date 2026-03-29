# Codebase Audit - Raw Findings

**Date:** 2026-03-28
**Scope:** Full codebase scan across 5 dimensions

---

## 1. Frontend Design Rule Violations

**Overall: Excellent compliance.** Only minor issues found.

| # | Issue | Location | Severity |
|---|-------|----------|----------|
| F1 | `useEffect` + `fetch` instead of TanStack Query | `components/ui/AttachmentList.tsx:35-38` (AuthImage component) | Medium |
| F2 | Inline SVG for charts (custom chart rendering) | `components/BurndownChart.tsx:96`, `components/VelocityChart.tsx:48` | Low |
| F3 | Inline SVG in test files (mock icons) | `Button.test.tsx:85`, `Badge.test.tsx:64`, `EmptyState.test.tsx:18` | Negligible |

**Passes:** No emojis, no non-Lucide icons, no direct Tailwind colors, no text-only buttons, correct `react-router` imports.

---

## 2. Duplicate Code & Abstraction Opportunities

### High Impact

| # | Pattern | Files Affected | LOC | Suggested Abstraction |
|---|---------|---------------|-----|----------------------|
| D1 | Modal form boilerplate (useState + useQuery + useMutation + Modal JSX) | `CreateBranchModal`, `IssueLinkModal`, `SprintFormModal`, `CreateReleaseModal`, `CreateFolderModal` | ~1,100 | `useModalForm()` hook + `FormModal` wrapper |
| D2 | Detail page layout (main + sidebar + comments + metadata) | `IssueDetail`, `PRDetail`, `CommitDetail`, `RepoDetail`, `PipelineRunDetail` + panels | ~3,000+ | `DetailPageLayout` grid component |
| D3 | List page structure (filters + table/cards + pagination + bulk actions) | `IssueList`, `PRList`, `RepoList`, `EnvironmentsList`, `TeamList` + related | ~2,000+ | `ListPage` container component |
| D4 | Card container class repeated | 46+ files, 172 occurrences of `rounded-lg border border-border bg-surface p-4` | N/A | Enforce existing `Card.tsx` component |

### Medium Impact

| # | Pattern | Files Affected | Suggested Abstraction |
|---|---------|---------------|----------------------|
| D5 | Sidebar/panel layout | `IssueDetailFieldsPanel` (365 LOC), `IssueDetailMetaPanel`, `IssueDetailSidebar`, `PRReviewPanel`, `PageViewSidebar` | `SidebarPanel` component |
| D6 | Error display blocks | `CreateBranchModal`, `CreateFolderModal`, `CreateReleaseModal` | Standardize with shared `ErrorBlock` component |
| D7 | Service error pattern (findUnique + throw AppError) | All 63 service files | `findOrThrow()` utility (exists but underused) |

### Low Impact / Already Handled

- Settings pages: Already well-abstracted with `SettingsPage` component
- Icon sizing (`h-3 w-3`, `h-4 w-4`): Common Tailwind pattern, not worth abstracting
- `flex items-center justify-between`: Standard utility combo, not worth abstracting

---

## 3. Performance Issues

### High Severity

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| P1 | **155 useQuery calls with no `staleTime`/`gcTime`/`select`** | Throughout `frontend/src/pages/` and `frontend/src/components/` | Cache invalidation on every re-render, excess API calls |
| P2 | Blocking `readFileSync()` | `src/config/load-env.ts:6`, `src/git/ssh-server.ts:115,121` | Blocks event loop during startup |

### Medium Severity

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| P3 | No list virtualization anywhere | `IssueListTable.tsx:120,145,176`, `PRList.tsx:73,107`, 254 `.map()` calls total | DOM bloat with large datasets |
| P4 | No `React.memo` on list item components | 25 files with list rendering | Unnecessary re-renders on parent state changes |
| P5 | N+1 query patterns | `issue-board.service.ts:505`, `middleware/rbac.ts` | Multiple sequential DB queries |
| P6 | Event listener leak (47 adds vs 8 removes) | `frontend/src/components/` | Potential memory leaks |
| P7 | 390 Prisma queries use `include` instead of `select` | All `*.service.ts` files | Over-fetching data |

### Low Severity

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| P8 | Missing pagination defaults | Most service endpoints | Unbounded result sets |
| P9 | Rate limiting only on auth + attachments | All other endpoints | No protection against abuse |
| P10 | No image lazy loading | `Avatar.tsx:34`, 30 img references | Unnecessary upfront loading |

---

## 4. Backend Consistency

**Overall: Excellent compliance.** No critical issues found.

- All 34 modules follow `routes > controller > service` pattern
- All 445 error throws use `AppError` (zero raw `throw new Error`)
- All 297 controller endpoints use Zod validation
- Auth middleware applied uniformly (public routes properly exempted)
- Prisma relationship chains properly included
- Response format consistent
- Zero `any` types in modules
- Express 5 compatible (named wildcards, no inline regex)

---

## 5. Summary Priority Matrix

### Must Fix (High Impact, Reasonable Effort)
1. **P1** - Add default `staleTime`/`gcTime` to TanStack Query (global default or per-query)
2. **D4** - Enforce `Card` component usage (replace 172 inline card containers)
3. **F1** - Convert `AuthImage` from useEffect+fetch to TanStack Query

### Should Fix (High Impact, More Effort)
4. **D1** - Extract `useModalForm` hook + `FormModal` to reduce 1,100 LOC of modal boilerplate
5. **D2** - Create `DetailPageLayout` to unify 10+ detail pages
6. **D3** - Create `ListPage` to unify 8+ list pages
7. **P3** - Add virtualization for large lists (IssueList, PRList)
8. **P4** - Add `React.memo` to list item components

### Nice to Have (Lower Impact)
9. **P5** - Fix N+1 queries in issue-board and RBAC
10. **D5** - Create `SidebarPanel` component
11. **P6** - Audit and fix event listener cleanup
12. **P7** - Convert `include` to `select` where full objects aren't needed
13. **P10** - Add `loading="lazy"` to images
14. **P2** - Convert startup readFileSync to async (low practical impact since it's startup-only)
