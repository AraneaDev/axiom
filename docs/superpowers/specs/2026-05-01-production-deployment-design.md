# Production Deployment Design -- Axiom on aranea.dev

**Date:** 2026-05-01
**Status:** Approved
**Goal:** Deploy Axiom on a single VPS behind ProxyPilot, ready for real use.

---

## Deployment Architecture

```
Internet
  |
  v
Apache (ProxyPilot) -- TLS termination, Let's Encrypt
  |
  v  (port 7000, HTTP)
nginx (web container) -- SPA + reverse proxy
  |
  +-- /api/*  --> api:3000
  +-- /ws     --> api:3000 (WebSocket upgrade)
  +-- /git/*  --> api:3000 (git smart HTTP)
  +-- /*      --> static SPA (try_files fallback)
  |
  v
api container (Express, port 3000)
  |
  +-- PostgreSQL (db, internal port 5432)
  +-- Redis (internal port 6379)
```

- ProxyPilot creates a Docker reverse proxy vhost for `aranea.dev` with WebSocket support enabled.
- Apache handles TLS. The Docker stack runs HTTP-only internally.
- nginx.conf is unchanged -- it already routes `/api/`, `/ws`, `/git/` correctly.

---

## 1. Docker Hardening

### 1.1 Non-root containers

**API Dockerfile** -- add after the `base` stage:

```dockerfile
RUN addgroup -S axiom && adduser -S -G axiom axiom
```

In the `production` stage, before `CMD`:

```dockerfile
RUN mkdir -p /data/repos /data/uploads && chown -R axiom:axiom /app /data
USER axiom
```

**Frontend Dockerfile** -- no changes needed. nginx runs worker processes as `nobody` by default. The html dir copied from the build stage is world-readable.

### 1.2 Resource limits

Add to each service in `docker-compose.yml`:

| Service | `mem_limit` | `cpus` |
|---------|-------------|--------|
| api     | 512m        | 1.0    |
| web     | 128m        | 0.5    |
| db      | 512m        | 1.0    |
| redis   | 128m        | 0.25   |

### 1.3 Logging

Add to all services:

```yaml
logging:
  driver: json-file
  options:
    max-size: "10m"
    max-file: "3"
```

Prevents unbounded log growth on a 50GB disk.

### 1.4 Pin image tags

- `postgres:16.4-alpine` (not `16-alpine`)
- `redis:7.4-alpine` (not `7-alpine`)

Check latest patch versions at deploy time and pin to those.

---

## 2. Environment & Secrets

### 2.1 Production env template

Create `.env.production.example`:

```env
# Domain
DOMAIN=aranea.dev
CORS_ORIGIN=https://aranea.dev
FRONTEND_URL=https://aranea.dev

# Database
POSTGRES_DB=axiom
POSTGRES_USER=axiom
POSTGRES_PASSWORD=   # openssl rand -hex 32

# Auth
JWT_SECRET=          # openssl rand -hex 32
JWT_REFRESH_SECRET=  # openssl rand -hex 32

# Git hooks
HOOK_SECRET=         # openssl rand -hex 16

# Admin (production seed)
ADMIN_PASSWORD=      # strong password for tim user

# SMTP (Gmail)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-gmail@gmail.com
SMTP_PASS=           # Gmail App Password (16-char)
SMTP_FROM="Axiom <your-gmail@gmail.com>"

# Ports
PORT=7000
```

### 2.2 Env validation hardening

In `src/config/env.ts`:

- Add `HOOK_SECRET` to the Zod schema (required, `z.string().min(16)`).
- Add a startup guard: if `NODE_ENV=production` and any secret contains "change" or "dev", throw and refuse to start.

### 2.3 .env safety

- `.env` is already in `.gitignore`.
- The current `.env` file in the repo has dev credentials -- confirm it is not git-tracked. If tracked, remove from tracking with `git rm --cached .env`.

---

## 3. Production Seed

### 3.1 New file: `src/seed/seed-production.ts`

