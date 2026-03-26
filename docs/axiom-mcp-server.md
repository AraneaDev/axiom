# Axiom MCP Server

Axiom exposes a Model Context Protocol (MCP) server that lets Claude interact with your projects, issues, repositories, wiki, and CI/CD pipelines directly -- without opening the browser.

## Connection

The MCP server runs alongside the Axiom API using SSE (Server-Sent Events) transport. All MCP endpoints require authentication.

|Endpoint|Method|Purpose|
|-|-|-|
|`/api/mcp`|GET|Open SSE stream (connect here)|
|`/api/mcp/messages`|POST|Send tool calls|

**Base URL (local dev):** `http://localhost:3000/api/mcp`

\---

## Claude Desktop Setup

Add the following to your `claude\_desktop\_config.json` (macOS: `\~/Library/Application Support/Claude/claude\_desktop\_config.json`):

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

\---

## Claude Code Setup

Run from your terminal:

```bash
claude mcp add axiom --transport sse http://localhost:3000/api/mcp \\
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

\---

## Available Tools (37)

### Organization (3 tools)

#### `list\_orgs`

List organizations the current user belongs to. No parameters required.

#### `list\_teams`

List teams in an organization.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`orgId`|string|yes|Organization ID|

#### `list\_projects`

List projects in a team.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`teamId`|string|yes|Team ID|

\---

### Issues \& Sprints (12 tools)

#### `list\_issues`

List issues in a project with optional filters.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`type`|`TASK\|BUG\|STORY\|EPIC`|no|Filter by type|
|`priority`|`CRITICAL\|HIGH\|MEDIUM\|LOW`|no|Filter by priority|
|`assigneeId`|string|no|Filter by assignee user ID|
|`limit`|number|no|Max results (default: 20)|

#### `get\_issue`

Get full details of a single issue including comments.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`issueNumber`|number|yes|Issue number (e.g. 42)|

#### `create\_issue`

Create a new issue in a project.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`title`|string|yes|Issue title|
|`body`|string|no|Markdown body|
|`type`|`TASK\|BUG\|STORY\|EPIC`|no|Default: `TASK`|
|`priority`|`CRITICAL\|HIGH\|MEDIUM\|LOW`|no|Default: `MEDIUM`|
|`assigneeId`|string|no|User ID to assign|

#### `update\_issue`

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

#### `delete\_issue`

Permanently delete an issue from a project.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`issueNumber`|number|yes|Issue number|

#### `add\_comment`

Add a comment to an issue.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`issueNumber`|number|yes|Issue number|
|`body`|string|yes|Comment text (markdown)|

#### `list\_sprints`

List sprints for a project.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`status`|`PLANNING\|ACTIVE\|COMPLETED`|no|Filter by status|

#### `get\_sprint`

Get a sprint with all its issues.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`sprintId`|string|yes|Sprint ID|

#### `create\_sprint`

Create a new sprint in PLANNING status.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`projectId`|string|yes|Project ID|
|`name`|string|yes|Sprint name|
|`startDate`|string|no|ISO date string|
|`endDate`|string|no|ISO date string|

#### `start\_sprint`

Start a sprint (PLANNING -> ACTIVE). Only one active sprint per project is allowed.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`sprintId`|string|yes|Sprint ID|

#### `complete\_sprint`

Complete an active sprint. Incomplete issues can be moved to another sprint or backlog.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`sprintId`|string|yes|Sprint ID|
|`incompleteIssueDestination`|`backlog\|next\_sprint`|no|Where to move incomplete issues|

#### `add\_issues\_to\_sprint`

Add one or more issues to a sprint.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`sprintId`|string|yes|Sprint ID|
|`issueIds`|string\[]|yes|Array of issue IDs|

\---

### Repositories \& Git (9 tools)

#### `list\_repos`

List repositories in a team.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`teamId`|string|yes|Team ID|

#### `browse\_files`

List files and directories at a path in a repository.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`ref`|string|no|Branch, tag, or SHA (default: `HEAD`)|
|`path`|string|no|Directory path (default: root)|

#### `read\_file`

Read the contents of a file at a given ref.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`filePath`|string|yes|Path to file|
|`ref`|string|no|Branch, tag, or SHA (default: `HEAD`)|

#### `get\_commits`

Get recent commits on a branch or ref.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`ref`|string|no|Branch, tag, or SHA (default: `HEAD`)|
|`limit`|number|no|Max commits (default: 10)|

#### `get\_branches`

List all branches in a repository.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|

#### `list\_branches`

List all branches with their latest commit info.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|

#### `get\_diff`

Get a diff between two refs.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`base`|string|yes|Base branch/tag/SHA|
|`head`|string|yes|Head branch/tag/SHA|

\---

### Pull Requests (4 tools)

#### `list\_pull\_requests`

List pull requests in a repository.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`status`|`OPEN\|MERGED\|CLOSED`|no|Filter by status|

#### `create\_pull\_request`

Open a new pull request.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`title`|string|yes|PR title|
|`sourceBranch`|string|yes|Branch with changes|
|`targetBranch`|string|yes|Branch to merge into|
|`body`|string|no|PR description (markdown)|

#### `get\_pull\_request`

Get details of a specific pull request including diff stats.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`pullNumber`|number|yes|PR number|

#### `merge\_pull\_request`

Merge an open pull request.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`pullNumber`|number|yes|PR number|
|`strategy`|`merge\|squash\|rebase`|no|Merge strategy (default: `merge`)|

\---

### CI/CD \& Releases (4 tools)

#### `list\_pipelines`

List CI/CD pipelines for a repository.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|

#### `trigger\_pipeline`

Trigger a CI/CD pipeline run on a specific git ref.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`pipelineId`|string|yes|Pipeline ID|
|`ref`|string|yes|Branch, tag, or SHA to run against|

#### `list\_releases`

List releases for a repository.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`draft`|boolean|no|Filter to draft releases|
|`prerelease`|boolean|no|Filter to prereleases|

#### `create\_release`

Create a new release with a tag name and target branch.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`repoId`|string|yes|Repository ID|
|`tagName`|string|yes|Tag name (e.g. `v1.2.0`)|
|`targetBranch`|string|yes|Branch to tag|
|`name`|string|no|Release title|
|`body`|string|no|Release notes (markdown)|
|`draft`|boolean|no|Save as draft|
|`prerelease`|boolean|no|Mark as prerelease|

\---

### Wiki (6 tools)

#### `list\_wiki\_spaces`

List all wiki spaces for a team.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`teamId`|string|yes|Team ID|

#### `get\_wiki\_page`

Get a wiki page by its space and slug.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`spaceId`|string|yes|Wiki space ID|
|`pageSlug`|string|yes|Page URL slug|

#### `create\_wiki\_page`

Create a new wiki page in a space.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`spaceId`|string|yes|Wiki space ID|
|`title`|string|yes|Page title|
|`slug`|string|yes|URL-friendly slug (e.g. `getting-started`)|
|`body`|string|no|Markdown content|
|`parentId`|string|no|Parent page ID for nesting|

#### `update\_wiki\_page`

Update an existing wiki page's title and/or body.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`pageId`|string|yes|Page ID|
|`title`|string|no|New title|
|`body`|string|no|New body (markdown)|

#### `delete\_wiki\_page`

Permanently delete a wiki page from a space.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`pageId`|string|yes|Page ID|

#### `get\_page\_tree`

Get the full nested page tree for a wiki space.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`spaceId`|string|yes|Wiki space ID|

\---

### Search (1 tool)

#### `search`

Search across issues and wiki pages by keyword.

|Parameter|Type|Required|Description|
|-|-|-|-|
|`query`|string|yes|Search keyword(s)|
|`type`|`issues\|wiki\|all`|no|Scope (default: `all`)|
|`limit`|number|no|Max results (default: 10)|

\---

## Discovery Chain

Most tools require IDs (`projectId`, `teamId`, etc.). Use this chain to find them:

```
list\_orgs()                  -> get orgId
list\_teams(orgId)            -> get teamId
list\_projects(teamId)        -> get projectId
list\_issues(projectId)       -> work with issues

