# Axiom MCP Server

Axiom exposes a Model Context Protocol (MCP) server that lets Claude interact with your projects, issues, sprints, and wiki directly, without opening the browser.

## Connection

The MCP server runs alongside the Axiom API using SSE (Server-Sent Events) transport. All MCP endpoints require authentication.

|Endpoint|Method|Purpose|
|-|-|-|
|`/api/mcp`|GET|Open SSE stream (connect here)|
|`/api/mcp/messages`|POST|Send tool calls|

**Base URL (local dev):** `http://localhost:3000/api/mcp`

---

## Claude Desktop Setup

Add the following to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "axiom": {
      "type": "sse",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-access-token>"
      }
    }
  }
}
```

Restart Claude Desktop. You should see "axiom" appear in the MCP servers panel.

---

## Claude Code Setup

Run from your terminal:

```bash
claude mcp add axiom --transport sse http://localhost:3000/api/mcp \
  --header "Authorization: Bearer <your-access-token>"
```

Or add to your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "axiom": {
      "type": "sse",
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-access-token>"
      }
    }
  }
}
```

Obtain an access token by calling `POST /api/auth/login` with your Axiom credentials.

---

## Available Tools (24)

### Organization (3 tools)

#### `list_orgs`

List organizations the current user belongs to. No parameters required.

#### `list_teams`

List teams in an organization.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`orgId`|string|yes|Organization ID|

#### `list_projects`

List projects in a team.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`teamId`|string|yes|Team ID|

---

### Issues & Sprints (12 tools)

#### `list_issues`

List issues in a project with optional filters.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`type`|`TASK\|BUG\|STORY\|EPIC`|no|Filter by type|
|`priority`|`CRITICAL\|HIGH\|MEDIUM\|LOW`|no|Filter by priority|
|`assigneeId`|string|no|Filter by assignee user ID|
|`limit`|number|no|Max results (default: 20)|
|`query`|string|no|Structured query string for filtering issues. Supports hybrid syntax: simple mode (`type:bug priority:high assignee:@me`) and complex mode (`type = Bug AND (priority > Medium OR storyPoints > 5)`). When provided, takes precedence over individual filter params.|

Example: `list_issues(projectId, query: "type:bug priority:high assignee:@me")`

#### `get_issue`

Get full details of a single issue including comments.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`issueNumber`|number|yes|Issue number (e.g. 42)|

#### `create_issue`

Create a new issue in a project.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`title`|string|yes|Issue title|
|`body`|string|no|Markdown body|
|`type`|`TASK\|BUG\|STORY\|EPIC`|no|Default: `TASK`|
|`priority`|`CRITICAL\|HIGH\|MEDIUM\|LOW`|no|Default: `MEDIUM`|
|`assigneeId`|string|no|User ID to assign|

#### `update_issue`

Update an existing issue's status, priority, assignee, labels, story points, or sprint.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`issueNumber`|number|yes|Issue number|
|`columnId`|string|no|Board column ID (moves status)|
|`priority`|`CRITICAL\|HIGH\|MEDIUM\|LOW`|no|New priority|
|`assigneeId`|string|no|New assignee user ID|
|`storyPoints`|number|no|Story point estimate|
|`sprintId`|string|no|Move to sprint|

#### `delete_issue`

Permanently delete an issue from a project.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`issueNumber`|number|yes|Issue number|

#### `add_comment`

Add a comment to an issue.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`issueNumber`|number|yes|Issue number|
|`body`|string|yes|Comment text (markdown)|

#### `list_sprints`

List sprints for a project.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`status`|`PLANNING\|ACTIVE\|COMPLETED`|no|Filter by status|

#### `get_sprint`

Get a sprint with all its issues.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`sprintId`|string|yes|Sprint ID|

#### `create_sprint`

Create a new sprint in PLANNING status.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`name`|string|yes|Sprint name|
|`startDate`|string|no|ISO date string|
|`endDate`|string|no|ISO date string|

#### `start_sprint`

Start a sprint (PLANNING -> ACTIVE). Only one active sprint per project is allowed.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`sprintId`|string|yes|Sprint ID|

#### `complete_sprint`

Complete an active sprint. Incomplete issues can be moved to another sprint or backlog.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`sprintId`|string|yes|Sprint ID|
|`incompleteIssueDestination`|`backlog\|next_sprint`|no|Where to move incomplete issues|

#### `add_issues_to_sprint`

Add one or more issues to a sprint.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`sprintId`|string|yes|Sprint ID|
|`issueIds`|string\[]|yes|Array of issue IDs|

---

### Wiki (6 tools)

#### `list_wiki_spaces`

List all wiki spaces for a team.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`teamId`|string|yes|Team ID|

#### `get_wiki_page`

Get a wiki page by its space and slug.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`spaceId`|string|yes|Wiki space ID|
|`pageSlug`|string|yes|Page URL slug|

#### `create_wiki_page`

