Read the project context: this is AgentLens, an AI agent observability
platform. Stack: NestJS, BullMQ, Redis, PostgreSQL (TypeORM),
Elasticsearch, Cloudflare Workers (Hono.js), React + Vite, TypeScript strict.
Senior backend engineer audience. Production-ready code only.

You are deploying AgentLens to production.

Target infrastructure:
- API + DB + Redis + ES → DigitalOcean Droplet ($24/mo, 4GB RAM)
- Ingest Worker → Cloudflare Workers (free tier)
- Dashboard → Vercel (free tier)
- Landing page → Vercel (free tier)
- Domain → agentlens.dev (or whatever the user has)

Create ALL files below completely. No placeholders.

---

## FILE 1 — infra/docker-compose.prod.yml

Production docker-compose with:

```yaml
version: '3.9'

services:
  api:
    build:
      context: ../apps/api
      dockerfile: Dockerfile
    restart: always
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL}
      REDIS_URL: ${REDIS_URL}
      ELASTICSEARCH_URL: ${ELASTICSEARCH_URL}
      JWT_SECRET: ${JWT_SECRET}
      HMAC_SECRET: ${HMAC_SECRET}
      RESEND_API_KEY: ${RESEND_API_KEY}
      FRONTEND_URL: ${FRONTEND_URL}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      elasticsearch:
        condition: service_healthy
    networks:
      - agentlens-prod

  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_DB: agentlens
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d agentlens"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - agentlens-prod

  redis:
    image: redis:7-alpine
    restart: always
    command: redis-server --appendonly yes --maxmemory-policy noeviction --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - agentlens-prod

  elasticsearch:
    image: elasticsearch:8.13.0
    restart: always
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - "ES_JAVA_OPTS=-Xms512m -Xmx512m"
      - cluster.name=agentlens-prod
    volumes:
      - es_data:/usr/share/elasticsearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -s http://localhost:9200/_cluster/health | grep -q '\"status\":\"green\\|yellow\"'"]
      interval: 30s
      timeout: 10s
      retries: 10
    networks:
      - agentlens-prod

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/ssl:/etc/nginx/ssl
      - certbot_data:/var/www/certbot
      - certbot_certs:/etc/letsencrypt
    depends_on:
      - api
    networks:
      - agentlens-prod

  certbot:
    image: certbot/certbot
    volumes:
      - certbot_data:/var/www/certbot
      - certbot_certs:/etc/letsencrypt
    command: certonly --webroot --webroot-path=/var/www/certbot --email farzanhossans@gmail.com --agree-tos --no-eff-email -d api.agentlens.dev

volumes:
  postgres_data:
  redis_data:
  es_data:
  certbot_data:
  certbot_certs:

networks:
  agentlens-prod:
    driver: bridge
```

---

## FILE 2 — infra/nginx/nginx.conf

```nginx
events {
  worker_connections 1024;
}

http {
  # Rate limiting
  limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;
  limit_req_zone $binary_remote_addr zone=ingest:10m rate=1000r/m;

  # Gzip
  gzip on;
  gzip_types application/json text/plain;

  # API server
  server {
    listen 80;
    server_name api.agentlens.dev;

    # Redirect HTTP to HTTPS
    location /.well-known/acme-challenge/ {
      root /var/www/certbot;
    }
    location / {
      return 301 https://$host$request_uri;
    }
  }

  server {
    listen 443 ssl;
    server_name api.agentlens.dev;

    ssl_certificate /etc/letsencrypt/live/api.agentlens.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.agentlens.dev/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains";

    # API proxy
    location / {
      limit_req zone=api burst=20 nodelay;
      proxy_pass http://api:3000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection 'upgrade';
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_cache_bypass $http_upgrade;
      proxy_read_timeout 120s;
      proxy_connect_timeout 10s;
    }

    # WebSocket support
    location /socket.io/ {
      proxy_pass http://api:3000;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";
    }
  }
}
```

---

## FILE 3 — infra/.env.production.example

```env
# PostgreSQL
POSTGRES_USER=agentlens
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD_32_CHARS
DATABASE_URL=postgresql://agentlens:CHANGE_ME@localhost:5432/agentlens

# Redis
REDIS_PASSWORD=CHANGE_ME_REDIS_PASSWORD
REDIS_URL=redis://:CHANGE_ME_REDIS_PASSWORD@localhost:6379

# Elasticsearch
ELASTICSEARCH_URL=http://localhost:9200

# App secrets
JWT_SECRET=CHANGE_ME_JWT_SECRET_64_CHARS_MINIMUM
HMAC_SECRET=CHANGE_ME_HMAC_SECRET_32_CHARS

# External services
RESEND_API_KEY=re_xxxxxxxxxxxx
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx

# URLs
FRONTEND_URL=https://app.agentlens.dev
LANDING_URL=https://agentlens.dev
API_URL=https://api.agentlens.dev
```

---

## FILE 4 — scripts/deploy.sh

Complete automated deployment script:

