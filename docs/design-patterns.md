# Design Patterns

This document is the definitive guide for building new features in Axiom. It covers every shared component, hook, utility, design token, and code pattern available. Follow these patterns to keep the codebase consistent.

---

## Non-Negotiable Rules

1. **No emojis** -- anywhere in source, UI, seed data, or commits
2. **Lucide icons only** -- import from `lucide-react`, no other icon libraries or inline SVGs
3. **Every button must have an icon** -- no text-only buttons (icon-only allowed with `title` prop)
4. **Design tokens only** -- never use Tailwind palette colors directly (`text-blue-500`); use CSS variables (`text-primary`)
5. **Shared components first** -- check `components/ui/` before building anything

---

## CSS Design Tokens

Use these semantic tokens everywhere. They adapt automatically for dark mode.

### Text
| Token | Purpose |
|---|---|
| `text-text` | Primary text |
| `text-text-secondary` | Supporting text |
| `text-text-tertiary` | Disabled / placeholder |
| `text-text-inverse` | Text on dark backgrounds |

### Surfaces
| Token | Purpose |
|---|---|
| `bg-surface` | Main background (cards, pages) |
| `bg-surface-secondary` | Subtle contrast (table headers, hover) |
| `bg-surface-tertiary` | Stronger contrast (code blocks, active states) |
| `bg-surface-elevated` | Elevated panels (modals, dropdowns) |

### Borders
| Token | Purpose |
|---|---|
| `border-border` | Standard borders |
| `border-border-light` | Subtle separators (table row dividers) |
| `border-border-focus` | Focus ring borders |

### Semantic Colors
| Token | Purpose |
|---|---|
| `text-primary` / `bg-primary` | Brand / primary actions |
| `bg-primary-light` | Light primary background |
| `text-danger` / `bg-danger` | Errors, destructive actions |
| `bg-danger-light` | Light danger background |
| `text-warning` / `bg-warning` | Warnings, caution |
| `text-success` / `bg-success` | Success, positive |

### Sizing Standards
| Element | Standard |
|---|---|
| Card border radius | `rounded-lg` |
| Button border radius | `rounded-md` |
| Modal border radius | `rounded-xl` |
| Avatars, pills | `rounded-full` |
| Transition duration | `duration-150` (interactions) |
| Focus ring | `focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-1` |
| Data row hover | `hover:bg-surface-secondary transition-colors` (for dense lists, tables) |
| Card hover | `hover:border-primary/50 hover:shadow-sm transition-all` (for navigation tiles) |
| Card container | `rounded-lg border border-border bg-surface overflow-hidden` |

### Hover Pattern: Cards vs Rows

Use **card hover** for navigation tiles (dashboards, team overview -- few items, prominent):
```tsx
<Link className="group rounded-lg border border-border bg-surface p-4 hover:border-primary/50 hover:shadow-sm transition-all">
  ...
  <ArrowRight className="opacity-0 group-hover:opacity-100 transition-opacity" />
</Link>
```

Use **row hover** for dense data lists (repo list, PR list, file browser -- many items, scannable):
```tsx
<div className="rounded-lg border border-border bg-surface divide-y divide-border">
  <Link className="flex items-center gap-3 px-4 py-3 hover:bg-surface-secondary transition-colors">
    ...
  </Link>
</div>
```

Never mix these styles within the same page section. If a section uses cards, all items in that section are cards. If it uses rows, all items are rows.

---

## Shared UI Components

All live in `frontend/src/components/ui/`. Every component uses `forwardRef`, `cn()` for className merging, and CSS variable tokens.

### Form Inputs

**Button** -- all clickable actions
```tsx
<Button variant="primary" size="md">       // primary, secondary, danger, ghost, outline
  <Plus className="h-4 w-4" /> Create      // sizes: xs, sm, md, lg
</Button>
```

**Input** -- text inputs with label, hint, and error support
```tsx
<Input label="Email" placeholder="you@example.com" error="Required" hint="We won't share it" />
```

**Textarea** -- multi-line text with same label/hint/error API as Input

**Checkbox** -- labeled checkbox
```tsx
<Checkbox label="Accept terms" checked={agreed} onChange={setAgreed} />
```

**Toggle** -- on/off switch
```tsx
<Toggle label="Enable notifications" checked={enabled} onChange={setEnabled} />
```

**Select** (from Dropdown) -- form dropdown
```tsx
<Select label="Priority" value={priority} onChange={setPriority}
  options={[{ value: 'HIGH', label: 'High' }, { value: 'LOW', label: 'Low' }]} />
```

### Display

