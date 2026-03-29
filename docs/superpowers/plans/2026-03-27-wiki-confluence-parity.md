# Wiki Confluence Parity (High-Value Features) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Axiom's wiki to practical Confluence parity by implementing the features users actually reach for daily -- version diffing, page permissions, rich editor blocks (as TipTap extensions in the existing MarkdownEditor), slash commands, starred pages, search filters, blueprints, and comment reactions.

**Architecture:** Extends the existing `src/modules/wiki/` module pattern (routes > controller > service). Editor features are TipTap extensions registered in the existing `MarkdownEditor.tsx` and `CollaborativeEditor.tsx` -- no new editor components. New Prisma models for permissions and analytics. All new endpoints follow existing auth/validation patterns. Services use standalone exported async functions (not classes). Frontend API calls added to the `wikiApi` object in `wiki.api.ts`.

**Tech Stack:** Prisma 7, Express 5, TipTap 3, React 19, TanStack Query, Zustand, Zod, Yjs

**Codebase conventions (from reviewer):**
- Services are standalone `async function` exports, not classes
- Frontend `get()` takes a path string only -- build query params into the URL
- All new Prisma models need `@@map("snake_case_table_name")`
- All new Prisma models need reverse relations on `User` and parent models
- Routes use `requireWikiPageAccess()` / `requireWikiSpaceAccess()` middleware (auth is applied globally)
- Schema changes need `npx prisma migrate dev` (not just `generate`)
- New API methods go on the `wikiApi` object, not as standalone exports
- Use `diff` npm package for version comparison

---

## File Map

### Backend (new files)
- `src/modules/wiki/wiki-permissions.service.ts` -- space/page permission checks
- `src/modules/wiki/wiki-permissions.controller.ts` -- permission endpoints
- `src/modules/wiki/wiki-analytics.service.ts` -- page view tracking
- `src/modules/wiki/wiki-analytics.controller.ts` -- analytics endpoints
- `src/modules/wiki/wiki-stars.service.ts` -- starred pages
- `src/modules/wiki/wiki-stars.controller.ts` -- star/unstar endpoints

### Backend (modify)
- `prisma/schema.prisma` -- new models: PageRestriction, PageView, StarredPage; new fields on PageVersion
- `src/modules/wiki/wiki.routes.ts` -- new route registrations
- `src/modules/wiki/wiki.service.ts` -- permission checks on read/write, version restore, change descriptions
- `src/modules/wiki/wiki-comments.service.ts` -- add reactions
- `src/modules/search/search.service.ts` -- space-scoped search filter

### Frontend (new files)
- `frontend/src/components/editor/SlashCommandExtension.ts` -- slash menu extension
- `frontend/src/components/editor/SlashCommandMenu.tsx` -- slash menu dropdown UI
- `frontend/src/components/editor/CalloutExtension.ts` -- info/warning/note/success panels
- `frontend/src/components/editor/CalloutBlock.tsx` -- callout React NodeView
- `frontend/src/components/editor/CollapsibleExtension.ts` -- expand/collapse sections
- `frontend/src/components/editor/CollapsibleBlock.tsx` -- collapsible React NodeView
- `frontend/src/components/editor/TableOfContentsExtension.ts` -- auto-generated TOC
- `frontend/src/pages/wiki/PageDiff.tsx` -- version comparison view
- `frontend/src/components/wiki/PageRestrictions.tsx` -- permission UI
- `frontend/src/components/wiki/StarButton.tsx` -- star/unstar toggle

### Frontend (modify)
- `frontend/src/components/editor/MarkdownEditor.tsx` -- register new extensions + toolbar buttons
- `frontend/src/components/editor/CollaborativeEditor.tsx` -- register new extensions
- `frontend/src/components/editor/MarkdownRenderer.tsx` -- render new blocks in read-only view
- `frontend/src/pages/wiki/PageHistory.tsx` -- add diff/restore buttons
- `frontend/src/pages/wiki/PageEdit.tsx` -- change description input on save
- `frontend/src/pages/wiki/PageView.tsx` -- view tracking, star button, analytics
- `frontend/src/pages/wiki/WikiLayout.tsx` -- starred pages section in sidebar
- `frontend/src/pages/wiki/WikiHome.tsx` -- space search/filter
- `frontend/src/components/wiki/PageComments.tsx` -- reactions UI
- `frontend/src/api/wiki.api.ts` -- new API calls

