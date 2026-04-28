# Deployment Guide

> **Self-hosters**: You only need the [Self-Hosting](#self-hosting-docker-compose) section below. No Vercel, Cloudflare, or third-party accounts required — just Docker.

---

## Self-Hosting (Docker Compose)

Run the full AgentLens stack on any server with Docker. Everything is included: API, dashboard, proxy, PostgreSQL, Redis, and Elasticsearch.

### Prerequisites

- Docker and Docker Compose v2+
- At least **4 GB RAM** (Elasticsearch needs ~1 GB)
- Any Linux server, Mac, or Windows with WSL2

### 1. Clone and configure

```bash
git clone https://github.com/farzanhossan/agentlens
cd agentlens/infra

# Create your environment file
cp .env.prod.example .env
```

### 2. Generate secrets

```bash
# Generate two secrets and paste them into .env
openssl rand -hex 32   # → paste as JWT_SECRET
openssl rand -hex 32   # → paste as HMAC_SECRET
```

Edit `infra/.env` and fill in `JWT_SECRET` and `HMAC_SECRET`. The other defaults work out of the box.

### 3. Start everything

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Wait ~60 seconds for Elasticsearch to initialise, then open:

| Service | URL |
|---------|-----|
| Dashboard | http://localhost:4021 |
| API | http://localhost:4020 |
| API Health | http://localhost:4020/health |
| Proxy (SDK endpoint) | http://localhost:8090 |

That's it — AgentLens is running.

### 4. Connect your app

Install the SDK in your application:

```bash
npm install @farzanhossans/agentlens-core @farzanhossans/agentlens-openai
```

```typescript
import { AgentLens } from '@farzanhossans/agentlens-core'
import '@farzanhossans/agentlens-openai'

AgentLens.init({
  apiKey: 'your-project-api-key',   // from the dashboard
  projectId: 'your-project-uuid',   // from the dashboard
  endpoint: 'http://your-server:3001',  // your self-hosted API URL
})
```

### Trace grouping (optional)

If your agent makes multiple LLM calls per turn, you can group them into a single trace by passing optional headers through the proxy:

| Header | Purpose |
|--------|---------|
| `X-AgentLens-Trace-Id` | Shared trace ID — all requests with the same value appear under one trace |
| `X-AgentLens-Parent-Span-Id` | Links this span as a child of a parent span |
| `X-AgentLens-Span-Name` | Custom span name (default: `openai.proxy`) |

These headers are **stripped before forwarding** to the LLM provider — OpenAI/Anthropic never sees them.

Without these headers, each request creates its own trace (default behavior, fully backwards compatible).

**Example: group two LLM calls into one trace**

```typescript
const traceId = crypto.randomUUID()

// Call 1: extract data
await fetch('http://localhost:8090/v1/p/{projectId}/openai/v1/chat/completions', {
  headers: {
    'X-AgentLens-Trace-Id': traceId,
    'X-AgentLens-Span-Name': 'extract-fields',
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  method: 'POST',
  body: JSON.stringify({ model: 'gpt-4o', messages: [...] }),
})

// Call 2: generate response — same traceId
await fetch('http://localhost:8090/v1/p/{projectId}/openai/v1/chat/completions', {
  headers: {
    'X-AgentLens-Trace-Id': traceId,
    'X-AgentLens-Span-Name': 'generate-reply',
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  method: 'POST',
  body: JSON.stringify({ model: 'gpt-4o', messages: [...] }),
})
// Dashboard shows: 1 trace with 2 spans
```

**With the SDK:** Use `getCurrentTraceId()` and `getCurrentSpanId()` from `@farzanhossans/agentlens-core` to automatically propagate trace context when combining the SDK with the proxy.

### Customising ports

Edit `infra/.env`:

```env
API_PORT=4020
DASHBOARD_PORT=4021
PROXY_PORT=8090
```

### Using a custom domain (with reverse proxy)

If you put nginx, Caddy, or Traefik in front, update `infra/.env`:

```env
CORS_ORIGIN=https://app.yourdomain.com
FRONTEND_URL=https://app.yourdomain.com
VITE_API_URL=https://api.yourdomain.com
VITE_WS_URL=https://api.yourdomain.com
```

Then rebuild the dashboard (Vite bakes env vars at build time):

```bash
docker compose -f docker-compose.prod.yml up -d --build dashboard
```

#### Example: nginx reverse proxy with SSL

```nginx
server {
    listen 80;
    server_name api.yourdomain.com app.yourdomain.com;
    return 301 https://$host$request_uri;
}

# API
server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:4020;
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

# Dashboard
server {
    listen 443 ssl http2;
    server_name app.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/app.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4021;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.yourdomain.com -d app.yourdomain.com
```

### Changing database passwords

For production, change the default passwords in `infra/.env`:

```env
POSTGRES_PASSWORD=your-strong-password-here
REDIS_PASSWORD=your-strong-password-here
```

### Email alerts (optional)

To enable email notifications for alerts, sign up at [resend.com](https://resend.com) and add:

```env
RESEND_API_KEY=re_xxxxxxxxxxxx
ALERT_EMAIL_FROM=alerts@yourdomain.com
```

### Updating

```bash
cd agentlens/infra
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
```

### Stopping

```bash
docker compose -f docker-compose.prod.yml down        # stop, keep data
docker compose -f docker-compose.prod.yml down -v      # stop AND delete all data
```

### Backups

#### Automated daily PostgreSQL backups

```bash
# /etc/cron.d/agentlens-pg-backup
0 2 * * * root docker exec agentlens-prod-postgres-1 \
  pg_dump -U agentlens agentlens | gzip > /backups/agentlens_$(date +\%Y-\%m-\%d).sql.gz
```

```bash
mkdir -p /backups && chmod 700 /backups
```

#### Retain 30 days

```bash
5 2 * * * root find /backups -name "agentlens_*.sql.gz" -mtime +30 -delete
```

#### Restore from backup

```bash
gunzip -c /backups/agentlens_2025-01-15.sql.gz | \
  docker exec -i agentlens-prod-postgres-1 psql -U agentlens agentlens
```

### Monitoring

```bash
# API health
curl http://localhost:4020/health

# All container status
docker compose -f docker-compose.prod.yml ps

# API logs
docker compose -f docker-compose.prod.yml logs -f api

# Elasticsearch health
curl http://localhost:9200/_cluster/health?pretty

# Redis
docker compose -f docker-compose.prod.yml exec redis redis-cli -a agentlens ping

# BullMQ queue depth
docker compose -f docker-compose.prod.yml exec redis redis-cli -a agentlens llen bull:span-processing:wait
```

### Troubleshooting

| Problem | Fix |
|---------|-----|
| Elasticsearch won't start | Increase `vm.max_map_count`: `sysctl -w vm.max_map_count=262144` (add to `/etc/sysctl.conf` to persist) |
| Dashboard shows "Network Error" | Check `VITE_API_URL` points to reachable API, then rebuild dashboard |
| API exits immediately | Check `docker compose logs api` — usually a missing secret or DB connection issue |
| Port conflict | Change `API_PORT`, `DASHBOARD_PORT`, or `PROXY_PORT` in `.env` |

### Environment variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | **(required)** | Auth token signing. Generate: `openssl rand -hex 32` |
| `HMAC_SECRET` | **(required)** | Ingest HMAC verification. Generate: `openssl rand -hex 32` |
| `POSTGRES_DB` | `agentlens` | PostgreSQL database name |
| `POSTGRES_USER` | `agentlens` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `agentlens` | PostgreSQL password (change for production!) |
| `REDIS_PASSWORD` | `agentlens` | Redis password (change for production!) |
| `API_PORT` | `4020` | Host port for the API |
| `DASHBOARD_PORT` | `4021` | Host port for the dashboard |
| `PROXY_PORT` | `8090` | Host port for the SDK proxy |
| `CORS_ORIGIN` | **(required)** | Allowed CORS origin (e.g. `http://localhost:4021` or your domain) |
| `FRONTEND_URL` | **(required)** | Used in email links (e.g. `http://localhost:4021` or your domain) |
| `VITE_API_URL` | **(required)** | API URL baked into dashboard at build time |
| `VITE_WS_URL` | **(required)** | WebSocket URL baked into dashboard |
| `RESEND_API_KEY` | *(empty)* | Optional — for email alerts |
| `ALERT_EMAIL_FROM` | *(empty)* | Optional — sender address for alerts |

---

## Internal: SaaS Deployment (AgentLens team only)

> The section below documents how the hosted AgentLens SaaS is deployed. **Self-hosters can ignore everything below.**

### Architecture

| Component | Platform | Why |
|-----------|----------|-----|
| API + DB + Redis + ES | DigitalOcean Droplet | Single server, full Docker stack |
| Dashboard | Vercel | CDN, zero-config deploys |
| Landing page | Vercel | Static HTML, edge-cached |
| Ingest worker | Cloudflare Workers | Edge latency, global PoPs |

### DigitalOcean setup

The deploy workflow (`.github/workflows/deploy.yml`) automatically:
1. SSHs into the droplet
2. Pulls latest code from `main`
3. Creates/updates `infra/.env` from GitHub secrets
4. Runs `docker compose up -d --build --force-recreate`
5. Health-checks the API

Required GitHub secrets: `DROPLET_IP`, `SSH_PRIVATE_KEY`, `JWT_SECRET`, `HMAC_SECRET`, `CORS_ORIGIN`, `FRONTEND_URL`, `VITE_API_URL`, `VITE_WS_URL`.

### Vercel setup

Dashboard and landing page deploy automatically via the same workflow.

Required GitHub secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_DASHBOARD`, `VERCEL_PROJECT_ID_LANDING`.

### Cloudflare Workers setup

The ingest worker deploys automatically.

Required GitHub secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `HMAC_SECRET`, `WORKER_SECRET`.

### SSL

| Service | SSL method |
|---------|-----------|
| API (nginx on droplet) | Let's Encrypt via `certbot --nginx` |
| Ingest worker | Cloudflare-managed (automatic) |
| Dashboard | Vercel-managed (automatic) |
| Landing page | Vercel-managed (automatic) |
