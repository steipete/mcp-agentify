# Usage Examples

This document provides examples of how to interact with `mcp-agentify` from a client application (e.g., an IDE extension or a standalone script).

## Basic Example: Connecting, Initializing, and Orchestrating a Task

This example demonstrates how to spawn `mcp-agentify`, establish an MCP connection, initialize it with a single backend (filesystem), send an orchestration task, and then shut down.

```javascript
// client-example.js
const { createMessageConnection } = require('vscode-jsonrpc/node'); // Using CommonJS require for this example script
const { spawn } = require('node:child_process');

async function main() {
  console.log('Spawning mcp-agentify process...');
  // Ensure mcp-agentify is globally available (e.g., via `npm link` or `npm install -g .` in mcp-agentify project) 
  // or provide a direct path to the launch script (e.g., './bin/mcp-agentify.cjs').
  // For a published package, you might use 'npx mcp-agentify'.
  const agentifyProcess = spawn('mcp-agentify', [], { stdio: 'pipe' });

  agentifyProcess.on('error', (err) => {
    console.error('Failed to start mcp-agentify process:', err);
  });

  const connection = createMessageConnection(
    agentifyProcess.stdout,
    agentifyProcess.stdin
  );

  agentifyProcess.stderr.on('data', (data) => {
    console.error(`mcp-agentify stderr: ${data.toString().trim()}`);
  });

  connection.listen();
  console.log('Connection established. Sending initialize request...');

  try {
    const initParams = {
      // processId, clientInfo, rootUri, capabilities are part of standard InitializeParams
      // but for this example, we focus on initializationOptions for mcp-agentify
      initializationOptions: {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY, // Assumes API key is in env
        logLevel: "debug",
        backends: [
          {
            id: "filesystem",
            type: "stdio",
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/Shared/TestPoCDir1"] // Example allowed path
          }
        ]
      }
    };

    const initResult = await connection.sendRequest('initialize', initParams);
    console.log('Initialization successful:', initResult.serverInfo);

    console.log('Sending orchestrateTask request...');
    const taskParams = {
      query: "List all files in the root directory provided to the filesystem backend.",
      context: {
        // For filesystem, currentWorkingDirectory might be less relevant if paths are absolute or pre-configured
        // But it can be used by the LLM to infer relative paths if needed for a query.
        currentWorkingDirectory: "/Users/Shared/TestPoCDir1" 
      }
    };
    const taskResult = await connection.sendRequest('agentify/orchestrateTask', taskParams);
    console.log('Orchestration task result:', taskResult);

  } catch (error) {
    console.error('An error occurred:', error);
  } finally {
    console.log('Sending shutdown and exit notifications...');
    connection.sendNotification('shutdown');
    // Give a moment for shutdown to be processed before exit, though not strictly guaranteed.
    setTimeout(() => {
        connection.sendNotification('exit');
        // connection.dispose(); // Dispose after exit notification or on close
        // agentifyProcess.kill(); // Ensure process is killed if exit doesn't terminate it
    }, 500);
    // Note: Proper client-side cleanup would also involve disposing the connection 
    // and ensuring the child process is terminated, e.g., on client exit.
    // The server handles process.exit(0) on 'exit' notification.
  }
}

if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is not set.");
  console.log("Please set it before running this example, e.g., OPENAI_API_KEY=sk-yourkey node client-example.js");
} else {
  main();
}
```

## Using with Multiple Backends

This example shows how to initialize `mcp-agentify` with multiple backends and send queries that would be routed to different tools.

```javascript
// In your client, after establishing a connection as in the basic example:

async function initializeWithMultipleBackends(connection) {
  const initParams = {
    initializationOptions: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      logLevel: "info",
      backends: [
        {
          id: "filesystem",
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/Shared/TestPoCDir1"]
        },
        {
          id: "mcpBrowserbase",
          type: "stdio",
          command: "npx",
          args: ["-y", "@smithery/cli@latest", "run", "@browserbasehq/mcp-browserbase", "--key", "YOUR_BROWSERBASE_API_KEY_HERE"]
        }
      ]
    }
  };
  const initResult = await connection.sendRequest('initialize', initParams);
  console.log('Initialized with multiple backends:', initResult.serverInfo);
}

async function orchestrateMultipleTasks(connection) {
  // Query likely for mcpBrowserbase
  let query1 = "What is the latest news about AI? Give me a summary.";
  console.log(`Sending query: "${query1}"`);
  try {
    const webSearchResult = await connection.sendRequest('agentify/orchestrateTask', { query: query1 });
    console.log("Web Search Result:", webSearchResult);
  } catch (e) { console.error("Error with web search task:", e); }

  // Query likely for filesystem
  let query2 = "Create a new file named \"testFromAgentify.txt\" in the root allowed directory with content \"Hello from mcp-agentify!\"";
  console.log(`Sending query: "${query2}"`);
  try {
    const fileOpResult = await connection.sendRequest('agentify/orchestrateTask', {
      query: query2,
      context: { currentWorkingDirectory: "/Users/Shared/TestPoCDir1" } // Context might help LLM if path is relative in query
    });
    console.log("File Operation Result:", fileOpResult);
  } catch (e) { console.error("Error with file operation task:", e); }
}

// Assuming 'connection' is an active MessageConnection from the basic example setup:
// async function runMultiBackendExample(connection) {
//   if (!connection) { console.error("Connection not established."); return; }
//   await initializeWithMultipleBackends(connection);
//   await orchestrateMultipleTasks(connection);
//   // Remember to shutdown/exit connection as in basic example
// }
// 
// // To run this: ensure connection is passed from a setup like in main() of basic example.
// // e.g., const conn = await setupConnection(); if (conn) runMultiBackendExample(conn);
```

**Note:** These examples use CommonJS `require`. If your client project uses ES Modules, adjust to `import` statements accordingly. Ensure backend servers like `@modelcontextprotocol/server-filesystem` and `@browserbasehq/mcp-browserbase` are accessible in your environment (e.g., installed globally or resolvable by `npx`). 