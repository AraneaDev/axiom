# Axiom MCP server

Axiom has an MCP server so your agents work in the same projects you do. It has five tools. They cover everything the REST API does, so an agent finishes a ticket in one or two calls instead of ten.

## Connection

The server speaks Streamable HTTP, stateless, at `POST /api/mcp`. `GET` and `DELETE` answer `405`. Legacy SSE and the 24 separate tools of the earlier server are gone.

| What            | Value                                                              |
| --------------- | ------------------------------------------------------------------ |
| URL (local dev) | `http://localhost:3000/api/mcp`                                    |
| Transport       | `http` (Streamable HTTP)                                           |
| Header          | `Authorization: Token tk_...`                                      |
| Body            | One JSON-RPC message per request, `Content-Type: application/json` |

The endpoint takes API tokens only. A session or JWT gets `401 TOKEN_REQUIRED`. That is on purpose: every write an agent makes is recorded with the name of its token as `via`, so your history shows what you did and what an agent did.

A browser request must come from an allowed origin (`CORS_ORIGIN` or `FRONTEND_URL`, else localhost only); an agent sends no `Origin` and is unaffected.

### Create a token

In Axiom open Settings, API tokens, and create one. Name it after the agent (`claude-code`, `codex`), since that name becomes `via`. Give it the scopes it needs, below. Over REST: `POST /api/users/me/tokens` with `{ "name": "claude-code", "scopes": ["issues:write", "search:read"] }`. The token is shown once.

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

`target` is a key (`AXM-42`, `org/team/space/page-slug`) or an object such as `{ pageKey }`. Without one the file is staged and visible to you only. It joins an issue or page when a body references `attachmentUrl`, for example `![shot](/api/attachments/...)` in a `page.create` body. Staged files are removed after 24 hours. Put a screenshot in a wiki page in two tool calls: `upload`, then `act` with `page.create` and a `key` of the space.

The URL in the answer is built from `FRONTEND_URL` when it is set, so set it when you reach Axiom through a tunnel or proxy, and set `TRUST_PROXY` to match.

## Scopes

A token has one `<area>:read` and one `<area>:write` scope per area, and write includes read within its area. `describe` lists only what your token allows.

| Tool or action | Needs                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| `search`       | `search:read`, and `issues:read` or `wiki:read` for each section it should show                               |
| `read`         | `search:read`, plus `issues:read` or `wiki:read` per item. Some includes need `files:read`                    |
| `act`          | The scope of the action's area, for example `issues:write` for `issue.update`, `wiki:write` for `page.create` |
| `upload`       | `files:write` and the scope of the target's area                                                              |

The areas are `issues`, `sprints`, `boards`, `wiki`, `files`, `search`, `orgs`, `teams`, `projects`, `dashboards`, `forms`, `automation`, `approvals` and `admin`. A token can never manage orgs, teams, members, tokens or your account, change space permissions or page restrictions, or create, change or delete projects, whatever its scopes. A refused call answers `403 SCOPE`. Beyond scopes, your own access applies: team membership, space permissions and page restrictions.

## Limits

| What         | Limit                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| `read`       | 300 keys per minute per user, over REST and MCP; 10 MB per call              |
| `act`        | 300 items per minute per user (a batch counts each item), 25 items per batch |
| `search`     | 30 per minute per user                                                       |
| Files        | 25 MB each; 100 staged at once; 4 signed uploads running per user            |
| Public forms | Wrong access codes lock out the sending IP after 20 tries for 15 minutes     |

Past a rate limit the answer is `429 RATE_LIMITED`.

## Errors

A failed call answers `isError: true` with `{ status, code, message }`, the same status and code as REST. An unknown tool is `404 UNKNOWN_TOOL`.

## Audit

Every write through `act` and `upload`, and every refused write, leaves an audit row with the action, its targets, the outcome and `via`. Activity on issues and pages shows `via` too.
