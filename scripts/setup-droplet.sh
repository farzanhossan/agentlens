#!/bin/bash
set -euo pipefail

echo "Setting up AgentLens production server..."

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
echo "IMPORTANT: Fill in your env vars:"
echo "   nano /opt/agentlens/infra/.env.production"
echo ""
echo "Then run:"
echo "   cd /opt/agentlens && docker-compose -f infra/docker-compose.prod.yml up -d"
echo ""
echo "Server setup complete!"
