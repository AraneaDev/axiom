# MCP Server Install & Test Protocol

Step-by-step protocol for installing the Axiom MCP server into Claude Code and verifying all 48 tools work correctly.

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

| # | Tool | Input | Expected |
|---|------|-------|----------|
| 1 | `list_orgs` | (none) | Returns org "Aranea.Dev" with an `id` |
| 2 | `list_teams` | `orgId` from step 1 | Returns team "Axiom" |
| 3 | `list_projects` | `teamId` from step 2 | Returns project "Axiom MVP" (prefix: AXM) |

---

## Step 5: Test Issue Tools (12 tools)

| # | Tool | Input | Expected |
|---|------|-------|----------|
| 1 | `list_issues` | `projectId` | Returns seeded issues |
| 2 | `list_issues` (query) | `projectId, query: "type:bug"` | Filtered results |
| 3 | `get_issue` | `projectId, issueNumber: 1` | Full issue with comments |
| 4 | `create_issue` | `projectId, title: "MCP Test Issue", type: "TASK"` | New issue created |
| 5 | `update_issue` | `projectId, issueNumber: <new>` | Issue updated |
| 6 | `add_comment` | `projectId, issueNumber: <new>, body: "Test comment"` | Comment added |
| 7 | `delete_issue` | `projectId, issueNumber: <new>` | Issue deleted |
| 8 | `list_sprints` | `projectId` | Returns sprints |
| 9 | `get_sprint` | `sprintId` from step 8 | Sprint with issues |
| 10 | `create_sprint` | `projectId, name: "MCP Test Sprint"` | Sprint created |
| 11 | `add_issues_to_sprint` | `sprintId, issueIds` | Issues added |
| 12 | `start_sprint` / `complete_sprint` | `sprintId` | Sprint lifecycle works |

---

## Step 6: Test Repository & Git Tools (13 tools)

| # | Tool | Input | Expected |
|---|------|-------|----------|
| 1 | `list_repos` | `teamId` | Returns seeded repos |
| 2 | `browse_files` | `repoId` | File listing at root |
| 3 | `read_file` | `repoId, filePath: "README.md"` | File content |
| 4 | `get_commits` | `repoId` | Commit history |
| 5 | `get_branches` | `repoId` | Branch list |
| 6 | `list_branches` | `repoId` | Branches with commit info |
| 7 | `get_diff` | `repoId, base, head` | Diff output |
| 8 | `search_code` | `repoId, query: "README"` | Search results |
| 9 | `get_pr_diff` | `repoId, pullNumber` | PR diff |
| 10 | `get_pr_comments` | `repoId, pullNumber` | PR comments |
| 11 | `get_recent_merges` | `repoId` | Merged PRs |

---

## Step 7: Test Pull Request Tools (4 tools)

| # | Tool | Input | Expected |
|---|------|-------|----------|
| 1 | `list_pull_requests` | `repoId` | Returns PRs |
| 2 | `get_pull_request` | `repoId, pullNumber` | PR details |
| 3 | `create_pull_request` | `repoId, title, sourceBranch, targetBranch` | PR created |
| 4 | `merge_pull_request` | `repoId, pullNumber` | PR merged |

---

## Step 8: Test CI/CD & Release Tools (4 tools)

| # | Tool | Input | Expected |
|---|------|-------|----------|
| 1 | `list_pipelines` | `repoId` | Pipeline list |
| 2 | `trigger_pipeline` | `pipelineId, ref: "main"` | Run triggered |
| 3 | `list_releases` | `repoId` | Release list |
| 4 | `create_release` | `repoId, tagName: "v0.0.1-test", targetBranch: "main"` | Release created |

---

## Step 9: Test Runner Tools (4 tools)

| # | Tool | Input | Expected |
|---|------|-------|----------|
| 1 | `list_runners` | `orgId` | Runner list (may be empty) |
| 2 | `generate_runner_registration_token` | `orgId` | Token returned |

(Runner task tools require an active runner task -- skip if none exist.)

---

## Step 10: Test Wiki Tools (6 tools)

| # | Tool | Input | Expected |
|---|------|-------|----------|
| 1 | `list_wiki_spaces` | `teamId` | Returns wiki spaces |
| 2 | `get_page_tree` | `spaceId` | Nested page tree |
| 3 | `get_wiki_page` | `spaceId, pageSlug` | Page content |
| 4 | `create_wiki_page` | `spaceId, title: "MCP Test Page", slug: "mcp-test"` | Page created |
| 5 | `update_wiki_page` | `pageId, title: "MCP Test Page Updated"` | Page updated |
| 6 | `delete_wiki_page` | `pageId` | Page deleted |

---

## Step 11: Test Search Tool (1 tool)

| # | Tool | Input | Expected |
|---|------|-------|----------|
| 1 | `search` | `query: "test", type: "all"` | Results from issues + wiki |

---

## Step 12: Test Integration Tools (3 tools)

| # | Tool | Input | Expected |
|---|------|-------|----------|
| 1 | `get_development_summary` | `projectId, issueNumber` | Linked PRs/branches/CI |
| 2 | `list_wiki_issue_links` | `issueId` | Linked wiki pages |
| 3 | `link_wiki_to_issue` | `pageId, issueId` | Link created |

---

## Cleanup

After testing, remove test artifacts:

- Delete any test issues, sprints, wiki pages, and releases created during testing
- Or re-run `npm run db:seed` to reset to baseline

To remove the MCP server from Claude Code:

```bash
claude mcp remove axiom
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `401 Unauthorized` | Token expired -- re-run Step 1 |
| `No active SSE connection` | SSE stream dropped -- reconnect |
| Tools not appearing | Restart Claude Code after `mcp add` |
| Connection refused | Ensure `npm run docker:dev` is running |
