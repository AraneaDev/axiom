# Axiom

A self-hosted Jira and Confluence replacement built for agents. You get issue tracking, sprints, boards, and a collaborative wiki, plus an MCP server so your agents can work in the same projects you do. A GitHub integration for the code side is planned.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) ![ESLint](https://img.shields.io/badge/ESLint-zero%20warnings-brightgreen) ![OpenAPI](https://img.shields.io/badge/OpenAPI-auto--generated-blue) ![License](https://img.shields.io/badge/license-proprietary-lightgrey)

---

## Features

- Issue tracking with sprints, boards, epics, custom fields, and automation rules
- Wiki with real-time collaborative editing (Yjs/WebSocket)
- Full-text search across issues and wiki pages
- Role-based access control (RBAC) with org/team hierarchy
- Outbound webhooks as an automation action
- MCP server with five tools for AI agent integration
- Dark mode with full design token system
- GitHub integration (planned)

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Backend | Node.js, Express, TypeScript, Prisma, PostgreSQL |
| Frontend | React 19, Vite, TailwindCSS v4, TanStack Query, Zustand |
| Editor | TipTap (ProseMirror) with markdown, mentions, issue references |
| Real-time | WebSocket, Yjs CRDT |
| Testing | Vitest (unit/integration), Playwright (E2E) |
| AI | MCP server with five tools |
| Production | One container: Express serves the built SPA and the API |

---

## Quick Start

```bash
npm run docker:dev          # Start PostgreSQL, Redis, API, worker, and frontend (ports 5432, 3000, 7000)
npm run db:seed             # Seed demo data (idempotent, safe to re-run)
```

---

## Development

```bash
npm run dev                 # Backend with tsx watch (port 3000)
cd frontend && npm run dev  # Vite dev server (port 7000)
npm run check               # Full: typecheck + lint + format + test
npx tsc --noEmit            # Backend typecheck only
cd frontend && npx tsc --noEmit  # Frontend typecheck only
```

---

## Testing

| Suite | Command |
|-------|---------|
| Unit / Integration | `npm run test` |
| E2E | `npm run e2e` |
| Frontend Components | `cd frontend && npm run test` |
| Query Engine | `cd src/lib/query-engine && npx vitest run --config vitest.config.ts` |
| Full Check | `npm run check` |

All backend tests run against a real PostgreSQL instance -- no mocked databases.

---

## Architecture

```
src/
  modules/          # 31 feature modules (controller -> service -> routes)
  middleware/       # Auth, RBAC, CSRF, error handling
  mcp/              # MCP server (five tools)
  utils/            # Shared utilities (pandoc, validation, mentions)
frontend/src/
  pages/            # Route components (lazy loaded)
  components/       # Shared UI library (shared components, 100% tested)
  api/              # API client with auto token refresh
  stores/           # Zustand state management
  hooks/            # Custom React hooks
```

Each backend module follows the **controller -> service -> routes** pattern. Controllers handle HTTP request/response; services contain business logic with Prisma. Services never touch `req`/`res`.

---

## API

All API routes are mounted under `/api/*`.

Interactive API docs available at `/api/docs` (Scalar UI), raw OpenAPI 3.1 spec at `/api/openapi.json`.

Rate limiting: 300 req/min global, 15 req/min on auth endpoints.

Authentication uses JWT access + refresh tokens with automatic refresh on 401. CSRF protection via `X-Requested-With` header on all mutating requests. Structured request logging with pino and per-request correlation IDs (`X-Request-Id`).

The MCP server has five tools (search, read, describe, act, upload) that cover the developer loop: issues, comments, worklogs, links, attachments, wiki pages, sprints and the org, team and project reads. The rest of the API follows later.

---

## Design System

The frontend uses CSS variable design tokens for consistent theming with full dark mode support. Available tokens cover text, surfaces, borders, and semantic colors (primary, danger, warning, success, accent).

All icons use [Lucide](https://lucide.dev). The shared component library in `frontend/src/components/ui/` provides accessible, composable components following the `forwardRef` pattern with variant/size maps. All components have unit tests.
