# Webhooks Guide

Axiom webhooks let external services receive HTTP notifications when events occur in a repository. When a matching event fires, Axiom sends a `POST` request with a JSON payload to your configured URL.

---

## Overview

Webhooks are scoped to a repository. Each webhook has:

- A **URL** to deliver events to
- A list of **event types** to subscribe to (or `*` for all events)
- An optional **secret** used to sign delivery payloads
- An **active** flag that can be toggled without deleting the webhook

Delivery is asynchronous — the git push or API action that triggers an event is not blocked by webhook delivery. Each delivery is retried up to 3 times with exponential backoff (1 s, 2 s, 4 s) on server errors (HTTP 5xx). Client errors (HTTP 4xx) are not retried. Each delivery attempt is logged to the database regardless of outcome.

---

## Event Types

| Event | When it fires |
|-------|--------------|
| `push` | Commits pushed to an existing branch |
| `branch:created` | A new branch is pushed for the first time |
| `branch:deleted` | A branch is deleted (push with zero SHA as `after`) |
| `tag:created` | A new tag is pushed |
| `tag:deleted` | A tag is deleted |
| `*` | Wildcard — matches all events listed above |

Events are determined from the git `post-receive` hook by inspecting `ref`, `before`, and `after` SHA values:

- `before` all-zeros → `branch:created` or `tag:created`
- `after` all-zeros → `branch:deleted` or `tag:deleted`
- `refs/tags/` prefix → tag event
- Otherwise → `push`

---

## Payload Format

All events share the same top-level payload structure:

```json
{
  "event": "push",
  "repository": {
    "id": "clx1abc000001repoexample",
    "name": "Axiom MVP",
    "slug": "axiom-mvp"
  },
  "ref": "refs/heads/main",
  "refName": "main",
  "before": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "after": "b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3",
  "timestamp": "2026-03-27T12:00:00.000Z"
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event type (see table above) |
| `repository.id` | string | Internal repository UUID |
| `repository.name` | string | Human-readable repository name |
| `repository.slug` | string | URL slug of the repository |
| `ref` | string | Full git ref (e.g., `refs/heads/main`, `refs/tags/v1.0`) |
| `refName` | string | Short ref name with `refs/heads/` or `refs/tags/` stripped |
| `before` | string | SHA of the commit the ref pointed to before the push. All-zeros for new refs. |
| `after` | string | SHA of the commit the ref now points to. All-zeros for deletions. |
| `timestamp` | string | ISO 8601 timestamp of when the event was processed |

### Example: branch:created

```json
{
  "event": "branch:created",
  "repository": {
    "id": "clx1abc000001repoexample",
    "name": "Axiom MVP",
    "slug": "axiom-mvp"
  },
  "ref": "refs/heads/feature/new-ui",
  "refName": "feature/new-ui",
  "before": "0000000000000000000000000000000000000000",
  "after": "c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "timestamp": "2026-03-27T14:30:00.000Z"
}
```

### Example: tag:created

```json
{
  "event": "tag:created",
  "repository": {
    "id": "clx1abc000001repoexample",
    "name": "Axiom MVP",
    "slug": "axiom-mvp"
  },
  "ref": "refs/tags/v1.2.0",
  "refName": "v1.2.0",
  "before": "0000000000000000000000000000000000000000",
  "after": "d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5",
  "timestamp": "2026-03-27T16:00:00.000Z"
}
```

### Example: branch:deleted

```json
{
  "event": "branch:deleted",
  "repository": {
    "id": "clx1abc000001repoexample",
    "name": "Axiom MVP",
    "slug": "axiom-mvp"
  },
  "ref": "refs/heads/feature/old-branch",
  "refName": "feature/old-branch",
  "before": "e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6",
  "after": "0000000000000000000000000000000000000000",
  "timestamp": "2026-03-27T18:00:00.000Z"
}
```

---

## Request Headers

Every webhook delivery includes these HTTP headers:

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Axiom-Event` | The event type string (e.g., `push`) |
| `User-Agent` | `Axiom-Webhooks/0.1.0` |
| `X-Axiom-Signature` | HMAC-SHA256 signature (only present when webhook has a secret configured) |

---

## Webhook Signatures

When a webhook is created with a `secret`, every delivery includes an `X-Axiom-Signature` header. The value is `sha256=<hex-digest>` where the digest is computed as:

```
HMAC-SHA256(key=secret, message=raw_request_body)
```

### Verification Example (Node.js)

```js
const crypto = require('crypto');

function verifySignature(secret, rawBody, signatureHeader) {
  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(signatureHeader)
  );
}
```

### Verification Example (Python)

