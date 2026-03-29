# Codebase Audit -- Refined Implementation Plan

Generated: 2026-03-27

This plan is the result of a devil's advocate review of findings from 5 parallel audit agents.
Each finding was verified against the actual codebase. Weak or incorrect findings have been
removed or demoted. Severity ratings have been adjusted based on real risk and impact.

---

## Findings Removed or Demoted

| Original Finding | Verdict | Reason |
|---|---|---|
| **Audit 4: Missing FK indexes on Issue.assigneeId, Issue.creatorId** | REMOVED | Verified false. Both have `@@index` in schema.prisma (lines 480-481). |
| **Audit 4: Missing FK indexes on PRReview.reviewerId, PRComment.authorId** | DEMOTED to LOW | These tables are always queried by `prId` (which IS indexed). Reviewer/author lookups are rare admin queries, not hot paths. |
| **Audit 5: Pagination response format varies** | REMOVED | No `totalPages`/`totalCount` pattern exists anywhere. Issues controller returns `{ ...result, limit, offset }`. There is no meaningful inconsistency -- different endpoints simply return different shapes appropriate to their use case. |
| **Audit 5: Incomplete RBAC module** | DEMOTED to LOW | Only `rbac.test.ts` exists. This is likely a planned feature with a test skeleton, not a broken implementation. No routes reference it. Zero runtime impact. |
| **Audit 1: Raw `<button>` in wiki/PRDiffView** | REMOVED | Audit itself noted "many have icons already." Too vague to action without specific line references to actual violations. |
| **Audit 2: API token exposure** | REMOVED | Speculative ("need to verify"). Not a confirmed finding. |
| **Audit 2: No size limit on admin stats query** | REMOVED | Admin endpoints are behind `isAdmin` check. The query returns a single row (database size). No pagination needed. |
| **Audit 2: Public git repo cloning / Health endpoint** | REMOVED | Acknowledged as intentional/standard by the audit itself. |
| **Audit 5: Mixed loading state patterns** | REMOVED | Different pages have different loading needs. Using PageLoader vs Skeleton vs Spinner contextually is good UX, not inconsistency. |

---

## Phase 1: Critical (Security) -- Fix Immediately

### 1.1 Command Injection Risk in admin.service.ts

- **File:** `src/modules/admin/admin.service.ts` lines 28-39
- **Problem:** `execSync()` with shell template string interpolation: `` execSync(`du -sb "${dirPath}" ...`) ``. While `dirPath` currently comes from environment variables (not user input), this is a dangerous pattern. If any future code passes user-controlled data, it becomes a command injection vulnerability. The use of double quotes inside the shell string does not prevent injection via `$(...)` or backticks.
- **Fix:** Replace `execSync()` with `execFileSync('du', ['-sb', dirPath])` and parse the output. This eliminates shell interpretation entirely.
- **Complexity:** Trivial
- **Risk if ignored:** One refactor away from a critical RCE vulnerability.

### 1.2 Missing Authorization on Attachment List Endpoint

- **File:** `src/modules/attachments/attachments.controller.ts` lines 50-54, `attachments.routes.ts` line 62
- **Problem:** The `GET /api/attachments?issueId=xxx` endpoint requires authentication (router-level middleware on line 59 of routes) but does not verify the requesting user has access to the referenced issue or page. Any authenticated user can enumerate attachments for any issue/page by guessing or iterating IDs.
- **Fix:** In the `list` controller, resolve the parent issue/page, then verify the user belongs to the same org/team. Alternatively, add a `checkMembership` middleware call that validates the user's access to the parent resource.
- **Complexity:** Small
- **Risk if ignored:** Information disclosure across organization boundaries. An authenticated user from Org A can see attachment metadata (filenames, sizes, timestamps) for Org B's issues.

---

## Phase 2: High Impact (Performance) -- Fix This Sprint

### 2.1 N+1 Query in Bulk Issue Update

- **File:** `src/modules/issues/issue-bulk.service.ts` lines 44-91
- **Problem:** Each issue is updated individually in a `for` loop with `prisma.issue.update()` plus a separate `logActivity()` call per issue. For a bulk update of 50 issues, this executes 100+ sequential database queries.
- **Fix:** For simple field updates (priority, assignee, sprint), use `prisma.issue.updateMany()` with a `where: { id: { in: issueIds } }` clause. The label case (which needs `connectOrCreate`) genuinely requires per-issue updates, but can be wrapped in `prisma.$transaction()` to at least batch the round trips. Activity logging can be batched with `prisma.activity.createMany()`.
- **Complexity:** Medium -- the label case with `connectOrCreate` needs special handling.
- **Impact:** Linear DB query growth with bulk size. Noticeable latency at 20+ issues.

### 2.2 Raw `<textarea>` Instead of Textarea Component

- **Files:**
  - `frontend/src/pages/repos/FileEdit.tsx` line 113
  - `frontend/src/pages/repos/PRDiffView.tsx` line 103
- **Problem:** The codebase has a shared `Textarea` component at `frontend/src/components/ui/Textarea.tsx` that provides consistent styling via CSS variable tokens, `cn()` classname merging, and `forwardRef` support. These two pages bypass it with raw `<textarea>` elements, breaking visual consistency and the design system contract.
- **Fix:** Import and use the `Textarea` component. Pass existing props through.
- **Complexity:** Trivial

