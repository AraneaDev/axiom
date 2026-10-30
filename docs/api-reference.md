# Axiom API Reference

## Overview

Base URL: `http://localhost:3000` (development)

All API endpoints are prefixed with `/api`.

### Content Type

All request and response bodies use `application/json` unless noted otherwise (file uploads use `multipart/form-data`).

### CSRF Protection

All state-changing requests (POST, PATCH, PUT, DELETE) require the header:

```
X-Requested-With: XMLHttpRequest
```

### Rate Limiting

| Scope | Limit |
|-------|-------|
| Global | 300 requests per minute |
| Auth endpoints (`/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`) | 15 requests per minute |
| Attachment uploads | 10 uploads per minute |

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

| Scope | Allows |
|-------|--------|
| `issues:read` | Read projects, issues, sprints, boards, milestones and their settings (`/api/projects`, `/api/issues`, `/api/approval-requests`, `/api/custom-fields`, `/api/links`, team roadmap and analytics) |
| `issues:write` | Everything `issues:read` allows, plus creating and changing them |
| `wiki:read` | Read wiki spaces and pages (`/api/wiki`) |
| `wiki:write` | Everything `wiki:read` allows, plus creating and changing pages |

Reading your profile, orgs, teams and notifications needs any read scope (a write scope includes reading). Search returns only the areas the token covers. Team activity, member profiles and your dashboard count as issue data. An attachment needs the scope of its parent: `issues:*` for an issue's, `wiki:*` for a page's. A token can never manage orgs, teams, members, invitations, tokens, your account or anything under `/api/admin`, change space permissions or page restrictions, or create, change or delete projects. Creating a token with any other scope returns `400`.

### Permissions

Every request is checked twice: access to the resource, then the role for the action.

- **Access.** Projects and their issues, sprints, boards and settings need membership of the project's team (or org OWNER/ADMIN, or platform admin). Team-wide reads (the team, its members, activity, roadmap, analytics and project list) follow the same rule. Wiki spaces need org membership and, when the space has custom permissions, a grant at the required level; pages also honour their VIEW/EDIT restrictions. Ids in the URL or body must belong to the project or space in the URL (`404` or `400` otherwise).
- **Role.** Writes follow the matrix in `src/utils/permissions.ts`. On a team's resources (projects, issues, sprints, boards, the team's wiki spaces) the team role decides when the user has one; org OWNERs and ADMINs keep full rights, and users with no team role fall back to their org role. Issue content needs `issue:edit` (or `issue:create`), wiki writes `wiki:edit`. VIEWERs and GUESTs can read but not write; voting on and watching an issue only need read access. Project settings (approval gates, workflow rules, automation rules, custom field definitions, board columns, forms, issue templates) and changing a project need `team:manage_members` (a team ADMIN, an org OWNER/ADMIN or a platform admin); deleting a project needs `project:delete`. Creating a project or space in a team also needs team membership.
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

| Code | Meaning |
|------|---------|
| 400 | Bad request — invalid input |
| 401 | Unauthorized — missing or expired token |
| 403 | Forbidden — insufficient permissions |
| 404 | Not found |
| 409 | Conflict — duplicate resource |
| 422 | Unprocessable entity — validation failure |
| 429 | Rate limit exceeded |
| 500 | Internal server error |

### Pagination

List endpoints that support pagination accept the following query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | integer | Page number (1-based, default: 1) |
| `limit` | integer | Items per page (default varies, max 100) |

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

**Response 200:**

```json
{
  "message": "Two-factor authentication verified.",
  "backupCodes": ["abc123", "def456"]
}
```

### POST /api/auth/2fa/disable

Disable 2FA. **Auth required.**

**Request body:**

```json
{
  "code": "123456"
}
```

**Response 200:**

```json
{
  "message": "Two-factor authentication disabled."
}
```

---

## Users

Base path: `/api/users`

All endpoints require authentication.

### GET /api/users/search

Search for users by username or email.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search query |

**Response 200:**