---

## Task 1: Version Comparison & Restore

The most requested wiki feature -- see what changed between versions and roll back mistakes.

**Files:**
- Modify: `prisma/schema.prisma` (PageVersion model -- add changeDescription field)
- Modify: `src/modules/wiki/wiki.service.ts` (add diffVersions, restoreVersion, changeDescription on save)
- Modify: `src/modules/wiki/wiki.routes.ts` (new diff/restore endpoints)
- Create: `frontend/src/pages/wiki/PageDiff.tsx`
- Modify: `frontend/src/pages/wiki/PageHistory.tsx` (add compare/restore buttons)
- Modify: `frontend/src/pages/wiki/PageEdit.tsx` (change description input)
- Modify: `frontend/src/api/wiki.api.ts` (new API calls)

### Steps

- [ ] **Step 1: Add changeDescription to PageVersion schema**

```prisma
// In PageVersion model, add:
changeDescription String?
```

Run: `cd /root/axiom && npx prisma migrate dev --name add-change-description && npx prisma generate`

- [ ] **Step 2: Write test for version diff endpoint**

```typescript
// src/modules/wiki/wiki.test.ts
describe('GET /api/wiki/spaces/:spaceId/pages/:pageSlug/diff', () => {
  it('returns diff between two versions', async () => {
    // Create a page, update it twice to get 3 versions
    // GET /diff?from=1&to=3
    // Expect { from: { version, title, body }, to: { version, title, body }, changes: [...] }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /root/axiom && npm test -- --grep "diff between two versions"`
Expected: FAIL

- [ ] **Step 4: Implement diff endpoint in service**

Add `diffVersions(spaceId, pageSlug, fromVersion, toVersion)` to `wiki.service.ts`:
- Fetch both PageVersion records
- Use the `diff` npm package (`npm install diff` in project root) for structured diff output
- Return both versions' title/body plus diff changes for frontend rendering

- [ ] **Step 5: Add route and controller for diff**

```typescript
// wiki.routes.ts -- auth is applied globally, use requireWikiSpaceAccess() for RBAC
router.get('/spaces/:spaceId/pages/:pageSlug/diff', requireWikiSpaceAccess(), wikiController.diffVersions);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /root/axiom && npm test -- --grep "diff between two versions"`
Expected: PASS

- [ ] **Step 7: Write test for version restore**

```typescript
describe('POST /api/wiki/spaces/:spaceId/pages/:pageSlug/restore', () => {
  it('restores page to a previous version', async () => {
    // Create page, update it, restore to version 1
    // Expect page body matches version 1, new version created
  });
});
```

- [ ] **Step 8: Implement restore in service**

Add `restoreVersion(spaceId, pageSlug, targetVersion, userId)` to `wiki.service.ts`:
- Fetch the target PageVersion
- Update the Page with that version's title/body
- Create a new PageVersion with changeDescription "Restored to version N"
- Broadcast real-time update

- [ ] **Step 9: Add route for restore**

```typescript
router.post('/spaces/:spaceId/pages/:pageSlug/restore', requireWikiSpaceAccess(), wikiController.restoreVersion);
```

- [ ] **Step 10: Run tests, verify pass**

Run: `cd /root/axiom && npm test -- --grep "restore"`
Expected: PASS

- [ ] **Step 11: Update page update to accept changeDescription**

Modify `updatePage()` in `wiki.service.ts` to accept and store `changeDescription` on the new PageVersion record.

- [ ] **Step 12: Build PageDiff.tsx frontend**

Create `frontend/src/pages/wiki/PageDiff.tsx`:
- Route: `/:org/:team/wiki/:space/:page/diff?from=N&to=M`
- Fetch both versions via API
- Render side-by-side with added/removed line highlighting
- Use green background for additions, red for removals
- Show metadata: version number, author, date, changeDescription

- [ ] **Step 13: Update PageHistory.tsx**

- Add "Compare" checkboxes on each version row
- "Compare selected" button that navigates to PageDiff
- "Restore" button per version (with confirmation dialog)
- Show changeDescription in version list

- [ ] **Step 14: Update PageEdit.tsx**

- Add optional "Change description" text input above the save button
- Pass changeDescription to the update API call

- [ ] **Step 15: Add API calls to wikiApi object in wiki.api.ts**

