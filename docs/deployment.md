# Deployment Guide

This guide covers deploying Axiom in both development and production environments.

---

## Development Deployment

Development uses `docker-compose.dev.yml`, which runs five services: `db` (PostgreSQL 16), `redis` (Redis 7), `mailserver` (docker-mailserver), `api` (backend with hot reload), and `web` (Vite dev server).

### Starting the Stack

```bash
npm run docker:dev          # Start all services
npm run db:seed             # Seed demo data (idempotent)
./scripts/init-self-repo.sh # Initialize the self-hosted git repo
```

### Port Mapping (dev)

| Service | Host Port |
|---------|-----------|
| PostgreSQL | 5432 |
| Redis | 6379 |
| API | 3000 |
| Frontend (Vite) | 7000 |

### Source Mounts (dev)

The dev container mounts source directories for hot reload:

- `./src` → `/app/src`
- `./prisma` → `/app/prisma`
- `./scripts` → `/app/scripts`
- `./.data/repos` → `/data/repos`
- `./.data/uploads` → `/data/uploads`

The backend uses `tsx watch` for automatic restart on file changes. The frontend uses Vite's HMR. Both `.data/repos` and `.data/uploads` are created on the host automatically by Docker when they do not exist.

### Dev Mail Server

The dev stack includes `docker-mailserver` (SMTP only, no spam/virus scanning) listening on port 25 internally at hostname `mailserver`. The API connects to it automatically via `SMTP_HOST=mailserver`. No additional mail configuration is needed in development.

---

## Production Deployment

Production uses `docker-compose.yml`, which runs three services: `db`, `api`, and `web`.

### Starting Production

```bash
# Copy and customize the environment file
cp .env.example .env
# Edit .env with real secrets and settings (see Environment Variables below)

docker compose up -d
```

### Production Build Details

**Backend** (`Dockerfile`): Multi-stage build on `node:25-alpine`. Installs `git`, `pandoc`, `weasyprint`, and `font-noto` for wiki export. Final image runs `prisma migrate deploy` then `node dist/index.js`.

**Frontend** (`frontend/Dockerfile`): Builds with Vite, then serves static files via `nginx:alpine`. Nginx proxies `/api/` and `/git/` paths to `http://api:3000` and serves the SPA via `try_files`.

### Port Mapping (production)

| Service | Host Port |
|---------|-----------|
| API | 3000 |
| Frontend (nginx) | 7000 → 80 |

In production the database port is not exposed to the host; the `db` service uses `expose: 5432` (internal only).

### Volumes

| Volume | Purpose |
|--------|---------|
| `pgdata` | PostgreSQL data |
| `git_repos` | Bare git repositories |

The dev stack also has `redis-data`, `maildata`, and `mailstate` volumes.

---

## Environment Variables Reference

Copy `.env.example` to `.env` and fill in all required values before starting.

### Backend Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string. Format: `postgresql://user:pass@host:5432/dbname?schema=public` |
| `JWT_SECRET` | Yes | — | Secret for signing JWT access tokens. Minimum 32 characters. |
| `JWT_REFRESH_SECRET` | Yes | — | Secret for signing JWT refresh tokens. Minimum 32 characters. Must differ from `JWT_SECRET`. |
| `PORT` | No | `3000` | Port the API server listens on. |
| `NODE_ENV` | No | `development` | Runtime environment. Set to `production` in prod. Accepted values: `development`, `production`, `test`. |
| `REPOS_PATH` | No | `/data/repos` | Filesystem path where bare git repositories are stored. In dev, bind-mounted to `.data/repos`. In production, a named Docker volume at `/data/repos`. |
| `STORAGE_PATH` | No | `.data/uploads` | Filesystem path for file uploads and attachments. |
| `CORS_ORIGIN` | No | `*` | Allowed CORS origin(s). Set to your frontend domain in production (e.g., `https://axiom.example.com`). Never use `*` in production. |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL. App functions without Redis; caching is disabled when Redis is unavailable. |
| `HOOK_SECRET` | No | random | Shared secret between the API and git post-receive hook scripts. Must match the value installed in each bare repo's hook. If not set, a random secret is generated at startup (hooks will break on restart). |
| `SMTP_HOST` | No | — | SMTP server hostname. When not set, email delivery is disabled entirely and the app continues to function. |
| `SMTP_PORT` | No | `25` | SMTP server port. The transport uses `secure: true` only when port is `465`. |
| `SMTP_USER` | No | — | SMTP authentication username. Only used when both `SMTP_USER` and `SMTP_PASS` are set. |
| `SMTP_PASS` | No | — | SMTP authentication password. |
| `SMTP_FROM` | No | `Axiom <noreply@axiom.local>` | From address for outbound email. |

