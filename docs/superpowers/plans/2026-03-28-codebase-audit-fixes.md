# Codebase Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all verified issues from the 2026-03-28 codebase audit: enforce Card component usage, convert AuthImage to TanStack Query, add pagination defaults, expand rate limiting, extract FormModal wrapper, improve accessibility, add dangerouslySetInnerHTML lint protection, and add ErrorBoundary coverage.

**Architecture:** Mostly mechanical refactors across existing files. One new shared component (`FormModal`). Backend changes are additive (pagination defaults, rate limiters). Accessibility improvements target existing UI components. No new routes, no schema changes.

**Tech Stack:** React 19, TanStack Query, express-rate-limit, Zod, Tailwind CSS 4, Vitest, Playwright

**Spec:** `docs/superpowers/specs/2026-03-28-codebase-audit-findings.md` + `docs/superpowers/specs/2026-03-28-codebase-audit-devils-advocate.md`

---

## Task 1: Convert AuthImage to TanStack Query

**Files:**
- Modify: `frontend/src/components/ui/AttachmentList.tsx:32-63`

- [ ] **Step 1: Write the refactored AuthImage using useQuery**

Replace the `useEffect` + `fetch` pattern with a `useQuery` call. The query function still calls `fetch` internally (needed for blob URL creation), but lifecycle is managed by TanStack Query.

```tsx
function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const { data: blobUrl } = useQuery({
    queryKey: ['auth-image', src],
    queryFn: async () => {
      const token = getAccessToken();
      const res = await fetch(src, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    },
    staleTime: Infinity,
    gcTime: 5 * 60_000,
  });

  useEffect(() => {
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [blobUrl]);

  if (!blobUrl) return null;
  return <img src={blobUrl} alt={alt} className={className} loading="lazy" />;
}
```

Note: We still need a small `useEffect` for blob URL cleanup (revoking object URLs), but the fetch itself is now query-managed. Add `import { useQuery } from '@tanstack/react-query'` if not already imported.

- [ ] **Step 2: Verify the attachment list renders correctly**

Run: `npx tsc --noEmit` from `frontend/`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/AttachmentList.tsx
git commit -m "refactor(ui): convert AuthImage from useEffect+fetch to TanStack Query"
```

---

## Task 2: Enforce Card Component Usage (Batch 1 - Pages)

**Files:**
- Modify: All `.tsx` files in `frontend/src/pages/` containing `rounded-lg border border-border bg-surface`
- Reference: `frontend/src/components/ui/Card.tsx` (existing component)

The Card component exposes `Card`, `CardHeader`, and `CardContent`. The base `Card` renders `<div className={cn('rounded-lg border border-border bg-surface', className)}>`. The goal is to replace inline card class strings with `<Card>` usage.

- [ ] **Step 1: Identify all inline card patterns in pages**

Run: `grep -rn "rounded-lg border border-border bg-surface" frontend/src/pages/ --include="*.tsx" -l`

This gives the full list of files to modify.

- [ ] **Step 2: Replace inline patterns with Card component**

For each file found in Step 1, replace the pattern. Three common cases:

**Case A - Simple container:**
```tsx
// Before
<div className="rounded-lg border border-border bg-surface p-4">
  {children}
</div>

// After
<Card className="p-4">
  {children}
</Card>
```

**Case B - Container with extra classes (hover, shadow, etc.):**
```tsx
// Before
<div className="rounded-lg border border-border bg-surface p-4 hover:border-primary/50 hover:shadow-sm">

// After
<Card className="p-4 hover:border-primary/50 hover:shadow-sm">
```

**Case C - Container with header:**
```tsx
// Before
<div className="rounded-lg border border-border bg-surface">
  <div className="border-b border-border px-4 py-3 font-medium">Title</div>
  <div className="p-4">{content}</div>
</div>

// After
<Card>
  <CardHeader>Title</CardHeader>
  <CardContent>{content}</CardContent>
</Card>
```

Add `import { Card, CardHeader, CardContent } from '@/components/ui/Card'` to each modified file. Only import the sub-components actually used.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/
git commit -m "refactor(ui): enforce Card component usage across page files"
```

---

## Task 3: Enforce Card Component Usage (Batch 2 - Components)

