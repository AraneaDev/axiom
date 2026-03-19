# Axiom

A self-hosted project management platform with integrated Git hosting, CI/CD, and real-time collaboration.

![Tests](https://img.shields.io/badge/tests-454%20passing-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue) ![Backend](https://img.shields.io/badge/backend-zero%20errors-brightgreen) ![Frontend](https://img.shields.io/badge/frontend-zero%20errors-brightgreen) ![ESLint](https://img.shields.io/badge/ESLint-zero%20warnings-brightgreen) ![E2E](https://img.shields.io/badge/E2E-12%20specs-blue) ![UI Tests](https://img.shields.io/badge/UI%20tests-140%20passing-brightgreen) ![Modules](https://img.shields.io/badge/modules-40%20tested-brightgreen) ![License](https://img.shields.io/badge/license-proprietary-lightgrey)

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
- MCP server with 37+ tools for AI agent integration
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
| AI | MCP server with 37+ tools |

---

## Quick Start

```bash
npm run docker:dev          # Start PostgreSQL + API + Frontend (ports 5432, 3000, 7000)
npm run db:seed             # Seed demo data (idempotent, safe to re-run)
./scripts/init-self-repo.sh # Initialize the self-hosted git repo
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
| Unit / Integration | `npm run test` | 454 tests across 40 files |
| E2E | `npm run e2e` | 12 specs |
| Frontend Components | `cd frontend && npm run test` | 140 tests across 16 files |
| Full Check | `npm run check` | typecheck + lint + format + test |

All backend tests run against a real PostgreSQL instance -- no mocked databases.

---

## Architecture

```
src/
  modules/          # 28 feature modules (controller -> service -> routes)
  git/              # Git protocol infrastructure (smart HTTP, SSH, hooks)
  middleware/       # Auth, RBAC, CSRF, error handling
  mcp/              # MCP server (37+ tools)
  utils/            # Shared utilities (pandoc, validation, mentions)
frontend/src/
  pages/            # Route components (lazy loaded)
  components/       # Shared UI library (20+ components)
  api/              # API client with auto token refresh
  stores/           # Zustand state management
  hooks/            # Custom React hooks
```

Each backend module follows the **controller -> service -> routes** pattern. Controllers handle HTTP request/response; services contain business logic with Prisma. Services never touch `req`/`res`.

---

## API

All API routes are mounted under `/api/*`, git protocol under `/git/*`, and webhooks under `/hooks/*`.

Rate limiting: 300 req/min global, 15 req/min on auth endpoints.

Authentication uses JWT access + refresh tokens with automatic refresh on 401. CSRF protection via `X-Requested-With` header on all mutating requests.

The MCP server exposes 37+ tools for AI agent integration, covering issues, repos, pulls, wiki, search, and more.

---

## Design System

The frontend uses CSS variable design tokens for consistent theming with full dark mode support. Available tokens cover text, surfaces, borders, and semantic colors (primary, danger, warning, success, accent).

All icons use [Lucide](https://lucide.dev). The shared component library in `frontend/src/components/ui/` provides 20+ accessible, composable components following the `forwardRef` pattern with variant/size maps.
