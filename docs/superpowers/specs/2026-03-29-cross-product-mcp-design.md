# Cross-Product Integration & MCP Workflow Tools

## Overview

Two reinforcing workstreams that make Axiom's cross-product integration complete for both human users and AI agents:

1. **Wiki-Issue Linking** -- bidirectional links between wiki pages and issues, with inline smart link mentions and dedicated issue embed blocks in the editor
2. **Workflow MCP Tools** -- seven new MCP tools shaped by three target agent workflows: investigate & triage, code review context, and doc sync

## Decisions

- **Approach A** selected: focused wiki-issue bridge + workflow-driven MCP tools (not full macro system, not MCP-first)
- **Bidirectional linking**: issues know which wiki pages reference them; wiki pages render live issue data
- **Two link types**: `MENTION` (auto-detected from content on save) and `EMBED` (explicit issue card block)
- **MCP coverage is workflow-driven**, not exhaustive API mirroring -- tools are shaped by three real agent workflows
- **Doc sync is human-triggered** (agent-assisted, not automated)
- **Editor integration**: smart links for inline mentions + dedicated IssueEmbedBlock for prominent cards, both via slash command

## Data Model

### New Model: WikiPageIssueLink

```prisma
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

enum WikiIssueLinkType {
  MENTION
  EMBED
}
```

**Reverse relations added to existing models:**
- `Page`: `wikiIssueLinks WikiPageIssueLink[]`
- `Issue`: `wikiIssueLinks WikiPageIssueLink[]`
- `User`: `wikiPageIssueLinks WikiPageIssueLink[] @relation("WikiPageIssueLinks")`

### Service: wiki-issue-links.service.ts

| Function | Purpose |
|----------|---------|
| `syncMentionLinks(pageId, issueIds[], userId)` | Called on page save. Diffs current mentions vs stored MENTION links. Adds new, removes stale. |
| `addEmbedLink(pageId, issueId, userId)` | Creates an EMBED link. Idempotent (unique constraint). |
| `removeEmbedLink(pageId, issueId)` | Removes an EMBED link. |
| `getLinksForPage(pageId)` | Returns all issues linked to a wiki page (both types), with issue title/status/priority/assignee. |
| `getLinksForIssue(issueId)` | Returns all wiki pages linked to an issue (both types), with page title/space name. Used by dev panel. |

## Wiki Editor Integration

### Smart Link Auto-Linking (MENTION)

SmartLinkExtension already resolves issue URLs to rich previews. No editor changes needed for display.

On page save, the wiki service layer (`wiki.service.ts` `updatePage()`):
1. Parses page content for issue references (keys like `AXM-123`, issue URLs, and `:::issue AXM-123:::` directives)
2. Resolves keys to issue IDs via project prefix lookup
3. Calls `syncMentionLinks()` to reconcile -- adds new links, removes links for references no longer in content

This is done in the service layer so both REST API and MCP `update_wiki_page` paths trigger it. Also called from `createPage()` for initial content.

Mention links stay in sync automatically with page content.

### IssueEmbedBlock (EMBED)

New TipTap node extension: `IssueEmbedExtension`.

**Insertion:** Via slash command `/issue` in SlashCommandExtension menu (Embed category), with `CircleDot` Lucide icon. Opens issue search dialog reusing existing issue search/filter components.

**Rendering:** Card showing issue key, title, status badge, priority icon, assignee avatar. Read-only in editor. Re-fetches data on page load for live status.

**Serialization:** Custom directive syntax: `:::issue AXM-123:::`. Avoids collision with fenced code blocks. Requires custom markdown-it rule for parse (directive -> IssueEmbedBlock node) and serialize (node -> directive). Same pattern used by CalloutExtension and CollapsibleExtension for custom block types.

**Link management:** On insert, backend creates EMBED link. On removal from editor content, link cleaned up on next save via sync mechanism.

### Dev Panel "Wiki Pages" Section

`IssueDevelopmentCard.tsx` gains a new section: "Referenced in" showing wiki pages that link to the issue.

Uses `getLinksForIssue()`. Displays page title, space name, link type badge (mention vs embed). Clicking navigates to the wiki page.

## MCP Workflow Tools

Seven new tools completing three target agent workflows. All follow existing patterns: Zod schema validation, `assertMcpPermission()`, JSON responses.

### New Tools

| Tool | File | Input | Output | Workflows |
|------|------|-------|--------|-----------|
| `search_code` | repo-tools.ts | query, orgId, optional repoId/filePattern | Matching files + line snippets | Investigate, Review |
| `get_development_summary` | integration-tools.ts | projectId, issueNumber | Branches, commits, PRs, pipeline runs | Investigate, Review |
| `get_pr_diff` | repo-tools.ts | repoId, pullNumber | Unified diff string (truncated at 100KB with warning) | Review |
| `get_pr_comments` | repo-tools.ts | repoId, pullNumber | Comments with file/line context, threads | Review |
| `get_recent_merges` | repo-tools.ts | repoId, optional since (ISO date), limit | Recently merged PRs with linked issues | Doc sync |
| `list_wiki_issue_links` | integration-tools.ts | pageId or issueId (one required) | Links in either direction with type | All three |
| `link_wiki_to_issue` | integration-tools.ts | pageId, issueId, linkType | Created link record | Doc sync |

