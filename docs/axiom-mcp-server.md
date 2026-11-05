# Axiom MCP server

Axiom has an MCP server so your agents work in the same projects you do. It has five tools. They cover the developer loop: issues, comments, worklogs, links, attachments, wiki pages, sprints and the org, team and project reads, so an agent finishes a ticket in one or two calls instead of ten. The rest of the API (forms, automation, labels, milestones, custom fields, templates, board columns, notifications, administration) follows in later work and isn't reachable through `act` yet.

## Connection

The server speaks Streamable HTTP, stateless, at `POST /api/mcp`. `GET` and `DELETE` answer `405`. Legacy SSE and the 24 separate tools of the earlier server are gone.

| What            | Value                                                                  |
| --------------- | ---------------------------------------------------------------------- |
| URL (local dev) | `http://localhost:3000/api/mcp`                                        |
| Transport       | `http` (Streamable HTTP)                                               |
| Header          | `Authorization: Token tk_...`                                          |
| Body            | One JSON-RPC message per request, `Content-Type: application/json`     |
| Accept          | `application/json, text/event-stream`; without it a POST answers `406` |

The endpoint takes API tokens only. A session or JWT gets `401 TOKEN_REQUIRED`. That is on purpose: every write an agent makes is recorded with the name of its token as `via`, so your history shows what you did and what an agent did.

A browser request must come from an allowed origin (`CORS_ORIGIN` or `FRONTEND_URL`, else localhost only); an agent sends no `Origin` and is unaffected.

### Create a token

In Axiom open Settings, API tokens, and create one. Name it after the agent (`claude-code`, `codex`), since that name becomes `via`. A new token starts with `search:read`, `issues:read`, `wiki:read` and `files:read`, which is what `search` and `read` need. Add the write scopes the agent should have, below. Over REST: `POST /api/users/me/tokens` with `{ "name": "claude-code", "scopes": ["search:read", "issues:write", "wiki:write", "files:write"] }`. The token is shown once.

## Setup

### Claude Code

```bash
claude mcp add --transport http axiom http://localhost:3000/api/mcp \
  --header "Authorization: Token tk_..."
```

Or in `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "axiom": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Token ${AXIOM_TOKEN}" }
    }
  }
}
```

### Codex

Codex sends `--bearer-token-env-var` as `Bearer ...`, which Axiom does not accept for API tokens. Put the whole header value in an environment variable and map it in `~/.codex/config.toml`:

```bash
export AXIOM_AUTH="Token tk_..."
```

```toml
[mcp_servers.axiom]
url = "http://localhost:3000/api/mcp"
env_http_headers = { Authorization = "AXIOM_AUTH" }
```

## The five tools

| Tool       | Does                                                                                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`   | Free text plus filters (`type:bug`, `status:done`, `assignee:name`) over issues and pages you can open. A page titled exactly the query comes first. Arguments: `query`, `type` (`issues`, `wiki`, `all`), `limit` (1 to 100). Results carry the key to pass to `read` |
| `read`     | Open issues and pages by key, with what belongs to them                                                                                                                                                                                                                |
| `describe` | Without `action`: the names and summaries of what your token allows, optionally for one `area`. With `action`: its input and output as JSON Schema                                                                                                                     |
| `act`      | Run an action, or a batch of up to 25                                                                                                                                                                                                                                  |
| `upload`   | Add a file                                                                                                                                                                                                                                                             |

### Keys

`read` and `act` take keys, so an agent never needs an internal id.

| Key                        | Names                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AXM-42`                   | An issue. If projects you can see in several teams share the prefix, `409 AMBIGUOUS_KEY` lists the full keys |
| `org/team/AXM-42`          | An issue, exactly                                                                                            |
| `org/team/space/page-slug` | A page                                                                                                       |
| a URL or site path         | The issue or page it shows. Only the path counts and nothing is fetched                                      |
| `org/team/space`           | A space, for `act` actions that work in a space such as `page.create`                                        |
| `AXM` or `org/team/AXM`    | A project, for `act` actions that work in a project such as `issue.create` and `sprint.create`               |

Something you can't see answers exactly like something that doesn't exist (`404 NOT_FOUND`), and a key the action can't take answers `400 KEY_NOT_ACCEPTED`. A key that disagrees with ids in `input` answers `400 KEY_CONFLICT`.

### read

```json
{
  "keys": ["AXM-42", "acme/core/docs/design"],
  "include": ["comments", "links", "attachments", "pages"]
}
```

Up to 50 keys per call. Each key answers for itself: `{ key, kind, data }` or `{ key, error }`. `include` adds, per item:

- Issue: `comments`, `links`, `webLinks`, `attachments`, `history`, `worklogs`, `children`, `pages` (linked pages and pages whose body mentions the key).
- Page: `children`, `attachments`, `history`, `labels`, `linkedIssues`, `comments`.

