# Development Guide

This guide covers the full development workflow: running the stack, scripts, TypeScript, linting, testing, database migrations, and how to add new backend modules and frontend pages.

---

## Development Workflow

### Starting the stack

```bash
npm run docker:dev
```

Starts PostgreSQL 16, Redis 7, a local mailserver, the Express API on port 3000, and the Vite frontend on port 7000. Both the `api` and `web` containers bind-mount their source directories, so changes on the host are picked up immediately.

- Backend (Express + tsx watch): edits to any file under `src/` trigger an automatic restart.
  - In the WSL dev stack, `tsx watch` in the api container can miss changes on the bind mount. After backend edits, restart the API and the worker with `docker compose -f docker-compose.dev.yml restart api worker`.
  - The backend loads the shared editor core (`frontend/src/editor-core/`) as a bundle, `dist-editor-core/editor-core.cjs`, which the api and worker containers build when they start. `tsx watch` does not rebuild it: after an edit under `frontend/src/editor-core/`, run the same restart so both containers pick up the new bundle.
  - After a dependency change, rebuild the dev images: `docker compose -f docker-compose.dev.yml build api worker`.
- Frontend (Vite HMR): edits to any file under `frontend/src/` are reflected in the browser without a full reload.

To tail all container logs:

```bash
npm run docker:dev:logs
```

To stop:

```bash
npm run docker:dev:down
```

### Running without Docker

```bash
# Terminal 1 - backend
npm run dev          # tsx watch src/index.ts, port 3000

# Terminal 2 - frontend
cd frontend && npm run dev   # Vite, port 7000
```

Requires PostgreSQL and Redis running locally. See the Getting Started guide for database setup.

### Sharing your local instance via tunnel

```bash
npm run tunnel
```

Starts a Cloudflare tunnel (via `cloudflared`) that exposes port 7000 publicly. The public URL is printed in the logs. To stop just the tunnel without stopping the rest of the stack:

```bash
npm run tunnel:down
```

---

## All npm Scripts

### Root (`package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `tsx watch src/index.ts` | Run backend with file-watch restarts |
| `build` | `tsc` | Compile TypeScript to `dist/` |
| `start` | `node dist/index.js` | Run the compiled production build |
| `db:generate` | `prisma generate` | Regenerate Prisma client from schema |
| `db:migrate` | `prisma migrate dev` | Apply pending migrations and regenerate client |
| `db:push` | `prisma db push` | Push schema changes without creating a migration (used by test setup) |
| `db:setup-admin` | `tsx scripts/setup-admin.ts` | Interactive admin account creation |
| `db:seed` | `tsx scripts/seed-demo.ts` | Seed demo data (idempotent) |
| `test` | `vitest` | Run Vitest in watch mode |
| `test:run` | `vitest run` | Run Vitest once (CI mode) |
| `test:coverage` | `vitest run --coverage` | Run with v8 coverage report |
| `lint` | `eslint src/` | Lint backend source |
| `lint:fix` | `eslint src/ --fix` | Lint and auto-fix backend source |
| `format` | `prettier --write "src/**/*.ts"` | Format backend source |
| `format:check` | `prettier --check "src/**/*.ts"` | Check backend formatting without writing |
| `typecheck` | `tsc --noEmit` | Type-check backend only |
| `check` | typecheck + lint + format:check + test:run | Full CI gate |
| `docker:dev` | `docker compose -f docker-compose.dev.yml up -d` | Start dev stack detached |
| `docker:dev:down` | `docker compose -f docker-compose.dev.yml down` | Stop dev stack |
| `docker:dev:logs` | `docker compose -f docker-compose.dev.yml logs -f` | Tail dev stack logs |
| `tunnel` | Start tunnel profile + follow logs | Expose frontend via Cloudflare tunnel |
| `tunnel:down` | Stop tunnel service | Stop the tunnel only |
| `docker:prod` | `docker compose up -d` | Start production stack |
| `docker:prod:down` | `docker compose down` | Stop production stack |
| `docker:prod:build` | `docker compose build` | Build production images |
| `e2e` | `playwright test` | Run all Playwright E2E tests |
| `e2e:ui` | `playwright test --ui` | Run E2E with Playwright UI |
| `e2e:headed` | `playwright test --headed` | Run E2E with visible browser |
| `e2e:report` | `playwright show-report` | Open the last HTML test report |

