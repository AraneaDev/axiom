# API Reference

Base URL: `/api`

All endpoints require authentication via Bearer token unless noted.

## Authentication

### POST /api/auth/login

```json
{
  "username": "tim",
  "password": "password123"
}
```

Returns `{ accessToken, refreshToken, user }`.

## Issues

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/issues/project/:projectId` | List issues with filters |
| POST | `/issues/project/:projectId` | Create issue |
| GET | `/issues/:id` | Get issue detail |
| PATCH | `/issues/:id` | Update issue |
| DELETE | `/issues/:id` | Delete issue |

## Repositories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/repos/team/:teamId` | List repos |
| POST | `/repos/team/:teamId` | Create repo |
| GET | `/repos/:id/tree/:ref/*` | Browse tree |
| GET | `/repos/:id/blob/:ref/*` | Get file content |
| GET | `/repos/:id/blame/:ref/*` | Get blame |
| GET | `/repos/:id/commits` | List commits |
| GET | `/repos/:id/commits/:sha` | Commit detail + diff |

## Pull Requests

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/repos/:id/pulls` | List PRs |
| POST | `/repos/:id/pulls` | Create PR |
| GET | `/repos/:id/pulls/:num` | PR detail |
| POST | `/repos/:id/pulls/:num/merge` | Merge PR |

## Error Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed"
  }
}
```
