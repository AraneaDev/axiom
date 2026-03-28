# PR Review Workflow Improvements

**Date:** 2026-03-28
**Status:** Approved

## Problem

Three daily workflow gaps in the PR/code review experience compared to Bitbucket/GitHub:
1. PR comments are flat -- no way to reply to a specific comment, making discussions hard to follow
2. No file tree navigation in the diff view -- users must scroll through all changed files
3. No option to delete the source branch after merging

## Features

---

### 1. PR Comment Threads

**Goal:** Allow nested replies on PR comments so review discussions stay organized.

#### Schema Change

Add self-referential fields to `PRComment` model in `prisma/schema.prisma`:

```prisma
parentId  String?
parent    PRComment?  @relation("commentThread", fields: [parentId], references: [id])
replies   PRComment[] @relation("commentThread")
```

Create a migration for this change.

#### Backend

- `addPRComment()` in `pull-comments.service.ts`: accept optional `parentId`. Validate parent exists and belongs to the same PR. Replies inherit `filePath` and `line` from the parent (ignore any passed values for replies).
- `listPRComments()`: return flat list with `parentId` included. Frontend handles grouping. Include `replies` count or let frontend compute from the flat list.
- Validation schema: add `parentId: z.string().optional()` to the comment creation schema.

#### Frontend

- **PRTimeline.tsx**: Group comments into threads. Root comments (`parentId === null`) render normally. Replies render nested below their parent with left border indent and reduced padding. Each comment gets a "Reply" button that opens an inline reply form.
- **PRDiffView.tsx** (inline comments): Same threading for inline/file comments. Replies to inline comments appear nested under the original inline comment at the relevant line.
- Thread collapse: threads with more than 3 replies show the first reply and a "Show N more replies" toggle.

---

### 2. File Tree in PR Diff View

**Goal:** Add a navigable file list sidebar so reviewers can jump between changed files.

#### No Backend Changes

The existing `getPRDiff()` endpoint already returns `fileStats` with file paths and addition/deletion counts.

#### Frontend

- **PRDiffView.tsx**: Add a sticky file navigator panel (left side or top, collapsible).
  - Each entry shows: file icon (from Lucide based on extension), filename (truncated path showing last 2 segments), and colored +/- badges.
  - Files grouped by directory with collapsible folder headers.
  - Clicking a file scrolls to that file's diff section via anchor ID.
  - Active file highlighted based on scroll position (intersection observer).
- **Diff sections**: Each file's diff block gets an `id` attribute like `diff-{filePath}` for anchor navigation.
- **File status indicators**: Added (green), Modified (yellow), Deleted (red) color coding on file entries.
- The file tree is collapsible via a toggle button to maximize diff viewing space.

---

### 3. Close Source Branch on Merge

**Goal:** Option to auto-delete the source branch after a successful merge.

#### Backend

- **Validation**: Add `deleteSourceBranch: z.boolean().optional()` to `mergePRSchema` in validators.
- **pulls.service.ts** `mergePR()`: After successful merge, if `deleteSourceBranch` is true:
  1. Check the source branch is not the repo's default branch (refuse if so)
  2. Check the source branch is not protected (refuse if so)
  3. Delete the branch via `gitCmd` (both local bare repo ref and any tracking)
  4. Log the deletion but don't fail the merge if branch deletion fails (merge already succeeded)
- **Response**: Include `branchDeleted: boolean` in the merge response so the UI can show feedback.

#### Frontend

- **PRReviewPanel.tsx**: Add a checkbox "Delete source branch" below the merge strategy dropdown.
  - Default: unchecked
  - Persist user preference in localStorage (`pr-delete-branch-preference`)
  - Disabled if source branch is the default branch (with tooltip explaining why)
  - On successful merge with deletion, show a brief toast/notice: "Branch {name} deleted"
- After merge, if branch was deleted, the PR detail page should reflect this (branch tag shows "deleted" state).

---

## Files to Modify

| Feature | Backend | Frontend | Schema |
|---------|---------|----------|--------|
| Comment Threads | `pull-comments.service.ts`, `pulls.routes.ts` (validators) | `PRTimeline.tsx`, `PRDiffView.tsx` | `schema.prisma` (PRComment) + migration |
| File Tree | None | `PRDiffView.tsx` (new file nav component) | None |
| Close Branch | `pulls.service.ts`, validators | `PRReviewPanel.tsx` | None |

## Out of Scope

- Cross-PR thread references
- Resolved/unresolved thread status (future feature)
- Review status per file / mark as viewed (separate feature)
- Outdated comment detection (separate feature)
- PR activity feed timeline (separate feature)
