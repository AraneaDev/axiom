# Axiom API Reference

## Overview

Base URL: `http://localhost:3000` (development)

All API endpoints are prefixed with `/api`.

Every route is the REST binding of an action in the registry, and the registry also feeds `POST /api/act`, `POST /api/read` and the MCP server. The full reference, with every path, input, output, status and the scope each one needs, is generated from it and always matches the running server:

- `/api/docs` is the browsable reference.
- `/api/openapi.json` is the same as OpenAPI, for clients and generators.

Both are public and need no sign-in. This page keeps the parts a generated list can't say well: authentication, scopes, permissions, approvals, the query language and the shape of the larger resources. Where it differs from `/api/docs`, `/api/docs` is right. A path that no action serves answers `404`, for a session and a token alike, and `401` for a caller who is not signed in.

### Content Type

All request and response bodies use `application/json` unless noted otherwise (file uploads use `multipart/form-data`).

### CSRF Protection

All state-changing requests (POST, PATCH, PUT, DELETE) require the header:

```
X-Requested-With: XMLHttpRequest
```

### Rate Limiting

| Scope                                                                         | Limit                   |
| ----------------------------------------------------------------------------- | ----------------------- |
| Global                                                                        | 300 requests per minute |
| Auth endpoints (`/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`) | 15 requests per minute  |
| Attachment uploads                                                            | 10 uploads per minute   |
| Signed uploads (`PUT /api/uploads/:uploadId`)                                 | 30 requests per minute  |

Rate limit headers returned on every response:

```
RateLimit-Limit: 300
RateLimit-Remaining: 297
RateLimit-Reset: 1711500060
```

When the limit is exceeded, the server returns `429 Too Many Requests`:

```json
{
  "error": {
    "message": "Too many requests, please try again later.",
    "code": "RATE_LIMITED"
  }
}
```

### Authentication

Protected endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <access_token>
```

Access tokens are short-lived JWTs. When a request returns `401`, use the refresh token to obtain a new access token via `POST /api/auth/refresh`.

#### API tokens and scopes

Personal API tokens (`POST /api/users/me/tokens`) use the `Token` scheme:

```
Authorization: Token tk_...
```

A token acts as its owner, limited to its scopes. A request its scopes don't cover returns `403` with code `SCOPE`.

Each area has an `<area>:read` and an `<area>:write` scope. Write includes read within its own area only.

A scope no action uses can't be minted (`400`): `orgs:write`, `teams:write`, `projects:write` and `search:write`. A token that holds one from before gets nothing from it. Managing orgs, teams, projects, access and tokens is in `admin:read` and `admin:write`: the user still needs the role, and each call answers `202` until a person approves it in the web UI.

| Area         | Covers                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issues`     | Issues, comments, labels, milestones, templates, workflows, custom fields, links, team roadmap, activity and analytics (`/api/issues`, `/api/custom-fields`, `/api/links`, the rest of `/api/projects/:id/*`) |
| `sprints`    | `/api/projects/:id/sprints`, `velocity`, `backlog`, and the action `sprint.overview`                                                                                                                          |
| `boards`     | `/api/projects/:id/board`                                                                                                                                                                                     |
| `wiki`       | `/api/wiki`                                                                                                                                                                                                   |
| `files`      | `/api/attachments`, together with the scope of the parent (below)                                                                                                                                             |
| `search`     | `/api/search` and `POST /api/read`, reads only                                                                                                                                                                |
| `orgs`       | `/api/orgs`, reads only                                                                                                                                                                                       |
| `teams`      | `/api/teams`, reads only                                                                                                                                                                                      |
| `projects`   | `/api/projects/:id` and `/api/projects/team/:teamId`, reads only                                                                                                                                              |
| `dashboards` | Your dashboard (`issues:read` opens it too), and the actions `savedQuery.*` and `dashboard.*`, read and write. A token from before that held `dashboards:read` can read your saved queries and dashboards. Running a query also needs `issues:read` |
| `forms`      | `/api/projects/:id/forms`, `intake`                                                                                                                                                                           |
| `automation` | `/api/projects/:id/automation-rules`                                                                                                                                                                          |
| `approvals`  | `/api/projects/:id/approval-gates`, `/api/approval-requests`                                                                                                                                                  |
| `admin` | Orgs, teams, members, invitations, tokens, space permissions, page restrictions, project create, update and delete, and `/api/admin`. Every call waits for approval, see [Approvals](#approvals-for-token-calls) |

Reading your profile, the user search and notifications needs read on `issues` or `wiki`. Search returns only the sections the token covers (`issues:read`, `wiki:read`). An attachment needs `files:<kind>` and the scope of its parent: `issues:<kind>` for an issue's, `wiki:<kind>` for a page's. Managing orgs, teams, members, invitations, tokens, space permissions and page restrictions, creating, changing or deleting projects, and reading under `/api/admin` take the `admin` scope, and every such call waits for a person to approve it. Your own account (changing the profile, the password or 2FA) and resetting another user's password or 2FA stay closed to tokens (`403`); reading the profile is open. Login, refresh, logout and the other sign-in routes are `uiOnly`: a session reaches them, a token never does, and `act` doesn't list them. Invite links are `tokenBlocked`: a normal action for your browser session, refused to every token. Creating a token with any other scope name returns `400`.

Tokens created before scopes per area were rewritten by migration and reach what they always reached: the old `issues:*` and `wiki:*` scopes became the set of area scopes that covers the same paths (`LEGACY_SCOPE_MAP` in `src/middleware/token-scopes.ts`).

What a token reaches comes from the registry alone. Each action has an area and a kind (`read` or `write`), and the token needs the matching scope. No path rule sits in front of it. The few actions on your own state (profile, notifications, your dashboard) are open to a token with read on any area they name. `src/actions/token-reach.json` freezes the scopes per action and changes in the same commit as any change of reach.

### Permissions

Every request is checked twice: access to the resource, then the role for the action.

- **Access.** Projects and their issues, sprints, boards and settings need membership of the project's team (or org OWNER/ADMIN, or platform admin). Team-wide reads (the team, its members, activity, roadmap, analytics and project list) follow the same rule. Wiki spaces need org membership and, when the space has custom permissions, a grant at the required level; pages also honour their VIEW/EDIT restrictions. Ids in the URL or body must belong to the project or space in the URL (`404` or `400` otherwise).
- **Role.** Writes follow the matrix in `src/utils/permissions.ts`. On a team's resources (projects, issues, sprints, boards, the team's wiki spaces) the team role decides when the user has one; org OWNERs and ADMINs keep full rights, and users with no team role fall back to their org role. Issue content needs `issue:edit` (or `issue:create`), wiki writes `wiki:edit`. VIEWERs and GUESTs can read but not write; voting on and watching an issue only need read access. Project settings (approval gates, workflow rules, automation rules, custom field definitions, board columns, forms, issue templates) and changing a project need `team:manage_members` (a team ADMIN, an org OWNER/ADMIN or a platform admin); deleting a project needs `project:delete`. Creating a project or space in a team also needs team membership.
- **Public forms.** A TOKEN_GATED form's access code is generated by the server (192 random bits) and returned once, as `accessCode`, when the form is created or when an update sends `regenerateSecret: true`. Sending `sharedSecret` is refused (`400`), and form responses never include the stored secret. Codes chosen before this must be regenerated: until then the form refuses access (`403`). Wrong codes lock out the sending IP (IPv6 by /64) after 20 tries for 15 minutes. Per-IP limits rely on `TRUST_PROXY` matching the deployment (see `.env.example`).
- **Status changes.** Every way of moving an issue (update, board move, bulk update, MCP, automation) follows the workflow rules, and a move into a column guarded by an enabled approval gate is refused with `409`, from any source column (or none): only an approved request moves an issue into it.
- **Orgs.** Org details and members are for members only. No one can grant a role above their own: only an OWNER makes, demotes or removes OWNERs, and an org always keeps one OWNER.

### Error Format

All errors follow this structure:

```json
{
  "error": {
    "message": "Human-readable description of the error",
    "code": "OPTIONAL_ERROR_CODE"
  }
}
```

Common HTTP status codes:

| Code | Meaning                                   |
| ---- | ----------------------------------------- |
| 400  | Bad request — invalid input               |
| 401  | Unauthorized — missing or expired token   |
| 403  | Forbidden — insufficient permissions      |
| 404  | Not found                                 |
| 409  | Conflict — duplicate resource             |
| 422  | Unprocessable entity — validation failure |
| 429  | Rate limit exceeded                       |
| 500  | Internal server error                     |

### Pagination

List endpoints that support pagination accept the following query parameters:

| Parameter | Type    | Description                              |
| --------- | ------- | ---------------------------------------- |
| `page`    | integer | Page number (1-based, default: 1)        |
| `limit`   | integer | Items per page (default varies, max 100) |

Paginated responses include metadata:

```json
{
  "data": [...],
  "total": 142,
  "page": 1,
  "limit": 25,
  "totalPages": 6
}
```

---

## Actions

Every operation is an action in one registry. The REST routes, the MCP `act` tool and `/api/act` run the same code, so scopes, access checks and audit rows are the same. The full list of routes, with inputs and outputs, is at `/api/docs` (interactive) and `/api/openapi.json`.

### POST /api/act

Run one action, or a batch of up to 25 in order. Takes a session or an API token.

**Request body:** `{ action, key?, input? }` or `{ batch: [{ action, key?, input? }, ...] }`, never both.

