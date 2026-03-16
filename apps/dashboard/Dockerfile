# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN npm install -g pnpm@9 --silent

WORKDIR /build

# Workspace manifests for layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/ apps/dashboard/

# Install only the dashboard's deps
RUN pnpm install --frozen-lockfile --filter @agentlens/dashboard

# Build arguments for runtime config injected at build time
ARG VITE_API_URL=""
ARG VITE_WS_URL=""
ARG VITE_PROJECT_ID=""

ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_PROJECT_ID=$VITE_PROJECT_ID

RUN pnpm --filter @agentlens/dashboard run build

# ── Stage 2: runner ───────────────────────────────────────────────────────────
FROM nginx:alpine AS runner

COPY --from=builder /build/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