**Files:**
- Modify: All `.tsx` files in `frontend/src/components/` containing `rounded-lg border border-border bg-surface`

- [ ] **Step 1: Identify all inline card patterns in components**

Run: `grep -rn "rounded-lg border border-border bg-surface" frontend/src/components/ --include="*.tsx" -l`

Exclude `Card.tsx` itself from the results.

- [ ] **Step 2: Replace inline patterns with Card component**

Same replacement rules as Task 2. Be careful not to create circular imports -- if a component in `components/ui/` would need to import Card from the same directory, that's fine (peer imports are allowed).

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/
git commit -m "refactor(ui): enforce Card component in shared components"
```

---

## Task 4: Add Default Pagination Limits to Backend Services

**Files:**
- Modify: Service files in `src/modules/` that call `findMany()` without `take`/`skip`
- Reference: `src/utils/pagination.ts` (existing utilities: `parsePagination`, `parseServicePagination`, `paginatedResponse`)

The existing `parsePagination(query)` returns `{ take, skip }` with defaults of `take: 20, skip: 0`. The goal is to ensure every list endpoint uses this utility and no `findMany()` returns unbounded results.

- [ ] **Step 1: Find all findMany calls without take**

Run: `grep -rn "findMany" src/modules/ --include="*.ts" -l`

Then check each file for whether the `findMany` call includes a `take` parameter.

- [ ] **Step 2: Add pagination to unbounded list endpoints**

For each service method that calls `findMany` without `take`, add pagination using the existing utility:

```typescript
// In the controller - parse pagination from query params
const pagination = parsePagination(req.query);

// In the service - pass take/skip to Prisma
const [data, total] = await Promise.all([
  prisma.model.findMany({
    where,
    ...pagination,
    orderBy: { createdAt: 'desc' },
  }),
  prisma.model.count({ where }),
]);

return paginatedResponse(data, total, pagination.take, pagination.skip);
```

If the controller already parses pagination but the service ignores it, wire it through. If neither exists, add both.

**Important:** Some endpoints intentionally return all results (e.g., labels for a project, workflow states). Use judgment -- if the max possible result count is bounded by design (< 100 items), pagination is unnecessary.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Run backend tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add src/modules/
git commit -m "fix(api): add default pagination limits to unbounded list endpoints"
```

---

## Task 5: Expand Rate Limiting

**Files:**
- Modify: `src/index.ts:90-110`
- Create: `src/middleware/rate-limit.ts`

Currently, rate limiting uses `express-rate-limit` with:
- Global: 300 req/min
- Auth endpoints: 15 req/min

- [ ] **Step 1: Create rate-limit middleware module**

Create `src/middleware/rate-limit.ts` to centralize rate limit configurations:

```typescript
import rateLimit from 'express-rate-limit';
import { env } from '../config/environment.js';

const skip = () => env.NODE_ENV === 'test';

const errorMessage = (msg: string) => ({
  error: { message: msg, code: 'RATE_LIMITED' },
});

/** Global: 300 req/min */
export const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
});

/** Auth endpoints: 15 req/min */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  max: 15,
  message: errorMessage('Too many authentication attempts, please try again later'),
  skip,
});

/** Search: 30 req/min (runs full-text queries) */
export const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: errorMessage('Too many search requests, please try again later'),
  skip,
});

/** Git smart HTTP: 120 req/min */
export const gitLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  message: errorMessage('Too many git requests, please try again later'),
  skip,
});
```

- [ ] **Step 2: Apply rate limiters in index.ts**

Update `src/index.ts` to import from the new module and apply limiters:

```typescript
import { globalLimiter, authLimiter, searchLimiter, gitLimiter } from './middleware/rate-limit.js';

// Replace existing inline rate limit definitions with imports
app.use(globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/search', searchLimiter);
app.use('/git', gitLimiter);
```

Remove the inline `rateLimit()` calls that were previously in `src/index.ts`.

- [ ] **Step 3: Typecheck and test**

Run: `npx tsc --noEmit && npm run test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/middleware/rate-limit.ts src/index.ts
git commit -m "feat(api): expand rate limiting to search and git endpoints"
```

---

## Task 6: Extract FormModal Wrapper Component

