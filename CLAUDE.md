# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

### Development Stack (Docker)
```bash
npm run docker:dev          # Start PostgreSQL + API + Frontend (ports 5432, 3000, 7000)
npm run docker:dev:down     # Stop all containers
npm run db:seed             # Seed demo data (idempotent, safe to re-run)
./scripts/init-self-repo.sh # Initialize the self-hosted git repo after seeding
```

### Typechecking & Validation
```bash
npm run check               # Full: typecheck + lint + format + test
npx tsc --noEmit            # Backend typecheck only
cd frontend && npx tsc --noEmit  # Frontend typecheck only
```

### Testing
```bash
npm run test                # Run Vitest (backend unit/integration)
npm run test -- --run src/modules/auth/auth.test.ts  # Single test file
npm run e2e                 # Playwright E2E (requires dev stack running)
```

### Running Without Docker
```bash
npm run dev                 # Backend with tsx watch (port 3000)
cd frontend && npm run dev  # Vite dev server (port 7000)
```

---

## Architecture Overview

### Backend (Express + Prisma)
```
src/
  index.ts              # Express app: middleware, route mounting, rate limiting
  modules/              # Feature modules (controller → service → routes pattern)
    auth/               # JWT access + refresh tokens
    orgs/               # Organizations
    teams/              # Teams within orgs
    issues/             # Issues + sub-controllers (branches, commits, links, PRs)
    repos/              # Repository CRUD + file browsing
    pulls/              # Pull requests + reviews
    wiki/               # Wiki spaces + pages + export
    pipelines/          # CI/CD pipelines
    releases/           # Release management
    search/             # Full-text search
  git/                  # Git infrastructure
    smart-http.ts       # Smart HTTP protocol (git push/pull)
    hook-handler.ts     # Post-receive hooks (commit-to-issue linking)
    git-commands.ts     # Git CLI wrapper (spawn-based)
    repo-manager.ts     # Bare repo lifecycle, disk paths
    ssh-server.ts       # SSH git access
  middleware/            # auth, RBAC, CSRF, error handling
  utils/                # Shared utilities (pandoc export, validation, etc.)
```

**Module pattern**: Each module has `*.routes.ts` (Express Router), `*.controller.ts` (request handlers), `*.service.ts` (business logic with Prisma). Controllers delegate to services; services never touch `req`/`res`.

**Route mounting**: All API routes under `/api/*`, git protocol under `/git/*`, webhooks under `/hooks/*`.

**Rate limiting**: 300 req/min global, 15 req/min on auth endpoints.

### Frontend (React 19 + Vite)
```
frontend/src/
  App.tsx               # Routes, guards, lazy loading
  api/                  # API client + per-module API helpers
    client.ts           # fetch wrapper with auto token refresh
  components/
    layout/             # AppShell, Sidebar, Header, Breadcrumbs
    ui/                 # Shared components (Button, Modal, Input, etc.)
    editor/             # MarkdownRenderer, MarkdownEditor (TipTap)
  pages/                # Route components (lazy loaded)
  stores/               # Zustand stores (auth.store, ui.store)
  hooks/                # Custom hooks (useKeyboard, useRepoContext)
  lib/                  # Types, utils, guards
```

**URL pattern**: `/:org/:team/:project/issues/:num`, `/:org/:team/repos/:repo`, `/:org/:team/wiki/:space/:page`

### Data Flow
- Frontend API calls → `api/client.ts` (`get`/`post`/`patch`/`del`) → Express routes → controller → service → Prisma → PostgreSQL
- Server state cached via TanStack Query; client state via Zustand
- JWT tokens stored in `localStorage`, auto-refreshed on 401

### Git Repository Storage
Bare repos stored at `{REPOS_PATH}/{orgSlug}/{teamSlug}/{repoSlug}.git`. In dev, REPOS_PATH is `.data/repos/` (bind mount). In prod, a Docker named volume at `/data/repos`.

### Wiki Export (Pandoc)
`src/utils/pandoc.ts` converts wiki markdown to HTML, DOCX, EPUB, PDF (via weasyprint), LaTeX, plain text. Mermaid diagrams are pre-rendered to images via mermaid.ink for non-HTML formats; HTML exports include client-side mermaid.js.

---

## Design Rules (Non-Negotiable)

### No Emojis -- Ever
Never use emoji characters anywhere: no source code, no UI strings, no seed data, no comments, no commit messages. Use Lucide icons for all visual communication.

### Icons: Lucide Only
All icons must come from `lucide-react`. No other icon libraries, no inline SVGs, no unicode symbols used decoratively.

### Every Button Must Have an Icon
Every `<Button>` (and every `<button>`) rendered in the UI must include a Lucide icon alongside its label. A text-only button is never acceptable.

```tsx
// Correct
<Button><Plus className="h-4 w-4" /> New Issue</Button>
<Button variant="ghost"><Trash2 className="h-4 w-4" /> Delete</Button>

// Wrong
<Button>New Issue</Button>
<button>Delete</button>
```