### Frontend Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | No | `http://localhost:3000` | API base URL used by Vite during build and dev. In dev docker-compose, set to `http://api:3000`. |

---

## Database Setup

### PostgreSQL Version

Axiom requires **PostgreSQL 16**. The Docker images use `postgres:16-alpine`.

### Connection String Format

```
postgresql://USER:PASSWORD@HOST:PORT/DBNAME?schema=public
```

Example for production:

```
DATABASE_URL=postgresql://axiom:strong_password@db:5432/axiom?schema=public
```

### Migrations

Migrations run automatically at container startup via `prisma migrate deploy`. The migration files live in `prisma/`. The schema file is at `prisma/schema.prisma`.

To run migrations manually:

```bash
npx prisma migrate deploy
```

To reset the database in development:

```bash
npx prisma migrate reset
npm run db:seed
```

### Test Database

The dev docker-compose mounts `./scripts/init-test-db.sql` into PostgreSQL's init directory, which creates a second database (`axiom_test`) used by Vitest integration tests. Tests always run against `axiom_test`, never `axiom`.

### Prisma Client

The backend uses `@prisma/adapter-pg` (connection pool via `pg`) rather than the default Prisma engine. The pool reads `DATABASE_URL` from the environment. In development, Prisma logs queries, warnings, and errors; in production only errors are logged.

---

## Redis Configuration

Redis is used for best-effort caching (repository file trees, etc.) with a default TTL of 60 seconds. The application degrades gracefully when Redis is unavailable — all cache operations silently no-op.

The client (`ioredis`) connects lazily with up to 3 retries using exponential backoff (200 ms, 400 ms, 800 ms). After 3 failed attempts it stops retrying.

Set `REDIS_URL` to point at your Redis instance:

```
REDIS_URL=redis://redis:6379
# With authentication:
REDIS_URL=redis://:yourpassword@redis:6379
```

The dev stack runs Redis 7 (`redis:7-alpine`) with a named volume `redis-data` for persistence.

---

## SMTP / Email Setup

Email delivery is optional. When `SMTP_HOST` is not set the application logs "SMTP not configured, email delivery disabled" and continues without sending any email.

### Port Behaviour

- Port `25`: plain SMTP (no TLS wrapper)
- Port `465`: implicit TLS (`secure: true`)
- Port `587`: STARTTLS (handled automatically by nodemailer)

### TLS Verification

In production (`NODE_ENV=production`), TLS certificate verification is enforced (`rejectUnauthorized: true`). In development, verification is skipped to allow self-signed certificates.

### Example: External SMTP (SendGrid)

```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.your-api-key
SMTP_FROM=Axiom <noreply@yourcompany.com>
```

### Example: Amazon SES

```
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER=AKIAIOSFODNN7EXAMPLE
SMTP_PASS=your-ses-smtp-password
SMTP_FROM=Axiom <noreply@yourcompany.com>
```

---

## Git Repository Storage

Bare repositories are stored at `{REPOS_PATH}/{orgSlug}/{teamSlug}/{repoSlug}.git`.

### Dev

Source bind mount: `.data/repos` on the host → `/data/repos` in the container. The `.data/` directory is gitignored.

### Production

A named Docker volume `git_repos` is mounted at `/data/repos`. Data persists across container restarts and upgrades.

### HOOK_SECRET

Each bare repo contains a `hooks/post-receive` script that calls `POST /api/internal/hooks/post-receive`. The script authenticates using `X-Hook-Secret: <HOOK_SECRET>`. This secret is set via the `HOOK_SECRET` environment variable.