```python
import hmac
import hashlib

def verify_signature(secret: str, raw_body: bytes, signature_header: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode(), raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

Always use a constant-time comparison function (`timingSafeEqual`, `hmac.compare_digest`) to prevent timing attacks. Reject requests where the header is missing or the comparison fails with HTTP 401.

---

## Setting Up a Webhook via the API

All webhook endpoints require authentication (`Authorization: Bearer <token>`) and repo access.

### Create a Webhook

```
POST /api/repos/:repoId/webhooks
```

**Request body:**

```json
{
  "url": "https://example.com/hooks/axiom",
  "secret": "your-signing-secret",
  "events": ["push", "branch:created", "branch:deleted"]
}
```

To subscribe to all events use `["*"]`.

**Response (201):**

```json
{
  "id": "clx2wbk000002webhookexample",
  "repoId": "clx1abc000001repoexample",
  "url": "https://example.com/hooks/axiom",
  "events": ["push", "branch:created", "branch:deleted"],
  "active": true,
  "createdAt": "2026-03-27T12:00:00.000Z",
  "updatedAt": "2026-03-27T12:00:00.000Z"
}
```

Note: the `secret` field is stored but **never returned** in list or get responses (the service selects only `id`, `url`, `events`, `active`, `createdAt`, `updatedAt`).

### List Webhooks

```
GET /api/repos/:repoId/webhooks
```

Returns an array of webhook objects ordered by creation date descending.

### Get a Webhook

```
GET /api/repos/:repoId/webhooks/:webhookId
```

### Update a Webhook

```
PATCH /api/repos/:repoId/webhooks/:webhookId
```

All fields are optional. To disable a webhook without deleting it:

```json
{ "active": false }
```

To change the subscribed events:

```json
{ "events": ["push"] }
```

To rotate the signing secret:

```json
{ "secret": "new-signing-secret" }
```

### Delete a Webhook

```
DELETE /api/repos/:repoId/webhooks/:webhookId
```

Returns HTTP 204 on success. Deleting a webhook also deletes all associated delivery records.

---

## Delivery History

### List Recent Deliveries

```
GET /api/repos/:repoId/webhooks/:webhookId/deliveries
```

Returns the 20 most recent delivery records, ordered newest first.

**Response:**

```json
[
  {
    "id": "clx3del000003deliveryexample",
    "webhookId": "clx2wbk000002webhookexample",
    "event": "push",
    "url": "https://example.com/hooks/axiom",
    "statusCode": 200,
    "success": true,
    "duration": 142,
    "requestBody": "{\"event\":\"push\",...}",
    "responseBody": "ok",
    "error": null,
    "createdAt": "2026-03-27T12:05:00.000Z"
  }
]
```

### Delivery Record Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Delivery record ID |
| `webhookId` | string | Parent webhook ID |
| `event` | string | Event type that triggered this delivery |
| `url` | string | URL the delivery was sent to |
| `statusCode` | number \| null | HTTP status code from the target server. Null if the request never completed. |
| `success` | boolean | `true` if the target returned HTTP 2xx |
| `duration` | number | Total elapsed time in milliseconds across all retry attempts |
| `requestBody` | string | Full JSON payload that was sent |
| `responseBody` | string \| null | First 10,000 characters of the response body |
| `error` | string \| null | Error message if the request threw (network error, timeout, etc.) |
| `createdAt` | string | ISO 8601 timestamp |

### Redeliver a Delivery

```
POST /api/repos/:repoId/webhooks/:webhookId/redeliver/:deliveryId
```

Resends the exact payload from the original delivery. The redelivery uses the webhook's current URL and secret (not the values at the time of original delivery). Only 1 attempt is made (no retry). A new delivery record is created for the redelivery.

**Response (200):**

```json
{ "ok": true }
```

---

## Timeouts and Retry Behaviour

- Each delivery attempt has a **10-second timeout**. If the target does not respond within 10 seconds, the attempt is aborted.
- **3 total attempts** are made for server errors (HTTP 5xx) or network failures.
- Backoff between attempts: 1 s, 2 s (exponential).
- **HTTP 4xx responses are not retried.** Fix the endpoint configuration and use redelivery instead.
- All attempts (including failures) are counted as a single delivery record with the final outcome.

---

## Troubleshooting

### Delivery shows `success: false` with a `statusCode`

Your endpoint returned an error. Check `responseBody` for details. For 4xx errors (configuration, auth, not found), fix the endpoint and use the redeliver API. For 5xx errors, Axiom already retried 3 times.

### Delivery shows `success: false` with `statusCode: null` and an `error`

The request never reached your server. Common causes:
- DNS resolution failure
- Connection refused (service not running)
- Timeout (endpoint took more than 10 seconds)
- TLS certificate error

### Signature verification fails

- Verify you are computing the HMAC over the **raw request body bytes**, not a parsed/re-serialized JSON object.
- Confirm the secret in your verifier matches the secret you set when creating the webhook. The secret is write-only in the API; if lost, rotate it with a `PATCH` request.
- Check that the `X-Axiom-Signature` header is present. It is only sent when the webhook was created with a non-empty `secret`.

### No deliveries appearing

- Confirm the webhook `active` field is `true`.
- Confirm the event type you expect is in the webhook's `events` array (or that `*` is present).
- Webhooks are only fired from the git `post-receive` hook. If the repository was created without the hook installed, pushes will not trigger deliveries. The hook is installed automatically by Axiom when creating a repository via the API.

### Inactive webhook receiving no events

Use `PATCH` to set `active: true`:

```json
{ "active": true }
```
