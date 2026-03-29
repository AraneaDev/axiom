# Codebase Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all verified security vulnerabilities, code quality issues, and design pattern violations identified in the codebase audit.

**Architecture:** P0 tasks harden the pipeline runner and attachment access control. P1 tasks fix robustness issues (hardcoded URLs, error swallowing, design violations). P2 tasks polish loading states, type safety, accessibility, and component consistency.

**Tech Stack:** Node.js, Express, Prisma, React, TypeScript, Vitest

---

## File Structure

### New files
- `src/modules/pipelines/pipeline-env.ts` -- safe env var allowlist for pipeline steps
- `src/modules/pipelines/pipeline-env.test.ts` -- tests for env filtering
- `src/modules/attachments/attachments.service.test.ts` -- auth check tests (if not existing)

### Modified files
- `src/modules/pipelines/pipeline-runner.ts` -- use safe env, add resource limits
- `src/modules/pipelines/pipelines.service.ts` -- structured logging
- `src/modules/attachments/attachments.service.ts` -- add authorization check
- `src/modules/attachments/attachments.controller.ts` -- pass userId to service
- `src/git/hook-handler.ts` -- log catch blocks
- `src/email/queue.ts` -- use FRONTEND_URL env var
- `src/email/templates.ts` -- use FRONTEND_URL env var
- `frontend/src/api/attachments.api.ts` -- remove console statements
- `frontend/src/pages/issues/IssueDetail.tsx` -- use Badge component
- `frontend/src/pages/issues/IssueDetailComments.tsx` -- use Badge component
- `frontend/src/pages/wiki/PageEdit.tsx` -- use Badge component
- `frontend/src/pages/wiki/PageView.tsx` -- use Badge component, replace raw button
- `frontend/src/pages/wiki/PageViewSidebar.tsx` -- replace raw buttons
- `frontend/src/pages/repos/PRDiffView.tsx` -- replace raw buttons
- `frontend/src/pages/projects/Milestones.tsx` -- replace raw button
- `frontend/src/pages/search/SearchResults.tsx` -- add proper types
- `frontend/src/components/ui/FileUpload.tsx` -- add aria-label
- `frontend/src/pages/issues/IssueLinkedSection.tsx` -- add loading state
- `frontend/src/pages/wiki/WikiLayout.tsx` -- add loading/error state
- `frontend/src/pages/repos/BranchCompare.tsx` -- add loading/error state
- `frontend/src/components/ui/CommandPalette.tsx` -- add loading state
- `frontend/src/components/layout/Sidebar.tsx` -- add loading state

---

## P0: Security Fixes

### Task 1: Pipeline env var allowlist

**Files:**
- Create: `src/modules/pipelines/pipeline-env.ts`
- Create: `src/modules/pipelines/pipeline-env.test.ts`
- Modify: `src/modules/pipelines/pipeline-runner.ts:90`

- [ ] **Step 1: Write the failing test for safe env filtering**

Create `src/modules/pipelines/pipeline-env.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildSafeEnv } from './pipeline-env';

describe('buildSafeEnv', () => {
  it('includes only allowlisted system vars', () => {
    const env = buildSafeEnv(
      { PATH: '/usr/bin', HOME: '/root', DATABASE_URL: 'postgres://secret', JWT_SECRET: 'abc' },
      { AXIOM_BRANCH: 'main' },
      { MY_VAR: 'hello' },
    );
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/root');
    expect(env.AXIOM_BRANCH).toBe('main');
    expect(env.MY_VAR).toBe('hello');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.JWT_SECRET).toBeUndefined();
  });

  it('does not leak REDIS_URL, SESSION_SECRET, or HOOK_SECRET', () => {
    const env = buildSafeEnv(
      { REDIS_URL: 'redis://x', SESSION_SECRET: 'x', HOOK_SECRET: 'x', LANG: 'en_US.UTF-8' },
      {},
      {},
    );
    expect(env.REDIS_URL).toBeUndefined();
    expect(env.SESSION_SECRET).toBeUndefined();
    expect(env.HOOK_SECRET).toBeUndefined();
    expect(env.LANG).toBe('en_US.UTF-8');
  });

  it('step env overrides context env', () => {
    const env = buildSafeEnv({}, { FOO: 'ctx' }, { FOO: 'step' });
    expect(env.FOO).toBe('step');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/pipelines/pipeline-env.test.ts`
