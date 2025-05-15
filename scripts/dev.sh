#!/bin/bash
# scripts/dev.sh
# Redirect informational echo to stderr so it doesn't interfere with MCP communication on stdout
echo "Starting mcp-agentify in development mode (via ts-node and npx nodemon)..." >&2

# Ensure OPENAI_API_KEY is set in .env or your shell environment
# NODE_ENV is set for the executed command.
# Use --quiet to minimize nodemon's own output on stdout.
# Use --signal SIGTERM and --exitcrash for better behavior when nodemon is wrapped or managed by an IDE.
NODE_ENV=development npx nodemon \
    --watch src \
    --ext ts,json \
    --exec "npx ts-node ./src/cli.ts" \
    --signal SIGTERM \
    --exitcrash \
    --quiet 