### MCP Permission Mappings

All 7 tools must be registered in `mcp-permissions.ts`:

| Tool | Permission |
|------|-----------|
| `search_code` | `repo:read` |
| `get_development_summary` | `issue:view` |
| `get_pr_diff` | `repo:read` |
| `get_pr_comments` | `repo:read` |
| `get_recent_merges` | `repo:read` |
| `list_wiki_issue_links` | `wiki:view` |
| `link_wiki_to_issue` | `wiki:edit` |

### New File: integration-tools.ts

Located at `src/mcp/tools/integration-tools.ts`. Cross-product tools that span modules: `get_development_summary`, `list_wiki_issue_links`, `link_wiki_to_issue`. Registered via `registerIntegrationTools(ctx)` in `createMcpServer()` alongside existing tool files.

### McpToolContext Helper

Add `getOrgIdFromPage(pageId)` to `src/mcp/tools/types.ts` following the existing pattern (page -> space -> team -> org). Used by `list_wiki_issue_links` and `link_wiki_to_issue` for permission checks.

### Git Infrastructure: search_code

`search_code` requires a new `grepFiles(repoPath, query, opts)` function in `src/git/git-search-commands.ts`. Wraps `git grep` with:
- Pattern search across repo at HEAD
- Optional file pattern filter (`-- '*.ts'`)
- Line number + context output
- Result limit to prevent huge responses

### Note on get_development_summary

Directly reuses `getDevelopmentSummary()` from `src/modules/issues/development-panel.service.ts` -- no reimplementation needed. The existing function already returns the exact shape the MCP tool needs.

### Note on get_pr_diff vs get_pull_request

`get_pull_request` returns PR metadata + diff stat summary. `get_pr_diff` returns the full unified diff (for agent code analysis). The diff is truncated at 100KB with a warning to avoid flooding MCP context.

### Discovery Chains

```
get_issue → get_development_summary → list_wiki_issue_links
get_pull_request → get_pr_diff + get_pr_comments
get_recent_merges → get_issue → update_wiki_page → link_wiki_to_issue
```

## Target Workflows

### Workflow 1: Investigate & Triage

Agent receives a bug report, searches code + issues + wiki for context, checks dev panel for related PRs/branches, creates/updates issue with findings.

```
search("login timeout error")           → finds issue AXM-45, wiki page "Auth Architecture"
get_issue(AXM-45)                       → status, assignee, priority
get_development_summary(AXM-45)         → 2 branches, 1 open PR, 3 commits
search_code("loginTimeout", repoId)     → hits in auth-middleware.ts:142
get_wiki_page("auth-architecture")      → design context
list_wiki_issue_links(issueId: AXM-45)  → linked wiki pages for background
→ Agent produces triage summary with full context
```

### Workflow 2: Code Review Context

Agent reviewing a PR pulls linked issues, wiki design docs, and related past PRs for informed feedback.

```
get_pull_request(PR #12)                → linked issues [AXM-45, AXM-51]
get_pr_diff(PR #12)                     → what changed
get_pr_comments(PR #12)                 → existing review threads
get_issue(AXM-45)                       → requirement context
get_development_summary(AXM-45)         → related PRs/branches
list_wiki_issue_links(AXM-45)           → design doc pages
get_wiki_page("auth-architecture")      → design spec to review against
→ Agent reviews PR with full issue + design + code context
```

### Workflow 3: Doc Sync (Human-Triggered)

Human asks agent to update wiki after merges. Agent finds what changed, updates docs, creates links.

```
get_recent_merges(repoId, since: "2026-03-25") → PR #12 merged, linked to AXM-45
get_issue(AXM-45)                               → resolved, auth timeout fix
list_wiki_issue_links(issueId: AXM-45)          → linked to "Auth Architecture" page
get_wiki_page("auth-architecture")               → current content
update_wiki_page(pageId, updated content)        → agent updates the doc
link_wiki_to_issue(pageId, AXM-45, MENTION)      → ensures link exists
→ Wiki stays current with merged code changes
```

## Scope Boundary

**In scope:**
- WikiPageIssueLink model + service + API routes
- IssueEmbedExtension for TipTap editor
- Slash command `/issue` for embed insertion
- Mention link extraction on page save
- Dev panel wiki pages section
- 7 new MCP tools
- integration-tools.ts MCP tool file
- `git grep` wrapper in `src/git/git-search-commands.ts`
- `getOrgIdFromPage` helper in MCP context
- MCP permission mappings for all 7 tools
- Real-time WebSocket event (`issue:development-updated`) on wiki-issue link changes so dev panel auto-refreshes via `useRealtimeInvalidation`
- Update MCP docs (axiom-mcp-server.md)

**Out of scope:**
- Generic macro/widget system
- Automated doc sync (webhooks/cron)
- MCP tools for board management, automation rules, or other non-workflow features
- Wiki-side issue list queries (filtering/sorting embedded issues)
- Issue embed blocks showing multiple issues from a query