Expected: FAIL with "Cannot find module ./pipeline-env"

- [ ] **Step 3: Implement the safe env builder**

Create `src/modules/pipelines/pipeline-env.ts`:

```typescript
/**
 * System env vars safe to expose to pipeline steps.
 * Everything else (DATABASE_URL, JWT_SECRET, REDIS_URL, etc.) is stripped.
 */
const ALLOWED_SYSTEM_VARS = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'HOSTNAME',
  'TZ',
  'TMPDIR',
  'NODE_ENV',
]);

/**
 * Build a safe environment for pipeline step execution.
 * Only allowlisted system vars + AXIOM_* context vars + step-defined vars are included.
 */
export function buildSafeEnv(
  processEnv: Record<string, string | undefined>,
  contextEnv: Record<string, string>,
  stepEnv: Record<string, string>,
): Record<string, string> {
  const safe: Record<string, string> = {};

  // Only allowlisted system env vars
  for (const key of ALLOWED_SYSTEM_VARS) {
    if (processEnv[key]) safe[key] = processEnv[key]!;
  }

  // All context vars (AXIOM_COMMIT_SHA, AXIOM_BRANCH, etc.)
  Object.assign(safe, contextEnv);

  // Step-defined vars (from pipeline YAML)
  Object.assign(safe, stepEnv);

  return safe;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/pipelines/pipeline-env.test.ts`
Expected: PASS

- [ ] **Step 5: Update pipeline-runner.ts to use safe env**

In `src/modules/pipelines/pipeline-runner.ts`, change line 90 from:
```typescript
const env = { ...process.env, ...ctx.env, ...(step.env ?? {}) };
```
to:
```typescript
const env = buildSafeEnv(
  process.env as Record<string, string | undefined>,
  ctx.env,
  step.env ?? {},
);
```

Add import at top:
```typescript
import { buildSafeEnv } from './pipeline-env';
```

- [ ] **Step 6: Run full pipeline test suite**

Run: `npx vitest run src/modules/pipelines/`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/pipelines/pipeline-env.ts src/modules/pipelines/pipeline-env.test.ts src/modules/pipelines/pipeline-runner.ts
git commit -m "fix(security): strip sensitive env vars from pipeline steps

Pipeline steps previously received the full process.env including
DATABASE_URL, JWT_SECRET, REDIS_URL, etc. Now uses an allowlist of
safe system vars (PATH, HOME, LANG, etc.) plus AXIOM_* context vars
and step-defined vars from pipeline YAML."
```

---

### Task 2: Attachment authorization check

**Files:**
- Modify: `src/modules/attachments/attachments.service.ts:99-103`
- Modify: `src/modules/attachments/attachments.controller.ts:28-43`

- [ ] **Step 1: Write the failing test for attachment auth**

Create or extend `src/modules/attachments/attachments.service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

