# Cross-Product Integration & MCP Workflow Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bidirectional wiki-issue linking and 7 workflow-driven MCP tools so both humans and AI agents get full cross-product integration.

**Architecture:** New `WikiPageIssueLink` junction table with auto-sync on page save. New `IssueEmbedExtension` TipTap node for rich issue cards in wiki. 7 new MCP tools in `integration-tools.ts` and `repo-tools.ts` shaped by investigate/triage, code review, and doc sync workflows.

**Tech Stack:** Prisma 7, Express 5, TipTap, MCP SDK, `git grep`

**Spec:** `docs/superpowers/specs/2026-03-29-cross-product-mcp-design.md`

**Pre-flight:** Rebuild and start all Docker containers before beginning: `npm run docker:dev:down && docker compose -f docker-compose.dev.yml build --no-cache && npm run docker:dev`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/modules/wiki/wiki-issue-links.service.ts` | CRUD + sync logic for WikiPageIssueLink |
| `src/modules/wiki/wiki-issue-links.controller.ts` | HTTP handlers for link routes |
| `src/modules/wiki/wiki-issue-links.test.ts` | Integration tests for link service |
| `src/git/git-search-commands.ts` | `git grep` wrapper for code search |
| `src/mcp/tools/integration-tools.ts` | MCP tools: get_development_summary, list_wiki_issue_links, link_wiki_to_issue |
| `frontend/src/components/editor/IssueEmbedExtension.ts` | TipTap node extension for issue embed blocks |
| `frontend/src/components/editor/IssueEmbedNode.tsx` | React component rendered inside the embed node |
| `frontend/src/api/wiki-issue-links.api.ts` | Frontend API helpers for link endpoints |

### Modified Files
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add WikiPageIssueLink model, WikiIssueLinkType enum, reverse relations on Page/Issue/User |
| `src/modules/wiki/wiki.service.ts` | Call `syncMentionLinks()` in createPage/updatePage |
| `src/modules/wiki/wiki.routes.ts` | Mount wiki-issue-link routes |
| `src/modules/issues/development-panel.service.ts` | Add wikiPages to DevelopmentSummary |
| `src/mcp/tools/types.ts` | Add `getOrgIdFromPage` helper |
| `src/mcp/server.ts` | Register integration tools, add getOrgIdFromPage to context |
| `src/mcp/mcp-permissions.ts` | Add permission mappings for 7 new tools |
| `src/mcp/tools/repo-tools.ts` | Add search_code, get_pr_diff, get_pr_comments, get_recent_merges tools |
| `frontend/src/components/editor/MarkdownEditor.tsx` | Register IssueEmbedExtension |
| `frontend/src/components/editor/CollaborativeEditor.tsx` | Register IssueEmbedExtension |
| `frontend/src/components/editor/SlashCommandExtension.ts` | Add `/issue` command |
| `frontend/src/pages/issues/IssueDevelopmentCard.tsx` | Add "Referenced in" wiki pages section |
| `frontend/src/api/development-panel.api.ts` | Add wikiPages to DevelopmentSummary type |
| `docs/axiom-mcp-server.md` | Document 7 new MCP tools |

---

## Task 1: Prisma Schema -- WikiPageIssueLink Model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add WikiIssueLinkType enum and WikiPageIssueLink model**

Add after the `IssueBranch` model (around line 768). Follow existing patterns with `@@map`, `@@index`, named relations.

```prisma
enum WikiIssueLinkType {
  MENTION
  EMBED
}