```json
{
  "users": [
    { "id": "usr_01HZ...", "username": "tim", "avatarUrl": null }
  ]
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
  "orgs": [
    { "id": "org_01HZ...", "name": "Aranea.Dev", "slug": "aranea-dev" }
  ]
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

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status (`TODO`, `IN_PROGRESS`, `DONE`, etc.) |
| `priority` | string | Filter by priority (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) |
| `assigneeId` | string | Filter by assignee user ID |
| `labelName` | string | Filter by label name |
| `milestoneId` | string | Filter by milestone |
| `sprintId` | string | Filter by sprint |
| `q` | string | Structured query string (see [Query Language Reference](#query-language-reference)). Supports simple mode (`type:bug priority:high`) and complex mode (`type = Bug AND priority IN (High, Critical)`). When provided, replaces all individual filter params. |
| `page` | integer | Page number |
| `limit` | integer | Items per page |
| `sort` | string | Sort field (`createdAt`, `priority`, `number`) |
| `order` | string | Sort direction: `asc` or `desc` |

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
  "labels": [
    { "name": "bug", "color": "#d73a4a", "description": "Something is not working" }
  ]
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
  "trigger": "LABEL_ADDED",
  "triggerValue": "critical",
  "condition": "type = Bug AND priority IN (High, Critical)",
  "action": "ASSIGN_USER",
  "actionValue": "usr_01HZ..."
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for the rule |
| `trigger` | string | Event that fires the rule |
| `triggerValue` | string | Value associated with the trigger (e.g. label name) |
| `condition` | string | Optional query string condition evaluated before running the action (e.g. `"type = Bug AND priority IN (High, Critical)"`). Validated on creation. |
| `conditions` | array | **Deprecated.** Legacy JSON condition format. Use `condition` instead. |
| `action` | string | Action type to execute (see action types below) |
| `actionValue` | string | Value for the action (depends on action type) |

**Action types:**

| Action | Description | `actionValue` |
|--------|-------------|---------------|
| `ASSIGN_USER` | Assign the issue to a user | User ID |
| `SET_STATUS` | Set the issue status | Status name |
| `SET_PRIORITY` | Set the issue priority | Priority name |
| `ADD_LABEL` | Add a label to the issue | Label name |
| `set_field` | Set a plain content field (`title`, `body`, `priority`, `type`, `storyPoints`, `timeEstimate`, `dueDate`, `startDate`) or one of the project's custom fields (`custom:<name>`). Ids, the column, the assignee and other relations are refused (use `set_status`, `set_assignee`) | JSON object: `{ "field": "storyPoints", "value": "3" }` |
| `create_issue` | Create a new linked issue | JSON object with issue fields |
| `send_email` | Send an email notification | JSON object: `{ "to": "user@example.com", "subject": "...", "body": "..." }` |
| `webhook` | Send an HTTP POST to a URL | JSON object: `{ "url": "https://...", "headers": { ... } }` |

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

| Field | Type | Description |
|-------|------|-------------|
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

| Field | Type | Description |
|-------|------|-------------|
| `pendingMerge` | boolean | `true` while a change waits for an editor to merge it: the page is open in the editor, or an ended session left unmerged edits |
| `externalVersionId` | string | The version the merge will use. Only present when `pendingMerge` is `true` |

While a change is pending, `Page.body` already holds the new text. The version it replaced is kept as the merge base, and the change is recorded in the history as kind `EXTERNAL`. A body change that nobody has to merge is recorded as `EDIT`.

### GET /api/wiki/spaces/:spaceId/pages/:pageSlug/pending-merge

The three texts needed to merge a pending change. Requires edit permission on the page.

**Response 200:** `null` when nothing is pending. Otherwise:

| Field | Type | Description |
|-------|------|-------------|
| `base` | string | The Markdown both sides started from |
| `ours` | string | The open session's text, or an ended session's unmerged draft |
| `theirs` | string | The other side: the external change, or a draft |
| `oursLabel` / `theirsLabel` | string | Display labels, for example `Yours` and the author's name |
| `externalVersionId` | string | The pending change. Send it back when you apply the merge |
| `authorName`, `at` | string | Who made the external change and when |
| `draftAuthorName`, `draftAt` | string | Set when one side is an ended session's draft |

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

| Code | Meaning |
|------|---------|
| `MERGE_STALE` | The change was merged already, or a newer one arrived. Fetch the pending merge again |
| `MERGE_IN_PROGRESS` | Someone else is applying a merge |
| `MERGE_REBASE_CONFLICT` | Edits made in the session after your fetch overlap the merge |

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

| Kind | Written by |
|------|-----------|
| `EDIT` | A save from the editor or a plain API update |
| `EXTERNAL` | An API, MCP or other non-editor change that an editor session has to merge (a live one, or an ended one's unmerged draft) |
| `SESSION_DRAFT` | An editor session's text, saved before a merge so nothing is lost |
| `MERGE` | The result of applying a merge |
| `RESTORE` | Restoring an earlier version |

The head of a page is `Page.body`, not the highest version number.

### GET /api/wiki/spaces/:spaceId/pages/:pageSlug/export

Export a wiki page in the specified format.

**Query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `format` | string | Export format: `md`, `html`, `pdf`, `docx`, `epub`, `latex`, `plain` |

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

| Field | Type | Description |
|-------|------|-------------|
| `body` | string | Template body containing `{{expression}}` placeholders |
| `context.teamId` | string | Team ID used for resolving team-scoped variables |
| `context.spaceId` | string | Wiki space ID |
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

| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search query (required) |
| `type` | string | Filter by type: `issue`, `wiki` |
| `orgId` | string | Limit to an organization |
| `teamId` | string | Limit to a team |
| `projectId` | string | Limit to a project |

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

List notifications for the current user.

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

Mark a notification as read.

**Response 200:** Updated notification object.

### POST /api/notifications/read-all

Mark all notifications as read.

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

| Field | Type | Notes |
|-------|------|-------|
| `type` | string | Issue type name (e.g. `Bug`, `Feature`, `Task`) |
| `status` | string | Status name (e.g. `Todo`, `In Progress`, `Done`) |
| `priority` | string | `Low`, `Medium`, `High`, `Critical` |
| `assignee` | string | Username, user ID, or `@me` / `currentUser()` |
| `creator` | string | Username or user ID |
| `label` | string | Label name |
| `sprint` | string | Sprint name or `currentSprint()` |
| `project` | string | Project ID or slug |
| `storyPoints` | number | Story point estimate |
| `created` | date | Creation timestamp |
| `updated` | date | Last-updated timestamp |
| `dueDate` | date | Due date |
| `number` | number | Issue number within the project |
| `title` | string | Issue title (use `~` for contains) |

### Operator Reference

| Operator | Description | Example |
|----------|-------------|---------|
| `=` | Equal | `priority = High` |
| `!=` | Not equal | `status != Done` |
| `>` | Greater than | `storyPoints > 3` |
| `<` | Less than | `storyPoints < 8` |
| `>=` | Greater than or equal | `created >= now(-7d)` |
| `<=` | Less than or equal | `dueDate <= now()` |
| `~` | Contains (substring) | `title ~ "login"` |
| `IN` | Matches any value in list | `priority IN (High, Critical)` |
| `NOT IN` | Matches none of the values | `status NOT IN (Done, Cancelled)` |

Operators are case-insensitive (`IN`, `in`, and `In` are all valid).

### Function Reference

| Function | Description | Example |
|----------|-------------|---------|
| `currentUser()` | Resolves to the authenticated user. Alias: `@me` | `assignee = currentUser()` |
| `currentSprint()` | Resolves to the active sprint in the project | `sprint = currentSprint()` |
| `now()` | Current timestamp, with optional offset | `created >= now(-7d)` |
| `startOfDay()` | Midnight of the current day | `created >= startOfDay()` |
| `startOfWeek()` | Midnight of the first day of the current week | `updated >= startOfWeek()` |
| `empty()` | Matches null / unset fields | `assignee = empty()` |

**`now()` offset syntax:** `now(-Nd)` subtracts N days; `now(+Nd)` adds N days. Unit `d` (days) is the only supported unit.

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
```

