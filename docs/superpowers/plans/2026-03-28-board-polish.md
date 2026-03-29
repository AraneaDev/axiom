# Board Polish: WIP Limits + Card Colors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WIP limits and card color coding to the board view, making it feel production-ready for kanban and scrum teams.

**Architecture:** Two small additions to the board: a `wipLimit` field on BoardColumn with visual warnings, and a board-level `cardColorBy` setting with CSS-variable-based color coding on issue cards.

**Tech Stack:** Prisma, Express, React, Tailwind CSS 4 with CSS variables

**Spec:** `docs/superpowers/specs/2026-03-28-high-value-features-design.md` (Features 8 & 9)

---

## File Structure

### Backend (modified files)
- `prisma/schema.prisma` — Add `wipLimit` to BoardColumn, add `cardColorBy` to Project
- `src/modules/issues/board-columns.service.ts` — Support wipLimit in create/update
- `src/modules/issues/board-columns.controller.ts` — Accept wipLimit in requests

### Frontend (modified files)
- `frontend/src/pages/issues/Board.tsx` — WIP warning on columns, card color borders
- `frontend/src/pages/issues/ColumnManager.tsx` — WIP limit input in column settings
- `frontend/src/index.css` or theme file — Card color CSS variables

---

## Task 1: Database Fields

**Files:**
- Modify: `prisma/schema.prisma`

### Step 1: Add wipLimit and cardColorBy fields

- [ ] Add to BoardColumn model:

```prisma
wipLimit Int? // null = no limit
```

- [ ] Add to Project model:

```prisma
cardColorBy String? // "priority" | "type" | null (no coloring)
```

### Step 2: Run migration

- [ ] Generate and apply:

```bash
npx prisma migrate dev --name add-wip-limit-and-card-color
```

- [ ] Commit:

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(board): add wipLimit to BoardColumn and cardColorBy to Project"
```

---

## Task 2: WIP Limits Backend

**Files:**
- Modify: `src/modules/issues/board-columns.service.ts`
- Modify: `src/modules/issues/board-columns.controller.ts`

### Step 1: Support wipLimit in column CRUD

- [ ] In `board-columns.service.ts`, ensure `createColumn` and `updateColumn` accept and persist `wipLimit`:

```typescript
// In createColumn:
data: { name, position, isDone, wipLimit }

// In updateColumn:
data: { name?, isDone?, wipLimit? }
```

- [ ] In `board-columns.controller.ts`, accept `wipLimit` from request body in create and update handlers. It should be an optional integer or null.

- [ ] Commit:

```bash
git add src/modules/issues/board-columns.service.ts src/modules/issues/board-columns.controller.ts
git commit -m "feat(board): support wipLimit in column create and update"
```

---

## Task 3: Card Color Backend

**Files:**
- Modify: `src/modules/projects/projects.service.ts` (or wherever project settings are updated)

### Step 1: Support cardColorBy in project update

- [ ] Ensure the project update endpoint accepts `cardColorBy` as a valid field. It should accept `"priority"`, `"type"`, or `null`.

- [ ] Commit:

```bash
git add src/modules/projects/projects.service.ts
git commit -m "feat(board): support cardColorBy in project settings"
```

---

## Task 4: WIP Limits Frontend

**Files:**
- Modify: `frontend/src/pages/issues/ColumnManager.tsx`
- Modify: `frontend/src/pages/issues/Board.tsx`

### Step 1: Add WIP limit input to column settings

- [ ] In `ColumnManager.tsx`, add an inline number input next to each column name for the WIP limit:

```typescript
// Per column row, after the name input:
<input
  type="number"
  min={0}
  placeholder="No limit"
  value={column.wipLimit ?? ''}
  onChange={(e) => handleWipLimitChange(column.id, e.target.value ? parseInt(e.target.value) : null)}
  className="w-20 ..."
/>
```

- [ ] Wire the value into the existing `updateMutation`.

### Step 2: Add WIP warning to board columns

- [ ] In `Board.tsx`, in the `Column` component header, show the issue count vs WIP limit and apply warning styling:

```typescript
// In column header:
const isOverLimit = column.wipLimit && issues.length > column.wipLimit;

// Display: "3 / 5" or just "3" if no limit
<span className={cn('text-sm', isOverLimit && 'text-destructive font-semibold')}>
  {issues.length}{column.wipLimit ? ` / ${column.wipLimit}` : ''}
</span>