**Files:**
- Create: `frontend/src/components/ui/FormModal.tsx`
- Modify: `frontend/src/pages/issues/CreateBranchModal.tsx`
- Modify: `frontend/src/pages/wiki/CreateFolderModal.tsx`
- Modify: `frontend/src/pages/repos/CreateReleaseModal.tsx`
- Modify: `frontend/src/pages/issues/IssueLinkModal.tsx`
- Modify: `frontend/src/pages/issues/SprintFormModal.tsx`

All 5 modals share: error state, mutation pending state, cancel/submit footer buttons, modal wrapper. Extract this boilerplate.

- [ ] **Step 1: Create FormModal component**

```tsx
import { type ReactNode } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Modal, ModalFooter } from './Modal';
import { Button } from './Button';

interface FormModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  onSubmit: () => void;
  isPending: boolean;
  error?: string | null;
  submitLabel: string;
  submitIcon: ReactNode;
  cancelLabel?: string;
  disabled?: boolean;
  children: ReactNode;
}

export function FormModal({
  open,
  onClose,
  title,
  onSubmit,
  isPending,
  error,
  submitLabel,
  submitIcon,
  cancelLabel = 'Cancel',
  disabled = false,
  children,
}: FormModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        {children}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={onClose}>
          <X className="h-4 w-4" />
          {cancelLabel}
        </Button>
        <Button
          onClick={onSubmit}
          disabled={disabled || isPending}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : submitIcon}
          {submitLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
```

- [ ] **Step 2: Refactor each modal to use FormModal**

For each of the 5 modals, replace the `<Modal>` + error display + `<ModalFooter>` boilerplate with `<FormModal>`. Keep the form fields as `children`. Keep the `useMutation` and `useState` calls in each modal -- only the wrapper JSX changes.

Example refactor pattern:
```tsx
// Before
return (
  <Modal open={true} onClose={onClose} title="Create Branch">
    <div className="space-y-4">
      {/* form fields */}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
    <ModalFooter>
      <Button variant="outline" onClick={onClose}><X /> Cancel</Button>
      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        <GitBranch /> Create
      </Button>
    </ModalFooter>
  </Modal>
);

// After
return (
  <FormModal
    open={true}
    onClose={onClose}
    title="Create Branch"
    onSubmit={() => mutation.mutate()}
    isPending={mutation.isPending}
    error={error}
    submitLabel="Create"
    submitIcon={<GitBranch className="h-4 w-4" />}
  >
    {/* form fields only */}
  </FormModal>
);
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ui/FormModal.tsx frontend/src/pages/
git commit -m "refactor(ui): extract FormModal wrapper to reduce modal boilerplate"
```

---

## Task 7: Accessibility Improvements - Interactive Components

**Files:**
- Modify: `frontend/src/components/ui/Button.tsx`
- Modify: `frontend/src/components/ui/Dropdown.tsx`
- Modify: `frontend/src/components/ui/Badge.tsx`
- Modify: `frontend/src/components/ui/Tabs.tsx`
- Modify: `frontend/src/components/ui/Table.tsx`

- [ ] **Step 1: Add aria-label support to icon-only buttons**

In `Button.tsx`, icon-only buttons (no visible text) need `aria-label` or `title` for screen readers. The component already supports `title` via `...props` spread. Add a dev-mode warning if neither `aria-label` nor `title` nor `children` text is provided:

```tsx
// Add inside the button component, before return
if (process.env.NODE_ENV === 'development' && !props['aria-label'] && !props.title) {
  const hasTextContent = typeof children === 'string' ||
    (Array.isArray(children) && children.some(c => typeof c === 'string'));
  if (!hasTextContent) {
    console.warn('Button: icon-only buttons should have aria-label or title prop');
  }
}
```

- [ ] **Step 2: Add keyboard navigation to Dropdown**

Check if `Dropdown.tsx` already handles arrow key navigation within the menu. If not, add:
- `ArrowDown` / `ArrowUp` to move focus between items
- `Home` / `End` to jump to first/last item
- `role="menu"` on the dropdown container
- `role="menuitem"` on each item
- `aria-expanded` on the trigger button

Only add what's missing -- check the component first.

- [ ] **Step 3: Add aria attributes to Tabs**

