# Smart Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When users paste Axiom URLs into any rich text editor, render them as rich inline previews (icon + key + title + status) instead of plain links.

**Architecture:** New TipTap extension that intercepts paste events for Axiom URLs, resolves them via a new lightweight API endpoint, and renders custom inline nodes with preview data. Follows the existing IssueReferenceExtension pattern.

**Tech Stack:** TipTap (Node extension + paste handler), Express, React, TanStack Query

**Spec:** `docs/superpowers/specs/2026-03-28-high-value-features-design.md` (Feature 7)

---

## File Structure

### Backend (new files)
- `src/modules/links/resolve-link.service.ts` — URL parsing and metadata resolution
- `src/modules/links/resolve-link.controller.ts` — API endpoint
- `src/modules/links/resolve-link.test.ts` — Tests for URL parsing
- `src/modules/links/links.routes.ts` — Route mounting

### Backend (modified files)
- `src/routes/index.ts` or main router — Mount links routes

### Frontend (new files)
- `frontend/src/components/editor/SmartLinkExtension.ts` — TipTap extension
- `frontend/src/components/editor/SmartLinkNode.tsx` — React node view renderer

### Frontend (modified files)
- `frontend/src/components/editor/MarkdownEditor.tsx` — Register extension
- `frontend/src/components/editor/CollaborativeEditor.tsx` — Register extension

---

## Task 1: URL Parser and Resolver Backend

**Files:**
- Create: `src/modules/links/resolve-link.service.ts`
- Create: `src/modules/links/resolve-link.test.ts`

### Step 1: Write failing tests for URL parsing

- [ ] Create tests:

```typescript
// src/modules/links/resolve-link.test.ts
import { describe, it, expect } from 'vitest';
import { parseAxiomUrl } from './resolve-link.service';

describe('parseAxiomUrl', () => {
  it('parses issue URL', () => {
    const result = parseAxiomUrl('/acme/engineering/axm-project/issues/42');
    expect(result).toEqual({
      type: 'issue',
      org: 'acme',
      team: 'engineering',
      project: 'axm-project',
      identifier: '42'
    });
  });

  it('parses PR URL', () => {
    const result = parseAxiomUrl('/acme/engineering/repos/my-repo/pulls/7');
    expect(result).toEqual({
      type: 'pull_request',
      org: 'acme',
      team: 'engineering',
      repo: 'my-repo',
      identifier: '7'
    });
  });

  it('parses wiki page URL', () => {
    const result = parseAxiomUrl('/acme/engineering/wiki/docs/getting-started');
    expect(result).toEqual({
      type: 'wiki_page',
      org: 'acme',
      team: 'engineering',
      space: 'docs',
      identifier: 'getting-started'
    });
  });

  it('returns null for non-Axiom paths', () => {
    const result = parseAxiomUrl('/settings/profile');
    expect(result).toBeNull();
  });

  it('handles full URLs by extracting pathname', () => {
    const result = parseAxiomUrl('http://localhost:7000/acme/engineering/axm-project/issues/42');
    expect(result).toEqual({
      type: 'issue',
      org: 'acme',
      team: 'engineering',
      project: 'axm-project',
      identifier: '42'
    });
  });
});
```

- [ ] Run tests to verify they fail:

```bash
npx vitest run src/modules/links/resolve-link.test.ts
```

### Step 2: Implement the URL parser

- [ ] Create the service:

