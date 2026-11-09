# MCP install and test protocol

Install the Axiom MCP server into Claude Code and check that the five tools work.

## Prerequisites

- Dev stack running: `npm run docker:dev`
- Database seeded: `npm run db:seed`
- Seed credentials: `tim / password123` (OWNER)

## Step 1: Create an API token

The endpoint takes API tokens only. Log in, then create a token:

```bash
ACCESS=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -d '{"login": "tim", "password": "password123"}' | jq -r '.accessToken')

curl -s -X POST http://localhost:3000/api/users/me/tokens \
  -H "Authorization: Bearer $ACCESS" -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -d '{"name": "claude-code", "scopes": ["search:read", "issues:write", "wiki:write", "files:write"]}' \
  | jq -r '.token'
```

The token (`tk_...`) is shown once.

## Step 2: Add the server

```bash
claude mcp add --transport http axiom http://localhost:3000/api/mcp \
  --header "Authorization: Token tk_..."
claude mcp list
```

Expected: `axiom` is listed as connected.

## Step 3: Check the endpoint directly

```bash
curl -s -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Token tk_..." -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Expected: the tools `search`, `read`, `describe`, `act` and `upload`.

## Step 4: Try the tools

Ask Claude Code, one at a time:

1. "Search Axiom for open bugs." Expect a `search` call.
2. "Read AXM-1 with its comments." Expect one `read` call with `include`.
3. "Add a comment to AXM-1 and log 15 minutes." Expect one `act` call with a batch.
4. "Create a wiki page in the Axiom space with this screenshot." Expect `upload`, a `curl`, then `act`.
5. "What can you do with sprints?" Expect `describe`.

Check the issue in the browser: the activity shows `via claude-code`.

## Troubleshooting

| Symptom              | Fix                                                                          |
| -------------------- | ---------------------------------------------------------------------------- |
| `401 TOKEN_REQUIRED` | You sent a session or JWT. Use `Authorization: Token tk_...`                 |
| `403 SCOPE`          | The token lacks the area scope. Create a token with it                       |
| `403 UI_ONLY`        | The action is web UI only. Do it in the browser                              |
| `403 TOKEN_BLOCKED`  | No token runs this action, whatever its scopes. Do it in the browser         |
| `403 INVALID_ORIGIN` | A browser origin that is not in `CORS_ORIGIN` or `FRONTEND_URL`              |
| `405`                | `GET` and `DELETE` are not used. The server is stateless: `POST` only        |
| `429 RATE_LIMITED`   | Wait a minute, see the limits in the [MCP server guide](axiom-mcp-server.md) |
