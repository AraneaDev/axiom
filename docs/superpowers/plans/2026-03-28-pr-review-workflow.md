# PR Review Workflow Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PR comment threads, file tree navigation in diff view, and delete-source-branch-on-merge to the PR review workflow.

**Architecture:** Comment threads use a self-referential `parentId` on the existing `PRComment` model. File tree is a frontend-only component using existing diff stats data. Branch deletion is an optional flag on the existing merge endpoint.

**Tech Stack:** Prisma 7, Express 5, React 19, TanStack Query, Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-28-pr-review-workflow-design.md`

---

### Task 1: Schema — Add `parentId` to PRComment Model

**Files:**
- Modify: `prisma/schema.prisma` (PRComment model, ~line 326)
- Create: new migration via `prisma migrate dev`

- [ ] **Step 1: Add self-referential fields to PRComment**

In `prisma/schema.prisma`, update the `PRComment` model to add threading:

```prisma
model PRComment {
  id        String      @id @default(cuid())
  prId      String
  pr        PullRequest @relation(fields: [prId], references: [id], onDelete: Cascade)
  authorId  String
  body      String
  filePath  String?
  line      Int?
  parentId  String?
  parent    PRComment?  @relation("commentThread", fields: [parentId], references: [id], onDelete: Cascade)
  replies   PRComment[] @relation("commentThread")
  createdAt DateTime    @default(now())
  updatedAt DateTime    @updatedAt

  @@index([prId])
  @@index([authorId])
  @@index([parentId])
  @@map("pr_comments")
}
```

- [ ] **Step 2: Generate and apply migration**

Run: `npx prisma migrate dev --name add-pr-comment-threads`
Expected: Migration created and applied successfully.

- [ ] **Step 3: Verify schema compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(pulls): add parentId to PRComment for threaded replies"
```

---

### Task 2: Backend — Comment Threading in Service and Controller

**Files:**
- Modify: `src/modules/pulls/pull-comments.service.ts`
- Modify: `src/utils/validation/repo-validators.ts`

- [ ] **Step 1: Update validation schema**

In `src/utils/validation/repo-validators.ts`, the `addPRCommentSchema` (around line 70) already has a `replyToId` field. Rename it to `parentId` for consistency with the Prisma model, or if `replyToId` is already there, keep it but map to `parentId` in the service. Check the exact current schema and update:

```typescript
export const addPRCommentSchema = z.object({
  body: z.string().min(1),
  filePath: z.string().optional(),
  line: z.number().int().optional(),
  parentId: z.string().optional(),
});
```

Also re-export `addPRCommentSchema` from `src/utils/validation.ts` if not already exported.

- [ ] **Step 2: Update `addPRComment` service**

In `src/modules/pulls/pull-comments.service.ts`, modify `addPRComment()` to accept `parentId`. When `parentId` is provided:
- Validate the parent comment exists and belongs to the same PR
- Inherit `filePath` and `line` from the parent (replies attach to the same file/line)
- Store `parentId` on the new comment

```typescript
// In addPRComment, after finding the PR:
if (data.parentId) {
  const parent = await prisma.pRComment.findUnique({ where: { id: data.parentId } });
  if (!parent || parent.prId !== pr.id) throw new AppError(400, 'Invalid parent comment');
  // Replies inherit file/line from parent
  data.filePath = parent.filePath ?? undefined;
  data.line = parent.line ?? undefined;
}
```

- [ ] **Step 3: Update `listPRComments` service**

In `listPRComments()`, include `parentId` in the select/return and add author info for replies:

```typescript
export async function listPRComments(repoId: string, prNumber: number) {
  const pr = await findPR(repoId, prNumber);
  return prisma.pRComment.findMany({
    where: { prId: pr.id },
    include: {
      author: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}
```

The `parentId` field is returned automatically. Frontend will handle grouping into threads.

