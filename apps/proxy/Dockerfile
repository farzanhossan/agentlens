# ── Stage 1: Build ─────────────────────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# Copy workspace config
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/proxy/package.json apps/proxy/tsconfig.json ./apps/proxy/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/proxy/src ./apps/proxy/src

# Build
RUN pnpm --filter @farzanhossans/agentlens-proxy run build

# Prune to production deps
RUN pnpm --filter @farzanhossans/agentlens-proxy deploy --prod /deploy/proxy

# ── Stage 2: Run ──────────────────────────────────────────
FROM node:20-alpine AS runner

RUN apk add --no-cache curl
WORKDIR /app

USER node
COPY --from=builder --chown=node:node /deploy/proxy .

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/index.js"]
