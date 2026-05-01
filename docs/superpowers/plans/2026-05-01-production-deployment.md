# Production Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Axiom production-ready for deployment on aranea.dev behind ProxyPilot.

**Architecture:** Apache (ProxyPilot, TLS) -> nginx (port 7000, SPA + reverse proxy) -> Express API (port 3000) -> PostgreSQL + Redis (internal). Non-root containers, resource-limited, with automated backups.

**Tech Stack:** Docker Compose, PostgreSQL 16, Redis 7, Node.js 25, nginx, bash (backup script)

**Spec:** `docs/superpowers/specs/2026-05-01-production-deployment-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `Dockerfile` | Add non-root `axiom` user, chown dirs |
| Modify | `docker-compose.yml` | Resource limits, logging, pin image tags |
| Modify | `src/config/env.ts` | Add `HOOK_SECRET`, production secret guard |
| Create | `.env.production.example` | Production env template for aranea.dev |
| Create | `scripts/seed-production.ts` | Production seed (org/team/project + tim user) |
| Modify | `package.json` | Add `db:seed:prod` script |
| Create | `scripts/backup.sh` | Automated backup with rotation |

---

### Task 1: Harden API Dockerfile with non-root user

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Read the current Dockerfile**

The current `Dockerfile` has 4 stages: `base`, `deps`, `build`, `production`. We need to add a user in `base` and activate it in `production`.

- [ ] **Step 2: Add axiom user to base stage and activate in production**

Edit `Dockerfile` to this final state:

```dockerfile
FROM node:25-alpine AS base
RUN apk add --no-cache git pandoc weasyprint font-noto
RUN addgroup -S axiom && adduser -S -G axiom axiom
WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npx prisma generate

# Build
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production
FROM base AS production
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=deps /app/prisma.config.ts ./
COPY --from=build /app/dist ./dist
COPY package.json ./

RUN mkdir -p /data/repos /data/uploads && chown -R axiom:axiom /app /data

USER axiom

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
```

- [ ] **Step 3: Verify the build succeeds**

Run: `docker build --target production -t axiom-api-test .`
Expected: Build completes successfully.

- [ ] **Step 4: Verify the container runs as non-root**

Run: `docker run --rm axiom-api-test whoami`
Expected: `axiom`

Clean up: `docker rmi axiom-api-test`

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "fix: run API container as non-root axiom user"
```

---

### Task 2: Harden docker-compose.yml (resource limits, logging, pinned tags)

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Read the current docker-compose.yml**

Current file has 4 services: `db`, `redis`, `api`, `web` with 4 named volumes.

- [ ] **Step 2: Update docker-compose.yml**

Edit `docker-compose.yml` to this final state:

```yaml
services:
  db:
    image: postgres:16.4-alpine
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
    mem_limit: 512m
    cpus: 1.0
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  redis:
    image: redis:7.4-alpine
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
    mem_limit: 128m
    cpus: 0.25
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

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
    mem_limit: 512m
    cpus: 1.0
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

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
    mem_limit: 128m
    cpus: 0.5
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

volumes:
  pgdata:
  git_repos:
  uploads:
  redis_data:
```

- [ ] **Step 3: Validate compose syntax**

Run: `docker compose config --quiet`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "fix: add resource limits, log rotation, and pinned image tags to prod compose"
```

---

### Task 3: Harden env validation and add HOOK_SECRET

**Files:**
- Modify: `src/config/env.ts`

- [ ] **Step 1: Read the current env.ts**

Current file at `src/config/env.ts` has a Zod schema with `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `PORT`, `REPOS_PATH`, `NODE_ENV`, `CORS_ORIGIN`.

- [ ] **Step 2: Add HOOK_SECRET and production secret guard**

Edit `src/config/env.ts` to:

```typescript
import './load-env';

import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  HOOK_SECRET: z.string().min(16),
  PORT: z.coerce.number().default(3000),
  REPOS_PATH: z.string().default('/data/repos'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('*'),
});

export const env = envSchema.parse(process.env);

// Block startup if production secrets look like placeholders
if (env.NODE_ENV === 'production') {
  const placeholderPattern = /change.me|dev.secret|placeholder|CHANGE_ME/i;
  for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'HOOK_SECRET'] as const) {
    if (placeholderPattern.test(env[key])) {
      throw new Error(`Refusing to start: ${key} contains a placeholder value. Generate with: openssl rand -hex 32`);
    }
  }
}
```