// Column header background changes when over limit:
<div className={cn('...', isOverLimit && 'border-destructive bg-destructive/5')}>
```

- [ ] Commit:

```bash
git add frontend/src/pages/issues/ColumnManager.tsx frontend/src/pages/issues/Board.tsx
git commit -m "feat(board): add WIP limit configuration and visual warnings on columns"
```

---

## Task 5: Card Colors Frontend

**Files:**
- Modify: `frontend/src/pages/issues/Board.tsx`
- Modify: `frontend/src/index.css` (or appropriate theme file)

### Step 1: Add CSS variable tokens for card colors

- [ ] Add card color CSS variables to the theme file. These should work in both light and dark modes:

```css
:root {
  /* Card colors - Priority */
  --card-color-critical: var(--color-destructive);
  --card-color-high: oklch(0.65 0.18 25);
  --card-color-medium: oklch(0.75 0.15 85);
  --card-color-low: oklch(0.7 0.12 145);

  /* Card colors - Type */
  --card-color-bug: var(--color-destructive);
  --card-color-story: oklch(0.65 0.15 250);
  --card-color-task: oklch(0.7 0.12 145);
  --card-color-epic: oklch(0.6 0.2 300);
}
```

### Step 2: Add board settings for card color

- [ ] Add a "Color cards by" dropdown to the board header or board settings area:

```typescript
// In Board.tsx or a BoardSettings component:
<Select
  value={project.cardColorBy || 'none'}
  onValueChange={(value) => updateProject({ cardColorBy: value === 'none' ? null : value })}
>
  <SelectItem value="none">No colors</SelectItem>
  <SelectItem value="priority">Priority</SelectItem>
  <SelectItem value="type">Type</SelectItem>
</Select>
```

Use `Palette` icon from Lucide for the dropdown label.

### Step 3: Apply color border to issue cards

- [ ] In the `IssueCard` component in `Board.tsx`, add a left border based on the `cardColorBy` setting:

```typescript
const PRIORITY_CARD_COLORS: Record<string, string> = {
  CRITICAL: 'var(--card-color-critical)',
  HIGH: 'var(--card-color-high)',
  MEDIUM: 'var(--card-color-medium)',
  LOW: 'var(--card-color-low)',
};

const TYPE_CARD_COLORS: Record<string, string> = {
  BUG: 'var(--card-color-bug)',
  STORY: 'var(--card-color-story)',
  TASK: 'var(--card-color-task)',
  EPIC: 'var(--card-color-epic)',
};

// In IssueCard:
const cardColor = cardColorBy === 'priority'
  ? PRIORITY_CARD_COLORS[issue.priority]
  : cardColorBy === 'type'
  ? TYPE_CARD_COLORS[issue.type]
  : undefined;

<div
  className="..."
  style={cardColor ? { borderLeftWidth: '4px', borderLeftColor: cardColor } : undefined}
>
```

### Step 4: Add color legend

- [ ] Below the board header (or in a collapsible section), show a small legend when card coloring is active:

```typescript
// Small flex row of color swatches + labels:
{cardColorBy && (
  <div className="flex gap-3 text-xs text-muted-foreground px-4 pb-2">
    {Object.entries(colorMap).map(([key, color]) => (
      <div key={key} className="flex items-center gap-1">
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: color }} />
        <span>{key.charAt(0) + key.slice(1).toLowerCase()}</span>
      </div>
    ))}
  </div>
)}
```

- [ ] Commit:

```bash
git add frontend/src/pages/issues/Board.tsx frontend/src/index.css
git commit -m "feat(board): add card color coding by priority or type with legend"
```

---

## Task 6: Documentation

**Files:**
- Modify: `docs/api-reference.md`

### Step 1: Update docs

- [ ] Add to `docs/api-reference.md`:

```markdown
### WIP Limits
- `PATCH /api/projects/:projectId/columns/:columnId` with `{ wipLimit: 5 }` — Set WIP limit
- Set to `null` to remove limit. Visual warning when column exceeds limit (advisory, not enforced).

### Card Colors
- `PATCH /api/projects/:projectId` with `{ cardColorBy: "priority" }` — Color cards by priority or type
- Options: `"priority"`, `"type"`, or `null` (no coloring)
- Colors rendered as 4px left border using CSS design tokens
```

- [ ] Commit:

```bash
git add docs/api-reference.md
git commit -m "docs: add WIP limits and card colors documentation"
```