model WikiPageIssueLink {
  id          String              @id @default(cuid())
  pageId      String
  page        Page                @relation(fields: [pageId], references: [id], onDelete: Cascade)
  issueId     String
  issue       Issue               @relation(fields: [issueId], references: [id], onDelete: Cascade)
  linkType    WikiIssueLinkType
  createdAt   DateTime            @default(now())
  createdById String
  createdBy   User                @relation("WikiPageIssueLinks", fields: [createdById], references: [id])

  @@unique([pageId, issueId, linkType])
  @@index([pageId])
  @@index([issueId])
  @@map("wiki_page_issue_links")
}
```

- [ ] **Step 2: Add reverse relations to existing models**

On the `Page` model (around line 613), add:
```prisma
wikiIssueLinks WikiPageIssueLink[]
```

On the `Issue` model (around line 446), add:
```prisma
wikiIssueLinks WikiPageIssueLink[]
```

On the `User` model (around line 11), add:
```prisma
wikiPageIssueLinks WikiPageIssueLink[] @relation("WikiPageIssueLinks")
```

- [ ] **Step 3: Generate Prisma client and apply migration**

Run:
```bash
npx prisma migrate dev --name add-wiki-page-issue-links
```
Expected: Migration created and applied, client regenerated.

- [ ] **Step 4: Verify schema compiles**

Run:
```bash
npx prisma validate
```
Expected: "The schema is valid."

- [ ] **Step 5: Commit**

```bash
git add prisma/
git commit -m "feat(schema): add WikiPageIssueLink model for bidirectional wiki-issue linking"
```

---

## Task 2: Wiki-Issue Links Service + Tests

**Files:**
- Create: `src/modules/wiki/wiki-issue-links.service.ts`
- Create: `src/modules/wiki/wiki-issue-links.test.ts`

- [ ] **Step 1: Write failing tests for the link service**

Create `src/modules/wiki/wiki-issue-links.test.ts`. Tests need real Prisma against the test DB (see `src/seed/seed-demo.test.ts` for the adapter pattern). Test cases:

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '../../config/database';
import * as linkService from './wiki-issue-links.service';

// Use existing seeded data: org "Aranea.Dev", team "Axiom", project "AXM"
// Seed has wiki pages and issues already

describe('wiki-issue-links.service', () => {
  let testPageId: string;
  let testIssueId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Fetch seeded data for test fixtures
    const page = await prisma.page.findFirst({ where: { space: { team: { slug: 'axiom' } } } });
    const issue = await prisma.issue.findFirst({ where: { project: { prefix: 'AXM' } } });
    const user = await prisma.user.findFirst({ where: { username: 'tim' } });
    testPageId = page!.id;
    testIssueId = issue!.id;
    testUserId = user!.id;
  });

  describe('addEmbedLink', () => {
    it('creates an EMBED link between page and issue', async () => {
      const link = await linkService.addEmbedLink(testPageId, testIssueId, testUserId);
      expect(link.linkType).toBe('EMBED');
      expect(link.pageId).toBe(testPageId);
      expect(link.issueId).toBe(testIssueId);
    });

    it('is idempotent -- does not duplicate', async () => {
      const link = await linkService.addEmbedLink(testPageId, testIssueId, testUserId);
      expect(link.pageId).toBe(testPageId);
    });
  });

  describe('removeEmbedLink', () => {
    it('removes an EMBED link', async () => {
      await linkService.removeEmbedLink(testPageId, testIssueId);
      const links = await linkService.getLinksForPage(testPageId);
      const embeds = links.filter(l => l.linkType === 'EMBED');
      expect(embeds).toHaveLength(0);
    });
  });

  describe('syncMentionLinks', () => {
    it('creates MENTION links for detected issue IDs', async () => {
      await linkService.syncMentionLinks(testPageId, [testIssueId], testUserId);
      const links = await linkService.getLinksForPage(testPageId);
      const mentions = links.filter(l => l.linkType === 'MENTION');
      expect(mentions.length).toBeGreaterThanOrEqual(1);
    });

    it('removes stale MENTION links not in the new set', async () => {
      await linkService.syncMentionLinks(testPageId, [], testUserId);
      const links = await linkService.getLinksForPage(testPageId);
      const mentions = links.filter(l => l.linkType === 'MENTION');
      expect(mentions).toHaveLength(0);
    });
  });

  describe('getLinksForIssue', () => {
    it('returns wiki pages linked to an issue', async () => {
      await linkService.addEmbedLink(testPageId, testIssueId, testUserId);
      const links = await linkService.getLinksForIssue(testIssueId);
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links[0]).toHaveProperty('page');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run src/modules/wiki/wiki-issue-links.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement the link service**

Create `src/modules/wiki/wiki-issue-links.service.ts`:

```typescript
import { prisma } from '../../config/database';
import type { WikiIssueLinkType } from '@prisma/client';

export async function addLink(pageId: string, issueId: string, linkType: 'EMBED' | 'MENTION', userId: string) {
  return prisma.wikiPageIssueLink.upsert({
    where: { pageId_issueId_linkType: { pageId, issueId, linkType } },
    create: { pageId, issueId, linkType, createdById: userId },
    update: {},
  });
}

