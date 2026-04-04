# Getting Started

This guide covers everything you need to get Axiom running locally, from prerequisites through first login.

---

## Prerequisites

| Requirement | Minimum version | Notes |
|-------------|----------------|-------|
| Node.js | 24.0.0 | The `engines` field in `package.json` enforces this. Node 25 is used in active development. |
| Docker Desktop | any recent | Required for the recommended Docker path. Compose v2 (`docker compose`) must be available. |
| Git | 2.x | Needed to clone the repo and to run `init-self-repo.sh`. |

For the manual (non-Docker) path you also need PostgreSQL 16 and Redis 7 running locally.

---

## Quick Start with Docker (Recommended)

Three commands get the full stack running:

```bash
npm run docker:dev          # Start PostgreSQL, Redis, mailserver, API (port 3000), frontend (port 7000)
npm run db:seed             # Seed demo users, org, team, project, issues, wiki
./scripts/init-self-repo.sh # Populate the self-hosted git repo
```

Once the containers are healthy, open http://localhost:7000 and log in with the demo credentials listed in the [Seed Data](#seed-data) section below.

The `docker:dev` command starts all services detached. To tail logs:

```bash
npm run docker:dev:logs
```

To stop everything:

```bash
npm run docker:dev:down
```

### What runs where

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL | 5432 | Primary database (`axiom` DB + `axiom_test` DB for tests) |
| Redis | 6379 | Cache and BullMQ job queue |
| Mailserver | 25 | Local SMTP only (docker-mailserver, SMTP_ONLY mode) |
| API | 3000 | Express backend with hot-reload via tsx watch |
| Frontend | 7000 | Vite dev server with HMR |

Both the `api` and `web` containers mount source directories as bind volumes, so file changes on the host are reflected immediately without rebuilding the image.

---

## Manual Setup (Without Docker)

Use this path if you want to run the processes directly on your host machine.

### 1. Install dependencies

```bash
npm install
cd frontend && npm install && cd ..
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Edit `.env` as needed. See the [Environment Variables](#environment-variables) section for details on each variable.

### 3. Start PostgreSQL and Redis

Ensure PostgreSQL 16 and Redis 7 are running locally on their default ports. Create the database and user:

```sql
CREATE USER axiom WITH PASSWORD 'axiom_dev';
CREATE DATABASE axiom OWNER axiom;
CREATE DATABASE axiom_test OWNER axiom;
```

### 4. Run migrations

```bash
npm run db:migrate
```

This runs `prisma migrate dev`, which applies all pending migrations and regenerates the Prisma client.

### 5. Seed demo data

```bash
npm run db:seed
```

### 6. Start the backend

```bash
npm run dev
```

The backend starts on port 3000 (or the `PORT` value in `.env`) with tsx watch for automatic restarts on file changes.

### 7. Start the frontend

In a separate terminal:

```bash
cd frontend && npm run dev
```

The Vite dev server starts on port 7000.

---

## Environment Variables

Copy `.env.example` to `.env`. The table below describes each variable.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/axiom?schema=public` | Yes | PostgreSQL connection string pointing to the `axiom` database. |
| `JWT_SECRET` | `change-me-to-a-random-secret` | Yes | Secret for signing access tokens. Must be at least 32 characters in production. |
| `JWT_REFRESH_SECRET` | `change-me-to-another-random-secret` | Yes | Secret for signing refresh tokens. Must be at least 32 characters in production. |
| `PORT` | `3000` | No | Port the Express API listens on. |
| `NODE_ENV` | `development` | No | `development`, `test`, or `production`. Controls logging verbosity and error detail. |
| `CORS_ORIGIN` | `http://localhost:7000` | Yes | Allowed origin(s) for CORS. Use `*` in dev only. Set to your domain in production. |
| `REPOS_PATH` | `.data/repos` | Yes | Filesystem path where bare git repositories are stored. In the Docker dev stack this is bind-mounted to `/data/repos` inside the API container. |
| `STORAGE_PATH` | `.data/uploads` | Yes | Filesystem path for uploaded file attachments. |
| `VITE_API_URL` | `http://localhost:3000` | Yes | The API base URL used by the Vite frontend at build and dev time. Must be reachable from the browser. |
| `REDIS_URL` | `redis://localhost:6379` | No | Redis connection string. The app runs without Redis but loses job queuing and caching. |
| `HOOK_SECRET` | `axiom-internal-hook-secret` | Yes | Shared secret between the API server and the git post-receive hook. Must match in both places. |
| `SMTP_HOST` | _(empty)_ | No | SMTP hostname. When unset, email delivery is disabled and the app continues to work without it. In Docker dev, `mailserver` handles this automatically. |
| `SMTP_PORT` | `25` | No | SMTP port. |
| `SMTP_USER` | _(empty)_ | No | SMTP authentication username. |
| `SMTP_PASS` | _(empty)_ | No | SMTP authentication password. |
| `SMTP_FROM` | `Axiom <noreply@axiom.local>` | No | From address for outbound email. |

In the Docker dev stack these variables are injected directly into the container environment via `docker-compose.dev.yml` and do not require a `.env` file on the host.

---

## Database Setup and Migrations

Axiom uses Prisma 7 with PostgreSQL 16. Migration files live in `prisma/migrations/`.

### Apply all pending migrations

```bash
npm run db:migrate
# equivalent to: prisma migrate dev
```