- [ ] **Step 4: Verify backend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/pulls/pull-comments.service.ts src/utils/validation/repo-validators.ts
git commit -m "feat(pulls): support parentId for threaded PR comments"
```

---

### Task 3: Frontend — Comment Threading UI

**Files:**
- Modify: `frontend/src/pages/repos/PRTimeline.tsx`
- Modify: `frontend/src/pages/repos/PRDiffView.tsx`
- Modify: `frontend/src/api/repos.api.ts`

- [ ] **Step 1: Update API client**

In `frontend/src/api/repos.api.ts`, update the `addPRComment` function to accept `parentId`:

```typescript
addPRComment: (repoId: string, prNumber: number, data: { body: string; filePath?: string; line?: number; parentId?: string }) =>
  post(`/repos/${repoId}/pulls/${prNumber}/comments`, data),
```

- [ ] **Step 2: Add thread grouping utility**

In `PRTimeline.tsx`, add a helper to group flat comments into threads:

```typescript
interface CommentThread {
  root: PRComment;
  replies: PRComment[];
}

function groupIntoThreads(comments: PRComment[]): CommentThread[] {
  const threads: CommentThread[] = [];
  const replyMap = new Map<string, PRComment[]>();

  for (const c of comments) {
    if (c.parentId) {
      const arr = replyMap.get(c.parentId) || [];
      arr.push(c);
      replyMap.set(c.parentId, arr);
    } else {
      threads.push({ root: c, replies: [] });
    }
  }

  for (const thread of threads) {
    thread.replies = replyMap.get(thread.root.id) || [];
  }

  return threads;
}
```

- [ ] **Step 3: Update comment rendering to show threads**

In `PRTimeline.tsx`, replace the flat comment list with threaded rendering:
- Root comments render as before
- Each root comment gets a "Reply" button (with `MessageSquare` icon from Lucide)
- Replies render below the root, indented with `ml-6 border-l-2 border-border pl-4`
- Reply form appears inline when "Reply" is clicked
- Threads with more than 3 replies collapse with "Show N more replies" toggle

- [ ] **Step 4: Update inline comments in PRDiffView**

In `PRDiffView.tsx`, when rendering inline comments at a specific file/line:
- Filter comments by `filePath` and `line` AND `parentId === null` (only root comments)
- Show reply count badge on each inline comment
- Clicking a comment expands its thread below

- [ ] **Step 5: Verify frontend compiles and test**

Run: `cd frontend && npx tsc --noEmit`
Test manually: Add a comment, reply to it, verify thread displays correctly.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/repos/PRTimeline.tsx frontend/src/pages/repos/PRDiffView.tsx frontend/src/api/repos.api.ts
git commit -m "feat(pulls): add threaded comment UI with reply and collapse"
```

---

### Task 4: Frontend — File Tree Navigation in Diff View

**Files:**
- Modify: `frontend/src/pages/repos/PRDiffView.tsx`

- [ ] **Step 1: Add file status type and helpers**

Add at the top of `PRDiffView.tsx`:

```typescript
type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

function getFileStatus(stat: { additions: number; deletions: number; file: string }): FileStatus {
  if (stat.additions > 0 && stat.deletions === 0) return 'added';
  if (stat.additions === 0 && stat.deletions > 0) return 'deleted';
  return 'modified';
}

const fileStatusColors: Record<FileStatus, string> = {
  added: 'text-success',
  modified: 'text-warning',
  deleted: 'text-danger',
  renamed: 'text-info',
};
```

- [ ] **Step 2: Add file tree sidebar component**

Create a `DiffFileTree` component inside `PRDiffView.tsx` (or as a separate file if preferred):

