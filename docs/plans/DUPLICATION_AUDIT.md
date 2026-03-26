# Codebase Duplication & Unification Audit

## Backend

### 1. asyncHandler exists but is unused [HIGH]
Every controller (~45 files) manually wraps handlers in try-catch-next. The utility `src/utils/asyncHandler.ts` already exists but nobody uses it.
- **Impact:** ~200-250 lines of boilerplate eliminated
- **Fix:** Wrap all controller exports with `asyncHandler(fn)`, remove manual try-catch blocks

### 2. findOrThrow underutilized [HIGH]
`src/utils/find-or-throw.ts` is used in ~48 places, but many services still do manual `if (!entity) throw new AppError(404, '...')` checks (~75 remaining manual checks).
- **Impact:** ~60 lines, plus consistency
- **Fix:** Replace manual 404 checks with `findOrThrow()` across issues, wiki, repos, pulls services

### 3. Validation split between schema.parse() and validate() [MEDIUM]
~15 controllers use raw `schema.parse(req.body)`, ~14 use the `validate()` wrapper from `src/utils/validation/common-validators.ts`. The wrapper includes error formatting; raw parse does not.
- **Impact:** Inconsistent error messages to the client
- **Fix:** Standardize all controllers to use `validate()` wrapper

### 4. Duplicate slug uniqueness checks [MEDIUM]
~25 instances of "slug already taken" checks across teams, orgs, wiki, repos services. All follow the same pattern: find by slug, throw 409 if exists.
- **Impact:** ~40 lines
- **Fix:** Extract `checkUniqueConstraint(model, where, message)` utility

### 5. Prisma include chains repeated [MEDIUM]
`team: { include: { org: true } }` appears in 9+ service files. `src/utils/prisma-selects.ts` has constants like `TEAM_ORG_SELECT` but they're underutilized.
- **Impact:** ~20 lines, plus consistency
- **Fix:** Add `TEAM_ORG_INCLUDE` constant, use across all services

---

## Frontend Pages

### 6. CRUD settings pages are nearly identical [HIGH]
`LabelsSettings.tsx`, `CustomFieldSettings.tsx`, `IssueTemplates.tsx` each have ~300+ lines of duplicated CRUD logic: 6 useState hooks, 3 mutations, form handlers, list rendering with edit/view toggle.
- **Impact:** 200-300 lines consolidated
- **Fix:** Extract `useCRUDPage<T>()` hook + `CRUDItemList` component

### 7. Query invalidation logic repeated [HIGH]
38+ instances of `queryClient.invalidateQueries({ queryKey: ['issue', projectId, num] })` across IssueDetail sub-components.
- **Impact:** Fragile (miss one and data is stale), verbose
- **Fix:** Extract `invalidateIssue(queryClient, projectId, num)` helper that invalidates all related keys

### 8. Mutation error handling inconsistent [HIGH]
Two conflicting patterns:
- Pattern A: `onError: (err: Error) => toast(err.message, 'error')`
- Pattern B: `onError: (err: unknown) => toast.error(err instanceof Error ? err.message : 'Failed')`
- Note: `useMutationWithToast` hook exists in `/hooks/` but is **never used**
- **Impact:** 10+ mutations with inconsistent error UX
- **Fix:** Adopt `useMutationWithToast` everywhere, or standardize on one pattern

### 9. IssueDetail prop drilling [MEDIUM]
5 IssueDetail sub-components all receive nearly identical props (`issue`, `projectId`, `num`, etc.) and duplicate query invalidation logic.
- **Fix:** Consider React Context for shared issue state, or consolidate invalidation into a shared hook

### 10. Form draft state reinvented per component [MEDIUM]
`titleDraft`, `bodyDraft`, `editingBody`, `editCommentBody`, `goalDraft` — each component reinvents draft state management.
- **Fix:** Extract `useDraftState(initialValue)` hook

### 11. Modal state pattern repeated [MEDIUM]
6+ modals each manage `[open, setOpen] = useState(false)` independently.
- **Fix:** Extract `useModalState()` hook (trivial but reduces noise)

---

## Inconsistencies

### 12. Missing error state UI in 20+ pages [HIGH]
Pages destructure `isLoading` from `useQuery` but never check or display `error` state. Failed queries silently show nothing.
- **Pages affected:** AuditLogs, SystemSettings, Dashboard, Board, IssueList, IssueDetailComments, IssueDetailFieldsPanel, and 12+ others
- **Fix:** Add error UI to all pages, or wrap with a shared `QueryGuard` component

### 13. Hardcoded bg-black in overlay components [LOW]
`Modal.tsx`, `CommandPalette.tsx`, `Sidebar.tsx` use `bg-black/50` or `bg-black/40` instead of design token.
- **Fix:** Replace with `bg-surface-overlay` or add a `--overlay` CSS variable

---

## Already Well-Unified (No Action Needed)

- **Pagination** — `parsePagination()`, `parseServicePagination()`, `paginatedResponse()` used consistently
- **USER_BASIC_SELECT** — Centralized in `prisma-selects.ts`, used everywhere
- **API response format** — All controllers use `res.json(data)` consistently
- **Auth guards** — `authenticate` + `requireRepoAccess()`/`requireOrgAccess()` applied uniformly
- **API client layer** — All 25+ API files follow the same `get/post/patch/del` pattern
- **Import organization** — No circular dependencies detected

---

## Prioritized Action Plan

| # | Item | Severity | Effort | Lines Saved |
|---|------|----------|--------|-------------|
| 1 | Use asyncHandler in all controllers | HIGH | Low | ~250 |
| 2 | CRUD settings page extraction | HIGH | Medium | ~250 |
| 3 | Standardize mutation error handling | HIGH | Low | ~30 + consistency |
| 4 | Add error state UI to pages | HIGH | Medium | ~0 (adds code) |
| 5 | Consolidate findOrThrow usage | HIGH | Low | ~60 |
| 6 | Extract query invalidation helpers | HIGH | Low | ~80 |
| 7 | Standardize validate() usage | MEDIUM | Low | ~30 |
| 8 | IssueDetail context/props cleanup | MEDIUM | Medium | ~50 |
| 9 | Extract useDraftState hook | MEDIUM | Low | ~40 |
| 10 | checkUniqueConstraint utility | MEDIUM | Low | ~40 |
| 11 | Expand prisma-selects constants | MEDIUM | Low | ~20 |
| 12 | Fix hardcoded overlay colors | LOW | Low | ~5 |
| 13 | Extract useModalState hook | LOW | Low | ~15 |
