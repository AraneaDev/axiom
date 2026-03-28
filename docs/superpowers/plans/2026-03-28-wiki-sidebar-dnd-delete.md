# Wiki Sidebar: Drag-and-Drop + Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add delete to the wiki sidebar context menu and VS Code-style drag-and-drop for reordering/reparenting pages.

**Architecture:** New `reorderPage` backend endpoint handles position + parent changes. Frontend uses `@dnd-kit` for drag-and-drop with three drop zones per tree node (before/child-of/after). Delete uses existing backend endpoint with a `ConfirmDialog` showing child count warning.

**Tech Stack:** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, React, TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-28-wiki-sidebar-dnd-delete-design.md`

---

### Task 1: Backend — Add `reorderPage` Service and Route

**Files:**
- Modify: `src/modules/wiki/wiki.service.ts`
- Modify: `src/modules/wiki/wiki.controller.ts`
- Modify: `src/modules/wiki/wiki.routes.ts`
- Modify: `src/utils/validation/user-validators.ts`
- Modify: `src/utils/validation.ts` (barrel export)

- [ ] **Step 1: Add validation schema**

In `src/utils/validation/user-validators.ts`, add after `movePageSchema`:

```typescript
export const reorderPageSchema = z.object({
  parentId: z.string().nullable(),
  position: z.number().int().min(0),
});
```

Then in `src/utils/validation.ts`, add `reorderPageSchema` to the re-export list from `'./validation/user-validators'`.

- [ ] **Step 2: Add `reorderPage` service function**

In `src/modules/wiki/wiki.service.ts`, add a new exported function:

```typescript
export async function reorderPage(
  pageId: string,
  parentId: string | null,
  position: number,
) {
  const page = await prisma.page.findUnique({ where: { id: pageId }, include: { space: true } });
  if (!page) throw new AppError(404, 'Page not found');

  // Prevent circular reference: ensure parentId is not the page itself or a descendant
  if (parentId) {
    if (parentId === pageId) throw new AppError(400, 'Cannot make a page its own parent');
    const descendants = await getDescendantIds(pageId);
    if (descendants.includes(parentId)) {
      throw new AppError(400, 'Cannot move a page under its own descendant');
    }
  }

  const oldParentId = page.parentId;

  // Update the page's parent and position
  await prisma.page.update({
    where: { id: pageId },
    data: { parentId, position },
  });

  // Re-index siblings at the new parent (exclude the moved page, then splice it in)
  const newSiblings = await prisma.page.findMany({
    where: { spaceId: page.spaceId, parentId, id: { not: pageId } },
    orderBy: { position: 'asc' },
    select: { id: true },
  });

  // Build ordered list with the moved page at the requested position
  const ordered = [...newSiblings.map((s) => s.id)];
  ordered.splice(Math.min(position, ordered.length), 0, pageId);

  // Batch update positions
  await Promise.all(
    ordered.map((id, idx) =>
      prisma.page.update({ where: { id }, data: { position: idx } }),
    ),
  );

  // Re-index old parent's children if parent changed
  if (oldParentId !== parentId) {
    const oldSiblings = await prisma.page.findMany({
      where: { spaceId: page.spaceId, parentId: oldParentId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    await Promise.all(
      oldSiblings.map((s, idx) =>
        prisma.page.update({ where: { id: s.id }, data: { position: idx } }),
      ),
    );
  }

  await cacheInvalidate(`wiki:tree:${page.spaceId}`);
  broadcastToRoom(`space:${page.spaceId}`, {
    type: 'wiki:updated',
    spaceId: page.spaceId,
    pageId,
  });

  return { success: true };
}
```

This requires a helper `getDescendantIds`. Check if one already exists. If not, add:

```typescript
async function getDescendantIds(pageId: string): Promise<string[]> {
  const children = await prisma.page.findMany({
    where: { parentId: pageId },
    select: { id: true },
  });
  const ids: string[] = [];
  for (const child of children) {
    ids.push(child.id);
    ids.push(...(await getDescendantIds(child.id)));
  }
  return ids;
}
```

- [ ] **Step 3: Add controller**

In `src/modules/wiki/wiki.controller.ts`, add:

```typescript
export const reorderPage = asyncHandler(async (req: Request, res: Response) => {
  const data = validate(reorderPageSchema, req.body);
  const result = await wikiService.reorderPage(param(req, 'pageId'), data.parentId, data.position);
  res.json(result);
});
```

Add `reorderPageSchema` to the imports from validation.

- [ ] **Step 4: Add route**

In `src/modules/wiki/wiki.routes.ts`, add near the existing `move` route (around line 131):

```typescript
router.patch('/pages/:pageId/reorder', requireWikiPageAccess(), wikiController.reorderPage);
```

- [ ] **Step 5: Verify backend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/wiki/wiki.service.ts src/modules/wiki/wiki.controller.ts src/modules/wiki/wiki.routes.ts src/utils/validation/user-validators.ts src/utils/validation.ts
git commit -m "feat(wiki): add reorderPage endpoint for drag-and-drop positioning"
```

---

### Task 2: Frontend — Add `reorderPage` API Client + Delete Helper

**Files:**
- Modify: `frontend/src/api/wiki.api.ts`

- [ ] **Step 1: Add `reorderPage` API function**

In `frontend/src/api/wiki.api.ts`, add to the `wikiApi` object:

```typescript
reorderPage: (pageId: string, data: { parentId: string | null; position: number }) =>
  patch(`/wiki/pages/${pageId}/reorder`, data),
```

- [ ] **Step 2: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/wiki.api.ts
git commit -m "feat(wiki): add reorderPage API client function"
```

---

### Task 3: Frontend — Add Delete to Sidebar Context Menu

**Files:**
- Modify: `frontend/src/pages/wiki/PageViewSidebar.tsx`

- [ ] **Step 1: Add imports**

Add to existing imports in `PageViewSidebar.tsx`:

```typescript
import { Trash2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { wikiApi } from '@/api/wiki.api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
```

Note: Check existing imports first -- `useQueryClient` or `useNavigate` may already be present. Add only what's missing.

- [ ] **Step 2: Add delete state and mutation to the sidebar component**

Inside the main sidebar component (the one that renders the tree), add state for tracking which node is being deleted. The component receives `basePath` as a prop -- use it for post-delete navigation:

```typescript
const [deleteTarget, setDeleteTarget] = useState<PageTreeNode | null>(null);
const queryClient = useQueryClient();
const navigate = useNavigate();

const deleteMutation = useMutation({
  mutationFn: () => wikiApi.deletePage(currentSpace!.id, deleteTarget!.slug),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['wikiPageTree'] });
    queryClient.invalidateQueries({ queryKey: ['page'] });
    // If deleted the active page, navigate to space root
    const wasActive = deleteTarget?.slug === activeSlug;
    setDeleteTarget(null);
    if (wasActive) {
      navigate(basePath);
    }
  },
});
```

- [ ] **Step 3: Count descendants helper**

Add a utility function (inside the file or above the component):

```typescript
function countDescendants(node: PageTreeNode): number {
  let count = node.children.length;
  for (const child of node.children) {
    count += countDescendants(child);
  }
  return count;
}
```

- [ ] **Step 4: Update TreeNode props and add delete option**

Update the `TreeNode` props interface to add `onDelete`:

```typescript
// Add to the TreeNode props interface (around line 102-118):
onDelete?: (node: PageTreeNode) => void;
```

Then add a new `DropdownItem` after "New Folder" in the TreeNode dropdown:

```typescript
<DropdownItem
  onClick={() => onDelete?.(node)}
  danger
>
  <Trash2 className="h-3.5 w-3.5" />
  Delete
</DropdownItem>
```

Pass `onDelete={setDeleteTarget}` from the parent when rendering `TreeNode`.

- [ ] **Step 5: Add ConfirmDialog**

After the tree rendering, add the dialog:

```typescript
<ConfirmDialog
  open={!!deleteTarget}
  onClose={() => setDeleteTarget(null)}
  onConfirm={() => deleteMutation.mutate()}
  title={`Delete "${deleteTarget?.title}"?`}
  description={
    deleteTarget && countDescendants(deleteTarget) > 0
      ? `This will also delete ${countDescendants(deleteTarget)} child page${countDescendants(deleteTarget) === 1 ? '' : 's'}. This action cannot be undone.`
      : 'This action cannot be undone.'
  }
  confirmLabel="Delete"
  variant="danger"
  loading={deleteMutation.isPending}
/>
```

- [ ] **Step 6: Verify it compiles and test manually**

Run: `cd frontend && npx tsc --noEmit`
Test: Right-click a page in the sidebar, click Delete, verify the dialog appears with correct child count warning.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/wiki/PageViewSidebar.tsx
git commit -m "feat(wiki): add delete option to sidebar context menu with cascade warning"
```

---

### Task 4: Frontend — Install `@dnd-kit` and Add Drag-and-Drop to Sidebar

**Files:**
- Modify: `frontend/package.json` (via npm install)
- Modify: `frontend/src/pages/wiki/PageViewSidebar.tsx`

- [ ] **Step 1: Install @dnd-kit**

```bash
cd frontend && npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Add DnD imports to PageViewSidebar.tsx**

```typescript
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';
```

Also add `useRef` and `useEffect` to the existing React imports if not already present:

```typescript
import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
```

- [ ] **Step 3: Add drop zone types and state**

Add types and state to the sidebar component:

```typescript
type DropZone = 'before' | 'child' | 'after';

interface DropTarget {
  nodeId: string;
  zone: DropZone;
}

const [activeNode, setActiveNode] = useState<PageTreeNode | null>(null);
const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
);
```

- [ ] **Step 4: Add drag/drop handlers**

Zone detection uses a `pointerY` ref tracked via a native `pointermove` listener, since `@dnd-kit`'s `DragOverEvent` does not provide the current pointer position directly.

```typescript
const pointerYRef = useRef(0);