- Creates `Aranea.Dev` org, `Axiom` team, `Axiom MVP` project (prefix `AXM`).
- Creates user `tim` as OWNER. Password from `ADMIN_PASSWORD` env var. Refuses to run if missing.
- Sets up labels, workflows, board columns, statuses matching the dev seed.
- Skips: demo issues, fake wiki pages, test repos, dummy users (`test`).
- Idempotent: uses upserts throughout, safe to re-run.

### 3.2 package.json script

```json
"db:seed:prod": "npx tsx src/seed/seed-production.ts"
```

### 3.3 Usage

Run once after first deploy:

```bash
docker compose exec api npm run db:seed:prod
```

---

## 4. Backup Strategy

### 4.1 Script: `scripts/backup.sh`

```
/backups/axiom/
  daily/
    axiom-db-2026-05-01.sql.gz
    axiom-repos-2026-05-01.tar.gz    (only if changed)
    axiom-uploads-2026-05-01.tar.gz  (only if changed)
  weekly/
    ...
  backup.log
```

Operations:
1. `pg_dump` via `docker compose exec db pg_dump -U axiom --compress=9`
2. `tar` git_repos volume (skip if no files modified since last backup)
3. `tar` uploads volume (skip if no files modified since last backup)
4. Rotate: keep 7 daily, 4 weekly
5. Log timestamp + sizes to `backup.log`

### 4.2 Cron

```
0 3 * * * /root/axiom/scripts/backup.sh >> /backups/axiom/backup.log 2>&1
```

### 4.3 Disk budget

Estimated ~200-500MB total for all backup slots. Git repos and uploads only backed up when changed, keeping incremental cost low.

---

## 5. Security Hardening

| Layer | Status | Notes |
|-------|--------|-------|
| TLS | ProxyPilot | Let's Encrypt via Apache/Certbot |
| Firewall | ProxyPilot | UFW, only 22/80/443/10000 open |
| Fail2Ban | ProxyPilot | SSH + Apache jails |
| WAF | ProxyPilot | ModSecurity optional per-vhost |
| Helmet | Already in place | Security headers on all responses |
| CORS | Locked | `https://aranea.dev` only |
| CSRF | Already in place | `X-Requested-With` header check |
| Rate limiting | Already in place | Auth: 15/min, Global: 300/min, Git: 120/min |
| Non-root containers | This spec | `axiom` user in API container |
| JWT validation | Already in place | Min 32 chars, Zod-enforced |
| Secret startup guard | This spec | Block start on placeholder secrets |
| HOOK_SECRET | This spec | Add to Zod schema, no silent fallback |
| DB/Redis isolation | Already in place | Internal Docker network only |
| Git path safety | Already in place | `execFile` (no shell), slug-based paths |

---

## 6. SMTP (Gmail)

Existing `src/config/email.ts` works with Gmail out of the box:

- `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`
- Uses STARTTLS (`secure: port === 465` is false for 587, nodemailer uses STARTTLS by default)
- `SMTP_USER` = Gmail address, `SMTP_PASS` = Gmail App Password
- `tls.rejectUnauthorized = true` in production (already correct)

No code changes needed for email.

---

## 7. Deployment Workflow

1. Set up Forgejo repo on the VPS (temporary).
2. Push Axiom source to Forgejo.
3. Create Docker reverse proxy vhost in ProxyPilot for `aranea.dev`, pointing at port 7000, WebSocket enabled.
4. ProxyPilot clones from Forgejo, runs `docker compose up -d --build`.
5. Run `docker compose exec api npm run db:seed:prod` once.
6. Verify: `https://aranea.dev` loads, login as `tim`, git clone works over HTTPS.
7. Once running, create a repo in Axiom itself, push Axiom's source to it, update ProxyPilot's git remote. Axiom hosts itself.

---

## Out of Scope

- PgBouncer / connection pooling (single server, not needed)
- CI/CD pipeline (ProxyPilot auto-rebuild handles deploys)
- Off-server backups (add later via rsync)
- Image registry (building on-server)
- Multi-server / Kubernetes