**Avatar** -- user avatars with fallback initials
```tsx
<Avatar name="Jane Doe" src={user.avatarUrl} size="sm" />  // xs, sm, md, lg
```

**Badge** -- status chips and labels
```tsx
<Badge variant="success" size="sm">Active</Badge>  // default, primary, danger, warning, success, outline
```

**Progress** -- progress bars
```tsx
<Progress value={75} size="sm" variant="primary" />
```

**Spinner / PageLoader** -- loading indicators
```tsx
<Spinner className="h-4 w-4" />  // inline
<PageLoader />                    // full page
```

**Skeleton / TableSkeleton / ListSkeleton** -- loading placeholders
```tsx
<Skeleton className="h-8 w-full" />
<TableSkeleton rows={5} cols={4} />
```

**Tooltip** -- hover hints
```tsx
<Tooltip content="Delete this item"><Button variant="ghost">...</Button></Tooltip>
```

**IssueTypeIcon** -- renders issue type icons (TASK, BUG, STORY, EPIC)
```tsx
<IssueTypeIcon type="BUG" className="h-4 w-4" />
```

### Overlays

**Modal** -- overlay dialogs via createPortal
```tsx
<Modal open={isOpen} onClose={() => setOpen(false)} title="Edit Item" size="md">
  <form>...</form>
  <ModalFooter>
    <Button variant="secondary"><X /> Cancel</Button>
    <Button><Save /> Save</Button>
  </ModalFooter>
</Modal>
```

**ConfirmDialog** -- destructive action confirmation
```tsx
<ConfirmDialog open={!!target} onClose={() => setTarget(null)}
  onConfirm={() => deleteMutation.mutate(target.id)}
  title="Delete Item" description="This cannot be undone."
  confirmLabel="Delete" loading={deleteMutation.isPending} />
```

**Dropdown / DropdownItem** -- contextual menus
```tsx
<Dropdown trigger={<Button variant="ghost"><MoreVertical /></Button>}>
  <DropdownItem onClick={handleEdit}><Pencil /> Edit</DropdownItem>
  <DropdownItem onClick={handleDelete}><Trash2 /> Delete</DropdownItem>
</Dropdown>
```

### Navigation & Layout

**Tabs** -- tab bar navigation
```tsx
<Tabs tabs={[{ key: 'overview', label: 'Overview', icon: <Eye /> }]}
  activeKey={tab} onChange={setTab} />
```

**Pagination** -- offset-based page navigation
```tsx
<Pagination total={200} limit={25} offset={page * 25}
  onPageChange={(offset) => setPage(Math.floor(offset / 25))} />
```

**EmptyState** -- zero-data placeholders
```tsx
<EmptyState icon={<Inbox />} title="No items yet"
  description="Create your first item to get started."
  action={<Button><Plus /> Create</Button>} />
```

### Data Tables

**Table / Thead / Tbody / TrHead / Tr / Th / Td / TableContainer**
```tsx
<TableContainer>         {/* rounded-lg border border-border bg-surface overflow-hidden */}
  <Table>                {/* w-full text-sm */}
    <Thead>
      <TrHead>           {/* border-b bg-surface-secondary */}
        <Th>Name</Th>    {/* px-4 py-3 text-xs font-medium uppercase tracking-wide */}
        <Th className="text-right">Actions</Th>
      </TrHead>
    </Thead>
    <Tbody>              {/* divide-y divide-border-light */}
      <Tr>               {/* hover:bg-surface-secondary transition-colors */}
        <Td>Item</Td>    {/* px-4 py-3 */}
        <Td className="text-right">...</Td>
      </Tr>
    </Tbody>
  </Table>
</TableContainer>
```

Use raw `<table>` elements only for specialized displays (code diffs, blame views, file listings).

### Editor Components

**MarkdownRenderer** -- renders markdown with syntax highlighting and mermaid diagrams
```tsx
<MarkdownRenderer content={markdownString} />
```

**MarkdownEditor** -- TipTap WYSIWYG editor with toolbar
```tsx
<MarkdownEditor value={body} onChange={setBody} compact />
```

### Notifications

**Toast / useToast** -- transient notifications (4s auto-dismiss)
```tsx
const toast = useToast();
toast.success('Item created');
toast.error('Something went wrong');
toast.info('Processing...');
```

---

## Custom Hooks