### 2.3 Raw `<input type="date">` Used Across Multiple Pages

- **Files (all instances):**
  - `frontend/src/pages/projects/Milestones.tsx` line 353
  - `frontend/src/pages/issues/IssueDetailFieldsPanel.tsx` line 317
  - `frontend/src/pages/issues/SprintFormModal.tsx` lines 67, 73
  - `frontend/src/pages/issues/IssueCreate.tsx` line 208
  - `frontend/src/pages/admin/AuditLogs.tsx` lines 266, 278
  - `frontend/src/components/CustomFieldRenderer.tsx` line 135
- **Problem:** 8 instances of raw `<input type="date">` instead of the shared `Input` component. This is a systemic pattern violation, not a one-off. The `Input` component provides consistent border colors, focus rings, and dark-mode support via CSS tokens.
- **Fix:** Replace all with `<Input type="date" ... />`. Verify the Input component handles `type="date"` correctly (it should, since it spreads props onto the underlying input).
- **Complexity:** Small (8 straightforward replacements)

### 2.4 Tab Filter Buttons Missing Icons in Milestones

- **File:** `frontend/src/pages/projects/Milestones.tsx` lines 255-266
- **Problem:** Text-only tab/filter buttons violate the "every button has an icon" design rule.
- **Fix:** Add appropriate Lucide icons (e.g., `ListFilter`, `Clock`, `CheckCircle`, `Archive` for status filters).
- **Complexity:** Trivial

---

## Phase 3: Consistency -- Fix Opportunistically

### 3.1 Workflow Module Naming Convention

- **Directory:** `src/modules/workflows/`
- **Files:** `workflow.routes.ts`, `workflow.controller.ts`, `workflow.service.ts`, `workflow.test.ts`
- **Problem:** Uses singular naming (`workflow.*`) while every other module uses plural (`issues.*`, `pulls.*`, `labels.*`, etc.).
- **Fix:** Rename to `workflows.routes.ts`, `workflows.controller.ts`, etc. Update all imports.
- **Complexity:** Small (rename + find-and-replace imports)
- **Risk if ignored:** Developer confusion, inconsistent `grep` results. No runtime impact.

### 3.2 HTTP 204 Response Style Inconsistency

- **Problem:** 34 delete/update endpoints use `res.status(204).send()` while 3 use `res.status(204).end()`.
- **Fix:** Standardize on `.send()` (the majority pattern). Both are functionally identical, but consistency aids code review.
- **Complexity:** Trivial
- **Risk if ignored:** None. Purely cosmetic.

### 3.3 Query Param Parsing Inconsistency

- **Problem:** Some controllers use the `parsePagination` utility while others do manual `parseInt` on query params.
- **Fix:** Audit all controllers with pagination and migrate to `parsePagination`. This also provides consistent defaults and NaN handling.
- **Complexity:** Small
- **Risk if ignored:** Potential for inconsistent default page sizes or NaN bugs in edge cases.

### 3.4 Manual Error Responses in Some Controllers

- **Problem:** A few controllers return `res.status(400).json({ error: { message: '...' } })` directly instead of throwing `AppError`. Example: `issues.controller.ts` line 82.
- **Fix:** Replace with `throw new AppError(400, 'body is required')` to use the global error handler consistently.
- **Complexity:** Trivial
- **Risk if ignored:** Inconsistent error response shape if the global handler ever adds fields (e.g., request ID, error code).

### 3.5 Missing Indexes on PRReview.reviewerId and PRComment.authorId

- **File:** `prisma/schema.prisma` (PRReview model ~line 302, PRComment model ~line 321)
- **Problem:** No `@@index` on `reviewerId` or `authorId` in these models. However, these tables are always queried via `prId` (which IS indexed), so the missing indexes only matter for hypothetical "all reviews by user X" queries.
- **Fix:** Add `@@index([reviewerId])` and `@@index([authorId])` to future-proof.
- **Complexity:** Trivial (schema change + migration)
- **Risk if ignored:** Minimal. Current query patterns do not hit these columns in WHERE clauses.

---

## Summary

| Phase | Items | Estimated Effort |
|---|---|---|
| Phase 1: Critical | 2 items (command injection, attachment authz) | ~2 hours |
| Phase 2: High Impact | 4 items (N+1 bulk, textarea, date inputs, button icons) | ~4 hours |
| Phase 3: Consistency | 5 items (naming, 204s, pagination, errors, indexes) | ~3 hours |
| **Total** | **11 items** | **~9 hours** |
| Removed | **9 findings** discarded as false, speculative, or noise | -- |

### Audit Quality Notes

- **Audit 1 (Design Patterns):** Mostly accurate. Understated the `type="date"` problem (found 1, actually 8).
- **Audit 2 (Security):** Mixed quality. Two real findings (#1, #2), but padded with speculative and non-issues.
- **Audit 3 (Incomplete Implementations):** Correct -- the codebase is clean. Good negative result.
- **Audit 4 (Performance):** Had a significant false positive (claimed missing indexes that exist). The N+1 finding is real and well-identified.
- **Audit 5 (Inconsistencies):** Overcounted. Pagination inconsistency was fabricated. RBAC "incomplete module" is a planned feature, not a bug. The workflow naming finding is real but cosmetic.