```typescript
// src/modules/links/resolve-link.service.ts
import { prisma } from '../../config/database';

interface ParsedUrl {
  type: 'issue' | 'pull_request' | 'wiki_page' | 'commit';
  org: string;
  team: string;
  project?: string;
  repo?: string;
  space?: string;
  identifier: string;
}

export interface LinkPreview {
  type: string;
  title: string;
  status?: string;
  icon?: string;
  key?: string;
  url: string;
}

// URL patterns:
// Issues: /:org/:team/:project/issues/:num
// PRs: /:org/:team/repos/:repo/pulls/:num
// Wiki: /:org/:team/wiki/:space/:page
const ISSUE_PATTERN = /^\/([^/]+)\/([^/]+)\/([^/]+)\/issues\/(\d+)$/;
const PR_PATTERN = /^\/([^/]+)\/([^/]+)\/repos\/([^/]+)\/pulls\/(\d+)$/;
const WIKI_PATTERN = /^\/([^/]+)\/([^/]+)\/wiki\/([^/]+)\/([^/]+)$/;

export function parseAxiomUrl(urlOrPath: string): ParsedUrl | null {
  let pathname = urlOrPath;
  try {
    const url = new URL(urlOrPath);
    pathname = url.pathname;
  } catch {
    // Already a path
  }

  let match = pathname.match(ISSUE_PATTERN);
  if (match) {
    return { type: 'issue', org: match[1], team: match[2], project: match[3], identifier: match[4] };
  }

  match = pathname.match(PR_PATTERN);
  if (match) {
    return { type: 'pull_request', org: match[1], team: match[2], repo: match[3], identifier: match[4] };
  }

  match = pathname.match(WIKI_PATTERN);
  if (match) {
    return { type: 'wiki_page', org: match[1], team: match[2], space: match[3], identifier: match[4] };
  }

  return null;
}

export async function resolveLink(urlOrPath: string, userId: string): Promise<LinkPreview | null> {
  const parsed = parseAxiomUrl(urlOrPath);
  if (!parsed) return null;

  switch (parsed.type) {
    case 'issue': {
      const issue = await prisma.issue.findFirst({
        where: {
          number: parseInt(parsed.identifier, 10),
          project: {
            slug: parsed.project,
            team: { slug: parsed.team, org: { slug: parsed.org } }
          }
        },
        include: {
          project: { select: { prefix: true } },
          column: { select: { name: true, isDone: true } },
          assignee: { select: { displayName: true } }
        }
      });
      if (!issue) return null;
      return {
        type: 'issue',
        title: issue.title,
        key: `${issue.project.prefix}-${issue.number}`,
        status: issue.column?.name,
        icon: issue.type.toLowerCase(),
        url: `/${parsed.org}/${parsed.team}/${parsed.project}/issues/${issue.number}`
      };
    }
    case 'pull_request': {
      const pr = await prisma.pullRequest.findFirst({
        where: {
          number: parseInt(parsed.identifier, 10),
          repo: {
            slug: parsed.repo,
            team: { slug: parsed.team, org: { slug: parsed.org } }
          }
        },
        include: {
          repo: { select: { name: true } },
          author: { select: { displayName: true } }
        }
      });
      if (!pr) return null;
      return {
        type: 'pull_request',
        title: pr.title,
        key: `${pr.repo.name}#${pr.number}`,
        status: pr.status,
        icon: 'git-pull-request',
        url: `/${parsed.org}/${parsed.team}/repos/${parsed.repo}/pulls/${pr.number}`
      };
    }
    case 'wiki_page': {
      const page = await prisma.page.findFirst({
        where: {
          slug: parsed.identifier,
          space: {
            slug: parsed.space,
            team: { slug: parsed.team, org: { slug: parsed.org } }
          }
        },
        include: {
          space: { select: { name: true } }
        }
      });
      if (!page) return null;
      return {
        type: 'wiki_page',
        title: page.title,
        key: page.space.name,
        icon: 'file-text',
        url: `/${parsed.org}/${parsed.team}/wiki/${parsed.space}/${page.slug}`
      };
    }
    default:
      return null;
  }
}
```

- [ ] Run tests:

```bash
npx vitest run src/modules/links/resolve-link.test.ts
```

- [ ] Commit:

```bash
git add src/modules/links/resolve-link.service.ts src/modules/links/resolve-link.test.ts
git commit -m "feat(links): add URL parser and resolver for smart link previews"
```

---

## Task 2: Resolve Link API Endpoint

**Files:**
- Create: `src/modules/links/resolve-link.controller.ts`
- Create: `src/modules/links/links.routes.ts`
- Modify: Main router to mount links routes

### Step 1: Create controller and routes

- [ ] Create the controller:

```typescript
// src/modules/links/resolve-link.controller.ts
import { Request, Response } from 'express';
import { resolveLink } from './resolve-link.service';

export async function resolveLinkHandler(req: Request, res: Response) {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: { message: 'url query parameter is required' } });
  }

  const preview = await resolveLink(url, req.user!.id);
  if (!preview) {
    return res.status(404).json({ error: { message: 'Could not resolve link' } });
  }

  res.json(preview);
}
```

- [ ] Create the routes file:

```typescript
// src/modules/links/links.routes.ts
import { Router } from 'express';
import { resolveLinkHandler } from './resolve-link.controller';
import { requireAuth } from '../../middleware/auth';

const router = Router();
router.get('/resolve-link', requireAuth, resolveLinkHandler);
export default router;
```

- [ ] Mount in the main router (check `src/routes/index.ts` or equivalent):

```typescript
import linksRoutes from '../modules/links/links.routes';
router.use('/api', linksRoutes);
```

- [ ] Commit:

```bash
git add src/modules/links/resolve-link.controller.ts src/modules/links/links.routes.ts src/routes/index.ts
git commit -m "feat(links): add resolve-link API endpoint for smart link previews"
```

---

## Task 3: TipTap Smart Link Extension

**Files:**
- Create: `frontend/src/components/editor/SmartLinkExtension.ts`
- Create: `frontend/src/components/editor/SmartLinkNode.tsx`

### Step 1: Create the TipTap node extension

- [ ] Create the extension following the `IssueReferenceExtension.ts` pattern:

```typescript
// frontend/src/components/editor/SmartLinkExtension.ts
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import SmartLinkNode from './SmartLinkNode';
import { get } from '../../api/client';

export interface SmartLinkAttrs {
  url: string;
  type: string;
  title: string;
  key: string;
  status: string | null;
  icon: string | null;
}