**Response 200:** Updated preferences array.

---

## Attachments

Base path: `/api/attachments`

All endpoints require authentication. Upload rate limit: 10 per minute. Maximum file size: 25 MB.

Allowed MIME types: images (`image/*`), `application/pdf`, `application/msword`, Office Open XML documents, `text/plain`, `text/csv`, `application/zip`, `application/x-tar`, `application/gzip`.

### POST /api/attachments

Upload a file. Request must use `multipart/form-data`.

**Form fields:**

| Field | Type | Description |
|-------|------|-------------|
| `file` | file | The file to upload |

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

Send a password reset email to a user.

**Response 200:**

```json
{
  "message": "Password reset email sent."
}
```

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

| Parameter | Type | Description |
|-----------|------|-------------|
| `userId` | string | Filter by acting user |
| `action` | string | Filter by action type (e.g., `issue.update`) |
| `resourceType` | string | Filter by resource type (e.g., `Issue`) |
| `from` | string | ISO date: start of range |
| `to` | string | ISO date: end of range |
| `page` | integer | Page number |
| `limit` | integer | Items per page |

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

Base path: `/api/mcp`

The Axiom MCP (Model Context Protocol) server exposes project data to AI assistants. All endpoints require authentication.

### GET /api/mcp

Server-Sent Events stream for MCP communication.

### POST /api/mcp/messages

Send a message to the MCP server.

---

## WebSocket (Real-time)

Axiom provides a WebSocket server for real-time updates including issue and wiki changes and notifications.

**Connection URL (development):** `ws://localhost:3000`

Authentication via query parameter:

```
ws://localhost:3000?token=<access_token>
```
