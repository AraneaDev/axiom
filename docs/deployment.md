# VPS Deployment Guide (Apache Reverse Proxy)

This guide covers deploying Axiom on a VPS using Docker Compose, with Apache handling SSL termination and reverse proxying.

---

## 1. Overview

Axiom runs as a set of Docker containers (API, worker, PostgreSQL, Redis) orchestrated by Docker Compose. An Apache reverse proxy sits in front of the stack on the host, handling TLS termination, WebSocket upgrades, and routing all traffic to the `api` container, published on port 7000 (`${PORT:-7000}`). In production there is a single application container: Express serves the built SPA from `/app/public` (hashed assets cached for a year, `index.html` never cached, index.html fallback for client-side routes) next to `/api` and `/ws`. There is no nginx.

**The host reverse proxy is the only entry point.** The `api` container is published on `127.0.0.1:7000` only, so it cannot be reached from outside the host. Keep it that way: in production Express trusts one proxy hop (`trust proxy 1`) and takes the client IP from `X-Forwarded-For`, so a client that could reach port 7000 directly could spoof that header and get around the login rate limit. Apache (`ProxyPass / http://localhost:7000/`, section 4) also does TLS termination and HSTS; the app does not upgrade HTTP to HTTPS itself.

---

## 2. Prerequisites

- **VPS** with Docker Engine and Docker Compose v2 installed
- **Apache 2.4+** with the following modules available:
  - `mod_proxy`
  - `mod_proxy_http`
  - `mod_proxy_wstunnel`
  - `mod_ssl`
  - `mod_headers`
  - `mod_rewrite`
- **Domain** pointed to the VPS IP address via a DNS A record
- **SSL certificate** -- Let's Encrypt via certbot is recommended:
  ```bash
  apt install certbot python3-certbot-apache
  certbot --apache -d staging.example.com
  ```

---

## 3. Initial Setup

Clone the repository and configure the environment:

```bash
git clone <repo-url> /opt/axiom
cd /opt/axiom
cp .env.staging.example .env
```

Edit `.env` and fill in all `[REQUIRED]` values. Generate secrets with:

```bash
openssl rand -hex 32  # for JWT_SECRET
openssl rand -hex 32  # for JWT_REFRESH_SECRET
openssl rand -hex 32  # for REDIS_PASSWORD
openssl rand -base64 32  # for AXIOM_ENCRYPTION_KEY
```

`AXIOM_ENCRYPTION_KEY` is required: the app refuses to start without it, and in production it refuses the marked dev key that ships with the dev compose file. Back it up before you go further (see "Encryption key: backup and rotation" in section 7).

Start the stack:

```bash
docker compose up -d --build
```

---

## 4. Apache Virtual Host Configuration

### Enable Required Modules

```bash
a2enmod proxy proxy_http proxy_wstunnel ssl headers rewrite
systemctl restart apache2
```

### HTTPS Virtual Host

Create `/etc/apache2/sites-available/axiom.conf`:

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

    # Large uploads, such as attachments (100 MB)
    LimitRequestBody 104857600
</VirtualHost>

<VirtualHost *:80>
    ServerName staging.example.com
    Redirect permanent / https://staging.example.com/
</VirtualHost>
```

Enable the site and reload:

```bash
a2ensite axiom.conf
systemctl reload apache2
```

---

## 5. Seeding a First Admin (Optional)

```bash
docker compose exec -e ADMIN_PASSWORD=your-secure-password api npm run db:seed:prod
```

This creates the admin user `tim` with that password, the Aranea.Dev org, the Axiom team and the Axiom MVP project. It is idempotent and safe to re-run.

`npm run db:seed` is for development only. Its demo accounts have a published password, so in production it stops with an error and writes nothing.

---

## 6. Updating

```bash
cd /opt/axiom
git pull
docker compose up -d --build
```

The `migrate` container runs Prisma migrations before the other containers start.

---

## 7. Backups

### Database

```bash
docker compose exec db pg_dump -U axiom axiom > backup-$(date +%F).sql
```

To restore:

```bash
docker compose exec -T db psql -U axiom axiom < backup-2026-04-05.sql
```

### Encryption key: backup and rotation

Axiom encrypts the secrets it keeps (2FA secrets, the GitHub App's private key and secrets, connected GitHub tokens) with AES-256-GCM under `AXIOM_ENCRYPTION_KEY`. The key lives only in `.env` on the host, never in the database.

**A database backup is useless without the key.** Restore a dump without it and every encrypted value is lost: users have to set up 2FA again and the GitHub App has to be created again. Back the key up apart from the database, for example in a password manager, so that one leaked backup does not hold both.

To rotate the key:

1. Generate a new key with `openssl rand -base64 32`.
2. In `.env`, move the current value to `AXIOM_ENCRYPTION_KEY_PREVIOUS` and set the new one as `AXIOM_ENCRYPTION_KEY`.
3. Restart the stack: `docker compose up -d`. Values under either key now read; new values are written under the new key.
4. Re-encrypt the stored values under the new key: `docker compose exec api npm run secrets:rotate`. It prints counts per column, never values.
5. Remove `AXIOM_ENCRYPTION_KEY_PREVIOUS` from `.env` and restart again.

Back up the new key before step 5. Once the previous key is gone, a value that still sits under it cannot be read, so run step 4 to the end first.

Removing the previous key from `.env` does not end its life. Every database backup taken before the rotation is still sealed under it, so keep each retired key for as long as you keep backups taken under it. To restore such a backup, restore the dump, set its key as `AXIOM_ENCRYPTION_KEY_PREVIOUS` next to the current `AXIOM_ENCRYPTION_KEY`, restart, run `docker compose exec api npm run secrets:rotate` to move its values under the current key, then remove the previous key again.

### Uploads

```bash
docker run --rm -v axiom_uploads:/data -v $(pwd):/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

---

## 8. Logs

```bash
docker compose logs -f api     # Backend logs
docker compose logs -f db      # PostgreSQL logs
docker compose ps              # Container health status
```

To follow all services at once:

```bash
docker compose logs -f
```

---

## 9. Troubleshooting

| Problem | Diagnostic Step |
|---------|----------------|
| API not responding | `curl http://localhost:3000/api/health` |
| Site not loading externally | `curl https://staging.example.com/api/health` |
| WebSocket connection failures | Verify `mod_proxy_wstunnel` is enabled: `apachectl -M \| grep wstunnel` |
| Upload returns 413 | Increase Apache `LimitRequestBody` |
| Container won't start | `docker compose logs <service>` to inspect startup errors |
| SSL certificate expired | `certbot renew && systemctl reload apache2` |
| Database connection refused | `docker compose ps db` -- ensure the container is healthy |