```tsx
function DiffFileTree({
  stats,
  activeFile,
  onFileClick,
}: {
  stats: { file: string; additions: number; deletions: number }[];
  activeFile: string | null;
  onFileClick: (file: string) => void;
}) {
  return (
    <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="h-3.5 w-3.5 text-text-secondary" />
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
          {stats.length} files changed
        </span>
      </div>
      <div className="space-y-0.5">
        {stats.map((stat) => {
          const status = getFileStatus(stat);
          const fileName = stat.file.split('/').pop() || stat.file;
          const dirPath = stat.file.includes('/') ? stat.file.substring(0, stat.file.lastIndexOf('/')) : '';
          return (
            <button
              key={stat.file}
              type="button"
              onClick={() => onFileClick(stat.file)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left hover:bg-surface-tertiary transition-colors',
                activeFile === stat.file && 'bg-primary-light text-primary',
              )}
              title={stat.file}
            >
              <FileText className={cn('h-3 w-3 shrink-0', fileStatusColors[status])} />
              <span className="truncate flex-1">
                {dirPath && <span className="text-text-tertiary">{dirPath}/</span>}
                {fileName}
              </span>
              <span className="shrink-0 flex gap-1">
                {stat.additions > 0 && <span className="text-success">+{stat.additions}</span>}
                {stat.deletions > 0 && <span className="text-danger">-{stat.deletions}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add anchor IDs to diff sections**

In the diff rendering (both `UnifiedDiffView` and `SplitDiffView`), each file's diff header should get an `id` attribute:

```tsx
id={`diff-${encodeURIComponent(filePath)}`}
```

Where `filePath` is extracted from the diff header line (`--- a/path` or `+++ b/path`).

- [ ] **Step 4: Wire up file tree in PRDiffView**

In the main `PRDiffView` component:
- Add state: `const [activeFile, setActiveFile] = useState<string | null>(null)`
- Add state: `const [showFileTree, setShowFileTree] = useState(true)`
- Add scroll handler:
  ```typescript
  function scrollToFile(file: string) {
    const el = document.getElementById(`diff-${encodeURIComponent(file)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActiveFile(file);
  }
  ```
- Wrap the diff area in a flex layout:
  ```tsx
  <div className="flex gap-4">
    {showFileTree && diff.stats.length > 1 && (
      <div className="w-64 shrink-0 hidden lg:block">
        <DiffFileTree stats={diff.stats} activeFile={activeFile} onFileClick={scrollToFile} />
      </div>
    )}
    <div className="flex-1 min-w-0">
      {/* existing diff rendering */}
    </div>
  </div>
  ```
- Add a toggle button near the diff view mode buttons:
  ```tsx
  <Button variant="ghost" size="xs" onClick={() => setShowFileTree(!showFileTree)} title="Toggle file tree">
    <ListTree className="h-4 w-4" />
  </Button>
  ```

- [ ] **Step 5: Verify frontend compiles and test**

Run: `cd frontend && npx tsc --noEmit`
Test: Open a PR with multiple changed files, verify file tree appears, clicking scrolls to file.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/repos/PRDiffView.tsx
git commit -m "feat(pulls): add file tree navigation sidebar in PR diff view"
```

---

### Task 5: Backend — Delete Source Branch on Merge

**Files:**
- Modify: `src/utils/validation/repo-validators.ts`
- Modify: `src/modules/pulls/pulls.service.ts`

- [ ] **Step 1: Update merge validation schema**

In `src/utils/validation/repo-validators.ts`, update `mergePRSchema` (around line 52):

```typescript
export const mergePRSchema = z.object({
  strategy: z.enum(['merge', 'squash', 'rebase']).default('merge'),
  deleteSourceBranch: z.boolean().optional().default(false),
});
```

- [ ] **Step 2: Update `mergePR` service**

In `src/modules/pulls/pulls.service.ts`, update the `mergePR` function signature to accept `deleteSourceBranch`:

```typescript
export async function mergePR(
  repoId: string,
  prNumber: number,
  strategy?: 'merge' | 'squash' | 'rebase',
  deleteSourceBranch = false,
) {
```

After the successful merge (after the PR status update and linked issues handling, around line 506), add branch deletion logic:

```typescript
// Delete source branch if requested
let branchDeleted = false;
if (deleteSourceBranch) {
  try {
    const repo = await prisma.repository.findUnique({ where: { id: repoId } });
    // Don't delete default branch
    if (pr.sourceBranch !== repo?.defaultBranch) {
      const repoPath = getRepoPath(repo!);
      await gitCmd('branch', ['-D', pr.sourceBranch], { cwd: repoPath });
      branchDeleted = true;
    }
  } catch {
    // Don't fail the merge if branch deletion fails
  }
}
```

Update the return value to include `branchDeleted`:

```typescript
return { ...updatedPR, branchDeleted };
```

Check how `gitCmd` is imported/used in the file and what `getRepoPath` looks like. Follow the existing patterns. The bare repo deletes branches differently than a working copy — for a bare repo, you delete the ref directly:

```typescript
await gitCmd('update-ref', ['-d', `refs/heads/${pr.sourceBranch}`], { cwd: repoPath });
```

Use whichever pattern the codebase already uses for branch deletion (check `src/modules/repos/` for existing branch delete logic).

- [ ] **Step 3: Update controller**

In `src/modules/pulls/pulls.controller.ts`, update the merge controller (around line 54) to pass `deleteSourceBranch`:

```typescript
export const merge = asyncHandler(async (req: Request, res: Response) => {
  const { strategy, deleteSourceBranch } = validate(mergePRSchema, req.body);
  const result = await pullsService.mergePR(
    param(req, 'repoId'),
    Number(param(req, 'number')),
    strategy,
    deleteSourceBranch,
  );
  res.json(result);
});
```

- [ ] **Step 4: Verify backend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/pulls/pulls.service.ts src/modules/pulls/pulls.controller.ts src/utils/validation/repo-validators.ts
git commit -m "feat(pulls): add deleteSourceBranch option to merge endpoint"
```

---

### Task 6: Frontend — Delete Source Branch UI

**Files:**
- Modify: `frontend/src/pages/repos/PRReviewPanel.tsx`
- Modify: `frontend/src/api/repos.api.ts`

- [ ] **Step 1: Update API client**

In `frontend/src/api/repos.api.ts`, update the `mergePR` function to accept `deleteSourceBranch`:

```typescript
mergePR: (repoId: string, prNumber: number, data: { strategy?: string; deleteSourceBranch?: boolean }) =>
  post(`/repos/${repoId}/pulls/${prNumber}/merge`, data),
```

- [ ] **Step 2: Add checkbox to PRReviewPanel**

In `PRReviewPanel.tsx`, add state and UI for the delete branch option:

```typescript
const [deleteSourceBranch, setDeleteSourceBranch] = useState(() => {
  return localStorage.getItem('pr-delete-branch-preference') === 'true';
});

// Persist preference
useEffect(() => {
  localStorage.setItem('pr-delete-branch-preference', String(deleteSourceBranch));
}, [deleteSourceBranch]);
```

Add a checkbox below the merge strategy dropdown (before the merge button):

```tsx
{pr.sourceBranch !== repo?.defaultBranch && (
  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
    <input
      type="checkbox"
      checked={deleteSourceBranch}
      onChange={(e) => setDeleteSourceBranch(e.target.checked)}
      className="rounded border-border"
    />
    <GitBranchPlus className="h-3.5 w-3.5" />
    Delete source branch after merge
  </label>
)}
```

Import `GitBranchPlus` from `lucide-react` (or use `Trash2` with branch context).

- [ ] **Step 3: Pass deleteSourceBranch to merge call**

Update the merge button's onClick to pass the flag:

```typescript
onClick={() => mergePR({ strategy: mergeStrategy, deleteSourceBranch })}
```

Adjust the `mergePR` mutation call site to include `deleteSourceBranch` in the data object.

- [ ] **Step 4: Show branch deleted feedback**

After successful merge, if the response includes `branchDeleted: true`, show feedback. This could be a brief status message near the merge area or updating the branch badge to show "(deleted)".

- [ ] **Step 5: Verify frontend compiles and test**

Run: `cd frontend && npx tsc --noEmit`
Test: Open a PR, check the "Delete source branch" checkbox, merge, verify branch is deleted.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/repos/PRReviewPanel.tsx frontend/src/api/repos.api.ts
git commit -m "feat(pulls): add delete source branch checkbox to merge UI"
```
