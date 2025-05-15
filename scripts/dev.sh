#!/bin/bash
# scripts/dev.sh
# For IDE execution where the IDE manages the process lifecycle.

# Redirect informational echo to stderr
echo "Starting mcp-agentify directly with ts-node (IDE mode)..." >&2

# Ensure a default DEBUG_PORT
export DEBUG_PORT=${DEBUG_PORT:-3030}
# OPENAI_API_KEY and LOG_LEVEL should be set by the IDE's env configuration for the server process.

# Execute ts-node directly, assuming ts-node is in PATH for the IDE's execution context
# The --project flag explicitly points to the tsconfig.json
# The CWD should be the project root, set by the IDE's "workingDirectory" config.
NODE_ENV=development ts-node --project tsconfig.json ./src/cli.ts 