list\_teams(orgId)            -> get teamId
list\_wiki\_spaces(teamId)     -> get spaceId
get\_page\_tree(spaceId)       -> navigate pages

list\_teams(orgId)            -> get teamId
list\_repos(teamId)           -> get repoId
browse\_files(repoId)         -> explore code
```

\---

## Example Workflows

### Triage open bugs

```
1. list\_orgs() -> find your org
2. list\_teams(orgId) -> find the target team
3. list\_projects(teamId) -> find the project
4. list\_issues(projectId, type: "BUG") -> list all bugs
5. get\_issue(projectId, issueNumber) -> inspect each one
6. update\_issue(projectId, issueNumber, priority: "HIGH") -> reprioritize
7. add\_comment(projectId, issueNumber, body: "...") -> leave triage notes
```

### Sprint planning

```
1. list\_projects(teamId) -> find project
2. list\_sprints(projectId, status: "PLANNING") -> find upcoming sprint
3. list\_issues(projectId) -> find backlog issues
4. add\_issues\_to\_sprint(sprintId, issueIds) -> populate sprint
5. start\_sprint(sprintId) -> kick off the sprint
```

### Write and publish a runbook

```
1. list\_teams(orgId) -> find the Infra team
2. list\_wiki\_spaces(teamId) -> find the Runbooks space
3. get\_page\_tree(spaceId) -> see existing pages
4. create\_wiki\_page(spaceId, title, slug, body) -> publish the doc
```

### Review and merge a pull request

```
1. list\_repos(teamId) -> find the repo
2. list\_pull\_requests(repoId, status: "OPEN") -> find open PRs
3. get\_pull\_request(repoId, pullNumber) -> review diff stats
4. get\_diff(repoId, base, head) -> read the full diff
5. read\_file(repoId, filePath, ref) -> inspect specific files
6. merge\_pull\_request(repoId, pullNumber, strategy: "squash") -> merge
```

### Bulk issue creation from a spec

```
1. search(query: "v2 spec", type: "wiki") -> find the spec page
2. get\_wiki\_page(spaceId, pageSlug) -> read requirements
3. list\_projects(teamId) -> find target project
4. create\_issue(...) x N -> create one issue per requirement
```

### Create a release

```
1. list\_repos(teamId) -> find the repo
2. list\_pipelines(repoId) -> verify CI is green
3. create\_release(repoId, tagName: "v1.0.0", targetBranch: "main", body: "...") -> publish
```

\---

## Known Limitations

* **Creator attribution**: Issues, comments, wiki pages, and other resources created via MCP are attributed to the authenticated user whose token is used to connect.
* **Single SSE connection**: The server supports one active SSE connection at a time. Reconnecting replaces the previous session.

