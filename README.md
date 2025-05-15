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

`mcp-agentify` requires configuration for its operation, primarily the OpenAI API key and backend MCP server definitions. Configuration can be provided via a `.env` file and/or through the `initializationOptions` during the MCP `initialize` handshake.

### 1. Environment Variables (`.env` file)

For local development or when running the gateway directly, create a `.env` file in the project root. This is useful for settings that are static for your environment.

**Example `.env` file:**
```env
# Required for LLM orchestration
OPENAI_API_KEY=sk-YourOpenAIKeyHere

# Optional: Default log level for the gateway.
# Can be one of: trace, debug, info, warn, error, fatal, silent. Defaults to 'info'.
LOG_LEVEL=debug

# Optional: Port to enable the Debug Web UI.
# If set, the Debug UI will be accessible at http://localhost:YOUR_PORT
DEBUG_PORT=3001

# Optional: API key for Browserbase, if using the mcpBrowserbase backend and it expects the key from env.
# BROWSERBASE_API_KEY=bb_api_YourBrowserbaseKeyHere 
```
*   `OPENAI_API_KEY`: This is essential for the LLM orchestrator to function.
*   `LOG_LEVEL`: Controls the verbosity of logs from the gateway.
*   `DEBUG_PORT`: If specified, enables the Debug Web UI.

### 2. MCP `initialize` Request (`initializationOptions`)

The client IDE or application connecting to `mcp-agentify` provides most of the dynamic configuration through the `initializationOptions` parameter of the standard MCP `initialize` request. This includes backend definitions and can also override settings like `OPENAI_API_KEY` or `logLevel`.

**API Key Priority:** For `OPENAI_API_KEY`, the value in `process.env` (from `.env` or shell) takes precedence over the value in `initializationOptions`.

**Example `initializationOptions` from a client:**

This example shows how a client might configure the gateway with a filesystem backend and a Browserbase backend. It also sets a specific log level and enables the debug UI.

```json
{
  "logLevel": "trace",
  "OPENAI_API_KEY": "sk-ClientProvidedKeyIfNeededAsFallback", // Can be overridden by gateway's .env
  "DEBUG_PORT": 3001,
  "backends": [
    {
      "id": "filesystem",
      "displayName": "Local Filesystem Access",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y", 
        "@modelcontextprotocol/server-filesystem", 
        "/Users/Shared/Projects", // Example: Path accessible by the filesystem backend
        "/tmp/agentify-work"
      ],
      "env": { 
        "FILESYSTEM_LOG_LEVEL": "debug" // Custom env var for this specific backend
      }
    },
    {
      "id": "mcpBrowserbase",
      "displayName": "Cloud Browser (Browserbase)",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y", 
        "@smithery/cli@latest", 
        "run", 
        "@browserbasehq/mcp-browserbase", 
        "--key", "bb_api_YOUR_KEY_FROM_USER_CONFIG" // API key passed as an argument to the backend
      ]
    }
  ]
}
```

**Key fields in `initializationOptions`:**
*   `logLevel` (optional): Sets the gateway's internal log level. Overrides `LOG_LEVEL` from `.env` if provided here.
*   `OPENAI_API_KEY` (optional): Can be provided here if not set in the gateway's environment. The environment variable on the gateway side always takes precedence.
*   `DEBUG_PORT` (optional): Enables and sets the port for the Debug Web UI.
*   `backends` (required, array): Defines the backend MCP servers the gateway can orchestrate.
    *   `id`: A unique identifier for the backend. This **must** match the `name` used when defining the tool for the LLM in `llmOrchestrator.ts` (see `spec.md` Section 7 for PoC examples like "filesystem", "mcpBrowserbase").
    *   `displayName` (optional): A human-readable name for the backend, used in logs or UI.
    *   `type`: Currently only `"stdio"` is supported for this PoC.
    *   `command`: The command to execute to start the backend MCP server (e.g., `npx`, `node`, or a direct path to an executable).
    *   `args` (optional): An array of string arguments to pass to the `command`.
    *   `env` (optional): A key-value map of additional environment variables to set for the spawned backend process.

## How to Run

