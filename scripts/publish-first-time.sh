#!/bin/bash
set -e

echo "Publishing AgentLens SDK packages to npm..."

# Login check
npm whoami || (echo "Not logged in to npm. Run: npm login" && exit 1)

# Build all
echo "Building packages..."
pnpm --filter "@farzanhossans/agentlens-*" build

# Test all
echo "Running tests..."
pnpm --filter "@farzanhossans/agentlens-*" test

# Publish in order (core first, then dependents)
echo "Publishing @farzanhossans/agentlens-core..."
pnpm --filter @farzanhossans/agentlens-core publish --access public

echo "Publishing @farzanhossans/agentlens-openai..."
pnpm --filter @farzanhossans/agentlens-openai publish --access public

echo "Publishing @farzanhossans/agentlens-anthropic..."
pnpm --filter @farzanhossans/agentlens-anthropic publish --access public

echo ""
echo "All packages published!"
echo ""
echo "Verify at:"
echo "  https://www.npmjs.com/package/@farzanhossans/agentlens-core"
echo "  https://www.npmjs.com/package/@farzanhossans/agentlens-openai"
echo "  https://www.npmjs.com/package/@farzanhossans/agentlens-anthropic"