useEffect(() => {
  const handler = (e: PointerEvent) => { pointerYRef.current = e.clientY; };
  window.addEventListener('pointermove', handler);
  return () => window.removeEventListener('pointermove', handler);
}, []);

function handleDragStart(event: DragStartEvent) {
  const node = findNodeById(pageTree, event.active.id as string);
  setActiveNode(node || null);
}

function handleDragOver(event: DragOverEvent) {
  if (!event.over) {
    setDropTarget(null);
    return;
  }

  const overId = event.over.id as string;
  const overRect = event.over.rect;

  // Use tracked pointer position for zone detection
  const relativeY = pointerYRef.current - overRect.top;
  const height = overRect.height;
  let zone: DropZone;
  if (relativeY < height * 0.25) zone = 'before';
  else if (relativeY > height * 0.75) zone = 'after';
  else zone = 'child';

  // Prevent dropping onto self or descendants
  if (activeNode) {
    if (overId === activeNode.id) { setDropTarget(null); return; }
    if (zone === 'child' && isDescendant(activeNode, overId)) { setDropTarget(null); return; }
  }

  setDropTarget({ nodeId: overId, zone });
}

function handleDragEnd(event: DragEndEvent) {
  if (!activeNode || !dropTarget) {
    setActiveNode(null);
    setDropTarget(null);
    return;
  }

  const targetNode = findNodeById(pageTree, dropTarget.nodeId);
  if (!targetNode) { cleanup(); return; }

  let parentId: string | null;
  let position: number;

  if (dropTarget.zone === 'child') {
    parentId = targetNode.id;
    position = 0;
  } else {
    parentId = targetNode.parentId ?? null;
    const siblings = findSiblings(pageTree, targetNode);
    const targetIdx = siblings.findIndex((s) => s.id === targetNode.id);
    position = dropTarget.zone === 'before' ? targetIdx : targetIdx + 1;
    // Adjust if moving within same parent and from earlier position
    if (parentId === (activeNode.parentId ?? null)) {
      const currentIdx = siblings.findIndex((s) => s.id === activeNode.id);
      if (currentIdx !== -1 && currentIdx < position) position--;
    }
  }

  reorderMutation.mutate({ pageId: activeNode.id, parentId, position });
  cleanup();
}