### 1. Development Mode

This is the recommended way to run `mcp-agentify` during development, as it provides hot-reloading.

1.  **Prerequisites:**
    *   Node.js (LTS version, e.g., >=18.0.0)
    *   npm or yarn
    *   Git (to clone the repository)
2.  **Clone the repository:**
    ```bash
    git clone https://github.com/steipete/mcp-agentify.git
    cd mcp-agentify
    ```
3.  **Install dependencies:**
    ```bash
    npm install
    ```
4.  **Configure Environment:**
    Create a `.env` file by copying `.env.example`:
    ```bash
    cp .env.example .env
    ```
    Edit `.env` and add your `OPENAI_API_KEY`. You can also set `LOG_LEVEL` and `DEBUG_PORT` here if desired (see Configuration section).
    ```env
    OPENAI_API_KEY=your_openai_api_key_here
    LOG_LEVEL=debug
    DEBUG_PORT=3001
    ```
5.  **Run the development server:**
    ```bash
    npm run dev
    ```
    This command starts the gateway using `nodemon` for automatic restarts on file changes and `ts-node` to execute the TypeScript source directly. The gateway will listen for an MCP client connection on `stdio`.

### 2. Running the Compiled Version (Simulating Production/NPX)

After building the project, you can run the compiled JavaScript version.

1.  **Build the project:**
    ```bash
    npm run build
    ```
    This compiles the TypeScript source in `src/` to JavaScript in `dist/`.
2.  **Run the compiled CLI:**
    The `package.json` defines a `bin` entry, so after `npm install` (or `npm link` for global-like access during development), you should be able to run it by its name if linked, or directly via node:
    ```bash
    node dist/cli.js
    ```
    Or, if you have used `npm link` to simulate a global install:
    ```bash
    mcp-agentify
    ```
    This will start the gateway, again listening on `stdio` for an MCP client.

    When packaged and published to NPM, users would typically run it via `npx @your-scope/mcp-agentify`.

## Debug Web UI

`mcp-agentify` includes an optional Debug Web UI that can be invaluable for observing the gateway's internal operations, logs, and the MCP messages being exchanged.

### Enabling the Debug UI

To enable the Debug UI, you need to specify a `DEBUG_PORT` in the configuration. This can be done in two ways:

1.  **Via `.env` file:**
    Add `DEBUG_PORT=3001` (or your desired port number) to your `.env` file.
2.  **Via `initializationOptions`:**
    The client connecting to the gateway can pass `"DEBUG_PORT": 3001` within the `initializationOptions` during the `initialize` MCP handshake.

If a `DEBUG_PORT` is configured, the gateway will start an HTTP and WebSocket server on that port.

### Accessing the Debug UI

Once the gateway is running and the Debug UI is enabled, open your web browser and navigate to:
`http://localhost:DEBUG_PORT` (e.g., `http://localhost:3001`)

### Features

The Debug UI provides the following sections:

*   **Gateway Status:**
    *   Shows the overall status of the gateway (e.g., running, uptime).
    *   Lists configured backend MCP servers and their readiness status (e.g., "Filesystem: Ready", "Browserbase: Not Ready").
*   **Gateway Configuration:**
    *   Displays the current (sanitized) configuration the gateway is using, including log level, backend definitions, etc. Sensitive information like API keys will be redacted.
*   **Real-time Logs:**
    *   Streams logs directly from the gateway in real-time via WebSockets.
    *   Allows filtering logs by minimum severity level (Trace, Debug, Info, Warn, Error, Fatal).
    *   Provides an "Auto-scroll" option to keep the latest logs in view.
    *   Displays log timestamps, levels, messages, and any structured details.
*   **MCP Traces:**
    *   Streams MCP messages exchanged between the gateway and backend servers, as well as between the client IDE and the gateway.
    *   Shows direction (Incoming to Gateway, Outgoing from Gateway), backend ID (if applicable), MCP method, request/response ID, and sanitized parameters or results.
    *   Also provides an "Auto-scroll" option.

### How it Works

