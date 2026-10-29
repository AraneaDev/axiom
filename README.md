# Axiom

A self-hosted project management platform with integrated Git hosting, CI/CD, and real-time collaboration.

![Tests](https://img.shields.io/badge/tests-852%20passing-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) ![Backend](https://img.shields.io/badge/backend-zero%20errors-brightgreen) ![Frontend](https://img.shields.io/badge/frontend-zero%20errors-brightgreen) ![ESLint](https://img.shields.io/badge/ESLint-zero%20warnings-brightgreen) ![E2E](https://img.shields.io/badge/E2E-56%20passing-brightgreen) ![UI Tests](https://img.shields.io/badge/UI%20tests-220%20passing-brightgreen) ![Git Tests](https://img.shields.io/badge/git%20tests-130%20passing-brightgreen) ![OpenAPI](https://img.shields.io/badge/OpenAPI-auto--generated-blue) ![License](https://img.shields.io/badge/license-proprietary-lightgrey)

---

## Features

- Issue tracking with sprints, epics, custom fields, and automation rules
- Git repository hosting with smart HTTP and SSH protocols
- Pull request reviews with inline comments and merge strategies
- CI/CD pipelines with YAML configuration
- Wiki with real-time collaborative editing (Yjs/WebSocket)
- Release management with tagging and changelogs
- Full-text search across issues, PRs, wiki, and code
- Role-based access control (RBAC) with org/team hierarchy
- Webhook integrations
- MCP server with 44 tools for AI agent integration
- Dark mode with full design token system

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Backend | Node.js, Express, TypeScript, Prisma, PostgreSQL |
| Frontend | React 19, Vite, TailwindCSS v4, TanStack Query, Zustand |
| Editor | TipTap (ProseMirror) with markdown, mentions, issue references |
| Real-time | WebSocket, Yjs CRDT |
| Git | Smart HTTP protocol, SSH server, bare repo management |
| CI/CD | YAML pipeline parser, job runner |
| Testing | Vitest (unit/integration), Playwright (E2E) |
| AI | MCP server with 44 tools |

---

## Quick Start

```bash
npm run docker:dev          # Start PostgreSQL + API + Frontend (ports 5432, 3000, 7000)
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

| Suite | Command | Count |
|-------|---------|-------|
| Unit / Integration | `npm run test` | 852 tests across 74 files |
| E2E | `npm run e2e` | 56 specs across 22 files |
| Frontend Components | `cd frontend && npm run test` | 220 tests across 31 files |
| Git Module | `cd src/git && npx vitest run --config vitest.config.ts` | 130 tests across 7 files |
| Query Engine | `cd src/lib/query-engine && npx vitest run --config vitest.config.ts` | 70 tests across 5 files |
| Full Check | `npm run check` | typecheck + lint + format + test |

All backend tests run against a real PostgreSQL instance -- no mocked databases.

---

## Architecture

```
src/
  modules/          # 32 feature modules (controller -> service -> routes)
  git/              # Git protocol infrastructure (smart HTTP, SSH, hooks)
  middleware/       # Auth, RBAC, CSRF, error handling
  mcp/              # MCP server (37+ tools)
  utils/            # Shared utilities (pandoc, validation, mentions)
frontend/src/
  pages/            # Route components (lazy loaded)
  components/       # Shared UI library (31 components, 100% tested)
  api/              # API client with auto token refresh
  stores/           # Zustand state management
  hooks/            # Custom React hooks
```

Each backend module follows the **controller -> service -> routes** pattern. Controllers handle HTTP request/response; services contain business logic with Prisma. Services never touch `req`/`res`.

---

## API

All API routes are mounted under `/api/*`, git protocol under `/git/*`, and webhooks under `/hooks/*`.

Interactive API docs available at `/api/docs` (Scalar UI), raw OpenAPI 3.1 spec at `/api/openapi.json`.

Rate limiting: 300 req/min global, 15 req/min on auth endpoints.

Authentication uses JWT access + refresh tokens with automatic refresh on 401. CSRF protection via `X-Requested-With` header on all mutating requests. Structured request logging with pino and per-request correlation IDs (`X-Request-Id`).

The MCP server exposes 44 tools for AI agent integration, covering issues, repos, pulls, wiki, search, and more.

---

## Design System

The frontend uses CSS variable design tokens for consistent theming with full dark mode support. Available tokens cover text, surfaces, borders, and semantic colors (primary, danger, warning, success, accent).

All icons use [Lucide](https://lucide.dev). The shared component library in `frontend/src/components/ui/` provides 31 accessible, composable components following the `forwardRef` pattern with variant/size maps. All components have unit tests.