```typescript
// Add to the wikiApi object (not as standalone exports):
diffVersions: (spaceId: string, pageSlug: string, from: number, to: number) =>
  get<DiffResult>(`/wiki/spaces/${spaceId}/pages/${pageSlug}/diff?from=${from}&to=${to}`),

restoreVersion: (spaceId: string, pageSlug: string, version: number) =>
  post(`/wiki/spaces/${spaceId}/pages/${pageSlug}/restore`, { version }),
```

- [ ] **Step 16: Run full test suite, verify nothing broken**

Run: `cd /root/axiom && npm run check`

- [ ] **Step 17: Commit**

```bash
git add -A && git commit -m "feat(wiki): add version comparison, restore, and change descriptions"
```

---

## Task 2: Page Restrictions & Space Permissions

Access control is non-negotiable for any serious wiki. Users need to restrict sensitive pages.

**Files:**
- Modify: `prisma/schema.prisma` (new PageRestriction model, add isArchived to WikiSpace)
- Create: `src/modules/wiki/wiki-permissions.service.ts`
- Create: `src/modules/wiki/wiki-permissions.controller.ts`
- Modify: `src/modules/wiki/wiki.routes.ts`
- Modify: `src/modules/wiki/wiki.service.ts` (enforce restrictions on read/write)
- Create: `frontend/src/components/wiki/PageRestrictions.tsx`
- Modify: `frontend/src/pages/wiki/PageView.tsx` (restriction indicator + edit UI)

### Steps

- [ ] **Step 1: Add PageRestriction model and space fields to schema**

```prisma
model PageRestriction {
  id          String   @id @default(cuid())
  pageId      String
  page        Page     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  type        RestrictionType  // VIEW or EDIT
  userId      String?
  user        User?    @relation("UserPageRestrictions", fields: [userId], references: [id])
  teamRoleMin TeamRole? // minimum role required (e.g., ADMIN)
  createdAt   DateTime @default(now())

  @@unique([pageId, type, userId])
  @@index([pageId])
  @@map("page_restrictions")
}

enum RestrictionType {
  VIEW
  EDIT
}

// Add to WikiSpace model:
isArchived  Boolean  @default(false)

// Add reverse relations:
// On Page model: restrictions PageRestriction[]
// On User model: pageRestrictions PageRestriction[] @relation("UserPageRestrictions")
```

Run: `cd /root/axiom && npx prisma migrate dev --name add-page-restrictions && npx prisma generate`

- [ ] **Step 2: Write tests for permission service**

```typescript
describe('wiki-permissions', () => {
  it('allows unrestricted page access to all team members', ...);
  it('blocks view-restricted page from non-listed users', ...);
  it('blocks edit-restricted page from non-listed users', ...);
  it('allows restricted page access to listed users', ...);
  it('allows org owners to bypass restrictions', ...);
});
```

- [ ] **Step 3: Run tests, verify fail**

- [ ] **Step 4: Implement wiki-permissions.service.ts**

Standalone exported async functions (matching codebase convention):
```typescript
// wiki-permissions.service.ts
export async function canViewPage(userId: string, pageId: string): Promise<boolean>
export async function canEditPage(userId: string, pageId: string): Promise<boolean>
export async function setRestrictions(pageId: string, type: RestrictionType, userIds: string[]): Promise<void>
export async function getRestrictions(pageId: string): Promise<PageRestriction[]>
export async function removeRestriction(restrictionId: string): Promise<void>
```

Logic:
- If no restrictions exist for a type, everyone with team access can view/edit
- If VIEW restrictions exist, only listed users (+ org owners/admins) can view
- If EDIT restrictions exist, only listed users (+ org owners/admins) can edit
- VIEW restriction implies EDIT restriction

- [ ] **Step 5: Add permission controller and routes**

```typescript
// Routes -- auth is global, use requireWikiPageAccess() for RBAC
router.get('/pages/:pageId/restrictions', requireWikiPageAccess(), permController.getRestrictions);
router.put('/pages/:pageId/restrictions', requireWikiPageAccess(), permController.setRestrictions);
router.delete('/restrictions/:restrictionId', requireWikiPageAccess(), permController.removeRestriction);
```

- [ ] **Step 6: Enforce permissions in wiki.service.ts**

Add permission checks to:
- `getPageBySlug()` -- check canViewPage
- `updatePage()` -- check canEditPage
- `deletePage()` -- check canEditPage
- Return 403 with clear error message when denied

- [ ] **Step 7: Run tests, verify pass**