const SmartLinkExtension = Node.create({
  name: 'smartLink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      url: { default: '' },
      type: { default: '' },
      title: { default: '' },
      key: { default: '' },
      status: { default: null },
      icon: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-smart-link]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-smart-link': '' }, HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(SmartLinkNode);
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('smartLinkPaste'),
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData('text/plain');
            if (!text) return false;

            // Check if pasted text looks like an Axiom URL
            const isAxiomUrl = /\/(issues|repos|wiki)\//.test(text) &&
              (text.startsWith('/') || text.startsWith('http'));

            if (!isAxiomUrl) return false;

            // Resolve the link asynchronously
            get<SmartLinkAttrs>(`/resolve-link?url=${encodeURIComponent(text)}`)
              .then((preview) => {
                if (preview) {
                  editor.chain().focus().insertContent({
                    type: 'smartLink',
                    attrs: { ...preview, url: preview.url }
                  }).run();
                } else {
                  // Fallback: insert as plain text
                  editor.chain().focus().insertContent(text).run();
                }
              })
              .catch(() => {
                editor.chain().focus().insertContent(text).run();
              });

            return true; // Prevent default paste
          }
        }
      })
    ];
  },
});

export default SmartLinkExtension;
```

### Step 2: Create the node view component

- [ ] Create the React component for rendering smart link nodes:

```typescript
// frontend/src/components/editor/SmartLinkNode.tsx
import { NodeViewWrapper } from '@tiptap/react';
import { Link } from 'react-router';
import {
  Bug, BookOpen, CheckSquare, Layers,
  GitPullRequest, FileText
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  bug: Bug,
  story: BookOpen,
  task: CheckSquare,
  epic: Layers,
  'git-pull-request': GitPullRequest,
  'file-text': FileText,
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-info/15 text-info',
  MERGED: 'bg-primary/15 text-primary',
  CLOSED: 'bg-muted text-muted-foreground',
};

export default function SmartLinkNode({ node }: { node: { attrs: Record<string, string> } }) {
  const { url, type, title, key, status, icon } = node.attrs;
  const IconComponent = ICON_MAP[icon] || FileText;
  const statusClass = status ? (STATUS_COLORS[status] || 'bg-muted text-muted-foreground') : '';

  return (
    <NodeViewWrapper as="span" className="inline">
      <Link
        to={url}
        className="inline-flex items-center gap-1 rounded border border-border bg-muted/50 px-1.5 py-0.5 text-sm hover:bg-muted transition-colors no-underline"
        contentEditable={false}
      >
        <IconComponent className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {key && <span className="font-mono text-xs text-muted-foreground">{key}</span>}
        <span className="text-foreground truncate max-w-48">{title}</span>
        {status && (
          <span className={`text-xs px-1 rounded ${statusClass}`}>
            {status}
          </span>
        )}
      </Link>
    </NodeViewWrapper>
  );
}
```

- [ ] Commit:

```bash
git add frontend/src/components/editor/SmartLinkExtension.ts frontend/src/components/editor/SmartLinkNode.tsx
git commit -m "feat(editor): add smart link TipTap extension with paste handler and preview node"
```

---

## Task 4: Register Extension in Editors

**Files:**
- Modify: `frontend/src/components/editor/MarkdownEditor.tsx`
- Modify: `frontend/src/components/editor/CollaborativeEditor.tsx`

### Step 1: Register SmartLinkExtension

- [ ] In both `MarkdownEditor.tsx` and `CollaborativeEditor.tsx`, import and add the extension to the extensions array:

```typescript
import SmartLinkExtension from './SmartLinkExtension';

// In the useEditor extensions array, add:
SmartLinkExtension,
```

This goes alongside the existing extensions (MentionExtension, IssueReferenceExtension, etc.)

- [ ] Commit:

```bash
git add frontend/src/components/editor/MarkdownEditor.tsx frontend/src/components/editor/CollaborativeEditor.tsx
git commit -m "feat(editor): register smart link extension in all editors"
```

---

## Task 5: Documentation

**Files:**
- Modify: `docs/api-reference.md`
- Modify: `docs/design-patterns.md`

### Step 1: Update docs

- [ ] Add to `docs/api-reference.md`:

```markdown
### Smart Links
- `GET /api/resolve-link?url=<axiom-url>` — Resolve an Axiom URL to a preview object
- Returns: `{ type, title, key, status, icon, url }`
- Returns 404 if URL doesn't match a known resource or user lacks access
- Supported URL types: issues, pull requests, wiki pages
```

- [ ] Add to `docs/design-patterns.md` under Editor Extensions:

```markdown
### SmartLinkExtension
- **File:** `frontend/src/components/editor/SmartLinkExtension.ts`
- **Node view:** `frontend/src/components/editor/SmartLinkNode.tsx`
- **Trigger:** Paste event containing an Axiom URL
- **Behavior:** Resolves URL via `/api/resolve-link`, inserts inline preview node
- **Fallback:** Plain text if resolution fails
- **Pattern:** Follows IssueReferenceExtension (inline, atom, ReactNodeViewRenderer)
```

- [ ] Commit:

```bash
git add docs/api-reference.md docs/design-patterns.md
git commit -m "docs: add smart links API and editor extension documentation"
```
