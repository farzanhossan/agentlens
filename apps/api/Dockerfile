# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN npm install -g pnpm@9 --silent

WORKDIR /build

# Copy workspace manifests first for layer-cache efficiency
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ packages/
COPY apps/api/ apps/api/

# Install all deps (including devDeps needed for build)
RUN pnpm install --frozen-lockfile

# Compile TypeScript
RUN pnpm --filter @agentlens/api run build

# Create a production-only deployment bundle in /deploy/api
# pnpm deploy copies only runtime deps + dist, no dev packages
RUN pnpm --filter @agentlens/api deploy --prod /deploy/api

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# curl required for the HEALTHCHECK instruction below
RUN apk add --no-cache curl

# Use the built-in non-root node user
USER node
WORKDIR /app

COPY --from=builder --chown=node:node /deploy/api ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
