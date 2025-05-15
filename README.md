# mcp-agentify

AI-Powered MCP Gateway for Tool Orchestration

## Overview

`mcp-agentify` is a Node.js/TypeScript application acting as an AI-Powered MCP (Model Context Protocol) Gateway. This Gateway will:
- Function as an MCP server, primarily communicating via `stdio`.
- Accept requests from a client IDE (e.g., Cursor) through a primary MCP method: `agentify/orchestrateTask`.
- Utilize OpenAI's API (specifically Tool Calling) to interpret user queries and context, select appropriate backend MCP tools, and formulate the MCP calls.
- Dynamically manage `stdio`-based connections to backend MCP servers.
- Proxy MCP calls to chosen backends and return responses.
- Be runnable via `npx` or as a dependency.

## Features

- **Unified MCP Endpoint:** Provides a single MCP server endpoint for client applications.
- **Intelligent Task Orchestration:** Uses OpenAI (e.g., GPT-4 Turbo) to understand natural language and select from configured backend tools.
- **Dynamic Backend Management:** Configure backend MCP servers (like `@modelcontextprotocol/server-filesystem`, `@browserbasehq/mcp-browserbase`) via `initializationOptions`.
- **Simplified Client Logic:** Centralizes tool selection and MCP call formulation.
- **Stdio Communication:** Designed for easy integration with IDEs and other tools via standard I/O.
- **Optional Debug UI:** (Planned for future, see Task 8) For observing logs and traces.

## Installation

As a dependency in your project:
```bash
npm install mcp-agentify
# or
yarn add mcp-agentify
```

To run globally using npx (once published):
```bash
npx mcp-agentify
```

## Configuration

`mcp-agentify` requires an OpenAI API key. This can be provided in two ways, with environment variables taking precedence if provided both ways:

1.  **Environment Variable (Recommended for local development/direct execution):**
    Create a `.env` file in the root of your project (or where `mcp-agentify` is run from) with your OpenAI API key:
    ```env
    OPENAI_API_KEY=your_openai_api_key_here
    # Optional: Desired log level for the gateway
    LOG_LEVEL=info # (trace, debug, info, warn, error, fatal, silent - default: info)
    # Optional: Port for the debug web interface (if enabled)
    # DEBUG_PORT=3001
    ```

2.  **MCP `initialize` Request (`initializationOptions`):
    The OpenAI API key can also be passed by the client IDE during the `initialize` request within `initializationOptions`. See Usage section.

## Usage

`mcp-agentify` acts as an MCP server communicating via `stdio`.

### Connecting and Initializing

A client (e.g., an IDE extension) would typically spawn `mcp-agentify` as a child process and communicate over its `stdin`/`stdout`.

**Example Initialization from a Client (JavaScript/TypeScript):**
```typescript
import { createMessageConnection } from 'vscode-jsonrpc/node';
import { spawn, ChildProcess } from 'node:child_process';
import type { InitializeResult, InitializeParams } from 'vscode-languageserver-protocol';
// Assuming types like GatewayOptions, BackendConfig are defined/imported by the client

async function connectAndInitialize() {
  const agentifyProcess = spawn('npx', ['mcp-agentify'], { stdio: 'pipe' }); // Or direct path if installed

  const connection = createMessageConnection(
    agentifyProcess.stdout,
    agentifyProcess.stdin
  );

  agentifyProcess.stderr.on('data', (data) => {
    console.error(`mcp-agentify stderr: ${data}`);
  });

  connection.listen();

  const initParams: InitializeParams = {
    processId: process.pid || null,
    clientInfo: { name: "MyClientIDE", version: "1.0.0" },
    rootUri: null,
    capabilities: {},
    initializationOptions: {
      // OPENAI_API_KEY: "sk-client_provided_key", // Can be provided here
      logLevel: "debug", // Desired log level for the gateway
      // DEBUG_PORT: 3001, // Optional: to enable debug UI for the gateway
      backends: [
        {
          id: "filesystem", // Must match tool name for LLM
          type: "stdio",    // PoC only supports stdio
          command: "npx",    // Command to run the backend MCP server
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/allowed_dir1", "/path/to/allowed_dir2"],
          // env: { "CUSTOM_ENV_VAR": "value" } // Optional env vars for this backend
        },
        {
          id: "mcpBrowserbase",
          type: "stdio",
          command: "npx", 
          args: ["-y", "@smithery/cli@latest", "run", "@browserbasehq/mcp-browserbase", "--key", "YOUR_BROWSERBASE_API_KEY_HERE"], // API key passed as arg
          // env: { "BROWSERBASE_API_KEY": "YOUR_KEY_HERE" } // Or passed via env to backend
        }
      ]
    }
  };

  try {
    const result: InitializeResult = await connection.sendRequest('initialize', initParams);
    console.log('mcp-agentify initialized:', result.serverInfo);
    return connection; // Use this connection for further requests
  } catch (error) {
    console.error('Failed to initialize mcp-agentify:', error);
    connection.dispose();
    agentifyProcess.kill();
    return null;
  }
}
```

### Orchestrating Tasks via `agentify/orchestrateTask`

Once initialized, send natural language queries to the `agentify/orchestrateTask` method. The gateway will use the LLM to choose a backend tool and execute the corresponding MCP call.

**Parameters:**
```typescript
interface AgentifyOrchestrateTaskParams {
  query: string; // Natural language query
  context?: {
    activeDocumentURI?: string | null;
    currentWorkingDirectory?: string | null;
    selectionText?: string | null;
  } | null;
}
```

**Returns:** `Promise<any>` (The direct result from the chosen backend MCP method).

**Example:**
```typescript
async function listFiles(connection: MessageConnection) {
  if (!connection) return;
  try {
    const result = await connection.sendRequest('agentify/orchestrateTask', {
      query: "List all text files in my project's root directory",
      context: {
        currentWorkingDirectory: "/Users/Shared/TestPoCDir1" // Example context
      }
    });
    console.log("Task orchestrateTask result:", result);
  } catch (error) {
    console.error("Error orchestrating task:", error);
  }
}
```

## Development

1.  Clone the repository: `git clone https://github.com/steipete/mcp-agentify.git`
2.  Navigate to the project directory: `cd mcp-agentify`
3.  Install dependencies: `npm install`
4.  Create a `.env` file in the project root (copy from `.env.example`) and add your `OPENAI_API_KEY`.
    ```env
    OPENAI_API_KEY=your_openai_api_key_here
    LOG_LEVEL=debug
    # DEBUG_PORT=3001
    ```
5.  Run in development mode (with hot reloading):
    ```bash
    npm run dev
    ```
    This uses `nodemon` and `ts-node` to execute `src/cli.ts`.

## Testing

Run tests with Vitest:
```bash
npm test
```
To run in watch mode:
```bash
npm run test:watch
```
To get a coverage report:
```bash
npm run test:coverage
```
(Note: Unit and integration tests are planned under Task 11 and 12 respectively.)

## License

[MIT](LICENSE)
