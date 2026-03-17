# Axiom — Claude Code Guidelines

## Design Rules (Non-Negotiable)

### No Emojis — Ever
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

## Frontend Architecture

### Abstract Everything into Shared Components
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
| `Toast` / `useToast` | Transient notifications |
| `CommandPalette` | Global search (Cmd+K) |
| `MarkdownRenderer` | Rendered markdown with mermaid |
| `MarkdownEditor` | TipTap WYSIWYG editor |

If a new pattern appears 2+ times, it becomes a shared component immediately.

### Component Conventions
All shared UI components must follow the `Button.tsx` pattern:
- `forwardRef` with proper generic types
- `cn()` from `@/lib/utils` for className merging
- Variant/size maps as plain objects (not arrays)
- CSS variable design tokens — never hardcoded colors (no `text-blue-500`, use `text-primary`)
- Export named (not default)

### Design Tokens
Always use CSS variable tokens. Never use Tailwind palette colors directly in components.

```tsx
// Correct
className="text-primary bg-surface border-border"

// Wrong
className="text-indigo-600 bg-white border-gray-200"
```

Available tokens: `text`, `text-secondary`, `text-tertiary`, `primary`, `primary-hover`, `primary-light`, `surface`, `surface-secondary`, `surface-tertiary`, `surface-elevated`, `border`, `border-light`, `border-focus`, `danger`, `danger-light`, `warning`, `success`.

---

## Stack Conventions

### Routing
React Router v7. Always import from `'react-router'`, never `'react-router-dom'`.

Route pattern: `/:org/:team/:project/issues/:num`, `/:org/:team/wiki/:space/:page`

### Data Fetching
TanStack Query (`@tanstack/react-query`) for all server state. No `useEffect` + `fetch`. Query keys must be arrays and match the API resource hierarchy.

### State Management
Zustand for global client state (`useAuthStore`, `useUIStore`). Keep stores lean — server state belongs in React Query, not Zustand.

### API Client
All API calls go through `/frontend/src/api/client.ts` helpers (`get`, `post`, `patch`, `del`). Access tokens are stored in `localStorage` and refreshed automatically. Never call `fetch` directly in components.

### Forms
Use controlled inputs with `useState`. Zod for validation where schemas are reused. No form libraries.

---

## Testing

### Unit/Integration Tests (Vitest)
- Located in `src/modules/**/*.test.ts`
- Point at `axiom_test` DB (never `axiom`)
- No mocked databases — tests hit a real PostgreSQL instance
- Use Prisma `upsert` to set up fixtures, never the register endpoint (requires invite when users exist)

### E2E Tests (Playwright)
- Located in `e2e/*.spec.ts`
- Require dev stack running: `npm run docker:dev` + `npm run db:seed`
- Run with `npm run e2e`
- Assumes seed users (all passwords: `password123`): `admin`, `sarah-chen`, `marcus-kim`, `anika-patel`, `alex-rivera`

---

## Backend Conventions

### Prisma
Always include full relationship chains when the frontend needs to build URLs:
- Issues: include `project.team.org` for `/:org/:team/:project/issues/:num`
- Wiki pages: include `space.team.org` for `/:org/:team/wiki/:space/:page`

### Auth
JWT access + refresh tokens. JWT_SECRET must be ≥ 32 chars. Refresh tokens stored in DB (`refreshToken` table), cleared on logout.

---

## Seed Data

Demo seed: `npm run db:seed` (idempotent, safe to re-run)

| Username | Email | Password | Role |
|----------|-------|----------|------|
| admin | admin@axiom.local | password123 | OWNER |
| sarah-chen | sarah@axiom.local | password123 | ADMIN |
| marcus-kim | marcus@axiom.local | password123 | MEMBER |
| anika-patel | anika@axiom.local | password123 | MEMBER |
| alex-rivera | alex@axiom.local | password123 | MEMBER |

Org slug: `axiom` · Teams: `core`, `frontend`, `infra`