// Convenience alias for embed links
export const addEmbedLink = (pageId: string, issueId: string, userId: string) =>
  addLink(pageId, issueId, 'EMBED', userId);

export async function removeEmbedLink(pageId: string, issueId: string) {
  return prisma.wikiPageIssueLink.deleteMany({
    where: { pageId, issueId, linkType: 'EMBED' },
  });
}

export async function syncMentionLinks(pageId: string, issueIds: string[], userId: string) {
  const existing = await prisma.wikiPageIssueLink.findMany({
    where: { pageId, linkType: 'MENTION' },
  });

  const existingSet = new Set(existing.map(l => l.issueId));
  const newSet = new Set(issueIds);

  const toAdd = issueIds.filter(id => !existingSet.has(id));
  const toRemove = existing.filter(l => !newSet.has(l.issueId)).map(l => l.id);

  await prisma.$transaction([
    ...toAdd.map(issueId =>
      prisma.wikiPageIssueLink.create({
        data: { pageId, issueId, linkType: 'MENTION', createdById: userId },
      }),
    ),
    ...(toRemove.length
      ? [prisma.wikiPageIssueLink.deleteMany({ where: { id: { in: toRemove } } })]
      : []),
  ]);
}

export async function getLinksForPage(pageId: string) {
  return prisma.wikiPageIssueLink.findMany({
    where: { pageId },
    include: {
      issue: {
        select: {
          id: true, number: true, title: true, status: true, priority: true, type: true,
          assignee: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          project: { select: { id: true, prefix: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getLinksForIssue(issueId: string) {
  return prisma.wikiPageIssueLink.findMany({
    where: { issueId },
    include: {
      page: {
        select: {
          id: true, title: true, slug: true,
          space: { select: { id: true, name: true, slug: true, team: { select: { slug: true, org: { select: { slug: true } } } } } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run src/modules/wiki/wiki-issue-links.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/modules/wiki/wiki-issue-links.service.ts src/modules/wiki/wiki-issue-links.test.ts
git commit -m "feat(wiki): add wiki-issue links service with bidirectional queries"
```

---

## Task 3: Wiki-Issue Links Controller + Routes

**Files:**
- Create: `src/modules/wiki/wiki-issue-links.controller.ts`
- Modify: `src/modules/wiki/wiki.routes.ts`

- [ ] **Step 1: Create the controller**

Create `src/modules/wiki/wiki-issue-links.controller.ts`:

```typescript
import type { Request, Response } from 'express';
import * as linkService from './wiki-issue-links.service';

export async function listLinkedIssues(req: Request, res: Response) {
  const { pageId } = req.params;
  const links = await linkService.getLinksForPage(pageId);
  res.json(links);
}

export async function listLinkedPages(req: Request, res: Response) {
  const { issueId } = req.params;
  const links = await linkService.getLinksForIssue(issueId);
  res.json(links);
}

export async function addLink(req: Request, res: Response) {
  const { pageId } = req.params;
  const { issueId, linkType } = req.body;
  // Both EMBED and MENTION can be created manually; the service upserts by type
  const link = await linkService.addLink(pageId, issueId, linkType as 'EMBED' | 'MENTION', req.userId!);
  res.status(201).json(link);
}

export async function removeLink(req: Request, res: Response) {
  const { pageId, issueId } = req.params;
  await linkService.removeEmbedLink(pageId, issueId);
  res.status(204).end();
}
```

- [ ] **Step 2: Mount routes in wiki.routes.ts**

Add to `src/modules/wiki/wiki.routes.ts` after existing page routes (after the restoreVersion route, around line 130):

```typescript
import * as linkController from './wiki-issue-links.controller';

// Wiki-Issue Links
router.get('/pages/:pageId/linked-issues', linkController.listLinkedIssues);
router.post('/pages/:pageId/linked-issues', linkController.addLink);
router.delete('/pages/:pageId/linked-issues/:issueId', linkController.removeLink);
```

Also add a route on the issues side. In `src/modules/wiki/wiki-issue-links.controller.ts`, add:

```typescript
export async function listLinkedPagesForIssue(req: Request, res: Response) {
  const { projectId, issueNumber } = req.params;
  const issue = await prisma.issue.findFirst({
    where: { projectId, number: parseInt(issueNumber, 10) },
    select: { id: true },
  });
  if (!issue) return res.status(404).json({ error: { message: 'Issue not found' } });
  const links = await linkService.getLinksForIssue(issue.id);
  res.json(links);
}
```

In `src/modules/issues/issues.routes.ts`, mount it:

```typescript
import * as wikiLinkController from '../wiki/wiki-issue-links.controller';

router.get('/:projectId/issues/:issueNumber/wiki-links', wikiLinkController.listLinkedPagesForIssue);
```

- [ ] **Step 3: Verify backend compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/wiki/wiki-issue-links.controller.ts src/modules/wiki/wiki.routes.ts src/modules/issues/issues.routes.ts
git commit -m "feat(wiki): add REST endpoints for wiki-issue links"
```

---

## Task 4: Auto-Sync Mention Links on Page Save

**Files:**
- Modify: `src/modules/wiki/wiki.service.ts`

- [ ] **Step 1: Add issue key extraction helper**

Add to `src/modules/wiki/wiki-issue-links.service.ts`:

```typescript
import { prisma } from '../../config/database';

// Matches issue keys like AXM-123 and issue URLs like /org/team/project/issues/42
const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

export async function extractIssueIdsFromContent(content: string): Promise<string[]> {
  const keys = new Set<string>();
  let match;
  while ((match = ISSUE_KEY_RE.exec(content)) !== null) {
    keys.add(match[1]);
  }
  if (keys.size === 0) return [];

  // Parse prefix and number from each key, look up issues
  const conditions = [...keys].map(key => {
    const [prefix, numStr] = key.split('-');
    return { project: { prefix }, number: parseInt(numStr, 10) };
  });

  const issues = await prisma.issue.findMany({
    where: { OR: conditions },
    select: { id: true },
  });

  return issues.map(i => i.id);
}
```

- [ ] **Step 2: Wire syncMentionLinks into wiki.service.ts updatePage()**

In `src/modules/wiki/wiki.service.ts`, after the page update transaction (around line 259, before broadcastToRoom):

```typescript
import { syncMentionLinks, extractIssueIdsFromContent } from './wiki-issue-links.service';

// Inside updatePage(), after the prisma update:
if (data.body) {
  const issueIds = await extractIssueIdsFromContent(data.body);
  await syncMentionLinks(page.id, issueIds, authorId);
}
```

- [ ] **Step 3: Wire syncMentionLinks into createPage()**

In `src/modules/wiki/wiki.service.ts`, in `createPage()` after the page is created (around line 140):

```typescript
if (data.body) {
  const issueIds = await extractIssueIdsFromContent(data.body);
  await syncMentionLinks(newPage.id, issueIds, data.createdById);
}
```

- [ ] **Step 4: Add real-time broadcast for link changes**

In `syncMentionLinks()` in `wiki-issue-links.service.ts`, capture affected issueIds before deletion, then broadcast after the transaction:

```typescript
import { broadcastToRoom } from '../../realtime/broadcast';

// Before the transaction, capture issueIds being removed:
const removedIssueIds = existing.filter(l => !newSet.has(l.issueId)).map(l => l.issueId);

// After the transaction, broadcast for all affected issues:
const allAffectedIssueIds = new Set([...toAdd, ...removedIssueIds]);
for (const issueId of allAffectedIssueIds) {
  broadcastToRoom(`issue:${issueId}`, { type: 'issue:development-updated', issueId });
}
```

Similarly in `addLink`:
```typescript
broadcastToRoom(`issue:${issueId}`, { type: 'issue:development-updated', issueId });
```

- [ ] **Step 5: Verify backend compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Run existing wiki tests to check no regressions**

Run: `npm test -- --run src/modules/wiki/`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/modules/wiki/wiki.service.ts src/modules/wiki/wiki-issue-links.service.ts
git commit -m "feat(wiki): auto-sync mention links on page save with real-time broadcast"
```

---

## Task 5: Development Panel -- Wiki Pages Section

**Files:**
- Modify: `src/modules/issues/development-panel.service.ts`
- Modify: `frontend/src/api/development-panel.api.ts`
- Modify: `frontend/src/pages/issues/IssueDevelopmentCard.tsx`

- [ ] **Step 1: Add wikiPages to DevelopmentSummary**

In `src/modules/issues/development-panel.service.ts`, add to the `DevelopmentSummary` interface:

```typescript
wikiPages: Array<{
  id: string;
  linkType: string;
  page: {
    id: string;
    title: string;
    slug: string;
    space: { id: string; name: string; slug: string; team: { slug: string; org: { slug: string } } };
  };
}>;
```

In `getDevelopmentSummary()`, add a query to the existing `Promise.all()`:

```typescript
import { getLinksForIssue } from '../wiki/wiki-issue-links.service';

// Inside Promise.all, add:
getLinksForIssue(issue.id),
```

Destructure and add to return object:
```typescript
const [branches, commits, issuePRs, pipelineRuns, wikiPages] = await Promise.all([...]);
// ...
return { branches: [...], commits: [...], pullRequests: [...], pipelines: [...], wikiPages };
```

- [ ] **Step 2: Update frontend DevelopmentSummary type**

In `frontend/src/api/development-panel.api.ts`, add to the interface:

```typescript
wikiPages: Array<{
  id: string;
  linkType: string;
  page: {
    id: string;
    title: string;
    slug: string;
    space: { id: string; name: string; slug: string; team: { slug: string; org: { slug: string } } };
  };
}>;
```

- [ ] **Step 3: Add wiki pages section to IssueDevelopmentCard.tsx**

Add a new section after the existing pipelines section. Use the `FileText` Lucide icon. Each entry shows page title, space name, and link type badge. Clicking navigates to `/${orgSlug}/${teamSlug}/wiki/${spaceSlug}/${pageSlug}`.

```tsx
import { FileText } from 'lucide-react';

{data.wikiPages.length > 0 && (
  <div>
    <h4 className="text-xs font-medium text-secondary mb-2 flex items-center gap-1.5">
      <FileText size={14} /> Wiki Pages ({data.wikiPages.length})
    </h4>
    <div className="space-y-1">
      {data.wikiPages.map(wp => (
        <Link
          key={wp.id}
          to={`/${wp.page.space.team.org.slug}/${wp.page.space.team.slug}/wiki/${wp.page.space.slug}/${wp.page.slug}`}
          className="block text-sm text-link hover:underline"
        >
          {wp.page.title}
          <span className="text-xs text-tertiary ml-2">{wp.page.space.name}</span>
        </Link>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/issues/development-panel.service.ts frontend/src/api/development-panel.api.ts frontend/src/pages/issues/IssueDevelopmentCard.tsx
git commit -m "feat(issues): show linked wiki pages in development panel"
```

---

## Task 6: IssueEmbedExtension for TipTap Editor

**Files:**
- Create: `frontend/src/components/editor/IssueEmbedExtension.ts`
- Create: `frontend/src/components/editor/IssueEmbedNode.tsx`
- Modify: `frontend/src/components/editor/MarkdownEditor.tsx`
- Modify: `frontend/src/components/editor/CollaborativeEditor.tsx`
- Modify: `frontend/src/components/editor/SlashCommandExtension.ts`

- [ ] **Step 1: Create the TipTap node extension**

Create `frontend/src/components/editor/IssueEmbedExtension.ts`:

```typescript
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { IssueEmbedNode } from './IssueEmbedNode';

export const IssueEmbedExtension = Node.create({
  name: 'issueEmbed',
  group: 'block',
  atom: true,
  defining: true,

  addAttributes() {
    return {
      issueKey: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-issue-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-issue-embed': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(IssueEmbedNode);
  },
});
```

- [ ] **Step 2: Create the React node view component**

Create `frontend/src/components/editor/IssueEmbedNode.tsx`:

A card component that receives `issueKey` from node attributes, fetches issue data via API, and renders: issue key badge, title, status badge (using existing `Badge` component), priority icon, assignee avatar. Shows a loading skeleton while fetching. Read-only in editor context.

Use existing UI components from `frontend/src/components/ui/` (Badge, Avatar, etc.). Use `CircleDot` Lucide icon for the issue type indicator. Follow the pattern from `SmartLinkNode.tsx` for `NodeViewWrapper` usage.

- [ ] **Step 3: Register extension in MarkdownEditor.tsx and CollaborativeEditor.tsx**

In both files, import and add to the extensions array:

```typescript
import { IssueEmbedExtension } from './IssueEmbedExtension';

// In extensions array:
IssueEmbedExtension,
```

- [ ] **Step 4: Add `/issue` slash command**

In `frontend/src/components/editor/SlashCommandExtension.ts`, add to the commands array in the Embed category:

```typescript
{
  title: 'Issue Embed',
  description: 'Embed a live issue card',
  icon: CircleDot,
  command: ({ editor, range }) => {
    // Open issue picker dialog -- set a callback that inserts:
    // editor.chain().focus().deleteRange(range).insertContent({
    //   type: 'issueEmbed',
    //   attrs: { issueKey: selectedIssue.key },
    // }).run();
  },
},
```

The exact picker implementation: reuse the existing issue search input pattern (similar to `ParentIssuePicker.tsx`). Open as a popover/dialog on command trigger.

- [ ] **Step 5: Add markdown serialization**

Handle `:::issue AXM-123:::` directive in the markdown serialize/parse logic. In the editor's markdown serializer config, add a handler for the `issueEmbed` node type that outputs the directive. In the parser, add a rule that matches the directive and creates the node.

Check how `CalloutExtension` and `CollapsibleExtension` handle their custom markdown formats (`> [!NOTE]`, `> [!DETAILS]`) for the exact pattern to follow.

- [ ] **Step 6: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/editor/IssueEmbedExtension.ts frontend/src/components/editor/IssueEmbedNode.tsx frontend/src/components/editor/MarkdownEditor.tsx frontend/src/components/editor/CollaborativeEditor.tsx frontend/src/components/editor/SlashCommandExtension.ts
git commit -m "feat(wiki): add IssueEmbedExtension with /issue slash command and live card rendering"
```

---

## Task 7: Frontend API + Wiki Issue Links UI

**Files:**
- Create: `frontend/src/api/wiki-issue-links.api.ts`
- Modify: `frontend/src/pages/wiki/PageView.tsx` (or relevant wiki page component)

- [ ] **Step 1: Create API helpers**

Create `frontend/src/api/wiki-issue-links.api.ts`:

```typescript
import { get, post, del } from './client';

export const wikiIssueLinksApi = {
  listForPage: (pageId: string) =>
    get<WikiIssueLink[]>(`/wiki/pages/${pageId}/linked-issues`),
  addLink: (pageId: string, issueId: string, linkType: 'MENTION' | 'EMBED') =>
    post<WikiIssueLink>(`/wiki/pages/${pageId}/linked-issues`, { issueId, linkType }),
  removeLink: (pageId: string, issueId: string) =>
    del(`/wiki/pages/${pageId}/linked-issues/${issueId}`),
};
```

- [ ] **Step 2: Add linked issues sidebar/section on wiki page view**

In the wiki page view component, add a sidebar section or collapsible panel showing linked issues. Use `useQuery` with the `wikiIssueLinksApi.listForPage` call. Display each linked issue as a compact row with key, title, status badge.

This should only show when there are linked issues (don't show empty state for this section).

- [ ] **Step 3: Wire IssueEmbedNode to create EMBED links**

When the IssueEmbedNode is inserted via the slash command picker, call `wikiIssueLinksApi.addLink(pageId, issueId, 'EMBED')` to create the backend link. The pageId should come from the editor's page context.

- [ ] **Step 4: Verify frontend compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/wiki-issue-links.api.ts frontend/src/pages/wiki/
git commit -m "feat(wiki): add linked issues UI on wiki pages with API integration"
```

---

## Task 8: Git Search Commands

**Files:**
- Create: `src/git/git-search-commands.ts`

- [ ] **Step 1: Write failing test for grepFiles**

Create a test in `src/git/git-search-commands.test.ts` that calls `grepFiles()` against one of the seeded test repos. Verify it returns results with filePath, lineNumber, and lineContent.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run src/git/git-search-commands.test.ts`
Expected: FAIL -- module not found

- [ ] **Step 3: Implement grepFiles**

Create `src/git/git-search-commands.ts`:

```typescript
import { git } from './git-core';

export interface GrepResult {
  filePath: string;
  lineNumber: number;
  lineContent: string;
}

export async function grepFiles(
  repoPath: string,
  query: string,
  opts?: { filePattern?: string; maxResults?: number },
): Promise<GrepResult[]> {
  // Repos are stored as bare repos, so we must specify a tree-ish (HEAD)
  const args = ['grep', '-n', '--no-color', '-I'];
  if (opts?.maxResults) args.push(`--max-count=${opts.maxResults}`);
  args.push('HEAD', '--', query);
  if (opts?.filePattern) args.push(opts.filePattern);

  try {
    const output = await git(args, { cwd: repoPath });
    // Bare repo output format: HEAD:path/to/file:lineNum:content
    return output
      .split('\n')
      .filter(Boolean)
      .map(line => {
        // Strip leading "HEAD:" prefix from bare repo output
        const stripped = line.startsWith('HEAD:') ? line.slice(5) : line;
        const [filePath, lineNumStr, ...rest] = stripped.split(':');
        return {
          filePath,
          lineNumber: parseInt(lineNumStr, 10),
          lineContent: rest.join(':'),
        };
      })
      .slice(0, opts?.maxResults ?? 100);
  } catch {
    // git grep exits 1 when no matches
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run src/git/git-search-commands.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/git/git-search-commands.ts src/git/git-search-commands.test.ts
git commit -m "feat(git): add grepFiles wrapper for git grep code search"
```

---

## Task 9: MCP Integration Tools

**Files:**
- Create: `src/mcp/tools/integration-tools.ts`
- Modify: `src/mcp/tools/types.ts`
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/mcp-permissions.ts`

- [ ] **Step 1: Add getOrgIdFromPage to McpToolContext**

In `src/mcp/tools/types.ts`, add to the interface:

```typescript
getOrgIdFromPage: (pageId: string) => Promise<string | undefined>;
```

In `src/mcp/server.ts`, implement the helper following the existing pattern (page -> space -> team -> org):

```typescript
async function getOrgIdFromPage(pageId: string): Promise<string | undefined> {
  const page = await prisma.page.findUnique({
    where: { id: pageId },
    select: { space: { select: { team: { select: { orgId: true } } } } },
  });
  return page?.space?.team?.orgId;
}
```

Add to the `ctx` object passed to tool registrations.

- [ ] **Step 2: Create integration-tools.ts with 3 cross-product tools**

Create `src/mcp/tools/integration-tools.ts`:

Implements:
- `get_development_summary` -- calls `getDevelopmentSummary()` from `development-panel.service.ts`. Input: projectId, issueNumber. Permission check via `getOrgIdFromProject`.
- `list_wiki_issue_links` -- calls `getLinksForPage()` or `getLinksForIssue()`. Input: pageId or issueId (one required). Permission check via `getOrgIdFromPage` or `getOrgIdFromProject`.
- `link_wiki_to_issue` -- calls `addEmbedLink()` or creates MENTION link. Input: pageId, issueId, linkType. Permission check via `getOrgIdFromPage`.

Follow exact pattern from `wiki-tools.ts`: `export function registerIntegrationTools(ctx: McpToolContext) { ... }` with Zod schemas for each tool.

- [ ] **Step 3: Register in server.ts**

In `src/mcp/server.ts`, import and call:

```typescript
import { registerIntegrationTools } from './tools/integration-tools';

// After other registrations:
registerIntegrationTools(ctx);
```

- [ ] **Step 4: Add permission mappings**

In `src/mcp/mcp-permissions.ts`, add to the `MCP_TOOL_PERMISSIONS` record:

```typescript
'get_development_summary': 'issue:view',
'list_wiki_issue_links': 'wiki:view',
'link_wiki_to_issue': 'wiki:edit',
```

- [ ] **Step 5: Verify backend compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/mcp/tools/integration-tools.ts src/mcp/tools/types.ts src/mcp/server.ts src/mcp/mcp-permissions.ts
git commit -m "feat(mcp): add integration tools -- get_development_summary, list_wiki_issue_links, link_wiki_to_issue"
```

---

## Task 10: MCP Repo Tools -- search_code, get_pr_diff, get_pr_comments, get_recent_merges

**Files:**
- Modify: `src/mcp/tools/repo-tools.ts`
- Modify: `src/mcp/mcp-permissions.ts`

- [ ] **Step 1: Add search_code tool**

In `src/mcp/tools/repo-tools.ts`, add a new tool registration:

```typescript
import { grepFiles } from '../../git/git-search-commands';

server.tool('search_code', 'Search code across repositories using git grep', {
  query: z.string().describe('Search pattern'),
  orgId: z.string().describe('Organization ID'),
  repoId: z.string().optional().describe('Optional: limit to specific repo'),
  filePattern: z.string().optional().describe('Optional: file glob pattern (e.g., "*.ts")'),
}, async (args) => {
  // Permission check, resolve repo paths, call grepFiles, return results
});
```

If `repoId` is provided, search that repo. Otherwise, search all repos in the org (with a reasonable limit).

- [ ] **Step 2: Add get_pr_diff tool**

```typescript
server.tool('get_pr_diff', 'Get the full unified diff for a pull request', {
  repoId: z.string().describe('Repository ID'),
  pullNumber: z.number().describe('PR number'),
}, async (args) => {
  // Look up PR, get source/target branches, call gitCmd.diff()
  // Truncate at 100KB with warning
});
```

- [ ] **Step 3: Add get_pr_comments tool**

```typescript
server.tool('get_pr_comments', 'Get all review comments on a pull request with file/line context', {
  repoId: z.string().describe('Repository ID'),
  pullNumber: z.number().describe('PR number'),
}, async (args) => {
  // Query PRComment with file, line, parentId for threads
  // Include author info
});
```

- [ ] **Step 4: Add get_recent_merges tool**

```typescript
server.tool('get_recent_merges', 'List recently merged pull requests for a repository', {
  repoId: z.string().describe('Repository ID'),
  since: z.string().optional().describe('ISO date to filter merges after'),
  limit: z.number().optional().default(10).describe('Max results'),
}, async (args) => {
  // Query PRs with status MERGED, ordered by mergedAt desc
  // Include linked issues
});
```

- [ ] **Step 5: Add permission mappings**

In `src/mcp/mcp-permissions.ts`:

```typescript
'search_code': 'repo:read',
'get_pr_diff': 'repo:read',
'get_pr_comments': 'repo:read',
'get_recent_merges': 'repo:read',
```

- [ ] **Step 6: Verify backend compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools/repo-tools.ts src/mcp/mcp-permissions.ts
git commit -m "feat(mcp): add search_code, get_pr_diff, get_pr_comments, get_recent_merges tools"
```

---

## Task 11: Update MCP Documentation

**Files:**
- Modify: `docs/axiom-mcp-server.md`

- [ ] **Step 1: Add 7 new tools to the tool catalog**

Add entries for each new tool in the appropriate sections of the MCP server docs. Include description, parameters, example usage, and which workflows they enable.

Group the new tools:
- Under "Repository & Git" section: `search_code`, `get_pr_diff`, `get_pr_comments`, `get_recent_merges`
- New "Cross-Product Integration" section: `get_development_summary`, `list_wiki_issue_links`, `link_wiki_to_issue`

- [ ] **Step 2: Add workflow examples**

Add the three workflow examples from the spec (investigate & triage, code review context, doc sync) as documented agent workflow patterns.

- [ ] **Step 3: Update tool count**

Update the total tool count from 37 to 44.

- [ ] **Step 4: Commit**

```bash
git add docs/axiom-mcp-server.md
git commit -m "docs: add 7 new MCP tools to server documentation"
```

---

## Task 12: Update Feature Gap Analysis

**Files:**
- Modify: `docs/superpowers/feature-gap-analysis.md`

- [ ] **Step 1: Mark wiki-issue linking as complete**

Change `[ ] **Wiki-issue linking**` to `[x]` in the Cross-Product Integration section with evidence description.

- [ ] **Step 2: Update summary table**

Cross-Product Integration: 9/9 = 100% coverage.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/feature-gap-analysis.md
git commit -m "docs: mark wiki-issue linking complete in feature gap analysis"
```

---

## Task 13: Final Verification

- [ ] **Step 1: Run full backend typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run full frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run all backend tests**

Run: `npm test`
Expected: All pass

- [ ] **Step 4: Run lint**

Run: `npm run check`
Expected: Clean

- [ ] **Step 5: Verify MCP server starts and tools are registered**

Start the dev stack and verify the MCP endpoint responds with all 44 tools listed.