function cleanup() {
  setActiveNode(null);
  setDropTarget(null);
}
```

- [ ] **Step 5: Add tree utility functions**

```typescript
function findNodeById(nodes: PageTreeNode[], id: string): PageTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return undefined;
}

function findSiblings(tree: PageTreeNode[], target: PageTreeNode): PageTreeNode[] {
  if (!target.parentId) return tree;
  const parent = findNodeById(tree, target.parentId);
  return parent?.children ?? tree;
}

function isDescendant(node: PageTreeNode, targetId: string): boolean {
  for (const child of node.children) {
    if (child.id === targetId) return true;
    if (isDescendant(child, targetId)) return true;
  }
  return false;
}
```

- [ ] **Step 6: Add reorder mutation**

```typescript
const reorderMutation = useMutation({
  mutationFn: (data: { pageId: string; parentId: string | null; position: number }) =>
    wikiApi.reorderPage(data.pageId, { parentId: data.parentId, position: data.position }),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['wikiPageTree'] });
  },
});
```

- [ ] **Step 7: Wrap tree in DndContext**

Wrap the page tree list rendering with:

```tsx
<DndContext
  sensors={sensors}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
  onDragCancel={cleanup}
>
  {/* existing tree nodes */}
  <DragOverlay>
    {activeNode && (
      <div className="flex items-center gap-2 rounded-md bg-surface border border-border px-3 py-1.5 shadow-lg text-sm">
        <FileText className="h-3.5 w-3.5 text-text-secondary" />
        {activeNode.title}
      </div>
    )}
  </DragOverlay>