| Hook | Purpose | Example |
|---|---|---|
| `useDebounce(value, delay?)` | Debounce a value (default 300ms) | `const q = useDebounce(search)` |
| `usePaginatedQuery({ queryKey, queryFn, pageSize? })` | Pagination + React Query | Returns `{ data, page, setPage, totalPages, isLoading }` |
| `useMutationWithToast(fn, opts?)` | Mutation + toast + invalidation | `useMutationWithToast(api.delete, { successMessage: 'Deleted', invalidateKeys: [['items']] })` |
| `useRepoContext()` | Current repo from URL params | Returns `{ org, teamSlug, repoSlug, basePath }` |
| `useKeyboard()` | Global keyboard shortcuts | Cmd+K search, ? help, / focus |
| `useDarkMode()` | Dark mode toggle | Returns `{ isDark, toggle }` |
| `useWebSocket()` | Singleton WebSocket connection | Auto-reconnect with backoff |
| `useIssueListFilters(issues)` | Multi-filter/sort for issue lists | Returns filtered issues + filter state |

---

## Data Fetching Patterns

### Server State: TanStack Query
```tsx
// Fetch data
const { data, isLoading } = useQuery({
  queryKey: ['issues', projectId, page],         // always arrays, match resource hierarchy
  queryFn: () => issuesApi.list(projectId, { limit: 25, offset: page * 25 }),
});

// Mutate data
const mutation = useMutation({
  mutationFn: (data) => issuesApi.create(projectId, data),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issues'] }),
});
```

### Client State: Zustand
```tsx
// Only for UI state -- never for server data
const { sidebarOpen, toggleSidebar } = useUIStore();
const { user, isAuthenticated } = useAuthStore();
```

### API Client
```tsx
import { get, post, patch, del } from '@/api/client';

export const itemsApi = {
  list: (params) => get<{ items: Item[]; total: number }>('/items?' + new URLSearchParams(params)),
  get: (id: string) => get<Item>(`/items/${id}`),
  create: (data) => post<Item>('/items', data),
  update: (id, data) => patch<Item>(`/items/${id}`, data),
  delete: (id) => del(`/items/${id}`),
};
```

---

## Backend Module Pattern

Every feature module follows the same 3-file structure:

### Routes (`module.routes.ts`)
```typescript
import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as controller from './module.controller';

const router = Router();
router.get('/', authenticate, controller.list);
router.post('/', authenticate, controller.create);
router.patch('/:id', authenticate, controller.update);
router.delete('/:id', authenticate, controller.delete);
export default router;
```

### Controller (`module.controller.ts`)
```typescript
import { Request, Response, NextFunction } from 'express';
import * as service from './module.service';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.list(req.params.projectId, req.query);
    res.json(result);
  } catch (err) { next(err); }
}
```

### Service (`module.service.ts`)
```typescript
import { prisma } from '../../db';
import { AppError } from '../../middleware/errorHandler';
import { parseServicePagination } from '../../utils/pagination';

export async function list(projectId: string, opts?: { limit?: number; offset?: number }) {
  const { take, skip } = parseServicePagination(opts);
  const [items, total] = await Promise.all([
    prisma.item.findMany({ where: { projectId }, take, skip, orderBy: { createdAt: 'desc' } }),
    prisma.item.count({ where: { projectId } }),
  ]);
  return { items, total };
}
```

### Error Handling
```typescript
throw new AppError(404, 'Item not found');
throw new AppError(403, 'Not authorized', 'INSUFFICIENT_PERMISSIONS');
```

### Pagination Utility
```typescript
import { parseServicePagination } from '../../utils/pagination';
const { take, skip } = parseServicePagination(opts);  // defaults: take=25, skip=0, max take=100
```

---

## Building a New Page (Checklist)

1. Create page component in `frontend/src/pages/feature/`
2. Add lazy route in `App.tsx`
3. Use `useQuery` for data fetching with proper query keys
4. Use shared UI components (Button, Input, Table, Modal, etc.)
5. Use design tokens for all colors
6. Add Lucide icons to every button
7. Include loading state (Skeleton or PageLoader)
8. Include empty state (EmptyState component)
9. Include error handling
10. Use `useMutationWithToast` for mutations

## Building a New Component (Checklist)

1. Place in `frontend/src/components/ui/`
2. Use `forwardRef` with proper generic types
3. Use `cn()` from `@/lib/utils` for className merging
4. Accept `className` prop for overrides
5. Use CSS variable tokens for all colors
6. Define variants/sizes as plain objects
7. Export as named export (never default)
8. Follow the Button.tsx pattern

## Building a New API Module (Checklist)

1. Create `frontend/src/api/feature.api.ts`
2. Import `get, post, patch, del` from `./client`
3. Export a named object with typed endpoints
4. Create backend module: routes + controller + service
5. Mount routes in `src/index.ts`
6. Use `parseServicePagination` for list endpoints
7. Use `AppError` for error responses