Create a new wiki page in a space.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`spaceId`|string|yes|Wiki space ID|
|`title`|string|yes|Page title|
|`slug`|string|yes|URL-friendly slug (e.g. `getting-started`)|
|`body`|string|no|Markdown content|
|`parentId`|string|no|Parent page ID for nesting|
|`templateId`|string|no|Create page from a template with auto-resolved variables. Template variables like `{{currentUser.displayName}}`, `{{team.name}}`, `{{now()}}` are resolved using the requesting user's context. If both `body` and `templateId` are provided, `body` wins.|

#### `update_wiki_page`

Update an existing wiki page's title and/or body.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`pageId`|string|yes|Page ID|
|`title`|string|no|New title|
|`body`|string|no|New body (markdown)|

#### `delete_wiki_page`

Permanently delete a wiki page from a space.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`pageId`|string|yes|Page ID|

#### `get_page_tree`

Get the full nested page tree for a wiki space.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`spaceId`|string|yes|Wiki space ID|

---

### Search (1 tool)

#### `search`

Search across issues and wiki pages by keyword.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`query`|string|yes|Search keyword(s)|
|`type`|`issues\|wiki\|all`|no|Scope (default: `all`)|
|`limit`|number|no|Max results (default: 10)|

---

### Cross-Product Integration (2 tools)

#### `list_wiki_issue_links`

List all wiki pages linked to a specific issue, or all issues linked to a specific wiki page.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`issueId`|string|conditional|Issue ID (provide this or `pageId`)|
|`pageId`|string|conditional|Wiki page ID (provide this or `issueId`)|

Example: `list_wiki_issue_links(issueId: "abc-123")`

#### `link_wiki_to_issue`

Create a bidirectional link between a wiki page and an issue for traceability.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`pageId`|string|yes|Wiki page ID|
|`issueId`|string|yes|Issue ID|

Example: `link_wiki_to_issue(pageId: "page-1", issueId: "issue-1")`

---

## Query Language

The `query` parameter on `list_issues` accepts a hybrid syntax that covers both quick shorthand and expressive boolean expressions.

**Simple mode** -- space-separated `field:value` pairs, implicitly ANDed:

```
type:bug
priority:high,critical
assignee:@me
status:in-progress
```

**Complex mode** -- explicit operators and grouping:

```
type = Bug AND (priority > Medium OR storyPoints > 5)
created > now(-7d) AND status != Done
assignee = @me AND sprint = active
```

Simple and complex syntax can be combined in the same string. For full operator and field reference see [api-reference.md](api-reference.md#query-language-reference).

**Example MCP calls:**

```
list_issues(projectId, query: "type:bug priority:high,critical assignee:@me")
list_issues(projectId, query: "created > now(-7d) AND status != Done")
```

---

## Discovery Chain

Most tools require IDs (`projectId`, `teamId`, etc.). Use this chain to find them:

```
list_orgs()                  -> get orgId
list_teams(orgId)            -> get teamId
list_projects(teamId)        -> get projectId
list_issues(projectId)       -> work with issues

list_teams(orgId)            -> get teamId
list_wiki_spaces(teamId)     -> get spaceId
get_page_tree(spaceId)       -> navigate pages
```

---

## Example Workflows

### Triage open bugs

```
1. list_orgs() -> find your org
2. list_teams(orgId) -> find the target team
3. list_projects(teamId) -> find the project
4. list_issues(projectId, type: "BUG") -> list all bugs
5. get_issue(projectId, issueNumber) -> inspect each one
6. update_issue(projectId, issueNumber, priority: "HIGH") -> reprioritize
7. add_comment(projectId, issueNumber, body: "...") -> leave triage notes
```

### Sprint planning

```
1. list_projects(teamId) -> find project
2. list_sprints(projectId, status: "PLANNING") -> find upcoming sprint
3. list_issues(projectId) -> find backlog issues
4. add_issues_to_sprint(sprintId, issueIds) -> populate sprint
5. start_sprint(sprintId) -> kick off the sprint
```

### Write and publish a runbook

```
1. list_teams(orgId) -> find the Infra team
2. list_wiki_spaces(teamId) -> find the Runbooks space
3. get_page_tree(spaceId) -> see existing pages
4. create_wiki_page(spaceId, title, slug, body) -> publish the doc
```

### Bulk issue creation from a spec

```
1. search(query: "v2 spec", type: "wiki") -> find the spec page
2. get_wiki_page(spaceId, pageSlug) -> read requirements
3. list_projects(teamId) -> find target project
4. create_issue(...) x N -> create one issue per requirement
```

### Create a wiki page from a template

```
1. list_wiki_spaces(teamId) -> get spaceId
2. create_wiki_page(spaceId, title: "Sprint Retro", slug: "sprint-retro-26", templateId: "...") -> page created with resolved variables (currentUser, team, now() etc.)
```

### Investigate and triage

```
search("login timeout error") -> get_issue(AXM-45) -> list_wiki_issue_links(issueId) -> get_wiki_page(related runbook)
```

---

## Known Limitations

* **Creator attribution**: Issues, comments, wiki pages, and other resources created via MCP are attributed to the authenticated user whose token is used to connect.
* **Single SSE connection**: The server supports one active SSE connection at a time. Reconnecting replaces the previous session.

