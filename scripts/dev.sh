#!/bin/bash
# scripts/dev.sh
echo "Starting mcp-agentify in development mode (via ts-node)..."
# Ensure OPENAI_API_KEY is set in .env or your shell environment
# For now, we assume NODE_ENV handling will be done within the app or by a more specific CLI flag if needed.
nodemon --watch src --ext ts,json --exec "ts-node ./src/cli.ts" 