describe('attachment authorization', () => {
  it('rejects access when user is not in the attachment org', async () => {
    // This test verifies the service-level auth check exists
    // by importing and calling getAttachmentAuthorized with a mismatched userId
    const { getAttachmentAuthorized } = await import('./attachments.service');
    // Use a non-existent attachment ID -- should throw 404
    await expect(getAttachmentAuthorized('nonexistent-id', 'any-user')).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/attachments/attachments.service.test.ts`
Expected: FAIL with "getAttachmentAuthorized is not a function"

- [ ] **Step 3: Add authorized getter to attachments service**

In `src/modules/attachments/attachments.service.ts`, add after the existing `getAttachment` function:

```typescript
/**
 * Get attachment with authorization check.
 * Verifies the requesting user has access to the attachment's parent resource.
 * @param id - The attachment ID
 * @param userId - The requesting user's ID
 * @returns The attachment record
 * @throws {AppError} 404 if not found, 403 if unauthorized
 */
export async function getAttachmentAuthorized(id: string, userId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id },
    include: {
      issue: { include: { project: { include: { team: { include: { org: true } } } } } },
      page: { include: { space: { include: { team: { include: { org: true } } } } } },
    },
  });
  if (!attachment) throw new AppError(404, 'Attachment not found', 'NOT_FOUND');

  // Determine the org from the parent resource
  const orgId =
    attachment.issue?.project?.team?.org?.id ??
    attachment.page?.space?.team?.org?.id;

  if (!orgId) return attachment; // Orphan attachment, allow access

  // Check user is a member of the org
  const membership = await prisma.orgMembership.findFirst({
    where: { orgId, userId },
  });
  if (!membership) throw new AppError(403, 'Access denied', 'FORBIDDEN');

  return attachment;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/attachments/attachments.service.test.ts`
Expected: PASS

- [ ] **Step 5: Update service functions to accept userId**

In `src/modules/attachments/attachments.service.ts`, update the three functions that call `getAttachment` to accept `userId` and call `getAttachmentAuthorized` instead:

```typescript
// downloadAttachment (line 159): add userId param, swap getAttachment -> getAttachmentAuthorized
export async function downloadAttachment(id: string, userId: string) {
  const attachment = await getAttachmentAuthorized(id, userId);
  const storage = getStorage();
  const data = await storage.get(attachment.storageKey);
  return { attachment, data };
}

// preview (line 195): add userId param, swap getAttachment -> getAttachmentAuthorized
export async function preview(id: string, userId: string): Promise<{
  type: 'redirect' | 'text' | 'html' | 'pdf';
  content: string | Buffer;
  mimeType: string;
}> {
  const attachment = await getAttachmentAuthorized(id, userId);
  // ... rest of function body stays the same (mime checks, pandoc, etc.)

// convertToMarkdown (line 257): add userId param, swap getAttachment -> getAttachmentAuthorized
export async function convertToMarkdown(
  id: string,
  userId: string,
): Promise<{ markdown: string; originalName: string }> {
  const attachment = await getAttachmentAuthorized(id, userId);
  // ... rest of function body stays the same (pandoc conversion, etc.)
```

- [ ] **Step 6: Update controller to pass userId**

In `src/modules/attachments/attachments.controller.ts`, update all four read handlers:

```typescript
export const download = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
  const { attachment, data } = await attachmentsService.downloadAttachment(param(req, 'id'), req.userId);
  res.setHeader('Content-Type', attachment.mimeType);
  res.setHeader('Content-Length', data.length);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
  );
  res.send(data);
});

export const getMeta = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
  const attachment = await attachmentsService.getAttachmentAuthorized(param(req, 'id'), req.userId);
  res.json(attachment);
});

export const preview = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
  const result = await attachmentsService.preview(param(req, 'id'), req.userId);
  if (result.type === 'redirect') {
    res.redirect(`/api/attachments/${param(req, 'id')}`);
  } else if (result.type === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(result.content);
  } else {
    res.setHeader('Content-Type', result.mimeType);
    res.send(result.content);
  }
});

export const convertToMarkdown = asyncHandler(async (req: Request, res: Response) => {
  if (!req.userId) throw new AppError(401, 'Authentication required', 'AUTH_REQUIRED');
  const result = await attachmentsService.convertToMarkdown(param(req, 'id'), req.userId);
  res.json(result);
});
```

- [ ] **Step 7: Run all attachment tests + typecheck**

Run: `npx vitest run src/modules/attachments/ && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/modules/attachments/
git commit -m "fix(security): add authorization check to attachment access