`key` names the issue, page, space or project the action works in (`AXM-42`, `org/team/space/page-slug`, `org/team/space`, `AXM`), so you can leave the id fields out of `input`. See the [MCP server guide](axiom-mcp-server.md#keys) for the key forms and their errors. `issue.update` also takes `status` as a column name. `page.create` needs `title` and `slug` (lower-case letters, digits and hyphens) in `input`.

**Response 200:** the action's result, or for a batch `{ results, completed }` with one `{ ok: true, result }`, `{ ok: false, error: { status, code, message } }` or `{ ok: false, skipped: true }` per item. A batch stops at the first failure and what ran stays done.

**Limits:** 300 items per minute per user, a batch counting each item (`429 RATE_LIMITED`). Input is strict: an unknown field is a `400`.

An action that needs a raw request (multipart upload, file download, CSV export) is not available through `act`.

### Approvals for token calls

A call from an API token (REST or `/api/act`) that needs approval runs nothing and answers `202`:

```json
{
  "status": "pending_approval",
  "approvalId": "...",
  "preview": "Delete AXM-42 \"Fix the login redirect\"",
  "expiresAt": "2026-11-05T17:30:00.000Z",
  "approveUrl": "/approvals/agent/...",
  "next": "Nothing ran yet: your user decides at approveUrl. Run agentApproval.wait with id ..."
}
```

A browser session never gets this. Destructive actions, bulk actions over 10 items, moves across a project or space, permission changes and every admin action wait by default; org and user policies change that, except for admin. An approval runs the action as the requesting user with their rights at approval time. The result of `token.create` has its `token` removed from what the agent reads: the raw token is in the response to the approval only.

Endpoints, all `approvals` area:

| Method and path | Action | Notes |
| --- | --- | --- |
| `GET /api/agent-approvals` | `agentApproval.list` | `status`, `state` (`open` or `decided`), `limit` (100 at most), `offset`; your own requests |
| `GET /api/agent-approvals/:id` | `agentApproval.get` | One request with input and outcome |
| `GET /api/agent-approvals/:id/wait` | `agentApproval.wait` | Waits up to 25 seconds (`seconds`), two at once per user (`429`) |
| `POST /api/agent-approvals/:id/approve` | `agentApproval.approve` | Web UI only |
| `POST /api/agent-approvals/:id/reject` | `agentApproval.reject` | Web UI only |
| `GET`, `PUT /api/agent-policy` | `agentPolicy.get`, `agentPolicy.update` | `scope` `org` (owners write) or `user` (tighten only); update is an admin action |

Statuses are `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `EXECUTED` and `FAILED`. Limits: 256 KB of input (`400`), 50 pending per user (`429`), expiry from 10 minutes to 24 hours (an hour by default). Deletes, approval gate writes and votes wait for approval like any destructive action; none is refused outright. An org policy that lists `attachment.upload` (the multipart upload, which can't wait) in `alsoRequire` refuses it to tokens outright (`403`); `attachment.createUploadUrl` and `attachment.fromUrl` wait for approval like any other action. A token that has an expiry can only create tokens that expire by then; a token with none is free. The [MCP server guide](axiom-mcp-server.md#approvals) has the whole picture.

### Uploads

`upload` over MCP is `POST /api/attachments/upload-url` and `POST /api/attachments/from-url` under the hood; see [Attachments](#attachments) for the signed `PUT /api/uploads/:uploadId` and its limits.

---

## Read by key

### POST /api/read

Read issues and pages by key in one call, with whatever belongs to them. Needs `search:read`. With a token, each issue also needs `issues:read` and each page `wiki:read`; otherwise that item answers `403` with code `SCOPE`, whether it exists or not.

**Request body:**

| Field           | Type     | Description                                                                                                                        |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `keys`          | string[] | 1 to 50 keys, each at most 512 characters. Spellings of one key (`AXM-042`, a URL with a query) are answered once, under the first |
| `include`       | string[] | Optional. What to add to each item, below. An include for the other kind of item is passed over, so one call can hold both         |
| `fields`        | string[] | Optional. Narrow the base item to these fields; `id` and `key` always come along. A field of the other kind is passed over         |
| `commentBodies` | boolean  | Optional. `false` leaves the bodies of comments out                                                                                |

**Key forms:** `AXM-42`, `org/team/AXM-42`, `org/team/space/page-slug`, and the path or full URL of an issue (`/:org/:team/:project/issues/:num`) or page (`/:org/:team/wiki/:space/:page`). Only the path of a URL counts: the host is ignored and nothing is fetched.

**Limits:** 300 keys per minute per user, over REST and MCP together; past it the call answers `429` with code `RATE_LIMITED`. One call returns at most 10 MB. Items are read in order, and the item that goes past it and all after it answer `413 RESPONSE_TOO_LARGE`, with `truncated: true` at the top. Read those in another call, or with fewer includes, `fields` or `commentBodies: false`.

**Response 200:** `{ items, byteLimit, truncated }`, with one item per key in the order given. Each is `{ key, kind: 'issue' | 'page', data }` or `{ key, error: { status, code, message, details? } }`.

| Error                    | When                                                                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 INVALID_KEY`        | The key has none of the forms above                                                                                                                              |
| `403 SCOPE`              | The token doesn't cover this kind of item                                                                                                                        |
| `404 NOT_FOUND`          | Nothing there, or nothing you can see: the two answer the same                                                                                                   |
| `413 RESPONSE_TOO_LARGE` | The call reached its 10 MB limit                                                                                                                                 |
| `409 AMBIGUOUS_KEY`      | A bare `AXM-42` whose prefix is used by projects you can see in more than one team. `details.candidates` lists the full keys. Projects you can't see don't count |

**Issue `data`:** `id`, `key`, `fullKey`, `url`, `number`, `title`, `body`, `type`, `priority`, `status` (the column name), `assignee`, `creator`, `labels`, `sprint`, `parent`, `project`, `storyPoints`, `dueDate`, `startDate`, `timeEstimate`, `timeSpent`, `createdAt`, `updatedAt`.

**Page `data`:** `id`, `key`, `url`, `slug`, `title`, `body`, `isDraft`, `parentId`, `space`, `version`, `lastEditedBy`, `createdAt`, `updatedAt`.

People appear as `{ id, displayName }`. Each include is `{ items, limit, truncated }`, with `truncated: true` when the limit cut rows off:

| Include               | Items                                                                                                                                                                                                            | Limit |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `comments` (both)     | The newest, oldest first                                                                                                                                                                                         | 100   |
| `links` (issue)       | `{ id, type, direction, issue }`, only where you can open the other issue                                                                                                                                        | 100   |
| `webLinks` (issue)    | `{ id, url, title, createdBy, createdAt }`                                                                                                                                                                       | 50    |
| `attachments` (both)  | `{ id, name, mimeType, size, url, uploader, createdAt }`. Needs `files:read`                                                                                                                                     | 50    |
| `history` (both)      | Issue: activity, newest first, with file names only under `files:read`. Page: versions without their bodies, newest first                                                                                        | 50    |
| `worklogs` (issue)    | `{ id, minutes, description, loggedAt, user }`, newest first                                                                                                                                                     | 100   |
| `children` (both)     | Child issues or pages you can open                                                                                                                                                                               | 100   |
| `pages` (issue)       | Linked pages and pages whose body mentions the key, in the issue's org and only those you can view; each with `linkTypes`. A mention counts when its author could open the issue when writing. Needs `wiki:read` | 20    |
| `labels` (page)       | Label names                                                                                                                                                                                                      | 100   |
| `linkedIssues` (page) | `{ issue, linkTypes }`, only issues you can open. Needs `issues:read`                                                                                                                                            | 50    |

An include the token's scopes don't cover is left out, and named in `data.omittedIncludes`.

---

## Health

### GET /api/health

Check API health. No authentication required.

**Response 200:**

```json
{
  "status": "ok",
  "version": "0.1.0-alpha",
  "name": "axiom"
}
```

### GET /api/health/metrics

The request counters since the server started (`totalRequests`, status code counts, average duration). Needs a platform admin: an anonymous call answers `401`, a signed-in user who is not a platform admin `403`. Closed to tokens. The plain `/api/health` above stays public for the container check and load balancers.

---

## Authentication

Base path: `/api/auth`

Rate-limited endpoints: `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/refresh` (15 req/min).

### POST /api/auth/register

Create a new user account.

**Request body:**

```json
{
  "username": "tim",
  "email": "tim@aranea.dev",
  "password": "securepassword123"
}
```

**Response 201:**

```json
{
  "user": {
    "id": "usr_01HZ...",
    "username": "tim",
    "email": "tim@aranea.dev",
    "createdAt": "2026-03-27T10:00:00.000Z"
  },
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci..."
}
```

### POST /api/auth/login

Authenticate with email and password.

**Request body:**

```json
{
  "email": "tim@aranea.dev",
  "password": "password123"
}
```

**Response 200:**

```json
{
  "user": {
    "id": "usr_01HZ...",
    "username": "tim",
    "email": "tim@aranea.dev"
  },
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci..."
}
```

If the account has 2FA enabled, the response includes `twoFactorRequired: true` and a temporary token instead of a full access token.

### POST /api/auth/refresh

Exchange a refresh token for a new access token.

**Request body:**

```json
{
  "refreshToken": "eyJhbGci..."
}
```

**Response 200:**

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci..."
}
```

### POST /api/auth/logout

Invalidate the current refresh token. **Auth required.**

**Request body:**

```json
{
  "refreshToken": "eyJhbGci..."
}
```

**Response 204:** No content.

### POST /api/auth/forgot-password

Request a password reset email.

**Request body:**

```json
{
  "email": "tim@aranea.dev"
}
```

**Response 200:**

```json
{
  "message": "If an account with that email exists, a reset link has been sent."
}
```

### POST /api/auth/reset-password

Reset password using a token from the reset email.

**Request body:**

```json
{
  "token": "reset_token_from_email",
  "password": "newpassword123"
}
```

**Response 200:**

```json
{
  "message": "Password reset successfully."
}
```

### POST /api/auth/2fa/enable

Begin 2FA setup. Returns a TOTP secret and QR code URI. **Auth required.**

**Response 200:**

```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qrCodeUrl": "otpauth://totp/Axiom:tim?secret=JBSWY3DPEHPK3PXP&issuer=Axiom"
}
```

### POST /api/auth/2fa/verify

Confirm 2FA setup or verify a TOTP code. **Auth required.**

**Request body:**

```json
{
  "code": "123456"
}
```

**Response 200:** `{ "enabled": true }`. A wrong code answers `400 Invalid 2FA code`.

A code counts once. Login, verify and disable accept the code of the current 30 second period or of the one before it, and refuse a code of a period at or before the last one accepted for that user, so a code seen over a shoulder can't be used again. If you lose your authenticator, a platform admin can turn 2FA off for you (`POST /api/admin/users/:userId/reset-2fa`).

### POST /api/auth/2fa/disable

Disable 2FA. **Auth required.**

**Request body:**

```json
{
  "code": "123456"
}
```

**Response 200:** `{ "enabled": false }`. A wrong or already used code answers `401 Invalid 2FA code`.

---

## Users

Base path: `/api/users`

All endpoints require authentication.

### GET /api/users/search

Search for users by username or email.

**Query parameters:**

| Parameter | Type   | Description  |
| --------- | ------ | ------------ |
| `q`       | string | Search query |

**Response 200:**

```json
{
  "users": [{ "id": "usr_01HZ...", "username": "tim", "avatarUrl": null }]
}
```

### GET /api/users/me

Get the current user's profile.

**Response 200:**

```json
{
  "id": "usr_01HZ...",
  "username": "tim",
  "email": "tim@aranea.dev",
  "displayName": "Tim",
  "avatarUrl": null,
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

### PATCH /api/users/me

Update the current user's profile.

**Request body** (all fields optional):

```json
{
  "displayName": "Tim B.",
  "bio": "Software engineer",
  "avatarUrl": "https://example.com/avatar.png"
}
```

**Response 200:** Updated user object.

### GET /api/users/me/dashboard

Get the current user's personal dashboard (assigned issues, recent activity, watched issues).

**Response 200:**

```json
{
  "assignedIssues": [...],
  "recentActivity": [...],
  "watchedIssues": [...]
}
```

### GET /api/users/me/tokens

List the current user's API tokens.

**Response 200:**

```json
{
  "tokens": [
    {
      "id": "tok_01HZ...",
      "name": "CI integration",
      "lastUsedAt": "2026-03-26T12:00:00.000Z",
      "createdAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/users/me/tokens

Create a new API token. The token value is returned only once.

**Request body:**

```json
{
  "name": "CI integration"
}
```

**Response 201:**

```json
{
  "id": "tok_01HZ...",
  "name": "CI integration",
  "token": "axm_live_abcdef123456..."
}
```

### DELETE /api/users/me/tokens/:tokenId

Revoke an API token.

**Response 204:** No content.

---

## Organizations

Base path: `/api/orgs`

All endpoints require authentication.

### POST /api/orgs

Create a new organization.

**Request body:**

```json
{
  "name": "Aranea.Dev",
  "slug": "aranea-dev"
}
```

**Response 201:**

```json
{
  "id": "org_01HZ...",
  "name": "Aranea.Dev",
  "slug": "aranea-dev",
  "createdAt": "2026-01-01T00:00:00.000Z"
}
```

### GET /api/orgs

List organizations the current user belongs to.

**Response 200:**

```json
{
  "orgs": [{ "id": "org_01HZ...", "name": "Aranea.Dev", "slug": "aranea-dev" }]
}
```

### GET /api/orgs/:orgId

Get a single organization.

**Response 200:** Organization object.

### PATCH /api/orgs/:orgId

Update an organization. Requires `org:manage` permission.

**Request body** (all fields optional):

```json
{
  "name": "Aranea Development",
  "description": "Building the future"
}
```

**Response 200:** Updated organization object.

### DELETE /api/orgs/:orgId

Delete an organization. Requires `org:manage` permission.

**Response 204:** No content.

### GET /api/orgs/:orgId/members

List organization members.

**Response 200:**

```json
{
  "members": [
    {
      "id": "mem_01HZ...",
      "user": { "id": "usr_01HZ...", "username": "tim" },
      "role": "OWNER",
      "joinedAt": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

### POST /api/orgs/:orgId/members

Add a member to the organization. Requires `team:manage_members` permission.

**Request body:**

```json
{
  "userId": "usr_01HZ...",
  "role": "MEMBER"
}
```

**Response 201:** Membership object.

### PATCH /api/orgs/:orgId/members/:memberId

Update a member's role. Requires `team:manage_members` permission.

**Request body:**

```json
{
  "role": "ADMIN"
}
```

**Response 200:** Updated membership object.

### DELETE /api/orgs/:orgId/members/:memberId

Remove a member from the organization. Requires `team:manage_members` permission.

**Response 204:** No content.

### POST /api/orgs/:orgId/invites

Create an invite link. Requires `team:manage_members` permission.

**Request body:**

```json
{
  "role": "MEMBER",
  "expiresAt": "2026-04-30T00:00:00.000Z"
}
```

**Response 201:**

```json
{
  "id": "inv_01HZ...",
  "token": "abc123xyz",
  "role": "MEMBER",
  "expiresAt": "2026-04-30T00:00:00.000Z"
}
```

### GET /api/orgs/:orgId/invites

List active invite links. Requires `team:manage_members` permission.

**Response 200:** Array of invite objects.

### DELETE /api/orgs/:orgId/invites/:inviteId

Delete an invite link. Requires `team:manage_members` permission.

**Response 204:** No content.

---

## Invitations

Base path: `/api`

All endpoints require authentication.

### POST /api/orgs/:orgId/invitations

Send an email invitation to join an organization. Requires `team:manage_members` permission.

**Request body:**

```json
{
  "email": "newmember@example.com",
  "role": "MEMBER"
}
```

**Response 201:** Invitation object.

### GET /api/orgs/:orgId/invitations

List pending email invitations. Requires `team:manage_members` permission.

**Response 200:** Array of invitation objects.

### DELETE /api/orgs/:orgId/invitations/:id

Revoke a pending invitation. Requires `team:manage_members` permission.

**Response 204:** No content.

### POST /api/invitations/:token/accept

Accept an invitation using a token from an invitation email.

**Response 200:**

```json
{
  "org": { "id": "org_01HZ...", "slug": "aranea-dev" }
}
```

---

## Teams

Base path: `/api/teams`

All endpoints require authentication.

### POST /api/teams/org/:orgId

Create a team within an organization. Requires `team:create` permission.

**Request body:**

```json
{
  "name": "Axiom",
  "slug": "axiom",
  "description": "Core product team"
}
```

**Response 201:** Team object.

### GET /api/teams/org/:orgId

List teams within an organization.

**Response 200:**

```json
{
  "teams": [
    {
      "id": "team_01HZ...",
      "name": "Axiom",
      "slug": "axiom",
      "memberCount": 4
    }
  ]
}
```

### GET /api/teams/:teamId

Get a single team.

**Response 200:** Full team object.

### PATCH /api/teams/:teamId

Update a team. Requires `team:manage_members` permission.

**Request body** (all fields optional):

```json
{
  "name": "Axiom Core",
  "description": "Updated description"
}
```

**Response 200:** Updated team object.

### DELETE /api/teams/:teamId

Delete a team. Requires `team:delete` permission.

**Response 204:** No content.

### GET /api/teams/:teamId/activity

Get the team's activity feed.

**Query parameters:** `page`, `limit`

**Response 200:** Paginated activity events.

### GET /api/teams/:teamId/members/profile/:username

Get a team member's profile including recent activity and contributions.

**Response 200:** Member profile object.

### GET /api/teams/:teamId/members

List team members.

**Response 200:** Array of member objects.

### POST /api/teams/:teamId/members

Add a member to a team. Requires `team:manage_members` permission.

**Request body:**

```json
{
  "userId": "usr_01HZ...",
  "role": "MEMBER"
}
```

**Response 201:** Membership object.

### PATCH /api/teams/:teamId/members/:memberId

Update a team member's role. Requires `team:manage_members` permission.

**Request body:**

```json
{
  "role": "MAINTAINER"
}
```

**Response 200:** Updated membership object.

### DELETE /api/teams/:teamId/members/:memberId

Remove a member from a team. Requires `team:manage_members` permission.

**Response 204:** No content.

---

## Projects

Base path: `/api/projects`

All endpoints require authentication.

### POST /api/projects/team/:teamId

Create a project within a team. Requires `project:create` permission.

**Request body:**

```json
{
  "name": "Axiom MVP",
  "slug": "axiom-mvp",
  "prefix": "AXM",
  "description": "Main product project"
}
```

**Response 201:** Project object.

### GET /api/projects/team/:teamId

List projects within a team. Requires `issue:view` permission.

**Response 200:**

```json
{
  "projects": [
    {
      "id": "proj_01HZ...",
      "name": "Axiom MVP",
      "slug": "axiom-mvp",
      "prefix": "AXM",
      "issueCount": 42
    }
  ]
}
```

### GET /api/projects/:projectId

Get a single project.

**Response 200:** Full project object.

### GET /api/projects/:projectId/analytics

Get project analytics (issue counts, burndown data, velocity).

**Response 200:** Analytics object.

### PATCH /api/projects/:projectId

Update a project.

**Request body** (all fields optional):

```json
{
  "name": "Axiom MVP v2",
  "description": "Updated description"
}
```

**Response 200:** Updated project object.

### DELETE /api/projects/:projectId

Delete a project.

**Response 204:** No content.

---

## Issues

Base path: `/api/projects/:projectId/issues`

All endpoints require authentication and project access.

### POST /api/projects/:projectId/issues

Create an issue.

**Request body:**

```json
{
  "title": "Add dark mode support",
  "description": "Users need a dark mode toggle in settings.",
  "type": "FEATURE",
  "priority": "MEDIUM",
  "status": "TODO",
  "assigneeId": "usr_01HZ...",
  "labelNames": ["frontend", "ux"],
  "milestoneId": "ms_01HZ...",
  "sprintId": "spr_01HZ...",
  "dueDate": "2026-04-15T00:00:00.000Z",
  "storyPoints": 5
}
```

**Response 201:**

```json
{
  "id": "iss_01HZ...",
  "number": 42,
  "title": "Add dark mode support",
  "status": "TODO",
  "priority": "MEDIUM",
  "createdAt": "2026-03-27T10:00:00.000Z"
}
```

### GET /api/projects/:projectId/issues

List issues in a project.

**Query parameters:**

| Parameter     | Type    | Description                                                                                                                                                                                                                                                  |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `status`      | string  | Filter by status (`TODO`, `IN_PROGRESS`, `DONE`, etc.)                                                                                                                                                                                                       |
| `priority`    | string  | Filter by priority (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)                                                                                                                                                                                                     |
| `assigneeId`  | string  | Filter by assignee user ID                                                                                                                                                                                                                                   |
| `labelName`   | string  | Filter by label name                                                                                                                                                                                                                                         |
| `milestoneId` | string  | Filter by milestone                                                                                                                                                                                                                                          |
| `sprintId`    | string  | Filter by sprint                                                                                                                                                                                                                                             |
| `q`           | string  | Structured query string (see [Query Language Reference](#query-language-reference)). Supports simple mode (`type:bug priority:high`) and complex mode (`type = Bug AND priority IN (High, Critical)`). When provided, replaces all individual filter params. |
| `page`        | integer | Page number                                                                                                                                                                                                                                                  |
| `limit`       | integer | Items per page                                                                                                                                                                                                                                               |
| `sort`        | string  | Sort field (`createdAt`, `priority`, `number`)                                                                                                                                                                                                               |
| `order`       | string  | Sort direction: `asc` or `desc`                                                                                                                                                                                                                              |

**Response 200:** Paginated issue list.

### GET /api/projects/:projectId/issues/export

Export all issues as a CSV file.

**Response 200:** `text/csv` file download.

### PATCH /api/projects/:projectId/issues/bulk

Bulk-update multiple issues.

**Request body:**

```json
{
  "issueIds": ["iss_01HZ...", "iss_02HZ..."],
  "update": {
    "status": "IN_PROGRESS",
    "assigneeId": "usr_01HZ..."
  }
}
```

**Response 200:**

```json
{
  "updated": 2
}
```

### GET /api/projects/:projectId/issues/hydrate

Get the issues list with full relational data loaded (labels, assignees, milestones).

**Response 200:** Hydrated issue list.

### GET /api/projects/:projectId/issues/:issueNumber

Get a single issue by its project-scoped number (e.g., `42` for `AXM-42`).

**Response 200:**

```json
{
  "id": "iss_01HZ...",
  "number": 42,
  "title": "Add dark mode support",
  "description": "Users need a dark mode toggle in settings.",
  "status": "TODO",
  "priority": "MEDIUM",
  "type": "FEATURE",
  "assignee": { "id": "usr_01HZ...", "username": "tim" },
  "labels": [{ "name": "frontend", "color": "#0075ca" }],
  "milestone": null,
  "sprint": null,
  "storyPoints": 5,
  "createdAt": "2026-03-27T10:00:00.000Z",
  "updatedAt": "2026-03-27T10:00:00.000Z"
}
```

### PATCH /api/projects/:projectId/issues/:issueNumber

Update an issue.

**Request body** (all fields optional):

```json
{
  "title": "Updated title",
  "status": "IN_PROGRESS",
  "priority": "HIGH",
  "assigneeId": "usr_01HZ...",
  "labelNames": ["frontend"],
  "milestoneId": "ms_01HZ...",
  "storyPoints": 8
}
```

**Response 200:** Updated issue object.

### DELETE /api/projects/:projectId/issues/:issueNumber

Delete an issue.

**Response 204:** No content.

### GET /api/projects/:projectId/issues/:issueNumber/hydrate

Get a fully hydrated issue with all related data.

**Response 200:** Full issue detail object.

### PATCH /api/projects/:projectId/issues/:issueNumber/move

Move an issue to a different board column.

**Request body:**

```json
{
  "columnId": "col_01HZ...",
  "position": 2
}
```

**Response 200:** Updated issue object.

### PATCH /api/projects/:projectId/issues/:issueNumber/parent

Set or remove the parent issue for hierarchy tracking.

**Request body:**

```json
{
  "parentId": "iss_01HZ..."
}
```

Set `parentId` to `null` to remove the parent relationship.

**Response 200:** Updated issue object.

### GET /api/projects/:projectId/issues/:issueNumber/children

Get child issues (sub-tasks).

**Response 200:** Array of child issue objects.

### GET /api/projects/:projectId/issues/:issueNumber/progress

Get hierarchy completion progress (ratio of done children).

**Response 200:**

```json
{
  "total": 5,
  "completed": 3,
  "percent": 60
}
```

### POST /api/projects/:projectId/issues/:issueNumber/comments

Add a comment to an issue.

**Request body:**

```json
{
  "body": "I have started looking into this."
}
```

**Response 201:** Created comment object.

### PATCH /api/projects/:projectId/comments/:commentId

Edit a comment.

**Request body:**

```json
{
  "body": "Updated comment text."
}
```

**Response 200:** Updated comment object.

### DELETE /api/projects/:projectId/comments/:commentId

Delete a comment.

**Response 204:** No content.

### POST /api/projects/:projectId/issues/:issueNumber/worklogs

Log time spent on an issue.

**Request body:**

```json
{
  "timeSpentMinutes": 90,
  "description": "Implemented feature",
  "loggedAt": "2026-03-27T14:00:00.000Z"
}
```

**Response 201:** Created worklog object.

### GET /api/projects/:projectId/issues/:issueNumber/worklogs

Get worklogs for an issue.

**Response 200:** Array of worklog objects.

### GET /api/projects/:projectId/issues/:issueNumber/links

Get issue links (blocking, blocked-by, related, etc.).

**Response 200:** Array of link objects.

### POST /api/projects/:projectId/issues/:issueNumber/links

Link two issues together.

**Request body:**

```json
{
  "targetIssueId": "iss_02HZ...",
  "linkType": "BLOCKS"
}
```

Link types: `BLOCKS`, `BLOCKED_BY`, `RELATES_TO`, `DUPLICATES`, `DUPLICATED_BY`.

**Response 201:** Created link object.

### DELETE /api/projects/:projectId/issues/:issueNumber/links/:linkId

Remove a link between issues.

**Response 204:** No content.

### POST /api/projects/:projectId/issues/:issueNumber/votes/toggle

Toggle a vote (upvote/unvote) on an issue.

**Response 200:**

```json
{
  "voted": true,
  "voteCount": 7
}
```

### GET /api/projects/:projectId/issues/:issueNumber/votes

Get votes for an issue.

**Response 200:**

```json
{
  "voteCount": 7,
  "voters": [{ "id": "usr_01HZ...", "username": "tim" }]
}
```

### POST /api/projects/:projectId/issues/:issueNumber/watchers/toggle

Toggle watching or unwatching an issue.

**Response 200:**

```json
{
  "watching": true
}
```

### GET /api/projects/:projectId/issues/:issueNumber/watchers

Get watchers for an issue.

**Response 200:** Array of user objects.

---

## Board

Base path: `/api/projects/:projectId`

All endpoints require authentication and project access.

### GET /api/projects/:projectId/board

Get the Kanban board with columns and their issues.

**Response 200:**

```json
{
  "columns": [
    {
      "id": "col_01HZ...",
      "name": "To Do",
      "order": 0,
      "issues": [...]
    }
  ]
}
```

### POST /api/projects/:projectId/board/columns

Create a new board column.

**Request body:**

```json
{
  "name": "In Review",
  "status": "IN_REVIEW"
}
```

**Response 201:** Created column object.

### PATCH /api/projects/:projectId/board/columns/reorder

Reorder board columns.

**Request body:**

```json
{
  "columnIds": ["col_01HZ...", "col_03HZ...", "col_02HZ..."]
}
```

**Response 200:** Updated columns array.

### PATCH /api/projects/:projectId/board/columns/:columnId

Update a board column.

**Request body:**

```json
{
  "name": "In Progress",
  "wipLimit": 5
}
```

**Response 200:** Updated column object.

### DELETE /api/projects/:projectId/board/columns/:columnId

Delete a board column.

**Response 204:** No content.

---

## Roadmap

### GET /api/projects/:projectId/roadmap

Get issues formatted for the roadmap view, including `startDate` and `dueDate` fields.

**Response 200:** Array of roadmap items.

### PATCH /api/projects/:projectId/roadmap/issues/:issueId/bucket

Move an issue to a roadmap bucket of its project. Needs `issue:edit`, as the other roadmap writes do. Action: `roadmap.setIssueBucket`.

**Request body:** `{ "bucketId": "..." }`, or `null` for no bucket.

**Response 200:** The issue as the roadmap shows it. `404` for an issue or bucket outside this project.

### PATCH /api/projects/:projectId/roadmap/issues/:issueId/dates

Set an issue's dates on the roadmap. Needs `issue:edit`. A date left out stays as it is, `null` clears it. Action: `roadmap.setIssueDates`.

**Request body:** `{ "startDate": "2026-11-05", "dueDate": "2026-11-19" }`, at least one of them.

**Response 200:** The issue as the roadmap shows it. `400` for no date, or a start after the due date.

---

## Time Report

### GET /api/projects/:projectId/time-report

Get an aggregated time-tracking report for the project.

**Query parameters:** `from`, `to` (ISO date strings), `userId`

**Response 200:** Time report with per-user and per-issue breakdowns.

---

## Activity

Base path: `/api/projects/:projectId`

All endpoints require authentication and project access.

### GET /api/projects/:projectId/activity

Get project-level activity feed.

**Query parameters:** `page`, `limit`

**Response 200:** Paginated activity events.

### GET /api/projects/:projectId/issues/:issueNumber/activity

Get activity feed for a specific issue.

**Response 200:** Array of activity events.

## Sprints

Base path: `/api/projects/:projectId`

All endpoints require authentication and project access.

### POST /api/projects/:projectId/sprints

Create a sprint.

**Request body:**

```json
{
  "name": "Sprint 1",
  "goal": "Ship dark mode and notification system",
  "startDate": "2026-04-01T00:00:00.000Z",
  "endDate": "2026-04-14T00:00:00.000Z"
}
```

**Response 201:** Sprint object.

### GET /api/projects/:projectId/sprints

List all sprints.

**Response 200:** Array of sprint objects.

### GET /api/projects/:projectId/sprints/:sprintId

Get a single sprint with its issues.

**Response 200:** Sprint object.

### PATCH /api/projects/:projectId/sprints/:sprintId

Update a sprint.

**Request body** (all fields optional):

```json
{
  "name": "Sprint 1 Updated",
  "goal": "Revised goal",
  "endDate": "2026-04-21T00:00:00.000Z"
}
```

**Response 200:** Updated sprint object.

### POST /api/projects/:projectId/sprints/:sprintId/start

Start a sprint.

**Response 200:** Started sprint object.

### POST /api/projects/:projectId/sprints/:sprintId/complete

Complete a sprint. Unfinished issues move to the backlog or a new sprint.

**Request body:**

```json
{
  "unfinishedIssueDestination": "backlog"
}
```

**Response 200:** Sprint completion summary.

### POST /api/projects/:projectId/sprints/:sprintId/issues

Add issues to a sprint.

**Request body:**

```json
{
  "issueIds": ["iss_01HZ...", "iss_02HZ..."]
}
```

**Response 200:** Updated sprint object.

### DELETE /api/projects/:projectId/sprints/:sprintId/issues/:issueId

Remove an issue from a sprint (moves it to backlog).

**Response 204:** No content.

### GET /api/projects/:projectId/velocity

Get sprint velocity chart data.

**Response 200:** Array of per-sprint velocity data points.

### GET /api/projects/:projectId/backlog

Get the backlog (issues not assigned to any sprint).

**Response 200:** Array of backlog issues.

### GET /api/projects/:projectId/backlog/hydrate

Get a fully hydrated backlog with all relational data.

**Response 200:** Hydrated backlog.

---

## Labels

Base path: `/api/projects/:projectId/labels`

All endpoints require authentication and project access.

### POST /api/projects/:projectId/labels

Create a label.

**Request body:**

```json
{
  "name": "bug",
  "color": "#d73a4a",
  "description": "Something is not working"
}
```

**Response 201:** Label object.

### GET /api/projects/:projectId/labels

List all labels in a project.

**Response 200:**

```json
{
  "labels": [{ "name": "bug", "color": "#d73a4a", "description": "Something is not working" }]
}
```

### PATCH /api/projects/:projectId/labels/:labelName

Update a label.

**Request body:**

```json
{
  "color": "#e4e669",
  "description": "Updated description"
}
```

**Response 200:** Updated label object.

### DELETE /api/projects/:projectId/labels/:labelName

Delete a label.

**Response 204:** No content.

---

## Milestones

Base path: `/api/projects`

All endpoints require authentication.

### POST /api/projects/:projectId/milestones

Create a milestone.

**Request body:**

```json
{
  "title": "v1.0 Launch",
  "description": "First public release",
  "dueDate": "2026-06-01T00:00:00.000Z"
}
```

**Response 201:** Milestone object.

### GET /api/projects/:projectId/milestones

List milestones for a project.

**Response 200:** Array of milestone objects.

### GET /api/projects/milestones/:milestoneId

Get a single milestone with issue counts.

**Response 200:** Milestone object.

### PATCH /api/projects/milestones/:milestoneId

Update a milestone.

**Request body** (all fields optional):

```json
{
  "title": "v1.0 Launch",
  "dueDate": "2026-07-01T00:00:00.000Z",
  "status": "OPEN"
}
```

**Response 200:** Updated milestone object.

### DELETE /api/projects/milestones/:milestoneId

Delete a milestone.

**Response 204:** No content.

---

## Custom Fields

Base paths: `/api/projects` and `/api`

All endpoints require authentication.

### POST /api/projects/:projectId/custom-fields

Create a custom field definition for a project.

**Request body:**

```json
{
  "name": "Story Points",
  "type": "NUMBER",
  "required": false
}
```

Field types: `TEXT`, `NUMBER`, `DATE`, `SELECT`, `MULTI_SELECT`, `USER`.

**Response 201:** Field definition object.

### GET /api/projects/:projectId/custom-fields

List custom field definitions for a project.

**Response 200:** Array of field definition objects.

### PATCH /api/custom-fields/:fieldId

Update a custom field definition.

**Request body:**

```json
{
  "name": "Effort",
  "required": true
}
```

**Response 200:** Updated definition.

### DELETE /api/custom-fields/:fieldId

Delete a custom field definition.

**Response 204:** No content.

### PUT /api/issues/:issueId/custom-fields/:fieldId

Set a custom field value on an issue.

**Request body:**

```json
{
  "value": 8
}
```

**Response 200:** Updated field value.

### GET /api/issues/:issueId/custom-fields

Get all custom field values for an issue.

**Response 200:** Array of `{ field, value }` objects.

---

## Issue Templates

Base path: `/api/projects/:projectId/issue-templates`

All endpoints require authentication and project access.

### POST /api/projects/:projectId/issue-templates

Create an issue template.

**Request body:**

```json
{
  "name": "Bug Report",
  "description": "Template for reporting bugs",
  "content": "## Steps to reproduce\n\n## Expected behavior\n\n## Actual behavior",
  "type": "BUG",
  "priority": "HIGH"
}
```

**Response 201:** Template object.

### GET /api/projects/:projectId/issue-templates

List issue templates.

**Response 200:** Array of template objects.

### GET /api/projects/:projectId/issue-templates/:templateId

Get a single issue template.

**Response 200:** Template object.

### PATCH /api/projects/:projectId/issue-templates/:templateId

Update an issue template.

**Response 200:** Updated template object.

### DELETE /api/projects/:projectId/issue-templates/:templateId

Delete an issue template.

**Response 204:** No content.

---

## Workflow Rules

Base path: `/api/projects/:projectId/workflow-rules`

All endpoints require authentication and project access.

### POST /api/projects/:projectId/workflow-rules

Create a workflow rule that restricts a status transition and can require fields to be filled in.

**Request body:**

```json
{
  "fromColumnId": "col_01HZ...",
  "toColumnId": "col_01HZ...",
  "requiredFields": ["assigneeId"]
}
```

**Response 201:** Workflow rule object.

### GET /api/projects/:projectId/workflow-rules

List workflow rules.

**Response 200:** Array of rule objects.

### PATCH /api/projects/:projectId/workflow-rules/:ruleId

Update a workflow rule.

**Response 200:** Updated rule object.

### DELETE /api/projects/:projectId/workflow-rules/:ruleId

Delete a workflow rule.

**Response 204:** No content.

---

## Automation Rules

Base path: `/api/projects/:projectId/automation-rules`

All endpoints require authentication and project access.

### POST /api/projects/:projectId/automation-rules

Create an automation rule.

**Request body:**

```json
{
  "name": "Assign on critical label",
  "trigger": "label:added",
  "condition": "type = Bug AND priority IN (High, Critical)",
  "actions": [{ "type": "set_assignee", "userId": "usr_01HZ..." }],
  "enabled": true
}
```

The body is bounded and typed. An unknown trigger or action type answers `400`, and so does a field over its length or an action key no action type reads. That message names the key, for example `actions.0: no action type reads "colour": remove it from the action`, so a client saving a rule written elsewhere knows what to drop.

| Field        | Type    | Description                                                                                                                                  |
| ------------ | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | string  | Display name, 1 to 200 characters                                                                                                            |
| `trigger`    | string  | One of `issue:created`, `issue:status_changed`, `issue:assigned`, `label:added`                                                              |
| `condition`  | string  | Optional query string evaluated before the actions run, up to 2000 characters (e.g. `"type = Bug AND priority IN (High, Critical)"`). Validated on write |
| `conditions` | array   | **Deprecated.** The older JSON condition format, at most 50 entries. Use `condition` instead                                                  |
| `actions`    | array   | At most 50 actions, each with a `type` from the table below and the fields that type reads                                                    |
| `enabled`    | boolean | Optional                                                                                                                                     |

Text fields of an action are capped: `body`, `value` 5000 characters, `title`, `to`, `subject` 500, `url` 2000, `name` 200, `field` 100. Actions support `{{expression}}` template variables.

**Action types:**

| `type`         | Description                                                                                                                                                                                                                  | Fields                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `set_status`   | Move the issue to a column                                                                                                                                                                                                   | `columnId`                              |
| `set_assignee` | Assign the issue to a user                                                                                                                                                                                                   | `userId`                                |
| `add_label`    | Add a label to the issue                                                                                                                                                                                                     | `name`                                  |
| `add_comment`  | Comment on the issue                                                                                                                                                                                                         | `body`                                  |
| `set_field`    | Set a plain content field (`title`, `body`, `priority`, `type`, `storyPoints`, `timeEstimate`, `dueDate`, `startDate`) or a custom field (`custom:<name>`). Ids, the column, the assignee and other relations are refused | `field`, `value`                        |
| `create_issue` | Create a new linked issue                                                                                                                                                                                                    | `title`, `body`, and other issue fields |
| `send_email`   | Send an email                                                                                                                                                                                                                | `to`, `subject`, `body`                 |
| `webhook`      | Send an HTTP request to a URL                                                                                                                                                                                                | `url`, `method`, `headers`, `data`      |

Automation rules are project settings. Writing one needs team ADMIN or higher, and a token needs `automation:write`. A rule write is an ordinary write for a token, it doesn't wait for approval.

**Response 201:** Automation rule object.

### GET /api/projects/:projectId/automation-rules

List automation rules.

**Response 200:** Array of automation rule objects.

### PATCH /api/projects/:projectId/automation-rules/:ruleId

Update an automation rule. Accepts the same fields as the POST body (all optional).

**Response 200:** Updated rule object.

### DELETE /api/projects/:projectId/automation-rules/:ruleId

Delete an automation rule.

**Response 204:** No content.

### POST /api/projects/:projectId/automation-rules/:ruleId/toggle

Enable or disable an automation rule.

**Response 200:**

```json
{
  "enabled": false
}
```

---

## Wiki

Base path: `/api/wiki`

All endpoints require authentication.

### POST /api/wiki/team/:teamId/spaces

Create a wiki space. Requires `wiki:create_space` permission.

**Request body:**

```json
{
  "name": "Engineering",
  "slug": "engineering",
  "description": "Engineering team documentation"
}
```

**Response 201:** Wiki space object.

### GET /api/wiki/team/:teamId/spaces

List wiki spaces for a team. Requires `wiki:view` permission.

**Response 200:** Array of wiki space objects.

### GET /api/wiki/spaces/:spaceId

Get a wiki space.

**Response 200:** Wiki space object.

### GET /api/wiki/spaces/:spaceId/tree

Get the hierarchical page tree for a wiki space.

**Response 200:** Nested tree of page objects.

### POST /api/wiki/spaces/:spaceId/pages

Create a wiki page.

**Request body:**

```json
{
  "title": "Architecture Overview",
  "slug": "architecture-overview",
  "content": "# Architecture Overview\n\nThis document describes...",
  "parentId": null
}
```

**Response 201:** Wiki page object.

### GET /api/wiki/spaces/:spaceId/pages/:pageSlug

Get a wiki page by slug.

**Response 200:** Full wiki page object, plus:

| Field     | Type    | Description                                                                                                                                              |
| --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canEdit` | boolean | Whether the caller may edit the page: `EDIT` access to the space and no page restriction that blocks them. The editor opens read-only when it is `false` |

### PATCH /api/wiki/spaces/:spaceId/pages/:pageSlug

Update a wiki page.

**Request body:**

```json
{
  "title": "Updated Title",
  "body": "Updated Markdown...",
  "changeDescription": "Why it changed"
}
```

All fields are optional. `body` is always Markdown and is normalised before it is stored. Requires `EDIT` access to the space and edit permission on the page.

**Response 200:** The updated wiki page object, plus:

| Field               | Type    | Description                                                                                                                    |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pendingMerge`      | boolean | `true` while a change waits for an editor to merge it: the page is open in the editor, or an ended session left unmerged edits |
| `externalVersionId` | string  | The version the merge will use. Only present when `pendingMerge` is `true`                                                     |

While a change is pending, `Page.body` already holds the new text. The version it replaced is kept as the merge base, and the change is recorded in the history as kind `EXTERNAL`. A body change that nobody has to merge is recorded as `EDIT`.

### GET /api/wiki/spaces/:spaceId/pages/:pageSlug/pending-merge

The three texts needed to merge a pending change. Requires edit permission on the page.

**Response 200:** `null` when nothing is pending. Otherwise:

| Field                        | Type   | Description                                                   |
| ---------------------------- | ------ | ------------------------------------------------------------- |
| `base`                       | string | The Markdown both sides started from                          |
| `ours`                       | string | The open session's text, or an ended session's unmerged draft |
| `theirs`                     | string | The other side: the external change, or a draft               |
| `oursLabel` / `theirsLabel`  | string | Display labels, for example `Yours` and the author's name     |
| `externalVersionId`          | string | The pending change. Send it back when you apply the merge     |
| `authorName`, `at`           | string | Who made the external change and when                         |
| `draftAuthorName`, `draftAt` | string | Set when one side is an ended session's draft                 |

### POST /api/wiki/spaces/:spaceId/pages/:pageSlug/merge

Apply a merged body for the pending change. Requires edit permission on the page.

**Request body:**

```json
{
  "externalVersionId": "...",
  "markdown": "The merged Markdown",
  "ours": "The session text the merge was computed against"
}
```

All three fields are required. The merged body becomes `Page.body`, is recorded as a `MERGE` version and replaces the content of the open session for everyone. If the session changed after you fetched `ours`, the server rebases the merge onto the session's current text.

**Response 204:** No content.

**Response 409:** The `error.code` tells the cases apart:

| Code                    | Meaning                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `MERGE_STALE`           | The change was merged already, or a newer one arrived. Fetch the pending merge again |
| `MERGE_IN_PROGRESS`     | Someone else is applying a merge                                                     |
| `MERGE_REBASE_CONFLICT` | Edits made in the session after your fetch overlap the merge                         |

### POST /api/wiki/spaces/:spaceId/pages/:pageSlug/collab/flush

Save the live editing session of the page to the database now, so the stored body matches what the editor shows. Requires edit permission on the page.

**Request body (optional):**

```json
{
  "changeDescription": "Why it changed"
}
```

`changeDescription` (at most 500 characters) is stored on the version the save creates. When the session has nothing new to save, a version of the unchanged page carries it, so the description is never dropped.

**Response 200:** `{ "flushed": true }` when a live session was saved, `{ "flushed": false }` when nobody has the page open.

### DELETE /api/wiki/spaces/:spaceId/pages/:pageSlug

Delete a wiki page.

**Response 204:** No content.

### GET /api/wiki/spaces/:spaceId/pages/:pageSlug/hydrate

Get a fully hydrated wiki page with comments and labels.

**Response 200:** Hydrated page object.

### GET /api/wiki/spaces/:spaceId/pages/:pageSlug/history

Get revision history for a wiki page, newest first.

**Response 200:** Array of revision objects. Each has a `kind`:

| Kind            | Written by                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `EDIT`          | A save from the editor or a plain API update                                                                              |
| `EXTERNAL`      | An API, MCP or other non-editor change that an editor session has to merge (a live one, or an ended one's unmerged draft) |
| `SESSION_DRAFT` | An editor session's text, saved before a merge so nothing is lost                                                         |
| `MERGE`         | The result of applying a merge                                                                                            |
| `RESTORE`       | Restoring an earlier version                                                                                              |

The head of a page is `Page.body`, not the highest version number.

### GET /api/wiki/spaces/:spaceId/pages/:pageSlug/export

Export a wiki page in the specified format.

**Query parameters:**

| Parameter | Type   | Description                                                          |
| --------- | ------ | -------------------------------------------------------------------- |
| `format`  | string | Export format: `md`, `html`, `pdf`, `docx`, `epub`, `latex`, `plain` |

**Response 200:** File download in the requested format.

### POST /api/wiki/spaces/:spaceId/templates

Create a wiki page template.

**Request body:**

```json
{
  "name": "Meeting Notes",
  "content": "# Meeting Notes\n\n**Date:** {{date}}\n\n## Attendees\n\n## Agenda\n"
}
```

**Response 201:** Template object.

### GET /api/wiki/spaces/:spaceId/templates

List templates in a wiki space.

**Response 200:** Array of template objects.

### GET /api/wiki/templates/:templateId

Get a single wiki template.

**Response 200:** Template object.

### DELETE /api/wiki/templates/:templateId

Delete a wiki template.

**Response 204:** No content.

### POST /api/wiki/resolve-template

Resolve template variables in a wiki template body. All `{{expression}}` placeholders are evaluated against the supplied context and returned as a plain string. **Auth required.**

**Request body:**

```json
{
  "body": "# {{project.name}} — Sprint {{sprint.name}}\n\nCreated by {{currentUser()}} on {{now()}}",
  "context": {
    "teamId": "team_01HZ...",
    "spaceId": "space_01HZ...",
    "projectId": "proj_01HZ..."
  }
}
```

| Field               | Type   | Description                                                |
| ------------------- | ------ | ---------------------------------------------------------- |
| `body`              | string | Template body containing `{{expression}}` placeholders     |
| `context.teamId`    | string | Team ID used for resolving team-scoped variables           |
| `context.spaceId`   | string | Wiki space ID                                              |
| `context.projectId` | string | Optional project ID for resolving project-scoped variables |

**Response 200:**

```json
{
  "body": "# Axiom MVP — Sprint 3\n\nCreated by tim on 2026-03-29"
}
```

### POST /api/wiki/pages/:pageId/comments

Add a comment to a wiki page.

**Request body:**

```json
{
  "body": "Great documentation!"
}
```

**Response 201:** Comment object.

### GET /api/wiki/pages/:pageId/comments

List comments on a wiki page.

**Response 200:** Array of comment objects.

### PATCH /api/wiki/comments/:commentId

Update a wiki page comment.

**Request body:**

```json
{
  "body": "Updated comment."
}
```

**Response 200:** Updated comment object.

### DELETE /api/wiki/comments/:commentId

Delete a wiki page comment.

**Response 204:** No content.

### GET /api/wiki/pages/:pageId/labels

List labels on a wiki page.

**Response 200:** Array of label strings.

### POST /api/wiki/pages/:pageId/labels

Add a label to a wiki page.

**Request body:**

```json
{
  "label": "architecture"
}
```

**Response 201:** Updated labels array.

### DELETE /api/wiki/pages/:pageId/labels/:label

Remove a label from a wiki page.

**Response 204:** No content.

### GET /api/wiki/spaces/:spaceId/labels

Search pages in a space by label.

**Query parameters:** `label` (string)

**Response 200:** Array of matching pages.

### POST /api/wiki/pages/:pageId/move

Move a wiki page to a different parent or space.

**Request body:**

```json
{
  "parentId": "page_02HZ...",
  "spaceId": "space_01HZ..."
}
```

**Response 200:** Updated page object.

### POST /api/wiki/pages/:pageId/copy

Copy a wiki page.

**Request body:**

```json
{
  "parentId": "page_03HZ...",
  "title": "Copy of Architecture Overview"
}
```

**Response 201:** New page object.

---

## Search

Base path: `/api/search`

All endpoints require authentication.

### GET /api/search

Full-text search across issues and wiki pages.

**Query parameters:**

| Parameter   | Type   | Description                     |
| ----------- | ------ | ------------------------------- |
| `q`         | string | Search query (required)         |
| `type`      | string | Filter by type: `issue`, `wiki` |
| `orgId`     | string | Limit to an organization        |
| `teamId`    | string | Limit to a team                 |
| `projectId` | string | Limit to a project              |

**Response 200:**

```json
{
  "results": [
    {
      "type": "issue",
      "id": "iss_01HZ...",
      "title": "Add dark mode support",
      "excerpt": "Users need a dark mode toggle...",
      "url": "/aranea-dev/axiom/axiom-mvp/issues/42"
    }
  ],
  "total": 12
}
```

### GET /api/search/saved

List saved searches for the current user.

**Response 200:** Array of saved search objects.

### POST /api/search/saved

Save a search query.

**Request body:**

```json
{
  "name": "My open critical issues",
  "query": "priority:critical status:open assignee:me"
}
```

**Response 201:** Saved search object.

### DELETE /api/search/saved/:id

Delete a saved search.

**Response 204:** No content.

---

## Notifications

Base path: `/api/notifications`

All endpoints require authentication.

### GET /api/notifications

List notifications for the current user. A token's list leaves out agent approval notifications, as they carry the preview of what an agent wants to run.

**Query parameters:** `read` (boolean), `page`, `limit`

**Response 200:** Paginated notification list.

### GET /api/notifications/unread-count

Get the count of unread notifications.

**Response 200:**

```json
{
  "count": 5
}
```

### PATCH /api/notifications/:id/read

Mark a notification as read. A token can't mark an agent approval notification read (`403`): you do that in the web UI.

**Response 200:** Updated notification object.

### POST /api/notifications/read-all

Mark all notifications as read. A token leaves the agent approval notifications unread.

**Response 200:**

```json
{
  "updated": 5
}
```

### GET /api/notifications/preferences

Get the current user's notification preferences.

**Response 200:**

```json
{
  "preferences": [
    {
      "event": "ISSUE_ASSIGNED",
      "email": true,
      "inApp": true
    }
  ]
}
```

### PATCH /api/notifications/preferences

Update a notification preference.

**Request body:**

```json
{
  "event": "ISSUE_ASSIGNED",
  "email": false,
  "inApp": true
}
```

---

## Query Language Reference

The query engine is used in two places:

- The `q` parameter on `GET /api/projects/:projectId/issues` for structured issue filtering.
- The `condition` field on automation rules for conditional execution.
- The `query` of `query.run`, saved queries and dashboard widgets, which add the clauses under [Clauses](#clauses).

### Simple Mode

Key-value pairs separated by spaces. All conditions are ANDed together.

```
type:bug priority:high assignee:@me
```

Field names and values are case-insensitive. Multi-word values must be quoted:

```
status:"In Progress" label:"needs review"
```

### Complex Mode

Full boolean expressions with parentheses for grouping.

```
type = Bug AND (priority IN (High, Critical) OR storyPoints > 5)
```

```
status != Done AND assignee = currentUser() AND created >= now(-7d)
```

### Field Reference

| Field         | Type   | Notes                                            |
| ------------- | ------ | ------------------------------------------------ |
| `type`        | string | Issue type name (e.g. `Bug`, `Feature`, `Task`)  |
| `status`      | string | Status name (e.g. `Todo`, `In Progress`, `Done`) |
| `priority`    | string | `Low`, `Medium`, `High`, `Critical`              |
| `assignee`    | string | Username, user ID, or `@me` / `currentUser()`    |
| `creator`     | string | Username or user ID                              |
| `label`       | string | Label name                                       |
| `sprint`      | string | Sprint name, sprint ID or `currentSprint()`      |
| `project`     | string | Project prefix or ID                             |
| `storyPoints` | number | Story point estimate                             |
| `created`     | date   | Creation timestamp                               |
| `updated`     | date   | Last-updated timestamp                           |
| `dueDate`     | date   | Due date                                         |
| `number`      | number | Issue number within the project                  |
| `title`       | string | Issue title (use `~` for contains)               |
| `blocked`     | boolean | Waits on an issue that isn't in a done column: an own `IS_BLOCKED_BY` link to it, or a `BLOCKS` link from it. `= true` or `= false` |
| `blocks`      | boolean | The issue isn't done and has a blocking link to another issue, stored on either side. A done issue blocks nothing |
| `linked`      | issue key | Any link to that issue, either way: `linked = AXM-12`. A key you can't see matches nothing, as a missing one does. `linked = null` asks for no links at all. A key with org and team is quoted: `linked = "org/team/AXM-12"` |
| `text`        | string | Title or body, with `~` only: `text ~ "login"` |
| `done`        | boolean | The issue's column is a done column. An issue outside any column is not done |
| `sprintstate` | enum   | `PLANNING`, `ACTIVE` or `COMPLETED`. `= null` asks for no sprint; `!=` includes issues without one |
| `cf.Name`     | by definition | A custom field, `cf.Name` or `cf."Name with spaces"`, see below |

The fields `blocked`, `blocks`, `linked`, `text`, `done` and `sprintstate` only work in complex mode. In simple mode `done:true` stays plain text.

### Custom fields

The name is case-insensitive. A name that no project in your view has is a 400 naming the field, and a field in a project you can't see answers exactly like that. When projects define one name with different types, each compares by its own type.

| Definition type | Operators | Compares |
| --------------- | --------- | -------- |
| `TEXT`, `SELECT` | `=`, `!=`, `~` | Text, case-insensitive |
| `NUMBER` | `=`, `!=`, `>`, `<`, `>=`, `<=` | By value, so `10 > 9`; `"1.5"` and `1.5` are the same |
| `DATE` | `=`, `!=`, `>`, `<`, `>=`, `<=` | By value; dates like `"2026-03-01"` and functions like `now(-7d)` |
| `USER` | `=`, `!=` | A username, the user id, or `currentUser()` |
| `MULTI_SELECT` | `=`, `!=` | Membership: `cf.Areas = Web` matches `Api,Web` |

A value that can't be read as the definition's type matches nothing, and so does a stored value that doesn't read as its type. `!=` also holds for an issue with no value, in a project that has the field; in other projects no comparison on the field holds. `= null` asks for no value or a cleared one, `!= null` for a filled one. `IN` and `NOT IN` work as a list of `=` and `!=`.

### Operator Reference

| Operator | Description                | Example                           |
| -------- | -------------------------- | --------------------------------- |
| `=`      | Equal                      | `priority = High`                 |
| `!=`     | Not equal                  | `status != Done`                  |
| `>`      | Greater than               | `storyPoints > 3`                 |
| `<`      | Less than                  | `storyPoints < 8`                 |
| `>=`     | Greater than or equal      | `created >= now(-7d)`             |
| `<=`     | Less than or equal         | `dueDate <= now()`                |
| `~`      | Contains (substring). On `assignee`, `creator`, `sprint` and `project` it reads the username, sprint name or prefix; `~ currentUser()` asks the same as `= currentUser()` | `title ~ "login"`, `project ~ OV` |
| `IN`     | Matches any value in list  | `priority IN (High, Critical)`    |
| `NOT IN` | Matches none of the values | `status NOT IN (Done, Cancelled)` |

Operators are case-insensitive (`IN`, `in`, and `In` are all valid).

An empty field is no value, so it is different from every value: `!=`, `NOT IN` and `NOT` include it. `NOT assignee = tim` and `assignee != tim` both find unassigned issues, and `NOT storyPoints > 3` finds issues without story points. Search and automation conditions answer alike.

`null` (without quotes) is the empty value, as `empty()` is: `assignee = null`. `"null"` is the text. Numbers may be negative and have a fraction: `cf.Cost > -1.5`.

Names with a hyphen or a space need quotes: `assignee = "jan-willem"`. An issue key is upper case, or quoted with org and team. A date in `YYYY-MM-DD` form needs no quotes: `created > 2026-01-31`.

Text next to a comparison searches for that text, as with `type:bug login`: `type = Bug login page`.

### Function Reference

| Function          | Description                                      | Example                    |
| ----------------- | ------------------------------------------------ | -------------------------- |
| `currentUser()`   | Resolves to the authenticated user. Alias: `@me`. Without a user it equals nothing | `assignee = currentUser()` |
| `currentSprint()` | Issues in an active sprint, on `sprint` with `=` or `!=` | `sprint = currentSprint()` |
| `now()`           | Current timestamp, with optional offset          | `created >= now(-7d)`      |
| `startOfDay()`    | Midnight of the current day                      | `created >= startOfDay()`  |
| `startOfWeek()`   | Midnight of the first day of the current week    | `updated >= startOfWeek()` |
| `empty()`         | Matches null / unset fields                      | `assignee = empty()`       |

**`now()` offset syntax:** `now(-Nd)` subtracts N days; `now(+Nd)` adds N days. The units are `m`, `h`, `d` and `w`. An argument of another form is a parse error.

### Examples

```
# All open bugs assigned to me
type:bug status:open assignee:@me

# High-priority unassigned issues due this week
priority IN (High, Critical) AND assignee = empty() AND dueDate <= now(+7d)

# Issues updated in the last 24 hours, excluding Done
updated >= now(-1d) AND status != Done

# Large story points in the current sprint
sprint = currentSprint() AND storyPoints >= 8

# Title contains "auth" created this week
title ~ "auth" AND created >= startOfWeek()

# Open work that waits on something, in an active sprint
blocked = true AND done = false AND sprintstate = ACTIVE

# Expensive items by custom field
cf.Severity = High AND cf."Estimated cost" > 1000
```

### Clauses

`query.run`, saved queries, dashboard widgets and `search.run` (when the query contains a clause) take a query with optional clauses around the condition:

```
[SELECT COUNT, SUM(storypoints), AVG(storypoints)] [WHERE] condition [GROUP BY field, field] [ORDER BY field [ASC|DESC], ...]
```

The keywords are exact uppercase, as whole words, outside double quotes. `order by` in lower case stays text, which is why `where is login` is still a text search. The clauses come in the order shown, each at most once. A query that starts with `SELECT` needs `WHERE` before its condition. Without `SELECT`, `WHERE` is optional: `type = Bug ORDER BY created DESC`. A query with only `ORDER BY` or `GROUP BY` and no condition covers every issue you can see.

`GET /api/projects/:projectId/issues?q=` and automation conditions do not read clauses. They keep parsing what they always did.

**ORDER BY.** `ASC` is the default. These fields can be sorted: `type`, `status`, `priority`, `assignee`, `creator`, `sprint`, `project`, `storypoints`, `created`, `updated`, `duedate`, `number`, `title`, `done` and `sprintstate`. `label`, `blocked`, `blocks`, `linked`, `text` and custom fields (`cf.*`) cannot be sorted and answer `400`. Without `ORDER BY`, items come most recently updated first. Every sort ends in the issue id, so pages never shuffle.

- `priority` sorts by rank: `DESC` gives `CRITICAL` first.
- `status` sorts by column name, alphabetically, not along the board's workflow.
- Empty values: `storypoints` and `duedate` put issues without a value last in both directions. `assignee`, `creator`, `sprint` and `sprintstate` follow the database default, so an empty value is last ascending and first descending. In a grouped query an empty key follows that same rule.

**SELECT.** `COUNT` (or `COUNT(*)`), `SUM(storypoints)` and `AVG(storypoints)`. No other field can be summed or averaged. An issue without points adds nothing to a sum and is left out of an average (`avg` is `null` when no issue in the group has points). `SELECT` without `GROUP BY` gives one group with an empty key.

**GROUP BY.** One or two of `type`, `status`, `priority`, `assignee`, `creator`, `sprint`, `project`, `done` and `sprintstate`. `label`, custom fields, dates, `title`, `number`, `text`, `blocked`, `blocks` and `linked` cannot be grouped and answer `400`. `status` groups by column name across projects, so `Done` in two projects is one group. Groups come sorted by count, largest first, unless an `ORDER BY` says otherwise.

In a grouped query `ORDER BY` takes only fields from `GROUP BY`. It cannot order by `count`, `sum` or `avg`. A query that needs more than 5000 rows of database groups is refused with `400`; narrow it with a condition.

**Free text.** Text next to a comparison in a clause query (`type = Bug login`) is a substring match on title and body, like `text ~ "login"`. It is not the ranked search of `search.run` without clauses, which orders by relevance and puts a page titled exactly like the query first.

**Access.** Your access filter is applied before any limit, sort, group, count, sum or average, so a group key or a total never includes an issue you cannot open.

### POST /api/query

The REST binding of the action `query.run`.

| Field    | Type     | Description                                                                                   |
| -------- | -------- | --------------------------------------------------------------------------------------------- |
| `query`  | string   | Required, at most 1000 characters                                                             |
| `limit`  | integer  | Items per page or groups returned, 1 to 500, default 50                                       |
| `cursor` | string   | `nextCursor` of the previous page. Not accepted for a grouped query                           |
| `fields` | string[] | Item fields to return. Default: `fullKey`, `url`, `title`, `type`, `priority`, `status`, `assignee`, `sprint`, `project`, `storyPoints`, `dueDate`, `updatedAt`. Also `number`, `creator`, `labels`, `startDate`, `timeEstimate`, `timeSpent`, `createdAt` |
| `scope`  | object   | `{ orgId, teamId, projectId }` narrows the query. Something you cannot see gives an empty result |

**Response 200, items:** `{ "kind": "items", "items": [...], "nextCursor": "..." }`. `nextCursor` is there when more follow.

**Response 200, groups:** `{ "kind": "groups", "groups": [{ "key": { "status": "Done" }, "count": 4, "sum": 21, "avg": 5.25 }], "total": 9, "truncated": true }`. `total` counts the issues in all groups, also those past `limit`; `truncated` is present when `limit` cut groups off. `sum` and `avg` appear when selected.

A token needs `search:read` and `issues:read`. Past 30 requests per minute per user (shared with `search.run`) the answer is `429`. A bad query is `400 INVALID_QUERY`, a bad cursor `400 INVALID_CURSOR`.

`search.run` hands a query to `query.run` when it starts with `SELECT`, or contains `WHERE`, `GROUP BY` followed by a field, or `ORDER BY` followed by a field, in capitals. The answer is then the answer of `query.run`, issues only: wiki pages are not searched, also for `type: all`. With `type: wiki` the text search runs as before.

### Sprint overview

The action `sprint.overview` (MCP and `POST /api/act`) shows the progress of active sprints, or of planning sprints with `state: "PLANNING"`, in every project you can open. Narrow it with `scope` (`orgId`, `teamId`, `projectId`). A token needs `sprints:read` and nothing more.

Per sprint: `id`, `name`, `goal`, `project` (`key`, `name`), `startDate`, `endDate`, `daysLeft` (whole days, negative past the end date), `issues` (`total`, `done`, `inProgress`, `todo`), `points` (`committed`, `done`) and `blocked`. `includeBlocked: false` leaves `blocked` empty. Each blocked issue lists `key`, `title`, `assignee` and `blockedBy`; a blocker in a project you cannot open shows as `{ "hidden": true }`.

Two definitions to know. In progress is a heuristic on the column name, the one the sprint report uses: a column that is not done and not the default one counts as in progress when its name contains "progress", "review", "ontwikkeling" or "testen". Every other column, custom names included, counts as to do. And a sprint in `PLANNING` has no commitment yet, so its whole scope counts as committed. For an active sprint, committed points are those of the issues the sprint started with.

### Saved queries

Actions `savedQuery.list`, `get`, `create`, `update`, `delete` and `run`, also on REST under `/api/saved-filters` with the paths the UI filters use. `create` takes `name`, `text` (a query as `query.run` takes it), an optional `description` and `projectId`, and sharing. `run` takes `limit`, `cursor` and `fields`, and answers as `query.run`.

Filters the UI saved before are stored as they were. `savedQuery.run` converts one when that loses nothing, and answers `400` with the reason when it does not. Such a filter still opens in the UI.

**Sharing** (saved queries and dashboards alike): `visibility` is `PRIVATE` (default, only you), `TEAM` (with `teamId`) or `ORG` (with `orgId`). You can share with a team or org you belong to. Who sees it: the creator, members of that team or org, and platform admins. Something you cannot see answers `404`. Who may change or delete it: the creator; for `TEAM` also that team's admins; for `ORG` also the org's owners and admins; platform admins always.

A shared query always runs with the rights of whoever runs it, never those of its creator. Someone with less access sees fewer issues, and no count, sum or group key includes an issue they cannot open.

Scopes: `dashboards:read` and `dashboards:write`. Running a saved query also needs `issues:read`.

### Dashboards

Actions `dashboard.list`, `get`, `create`, `update`, `delete`, `render` and `renderEmbedded`, and `dashboardWidget.add`, `update`, `remove` and `reorder`. REST paths start at `/api/dashboards`: `/api/dashboards/:id/render`, `/api/dashboards/:id/widgets`, `PUT /api/dashboards/:id/widgets/order` and `POST /api/dashboards/embedded`. In the UI they live at `/dashboards` and `/dashboards/:id`; the personal page at `/dashboard` is a different thing. Sharing works as for saved queries. `layout` is `{ "columns": 1 to 4 }`.

A widget has a `type`, a `title`, a source and `options`:

| Type              | Source                    | Shows                                                                    |
| ----------------- | ------------------------- | ------------------------------------------------------------------------ |
| `COUNT`           | `savedQueryId` or `query` | The number of matching issues. A grouped query shows its groups          |
| `TABLE`, `LIST`   | `savedQueryId` or `query` | Items, or groups when the query has `GROUP BY` or `SELECT`               |
| `BAR`             | `savedQueryId` or `query` | A bar chart. The query needs `GROUP BY`, else the widget has an error    |
| `SPRINT_OVERVIEW` | none                      | The result of `sprint.overview`                                          |

`options`: `limit` (1 to 100, default 25), `state` (`ACTIVE` or `PLANNING`, for the sprint overview) and `scope` (`orgId`, `teamId`, `projectId`). To change a widget's source, give the new one and `null` for the other.

A widget on a saved query runs for anyone who can open the dashboard, with their own rights, as a wiki block does. Someone who cannot open that saved query gets its result, and neither its text nor, when it fails, the error's own wording. A deleted saved query gives the widget an error.

**Limits.** At most 24 widgets per dashboard (`400` beyond). A render runs at most 4 widgets at once, takes one read slot, and is limited to 60 per minute per user. A widget that fails, or needs a scope the token lacks (`issues:read` for query widgets, `sprints:read` for sprint overviews), has `{ "error": { "message", "code" } }` as its result and the others still render. `dashboard.render` also returns `projectIds`, the visible projects it reads, at most 50.

**Live updates.** The dashboard view joins the rooms of those projects and refetches the render after `issue:created`, `issue:updated`, `board:moved` or `sprint:updated`. The first event starts a 2 second wait and later events do not extend it. A hidden tab refetches nothing and catches up once when it is visible again, as it does after a socket reconnect. Past 50 projects the render stays correct but live updates can miss projects.

### Live blocks in wiki pages

A line of its own in a page body, `:::query <target>:::`, shows live results in the page. The target is the text as written:

| Target             | Shows                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `<savedQueryId>`   | A saved query                                                       |
| `dashboard:<id>`   | The widgets of a dashboard                                          |
| `inline:"<query>"` | A query written in the block, JSON-quoted so `"` and `:::` survive  |

The page editor inserts one from the slash menu and edits it in a form, and view mode renders it too. A block inside a code block is plain text. The action `dashboard.renderEmbedded` (`pageId` and `embedId`, the target as written) renders one. Whoever can read the page sees the block, evaluated with their own rights, also when they cannot open the dashboard or saved query itself, because the author of the page chose to show it to its readers. What comes back is widget titles and results, never query text or sharing. A token needs `wiki:read` and, per widget, the scope of its data.

**Response 200:** Updated preferences array.

---

## Attachments

Base path: `/api/attachments`

All endpoints require authentication. Upload rate limit: 10 per minute. Maximum file size: 25 MB.

Allowed MIME types: images (`image/*`), `application/pdf`, `application/msword`, Office Open XML documents, `text/plain`, `text/csv`, `application/zip`, `application/x-tar`, `application/gzip`.

### POST /api/attachments

Upload a file. Request must use `multipart/form-data`.

**Form fields:**

| Field               | Type   | Description                                                            |
| ------------------- | ------ | ---------------------------------------------------------------------- |
| `file`              | file   | The file to upload, with a name of at most 255 characters              |
| `issueId`, `pageId` | string | The parent. Without one the file is staged, like one from `upload-url` |

**Response 201:**

```json
{
  "id": "att_01HZ...",
  "filename": "screenshot.png",
  "mimeType": "image/png",
  "size": 45678,
  "url": "/api/attachments/att_01HZ..."
}
```

### POST /api/attachments/upload-url

Get a signed URL for one upload, for a client that can't send multipart or doesn't hold the file yet. It works once, for 10 minutes.

**Request body:**

| Field      | Type    | Description                                                                                                                                                         |
| ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filename` | string  | The name to store the file under                                                                                                                                    |
| `mimeType` | string  | One of the allowed types; the upload must be sent with this type                                                                                                    |
| `size`     | integer | The most the upload may hold, at most 25 MB                                                                                                                         |
| `target`   | object  | Optional. `{ projectId, issueNumber }`, `{ spaceId, pageSlug }`, `{ issueKey }` or `{ pageKey }` (see [Read by key](#post-apiread)). Without one the file is staged |

**Response 201:** `{ uploadUrl, uploadId, expiresAt, attachmentUrl }`

A key you can't see answers `404`, where the id form answers `403`; `issueKey` or `pageKey` holding a key of the other kind answers `400`. A staged file is visible to its uploader only. It joins an issue or page when you reference `attachmentUrl` in an issue, comment or page body after uploading, and it is removed after 24 hours if you don't. You can hold 100 staged files at once; past that, new ones get `429`.

### PUT /api/uploads/:uploadId?sig=...

Store the file: the request body is its raw content. This route takes no `Authorization` or `X-Requested-With` header, because the signature is the credential. Edit access to the target is checked again here, as are the scopes of the token that asked for the URL.

**Response 201:** The attachment. **403:** the same answer for a wrong signature, an unknown id and a URL that expired or was used. **408:** the body took more than 2 minutes. **429:** you have 4 uploads running, 32 are running over all users (with `Retry-After`), or you have too many staged files. **413:** larger than `size`. **415:** another type than `mimeType`, or a compressed body. A refused upload leaves the URL usable until it expires.

### POST /api/attachments/from-url

Fetch a file from a public HTTPS URL into an attachment. Private addresses are refused, for every redirect as well. The same size and type limits apply, with a 10 second timeout.

**Request body:** `url`, and optionally `filename` and `target` as above.

**Response 201:** The attachment. **400:** a refused URL, an answer that isn't a success, or an empty file. **413**, **415:** over the limits. **429:** more than 10 fetches per minute, or too many running (2 per user). **502:** the connection failed or timed out.

### GET /api/attachments

List attachments uploaded by the current user.

**Response 200:** Array of attachment objects.

### GET /api/attachments/:id/meta

Get attachment metadata without downloading the file.

**Response 200:** Attachment metadata object.

### GET /api/attachments/:id/preview

Get an image or PDF preview.

**Response 200:** Binary image data with appropriate `Content-Type`.

### GET /api/attachments/:id/convert

Convert a document attachment to Markdown.

**Response 200:**

```json
{
  "markdown": "# Document Title\n\nConverted content..."
}
```

### GET /api/attachments/:id

Download an attachment.

**Response 200:** Raw file contents with `Content-Type` and `Content-Disposition: attachment` headers.

### DELETE /api/attachments/:id

Delete an attachment.

**Response 204:** No content.

---

## Saved Filters

Base path: `/api/saved-filters`

All endpoints require authentication.

### POST /api/saved-filters

Create a saved filter.

**Request body:**

```json
{
  "name": "My open bugs",
  "projectId": "proj_01HZ...",
  "filters": {
    "status": ["TODO", "IN_PROGRESS"],
    "type": ["BUG"],
    "assigneeId": "usr_01HZ..."
  }
}
```

**Response 201:** Saved filter object.

### GET /api/saved-filters

List saved filters for the current user.

**Response 200:** Array of saved filter objects.

### PATCH /api/saved-filters/:filterId

Update a saved filter.

**Response 200:** Updated filter object.

### DELETE /api/saved-filters/:filterId

Delete a saved filter.

**Response 204:** No content.

---

## Admin

Base path: `/api/admin`

All endpoints require authentication and platform admin privileges (`isAdmin: true` on the user record).

### GET /api/admin/stats

Get platform-wide statistics.

**Response 200:**

```json
{
  "totalUsers": 42,
  "totalOrgs": 5,
  "totalIssues": 1204,
  "totalWikiPages": 310,
  "storage": { "storageBytes": 52428800, "totalBytes": 52428800 },
  "databaseSize": "18 MB"
}
```

### GET /api/admin/users

List all platform users.

**Query parameters:** `q`, `page`, `limit`, `status` (`active`, `inactive`)

**Response 200:** Paginated user list.

### GET /api/admin/users/:userId

Get a single user including org memberships.

**Response 200:** Full user object.

### PATCH /api/admin/users/:userId

Update a user's platform-level attributes.

**Request body:**

```json
{
  "isAdmin": true
}
```

**Response 200:** Updated user object.

### DELETE /api/admin/users/:userId

Permanently delete a user account.

**Response 204:** No content.

### POST /api/admin/users/:userId/deactivate

Deactivate a user account (blocks login without deleting data).

**Response 200:** Updated user object.

### POST /api/admin/users/:userId/reactivate

Reactivate a deactivated user account.

**Response 200:** Updated user object.

### POST /api/admin/users/:userId/reset-password

Set a new password for a user and end their sessions. Web UI only: a token is refused (403).

**Request body:** `{ "newPassword": "..." }` (8 to 128 characters).

**Response 200:** `{ "success": true }`

### POST /api/admin/users/:userId/reset-2fa

Turn off a user's two-factor authentication, for someone locked out of their authenticator. Clears the secret, the enabled flag and the last accepted code step, ends every session of that user (refresh tokens deleted, open sockets closed) and writes a `2fa_reset` audit row naming the admin. The user signs in again with their password and sets up 2FA anew. You can't reset your own 2FA this way: it answers `400` and you use the normal disable (`POST /api/auth/2fa/disable`) with a code. Web UI only: a token is refused (403).

**Response 200:** `{ "success": true }`

### GET /api/admin/settings

Get platform-wide configuration settings.

**Response 200:** Settings object.

---

## Audit Logs

Base path: `/api/admin/audit-logs`

All endpoints require authentication and platform admin privileges.

### GET /api/admin/audit-logs

List audit log entries.

**Query parameters:**

| Parameter      | Type    | Description                                  |
| -------------- | ------- | -------------------------------------------- |
| `userId`       | string  | Filter by acting user                        |
| `action`       | string  | Filter by action type (e.g., `issue.update`) |
| `resourceType` | string  | Filter by resource type (e.g., `Issue`)      |
| `from`         | string  | ISO date: start of range                     |
| `to`           | string  | ISO date: end of range                       |
| `page`         | integer | Page number                                  |
| `limit`        | integer | Items per page                               |

**Response 200:**

```json
{
  "logs": [
    {
      "id": "log_01HZ...",
      "action": "issue.update",
      "resourceType": "Issue",
      "resourceId": "iss_01HZ...",
      "actor": { "id": "usr_01HZ...", "username": "tim" },
      "metadata": { "field": "status", "from": "TODO", "to": "DONE" },
      "createdAt": "2026-03-27T10:00:00.000Z"
    }
  ],
  "total": 3421
}
```

### GET /api/admin/audit-logs/:id

Get a single audit log entry.

**Response 200:** Full audit log object.

---

## MCP Server

`POST /api/mcp` takes API tokens only and speaks stateless Streamable HTTP: POST only (`GET` and `DELETE` answer `405`), one JSON-RPC message per request, `Content-Type: application/json` and `Accept: application/json, text/event-stream`. See the [MCP server guide](axiom-mcp-server.md) for the tools, keys and scopes.

---

## WebSocket (Real-time)

Axiom provides a WebSocket server for real-time updates including issue and wiki changes and notifications.

**Connection URL (development):** `ws://localhost:3000`

Authentication via query parameter:

```
ws://localhost:3000?token=<access_token>
```
