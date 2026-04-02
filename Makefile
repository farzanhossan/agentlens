.PHONY: dev test build migrate logs clean help

# ── Default target ────────────────────────────────────────────────────────────
.DEFAULT_GOAL := help

# ── Development ───────────────────────────────────────────────────────────────
dev: ## Start Docker services + all apps in watch mode
	@echo "Starting infrastructure services..."
	docker compose -f infra/docker-compose.yml up -d postgres redis elasticsearch
	@echo "Starting all apps in watch mode..."
	pnpm turbo run dev --parallel

# ── Testing ───────────────────────────────────────────────────────────────────
test: ## Run all Node + Python tests
	pnpm turbo run test
	cd packages/sdk-python && pytest -v

test-node: ## Run Node/TypeScript tests only
	pnpm turbo run test

test-python: ## Run Python SDK tests only
	cd packages/sdk-python && pytest -v

# ── Build ─────────────────────────────────────────────────────────────────────
build: ## Build all packages and apps
	pnpm turbo run build

# ── Database ──────────────────────────────────────────────────────────────────
migrate: ## Run pending TypeORM migrations
	pnpm --filter @agentlens/api run migration:run

migrate-generate: ## Generate a new migration (usage: make migrate-generate NAME=MyMigration)
	pnpm --filter @agentlens/api run migration:generate -- src/database/migrations/$(NAME)

migrate-revert: ## Revert the last migration
	pnpm --filter @agentlens/api run migration:revert

# ── Docker ────────────────────────────────────────────────────────────────────
up: ## Start all Docker Compose services
	docker compose -f infra/docker-compose.yml up -d

down: ## Stop all Docker Compose services
	docker compose -f infra/docker-compose.yml down

logs: ## Tail Docker Compose logs
	docker compose -f infra/docker-compose.yml logs -f

logs-api: ## Tail API container logs
	docker compose -f infra/docker-compose.yml logs -f api

# ── Utilities ─────────────────────────────────────────────────────────────────
lint: ## Lint all packages
	pnpm turbo run lint

clean: ## Remove all build artifacts and node_modules
	pnpm turbo run clean --if-present
	find . -name 'node_modules' -type d -prune -exec rm -rf {} +
	find . -name 'dist' -type d -prune -exec rm -rf {} + 

install: ## Install all dependencies
	pnpm install --frozen-lockfile

# ── Demo seed ─────────────────────────────────────────────────────────────────
seed: ## Seed demo data
	pnpm seed:demo

seed-reset: ## Reset demo data
	pnpm seed:reset

seed-fresh: ## Fresh seed (reset + seed)
	pnpm seed:fresh

# ── Help ──────────────────────────────────────────────────────────────────────
help: ## Show this help message
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