Each include is `{ items, limit, truncated }`. `fields` narrows the base item and `commentBodies: false` leaves comment bodies out. A call returns at most 10 MB; items past it answer `413 RESPONSE_TOO_LARGE`. Per item you need `issues:read` or `wiki:read` on top of `search:read`. See the [API reference](api-reference.md#post-apiread) for every field.

### act

One action:

```json
{ "action": "issue.update", "key": "AXM-42", "input": { "status": "Done" } }
```

`status` is a column name, so an agent never looks up a column id. Input is strict: an unknown field is a `400`, not silently ignored. Use `describe` to see the exact input.

A batch runs in order and stops at the first failure:

```json
{
  "batch": [
    { "action": "issue.update", "key": "AXM-42", "input": { "status": "Done" } },
    { "action": "comment.add", "key": "AXM-42", "input": { "body": "Shipped in the PR" } },
    { "action": "worklog.add", "key": "AXM-42", "input": { "minutes": 30 } },
    {
      "action": "issueWebLink.add",
      "key": "AXM-42",
      "input": { "url": "https://github.com/acme/axiom/pull/7" }
    }
  ]
}
```

The answer is `{ results, completed }`, one result per item: `{ ok: true, result }`, `{ ok: false, error }` or `{ ok: false, skipped: true }`. If any item failed the tool answers with `isError: true`, though what already ran stays done. A batch is no transaction. Each item is authorized on its own.

### upload

Two ways, both ending with a file that is staged or attached:

1. **From a URL.** `{ "url": "https://example.com/shot.png", "target": "AXM-42" }` fetches a public HTTPS URL.
2. **From disk.** `{ "filename": "shot.png", "mimeType": "image/png", "size": 4096 }` answers a signed `uploadUrl`, an `attachmentUrl` and the exact line to run:

```bash
curl -X PUT -H 'Content-Type: image/png' --data-binary @shot.png 'http://localhost:3000/api/uploads/...?sig=...'
```

The `Content-Type` must be the `mimeType` you gave. The URL works once, for 10 minutes, and takes no other credential.

`target` is a key (`AXM-42`, `org/team/space/page-slug`) or an object such as `{ pageKey }`. Without one the file is staged and visible to you only. It joins an issue or page when a body references `attachmentUrl`, for example `![shot](/api/attachments/...)` in a `page.create` body. Staged files are removed after 24 hours. Put a screenshot in a wiki page in two tool calls: `upload`, then `act` with `page.create`, a `key` of the space, and an `input` with `title`, `slug` (lower-case letters, digits and hyphens) and `body`.

The URL in the answer is built from `FRONTEND_URL` when it is set, so set it when you reach Axiom through a tunnel or proxy, and set `TRUST_PROXY` to match.

## Queries, sprints and dashboards

Four groups of actions answer questions about your work. Run `describe` for the exact input of each; the full syntax is in the [API reference](api-reference.md#clauses).

### query.run

`act` with `query.run` runs a query over every issue you can see and returns items, or groups with counts and sums:

```json
{
  "action": "query.run",
  "input": {
    "query": "SELECT COUNT, SUM(storypoints) WHERE type = Bug AND done = false GROUP BY status ORDER BY status"
  }
}
```

```
[SELECT COUNT, SUM(storypoints), AVG(storypoints)] [WHERE] condition [GROUP BY field, field] [ORDER BY field [ASC|DESC], ...]
```

- Clause keywords are exact uppercase. `order by` in lower case is text.
- New fields in the condition: `blocked`, `blocks`, `linked = AXM-12`, `text ~ "login"`, `done`, `sprintstate` and custom fields as `cf.Name` or `cf."Name with spaces"`. `assignee`, `creator`, `sprint` and `project` also match a username, sprint name or project prefix.
- Sort by `type`, `status`, `priority`, `assignee`, `creator`, `sprint`, `project`, `storypoints`, `created`, `updated`, `duedate`, `number`, `title`, `done` or `sprintstate`. Not by `label`, `blocked`, `blocks`, `linked`, `text` or custom fields. Status sorts by column name. Priority sorts by rank, so `DESC` gives `CRITICAL` first. Without `ORDER BY`, the last updated come first.
- Empty values: `storypoints` and `duedate` sort last in both directions. For `assignee`, `creator`, `sprint` and `sprintstate` the database default holds: last ascending, first descending.
- Group by one or two of `type`, `status`, `priority`, `assignee`, `creator`, `sprint`, `project`, `done` and `sprintstate`. `status` groups by column name, across projects. Sum and average take `storypoints` only. A grouped query can order only by its grouped fields, not by `count`, `sum` or `avg`; groups come largest first.
- Text next to a comparison (`type = Bug login`) is a substring match on title and body. That differs from `search.run`, which ranks by relevance.
- Items come in pages: `limit` (up to 500), `nextCursor` and `cursor`. A grouped query answers in one page, `total` counts every issue in the groups and `truncated` says `limit` cut some off. `fields` narrows the items, and `scope` (`orgId`, `teamId`, `projectId`) narrows the query.
- Your access applies before any sort, group or total. Needs `search:read` and `issues:read`.

`search.run` with a clause query (`SELECT`, `WHERE`, `GROUP BY` or `ORDER BY` in capitals) answers as `query.run`. It returns issues only: wiki pages are not searched, also with `type: all`.

### sprint.overview

`sprint.overview` shows the active sprints of every project you can open, or the planning ones with `state: "PLANNING"`: issues total, done, in progress and to do, points committed and done, days left, and the issues that are blocked with what blocks them (a blocker you cannot open shows as hidden). It needs `sprints:read`.

In progress is a heuristic on the column name: a column that is neither done nor the default counts when its name contains "progress", "review", "ontwikkeling" or "testen". Custom names land in to do. A sprint that is still `PLANNING` has no commitment, so its whole scope counts as committed.

### Saved queries

`savedQuery.create` stores a query under a name (`text`, with `projectId` optional), and `savedQuery.list`, `get`, `update`, `delete` and `run` manage and use it. A query is private unless you give `visibility` `TEAM` (with `teamId`) or `ORG` (with `orgId`) and belong to that team or org. The creator may change or delete it; for `TEAM` also the team's admins, for `ORG` the org's owners and admins. Whoever opens a shared query runs it with their own rights, so it can show them less than it showed you. One you cannot see answers `404`. It needs `dashboards:read` or `dashboards:write`, and `issues:read` to run.

### Dashboards

`dashboard.create` makes a dashboard, shared like a saved query, and `dashboardWidget.add` fills it: `COUNT`, `TABLE`, `LIST`, `BAR` (a query with `GROUP BY`) or `SPRINT_OVERVIEW`, each with `savedQueryId` or `query`. A dashboard holds at most 24 widgets. `dashboard.render` returns every widget with its result, evaluated with your own rights. A widget that fails has `{ error }` and the others still render. A render runs 4 widgets at once and is limited to 60 per minute. In the UI an open dashboard updates itself after changes in the projects it reads.

### Wiki blocks

A body line `:::query <target>:::` embeds live results in a page, where the target is a saved query id, `dashboard:<id>` or `inline:"<query>"` (JSON-quoted). Anyone who can read the page sees the block with their own rights, also without access to the dashboard or saved query itself, and gets widget titles and results only. Write it with `page.create` or `page.update` like any other Markdown.

## Scopes

A token has one `<area>:read` and one `<area>:write` scope per area, and write includes read within its area. `describe` lists only what your token allows.

| Tool or action | Needs                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `search`       | `search:read`, and `issues:read` or `wiki:read` for each section it should show                               |
| `query.run` | `search:read` and `issues:read` |
| `sprint.overview` | `sprints:read` |
| `savedQuery.*`, `dashboard.*` | `dashboards:read` or `dashboards:write`; running one also needs `issues:read`, a sprint overview widget `sprints:read` |
| `read`         | `search:read`, plus `issues:read` or `wiki:read` per item. Some includes need `files:read`                    |
| `act`          | The scope of the action's area, for example `issues:write` for `issue.update`, `wiki:write` for `page.create` |
| `upload`       | `files:write` and the scope of the target's area                                                              |

The areas are `issues`, `sprints`, `boards`, `wiki`, `files`, `search`, `orgs`, `teams`, `projects`, `dashboards`, `forms`, `automation` and `approvals`. `search`, `orgs`, `teams` and `projects` have only a read scope for now, and `admin` none: a scope no action uses can't be minted, so a token never gains reach later without you choosing it. A token can never manage orgs, teams, members, tokens or your account, change space permissions or page restrictions, or create, change or delete projects, whatever its scopes. A refused call answers `403 SCOPE`. Beyond scopes, your own access applies: team membership, space permissions and page restrictions.

## Limits

| What         | Limit                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `read`       | 300 keys per minute per user, over REST and MCP; 10 MB per call; 4 calls at once per user, 16 in all |
| `act`        | 300 items per minute per user (a batch counts each item), 25 items per batch                         |
| `search`, `query.run` | 30 per minute per user, shared |
| `dashboard.render` | 60 per minute per user, 4 widgets at once |
| Files        | 25 MB each; 100 staged at once; 4 signed uploads running per user                                    |
| Public forms | Wrong access codes lock out the sending IP after 20 tries for 15 minutes                             |

Past a rate limit the answer is `429 RATE_LIMITED`. Reads past the cap on calls at once also say when to try again: `Retry-After` over REST, `details.retryAfterSeconds` in both.

## Errors

A failed call answers `isError: true` with `{ status, code, message }`, the same status and code as REST. An unknown tool is `404 UNKNOWN_TOOL`.

## Audit

Every write through `act` and `upload`, and every refused write, leaves an audit row with the action, its targets, the outcome and `via`. Activity on issues and pages shows `via` too.