Icon-only buttons (no label) are allowed when the action is unambiguous and a `title` prop is provided for accessibility.

---

## Frontend Conventions

### Shared UI Components
Before writing any UI pattern more than once, extract it into `/frontend/src/components/ui/`. Check what already exists before building:

| Component | Use for |
|-----------|---------|
| `Button` | All clickable actions |
| `Input` | Text inputs with label/hint/error |
| `Textarea` | Multi-line text with label/hint/error |
| `Modal` | Overlay dialogs (uses `createPortal`) |
| `Dropdown` / `Select` | Menus and form selects |
| `Tabs` | Tab bar navigation |
| `Tooltip` | Hover hints |
| `Progress` | Progress bars |
| `Avatar` | User avatars |
| `Badge` | Status/label chips |
| `Spinner` / `PageLoader` | Loading states |
| `EmptyState` | Zero-data placeholders |
| `ErrorBoundary` | Error recovery |
| `Toast` / `useToast` | Transient notifications (`.success()`, `.error()`, `.info()`) |
| `CommandPalette` | Global search (Cmd+K) |
| `MarkdownRenderer` | Rendered markdown with mermaid |
| `MarkdownEditor` | TipTap WYSIWYG editor |

### Component Conventions
All shared UI components must follow the `Button.tsx` pattern:
- `forwardRef` with proper generic types
- `cn()` from `@/lib/utils` for className merging
- Variant/size maps as plain objects (not arrays)
- CSS variable design tokens -- never hardcoded colors (no `text-blue-500`, use `text-primary`)
- Export named (not default)

### Design Tokens
Always use CSS variable tokens. Never use Tailwind palette colors directly in components.

```tsx
// Correct
className="text-primary bg-surface border-border"

// Wrong
className="text-indigo-600 bg-white border-gray-200"
```

Available tokens: `text`, `text-secondary`, `text-tertiary`, `text-inverse`, `primary`, `primary-hover`, `primary-light`, `primary-muted`, `accent`, `accent-light`, `surface`, `surface-secondary`, `surface-tertiary`, `surface-elevated`, `surface-overlay`, `surface-inverse`, `border`, `border-light`, `border-focus`, `danger`, `danger-light`, `warning`, `warning-light`, `success`, `success-light`.

### Routing
React Router v7. Always import from `'react-router'`, never `'react-router-dom'`.

### Data Fetching
TanStack Query (`@tanstack/react-query`) for all server state. No `useEffect` + `fetch`. Query keys must be arrays and match the API resource hierarchy. Invalidate related queries on mutations (e.g., updating an issue should invalidate `['issue']`, `['board']`, and `['issues']`).

### State Management
Zustand for global client state (`useAuthStore`, `useUIStore`). Keep stores lean -- server state belongs in React Query, not Zustand.

### API Client
All API calls go through `/frontend/src/api/client.ts` helpers (`get`, `post`, `patch`, `del`). Access tokens are stored in `localStorage` and refreshed automatically. Never call `fetch` directly in components. Exception: binary blob downloads (e.g., pandoc export) use raw `fetch` with manual auth headers.

### Forms
Use controlled inputs with `useState`. Zod for validation where schemas are reused. No form libraries.

---

## Backend Conventions

### Prisma
Always include full relationship chains when the frontend needs to build URLs:
- Issues: include `project.team.org` for `/:org/:team/:project/issues/:num`
- Wiki pages: include `space.team.org` for `/:org/:team/wiki/:space/:page`

### Auth
JWT access + refresh tokens. JWT_SECRET must be >= 32 chars. Refresh tokens stored in DB (`refreshToken` table), cleared on logout. CSRF protection via `X-Requested-With: XMLHttpRequest` header on all mutating requests.

### Error Handling
Throw `AppError(statusCode, message)` from services. The global error handler in `middleware/errorHandler.ts` catches these and returns JSON `{ error: { message } }`.

---

## Testing

### Unit/Integration Tests (Vitest)
- Located in `src/modules/**/*.test.ts`
- Point at `axiom_test` DB (never `axiom`)
- No mocked databases -- tests hit a real PostgreSQL instance
- Use Prisma `upsert` to set up fixtures, never the register endpoint (requires invite when users exist)

### E2E Tests (Playwright)
- Located in `e2e/*.spec.ts`
- Require dev stack running: `npm run docker:dev` + `npm run db:seed`
- Run with `npm run e2e`

---

## Seed Data

Demo seed: `npm run db:seed` (idempotent, safe to re-run)

| Username | Email | Password | Role |
|----------|-------|----------|------|
| tim | tim@aranea.dev | password123 | OWNER |
| test | test@aranea.dev | password123 | MEMBER |

Org: `Aranea.Dev` (slug: `aranea-dev`) -- Team: `Axiom` (slug: `axiom`) -- Project: `Axiom MVP` (prefix: `AXM`)
