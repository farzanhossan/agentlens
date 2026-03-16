#!/bin/bash
set -e

echo "Publishing AgentLens SDK packages to npm..."

# Login check
npm whoami || (echo "Not logged in to npm. Run: npm login" && exit 1)

# Build all
echo "Building packages..."
pnpm --filter "@farzanhossan/agentlens-*" build

# Test all
echo "Running tests..."
pnpm --filter "@farzanhossan/agentlens-*" test

# Publish in order (core first, then dependents)
echo "Publishing @farzanhossan/agentlens-core..."
pnpm --filter @farzanhossan/agentlens-core publish --access public

echo "Publishing @farzanhossan/agentlens-openai..."
pnpm --filter @farzanhossan/agentlens-openai publish --access public

echo "Publishing @farzanhossan/agentlens-anthropic..."
pnpm --filter @farzanhossan/agentlens-anthropic publish --access public

echo ""
echo "All packages published!"
echo ""
echo "Verify at:"
echo "  https://www.npmjs.com/package/@farzanhossan/agentlens-core"
echo "  https://www.npmjs.com/package/@farzanhossan/agentlens-openai"
echo "  https://www.npmjs.com/package/@farzanhossan/agentlens-anthropic"