</DndContext>
```

- [ ] **Step 8: Update TreeNode props interface and make it draggable/droppable**

Update the `TreeNode` props interface to add DnD props:

```typescript
// Add to TreeNode props interface:
dropTarget?: DropTarget | null;
```

Inside the `TreeNode` component, add hooks:

```typescript
const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
  id: node.id,
});

const { setNodeRef: setDropRef, isOver } = useDroppable({
  id: node.id,
});

// Combine refs
const nodeRef = (el: HTMLElement | null) => {
  setDragRef(el);
  setDropRef(el);
};
```

Apply to the node's root element:

```tsx
<div
  ref={nodeRef}
  {...attributes}
  className={cn(
    'relative',
    isDragging && 'opacity-30',
  )}
>
```

Add a drag handle (the `GripVertical` icon) that uses `{...listeners}`:

```tsx
<button {...listeners} className="cursor-grab opacity-0 group-hover:opacity-100 p-0.5">
  <GripVertical className="h-3 w-3 text-text-tertiary" />
</button>
```

- [ ] **Step 9: Add visual drop indicators**

Pass `dropTarget` as a prop to `TreeNode`. Render indicators based on zone:

```tsx
{/* Before indicator - blue line above */}
{dropTarget?.nodeId === node.id && dropTarget.zone === 'before' && (
  <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary z-10" />
)}

{/* Child indicator - highlight background */}
{dropTarget?.nodeId === node.id && dropTarget.zone === 'child' && (
  <div className="absolute inset-0 rounded-md bg-primary/10 border border-primary/30 z-0" />
)}

{/* After indicator - blue line below */}
{dropTarget?.nodeId === node.id && dropTarget.zone === 'after' && (
  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary z-10" />
)}
```

- [ ] **Step 10: Verify it compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 11: Manual testing**

Test these scenarios in the browser:
1. Drag a page between two siblings - blue line indicator appears, page reorders on drop
2. Drag a page onto another page - highlight indicator appears, page becomes child on drop
3. Drag a page to root level - drops at top/bottom of tree
4. Try dragging a page onto its own child - should be prevented (no indicator)
5. Delete a page with no children - simple confirmation
6. Delete a page with children - warning shows child count

- [ ] **Step 12: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/pages/wiki/PageViewSidebar.tsx
git commit -m "feat(wiki): add VS Code-style drag-and-drop reordering to sidebar"
```

---

### Task 5: Polish and Edge Cases

**Files:**
- Modify: `frontend/src/pages/wiki/PageViewSidebar.tsx`

- [ ] **Step 1: Handle expanded state on reparent**

When a page is dropped as a child of another node, auto-expand the target parent so the moved page is visible:

```typescript
// In handleDragEnd, after reorderMutation.mutate():
if (dropTarget.zone === 'child') {
  onToggle(targetNode.id); // expand the target if collapsed
}
```

- [ ] **Step 2: Handle drag over collapsed parents**

When hovering over a collapsed parent for the `child` zone, auto-expand it after a short delay (500ms) so the user can drop inside:

```typescript
const expandTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

// In handleDragOver, when zone === 'child' and target has children but is collapsed:
if (zone === 'child' && !expanded.has(overId)) {
  if (!expandTimeoutRef.current) {
    expandTimeoutRef.current = setTimeout(() => {
      onToggle(overId);
      expandTimeoutRef.current = undefined;
    }, 500);
  }
} else {
  clearTimeout(expandTimeoutRef.current);
  expandTimeoutRef.current = undefined;
}

// In cleanup:
clearTimeout(expandTimeoutRef.current);
expandTimeoutRef.current = undefined;
```

- [ ] **Step 3: Verify and commit**

Run: `cd frontend && npx tsc --noEmit`

```bash
git add frontend/src/pages/wiki/PageViewSidebar.tsx
git commit -m "fix(wiki): auto-expand collapsed parents on drag hover and reparent"
```