This also regenerates the Prisma client. Run it after pulling changes that include new migration files.

### Push schema without migration history (tests only)

```bash
npm run db:push
# equivalent to: prisma db push
```

The Vitest global setup uses `prisma db push` to sync the schema to `axiom_test` automatically before the test suite runs. You do not need to run this manually for tests.

### Regenerate the Prisma client without creating a migration

```bash
npm run db:generate
# equivalent to: prisma generate
```

Run this if you modified `prisma/schema.prisma` but do not want to create a migration yet.

---

## Seed Data

The seed script creates a complete demo environment and is idempotent (safe to run multiple times):

```bash
npm run db:seed
```

### What the seed creates

- Two user accounts (see credentials below)
- Organisation: `Aranea.Dev` (slug: `aranea-dev`)
- Team: `Axiom` (slug: `axiom`)
- Project: `Axiom MVP` (issue prefix: `AXM`)
- Issues with comments, labels, and assignments
- A wiki space with pages
- A repository record pointing to the self-hosted bare git repo

### Demo credentials

| Username | Email | Password | Role |
|----------|-------|----------|------|
| `tim` | `tim@aranea.dev` | `password123` | OWNER |
| `test` | `test@aranea.dev` | `password123` | MEMBER |

---

## Initializing the Self-Hosted Git Repository

After seeding, run:

```bash
./scripts/init-self-repo.sh
```

This creates a bare clone of the Axiom source repository at `.data/repos/aranea-dev/axiom/axiom.git`, which is the disk path that matches the repository record created by the seed. The repository is then browsable inside the app under the Axiom team's Repos section.

The script detects the correct base path automatically. If `REPOS_PATH` is set in the environment it uses that value; otherwise it defaults to `.data/repos/` next to the project root.

Run the script again at any time to pull your latest local commits into the bare clone:

```bash
./scripts/init-self-repo.sh
```

---

## Runner Setup (Optional)

A local runner is only required if you want to test the `run_workflow` automation action, which dispatches workflows to external Gitea-compatible runners. Most developers do not need this for day-to-day work.

For full setup instructions -- downloading `act_runner`, generating registration tokens, and starting the daemon -- see the [Setting Up a Local Runner](development-guide.md#setting-up-a-local-runner) section in the Development Guide.

---

## Verifying Everything Works

### Health check

```bash
curl http://localhost:3000/api/health
```

A healthy response is `200 OK`.

### Log in via the UI

1. Open http://localhost:7000
2. Log in as `tim` / `password123`
3. You should land on the dashboard for the `Aranea.Dev` organisation

### Browse issues

Navigate to the `Axiom` team and open the `Axiom MVP` project. The Issues and Board views should show seeded items.

### Browse the repository

Navigate to `Aranea.Dev > Axiom > Repos > axiom`. The file tree and commit history from your local git checkout should be visible. This requires `init-self-repo.sh` to have run successfully.

---

## Common Issues and Troubleshooting

### Containers fail to start

The `api` container waits for the `db` and `redis` health checks before starting. On a slow machine or on first run (while Docker pulls images), this can take longer than the retry window. Simply re-run:

```bash
npm run docker:dev
```

Docker Compose will restart only the failed services.

### Port already in use

If port 5432, 3000, or 7000 is occupied by another process, stop that process or change the host-side port mapping in `docker-compose.dev.yml` before starting the stack.

### `prisma migrate dev` fails with "database does not exist"

Ensure `DATABASE_URL` points to an existing database and the user has `CREATE` privileges. For the Docker dev stack this is handled automatically via the `POSTGRES_DB` / `POSTGRES_USER` environment variables on the `db` service.

### Seed script fails with "relation does not exist"

Migrations have not been applied. Run `npm run db:migrate` first, then re-run `npm run db:seed`.

### `init-self-repo.sh` exits with "not a git repository"

The script expects a `.git` directory at `/root/axiom` (the hardcoded `SOURCE_DIR` at line 17 of the script). If you cloned the repo to a different path, update that variable before running.

### Frontend shows a blank page or API 4xx/5xx errors

Confirm that `VITE_API_URL` matches the address of the running API. In the Docker dev stack this is set automatically via the `web` service environment. For manual setups, verify the value in your `.env`.

### Mailserver container is slow to become healthy

The `mailserver` service has a 15-second `start_period` before health checks begin. The `api` container waits for it. On first run this typically takes 30-60 seconds. This is expected behaviour.

---

## IDE Setup (VS Code)

The following extensions improve the development experience:

| Extension ID | Purpose |
|---|---|
| `Prisma.prisma` | Syntax highlighting and auto-format for `.prisma` schema files |
| `dbaeumer.vscode-eslint` | Inline lint errors from ESLint |
| `esbenp.prettier-vscode` | Format on save via Prettier |
| `bradlc.vscode-tailwindcss` | Class name completion for Tailwind v4 |

### Recommended workspace settings

Create `.vscode/settings.json` with:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

Setting `typescript.tsdk` ensures VS Code uses the same TypeScript version as the project rather than its bundled copy. After adding this setting, open the command palette and run **TypeScript: Select TypeScript Version > Use Workspace Version**.

### Path aliases

The backend `tsconfig.json` maps `@/*` to `src/*`. The frontend has its own `tsconfig` with the same alias scoped to `frontend/src/`. Both are resolved automatically by the TypeScript language server.