**Important**: If `HOOK_SECRET` is not set, a random secret is generated at runtime. This means post-receive hooks installed before the restart will have a different secret and will stop working. Always set `HOOK_SECRET` explicitly in production.

### Uploads / File Storage

`STORAGE_PATH` sets the path for uploaded files and attachments. In dev this is `.data/uploads`. In production, mount a persistent volume at this path.

---

## SSL / TLS

The production `docker-compose.yml` does not include a TLS termination layer. For production deployments, place a reverse proxy in front of the nginx container. Common options:

- **Nginx reverse proxy** with Let's Encrypt certificates (Certbot)
- **Caddy** (automatic HTTPS)
- **Cloudflare Tunnel** — the dev compose includes an optional `tunnel` profile using `cloudflare/cloudflared`: `docker compose --profile tunnel up`
- **Load balancer TLS termination** (AWS ALB, GCP Load Balancer, etc.)

The frontend nginx config (`frontend/nginx.conf`) listens on port 80 only. Terminate TLS at the ingress layer and proxy plain HTTP internally.

Set `CORS_ORIGIN` to your public HTTPS domain once TLS is in place:

```
CORS_ORIGIN=https://axiom.example.com
```

---

## Backup Strategy

### Database

Use `pg_dump` for logical backups:

```bash
# Full backup
docker exec axiom-db-1 pg_dump -U axiom axiom > backup-$(date +%Y%m%d).sql

# Restore
docker exec -i axiom-db-1 psql -U axiom axiom < backup-20260101.sql
```

For production, schedule daily backups with `pg_dump` and ship them to object storage (S3, GCS, etc.). Consider point-in-time recovery (WAL archiving) for low-RPO requirements.

### Git Repositories

The `git_repos` Docker volume contains all bare repositories. Back up with:

```bash
# Tar the volume contents
docker run --rm -v axiom_git_repos:/data -v $(pwd):/backup alpine \
  tar czf /backup/git-repos-$(date +%Y%m%d).tar.gz -C /data .
```

Alternatively, use `rsync` on the host path if using a bind mount.

### Uploads

Back up the uploads volume the same way as git repos, substituting the uploads volume name.

---

## Health Checks and Monitoring

### Health Endpoint

The API exposes a health endpoint:

```
GET /api/health
```

It returns HTTP 200 when the service is healthy. There is also a bare `GET /health` at the root that returns 200 (used by infrastructure-level probes).

### Docker Health Checks

Both compose files define health checks:

**API** (dev):
```yaml
test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
interval: 30s
timeout: 5s
retries: 3
start_period: 10s
```

**Frontend** (nginx, production):
```yaml
test: ["CMD", "curl", "-f", "http://localhost:80/"]
interval: 30s
timeout: 5s
retries: 3
```

**PostgreSQL** (both):
```yaml
test: ["CMD-SHELL", "pg_isready -U axiom"]
interval: 5s
timeout: 5s
retries: 5
```

**Redis** (dev):
```yaml
test: ["CMD", "redis-cli", "ping"]
interval: 10s
timeout: 3s
retries: 3
```

The API service uses `depends_on` with `condition: service_healthy` for PostgreSQL and Redis, ensuring the database is ready before migrations run.

---

## Scaling Considerations

- **API**: The backend is stateless aside from JWT secrets and the git hook secret. Multiple API replicas can run behind a load balancer as long as they share the same PostgreSQL instance, Redis instance, and storage volumes (`REPOS_PATH`, `STORAGE_PATH`).
- **Frontend**: The nginx container is fully stateless. Multiple replicas can run behind any load balancer.
- **Database**: Standard PostgreSQL scaling applies (read replicas, connection pooling via PgBouncer). The Prisma adapter uses a `pg.Pool` connection pool per process.
- **Redis**: A single Redis instance is sufficient for caching. Redis is not required for correctness, only performance.
- **Git repositories**: The `REPOS_PATH` volume must be shared across all API replicas (e.g., NFS, EFS, or a distributed filesystem). Git operations are performed by spawning `git` CLI subprocesses on the local filesystem.
- **Rate limiting**: The API enforces 300 requests/minute globally and 15 requests/minute on auth endpoints. These limits are per-process; adjust when running multiple replicas behind a shared-state rate limiter.