- [ ] **Step 3: Update hook-handler.ts to use env.HOOK_SECRET**

Edit `src/git/hook-handler.ts` line 18. Replace:

```typescript
export const HOOK_SECRET = process.env.HOOK_SECRET || crypto.randomBytes(32).toString('hex');
```

With:

```typescript
import { env } from '../config/env';
```

Add this import at the top of the file (after the existing imports), then replace the `HOOK_SECRET` line with:

```typescript
export const HOOK_SECRET = env.HOOK_SECRET;
```

Remove the `crypto` import if it is no longer used elsewhere in the file. (It IS still used for `createHmac` in `dispatchWebhook`, so keep it.)

- [ ] **Step 4: Update docker-compose.dev.yml to include HOOK_SECRET**

The dev compose at `docker-compose.dev.yml` line 68 sets environment variables for the api service. Add `HOOK_SECRET` to the environment block:

```yaml
HOOK_SECRET: axiom-dev-hook-secret-min-16-chars
```

- [ ] **Step 5: Update .env.example to include HOOK_SECRET**

Add to `.env.example` after the `CORS_ORIGIN` line:

```env
# Shared secret for internal git post-receive hook verification.
# Must match between the API server and the hook script.
HOOK_SECRET=axiom-internal-hook-secret
```

- [ ] **Step 6: Update the local .env file**

Add to `.env`:

```env
HOOK_SECRET=axiom-dev-hook-secret-min-16-chars
```

- [ ] **Step 7: Run typecheck to verify**

Run: `npx tsc --noEmit`
Expected: No new errors.

- [ ] **Step 8: Commit**

```bash
git add src/config/env.ts src/git/hook-handler.ts docker-compose.dev.yml .env.example
git commit -m "fix: add HOOK_SECRET to env schema, block startup on placeholder secrets"
```

---

### Task 4: Create production env template

**Files:**
- Create: `.env.production.example`

- [ ] **Step 1: Create the file**

Write `.env.production.example`:

```env
# =============================================================================
# Axiom Production Environment — aranea.dev
# =============================================================================
# Copy to .env and fill in all values.
# Generate secrets with: openssl rand -hex 32

# -- Domain ------------------------------------------------------------------
DOMAIN=aranea.dev
CORS_ORIGIN=https://aranea.dev
FRONTEND_URL=https://aranea.dev

# -- Database -----------------------------------------------------------------
POSTGRES_DB=axiom
POSTGRES_USER=axiom
POSTGRES_PASSWORD=   # openssl rand -hex 32

# -- Authentication -----------------------------------------------------------
JWT_SECRET=          # openssl rand -hex 32
JWT_REFRESH_SECRET=  # openssl rand -hex 32

# -- Git Hooks ----------------------------------------------------------------
HOOK_SECRET=         # openssl rand -hex 16

# -- Admin Seed ---------------------------------------------------------------
# Password for the initial tim user. Used by: npm run db:seed:prod
ADMIN_PASSWORD=      # strong password

# -- Email (Gmail) ------------------------------------------------------------
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=           # your-gmail@gmail.com
SMTP_PASS=           # Gmail App Password (16-char, not your Gmail password)
SMTP_FROM="Axiom <your-gmail@gmail.com>"

# -- Internal -----------------------------------------------------------------
# API base URL used by git hooks to call back to the API (internal Docker network)
API_BASE_URL=http://api:3000

# -- Ports --------------------------------------------------------------------
# The port exposed on the host. ProxyPilot reverse proxy targets this.
PORT=7000
```

- [ ] **Step 2: Commit**

```bash
git add .env.production.example
git commit -m "docs: add production env template for aranea.dev deployment"
```

---

### Task 5: Create production seed script

**Files:**
- Create: `scripts/seed-production.ts`
- Modify: `package.json`