Ensure `Tabs.tsx` has:
- `role="tablist"` on the tab container
- `role="tab"` on each tab
- `role="tabpanel"` on the content area
- `aria-selected="true"` on the active tab
- `aria-controls` / `id` linking tabs to panels

Only add what's missing.

- [ ] **Step 4: Add scope attributes to Table headers**

In `Table.tsx`, ensure `<th>` elements have `scope="col"` or `scope="row"`.

- [ ] **Step 5: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ui/
git commit -m "fix(a11y): add ARIA attributes to Button, Dropdown, Tabs, and Table"
```

---

## Task 8: Add dangerouslySetInnerHTML Lint Protection

**Files:**
- Modify: `frontend/eslint.config.js` (or `.eslintrc.*` -- check which config format is used)

- [ ] **Step 1: Check ESLint config format**

Run: `ls frontend/eslint.config.* frontend/.eslintrc.* 2>/dev/null`

- [ ] **Step 2: Add no-danger rule**

Add `react/no-danger` as a warning (not error -- existing usages are sanitized but we want visibility for new ones):

For flat config (`eslint.config.js`):
```javascript
{
  rules: {
    'react/no-danger': 'warn',
  },
}
```

For legacy config (`.eslintrc.*`):
```json
{
  "rules": {
    "react/no-danger": "warn"
  }
}
```

- [ ] **Step 3: Verify existing usages trigger warnings**

Run: `cd frontend && npx eslint src/components/editor/MarkdownRenderer.tsx --no-error-on-unmatched-pattern 2>&1 | head -20`
Expected: Warnings (not errors) for existing `dangerouslySetInnerHTML` usages

- [ ] **Step 4: Commit**

```bash
git add frontend/eslint.config.* frontend/.eslintrc.* 2>/dev/null
git commit -m "chore(lint): add react/no-danger warning for dangerouslySetInnerHTML usage"
```

---

## Task 9: Expand ErrorBoundary Coverage

**Files:**
- Modify: `frontend/src/App.tsx` (main route definitions)
- Modify: `frontend/src/routes/admin-routes.tsx`
- Modify: `frontend/src/routes/project-routes.tsx`
- Modify: `frontend/src/routes/repo-routes.tsx`
- Reference: `frontend/src/components/ui/ErrorBoundary.tsx`

- [ ] **Step 1: Find all route definition files**

Run: `grep -rn "ErrorBoundary" frontend/src/ --include="*.tsx" -l` to see current usage, then `ls frontend/src/routes/` or `grep -rn "createBrowserRouter\|Routes\|Route" frontend/src/ --include="*.tsx" -l` to find all route files.

- [ ] **Step 2: Wrap major route segments with ErrorBoundary**

Add `<ErrorBoundary>` wrappers around route segments that don't already have them. Target the major feature areas:

- Issues routes (board, backlog, list, detail)
- Wiki routes (page view, edit, history)
- Team routes (list, detail, members)
- Settings routes (profile, security, tokens)
- Dashboard routes

Pattern:
```tsx
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

// Wrap each major route segment
{
  path: 'issues',
  element: <ErrorBoundary><IssueLayout /></ErrorBoundary>,
  children: [...]
}
```

Or if using React Router's `errorElement`:
```tsx
{
  path: 'issues',
  element: <IssueLayout />,
  errorElement: <ErrorBoundary />,
  children: [...]
}
```

Check which pattern is already used in the codebase and follow it.

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/routes/ frontend/src/App.tsx
git commit -m "fix(ui): expand ErrorBoundary coverage to all major route segments"
```

---

## Task 10: Final Verification

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit && cd frontend && npx tsc --noEmit`
Expected: No type errors in backend or frontend

- [ ] **Step 2: Run all backend tests**

Run: `npm run test`
Expected: All tests pass

- [ ] **Step 3: Run lint and format check**

Run: `npm run check`
Expected: All checks pass

- [ ] **Step 4: Verify no remaining inline card patterns**

Run: `grep -rn "rounded-lg border border-border bg-surface" frontend/src/ --include="*.tsx" | grep -v Card.tsx | grep -v node_modules`
Expected: Zero results (all replaced with Card component)

- [ ] **Step 5: Final commit if any fixes needed**

Fix any issues found in steps 1-4 and commit.
