# Axiom MCP Server — Claude Integration Guide

Axiom exposes a Model Context Protocol (MCP) server that lets Claude interact with your projects, issues, wiki, and repositories directly — without opening the browser.

## Connection

The MCP server runs alongside the Axiom API using SSE (Server-Sent Events) transport.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/mcp` | GET | Open SSE stream (connect here) |
| `/api/mcp/messages` | POST | Send tool calls |

**Base URL (local dev):** `http://localhost:3000/api/mcp`

> **Security note:** The MCP endpoints are currently unauthenticated. Only expose the Axiom API on localhost or a private network. Do not deploy with the MCP endpoint publicly accessible.

---

## Claude Desktop Setup

Add the following to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "axiom": {
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

Restart Claude Desktop. You should see "axiom" appear in the MCP servers panel.

---

## Claude Code Setup

Run from your terminal:

```bash
claude mcp add axiom --transport sse http://localhost:3000/api/mcp
```

Or add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "axiom": {
      "type": "sse",
      "url": "http://localhost:3000/api/mcp"
    }
  }
}
```

---

## Available Tools (18)

### Issues

#### `list_issues`
List issues in a project with optional filters.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectId` | string | yes | Project ID |
| `type` | `TASK\|BUG\|STORY\|EPIC` | no | Filter by type |
| `priority` | `CRITICAL\|HIGH\|MEDIUM\|LOW` | no | Filter by priority |
| `assigneeId` | string | no | Filter by assignee user ID |
| `limit` | number | no | Max results (default: 20) |

**Example prompt:** "List all open bugs in project `<projectId>`"

---

#### `get_issue`
Get full details of a single issue including comments.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectId` | string | yes | Project ID |
| `issueNumber` | number | yes | Issue number (e.g. 42) |

**Example prompt:** "Get issue #12 from project `<projectId>`"

---

#### `create_issue`
Create a new issue. Created issues are attributed to the org owner.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectId` | string | yes | Project ID |
| `title` | string | yes | Issue title |
| `body` | string | no | Markdown body (default: empty) |
| `type` | `TASK\|BUG\|STORY\|EPIC` | no | Default: `TASK` |
| `priority` | `CRITICAL\|HIGH\|MEDIUM\|LOW` | no | Default: `MEDIUM` |
| `assigneeId` | string | no | User ID to assign |

**Example prompt:** "Create a BUG issue titled 'Login fails on Safari' in project `<projectId>`"

---

#### `add_comment`
Add a comment to an issue. Attributed to the org owner.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `projectId` | string | yes | Project ID |
| `issueNumber` | number | yes | Issue number |
| `body` | string | yes | Comment text (markdown) |

**Example prompt:** "Add a comment to issue #5 saying the fix is in progress"

---

### Wiki

#### `list_wiki_spaces`
List all wiki spaces for a team.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `teamId` | string | yes | Team ID |

---

#### `get_wiki_page`
Get a wiki page by its space and slug.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `spaceId` | string | yes | Wiki space ID |
| `pageSlug` | string | yes | Page URL slug |

**Example prompt:** "Get the 'architecture' page from space `<spaceId>`"

---

#### `create_wiki_page`
Create a new wiki page in a space.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `spaceId` | string | yes | Wiki space ID |
| `title` | string | yes | Page title |
| `slug` | string | yes | URL-friendly slug (e.g. `getting-started`) |
| `body` | string | no | Markdown content |
| `parentId` | string | no | Parent page ID for nesting |

**Example prompt:** "Create a wiki page titled 'Deployment Guide' in space `<spaceId>` with the following content: ..."

---

#### `get_page_tree`
Get the full nested page tree for a wiki space.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `spaceId` | string | yes | Wiki space ID |

---

### Teams & Projects

#### `list_teams`
List all teams in an organization.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `orgId` | string | yes | Organization ID |

---

#### `list_projects`
List all projects in a team.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `teamId` | string | yes | Team ID |

---

### Repositories

#### `list_repos`
List repositories in a team.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `teamId` | string | yes | Team ID |

---

