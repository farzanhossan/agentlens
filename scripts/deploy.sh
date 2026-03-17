#!/bin/bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}Deploying AgentLens to production...${NC}"

# Config
DROPLET_IP=${DROPLET_IP:?"DROPLET_IP env var required"}
SSH_USER=${SSH_USER:-root}
APP_DIR="/opt/agentlens"

# Step 1 — Build
echo -e "${YELLOW}Building...${NC}"
pnpm build

# Step 2 — SSH and deploy
echo -e "${YELLOW}Connecting to $DROPLET_IP...${NC}"
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

  echo "API restarted"

  # Health check
  sleep 5
  curl -f http://localhost:3000/health || (echo "Health check failed!" && exit 1)
  echo "Health check passed"
ENDSSH

echo -e "${GREEN}Deploy complete!${NC}"
echo -e "API: https://api.agentlens.dev"
echo -e "Dashboard: https://app.agentlens.dev"