```bash
#!/bin/bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🚀 Deploying AgentLens to production...${NC}"

# Config
DROPLET_IP=${DROPLET_IP:?"DROPLET_IP env var required"}
SSH_USER=${SSH_USER:-root}
APP_DIR="/opt/agentlens"

# Step 1 — Build
echo -e "${YELLOW}📦 Building...${NC}"
pnpm build

# Step 2 — SSH and deploy
echo -e "${YELLOW}🔗 Connecting to $DROPLET_IP...${NC}"
ssh $SSH_USER@$DROPLET_IP << 'ENDSSH'
  set -e

  # Pull latest code
  cd /opt/agentlens
  git pull origin main

  # Install deps
  pnpm install --frozen-lockfile

  # Run migrations
  pnpm --filter api run migration:run

  # Rebuild and restart containers
  docker-compose -f infra/docker-compose.prod.yml build api
  docker-compose -f infra/docker-compose.prod.yml up -d --no-deps api

  echo "✅ API restarted"

  # Health check
  sleep 5
  curl -f http://localhost:3000/health || (echo "❌ Health check failed!" && exit 1)
  echo "✅ Health check passed"
ENDSSH

echo -e "${GREEN}✅ Deploy complete!${NC}"
echo -e "API: https://api.agentlens.dev"
echo -e "Dashboard: https://app.agentlens.dev"
```

---

## FILE 5 — scripts/setup-droplet.sh

First-time server setup (run once on fresh DigitalOcean droplet):

```bash
#!/bin/bash
set -euo pipefail

echo "🔧 Setting up AgentLens production server..."

# Update system
apt-get update && apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Install useful tools
apt-get install -y git curl wget htop ufw fail2ban

# Firewall setup
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Fail2ban for SSH protection
systemctl enable fail2ban
systemctl start fail2ban

# Clone repo
mkdir -p /opt/agentlens
git clone https://github.com/farzanhossan/agentlens /opt/agentlens
cd /opt/agentlens

# Copy env file (user must fill this in)
cp infra/.env.production.example infra/.env.production
echo ""
echo "⚠️  IMPORTANT: Fill in your env vars:"
echo "   nano /opt/agentlens/infra/.env.production"
echo ""
echo "Then run:"
echo "   cd /opt/agentlens && docker-compose -f infra/docker-compose.prod.yml up -d"
echo ""
echo "✅ Server setup complete!"
```

---

## FILE 6 — Vercel deployment for dashboard

Create apps/dashboard/vercel.json:
```json
{
  "buildCommand": "pnpm build",
  "outputDirectory": "dist",
  "installCommand": "pnpm install",
  "framework": "vite",
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ],
  "env": {
    "VITE_API_URL": "https://api.agentlens.dev",
    "VITE_WS_URL": "wss://api.agentlens.dev"
  }
}
```

Create apps/landing/vercel.json:
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

---

## FILE 7 — GitHub Actions CD pipeline

Create .github/workflows/deploy.yml:

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy-api:
    name: Deploy API to DigitalOcean
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy via SSH
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.DROPLET_IP }}
          username: root
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/agentlens
            git pull origin main
            pnpm install --frozen-lockfile
            pnpm --filter api run migration:run
            docker-compose -f infra/docker-compose.prod.yml build api
            docker-compose -f infra/docker-compose.prod.yml up -d --no-deps api
            sleep 5
            curl -f http://localhost:3000/health

  deploy-dashboard:
    name: Deploy Dashboard to Vercel
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID_DASHBOARD }}
          working-directory: apps/dashboard
          vercel-args: '--prod'

  deploy-landing:
    name: Deploy Landing to Vercel
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID_LANDING }}
          working-directory: apps/landing
          vercel-args: '--prod'

  deploy-worker:
    name: Deploy Ingest Worker to Cloudflare
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - name: Deploy to Cloudflare Workers
        working-directory: apps/ingest-worker
        run: pnpm wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

---

## Required GitHub Secrets

Print this at the end clearly:

```
📋 ADD THESE TO GitHub → Settings → Secrets → Actions:

INFRASTRUCTURE:
  DROPLET_IP           → Your DigitalOcean droplet IP
  SSH_PRIVATE_KEY      → Your SSH private key (cat ~/.ssh/id_rsa)

VERCEL:
  VERCEL_TOKEN         → vercel.com → Settings → Tokens
  VERCEL_ORG_ID        → vercel.com → Settings → General → Team ID
  VERCEL_PROJECT_ID_DASHBOARD  → Dashboard project ID
  VERCEL_PROJECT_ID_LANDING    → Landing project ID

CLOUDFLARE:
  CLOUDFLARE_API_TOKEN → dash.cloudflare.com → API Tokens → Create Token

NPM & PYPI (from Prompt 17):
  NPM_TOKEN
  PYPI_TOKEN

DEPLOYMENT STEPS:
  1. Create DigitalOcean droplet (Ubuntu 24.04, 4GB RAM, $24/mo)
  2. Run: bash scripts/setup-droplet.sh (on the droplet)
  3. Fill in: /opt/agentlens/infra/.env.production
  4. Run: docker-compose -f infra/docker-compose.prod.yml up -d
  5. Deploy dashboard: cd apps/dashboard && npx vercel --prod
  6. Deploy landing: cd apps/landing && npx vercel --prod
  7. Deploy CF Worker: cd apps/ingest-worker && pnpm wrangler deploy
  8. Add GitHub secrets → every push to main auto-deploys everything
```
