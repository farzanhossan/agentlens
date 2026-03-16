# Production Deployment Guide

This guide covers deploying AgentLens to production. The recommended setup uses:

- **DigitalOcean** — API, database, Redis, Elasticsearch
- **Cloudflare Workers** — ingest edge worker
- **Vercel** — dashboard + landing page

---

## 1. DigitalOcean (API + Infrastructure)

### 1.1 Create a Droplet

Recommended spec: **8 GB RAM / 4 vCPUs / 160 GB SSD** (CPU-optimized droplet).

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

# Install pnpm + Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pnpm
```

### 1.2 Clone and configure

```bash
git clone https://github.com/farzanhossan/agentlens /opt/agentlens
cd /opt/agentlens

cp apps/api/.env.example apps/api/.env
```

Edit `apps/api/.env` with production values:

```env
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
CORS_ORIGIN=https://app.yourdomain.com

DATABASE_URL=postgresql://agentlens:<PASSWORD>@localhost:5432/agentlens
DATABASE_SSL=false
DATABASE_POOL_MAX=20
DATABASE_POOL_MIN=2

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=<STRONG_REDIS_PASSWORD>

ELASTICSEARCH_URL=http://localhost:9200
ELASTICSEARCH_USERNAME=elastic
ELASTICSEARCH_PASSWORD=<STRONG_ES_PASSWORD>

HMAC_SECRET=<openssl rand -hex 32>
JWT_SECRET=<openssl rand -hex 32>

RESEND_API_KEY=re_xxxxxxxxxxxx
ALERT_EMAIL_FROM=alerts@yourdomain.com
```

### 1.3 Start infrastructure services

```bash
docker compose -f infra/docker-compose.yml up -d postgres redis elasticsearch
```

Wait 30 seconds for Elasticsearch to initialise, then verify:

```bash
curl http://localhost:9200/_cluster/health?pretty
# "status" should be "yellow" or "green"
```

### 1.4 Build and start the API

```bash
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@farzanhossan/agentlens-api

# Run migrations
pnpm --filter @farzanhossan/agentlens-api run migration:run

# Start the API with PM2
npm install -g pm2
pm2 start apps/api/dist/main.js --name agentlens-api
pm2 save
pm2 startup
```

### 1.5 Set up nginx reverse proxy

```nginx
# /etc/nginx/sites-available/agentlens-api
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/agentlens-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

### 1.6 SSL with Let's Encrypt

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.yourdomain.com
# Auto-renew is configured automatically
```

---

## 2. Cloudflare Workers (Ingest Edge Worker)

The ingest worker runs at the edge and accepts spans from SDKs before forwarding them to the NestJS API via BullMQ.

### 2.1 Prerequisites

```bash
npm install -g wrangler
wrangler login
```

### 2.2 Configure `wrangler.toml`

Edit `apps/ingest-worker/wrangler.toml`:

```toml
name = "agentlens-ingest"
main = "src/index.ts"
compatibility_date = "2024-05-01"

[vars]
API_URL = "https://api.yourdomain.com"

[[kv_namespaces]]
binding = "RATE_LIMIT_KV"
id = "<your-kv-namespace-id>"
```

### 2.3 Set secrets

```bash
wrangler secret put HMAC_SECRET
# Paste the same value as in apps/api/.env → HMAC_SECRET

wrangler secret put REDIS_URL
# Format: rediss://:password@host:6380 (use Upstash Redis for CF Workers)
```

> **Tip:** Use [Upstash Redis](https://upstash.com) for the BullMQ connection from Cloudflare Workers — it provides an HTTP-compatible Redis client that works in the Workers runtime.

### 2.4 Deploy

```bash
cd apps/ingest-worker
pnpm deploy
```

The worker will be available at `https://agentlens-ingest.<your-cf-subdomain>.workers.dev`.

Map a custom domain in the Cloudflare dashboard: **Workers & Pages → your worker → Custom Domains → Add** `ingest.yourdomain.com`.

---

## 3. Vercel (Dashboard + Landing Page)

### 3.1 Dashboard

```bash
cd apps/dashboard
vercel --prod
```

Set environment variable in the Vercel dashboard:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://api.yourdomain.com` |

### 3.2 Landing page

```bash
# The landing page is a single static HTML file — no build step needed
cd apps/landing
vercel --prod
```

Vercel will serve `index.html` directly from the root.

---

## 4. Environment variables checklist

Before going live, verify these are set in `apps/api/.env`:

| Variable | How to generate |
|----------|----------------|
| `HMAC_SECRET` | `openssl rand -hex 32` |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `ELASTICSEARCH_PASSWORD` | Use a password manager; min 20 chars |
| `REDIS_PASSWORD` | Use a password manager; min 20 chars |
| `DATABASE_URL` | Use `pg_hba.conf` + strong password |
| `RESEND_API_KEY` | Create at [resend.com/api-keys](https://resend.com/api-keys) |

---

## 5. SSL summary

| Service | SSL method |
|---------|-----------|
| API (nginx) | Let's Encrypt via `certbot --nginx` |
| Ingest worker | Cloudflare-managed (automatic) |
| Dashboard | Vercel-managed (automatic) |
| Landing page | Vercel-managed (automatic) |

Certificates auto-renew. To manually renew: `certbot renew --dry-run`.

---

## 6. Monitoring

### API health check

```bash
curl https://api.yourdomain.com/health
# {"status":"ok","uptime":12345}
```

### PM2 process status

```bash
pm2 status
pm2 logs agentlens-api --lines 100
```

### Elasticsearch cluster health

```bash
curl http://localhost:9200/_cluster/health?pretty
```

### Redis connectivity

```bash
redis-cli -a <REDIS_PASSWORD> ping
# PONG
```

### BullMQ queue depth

```bash
# Monitor via the API's /health endpoint or connect redis-cli:
redis-cli -a <REDIS_PASSWORD> llen bull:span-processing:wait
```

---

## 7. PostgreSQL backup

### Automated daily backups with cron

```bash
# /etc/cron.d/agentlens-pg-backup
0 2 * * * root pg_dump postgresql://agentlens:<PASSWORD>@localhost:5432/agentlens \
  | gzip > /backups/agentlens_$(date +\%Y-\%m-\%d).sql.gz
```

```bash
mkdir -p /backups
chmod 700 /backups
```

### Retain 30 days

```bash
# Add to crontab — runs after the backup
5 2 * * * root find /backups -name "agentlens_*.sql.gz" -mtime +30 -delete
```

### Restore from backup

```bash
gunzip -c /backups/agentlens_2025-01-15.sql.gz | \
  psql postgresql://agentlens:<PASSWORD>@localhost:5432/agentlens
```

### DigitalOcean managed database (recommended for production)

For mission-critical deployments, use [DigitalOcean Managed PostgreSQL](https://www.digitalocean.com/products/managed-databases-postgresql) — automated backups, failover, and point-in-time recovery are included. Update `DATABASE_URL` and set `DATABASE_SSL=true`.