- [ ] **Step 8: Build PageRestrictions.tsx component**

- Lock icon indicator when page has restrictions
- Dialog to manage restrictions: add/remove users, set type (view/edit)
- User picker with search (reuse existing user search pattern)
- Show current restrictions list with remove buttons

- [ ] **Step 9: Integrate into PageViewHeader.tsx**

- Add lock icon + "Restricted" badge when restrictions exist
- Click to open PageRestrictions dialog (if user has edit access)

- [ ] **Step 10: Add space archive support**

- Filter archived spaces from default listing
- Add archive/unarchive toggle in space settings
- Show archived spaces with visual indicator when "show archived" is toggled

- [ ] **Step 11: Run full test suite**

Run: `cd /root/axiom && npm run check`

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat(wiki): add page restrictions and space archiving"
```

---

## Task 3: Rich Editor Blocks (Callouts, Task Lists, Collapsible, TOC)

These are the content blocks that make a wiki actually useful for documentation. All are TipTap extensions.

**Files:**
- Create: `frontend/src/components/editor/CalloutExtension.ts`
- Create: `frontend/src/components/editor/CalloutBlock.tsx` (React renderer)
- Create: `frontend/src/components/editor/TaskListExtension.ts`
- Create: `frontend/src/components/editor/CollapsibleExtension.ts`
- Create: `frontend/src/components/editor/CollapsibleBlock.tsx` (React renderer)
- Create: `frontend/src/components/editor/TableOfContentsExtension.ts`
- Modify: `frontend/src/components/editor/MarkdownEditor.tsx` (register extensions)
- Modify: `frontend/src/components/editor/CollaborativeEditor.tsx` (register extensions)
- Modify: `frontend/src/components/editor/MarkdownRenderer.tsx` (render blocks in read-only)

### Steps

- [ ] **Step 1: Create CalloutExtension**

TipTap Node extension for info/warning/note/success panels:
- Node name: `callout`
- Attributes: `type` (info | warning | note | success | error)
- Renders as a `<div>` with colored left border + Lucide icon
- Colors via CSS variables: `--color-info`, `--color-warning`, `--color-error`, `--color-success`
- Icons: `Info`, `AlertTriangle`, `StickyNote`, `CheckCircle`, `XCircle` from lucide-react
- Content: editable block content inside

- [ ] **Step 2: Create CalloutBlock.tsx React NodeView**

```tsx
// NodeViewWrapper with:
// - Colored left border (4px) based on type
// - Icon on the left
// - Type selector dropdown (click icon to change type)
// - Editable content area (NodeViewContent)
```

- [ ] **Step 3: Create TaskListExtension**

Use TipTap's built-in `@tiptap/extension-task-list` and `@tiptap/extension-task-item`:
- Install first (not currently in package.json): `cd /root/axiom/frontend && npm install @tiptap/extension-task-list @tiptap/extension-task-item`
- Configure: `taskItem` with `nested: true` for sub-tasks

- [ ] **Step 4: Create CollapsibleExtension**

TipTap Node extension for expand/collapse:
- Node name: `collapsible`
- Attributes: `title` (string), `open` (boolean, default true)
- Renders as `<details>/<summary>` pattern
- Title is editable inline
- Content is editable block content

- [ ] **Step 5: Create CollapsibleBlock.tsx React NodeView**

```tsx
// NodeViewWrapper with:
// - ChevronRight/ChevronDown icon (rotates on toggle)
// - Editable summary text
// - Collapsible content area (NodeViewContent)
// - Click summary to toggle open/closed
```

- [ ] **Step 6: Create TableOfContentsExtension**

TipTap Node extension for auto-generated TOC:
- Node name: `tableOfContents`
- No attributes needed
- On render: scan document for heading nodes, build linked list
- Update on document change (debounced)
- Render as a styled list with clickable heading links (scroll to heading)
- Non-editable block (read-only NodeView)

- [ ] **Step 7: Register all extensions in MarkdownEditor.tsx**

Add imports and register in the `extensions` array:
```typescript
import { CalloutExtension } from './CalloutExtension';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { CollapsibleExtension } from './CollapsibleExtension';
import { TableOfContentsExtension } from './TableOfContentsExtension';
```

- [ ] **Step 8: Register all extensions in CollaborativeEditor.tsx**

Same registration as MarkdownEditor.

- [ ] **Step 9: Add toolbar buttons for new blocks**

In both editors, add toolbar buttons:
- Callout: `MessageSquareWarning` icon with dropdown for type selection
- Task list: `ListChecks` icon
- Collapsible: `ChevronDown` icon
- TOC: `List` icon (inserts TOC block)

- [ ] **Step 10: Update MarkdownRenderer.tsx for read-only display**

Ensure callouts, task lists, collapsibles, and TOC render correctly in read-only page views. Map HTML output from TipTap to styled components.

- [ ] **Step 11: Test all blocks in browser**

Run: `cd /root/axiom && npm run docker:dev`
- Create a wiki page with each block type
- Verify rendering in edit and view modes
- Verify collaborative editing works with new blocks
- Verify blocks survive save/load round-trip

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat(wiki/editor): add callout panels, task lists, collapsible sections, and table of contents"
```

