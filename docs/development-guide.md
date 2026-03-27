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
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts", "src/mcp/**"]
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
      REPOS_PATH: '/tmp/axiom-test-repos',
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
  board.spec.ts
  create-entities.spec.ts
  helpers.ts
  issues.spec.ts
  navigation.spec.ts
  pulls.spec.ts
  repos.spec.ts
  search.spec.ts
  settings.spec.ts
  sprints.spec.ts
  wiki-edit.spec.ts
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

All backend features follow the same three-file pattern: routes, controller, service.

### Step 1: Create the module directory and files

```
src/modules/widgets/
  widgets.routes.ts
  widgets.controller.ts
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

### Step 3: Controller (`widgets.controller.ts`)

The controller handles `req`/`res` and delegates to the service.

```ts
import type { Request, Response } from 'express';
import * as widgetService from './widgets.service';

export async function getWidget(req: Request, res: Response) {
  const widget = await widgetService.getWidget(req.params.id);
  res.json(widget);
}

export async function createWidget(req: Request, res: Response) {
  const widget = await widgetService.createWidget({
    name: req.body.name,
    orgId: req.params.orgId,
  });
  res.status(201).json(widget);
}
```

### Step 4: Routes (`widgets.routes.ts`)

```ts
import { Router } from 'express';
import { requireAuth } from '../../middleware/auth';
import * as controller from './widgets.controller';

const router = Router();

router.get('/:id', requireAuth, controller.getWidget);
router.post('/', requireAuth, controller.createWidget);

export default router;
```

### Step 5: Mount in `src/index.ts`

```ts
import widgetRoutes from './modules/widgets/widgets.routes';

// inside the Express app setup:
app.use('/api/orgs/:orgSlug/widgets', widgetRoutes);
```

### Step 6: Add the Prisma model

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
