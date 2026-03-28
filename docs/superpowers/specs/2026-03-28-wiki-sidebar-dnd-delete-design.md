# Wiki Sidebar: Drag-and-Drop Reordering + Delete

**Date:** 2026-03-28
**Status:** Approved

## Problem

The wiki sidebar context menu only offers "New Child Page" and "New Folder." Users cannot delete pages or reorder/reparent them from the sidebar. Moving pages requires navigating to the page header dropdown and entering a parent ID manually.

## Solution

Two additions to the wiki sidebar:

1. **Delete option** in the context menu with cascade warning
2. **Drag-and-drop** for reordering and reparenting pages (VS Code-style)

---

## 1. Delete in Context Menu

### Behavior

Add a "Delete" `DropdownItem` with `danger` styling to the existing three-dot dropdown in `PageViewSidebar.tsx`. On click, show a `ConfirmDialog`:

- **No children:** "Are you sure you want to delete **{title}**?"
- **Has children:** "Are you sure you want to delete **{title}**? This will also delete **N child pages**."

The dialog uses destructive/red styling. On confirm, call the existing `DELETE /api/wiki/spaces/:spaceId/pages/:pageSlug` endpoint. The backend already cascades deletes via Prisma.

### Child count

The page tree data already includes `children` arrays. Count descendants recursively from the tree node to populate the warning message. No additional API call needed.

### After deletion

- Invalidate `wikiPageTree` and `page` query caches
- If the deleted page was the active page, navigate to the wiki space root

---

## 2. Drag-and-Drop Reordering

### Library

`@dnd-kit/core` + `@dnd-kit/sortable` -- modern, accessible, keyboard-friendly React DnD library.

### Drop Zone Detection

Each tree node has three zones based on vertical cursor position within the node element:

| Zone | Cursor position | Action |
|------|----------------|--------|
| Top 25% | Upper quarter | Insert **before** this node (same parent) |
| Middle 50% | Center half | Make **child of** this node |
| Bottom 25% | Lower quarter | Insert **after** this node (same parent) |

### Visual Indicators (VS Code-style)

- **Between nodes (top/bottom zone):** 2px horizontal line in `--color-primary` spanning the node width at the drop edge. Indented to match the target's tree depth.
- **On node (middle zone):** Target node gets `bg-primary/10` background with `border border-primary/30` rounded highlight.
- **Drag overlay:** Semi-transparent clone of the dragged node title, attached to cursor. Source node gets `opacity-30`.

### Constraints

- Cannot drop a node onto itself
- Cannot drop a node onto any of its own descendants (prevents circular references)
- Root-level drops allowed: dropping at the very top or bottom of the tree sets `parentId` to null

### Backend: New Reorder Endpoint

**`PATCH /api/wiki/pages/:pageId/reorder`**

Request body:
```json
{
  "parentId": "string | null",
  "position": 0
}
```

Behavior:
1. Validate the page exists and user has edit permission
2. Validate no circular reference (target parent is not a descendant of the page)
3. Update the page's `parentId` and `position`
4. Re-index sibling positions: all pages sharing the same new parent get sequential `position` values (0, 1, 2, ...) with the moved page inserted at the specified position
5. If the page moved away from a previous parent, re-index the old parent's children too
6. Invalidate wiki tree cache
7. Broadcast real-time update via WebSocket

Route: added to `wiki.routes.ts`, controller delegates to a new `reorderPage()` service function in `wiki.service.ts`.

### Frontend DnD Implementation

**Components:**

- `DndContext` and `SensorProvider` wrap the page tree in `PageViewSidebar.tsx`
- Each `TreeNode` becomes a draggable + droppable element
- A `TreeDropIndicator` component renders the blue insertion line
- Drop zone detection uses `onDragOver` with pointer position math relative to each node's bounding rect

**On drop:**
1. Determine action from drop zone (before, after, or child-of)
2. Calculate `parentId` and `position` from the target node and its siblings
3. Call `PATCH /api/wiki/pages/:pageId/reorder`
4. Optimistically update the tree (move node in query cache), rollback on error

---

## Files to Modify

| File | Change |
|------|--------|
| `frontend/package.json` | Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `frontend/src/pages/wiki/PageViewSidebar.tsx` | Add delete option, wrap tree in DndContext, make nodes draggable/droppable |
| `frontend/src/api/wiki.api.ts` | Add `reorderPage()` API call |
| `src/modules/wiki/wiki.routes.ts` | Add `PATCH /pages/:pageId/reorder` route |
| `src/modules/wiki/wiki.controller.ts` | Add `reorderPage` controller |
| `src/modules/wiki/wiki.service.ts` | Add `reorderPage()` service function |

## Out of Scope

- Multi-select drag (single node only)
- Cross-space drag (use existing move modal for that)
- Keyboard-only reordering (DnD only; keyboard users use the existing move modal)
- Touch/mobile drag (desktop only for now)
