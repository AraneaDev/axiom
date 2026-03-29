# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## Quick Reference

```bash
npm run docker:dev          # Start PostgreSQL + Redis + API + Frontend (ports 5432, 3000, 7000)
npm run docker:dev:down     # Stop all containers
npm run db:seed             # Seed demo data (idempotent, safe to re-run)
npm run tunnel              # Expose dev stack via Cloudflare tunnel (free, no account)
npm run check               # Full: typecheck + lint + format + test
npx tsc --noEmit            # Backend typecheck only
cd frontend && npx tsc --noEmit  # Frontend typecheck only
npm run test                # Backend Vitest
npm run e2e                 # Playwright E2E (requires dev stack running)
```

**Seed credentials:** `tim / password123` (OWNER), `test / password123` (MEMBER)
**Org:** Aranea.Dev > **Team:** Axiom > **Project:** Axiom MVP (prefix: AXM)

---

## Documentation

Detailed docs live in `/docs/`. Read these before making changes in their domain:

| Document | Covers |
|----------|--------|
| [Architecture](docs/architecture.md) | System diagram, tech stack, data flow, deployment model |
| [Design Patterns](docs/design-patterns.md) | Non-negotiable rules, all shared UI components, custom hooks, backend module pattern, building checklists |
| [Development Guide](docs/development-guide.md) | Dev commands, testing, linting, git conventions, commit message format |
| [API Reference](docs/api-reference.md) | REST endpoint summary (auth, issues, repos, PRs, wiki) |
| [MCP Server](docs/axiom-mcp-server.md) | 44 MCP tools, Claude Desktop/Code setup, discovery chains, query language, example workflows |
| [Getting Started](docs/getting-started.md) | New developer onboarding, prerequisites, installation |

---

## Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 25 (Docker: `node:25-alpine`) |
| Backend | Express | 5 |
| ORM | Prisma | 7 (client engine via `@prisma/adapter-pg`) |
| Database | PostgreSQL | 16 |
| Cache | Redis | 7 |
| Frontend | React | 19 |
| Build | Vite | 8 |
| Routing | React Router | 7 |
| State | TanStack Query (server) + Zustand (client) |
| Editor | TipTap (markdown, collaborative via Yjs) |
| Icons | Lucide React (exclusively) |
| Styling | Tailwind CSS 4 with CSS variable design tokens |

---

## Design Rules (Non-Negotiable)

These are enforced across the entire codebase. See [Design Patterns](docs/design-patterns.md) for the full list with examples.

1. **No emojis** -- never, anywhere (code, UI, seed data, comments, commits). Use Lucide icons.
2. **Lucide icons only** -- no other icon libraries, no inline SVGs, no unicode symbols.
3. **Every button has an icon** -- no text-only buttons. Icon-only is fine with a `title` prop.
4. **CSS variable tokens only** -- never use Tailwind palette colors directly (`text-primary` not `text-indigo-600`).
5. **Check shared components first** -- before building any UI pattern, check `/frontend/src/components/ui/`.

---

## Architecture (Summary)

**Backend:** `src/modules/{feature}/` with `*.routes.ts` > `*.controller.ts` > `*.service.ts`. Controllers handle req/res; services contain business logic with Prisma. Routes mounted under `/api/*`, git protocol under `/git/*`.

**Query Engine:** `src/lib/query-engine/` -- shared lexer/parser/AST pipeline powering issue search, automation conditions, and template variables. Two backends: AST-to-Prisma compiler (search) and AST-to-Boolean evaluator (automation). Extend by adding fields to `issueFieldRegistry` in `fields/issue-fields.ts`. Tests: `cd src/lib/query-engine && npx vitest run --config vitest.config.ts` (no DB needed).

**Frontend:** `frontend/src/pages/` (route components, lazy loaded), `frontend/src/components/` (shared UI + layout), `frontend/src/api/` (API client helpers). All API calls through `api/client.ts` (`get`/`post`/`patch`/`del`).

**Prisma 7:** Config in `prisma.config.ts` at project root. Uses `@prisma/adapter-pg` (pg driver adapter). The `url` field was removed from `schema.prisma` -- connection URL comes from `prisma.config.ts` via `process.env.DATABASE_URL`. Scripts and tests must create `PrismaClient` with the adapter (see `src/config/database.ts` for the pattern).

**Express 5:** Route wildcards use named syntax (`*path` not `*`). Wildcard params return `string[]` -- use `Array.isArray(p) ? p.join('/') : p` to get a path string. Inline regex constraints `(:param(a|b))` are no longer supported -- use separate routes instead.

**URL patterns:**
- Issues: `/:org/:team/:project/issues/:num`
- Repos: `/:org/:team/repos/:repo`
- Wiki: `/:org/:team/wiki/:space/:page`

**Git storage:** Bare repos at `{REPOS_PATH}/{orgSlug}/{teamSlug}/{repoSlug}.git`

**Real-time:** WebSocket server with JWT auth. Events broadcast for issue/PR/wiki/board/pipeline changes. Frontend auto-invalidates React Query cache via `useRealtimeInvalidation`.

**Automation:** Rules in `src/modules/automation/`. Conditions use query strings (`type = Bug AND priority > Medium`). 8 action types (set_status, set_assignee, add_label, add_comment, set_field, create_issue, send_email, webhook). Actions support `{{expression}}` template variables. Trigger sites pass hydrated issues via `AUTOMATION_ISSUE_INCLUDE`.

**Template Variables:** `{{expression}}` syntax shared by automation actions and wiki templates. Dot-path traversal (`{{issue.assignee.displayName}}`), built-in functions (`now()`, `currentUser()`, `empty()`). Wiki templates resolved server-side via `POST /api/wiki/resolve-template`.

---

## Frontend Conventions

- **Routing:** Import from `'react-router'`, never `'react-router-dom'`
- **Data fetching:** TanStack Query for all server state. No `useEffect` + `fetch`.
- **State:** Zustand for client-only state (`useAuthStore`, `useUIStore`). Server state in React Query.
- **Forms:** Controlled inputs with `useState`. Zod for validation.
- **Components:** `forwardRef`, `cn()` for classNames, named exports, variant/size maps as objects.

See [Design Patterns](docs/design-patterns.md) for the full component catalog (40+ shared components) and custom hooks reference.

---

## Backend Conventions

- **Prisma includes:** Always include full relationship chains for URL building (e.g., `project.team.org` for issues).
- **Auth:** JWT access (15min) + refresh (7day) tokens. CSRF via `X-Requested-With` header.
- **Errors:** Throw `AppError(statusCode, message)` from services. Global handler returns `{ error: { message } }`.
- **Validation:** Zod schemas in `src/utils/validation/`. `z.record()` requires two args in Zod 4.

---

## Testing

- **Backend (Vitest):** `src/modules/**/*.test.ts` -- hits real PostgreSQL (`axiom_test` DB), no mocks.
- **E2E (Playwright):** `e2e/*.spec.ts` -- requires `npm run docker:dev` + `npm run db:seed`.
- **PrismaClient in tests:** Must use the adapter pattern (see `src/seed/seed-demo.test.ts`).

---

## Docker Development

The dev compose (`docker-compose.dev.yml`) runs: PostgreSQL, Redis, Mailserver (SMTP), API (tsx watch), Web (Vite HMR).

Bind mounts for hot reload: `src/`, `prisma/`, `prisma.config.ts`, `scripts/`, `frontend/src/`, `frontend/vite.config.ts`.

**Tunnel:** `npm run tunnel` starts a Cloudflare quick tunnel (free, no account) for sharing with coworkers. Uses the `tunnel` Docker Compose profile.
