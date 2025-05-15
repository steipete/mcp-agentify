#!/bin/bash
# scripts/dev.sh
# For IDE execution where the IDE manages the process lifecycle.

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Change to the script directory to ensure correct path resolution for src/cli.ts
# This assumes scripts/dev.sh is in the project root for ./src/cli.ts to be correct.
# If dev.sh is in scripts/, then SCRIPT_DIR needs to be parent for cd, or path to cli.ts adjusted.
# Assuming dev.sh is in project_root/scripts/ as per standard structure.
cd "$SCRIPT_DIR/.." # Go up one level from scripts/ to project root

# Redirect informational echo to stderr
echo "Starting mcp-agentify with npx tsx (IDE mode, CWD: $(pwd))..." >&2

# Ensure a default DEBUG_PORT
export DEBUG_PORT=${DEBUG_PORT:-3030}
# OPENAI_API_KEY and LOG_LEVEL should be set by the IDE's env configuration for the server process.

NODE_ENV=development npx tsx ./src/cli.ts 