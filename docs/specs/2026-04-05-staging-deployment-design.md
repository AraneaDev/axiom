# Staging/Production Deployment Setup

**Date:** 2026-04-05
**Status:** Draft
**Scope:** Docker Compose improvements, production deployment configuration, deployment documentation

---

## 1. Problem

The current `docker-compose.yml` (production) is missing Redis, restart policies, proper volume management for uploads, and WebSocket proxy support. The nginx config lacks proper headers for running behind a reverse proxy. There is no documented deployment workflow for staging or production environments.

## 2. Goal

Create a production-ready Docker Compose setup that works for both staging and production (driven by env vars), update the dev compose for parity (health checks, restart policies), and provide a complete deployment guide for VPS deployment behind Apache.

## 3. Non-Goals

- SSH git access (deferred -- HTTPS git cloning works now)
- CI/CD pipeline automation (manual deploy via SSH)
- Kubernetes manifests
- Auto-scaling or load balancing

---

## 4. Architecture

```
Internet
    |
    v
Apache (SSL termination, port 443)
    |
    v  (ProxyPass to localhost:7000)
+------------------------------------------+
| docker-compose.yml                       |
|                                          |
|  nginx (port 7000:80)                    |
|    ├─ /         -> SPA static files      |
|    ├─ /api/*    -> api:3000              |
|    ├─ /git/*    -> api:3000              |
|    └─ /ws       -> api:3000 (WebSocket)  |
|                                          |
|  api (port 3000, internal)               |
|    ├─ Express 5 backend                  |
|    ├─ Prisma 7 ORM                       |
|    ├─ Git smart HTTP                     |
|    └─ WebSocket server                   |
|                                          |
|  db (PostgreSQL 16, internal)            |
|  redis (Redis 7, internal)               |
+------------------------------------------+
```

All services are internal except nginx on port 7000. Apache handles SSL and proxies to nginx.

---

## 5. Changes to `docker-compose.yml` (Production/Staging)

### 5.1 Add Redis service

```yaml
redis:
  image: redis:7-alpine
  restart: unless-stopped
  volumes:
    - redis_data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 3s
    retries: 3
  expose:
    - "6379"
```

### 5.2 Update api service

- Add `restart: unless-stopped`
- Add `REDIS_URL: redis://redis:6379`
- Add `STORAGE_PATH: /data/uploads`
- Add `HOOK_SECRET` from env
- Add `FRONTEND_URL` from env
- Add `API_BASE_URL: http://api:3000`
- Add `SMTP_*` env vars from env file
- Add `uploads` volume mount
- Add Redis dependency with health check condition
- Add health check (wget to /api/health)
- Use `env_file` for cleaner config, override only internal values
- Change ports to `expose` (only nginx is exposed)

### 5.3 Update web service

- Add `restart: unless-stopped`
- Pass `DOMAIN` as build arg for `VITE_API_URL` (so frontend knows the public URL)
- Keep health check

### 5.4 Update db service

- Add `restart: unless-stopped`
- Use env vars from env file for credentials
- Change ports to `expose` (internal only)

### 5.5 Update volumes

```yaml
volumes:
  pgdata:
  git_repos:
  uploads:
  redis_data:
```

### 5.6 Full production compose

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

**Key decisions:**
- Frontend hardcodes relative `/api` URLs -- no build-time config needed
- Only nginx (web) exposes a port; everything else is internal
- `DATABASE_URL` is composed from individual Postgres vars (avoids duplicating the password)
- `POSTGRES_PASSWORD` is required (will error if not set)
- `env_file: .env` on the api service loads all remaining config (JWT secrets, SMTP, CORS, etc.)
- `X-Forwarded-Proto` is set by Apache (`https`) and passed through by nginx (`$http_x_forwarded_proto`) so the backend knows the original protocol

---

## 6. Changes to `docker-compose.dev.yml`

### 6.1 Add restart policies

Add `restart: unless-stopped` to: db, redis, mailserver, api, web.

### 6.2 Add api health check start_period

Already has health check. Ensure `start_period: 10s` is present (it is).

