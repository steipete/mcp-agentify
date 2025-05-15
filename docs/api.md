# API Documentation

This document details the Model Context Protocol (MCP) interface provided by `mcp-agentify`.

## MCP Methods

### `initialize`

Initializes the `mcp-agentify` server. The client (e.g., an IDE) sends this request first to configure the gateway, including available backend MCP servers and other operational parameters.

**Parameters (`InitializeParams`):**

The `params` object for the `initialize` request should conform to the standard LSP `InitializeParams` structure. The crucial part for `mcp-agentify` is `params.initializationOptions`.

```typescript
// From vscode-languageserver-protocol
interface InitializeParams {
  processId?: number | null;
  clientInfo?: {
    name: string;
    version?: string;
  } | null;
  locale?: string;
  rootPath?: string | null; // Deprecated, use rootUri
  rootUri: DocumentUri | null;
  capabilities: ClientCapabilities; // Standard LSP client capabilities
  initializationOptions?: GatewayOptions; // *** This is key for mcp-agentify ***
  trace?: 'off' | 'messages' | 'verbose';
  workspaceFolders?: WorkspaceFolder[] | null;
}

// Defined in src/interfaces.ts (derived from src/schemas.ts)
interface GatewayOptions {
  OPENAI_API_KEY: string; // OpenAI API key (can also be set via .env)
  backends: BackendConfig[]; // Array of backend MCP server configurations
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'; // Optional: desired log level for the gateway
  DEBUG_PORT?: number | null; // Optional: port for the debug web interface
}

// Defined in src/interfaces.ts (derived from src/schemas.ts)
interface BackendConfig { // For PoC, this is effectively BackendStdioConfig
  id: string;        // Unique identifier, must match LLM tool name. OpenAI Tool Name compliant (^[a-zA-Z0-9_-]{1,64}$)
  displayName?: string; // Optional display name for the backend
  type: "stdio";     // For PoC, only "stdio" is supported
  command: string;   // Command to launch the backend MCP server (e.g., "npx")
  args?: string[];    // Arguments for the command
  env?: Record<string, string>; // Optional environment variables for the backend process
}
```

**Returns (`InitializeResult`):**

Standard LSP `InitializeResult` structure.

```typescript
// From vscode-languageserver-protocol
interface InitializeResult<C extends ServerCapabilities = ServerCapabilities> {
  capabilities: C;
  serverInfo?: {
    name: string;    // e.g., "mcp-agentify"
    version?: string; // e.g., "0.1.0"
  };
}

// For mcp-agentify, capabilities will be minimal for PoC.
interface ServerCapabilities { }
```

### `agentify/orchestrateTask`

This is the primary method for sending tasks to the `mcp-agentify` gateway. The gateway uses an LLM to interpret the query and context, select an appropriate backend tool, and execute the corresponding MCP method on that backend.

**Parameters (`AgentifyOrchestrateTaskParams`):**

```typescript
// Defined in src/interfaces.ts (derived from src/schemas.ts)
interface AgentifyOrchestrateTaskParams {
  query: string; // Natural language query describing the task.
  context?: {
    activeDocumentURI?: string | null;        // URI of the currently active document in the IDE.
    currentWorkingDirectory?: string | null;  // Current working directory of the client/IDE.
    selectionText?: string | null;            // Currently selected text in the IDE.
  } | null;
}
```

**Returns (`Promise<any>`):**

The method returns a promise that resolves with the direct result from the chosen backend MCP server's method. The structure of this result is specific to the backend and the MCP method called on it.

**Errors:**
Can throw `ResponseError` with codes like:
- `ErrorCodes.InvalidParams` (-32602): If `requestParams` are invalid.
- `-32000`: AI orchestrator could not determine an action.
- `-32001`: Gateway not fully initialized.
- `-32002`: Gateway critical initialization error (options missing).
- `-32003`: Error during AI orchestration step.
- `-32004`: Error executing plan on backend.

## Notifications

### `shutdown`

Sent by the client to request a graceful shutdown of the `mcp-agentify` server and its managed backend processes. The server will attempt to shut down backends and then prepare to exit. The client should wait for the `shutdown` request to complete (if it were a request) or simply follow up with an `exit` notification.

**Parameters:** None.

### `exit`

Sent by the client to notify the server that it should exit immediately. The server will attempt a final cleanup of backends and then terminate the process.

**Parameters:** None. 