*   The `DebugWebServer` component (`src/debugWebServer.ts`) serves the static HTML, CSS, and JavaScript files located in `public_debug_ui/`.
*   It provides API endpoints (`/api/status`, `/api/config`, `/api/logs`, `/api/mcptrace`) that the frontend JavaScript uses to fetch initial state or paginated historical data (though historical data fetching is not fully implemented in the PoC's UI script).
*   A WebSocket connection is established between the frontend UI and the `DebugWebServer`.
*   The gateway's main logger (`src/logger.ts`) is configured to pipe log entries (as JSON objects) to the `DebugWebServer` if the debug UI is active.
*   The `BackendManager` and main server logic (`src/server.ts`) emit MCP trace events.
*   The `DebugWebServer` receives these log entries and trace events and broadcasts them to all connected WebSocket clients (i.e., open Debug UI pages).
*   The client-side JavaScript (`public_debug_ui/script.js`) receives these WebSocket messages and dynamically updates the corresponding sections in the HTML to display the information.

## Usage

`mcp-agentify` acts as an MCP server communicating via `stdio`.

### Connecting and Initializing

When integrating `mcp-agentify` into an IDE or a development tool like Cursor or Windsurf, the tool itself typically handles the process of spawning `mcp-agentify` and establishing the `stdio` connection. As a user of such a tool, your primary concern is providing the correct `initializationOptions` to `mcp-agentify` through the tool's configuration interface (e.g., settings JSON, UI fields).

The structure of these `initializationOptions` is defined by `mcp-agentify` (see the `GatewayOptionsSchema` in `src/schemas.ts` and the "Configuration" section above for details). Below is an example of what you might put into your IDE's configuration field for `mcp-agentify`'s initialization options:

**Example `initializationOptions` (for IDE settings):**

```json
{
  "logLevel": "debug",
  "OPENAI_API_KEY": "sk-YourOpenAIKeyFromASecureSource", // Or rely on .env on the server
  "DEBUG_PORT": 3001,
  "backends": [
    {
      "id": "filesystem",
      "displayName": "Local Filesystem",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "${workspaceFolder}", // IDE might substitute this with the current project path
        "/tmp/shared_work_area"
      ],
      "env": { 
        "FILESYSTEM_LOG_LEVEL": "info"
      }
    },
    {
      "id": "mcpBrowserbase",
      "displayName": "Web Browser via Browserbase",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y", 
        "@smithery/cli@latest", 
        "run", 
        "@browserbasehq/mcp-browserbase", 
        "--key", "bb_api_YOUR_BROWSERBASE_KEY" // Ensure this key is securely managed
      ]
    }
    // Add other configured backend tools here
  ]
}
```

**Explanation for IDE Users:**
*   You would typically find a setting in your IDE (e.g., Cursor, Windsurf) where you specify the command to run `mcp-agentify` (e.g., `npx mcp-agentify` or the path to the executable) and a place to input the JSON blob for `initializationOptions`.
*   The IDE sends these options to `mcp-agentify` when it starts the server as part of the standard MCP `initialize` request.
*   Variables like `${workspaceFolder}` are often placeholders that the IDE will replace with actual values from your current project context.
*   Ensure any API keys (like `OPENAI_API_KEY` or Browserbase keys) are handled securely according to your IDE's recommendations (e.g., using environment variables set for the IDE, or its own secret management if available). If `OPENAI_API_KEY` is set in `mcp-agentify`'s `.env` file (see "Configuration" section), it will take precedence.

*(For developers building a custom client that programmatically spawns and connects to `mcp-agentify`, the following conceptual TypeScript snippet shows how these options would be part of the `InitializeParams` sent via `connection.sendRequest('initialize', initParams);` The `initializationOptions` object shown above would be assigned to `initParams.initializationOptions`.)*

```typescript
// Conceptual: How a custom client might send these options
// import type { InitializeParams } from 'vscode-languageserver-protocol';
// const initParams: InitializeParams = {
//   processId: process.pid || null,
//   clientInfo: { name: "MyCustomClient", version: "1.0.0" },
//   rootUri: null,
//   capabilities: {},
//   initializationOptions: { /* JSON object from above goes here */ }
// };
// await connection.sendRequest('initialize', initParams);
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