### Frontend (`frontend/package.json`)

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `vite` | Vite dev server on port 7000 |
| `build` | `tsc -b && vite build` | Type-check then bundle for production |
| `preview` | `vite preview` | Serve the production build locally |
| `lint` | `eslint src/` | Lint frontend source |
| `lint:fix` | `eslint src/ --fix` | Lint and auto-fix frontend source |
| `format` | `prettier --write "src/**/*.{ts,tsx}"` | Format frontend source |
| `format:check` | `prettier --check "src/**/*.{ts,tsx}"` | Check frontend formatting |
| `typecheck` | `tsc -b` | Type-check frontend (composite build) |
| `check` | typecheck + lint + format:check | Full frontend CI gate |
| `test` | `vitest` | Frontend unit tests in watch mode |
| `test:run` | `vitest run` | Frontend unit tests once |

---

## TypeScript Configuration

### Backend (`tsconfig.json`)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "strict": true,
    "esModuleInterop": true,
    "baseUrl": "./src",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

The `@/*` alias maps to `src/*`. Import using `@/config/database` rather than `../../config/database` in deeply nested files.

Type-check the backend:

```bash
npx tsc --noEmit
# or
npm run typecheck
```

### Frontend

The frontend uses a composite TypeScript build (`tsc -b`). Type-check it:

```bash
cd frontend && npx tsc -b
# or
cd frontend && npm run typecheck
```

---

## Linting and Formatting

### ESLint

ESLint 9 with flat config. Root config: `eslint.config.mjs`. Frontend config: `frontend/eslint.config.mjs`.

```bash
# Backend
npm run lint
npm run lint:fix

# Frontend
cd frontend && npm run lint
cd frontend && npm run lint:fix
```

Both configs use `typescript-eslint`, `eslint-plugin-import-x`, and `eslint-plugin-jsdoc`. The frontend additionally includes `eslint-plugin-react-hooks` and `eslint-plugin-react-refresh`.

### Prettier

```bash
# Backend
npm run format          # write
npm run format:check    # check only

# Frontend
cd frontend && npm run format
cd frontend && npm run format:check
```

### Pre-commit hooks (Husky + lint-staged)

Husky is installed via the `prepare` lifecycle script. Two hooks run automatically:

- **`pre-commit`**: runs `lint-staged`, which applies ESLint `--fix` and Prettier `--write` to all staged `.ts` / `.tsx` files.
- **`commit-msg`**: runs `commitlint` to enforce the Conventional Commits format.

The `lint-staged` configuration in `package.json`:

```json
{
  "lint-staged": {
    "src/**/*.ts": [
      "eslint --fix",
      "prettier --write"
    ],
    "frontend/src/**/*.{ts,tsx}": [
      "npx eslint --fix --config frontend/eslint.config.mjs",
      "prettier --write"
    ]
  }
}
```

---

## Testing Strategy

Axiom has two layers of automated tests:

1. **Vitest unit/integration tests** — hit a real PostgreSQL database (`axiom_test`), no mocks.
2. **Playwright E2E tests** — run against the full dev stack.

### Vitest (unit and integration)

Configuration: `vitest.config.ts`

Key settings:

```ts
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    globalSetup: ['./src/test/global-setup.ts'],
    env: {
      DATABASE_URL: 'postgresql://axiom:axiom_dev@localhost:5432/axiom_test?schema=public',
      JWT_SECRET: 'test-secret-must-be-at-least-32-characters-long',
      JWT_REFRESH_SECRET: 'test-refresh-secret-must-be-32-chars-long',
      PORT: '3001',
      NODE_ENV: 'test',
    },
    testTimeout: 15000,
    sequence: { concurrent: false },
    fileParallelism: false,
    include: ['src/**/*.{test,spec}.ts'],
  },
});
```

- Tests run sequentially (`fileParallelism: false`, `sequence.concurrent: false`) to avoid transaction conflicts on the shared test database.
- The global setup (`src/test/global-setup.ts`) runs `prisma db push` against `axiom_test` before any test file executes, ensuring the schema is current.
- All tests target the `axiom_test` database, never `axiom`.

