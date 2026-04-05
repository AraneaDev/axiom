# Staging/Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a production-ready Docker Compose setup for deploying Axiom to a VPS behind Apache, with proper Redis, health checks, restart policies, and a complete deployment guide.

**Architecture:** Update the existing `docker-compose.yml` to be a full production stack (db, redis, api, web) with env-file-driven config. Update `docker-compose.dev.yml` for parity. Update nginx config for reverse proxy headers and WebSocket support. Create env template and deployment docs.

**Tech Stack:** Docker Compose, PostgreSQL 16, Redis 7, nginx, Apache (documented)

**Spec:** `docs/specs/2026-04-05-staging-deployment-design.md`

---

## File Structure

### Modified Files

| File | Changes |
|------|---------|
| `docker-compose.yml` | Replace with full production stack (add Redis, restart policies, health checks, env_file, uploads volume, internal-only ports) |
| `docker-compose.dev.yml` | Add restart policies to all services |
| `frontend/nginx.conf` | Add WebSocket proxy, X-Forwarded-Proto passthrough, git buffering |

### New Files

| File | Purpose |
|------|---------|
| `.env.staging.example` | Documented environment template for staging/production |
| `docs/deployment.md` | Complete VPS deployment guide with Apache config |

---

## Task 1: Update `docker-compose.yml` (Production Stack)

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Read the current file**

Read `docker-compose.yml` to understand current state.

- [ ] **Step 2: Replace with full production compose**

Replace the entire contents of `docker-compose.yml` with:

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-axiom}
      POSTGRES_USER: ${POSTGRES_USER:-axiom}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}
    expose:
      - "5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-axiom}"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    expose:
      - "6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 3

  api:
    build:
      context: .
      target: production
    restart: unless-stopped
    expose:
      - "3000"
    env_file: .env
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-axiom}:${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD in .env}@db:5432/${POSTGRES_DB:-axiom}?schema=public
      REDIS_URL: redis://redis:6379
      API_BASE_URL: http://api:3000
      REPOS_PATH: /data/repos
      STORAGE_PATH: /data/uploads
      PORT: 3000
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - git_repos:/data/repos
      - uploads:/data/uploads
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  web:
    build:
      context: ./frontend
      target: production
    restart: unless-stopped
    ports:
      - "${PORT:-7000}:80"
    depends_on:
      api:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:80/"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  pgdata:
  git_repos:
  uploads:
  redis_data:
```

- [ ] **Step 3: Verify compose file is valid**

Run: `docker compose -f docker-compose.yml config --quiet`
Expected: No errors (validates syntax and variable interpolation). It will warn about missing .env vars, that's fine.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(deploy): update production compose with Redis, health checks, restart policies"
```

---

## Task 2: Update `docker-compose.dev.yml` (Dev Parity)

**Files:**
- Modify: `docker-compose.dev.yml`

- [ ] **Step 1: Read the current file**

Read `docker-compose.dev.yml`.

- [ ] **Step 2: Add restart policies to all services**

Add `restart: unless-stopped` to each service that doesn't already have it: `db`, `redis`, `mailserver`, `api`, `web`. Do NOT add it to the `tunnel` service (it's an optional profile).

For each service, add the line right after the `image:` or `build:` line, matching the indentation pattern.

Example for `db`:
```yaml
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
```

Example for `api`:
```yaml
  api:
    build:
      context: .
      dockerfile: Dockerfile.dev
    restart: unless-stopped
    ports:
```

Do this for: `db`, `redis`, `mailserver`, `api`, `web`.

- [ ] **Step 3: Verify compose file is valid**

Run: `docker compose -f docker-compose.dev.yml config --quiet`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.dev.yml
git commit -m "feat(deploy): add restart policies to dev compose services"
```

---

## Task 3: Update `frontend/nginx.conf`

**Files:**
- Modify: `frontend/nginx.conf`

- [ ] **Step 1: Read the current file**

Read `frontend/nginx.conf`.

- [ ] **Step 2: Replace with updated config**

Replace the entire contents of `frontend/nginx.conf` with:

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    # API proxy
    location /api/ {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket proxy
    location /ws {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        proxy_read_timeout 86400;
    }

    # Git smart HTTP proxy
    location /git/ {
        proxy_pass http://api:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
        client_max_body_size 100m;
        proxy_buffering off;
        proxy_request_buffering off;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

Key changes from current:
- Added `/ws` location block for WebSocket proxy (with 86400s read timeout)
- Added `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` headers to all proxy locations
- `X-Forwarded-Proto` uses `$http_x_forwarded_proto` (passthrough from Apache) not `$scheme`
- Added `proxy_buffering off` and `proxy_request_buffering off` to `/git/` for large repo streaming

- [ ] **Step 3: Commit**

```bash
git add frontend/nginx.conf
git commit -m "feat(deploy): update nginx config with WebSocket proxy and forwarded headers"
```

---

## Task 4: Create `.env.staging.example`

**Files:**
- Create: `.env.staging.example`

- [ ] **Step 1: Create the env template**

Create `.env.staging.example` with:

```bash
# =============================================================================
# Axiom Staging/Production Environment Configuration
# =============================================================================
# Copy this file to .env and fill in the values.
# Required values are marked with [REQUIRED].
#
# Generate secrets with: openssl rand -hex 32

# -- Domain ------------------------------------------------------------------
# [REQUIRED] The public domain where Axiom is accessible.
# Used for CORS, email links, and git clone URLs.
DOMAIN=staging.example.com
CORS_ORIGIN=https://staging.example.com
FRONTEND_URL=https://staging.example.com