- [ ] **Step 1: Create scripts/seed-production.ts**

This script mirrors the structure of `scripts/seed-demo.ts` but skips demo issues, comments, sprints, wiki content, and the test user. It reads `ADMIN_PASSWORD` from env.

Write `scripts/seed-production.ts`:

```typescript
/**
 * Production seed script for Axiom.
 *
 * Usage: npx tsx scripts/seed-production.ts
 *
 * Creates the Aranea.Dev org, Axiom team, Axiom MVP project,
 * board columns, labels, and the tim admin user.
 *
 * Requires ADMIN_PASSWORD env var.
 * Safe to run multiple times (idempotent via upserts).
 */

import '../src/config/load-env';

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) {
  console.error('ADMIN_PASSWORD env var is required (min 8 characters).');
  console.error('Usage: ADMIN_PASSWORD=your-secure-password npx tsx scripts/seed-production.ts');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.warn('Seeding production data...\n');

  // ── 1. User ──────────────────────────────────────────────────
  console.warn('  [1/7] User');
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD!, 12);

  const tim = await prisma.user.upsert({
    where: { username: 'tim' },
    update: { passwordHash, isAdmin: true },
    create: {
      username: 'tim',
      displayName: 'Tim Schipper',
      email: 'tim@aranea.dev',
      passwordHash,
      isAdmin: true,
    },
  });
  console.warn('        Tim Schipper (tim@aranea.dev)');

  // ── 2. Organization ──────────────────────────────────────────
  console.warn('  [2/7] Organization');
  const org = await prisma.organization.upsert({
    where: { slug: 'aranea-dev' },
    update: {},
    create: {
      name: 'Aranea.Dev',
      slug: 'aranea-dev',
      description: 'Building tools for developers',
    },
  });

  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId: tim.id, orgId: org.id } },
    update: { role: 'OWNER' },
    create: { userId: tim.id, orgId: org.id, role: 'OWNER' },
  });
  console.warn('        Aranea.Dev (tim = OWNER)');

  // ── 3. Team ──────────────────────────────────────────────────
  console.warn('  [3/7] Team');
  const team = await prisma.team.upsert({
    where: { orgId_slug: { orgId: org.id, slug: 'axiom' } },
    update: {},
    create: {
      orgId: org.id,
      name: 'Axiom',
      slug: 'axiom',
      description: 'Axiom platform development',
    },
  });

  await prisma.teamMembership.upsert({
    where: { userId_teamId: { userId: tim.id, teamId: team.id } },
    update: { role: 'ADMIN' },
    create: { userId: tim.id, teamId: team.id, role: 'ADMIN' },
  });
  console.warn('        Axiom (tim = ADMIN)');

  // ── 4. Project + Board Columns ───────────────────────────────
  console.warn('  [4/7] Project');

  const columnDefs = [
    { name: 'Backlog', position: 0, isDefault: true, isDone: false },
    { name: 'Todo', position: 1, isDefault: false, isDone: false },
    { name: 'In Progress', position: 2, isDefault: false, isDone: false },
    { name: 'Review', position: 3, isDefault: false, isDone: false },
    { name: 'Done', position: 4, isDefault: false, isDone: true },
  ];

  const existing = await prisma.project.findUnique({
    where: { teamId_slug: { teamId: team.id, slug: 'axiom-mvp' } },
  });

  if (!existing) {
    await prisma.project.create({
      data: {
        teamId: team.id,
        name: 'Axiom MVP',
        slug: 'axiom-mvp',
        prefix: 'AXM',
        description: 'Axiom minimum viable product - project management, Git hosting, and documentation',
        columns: { createMany: { data: columnDefs } },
        cardColorBy: 'priority',
      },
    });
  }

  const project = await prisma.project.findUniqueOrThrow({
    where: { teamId_slug: { teamId: team.id, slug: 'axiom-mvp' } },
  });

  // Set WIP limits
  const cols = await prisma.boardColumn.findMany({ where: { projectId: project.id } });
  for (const col of cols) {
    if (col.name === 'In Progress') {
      await prisma.boardColumn.update({ where: { id: col.id }, data: { wipLimit: 5 } });
    }
    if (col.name === 'Review') {
      await prisma.boardColumn.update({ where: { id: col.id }, data: { wipLimit: 3 } });
    }
  }
  console.warn('        Axiom MVP (AXM) with board columns');

  // ── 5. Labels ────────────────────────────────────────────────
  console.warn('  [5/7] Labels');

  const labelDefs = [
    { name: 'frontend', color: '#6366f1' },
    { name: 'backend', color: '#10b981' },
    { name: 'urgent', color: '#ef4444' },
    { name: 'docs', color: '#f59e0b' },
    { name: 'bug', color: '#dc2626' },
    { name: 'enhancement', color: '#8b5cf6' },
  ];

  for (const ld of labelDefs) {
    await prisma.label.upsert({
      where: { projectId_name: { projectId: project.id, name: ld.name } },
      update: { color: ld.color },
      create: { projectId: project.id, name: ld.name, color: ld.color },
    });
  }
  console.warn(`        ${labelDefs.length} labels`);

  // ── 6. Repository record ─────────────────────────────────────
  console.warn('  [6/7] Repository');

  const reposBase = process.env.REPOS_PATH ?? '/data/repos';
  const diskPath = path.join(reposBase, 'aranea-dev', 'axiom', 'axiom.git');

  const repo = await prisma.repository.upsert({
    where: { teamId_slug: { teamId: team.id, slug: 'axiom' } },
    update: { diskPath, description: 'The Axiom platform source code' },
    create: {
      teamId: team.id,
      name: 'axiom',
      slug: 'axiom',
      description: 'The Axiom platform source code',
      visibility: 'INTERNAL',
      diskPath,
      defaultBranch: 'master',
    },
  });

  // PR template
  await prisma.repository.update({
    where: { id: repo.id },
    data: {
      prTemplate: `## Summary\n\nWhat does this PR do? Why is it needed?\n\n## Changes\n\n-\n\n## Testing\n\n- [ ] Unit tests added/updated\n- [ ] Manual testing done\n- [ ] No regressions found\n\n## Screenshots\n\n(if applicable)\n`,
    },
  });

  console.warn(`        axiom (INTERNAL) at ${diskPath}`);

  // ── 7. Wiki space ────────────────────────────────────────────
  console.warn('  [7/7] Wiki');

  const wikiSpace = await prisma.wikiSpace.upsert({
    where: { teamId_slug: { teamId: team.id, slug: 'docs' } },
    update: {},
    create: {
      teamId: team.id,
      name: 'Axiom Documentation',
      slug: 'docs',
      description: 'Platform documentation, architecture, and development guides',
    },
  });

  // Space permissions
  const existingPerm = await prisma.spacePermission.findFirst({
    where: { spaceId: wikiSpace.id },
  });
  if (!existingPerm) {
    await prisma.spacePermission.create({
      data: { spaceId: wikiSpace.id, teamRole: 'ADMIN', level: 'ADMIN' },
    });
    await prisma.spacePermission.create({
      data: { spaceId: wikiSpace.id, teamRole: 'MEMBER', level: 'EDIT' },
    });
  }

  // Auto-import docs/*.md as wiki pages
  const docsDir = path.resolve(__dirname, '..', 'docs');
  let totalPages = 0;
  if (fs.existsSync(docsDir)) {
    const docFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));
    for (const file of docFiles) {
      const slug = file.replace(/\.md$/, '');
      const body = fs.readFileSync(path.join(docsDir, file), 'utf-8');
      const h1Match = body.match(/^#\s+(.+)$/m);
      const title = h1Match ? h1Match[1] : slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      const existingPage = await prisma.page.findUnique({
        where: { spaceId_slug: { spaceId: wikiSpace.id, slug } },
      });

      if (existingPage) {
        await prisma.page.update({
          where: { id: existingPage.id },
          data: { body, title },
        });
      } else {
        const page = await prisma.page.create({
          data: { spaceId: wikiSpace.id, title, slug, body, position: totalPages + 1 },
        });
        await prisma.pageVersion.create({
          data: { pageId: page.id, title, body, version: 1, authorId: tim.id },
        });
      }
      totalPages++;
    }
  }
  console.warn(`        Axiom Documentation (${totalPages} pages)`);

  console.warn('\nProduction seed complete!');
  console.warn(`Login at ${process.env.FRONTEND_URL || 'https://aranea.dev'}/login`);
  console.warn('Credentials: tim / <ADMIN_PASSWORD>\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Add db:seed:prod script to package.json**

In `package.json`, add to the `"scripts"` block after the `"db:seed"` line:

```json
"db:seed:prod": "tsx scripts/seed-production.ts",
```

- [ ] **Step 3: Test locally against dev DB**

Run: `ADMIN_PASSWORD=testpass123 npx tsx scripts/seed-production.ts`
Expected: All 7 steps complete without errors. Output shows created entities.

- [ ] **Step 4: Verify idempotency**

Run the same command again.
Expected: Completes successfully, no duplicate errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-production.ts package.json
git commit -m "feat: add production seed script with ADMIN_PASSWORD env var"
```

---

### Task 6: Create backup script

**Files:**
- Create: `scripts/backup.sh`

- [ ] **Step 1: Create scripts/backup.sh**

Write `scripts/backup.sh`:

```bash
#!/usr/bin/env bash
# =============================================================================
# Axiom Backup Script
# =============================================================================
# Dumps PostgreSQL, tars git repos and uploads volumes.
# Rotation: 7 daily, 4 weekly.
#
# Usage: ./scripts/backup.sh
# Cron:  0 3 * * * /root/axiom/scripts/backup.sh >> /backups/axiom/backup.log 2>&1

set -euo pipefail

BACKUP_ROOT="/backups/axiom"
DAILY_DIR="$BACKUP_ROOT/daily"
WEEKLY_DIR="$BACKUP_ROOT/weekly"
COMPOSE_DIR="/root/axiom"
DATE=$(date +%Y-%m-%d)
DAY_OF_WEEK=$(date +%u)  # 1=Monday, 7=Sunday
TIMESTAMP=$(date +%Y-%m-%d\ %H:%M:%S)

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

echo "[$TIMESTAMP] Backup started"

# ── 1. PostgreSQL dump ──────────────────────────────────────────
DB_FILE="$DAILY_DIR/axiom-db-$DATE.sql.gz"
echo "  Dumping PostgreSQL..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" exec -T db \
  pg_dump -U axiom --compress=9 axiom > "$DB_FILE"
DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
echo "  Database: $DB_SIZE -> $DB_FILE"

# ── 2. Git repos volume ────────────────────────────────────────
REPOS_FILE="$DAILY_DIR/axiom-repos-$DATE.tar.gz"
REPOS_VOLUME=$(docker volume inspect axiom_git_repos --format '{{ .Mountpoint }}' 2>/dev/null || echo "")
if [ -n "$REPOS_VOLUME" ] && [ -d "$REPOS_VOLUME" ]; then
  # Only backup if files changed since last backup
  LAST_REPOS=$(ls -t "$DAILY_DIR"/axiom-repos-*.tar.gz 2>/dev/null | head -1)
  if [ -z "$LAST_REPOS" ] || [ -n "$(find "$REPOS_VOLUME" -newer "$LAST_REPOS" -type f 2>/dev/null | head -1)" ]; then
    echo "  Archiving git repos..."
    tar -czf "$REPOS_FILE" -C "$REPOS_VOLUME" .
    REPOS_SIZE=$(du -h "$REPOS_FILE" | cut -f1)
    echo "  Repos: $REPOS_SIZE -> $REPOS_FILE"
  else
    echo "  Repos: no changes since last backup, skipping"
  fi
fi

# ── 3. Uploads volume ──────────────────────────────────────────
UPLOADS_FILE="$DAILY_DIR/axiom-uploads-$DATE.tar.gz"
UPLOADS_VOLUME=$(docker volume inspect axiom_uploads --format '{{ .Mountpoint }}' 2>/dev/null || echo "")
if [ -n "$UPLOADS_VOLUME" ] && [ -d "$UPLOADS_VOLUME" ]; then
  LAST_UPLOADS=$(ls -t "$DAILY_DIR"/axiom-uploads-*.tar.gz 2>/dev/null | head -1)
  if [ -z "$LAST_UPLOADS" ] || [ -n "$(find "$UPLOADS_VOLUME" -newer "$LAST_UPLOADS" -type f 2>/dev/null | head -1)" ]; then
    echo "  Archiving uploads..."
    tar -czf "$UPLOADS_FILE" -C "$UPLOADS_VOLUME" .
    UPLOADS_SIZE=$(du -h "$UPLOADS_FILE" | cut -f1)
    echo "  Uploads: $UPLOADS_SIZE -> $UPLOADS_FILE"
  else
    echo "  Uploads: no changes since last backup, skipping"
  fi
fi

# ── 4. Weekly copy (Sundays) ───────────────────────────────────
if [ "$DAY_OF_WEEK" -eq 7 ]; then
  echo "  Creating weekly backup copy..."
  for f in "$DAILY_DIR"/axiom-*-"$DATE".*; do
    [ -f "$f" ] && cp "$f" "$WEEKLY_DIR/"
  done
  echo "  Weekly copy done"
fi

# ── 5. Rotate old backups ──────────────────────────────────────
echo "  Rotating old backups..."

# Keep 7 daily
DAILY_COUNT=$(ls -t "$DAILY_DIR"/axiom-db-*.sql.gz 2>/dev/null | wc -l)
if [ "$DAILY_COUNT" -gt 7 ]; then
  ls -t "$DAILY_DIR"/axiom-db-*.sql.gz | tail -n +8 | while read -r f; do
    DATE_PART=$(echo "$f" | grep -oP '\d{4}-\d{2}-\d{2}')
    rm -f "$DAILY_DIR"/axiom-*-"$DATE_PART".*
    echo "    Removed daily: $DATE_PART"
  done
fi

# Keep 4 weekly
WEEKLY_COUNT=$(ls -t "$WEEKLY_DIR"/axiom-db-*.sql.gz 2>/dev/null | wc -l)
if [ "$WEEKLY_COUNT" -gt 4 ]; then
  ls -t "$WEEKLY_DIR"/axiom-db-*.sql.gz | tail -n +5 | while read -r f; do
    DATE_PART=$(echo "$f" | grep -oP '\d{4}-\d{2}-\d{2}')
    rm -f "$WEEKLY_DIR"/axiom-*-"$DATE_PART".*
    echo "    Removed weekly: $DATE_PART"
  done
fi

TOTAL_SIZE=$(du -sh "$BACKUP_ROOT" | cut -f1)
echo "  Total backup size: $TOTAL_SIZE"

TIMESTAMP_END=$(date +%Y-%m-%d\ %H:%M:%S)
echo "[$TIMESTAMP_END] Backup complete"
echo "---"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/backup.sh`

- [ ] **Step 3: Verify script syntax**

Run: `bash -n scripts/backup.sh`
Expected: No output (no syntax errors).

- [ ] **Step 4: Commit**

```bash
git add scripts/backup.sh
git commit -m "feat: add automated backup script with daily/weekly rotation"
```

---

### Task 7: Final verification and cleanup

**Files:**
- No new files. Verification only.

- [ ] **Step 1: Run typecheck**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: No errors.

- [ ] **Step 3: Validate both compose files**

Run: `docker compose config --quiet && docker compose -f docker-compose.dev.yml config --quiet`
Expected: No errors from either file.

- [ ] **Step 4: Verify .env is not tracked**

Run: `git ls-files --error-unmatch .env 2>&1 || echo "OK: not tracked"`
Expected: `OK: not tracked`

- [ ] **Step 5: Build production images**

Run: `docker compose build`
Expected: Both `api` and `web` images build successfully.

- [ ] **Step 6: Verify API container runs as non-root**

Run: `docker compose run --rm api whoami`
Expected: `axiom`

- [ ] **Step 7: Final commit if any fixups needed**

Only if previous steps revealed issues that needed fixing.