**Run tests:**

```bash
npm run test           # watch mode
npm run test:run       # single run (CI)
npm run test:coverage  # with v8 HTML coverage report
```

**Run a single file:**

```bash
npm run test -- --run src/modules/auth/auth.test.ts
```

### Writing tests

Tests use `supertest` to make HTTP requests against the Express app and Prisma to set up fixtures.

```ts
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { prisma } from '../../config/database';
import app from '../../index';

describe('Auth API', () => {
  const testUser = {
    email: 'test@axiom.dev',
    username: 'testuser',
    displayName: 'Test User',
    password: 'securepassword123',
  };

  beforeAll(async () => {
    const passwordHash = await bcrypt.hash(testUser.password, 4); // low rounds for speed
    await prisma.user.upsert({
      where: { username: testUser.username },
      update: {},
      create: {
        email: testUser.email,
        username: testUser.username,
        displayName: testUser.displayName,
        passwordHash,
      },
    });
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: testUser.email } });
    if (user) {
      await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });

  it('should reject login with wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Requested-With', 'XMLHttpRequest')
      .send({ username: testUser.username, password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
```

Key conventions:

- Use `prisma.*.upsert` for fixture creation, never the register/create API endpoints (which have invite guards).
- Always clean up in `afterAll` to avoid state leaking between test files.
- Set `X-Requested-With: XMLHttpRequest` on all mutating requests (CSRF middleware requirement).

### Playwright E2E tests

E2E tests live in `e2e/`. Spec files:

```
e2e/
  auth.spec.ts
  automation-rules.spec.ts
  board.spec.ts
  create-entities.spec.ts
  custom-fields.spec.ts
  issue-links.spec.ts
  issue-templates.spec.ts
  issues.spec.ts
  labels.spec.ts
  milestones.spec.ts
  navigation.spec.ts
  notifications.spec.ts
  project-settings.spec.ts
  query-filter.spec.ts
  routing.spec.ts
  search.spec.ts
  settings.spec.ts
  sprints.spec.ts
  wiki-edit.spec.ts
  wiki-templates.spec.ts
  wiki.spec.ts
```

**Prerequisite:** the dev stack must be running (`npm run docker:dev`) and seeded (`npm run db:seed`).

```bash
npm run e2e           # headless, all specs
npm run e2e:headed    # with visible browser
npm run e2e:ui        # Playwright interactive UI
npm run e2e:report    # open last HTML report
```

---

## Database Migrations

Axiom uses Prisma 7. The schema lives at `prisma/schema.prisma`. Migration files are committed to version control under `prisma/migrations/`.

### Create a new migration

After modifying `prisma/schema.prisma`:

```bash
npm run db:migrate
# prompts for a migration name, e.g. "add_user_bio"
```

Prisma creates the SQL file under `prisma/migrations/<timestamp>_<name>/migration.sql`, applies it to the development database, and regenerates the client.

### Apply migrations without prompts (CI / production)

```bash
npx prisma migrate deploy
```

This applies all pending migrations without interactive prompts and does not regenerate the client. Run `npm run db:generate` afterward if the client is needed.

### Inspect the current schema state

```bash
npx prisma studio
```

Opens a browser-based GUI at http://localhost:5555.

---

## Adding a New Backend Module

All backend features follow the same pattern: an actions file that declares what the module can do, and a service that does it. There are no route or controller files. Every operation is an action, and its REST path, the MCP tools, `/api/act` and the OpenAPI page all come from it.

### Step 1: Create the module directory and files

```
src/modules/widgets/
  widgets.actions.ts
  widgets.service.ts
```

### Step 2: Service (`widgets.service.ts`)

The service contains all business logic. It receives plain parameters (never `req`/`res`) and talks to Prisma.

```ts
import { prisma } from '../../config/database';
import { AppError } from '../../middleware/errorHandler';

export async function getWidget(id: string) {
  const widget = await prisma.widget.findUnique({ where: { id } });
  if (!widget) throw new AppError(404, 'Widget not found');
  return widget;
}

export async function createWidget(data: { name: string; orgId: string }) {
  return prisma.widget.create({ data });
}
```

