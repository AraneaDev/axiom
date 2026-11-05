# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

Axiom is a self-hosted Jira and Confluence replacement built for agents (issues, sprints, boards, wiki, MCP server). It has no git hosting; a GitHub integration is planned.

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
| [Development Guide](docs/development-guide.md) | Dev commands, testing, linting, commit message format |
| [API Reference](docs/api-reference.md) | REST endpoint summary (auth, issues, sprints, wiki, search) |
| [MCP Server](docs/axiom-mcp-server.md) | The five tools, keys, includes, batches, uploads, scopes, limits, Claude Code and Codex setup |
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

**Backend:** `src/modules/{feature}/` with `*.routes.ts` > `*.controller.ts` > `*.service.ts`. Controllers handle req/res; services contain business logic with Prisma. Routes mounted under `/api/*`.

**Action registry:** Every operation is a `defineAction` in a `src/modules/{feature}/{feature}.actions.ts` (or `src/actions/`), registered with `registerActions` and imported in `src/index.ts` above the mount (forgetting the import silently leaves the route legacy). REST routes, `/api/act`, `/api/read`, the MCP server (`src/mcp/`, five tools, API tokens only, Streamable HTTP at `/api/mcp`) and OpenAPI (`/api/docs`) all come from it. Rules a new action follows:
- Handlers call services, never raw Prisma for writes. Controllers and routers of a migrated route are deleted.
- Area and kind give the token scope (`<area>:read` or `<area>:write`). An action `tokenAllows` always blocked (admin, tokens, account, space permissions, page restrictions, project create/update/delete, org and team writes) is `uiOnly` or `tokenBlocked: true`.
- Authorization runs before full input validation. Declare `target` (only the ids authorize needs) whenever the input has more than the path params, and build `input` from it with `target.extend({...})` so both read the same ids.
- Ids use `strictInt` from `common-validators.ts`. No top-level input is `z.unknown()` or `z.any()`; a repeatable query value uses `queryValue`. Writes read body and path params, GET and HEAD read query and path params only.
- Output keeps the old REST shape, as a loose object naming the key fields.
- `registry-rules.test.ts` and `parity.test.ts` enforce these, and `frontend-calls.test.ts` ties every frontend call to a registry action or a tracked legacy route. Keep them green.
- `act` takes a `key` for an issue, page, space or project (`src/actions/keys.ts`): unseen and missing answer alike (`404`).

**Query Engine:** `src/lib/query-engine/` -- shared lexer/parser/AST pipeline powering issue search, automation conditions, and template variables. Two backends: AST-to-Prisma compiler (search) and AST-to-Boolean evaluator (automation). Extend by adding fields to `issueFieldRegistry` in `fields/issue-fields.ts`. A caller of `compileToPrisma` or `evaluate` first calls `resolveQueryFields` (`src/modules/search/query-fields.service.ts`) for `cf.Name` and `linked`; automation issues must hydrate `AUTOMATION_ISSUE_INCLUDE`, the evaluator throws on what is missing. `parseQuery` adds the clauses `[SELECT] [WHERE] cond [GROUP BY] [ORDER BY]` (exact uppercase; `parse` stays the condition parser, and `q` and automation never read clauses); `compileOrderBy` and `aggregate.ts` (`buildGroups`) turn them into a sort and groups, run by `query.run` (`src/modules/search/query.service.ts`) after the access filter. Saved queries (`saved-filters`) and dashboards (`src/modules/dashboards/`, up to 24 widgets, shared `PRIVATE`/`TEAM`/`ORG` through one helper) always run with the viewer's own rights; `:::query <target>:::` wiki blocks render through `dashboard.renderEmbedded`. `sprint.overview` shares its definitions with the sprint report in `sprint-metrics.ts`. Syntax: [API reference](docs/api-reference.md#clauses). Tests: `cd src/lib/query-engine && npx vitest run --config vitest.config.ts` (no DB needed).

**Frontend:** `frontend/src/pages/` (route components, lazy loaded), `frontend/src/components/` (shared UI + layout), `frontend/src/api/` (API client helpers). All API calls through `api/client.ts` (`get`/`post`/`patch`/`del`).

**Prisma 7:** Config in `prisma.config.ts` at project root. Uses `@prisma/adapter-pg` (pg driver adapter). The `url` field was removed from `schema.prisma` -- connection URL comes from `prisma.config.ts` via `process.env.DATABASE_URL`. Scripts and tests must create `PrismaClient` with the adapter (see `src/config/database.ts` for the pattern).

**Express 5:** Route wildcards use named syntax (`*path` not `*`). Wildcard params return `string[]` -- use `Array.isArray(p) ? p.join('/') : p` to get a path string. Inline regex constraints `(:param(a|b))` are no longer supported -- use separate routes instead.

**URL patterns:**
- Issues: `/:org/:team/:project/issues/:num`
- Wiki: `/:org/:team/wiki/:space/:page`

**Production serving:** One container. Express serves the built SPA (`STATIC_DIR`, default `public`; the Dockerfile copies `frontend/dist` to `/app/public`) after all `/api` routes, with an index.html fallback, immutable caching on `/assets/*` and `no-cache` on `index.html`. No nginx. Development stays on Vite (HMR, :7000).

**Wiki content:** `Page.body` and `PageVersion.body` are always Markdown, never Yjs XML. The collaborative editor converts through the shared editor core (`frontend/src/editor-core/`, bundled for the backend by `npm run build:editor-core`). Non-editor writes go through `writePageBody` (`src/modules/wiki/page-writes.ts`); when a session is live they become a pending change that the session merges per block (`page-merge.ts`).

**Real-time:** WebSocket server with JWT auth. Events broadcast for issue, comment, board, wiki, notification, approval and form changes, plus `issue:links-updated` when a wiki page is linked to an issue. Frontend auto-invalidates React Query cache via `useRealtimeInvalidation`.

**Automation:** Rules in `src/modules/automation/`. Conditions use query strings (`type = Bug AND priority > Medium`). 8 action types (set_status, set_assignee, add_label, add_comment, set_field, create_issue, send_email, webhook). Triggers: `issue:created`, `issue:status_changed`, `issue:assigned`, `label:added`. Actions support `{{expression}}` template variables. Trigger sites pass hydrated issues via `AUTOMATION_ISSUE_INCLUDE`.

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

The dev compose (`docker-compose.dev.yml`) runs: PostgreSQL, Redis (password `axiom_dev_redis`), Mailserver (SMTP), migrate (one-shot), API (tsx watch), worker, Web (Vite HMR).

Bind mounts for hot reload: `src/`, `prisma/`, `prisma.config.ts`, `scripts/`, `frontend/src/`, `frontend/vite.config.ts`.

**Tunnel:** `npm run tunnel` starts a Cloudflare quick tunnel (free, no account) for sharing with coworkers. Uses the `tunnel` Docker Compose profile.
