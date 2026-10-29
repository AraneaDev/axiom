# VPS Deployment Guide (Apache Reverse Proxy)

This guide covers deploying Axiom on a VPS using Docker Compose, with Apache handling SSL termination and reverse proxying.

---

## 1. Overview

Axiom runs as a set of Docker containers (API, frontend, PostgreSQL, Redis) orchestrated by Docker Compose. An Apache reverse proxy sits in front of the stack on the host, handling TLS termination, WebSocket upgrades, and routing all traffic to the frontend container on port 7000. The frontend's internal nginx then proxies `/api/` paths to the API container.

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
```

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

## 5. Seeding Demo Data (Optional)

```bash
docker compose exec api npm run db:seed
```

This creates:

- **Users:** `tim / password123` (OWNER), `test / password123` (MEMBER)
- **Org:** Aranea.Dev > **Team:** Axiom > **Project:** Axiom MVP (prefix: AXM)

The seed script is idempotent and safe to re-run.

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

### Uploads

```bash
docker run --rm -v axiom_uploads:/data -v $(pwd):/backup alpine \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

---

## 8. Logs

```bash
docker compose logs -f api     # Backend logs
docker compose logs -f web     # Nginx access logs
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
| Upload returns 413 | Increase Apache `LimitRequestBody` and check nginx `client_max_body_size` in `frontend/nginx.conf` |
| Container won't start | `docker compose logs <service>` to inspect startup errors |
| SSL certificate expired | `certbot renew && systemctl reload apache2` |
| Database connection refused | `docker compose ps db` -- ensure the container is healthy |