### Step 3: Actions (`widgets.actions.ts`)

Each action names itself, its area and kind, its input and output, who may run it, and the REST route it answers. The area and kind decide which token scope reaches it. The handler calls the service.

```ts
import { z } from 'zod';

import { defineAction } from '../../actions/define';
import { registerActions } from '../../actions/registry';

import * as widgetService from './widgets.service';

const target = z.object({ widgetId: z.string().min(1).max(64) });

registerActions([
  defineAction({
    name: 'widget.get',
    area: 'issues',
    kind: 'read',
    summary: 'Get a widget',
    target,
    input: target,
    output: z.looseObject({ id: z.string() }),
    rest: { method: 'GET', path: '/api/widgets/:widgetId' },
    authorize: async (ctx, { widgetId }) => {
      // Throw a 403 or 404 unless ctx.userId may open this widget
    },
    handler: async (_ctx, { widgetId }) => widgetService.getWidget(widgetId),
  }),
]);
```

Mark what needs care: `destructive` for deletes, `admin` for what only an approver should allow a token, `permissionChange` for sharing, `uiOnly` or `tokenBlocked` for what a token must never run, `preview` for what the approver reads. See [Design Patterns](design-patterns.md#backend-module-pattern) for the rules.

### Step 4: Register the file in `src/index.ts`

Import the actions file above the `mountActions` call. A file that is not imported registers nothing, and its routes don't exist.

```ts
import './modules/widgets/widgets.actions';
```

`registry-rules.test.ts`, `parity.test.ts` and `token-reach.test.ts` check the new action. Add its scopes to `src/actions/token-reach.json` in the same commit; the test fails and says which.

### Step 5: Add the Prisma model

Add your model to `prisma/schema.prisma`, then run:

```bash
npm run db:migrate
```

---

## Adding a New Frontend Page

### Step 1: Create the page component

```tsx
// frontend/src/pages/WidgetsPage.tsx
import { useQuery } from '@tanstack/react-query';
import { Box } from 'lucide-react';
import { get } from '@/api/client';
import { PageLoader } from '@/components/ui/PageLoader';
import { EmptyState } from '@/components/ui/EmptyState';

export function WidgetsPage() {
  const { data: widgets, isLoading } = useQuery({
    queryKey: ['widgets', orgSlug],
    queryFn: () => get<Widget[]>(`/api/orgs/${orgSlug}/widgets`),
  });

  if (isLoading) return <PageLoader />;
  if (!widgets?.length) {
    return <EmptyState icon={Box} title="No widgets" description="Create your first widget." />;
  }

  return (
    <div className="p-6">
      {widgets.map((w) => (
        <div key={w.id}>{w.name}</div>
      ))}
    </div>
  );
}
```

Key conventions:
- Use `get`/`post`/`patch`/`del` from `@/api/client`, never `fetch` directly.
- Use `useQuery` for all data fetching; no `useEffect` + `fetch`.
- Query keys must be arrays matching the resource hierarchy, e.g. `['widgets', orgSlug]`.
- Use design token classes (`text-primary`, `bg-surface`, `border-border`), never Tailwind palette colors.
- Every `<Button>` must include a Lucide icon.

### Step 2: Add the route in `App.tsx`

Pages are lazy-loaded:

```tsx
const WidgetsPage = lazy(() =>
  import('./pages/WidgetsPage').then((m) => ({ default: m.WidgetsPage }))
);

// inside the route tree:
<Route path="/:org/:team/widgets" element={<WidgetsPage />} />
```

### Step 3: Add an API helper (optional but recommended)

```ts
// frontend/src/api/widgets.ts
import { get, post } from './client';

export const widgetsApi = {
  list: (orgSlug: string) => get<Widget[]>(`/api/orgs/${orgSlug}/widgets`),
  create: (orgSlug: string, name: string) =>
    post<Widget>(`/api/orgs/${orgSlug}/widgets`, { name }),
};
```

### Step 4: Add navigation

Add a sidebar link inside the appropriate section of `frontend/src/components/layout/Sidebar.tsx` using a Lucide icon.

---

## Extending the Query Engine

The query engine lives in `src/lib/query-engine/`. It parses, compiles, and evaluates structured filter expressions against issue data. To add a new filterable field, edit the field registry.

### Adding a field to `issueFieldRegistry`

Open `src/lib/query-engine/fields/issue-fields.ts` and add an entry to the `issueFieldRegistry` object. The key is the field name users type in filter expressions.

```ts
// src/lib/query-engine/fields/issue-fields.ts
export const issueFieldRegistry: FieldRegistry = {
  // existing fields...

  dueDate: {
    type: 'date',
    column: 'dueDate',
  },

  milestone: {
    type: 'relation',
    column: 'milestoneId',
    join: 'milestone',
  },

  voteCount: {
    type: 'number',
    column: 'voteCount',
  },
};
```

**Field types:**

| Type | Use for |
|------|---------|
| `enum` | Fields with a fixed set of string values (status, priority, type) |
| `string` | Free-text fields (title, description) |
| `number` | Numeric fields (count, estimate) |
| `date` | Date/datetime fields |
| `relation` | Foreign key fields resolved via a join |
| `user` | User assignment fields (assignee, reporter) |
| `derived` | No single column answers it (blocked, text, sprintstate): compiled and evaluated side by side in `derived-fields.ts` |

Custom fields (`cf.Name`) aren't in the registry. `src/modules/search/query-fields.service.ts` resolves their names and `linked` keys for the query's scope before compiling or evaluating, and hands the answers over in the `QueryContext`. Any new caller of `compileToPrisma` or `evaluate` must call `resolveQueryFields` first. Write a custom field value with `typedCustomFieldValue`: number and date comparisons run on its typed columns. `src/modules/search/query-fields.test.ts` fails on a write that doesn't.

**Field options:**

| Option | Purpose |
|--------|---------|
| `column` | The Prisma model field name to filter on |
| `values` | Allowed enum values (for `enum` type) |
| `ordinal` | Map of enum value to sort order (for ordering by enum fields) |
| `join` | Relation name to include when the field requires a JOIN |
| `many` | `true` if the relation is one-to-many (e.g., labels) |
| `aliasField` | Alternative field name accepted in queries (display alias) |

### Adding a field registry for a new resource type

To support filtering on a different resource (e.g., sprints, wiki pages), create a new registry file following the same pattern:

```ts
// src/lib/query-engine/fields/sprint-fields.ts
import type { FieldRegistry } from '../types';

export const sprintFieldRegistry: FieldRegistry = {
  status: {
    type: 'enum',
    column: 'status',
    values: ['PLANNING', 'ACTIVE', 'COMPLETED'],
  },
};
```

Then pass your registry to the compiler and evaluator instead of `issueFieldRegistry`. The parser is resource-agnostic and requires no changes.

---

## Adding Automation Actions

Automation actions are executed in `src/modules/automation/automation.service.ts` inside the `executeActions` function.

### Adding a new action type

Add a case to the `switch` statement in `executeActions`:

```ts
case 'SET_MILESTONE': {
  const milestoneId = resolveTemplate(action.value, templateCtx);
  await issueService.updateIssue(issue.id, { milestoneId }, actorId);
  break;
}
```

**Template expressions:** use `resolveTemplate(text, templateCtx)` to interpolate dynamic values into any string before using it. This handles `{{dot.path}}` traversal and `{{functionName()}}` built-ins.

**Service layer routing:** actions must call service methods (e.g., `issueService.updateIssue`), never raw Prisma directly. This ensures side effects (realtime events, audit log) fire correctly.

**Guards to respect:**

| Guard | Purpose |
|-------|---------|
| `skipAutomation` flag on the issue | Prevents re-triggering while an automation is already running on that issue |
| Depth counter | Limits recursive automation chains to prevent infinite loops |
| Creation limits | Caps the number of sub-issues or comments that can be created in a single automation run |

Always check these guards before performing any write in a new action case.

---

## Query Engine Testing

Unit tests for the query engine live in `src/lib/query-engine/__tests__/`. These tests are fully standalone -- no database or running server required.

### Running the tests

```bash
cd src/lib/query-engine && npx vitest run --config vitest.config.ts
```

Or from the project root using the standard test runner (the query engine tests are included via glob):

```bash
npm run test:run
```

### Test pattern

Every test follows the same three-step pattern:

```ts
import { parseQuery } from '../parser';
import { compileQuery } from '../compiler';
import { evaluateQuery } from '../evaluator';
import { issueFieldRegistry } from '../fields/issue-fields';

it('filters by status', () => {
  // 1. Parse -- convert query string to AST
  const ast = parseQuery('status = OPEN');

  // 2. Compile -- validate AST against field registry, build filter structure
  const compiled = compileQuery(ast, issueFieldRegistry);

  // 3. Evaluate -- apply compiled filter to in-memory data
  const results = evaluateQuery(issues, compiled);

  expect(results).toHaveLength(2);
  expect(results.every((i) => i.status === 'OPEN')).toBe(true);
});
```

Because evaluation is pure (no I/O), fixtures are plain objects defined inline. For compiler tests, assert on the compiled structure. For parser tests, assert on the AST shape.

---

## Template Variable Syntax

Template variables are used in automation action values and wiki page templates. They are resolved at runtime by `resolveTemplate(text, context)` in `src/lib/template-engine/`.

### Syntax forms

**Dot-path traversal** -- access nested context properties:

```
{{issue.title}}
{{issue.assignee.displayName}}
{{trigger.field}}
{{actor.username}}
```

**Built-in function calls** -- call zero-argument functions:

```
{{now()}}          -- current ISO timestamp
{{currentUser()}}  -- username of the acting user
{{empty()}}        -- empty string (useful for clearing a field)
```

### Available context shapes

**`AutomationTemplateContext`** -- available inside automation action values:

| Path | Value |
|------|-------|
| `{{issue.*}}` | Any field on the issue being processed |
| `{{trigger.field}}` | The field name that triggered the rule |
| `{{trigger.oldValue}}` | Previous value before the triggering change |
| `{{trigger.newValue}}` | New value after the triggering change |
| `{{actor.username}}` | User who caused the triggering event |

**`WikiTemplateContext`** -- available in wiki page templates:

| Path | Value |
|------|-------|
| `{{currentUser()}}` | Username of the person creating the page |
| `{{team.name}}` | Name of the current team |
| `{{space.name}}` | Name of the wiki space |

### Unresolved references

If a path does not exist in the context, `resolveTemplate` leaves the placeholder unchanged (it does not throw). This makes it safe to use templates even when partial context is available.

---

## Git Conventions

### Commit message format

Commitlint enforces [Conventional Commits](https://www.conventionalcommits.org/). The `commit-msg` hook rejects messages that do not conform.

Format: `<type>: <description>`

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Subject case rules: not start-case, not PascalCase, not UPPER CASE.

Examples:

```
feat: add widget list endpoint
fix: correct pagination offset in issues query
refactor: extract label badge into shared component
docs: add getting started guide
test: add widget service unit tests
```

### Branch naming

Branch from `master`. Use descriptive, lowercase, hyphen-separated names:

```
feat/widget-crud
fix/issue-pagination
refactor/label-badge
```

---

## Debugging Tips

### Backend

- Set `NODE_ENV=development` for verbose error responses including stack traces.
- Morgan HTTP logging is active in development; all requests are printed to stdout.
- Attach a debugger via `node --inspect` by replacing the `dev` script temporarily, or use VS Code's "Attach to Node Process" launch configuration.
- Use `npx prisma studio` to inspect database state at http://localhost:5555.

### Frontend

- TanStack Query DevTools are available in development mode at the bottom of every page (the floating icon).
- The Vite dev server proxies are not used; the frontend talks directly to `VITE_API_URL`. If you see CORS errors, confirm the API is running and the origin is in `CORS_ORIGIN`.
- React 19 strict mode is active, meaning effects run twice in development. If a side effect fires twice unexpectedly, this is expected behaviour.

### Docker

```bash
# View logs for a specific service
docker compose -f docker-compose.dev.yml logs -f api
docker compose -f docker-compose.dev.yml logs -f web

# Open a shell inside a running container
docker compose -f docker-compose.dev.yml exec api sh
docker compose -f docker-compose.dev.yml exec db psql -U axiom
```