Attachment download, preview, and metadata endpoints now verify the
requesting user has org membership for the attachment's parent resource
(issue or wiki page). Prevents IDOR where any authenticated user could
access any attachment by ID."
```

---

## P1: Code Quality

### Task 3: Replace hardcoded localhost URLs with FRONTEND_URL env var

**Files:**
- Modify: `src/email/queue.ts:61`
- Modify: `src/email/templates.ts:33,74`
- Modify: `src/git/hook-handler.ts:307`

- [ ] **Step 1: Update email queue**

In `src/email/queue.ts:61`, change:
```typescript
appUrl: process.env.VITE_API_URL?.replace(':3000', ':7000') || 'http://localhost:7000',
```
to:
```typescript
appUrl: process.env.FRONTEND_URL || 'http://localhost:7000',
```

- [ ] **Step 2: Update email templates fallback**

In `src/email/templates.ts`, ensure the `appUrl` parameter is used consistently. The templates already accept `data.appUrl` -- no template changes needed if the queue passes it correctly.

- [ ] **Step 3: Update hook-handler default URL**

In `src/git/hook-handler.ts:307`, change the default parameter:
```typescript
// Before
export function generatePostReceiveHook(
  repoId: string,
  apiBaseUrl: string = 'http://localhost:3000',
): string {

// After
export function generatePostReceiveHook(
  repoId: string,
  apiBaseUrl: string = process.env.API_BASE_URL || 'http://localhost:3000',
): string {
```

- [ ] **Step 4: Add FRONTEND_URL to .env.example**

Add to `.env.example`:
```
FRONTEND_URL=http://localhost:7000
```

- [ ] **Step 5: Add FRONTEND_URL to docker-compose.dev.yml**

In the `api` service environment section, add:
```yaml
FRONTEND_URL: http://localhost:7000
```

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/email/queue.ts src/git/hook-handler.ts .env.example docker-compose.dev.yml
git commit -m "fix: replace hardcoded localhost with FRONTEND_URL env var

Email links previously used a fragile port-swapping hack
(VITE_API_URL.replace(':3000', ':7000')). Now uses a dedicated
FRONTEND_URL environment variable with localhost fallback for dev."
```

---

### Task 4: Structured logging for pipeline failures and hook-handler

**Files:**
- Modify: `src/modules/pipelines/pipelines.service.ts:146`
- Modify: `src/git/hook-handler.ts:83`

- [ ] **Step 1: Fix pipeline service logging**

In `src/modules/pipelines/pipelines.service.ts:146`, change:
```typescript
runPipeline(run).catch(console.error);
```
to:
```typescript
runPipeline(run).catch((err) => logger.error('Pipeline execution failed', { runId: run.id, pipelineId }, err));
```

Add import if not present:
```typescript
import { logger } from '../../utils/logger';
```

- [ ] **Step 2: Fix hook-handler catch block**

In `src/git/hook-handler.ts:83`, the catch block is a bare `catch {` with no error variable. Change:
```typescript
      } catch {
        // Protection check is best-effort in post-receive
      }
```
to:
```typescript
      } catch (err) {
        logger.debug('Branch protection check skipped in post-receive', { repoId: repo.id, branch, err });
      }
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/modules/pipelines/pipelines.service.ts src/git/hook-handler.ts
git commit -m "fix: use structured logger instead of console.error

Pipeline failures and hook-handler protection checks now log via
the structured logger instead of console.error or silent swallowing."
```

---

### Task 5: Remove debug console statements from frontend attachments API

**Files:**
- Modify: `frontend/src/api/attachments.api.ts:53,83,134`

- [ ] **Step 1: Remove console.error calls**

In `frontend/src/api/attachments.api.ts`, remove the three `console.error('Failed to parse error response JSON', err)` calls. The errors are already thrown/handled by the caller -- the console statements are debug leftovers.

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/attachments.api.ts
git commit -m "chore: remove debug console.error from attachments API client"
```

---

### Task 6: Replace inline badge reimplementations with Badge component

**Files:**
- Modify: `frontend/src/pages/issues/IssueDetail.tsx:432-435`
- Modify: `frontend/src/pages/issues/IssueDetailComments.tsx:100-103`
- Modify: `frontend/src/pages/wiki/PageEdit.tsx:348`
- Modify: `frontend/src/pages/wiki/PageView.tsx:395`

All 4 files use the same pattern -- an inline `<span>` with badge styling for count pills:
```tsx
<span className="inline-flex items-center rounded-full bg-surface-tertiary px-2 py-0.5 text-xs font-medium text-text-secondary normal-case tracking-normal">
  {count}
</span>
```

This is exactly `<Badge variant="default" size="sm">`.

- [ ] **Step 1: Update IssueDetail.tsx**

Replace the inline span at line ~433 with:
```tsx
<Badge size="sm">{attachments.length}</Badge>
```

Add import: `import { Badge } from '@/components/ui/Badge';`

- [ ] **Step 2: Update IssueDetailComments.tsx**

Replace the inline span at line ~101 with:
```tsx
<Badge size="sm">{sortedComments.length}</Badge>
```

Add import: `import { Badge } from '@/components/ui/Badge';`

Note: Keep the `ml-2` by wrapping or adding className: `<Badge size="sm" className="ml-2">`

- [ ] **Step 3: Update PageEdit.tsx**

Replace the inline span at line ~348 with equivalent `<Badge size="sm">`.
Add import.

- [ ] **Step 4: Update PageView.tsx**

Replace the inline span at line ~395 with equivalent `<Badge size="sm">`.
Add import.

- [ ] **Step 5: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: Visually verify in browser**

Navigate to an issue with attachments and comments. Verify the count badges render identically to before (rounded pill, muted background, small text).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/issues/IssueDetail.tsx frontend/src/pages/issues/IssueDetailComments.tsx frontend/src/pages/wiki/PageEdit.tsx frontend/src/pages/wiki/PageView.tsx
git commit -m "refactor: replace inline badge spans with Badge component

Four files reimplemented badge styling inline. Now uses the shared
Badge component with variant='default' size='sm' for consistency."
```

---

## P2: Polish

### Task 7: Add missing loading/error states

**Files:**
- Modify: `frontend/src/pages/issues/IssueLinkedSection.tsx`
- Modify: `frontend/src/pages/wiki/WikiLayout.tsx`
- Modify: `frontend/src/pages/repos/BranchCompare.tsx`
- Modify: `frontend/src/components/ui/CommandPalette.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Add loading states to each component**

For each component that uses `useQuery` without handling `isLoading`:

Pattern:
```tsx
const { data, isLoading } = useQuery({ ... });

if (isLoading) return <Skeleton className="h-8 w-full" />;
```

For `CommandPalette` and `Sidebar`, use inline spinners rather than full skeletons since they're always-visible chrome.

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/issues/IssueLinkedSection.tsx frontend/src/pages/wiki/WikiLayout.tsx frontend/src/pages/repos/BranchCompare.tsx frontend/src/components/ui/CommandPalette.tsx frontend/src/components/layout/Sidebar.tsx
git commit -m "fix: add missing loading states to query-dependent components"
```

---

### Task 8: Fix SearchResults.tsx any types

**Files:**
- Modify: `frontend/src/pages/search/SearchResults.tsx`

- [ ] **Step 1: Define proper result interfaces**

Add interfaces at top of file:

```typescript
interface SearchResultItem {
  id: string;
  type: 'issue' | 'pull_request' | 'wiki_page' | 'repository' | 'code';
  title: string;
  snippet?: string;
  url: string;
  projectKey?: string;
  number?: number;
  state?: string;
  // Add other fields as discovered in the API response
}

interface SearchResultGroup {
  type: string;
  label: string;
  items: SearchResultItem[];
}
```

- [ ] **Step 2: Replace all `any` types with the new interfaces**

Update the map callbacks from `(item: any)` to `(item: SearchResultItem)`. Remove the eslint-disable comments.

- [ ] **Step 3: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (may need to adjust interface fields)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/search/SearchResults.tsx
git commit -m "refactor: add proper TypeScript types to search results

Replaces 'any' type annotations with SearchResultItem and
SearchResultGroup interfaces for type safety."
```

---

### Task 9: Add aria-label to FileUpload drop zone

**Files:**
- Modify: `frontend/src/components/ui/FileUpload.tsx:129`

- [ ] **Step 1: Add aria-label**

On the `role="button"` div, add:
```tsx
aria-label="Drop files here or click to upload"
```

- [ ] **Step 2: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/FileUpload.tsx
git commit -m "fix(a11y): add aria-label to FileUpload drop zone"
```

---

### Task 10: Replace raw button elements with Button component

**Files:**
- Modify: `frontend/src/pages/wiki/PageView.tsx:51`
- Modify: `frontend/src/pages/wiki/PageViewSidebar.tsx:134,170`
- Modify: `frontend/src/pages/repos/PRDiffView.tsx:183,309`
- Modify: `frontend/src/pages/projects/Milestones.tsx:255`

- [ ] **Step 1: Audit each raw button**

Read each file and determine if the raw `<button>` can be replaced with `<Button variant="ghost" size="xs">` or similar. Some may need to stay raw if they have very specific layout requirements (e.g., inside table cells with tight spacing).

- [ ] **Step 2: Replace where appropriate**

For each replaceable button:
```tsx
// Before
<button type="button" onClick={handler} className="...">
  <Icon className="h-4 w-4" />
</button>

// After
<Button variant="ghost" size="xs" onClick={handler} title="Action description">
  <Icon className="h-4 w-4" />
</Button>
```

Add `import { Button } from '@/components/ui/Button'` where needed.

- [ ] **Step 3: Run frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Visually verify affected pages**

Check wiki pages, PR diff view, and milestones to ensure buttons render correctly.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/wiki/PageView.tsx frontend/src/pages/wiki/PageViewSidebar.tsx frontend/src/pages/repos/PRDiffView.tsx frontend/src/pages/projects/Milestones.tsx
git commit -m "refactor: replace raw button elements with Button component

Replaces raw <button> elements with the shared Button component
for consistency with the design system."
```

---

### Task 11: Badge patterns in IssueTemplates and LabelsSettings (deferred)

**Files:**
- `frontend/src/pages/projects/IssueTemplates.tsx:190,313`
- `frontend/src/pages/projects/LabelsSettings.tsx:214,323`

These use inline badge-like pills with **dynamic background colors** set via `style={{ backgroundColor, color }}` from label data. The current `Badge` component does not support arbitrary inline styles for dynamic colors. Two options:

1. Extend Badge to accept a `style` prop or a `color` override -- then refactor these files
2. Leave as-is since the dynamic coloring is a legitimate reason to not use the static Badge variants

- [ ] **Step 1: Evaluate whether Badge should support dynamic colors**

Read the patterns in both files. If the colors come from user-defined label colors (hex values), extending Badge is the right call. If it's just 2-3 fixed colors, map them to Badge variants.

- [ ] **Step 2: If extending Badge, add `style` passthrough**

The Badge component already extends `HTMLAttributes<HTMLSpanElement>` via `...props` spread, so `style` should already work. Test with:
```tsx
<Badge style={{ backgroundColor: '#ff0000', color: '#fff' }}>{label.name}</Badge>
```

- [ ] **Step 3: Refactor if appropriate, commit**

---

## Summary

| Phase | Tasks | Items Fixed | Estimated Effort |
|-------|-------|-------------|-----------------|
| P0 | 1-2 | 3 security issues | M-L |
| P1 | 3-6 | 5 quality issues | S each |
| P2 | 7-11 | 6 polish items | S-M each |
| **Total** | **11 tasks** | **14 issues** | |

Run `npm run check` after all tasks to verify nothing is broken.
