#!/bin/bash
# Installs workspace dependencies so tests and typecheck work in Claude Code cloud sessions.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# The Electron binary is not needed for tests/typecheck and may be blocked by the network policy.
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
echo 'export ELECTRON_SKIP_BINARY_DOWNLOAD=1' >> "$CLAUDE_ENV_FILE"

corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile=false --config.confirmModulesPurge=false