### 6.3 No other changes

Dev compose already has Redis with health check, mailserver, proper volumes. Keep bind mounts and hot reload as-is.

---

## 7. Nginx Config Updates (`frontend/nginx.conf`)

The current config is missing:

### 7.1 WebSocket proxy for `/ws`

```nginx
location /ws {
    proxy_pass http://api:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 86400;
}
```

### 7.2 Proper proxy headers for running behind Apache

Add to all proxy locations:

```nginx
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

### 7.3 Git upload size

Already has `client_max_body_size 100m` on `/git/`. Good.

### 7.4 Full updated nginx.conf

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

---

## 8. Frontend Dockerfile

No changes needed. The frontend client hardcodes `const API_BASE = '/api'` (relative URL), so it works correctly behind any reverse proxy without build-time configuration. The existing Dockerfile is sufficient as-is.

---

## 9. Environment Template (`.env.staging.example`)

```bash
# =============================================================================
# Axiom Staging/Production Environment Configuration
# =============================================================================
# Copy this file to .env and fill in the values.
# Required values are marked with [REQUIRED].

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
# The port exposed on the host. Apache proxies to this.
PORT=7000
```

---

## 10. Deployment Guide (`docs/deployment.md`)

The deployment guide will cover:

### 10.1 Prerequisites
- VPS with Docker and Docker Compose installed
- Apache with mod_proxy, mod_proxy_http, mod_proxy_wstunnel, mod_ssl
- Domain pointed to VPS IP
- SSL certificate (Let's Encrypt via certbot or manual)

### 10.2 Initial Setup
```bash
# Clone the repo
git clone https://github.com/your-org/axiom.git /opt/axiom
cd /opt/axiom

# Create env file
cp .env.staging.example .env
# Edit .env with your values (generate secrets, set domain, SMTP, etc.)

# Build and start
docker compose up -d --build

# (Optional) Seed demo data
docker compose exec api npm run db:seed
```

### 10.3 Apache Virtual Host Configuration
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

### 10.4 Updating
```bash
cd /opt/axiom
git pull
docker compose up -d --build
```
Prisma migrations run automatically on api container start (`npx prisma migrate deploy`).

### 10.5 Backups
```bash
# Database
docker compose exec db pg_dump -U axiom axiom > backup.sql

# Git repos (volume)
docker run --rm -v axiom_git_repos:/data -v $(pwd):/backup alpine tar czf /backup/repos.tar.gz -C /data .
```

### 10.6 Logs
```bash
docker compose logs -f api     # Backend logs
docker compose logs -f web     # Nginx access logs
docker compose logs -f db      # PostgreSQL logs
```

### 10.7 Git Clone URLs
Once deployed, users clone repos via HTTPS:
```bash
git clone https://staging.example.com/git/org-slug/team-slug/repo-slug.git
```
Git credentials are the same as the Axiom login (HTTP basic auth).

---

## 11. Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `docker-compose.yml` | **Update** | Add Redis, restart policies, health checks, env_file, uploads volume, internal-only ports |
| `docker-compose.dev.yml` | **Update** | Add restart policies to all services |
| `frontend/nginx.conf` | **Update** | Add WebSocket proxy, X-Forwarded headers, proxy timeout, git buffering |
| `.env.staging.example` | **Create** | Documented environment template |
| `docs/deployment.md` | **Create** | Complete VPS deployment guide with Apache config |

---

## 12. Testing Checklist

After deployment, verify:
- [ ] Web UI loads at `https://staging.example.com`
- [ ] Can log in with seeded credentials (tim / password123)
- [ ] Real-time updates work (WebSocket connection in browser devtools)
- [ ] Can create a repository via the UI
- [ ] Can `git clone https://staging.example.com/git/org/team/repo.git`
- [ ] Can `git push` to the cloned repo
- [ ] Email delivery works (test password reset or notification)
- [ ] Runner protocol accessible (`curl -X POST https://staging.example.com/api/actions/ping.v1.PingService/Ping -d '{}'`)
- [ ] Health endpoint returns OK (`curl https://staging.example.com/api/health`)
