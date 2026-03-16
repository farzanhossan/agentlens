#!/bin/bash
set -e

echo "Publishing AgentLens SDK packages to npm..."

# Login check
npm whoami || (echo "Not logged in to npm. Run: npm login" && exit 1)

# Build all
echo "Building packages..."
pnpm --filter "@agentlens/*" build

# Test all
echo "Running tests..."
pnpm --filter "@agentlens/*" test

# Publish in order (core first, then dependents)
echo "Publishing @agentlens/core..."
pnpm --filter @agentlens/core publish --access public

echo "Publishing @agentlens/openai..."
pnpm --filter @agentlens/openai publish --access public

echo "Publishing @agentlens/anthropic..."
pnpm --filter @agentlens/anthropic publish --access public

echo ""
echo "All packages published!"
echo ""
echo "Verify at:"
echo "  https://www.npmjs.com/package/@agentlens/core"
echo "  https://www.npmjs.com/package/@agentlens/openai"
echo "  https://www.npmjs.com/package/@agentlens/anthropic"
