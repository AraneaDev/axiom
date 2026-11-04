# MCP Server Install & Test Protocol

Step-by-step protocol for installing the Axiom MCP server into Claude Code and verifying all 24 tools work correctly.

---

## Prerequisites

- Dev stack running: `npm run docker:dev`
- Database seeded: `npm run db:seed`
- Seed credentials: `tim / password123` (OWNER)

---

## Step 1: Obtain an Access Token

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -H "X-Requested-With: XMLHttpRequest" \
  -d '{"login": "tim", "password": "password123"}' \
  | jq -r '.accessToken'
```

Note: The field is `login` (not `username`) -- it accepts either username or email.

Save the returned JWT -- it expires in 4 hours. Re-run if it expires during testing.

---

## Step 2: Register the MCP Server in Claude Code

```bash
claude mcp add axiom --transport sse http://localhost:3000/api/mcp \
  --header "Authorization: Bearer <TOKEN>"
```

This writes to `.claude/settings.local.json`. Verify with:

```bash
claude mcp list
```

Expected: `axiom` appears with type `sse` and the correct URL.

---

## Step 3: Verify SSE Connection

Test the SSE endpoint directly:

```bash
curl -N -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/mcp
```

Expected: SSE stream opens (you see `event:` lines). Ctrl+C to close.

---

## Step 4: Test Discovery Chain (Core Smoke Test)

These tools form the foundation -- every other tool depends on IDs from this chain.

| #   | Tool            | Input                | Expected                                  |
| --- | --------------- | -------------------- | ----------------------------------------- |
| 1   | `list_orgs`     | (none)               | Returns org "Aranea.Dev" with an `id`     |
| 2   | `list_teams`    | `orgId` from step 1  | Returns team "Axiom"                      |
| 3   | `list_projects` | `teamId` from step 2 | Returns project "Axiom MVP" (prefix: AXM) |

---

## Step 5: Test Issue Tools (12 tools)

| #   | Tool                               | Input                                                 | Expected                 |
| --- | ---------------------------------- | ----------------------------------------------------- | ------------------------ |
| 1   | `list_issues`                      | `projectId`                                           | Returns seeded issues    |
| 2   | `list_issues` (query)              | `projectId, query: "type:bug"`                        | Filtered results         |
| 3   | `get_issue`                        | `projectId, issueNumber: 1`                           | Full issue with comments |
| 4   | `create_issue`                     | `projectId, title: "MCP Test Issue", type: "TASK"`    | New issue created        |
| 5   | `update_issue`                     | `projectId, issueNumber: <new>`                       | Issue updated            |
| 6   | `add_comment`                      | `projectId, issueNumber: <new>, body: "Test comment"` | Comment added            |
| 7   | `delete_issue`                     | `projectId, issueNumber: <new>`                       | Issue deleted            |
| 8   | `list_sprints`                     | `projectId`                                           | Returns sprints          |
| 9   | `get_sprint`                       | `sprintId` from step 8                                | Sprint with issues       |
| 10  | `create_sprint`                    | `projectId, name: "MCP Test Sprint"`                  | Sprint created           |
| 11  | `add_issues_to_sprint`             | `sprintId, issueIds`                                  | Issues added             |
| 12  | `start_sprint` / `complete_sprint` | `sprintId`                                            | Sprint lifecycle works   |

---

## Step 6: Test Wiki Tools (6 tools)

| #   | Tool               | Input                                               | Expected            |
| --- | ------------------ | --------------------------------------------------- | ------------------- |
| 1   | `list_wiki_spaces` | `teamId`                                            | Returns wiki spaces |
| 2   | `get_page_tree`    | `spaceId`                                           | Nested page tree    |
| 3   | `get_wiki_page`    | `spaceId, pageSlug`                                 | Page content        |
| 4   | `create_wiki_page` | `spaceId, title: "MCP Test Page", slug: "mcp-test"` | Page created        |
| 5   | `update_wiki_page` | `pageId, title: "MCP Test Page Updated"`            | Page updated        |
| 6   | `delete_wiki_page` | `pageId`                                            | Page deleted        |

---

## Step 7: Test Search Tool (1 tool)

| #   | Tool     | Input                        | Expected                   |
| --- | -------- | ---------------------------- | -------------------------- |
| 1   | `search` | `query: "test", type: "all"` | Results from issues + wiki |

---

## Step 8: Test Integration Tools (2 tools)

| #   | Tool                    | Input             | Expected          |
| --- | ----------------------- | ----------------- | ----------------- |
| 1   | `list_wiki_issue_links` | `issueId`         | Linked wiki pages |
| 2   | `link_wiki_to_issue`    | `pageId, issueId` | Link created      |

---

## Cleanup

After testing, remove test artifacts:

- Delete any test issues, sprints, and wiki pages created during testing
- Or re-run `npm run db:seed` to reset to baseline

To remove the MCP server from Claude Code:

```bash
claude mcp remove axiom
```

---

## Troubleshooting

| Symptom                    | Fix                                    |
| -------------------------- | -------------------------------------- |
| `401 Unauthorized`         | Token expired -- re-run Step 1         |
| `No active SSE connection` | SSE stream dropped -- reconnect        |
| Tools not appearing        | Restart Claude Code after `mcp add`    |
| Connection refused         | Ensure `npm run docker:dev` is running |
