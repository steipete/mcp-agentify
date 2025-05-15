#!/bin/bash
# scripts/dev.sh
echo "Starting mcp-agentify in development mode (via ts-node and npx nodemon)..."
# Ensure OPENAI_API_KEY is set in .env or your shell environment
# For now, we assume NODE_ENV handling will be done within the app or by a more specific CLI flag if needed.

# Use npx to ensure project-local nodemon and ts-node are preferred
# The working directory for ts-node should be the project root for correct path resolution of ./src/cli.ts

NPX_CMD="npx nodemon --watch src --ext ts,json --exec \"npx ts-node ./src/cli.ts\""

# Set NODE_ENV for the command execution
NODE_ENV=development eval $NPX_CMD 