---

## Task 4: Slash Commands

The modern editor UX -- type `/` to insert any block type. This ties together all editor features.

**Files:**
- Create: `frontend/src/components/editor/SlashCommandExtension.ts`
- Create: `frontend/src/components/editor/SlashCommandMenu.tsx`
- Modify: `frontend/src/components/editor/MarkdownEditor.tsx` (register)
- Modify: `frontend/src/components/editor/CollaborativeEditor.tsx` (register)

### Steps

- [ ] **Step 1: Create SlashCommandExtension.ts**

TipTap suggestion extension triggered by `/`:
- Uses `@tiptap/suggestion` (already used by MentionExtension pattern)
- On `/` keystroke at start of line or after space, show command menu
- Filter commands by typed text after `/`
- On select, insert the corresponding node

- [ ] **Step 2: Define command registry**

```typescript
const commands = [
  { name: 'Heading 1', icon: Heading1, action: (editor) => editor.chain().focus().setHeading({ level: 1 }).run() },
  { name: 'Heading 2', icon: Heading2, action: ... },
  { name: 'Heading 3', icon: Heading3, action: ... },
  { name: 'Bullet List', icon: List, action: ... },
  { name: 'Numbered List', icon: ListOrdered, action: ... },
  { name: 'Task List', icon: ListChecks, action: ... },
  { name: 'Callout', icon: MessageSquareWarning, action: ... },
  { name: 'Code Block', icon: Code, action: ... },
  { name: 'Collapsible', icon: ChevronDown, action: ... },
  { name: 'Table', icon: Table, action: ... },
  { name: 'Table of Contents', icon: List, action: ... },
  { name: 'Blockquote', icon: Quote, action: ... },
  { name: 'Divider', icon: Minus, action: ... },
  { name: 'Image', icon: Image, action: ... },
  { name: 'Mermaid Diagram', icon: GitBranch, action: ... },
];
```

- [ ] **Step 3: Create SlashCommandMenu.tsx**

Floating dropdown menu (same positioning pattern as MentionList.tsx):
- Keyboard navigation (up/down arrows, enter to select)
- Filter items by typed query
- Show icon + name for each command
- Group by category (Text, Lists, Blocks, Media)
- Close on Escape or click outside

- [ ] **Step 4: Register in both editors**

- [ ] **Step 5: Test in browser**

Run dev stack, verify:
- Type `/` shows menu
- Typing filters commands
- Arrow keys navigate
- Enter/click inserts block
- Works in both editors
- Works in collaborative mode

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(wiki/editor): add slash command menu for block insertion"
```

---

## Task 5: Starred Pages & Page Analytics

Quick-access favorites and basic view tracking. Small effort, high daily value.

**Files:**
- Modify: `prisma/schema.prisma` (StarredPage, PageView models)
- Create: `src/modules/wiki/wiki-stars.service.ts`
- Create: `src/modules/wiki/wiki-stars.controller.ts`
- Create: `src/modules/wiki/wiki-analytics.service.ts`
- Create: `src/modules/wiki/wiki-analytics.controller.ts`
- Modify: `src/modules/wiki/wiki.routes.ts`
- Create: `frontend/src/components/wiki/StarButton.tsx`
- Modify: `frontend/src/pages/wiki/PageView.tsx` (star button, view tracking)
- Modify: `frontend/src/pages/wiki/WikiLayout.tsx` (starred pages in sidebar)
- Modify: `frontend/src/pages/wiki/PageViewHeader.tsx` (view count display)
- Modify: `frontend/src/api/wiki.api.ts`

### Steps

- [ ] **Step 1: Add StarredPage and PageView models**

```prisma
model StarredPage {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation("UserStarredPages", fields: [userId], references: [id], onDelete: Cascade)
  pageId    String
  page      Page     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([userId, pageId])
  @@index([userId])
  @@map("starred_pages")
}