#### `browse_files`
List files and directories at a path in a repository.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `repoId` | string | yes | Repository ID |
| `ref` | string | no | Branch, tag, or SHA (default: `HEAD`) |
| `path` | string | no | Directory path (default: root) |

**Example prompt:** "Show me the files in the `src/` directory of repo `<repoId>`"

---

#### `read_file`
Read the contents of a file at a given ref.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `repoId` | string | yes | Repository ID |
| `ref` | string | no | Branch, tag, or SHA (default: `HEAD`) |
| `filePath` | string | yes | Path to file |

**Example prompt:** "Read `src/index.ts` from repo `<repoId>` on the `main` branch"

---

#### `get_commits`
Get recent commits on a branch.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `repoId` | string | yes | Repository ID |
| `ref` | string | no | Branch, tag, or SHA (default: `HEAD`) |
| `limit` | number | no | Max commits (default: 10) |

---

#### `get_branches`
List all branches in a repository.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `repoId` | string | yes | Repository ID |

---

#### `get_diff`
Get a diff between two refs.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `repoId` | string | yes | Repository ID |
| `base` | string | yes | Base branch/tag/SHA |
| `head` | string | yes | Head branch/tag/SHA |

**Example prompt:** "Show the diff between `main` and `feature/auth` in repo `<repoId>`"

---

#### `list_pull_requests`
List pull requests in a repository.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `repoId` | string | yes | Repository ID |
| `status` | `OPEN\|MERGED\|CLOSED` | no | Filter by status |

---

### Search

#### `search`
Search across issues and wiki pages by keyword.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | yes | Search keyword(s) |
| `type` | `issues\|wiki\|all` | no | Scope (default: `all`) |
| `limit` | number | no | Max results (default: 10) |

**Example prompt:** "Search for anything related to 'authentication' across issues and wiki"

---

## Finding IDs

Most tools require IDs (`projectId`, `teamId`, etc.). Use this discovery chain:

```
1. list_teams(orgId)        → get teamId
2. list_projects(teamId)    → get projectId
3. list_issues(projectId)   → work with issues

1. list_teams(orgId)        → get teamId
2. list_wiki_spaces(teamId) → get spaceId
3. get_page_tree(spaceId)   → navigate pages

1. list_teams(teamId)       → get teamId
2. list_repos(teamId)       → get repoId
3. browse_files(repoId)     → explore code
```

You need the `orgId` to start. Find it in the Axiom UI: Settings > Organization, or inspect the network tab when the dashboard loads.

---

## Example Workflows

### Triage open bugs
```
1. list_teams(orgId) → find the Core team
2. list_projects(teamId) → find the Platform project
3. list_issues(projectId, type: "BUG") → list all bugs
4. get_issue(projectId, issueNumber) → inspect each one
5. add_comment(projectId, issueNumber, ...) → leave triage notes
```

### Write and publish a runbook
```
1. list_teams(orgId) → find the Infra team
2. list_wiki_spaces(teamId) → find the Runbooks space
3. get_page_tree(spaceId) → see existing pages
4. create_wiki_page(spaceId, title, slug, body) → publish the doc
```

### Review a pull request diff
```
1. list_repos(teamId) → find the repo
2. list_pull_requests(repoId, status: "OPEN") → find open PRs
3. get_diff(repoId, base, head) → read the diff
4. read_file(repoId, ref, filePath) → inspect specific files
```

### Bulk issue creation from a spec
```
1. search(query: "v2 spec", type: "wiki") → find the spec page
2. get_wiki_page(spaceId, pageSlug) → read requirements
3. list_projects(teamId) → find target project
4. create_issue(...) × N → create one issue per requirement
```

---

## Known Limitations

- **No authentication**: MCP endpoints accept any request. Keep Axiom on localhost or a private network.
- **Creator attribution**: Issues, comments, and wiki pages created via MCP are attributed to the first org OWNER, not the calling user.
- **No issue updates**: There is no `update_issue` tool. Status changes must be made through the Axiom UI.
- **Single SSE connection**: The server supports one active SSE connection at a time. Reconnecting replaces the previous session.