# -- Database -----------------------------------------------------------------
# [REQUIRED] PostgreSQL credentials. The DATABASE_URL is composed automatically
# in docker-compose.yml from these values.
POSTGRES_DB=axiom
POSTGRES_USER=axiom
POSTGRES_PASSWORD=CHANGE_ME_TO_A_STRONG_PASSWORD

# -- Authentication -----------------------------------------------------------
# [REQUIRED] JWT signing secrets. Must be at least 32 characters each.
# Generate with: openssl rand -hex 32
JWT_SECRET=CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32
JWT_REFRESH_SECRET=CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_32

# -- Git Hooks ----------------------------------------------------------------
# Shared secret for internal git post-receive hook verification.
# Generate with: openssl rand -hex 16
HOOK_SECRET=CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_HEX_16

# -- Email (SMTP) -------------------------------------------------------------
# Configure a real SMTP provider (SendGrid, SES, Mailgun, etc.).
# Leave SMTP_HOST empty to disable email.
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Axiom <noreply@staging.example.com>"

# -- Ports --------------------------------------------------------------------
# The port exposed on the host. Apache/nginx reverse proxy targets this.
PORT=7000
```

- [ ] **Step 2: Commit**

```bash
git add .env.staging.example
git commit -m "feat(deploy): add staging/production environment template"
```

---

## Task 5: Create `docs/deployment.md`

**Files:**
- Create: `docs/deployment.md`

- [ ] **Step 1: Create the deployment guide**

Create `docs/deployment.md` with the complete VPS deployment guide. Content must cover:

**Prerequisites:**
- VPS with Docker and Docker Compose v2 installed
- Apache with modules: mod_proxy, mod_proxy_http, mod_proxy_wstunnel, mod_ssl, mod_headers, mod_rewrite
- Domain pointed to VPS IP
- SSL certificate (Let's Encrypt via certbot recommended)

**Initial Setup:**
```bash
git clone <repo-url> /opt/axiom
cd /opt/axiom
cp .env.staging.example .env
# Edit .env -- fill in all [REQUIRED] values
# Generate secrets: openssl rand -hex 32
docker compose up -d --build
# Optional: seed demo data
docker compose exec api npm run db:seed
```

**Apache Virtual Host Configuration:**
```apache
<VirtualHost *:443>
    ServerName staging.example.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/staging.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/staging.example.com/privkey.pem

    ProxyPreserveHost On
    ProxyRequests Off
    RequestHeader set X-Forwarded-Proto "https"

    # WebSocket upgrade
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/ws(.*)$ ws://localhost:7000/ws$1 [P,L]

    # Everything else
    ProxyPass / http://localhost:7000/
    ProxyPassReverse / http://localhost:7000/

    # Git large uploads
    LimitRequestBody 104857600
</VirtualHost>

<VirtualHost *:80>
    ServerName staging.example.com
    Redirect permanent / https://staging.example.com/
</VirtualHost>
```

**Enable required Apache modules:**
```bash
a2enmod proxy proxy_http proxy_wstunnel ssl headers rewrite
systemctl restart apache2
```

**Updating:**
```bash
cd /opt/axiom
git pull
docker compose up -d --build
# Prisma migrations run automatically on api container start
```

**Backups:**
```bash
# Database
docker compose exec db pg_dump -U axiom axiom > backup-$(date +%F).sql

# Git repos
docker run --rm -v axiom_git_repos:/data -v $(pwd):/backup alpine tar czf /backup/repos-$(date +%F).tar.gz -C /data .
```

**Logs:**
```bash
docker compose logs -f api     # Backend logs
docker compose logs -f web     # Nginx access logs
docker compose logs -f db      # PostgreSQL logs
```

**Git Clone URLs:**
```bash
git clone https://staging.example.com/git/org-slug/team-slug/repo-slug.git
# Credentials: same as Axiom login (HTTP basic auth)
```

**Seeding Demo Data:**
```bash
docker compose exec api npm run db:seed
# Creates: tim/password123 (OWNER), test/password123 (MEMBER)
# Org: Aranea.Dev > Team: Axiom > Project: Axiom MVP (prefix: AXM)
```

**Troubleshooting:**
- Check container health: `docker compose ps`
- Check API health: `curl http://localhost:3000/api/health`
- Check from outside: `curl https://staging.example.com/api/health`
- If WebSocket fails: verify `mod_proxy_wstunnel` is enabled
- If git push fails with 413: check Apache `LimitRequestBody` and nginx `client_max_body_size`

- [ ] **Step 2: Commit**

```bash
git add docs/deployment.md
git commit -m "docs: add VPS deployment guide with Apache reverse proxy config"
```

---

## Task 6: Verification

- [ ] **Step 1: Validate both compose files**

Run: `docker compose -f docker-compose.yml config --quiet 2>&1; echo "exit: $?"`
Run: `docker compose -f docker-compose.dev.yml config --quiet 2>&1; echo "exit: $?"`
Expected: No errors (warnings about missing env vars are acceptable for the production compose since there's no .env file yet).

- [ ] **Step 2: Rebuild dev stack to verify nothing broke**

Run: `npm run docker:dev:down && npm run docker:dev`
Expected: All containers start and become healthy.

- [ ] **Step 3: Verify health checks**

Run: `docker compose -f docker-compose.dev.yml ps`
Expected: All services show "healthy" status.

- [ ] **Step 4: Commit any fixes**

If any fixes were needed:
```bash
git add -A
git commit -m "fix(deploy): address issues found during verification"
```