model PageView {
  id        String   @id @default(cuid())
  pageId    String
  page      Page     @relation(fields: [pageId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation("UserPageViews", fields: [userId], references: [id])
  viewedAt  DateTime @default(now())

  @@index([pageId])
  @@index([userId])
  @@index([pageId, viewedAt])
  @@map("page_views")
}

// Add reverse relations:
// On Page model: starredBy StarredPage[], views PageView[]
// On User model: starredPages StarredPage[] @relation("UserStarredPages"), pageViews PageView[] @relation("UserPageViews")
```

Run: `cd /root/axiom && npx prisma migrate dev --name add-starred-pages-and-views && npx prisma generate`

- [ ] **Step 2: Write tests for star/unstar**

```typescript
describe('starred pages', () => {
  it('stars a page for the current user', ...);
  it('unstars a page', ...);
  it('lists starred pages for current user', ...);
  it('returns star status on page fetch', ...);
});
```

- [ ] **Step 3: Run tests, verify fail**

- [ ] **Step 4: Implement wiki-stars.service.ts**

Standalone exported async functions (matching codebase convention):
```typescript
// wiki-stars.service.ts
export async function toggleStar(userId: string, pageId: string): Promise<{ starred: boolean }>
export async function isStarred(userId: string, pageId: string): Promise<boolean>
export async function getStarredPages(userId: string): Promise<Page[]>
```

- [ ] **Step 5: Implement wiki-analytics.service.ts**

Standalone exported async functions:
```typescript
// wiki-analytics.service.ts
export async function recordView(pageId: string, userId: string): Promise<void>  // debounced, max 1 per user per page per hour
export async function getViewCount(pageId: string): Promise<number>
export async function getRecentViewers(pageId: string, limit?: number): Promise<{ user: User; viewedAt: Date }[]>
```

- [ ] **Step 6: Add routes and controllers**

```typescript
// Auth is global, use requireWikiPageAccess() for RBAC
router.post('/pages/:pageId/star', requireWikiPageAccess(), starsController.toggleStar);
router.get('/starred', starsController.getStarredPages);
router.get('/pages/:pageId/analytics', requireWikiPageAccess(), analyticsController.getAnalytics);
```

- [ ] **Step 7: Record views on page fetch**

In `wiki.service.ts` `getPageBySlug()`, call `analyticsService.recordView()` after successful fetch.

- [ ] **Step 8: Run tests, verify pass**

- [ ] **Step 9: Build StarButton.tsx**

```tsx
// Star icon (lucide Star) that toggles filled/outline
// Uses useMutation to toggle, invalidates page query
// Shows in PageViewHeader
```

- [ ] **Step 10: Add starred pages to WikiLayout sidebar**

- Fetch user's starred pages via `getStarredPages()`
- Show as a "Starred" section above the page tree
- Each entry links to the page
- Star icon next to each for quick unstar

- [ ] **Step 11: Add view count to PageViewHeader**

- Show `Eye` icon + view count
- Tooltip with "N unique viewers"

- [ ] **Step 12: Run full test suite**

Run: `cd /root/axiom && npm run check`

- [ ] **Step 13: Commit**

```bash
git add -A && git commit -m "feat(wiki): add starred pages and page view analytics"
```

---

## Task 6: Enhanced Search (Space Scoping & Filters)

Make wiki search actually useful -- filter by space, find content by label.

**Files:**
- Modify: `src/modules/search/search.service.ts` (add space filter, label filter, date filter)
- Modify: `src/modules/search/search.controller.ts` (accept new params)
- Modify: `src/modules/search/search.routes.ts` (if needed)
- Modify: `frontend/src/pages/search/SearchResults.tsx` (filter UI)
- Modify: `frontend/src/api/search.api.ts`
- Modify: `frontend/src/pages/wiki/WikiLayout.tsx` (in-space search)

### Steps

- [ ] **Step 1: Write test for space-scoped search**

```typescript
describe('wiki search filters', () => {
  it('filters wiki results by spaceId', ...);
  it('filters wiki results by label', ...);
  it('filters wiki results by date range', ...);
});
```

- [ ] **Step 2: Run tests, verify fail**

- [ ] **Step 3: Add filter parameters to search service**

In `search.service.ts`, modify the wiki search query to accept optional filters:
- `spaceId` -- filter to a single space
- `label` -- filter pages with a specific label
- `since` / `until` -- date range on page updatedAt

Add these as WHERE clauses in the Prisma query.

- [ ] **Step 4: Update controller to parse filter params**

Accept query params: `?space=spaceId&label=architecture&since=2026-01-01`

- [ ] **Step 5: Run tests, verify pass**

- [ ] **Step 6: Add search bar to WikiLayout sidebar**

- Search input at top of sidebar
- Automatically scopes to current space
- Shows results in a dropdown or navigates to search page with space filter pre-applied

- [ ] **Step 7: Add filter chips to SearchResults.tsx**

- When results include wiki pages, show filter options:
  - Space dropdown (list all spaces)
  - Label autocomplete
  - Date range picker
- Filters update the search query and re-fetch

- [ ] **Step 8: Add "Content by label" to wiki**

On the space labels page (`/wiki/spaces/:spaceId/labels`), clicking a label shows all pages with that label. This already exists via `searchByLabel` -- ensure the UI is accessible from the page view (label chips are clickable links).

- [ ] **Step 9: Run full test suite**

Run: `cd /root/axiom && npm run check`

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat(wiki/search): add space-scoped search and label/date filters"
```

---

## Task 7: Built-in Page Blueprints

Pre-built templates that teams actually use. These are just PageTemplate records with good content.

**Files:**
- Modify: `src/modules/wiki/wiki-templates.service.ts` (seed built-in templates)
- Create: `src/modules/wiki/blueprints/` (template content files)
- Modify: `frontend/src/pages/wiki/PageEdit.tsx` (template picker improvements)

### Steps

- [ ] **Step 1: Create blueprint content files**

Create `src/modules/wiki/blueprints/` with these templates as markdown strings:

**meeting-notes.ts:**
```markdown
## Date
[Date]

## Attendees
- [ ] @

## Agenda
1.

## Discussion Notes

## Action Items
- [ ] [Owner] - [Task] - [Due Date]

## Decisions Made
```

**retrospective.ts:**
```markdown
## Sprint [N] Retrospective

### What went well

### What could be improved

### Action items
- [ ] [Owner] - [Action] - [Due Date]
```

**decision.ts:**
```markdown
## Decision: [Title]

**Status:** PROPOSED | ACCEPTED | REJECTED
**Date:** [Date]
**Decider:** [Name]

### Context
[What is the issue that we're seeing that is motivating this decision?]

### Options Considered
| Option | Pros | Cons |
|--------|------|------|
| A | | |
| B | | |

### Decision
[What is the change that we're proposing and/or doing?]

### Consequences
[What becomes easier or more difficult because of this change?]
```

**product-requirements.ts:**
```markdown
## Overview
[Brief description of the feature]

### Goals
-

### Non-Goals
-

### User Stories
- As a [role], I want [capability] so that [benefit]

### Technical Requirements
-

### Open Questions
-

### Timeline
| Milestone | Date | Status |
|-----------|------|--------|
```

**runbook.ts:**
```markdown
## [Service/System Name] Runbook

### Overview
[What this service does]

### Architecture
[Key components and dependencies]

### Common Issues

#### Issue: [Name]
**Symptoms:**
**Diagnosis:**
**Resolution:**

### Monitoring & Alerts
| Alert | Meaning | Action |
|-------|---------|--------|

### Contacts
| Role | Person | Contact |
|------|--------|---------|
```

- [ ] **Step 2: Add isBuiltIn field to PageTemplate schema**

```prisma
// In PageTemplate model:
isBuiltIn Boolean @default(false)
```

Run: `cd /root/axiom && npx prisma migrate dev --name add-builtin-templates && npx prisma generate`

- [ ] **Step 3: Create seed function for built-in blueprints**

Add `seedBuiltInTemplates(spaceId)` to `wiki-templates.service.ts`:
- Called when creating a new space (opt-in flag)
- Creates PageTemplate records for each blueprint
- Marks them as `isBuiltIn: true` so they can't be deleted

- [ ] **Step 4: Improve template picker in PageEdit.tsx**

When creating a new page:
- Show template picker prominently (not hidden in a menu)
- Group templates: "Built-in" section + "Custom" section
- Preview template content on hover/select
- "Blank page" as the first option

- [ ] **Step 5: Test blueprints**

Run dev stack, create a new space, verify:
- Built-in templates appear in template picker
- Each template creates a properly formatted page
- Templates can't be deleted (isBuiltIn protection)

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(wiki): add built-in page blueprints (meeting notes, retro, decision, PRD, runbook)"
```

---

## Task 8: Comment Reactions

Quick feedback on comments without cluttering threads. Small feature, high engagement.

**Files:**
- Modify: `prisma/schema.prisma` (CommentReaction model)
- Modify: `src/modules/wiki/wiki-comments.service.ts` (add/remove reactions)
- Modify: `src/modules/wiki/wiki-comments.controller.ts` (reaction endpoint)
- Modify: `src/modules/wiki/wiki.routes.ts`
- Modify: `frontend/src/components/wiki/PageComments.tsx` (reaction UI)
- Modify: `frontend/src/api/wiki.api.ts`

### Steps

- [ ] **Step 1: Add CommentReaction model**

```prisma
model CommentReaction {
  id           String      @id @default(cuid())
  commentId    String
  comment      PageComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  userId       String
  user         User        @relation("UserCommentReactions", fields: [userId], references: [id])
  reactionType String      // "thumbsup", "heart", "eyes", "rocket", "thinking", "check"
  createdAt    DateTime    @default(now())

  @@unique([commentId, userId, reactionType])
  @@index([commentId])
  @@map("comment_reactions")
}

// Add reverse relations:
// On PageComment model: reactions CommentReaction[]
// On User model: commentReactions CommentReaction[] @relation("UserCommentReactions")
```

Run: `cd /root/axiom && npx prisma migrate dev --name add-comment-reactions && npx prisma generate`

Use a fixed reaction set (like GitHub). Map to Lucide icons (no emoji characters -- design rules):
- `thumbsup` -> `ThumbsUp`
- `heart` -> `Heart`
- `eyes` -> `Eye`
- `rocket` -> `Rocket`
- `check` -> `Check`
- `thinking` -> `HelpCircle`

- [ ] **Step 2: Write tests for reactions**

```typescript
describe('comment reactions', () => {
  it('adds a reaction to a comment', ...);
  it('removes reaction when toggled again', ...);
  it('returns reaction counts with comment', ...);
  it('indicates which reactions current user has given', ...);
});
```

- [ ] **Step 3: Run tests, verify fail**

- [ ] **Step 4: Implement reaction toggle in service**

Add to `wiki-comments.service.ts` (standalone function, matching codebase convention):
```typescript
export async function toggleReaction(commentId: string, userId: string, reactionType: string): Promise<{ added: boolean }>
```
- If reaction exists, delete it (toggle off)
- If not, create it (toggle on)
- Include reaction data when fetching comments (group by reactionType, count, list user IDs)

- [ ] **Step 5: Add route**

```typescript
router.post('/comments/:commentId/reactions', commentsController.toggleReaction);
```

- [ ] **Step 6: Run tests, verify pass**

- [ ] **Step 7: Add reaction UI to PageComments.tsx**

Below each comment:
- Row of reaction pills: `[ThumbsUp 3] [Heart 1] [+]`
- Each pill shows icon + count, highlighted if current user reacted
- Click to toggle your reaction
- `+` button opens reaction picker (small popover with the 6 options)

- [ ] **Step 8: Run full test suite**

Run: `cd /root/axiom && npm run check`

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat(wiki): add reactions on page comments"
```

---

## Execution Order & Dependencies

```
Task 1 (Version Diff/Restore)     -- no dependencies, start here
Task 2 (Page Restrictions)        -- no dependencies, can parallel with Task 1
Task 3 (Editor Blocks)            -- no dependencies, can parallel
Task 4 (Slash Commands)           -- depends on Task 3 (references new block types)
Task 5 (Stars & Analytics)        -- no dependencies, can parallel with 1-3
Task 6 (Enhanced Search)          -- no dependencies, can parallel
Task 7 (Blueprints)               -- no dependencies, can parallel
Task 8 (Reactions)                -- no dependencies, can parallel
```

**Parallel groups:**
- **Wave 1:** Tasks 1, 2, 3, 5, 6, 7, 8 (all independent)
- **Wave 2:** Task 4 (after Task 3 completes)

**Estimated effort:** 8 tasks, each 30-60 minutes for an experienced developer.
