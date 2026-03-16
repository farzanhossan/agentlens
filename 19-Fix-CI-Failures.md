Read the project context: this is AgentLens, an AI agent observability
platform. Stack: NestJS, BullMQ, Redis, PostgreSQL (TypeORM),
Elasticsearch, Cloudflare Workers (Hono.js), React + Vite, TypeScript strict.
Senior backend engineer audience. Production-ready code only.

You are fixing failing GitHub Actions CI jobs for AgentLens.

The CI run has these results:
✅ Install dependencies — PASSING
✅ Build & type-check    — PASSING
✅ Test (Node)           — PASSING
❌ Test (Python SDK)     — FAILING
❌ Lint                  — FAILING
❌ Docker build validation — FAILING

Total: 12 errors, 7 warnings reported in Annotations.

---

## YOUR TASK

Do the following IN ORDER:

### STEP 1 — Read the actual CI logs

Run these commands to get the exact error output:

```bash
# Check git log to confirm we're on the right commit
git log --oneline -5

# Reproduce Python SDK test failure locally
cd packages/sdk-python
pip install -e ".[dev]" --break-system-packages 2>&1 | tail -20
python -m pytest tests/ -v 2>&1

# Reproduce lint failure locally
pnpm lint 2>&1

# Reproduce Docker build failure locally
docker build -f apps/api/Dockerfile -t agentlens-api-test . 2>&1
docker build -f apps/dashboard/Dockerfile -t agentlens-dashboard-test . 2>&1
```

Read ALL output carefully before making any changes.

---

### STEP 2 — Fix Python SDK test failures

Common causes and fixes:

1. Missing pytest / dev dependencies in pyproject.toml:
```toml
[project.optional-dependencies]
dev = [
  "pytest>=7.0.0",
  "pytest-asyncio>=0.21.0",
  "pytest-mock>=3.0.0",
  "httpx>=0.25.0",
]
```

2. Missing pytest.ini or pyproject.toml pytest config:
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
python_files = ["test_*.py", "*_test.py"]
python_functions = ["test_*"]
```

3. Import errors in test files — fix the import paths to match actual module structure

4. Missing __init__.py files in test directories

5. If tests are actually broken logic — fix the test assertions to match the real implementation

After fixing, verify locally:
```bash
cd packages/sdk-python
python -m pytest tests/ -v --tb=short
```
Expected: all tests pass with 0 failures.

---

### STEP 3 — Fix Lint failures

Run lint and read every error:
```bash
pnpm lint 2>&1 | head -100
```

Common fixes:

1. Unused imports — remove them or add to eslint ignore if intentional:
```typescript
// eslint-disable-next-line @typescript-eslint/no-unused-vars
```

2. any types — replace with proper types:
```typescript
// BAD
const data: any = {}
// GOOD
const data: Record<string, unknown> = {}
```

3. Missing return types on functions:
```typescript
// BAD
function doSomething() { ... }
// GOOD
function doSomething(): void { ... }
```

4. ESLint config issues — if .eslintrc.json is misconfigured, fix the root config:
```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }]
  },
  "ignorePatterns": ["dist/", "node_modules/", "*.js"]
}
```

5. If lint errors are in generated or non-critical files, add to .eslintignore:
```
dist/
node_modules/
**/*.d.ts
apps/landing/
```

After fixing, verify locally:
```bash
pnpm lint
```
Expected: 0 errors (warnings OK).

---

### STEP 4 — Fix Docker build failures

Run each Dockerfile build and read the error:

```bash
# Test API Dockerfile
docker build -f apps/api/Dockerfile . -t test-api --no-cache 2>&1

# Test dashboard Dockerfile
docker build -f apps/dashboard/Dockerfile . -t test-dashboard --no-cache 2>&1
```

Common causes and fixes:

1. Missing files that COPY expects — check all COPY commands match actual file structure

2. apps/api/Dockerfile — typical production multi-stage:
```dockerfile
# Stage 1 — Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace files
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Build only the API
RUN pnpm --filter api build

# Stage 2 — Runner
FROM node:20-alpine AS runner
WORKDIR /app

RUN npm install -g pnpm
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./
COPY --from=builder /app/node_modules ./node_modules

USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/main.js"]
```

3. apps/dashboard/Dockerfile — Vite + nginx:
```dockerfile
# Stage 1 — Builder
FROM node:20-alpine AS builder
WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-workspace.yaml turbo.json ./
COPY packages/ ./packages/
COPY apps/dashboard/ ./apps/dashboard/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter dashboard build

# Stage 2 — Nginx
FROM nginx:alpine AS runner
COPY --from=builder /app/apps/dashboard/dist /usr/share/nginx/html
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

4. Create apps/dashboard/nginx.conf if missing:
```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /health {
        return 200 'ok';
        add_header Content-Type text/plain;
    }
}
```

5. Fix the CI workflow docker build step if the build context is wrong:
```yaml
# In .github/workflows/ci.yml
- name: Build API Docker image
  run: docker build -f apps/api/Dockerfile -t agentlens-api . 
  # Note: context is . (repo root) not apps/api/

- name: Build Dashboard Docker image
  run: docker build -f apps/dashboard/Dockerfile -t agentlens-dashboard .
```

After fixing, verify locally:
```bash
docker build -f apps/api/Dockerfile . -t test-api
docker build -f apps/dashboard/Dockerfile . -t test-dashboard
echo "✅ Both Docker builds successful"
```

---

### STEP 5 — Update CI workflow if needed

Read .github/workflows/ci.yml and fix any issues:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  install:
    name: Install dependencies
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile

  lint:
    name: Lint
    runs-on: ubuntu-latest
    needs: install
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  build:
    name: Build & type-check
    runs-on: ubuntu-latest
    needs: install
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

  test-node:
    name: Test (Node)
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm test

  test-python:
    name: Test (Python SDK)
    runs-on: ubuntu-latest
    needs: install
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
      - name: Install Python SDK with dev deps
        run: |
          cd packages/sdk-python
          pip install -e ".[dev]" --break-system-packages
      - name: Run Python tests
        run: |
          cd packages/sdk-python
          python -m pytest tests/ -v --tb=short

  docker-build:
    name: Docker build validation
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - name: Build API image
        run: docker build -f apps/api/Dockerfile -t agentlens-api .
      - name: Build Dashboard image
        run: docker build -f apps/dashboard/Dockerfile -t agentlens-dashboard .
```

---

### STEP 6 — Commit and push the fixes

```bash
git add -A
git commit -m "fix: resolve CI failures — Python tests, lint, Docker builds"
git push origin main
```

Then immediately open GitHub Actions and watch the new run.

---

### FINAL CHECK

After pushing, report:
```
CI FIX SUMMARY
══════════════════════════════════════
Files changed:
  - [list every file modified]

Root cause of each failure:
  ❌ Python SDK: [what was wrong + what you fixed]
  ❌ Lint:       [what was wrong + what you fixed]
  ❌ Docker:     [what was wrong + what you fixed]

Expected CI result after fix:
  ✅ Install dependencies
  ✅ Test (Python SDK)
  ✅ Lint
  ✅ Build & type-check
  ✅ Test (Node)
  ✅ Docker build validation

Push commit: [commit hash]
Watch CI at: https://github.com/farzanhossan/agentlens/actions
══════════════════════════════════════
```

Do NOT move to npm publishing or production deploy until ALL 6 jobs are green.
