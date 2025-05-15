---

**Ultimate Technical Specification: `mcp-agentify` (AI-Powered MCP Gateway) - Proof of Concept**

**Project Codename:** `mcp-agentify`
**NPM Package Name (Example):** `@your-scope/mcp-agentify`

**1. Overall Objective**

Develop `mcp-agentify`, a Node.js/TypeScript application acting as an AI-Powered MCP (Model Context Protocol) Gateway. This Gateway will:
    a.  Function as an MCP server, primarily communicating via `stdio`.
    b.  Accept requests from a client IDE (e.g., Cursor) through a primary MCP method: `agentify/orchestrateTask`.
    c.  Receive natural language `query` strings and an optional `context` object (containing IDE state like `activeDocumentURI`, `currentWorkingDirectory`, `selectionText`) within the `agentify/orchestrateTask` parameters.
    d.  Utilize OpenAI's GPT-4.x API (specifically the "Tool Calling" feature via the `openai` Node.js library) to:
        i.  Interpret the user's query and context.
        ii. Select the most appropriate backend MCP tool/server from a dynamically configured list. For this PoC, initial target backends are `@modelcontextprotocol/server-filesystem` and `@browserbasehq/mcp-browserbase`.
        iii. Formulate the specific MCP `method` string and `params` object for the selected backend.
    e.  Dynamically launch (using `child_process.spawn`) and manage `stdio`-based connections to these backend MCP servers. Configuration for backends (command, args, API keys via env or args) will be provided via `initializationOptions` during the MCP `initialize` handshake.
    f.  Proxy the LLM-determined MCP call to the chosen backend server.
    g.  Return the backend's response (or a summarized plain text error) to the client IDE.
    h.  Treat MCP calls as one-shot operations; no cross-call state management will be implemented in this PoC.
    i.  Include an optional local debug web interface (Express.js + WebSockets) for observing logs, status, and MCP traces, configurable via a port in `initializationOptions`.
    j.  Be runnable locally for development via a `scripts/dev.sh` script and ultimately be packageable for `npx` distribution.
    k.  Utilize `pino` for structured logging, `zod` for schema validation, and `vitest` for testing.

**2. Core Technologies**

*   **Language:** TypeScript (target ES2020 or newer, CommonJS modules initially for broader compatibility with some tools, but ESM is fine if all deps support it well).
*   **Runtime:** Node.js (LTS version, e.g., >=18.0.0).
*   **MCP Communication:** `vscode-jsonrpc/node`.
*   **LLM Interaction:** `openai` (latest stable version).
*   **Process Management:** Node.js `child_process` module.
*   **Logging:** `pino` (with `pino-pretty` for development).
*   **Schema Definition & Validation:** `zod`.
*   **Testing Framework:** `vitest`.
*   **Debug Web Server (Optional):** `express`, `ws`.
*   **Environment Variables:** `dotenv` for local development.

**3. Project Structure**

```plaintext
mcp-agentify/
├── src/
│   ├── cli.ts                  # CLI entry point (for npx, local script), loads .env, calls server logic
│   ├── server.ts               # Core MCP Agentify server logic (class or functions)
│   ├── backendManager.ts       # Manages lifecycle & connections to backend MCP servers
│   ├── llmOrchestrator.ts      # Handles OpenAI API interaction, tool definitions, planning
│   ├── debugWebServer.ts       # (Optional) Logic for the debug HTTP/WebSocket server
│   ├── logger.ts               # Configures and exports pino logger instance
│   ├── mcpTracer.ts            # (Optional) Utility for tracing MCP messages
│   ├── interfaces.ts           # Shared TypeScript interfaces (GatewayOptions, BackendConfig, Plan, etc.)
│   └── schemas.ts              # Zod schemas for validation
├── public_debug_ui/          # (Optional) Static assets for debug web UI (HTML, JS, CSS)
├── tests/                      # Vitest tests (e.g., *.test.ts, *.spec.ts)
│   ├── mocks/                  # Mock implementations (e.g., mock MCP servers, mock LLM responses)
│   └── integration/
│   └── unit/
├── scripts/
│   └── dev.sh                  # Development startup script
├── package.json
├── tsconfig.json
├── vitest.config.ts            # Vitest configuration
├── .env.example                # Example environment variables
└── .env                        # Local environment variables (gitignored)
```

**4. Key Interfaces and Schemas (`src/interfaces.ts` & `src/schemas.ts`)**

**4.1. Zod Schemas (`src/schemas.ts`)**

```typescript
// src/schemas.ts
import { z } from 'zod';

export const BackendStdioConfigSchema = z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "Backend ID must be OpenAI Tool Name compliant."),
    displayName: z.string().optional(),
    type: z.literal("stdio"),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
});
export type BackendStdioConfig = z.infer<typeof BackendStdioConfigSchema>;

export const BackendConfigSchema = BackendStdioConfigSchema; // PoC only supports stdio
export type BackendConfig = z.infer<typeof BackendConfigSchema>;

export const OrchestrationContextSchema = z.object({
    activeDocumentURI: z.string().url().optional().nullable(),
    currentWorkingDirectory: z.string().optional().nullable(),
    selectionText: z.string().optional().nullable(),
}).optional().nullable();
export type OrchestrationContext = z.infer<typeof OrchestrationContextSchema>;

export const GatewayOptionsSchema = z.object({
    logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default('info').optional(),
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required."),
    backends: z.array(BackendConfigSchema).min(1, "At least one backend configuration is required."),
    DEBUG_PORT: z.number().int().positive().optional().nullable(),
});
export type GatewayOptions = z.infer<typeof GatewayOptionsSchema>;

export const AgentifyOrchestrateTaskParamsSchema = z.object({
    query: z.string().min(1),
    context: OrchestrationContextSchema,
});
export type AgentifyOrchestrateTaskParams = z.infer<typeof AgentifyOrchestrateTaskParamsSchema>;

export const LLMGeneratedArgumentsSchema = z.object({
  mcp_method: z.string().min(1),
  mcp_params: z.record(z.unknown()), // Generic object, as params vary widely
});
export type LLMGeneratedArguments = z.infer<typeof LLMGeneratedArgumentsSchema>;

export const LLMPlanSchema = z.object({
    backendId: z.string(), // Corresponds to BackendConfig.id
    mcpMethod: z.string(),
    mcpParams: z.record(z.unknown()),
});
export type Plan = z.infer<typeof LLMPlanSchema>;
```

**4.2. Other Interfaces (`src/interfaces.ts`)**

```typescript
// src/interfaces.ts
import { MessageConnection } from 'vscode-jsonrpc/node';
import { ChildProcess } from 'child_process';
import { BackendConfig as ZodBackendConfig } from './schemas'; // Use Zod inferred type

// Re-export or use Zod types directly where appropriate
export type BackendConfig = ZodBackendConfig;

export interface BackendInstance {
    id: string;
    config: BackendConfig; // Use the Zod inferred type
    connection: MessageConnection;
    process?: ChildProcess;
    isReady: boolean;
    // statusMessage?: string;
}

export interface OpenAIFunctionParameters {
    type: "object";
    properties: {
        mcp_method: { type: "string"; description: string; };
        mcp_params: { type: "object"; description: string; };
    };
    required: ["mcp_method", "mcp_params"];
}

export interface OpenAIToolFunction {
    name: string;
    description: string;
    parameters: OpenAIFunctionParameters;
}

export interface OpenAITool {
    type: "function";
    function: OpenAIToolFunction;
}

// Plan type is now inferred from LLMPlanSchema in schemas.ts

// For Debug UI Logging
export interface LogEntry {
    timestamp: number;
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'TRACE' | 'FATAL'; // Match pino levels
    message: string;
    details?: any;
    // Pino specific fields if you pass raw pino objects:
    // pid?: number; hostname?: string; name?: string; etc.
}

// For Debug UI MCP Tracing
export interface McpTraceEntry {
    timestamp: number;
    direction: 'INCOMING_TO_GATEWAY' | 'OUTGOING_FROM_GATEWAY';
    backendId?: string;
    id?: string | number;
    method: string;
    paramsOrResult?: any; // Sanitized
    error?: any; // Sanitized
}
```

**5. Component Implementation Details**

**5.1. `logger.ts`**

*   Implement `initializeLogger(logLevel: pino.Level): pino.Logger` using `pino`.
*   Conditionally use `pino-pretty` for development (`process.env.NODE_ENV !== 'production'`).
*   Export `getLogger(): pino.Logger`.
*   (Optional Debug UI): For WebSocket streaming, either create a custom `pino` transport that pushes log objects (which are JSON) to WebSocket clients or adapt the previous `LogEntry` buffer/subscriber model to work with `pino`'s output format.

**5.2. `mcpTracer.ts` (Optional for Debug UI)**

*   Implement `traceMcpMessage`, `getRecentMcpTrace`, `subscribeToMcpTrace`.
*   Internal logging should use the main `pino` logger instance (e.g., `getLogger().debug(...)`).

**5.3. `backendManager.ts`**

*   `class BackendManager`
*   `constructor(private logger: pino.Logger)`
*   `private backendInstances: Map<string, BackendInstance> = new Map();`
*   `async initializeAllBackends(backendConfigs: BackendConfig[])`:
    *   Iterate `backendConfigs`. For each `BackendStdioConfig`:
        *   Log initialization start: `this.logger.info({ backendId: config.id, command: config.command, args: config.args }, "Initializing backend");`
        *   Spawn process: `spawn(config.command, config.args, { shell: (process.platform === 'win32'), env: { ...process.env, ...config.env }, stdio: 'pipe' })`.
        *   Pipe backend's `stdout` and `stderr` to child loggers: `backendProcess.stdout.on('data', data => this.logger.child({ backendId: config.id, stream: 'stdout' }).info(data.toString().trim()));` (similar for stderr with `logger.error`).
        *   Handle `process.on('error', ...)` and `process.on('exit', ...)`: log events, update `BackendInstance.isReady`.
        *   Create `MessageConnection` using a child pino logger for JSON-RPC traffic: `this.logger.child({ component: 'jsonrpc', backendId: config.id })`.
        *   `connection.listen()`. Store `BackendInstance` with `isReady=true`.
*   `async executeOnBackend(backendId: string, method: string, params: any): Promise<any>`:
    *   Find `BackendInstance`. If not found/ready, `this.logger.error(...)` and throw.
    *   `this.logger.debug({ backendId, method, params }, "Sending request to backend");`
    *   (Optional) `traceMcpMessage(...)`
    *   `const result = await backendInstance.connection.sendRequest(method, params);`
    *   `this.logger.debug({ backendId, method, result }, "Received response from backend");`
    *   (Optional) `traceMcpMessage(...)`
    *   Return `result`. Catch errors, log with `this.logger.error`, trace, re-throw.
*   `shutdownAllBackends()`: Dispose connections, kill processes, log actions.
*   `getBackendStates(): Array<Pick<BackendInstance, 'id' | 'isReady'> & { displayName?: string /* add more if needed */ }>`: For debug UI.

**5.4. `llmOrchestrator.ts`**

*   `class LLMOrchestratorService`
*   `private openai: OpenAI;`
*   `private availableToolsForLLM: OpenAITool[] = [];`
*   `constructor(apiKey: string, backendConfigs: BackendConfig[], private logger: pino.Logger)`: Initialize `openai`, call `generateOpenAITools(backendConfigs)`.
*   `private generateOpenAITools(backendConfigs: BackendConfig[])`:
    *   For PoC backends (`filesystem`, `mcpBrowserbase`):
        *   Manually craft `OpenAITool` objects. `function.name` must be `backendConfig.id`.
        *   `function.description`: Use detailed, manually crafted descriptions (provided below in section 7).
        *   `function.parameters`: The standard schema (properties: `mcp_method`, `mcp_params`).
    *   Add to `this.availableToolsForLLM`. Log with `this.logger.debug`.
*   `async orchestrate(query: string, context: OrchestrationContext | null | undefined): Promise<Plan | null>`:
    1.  `this.logger.info({ query, context }, "Orchestrating task");`
    2.  System prompt: "You are an expert AI assistant. Based on the user's query, provided context (such as `currentWorkingDirectory` or `activeDocumentURI`), and available tools, choose exactly one tool to call by specifying its `mcp_method` and `mcp_params`. Use the provided context to inform the parameters if applicable and relevant. If the query is ambiguous, cannot be handled by any tool, or if essential information is missing from the query or context for a tool to operate, you MUST NOT call any tool."
    3.  User message: `User query: "${query}"\n${context ? `Context: ${JSON.stringify(context)}` : ''}`.
    4.  OpenAI API call: `this.openai.chat.completions.create({ model: "gpt-4-turbo-preview", messages: [...], tools: this.availableToolsForLLM, tool_choice: "auto" });`
    5.  Log raw LLM request/response at `trace` or `debug` level.
    6.  Parse `response.choices[0].message.tool_calls`.
    7.  If one `tool_call` is present:
        *   `const toolCall = response.choices[0].message.tool_calls[0];`
        *   `const backendId = toolCall.function.name;`
        *   `const argsString = toolCall.function.arguments;`
        *   Attempt to parse `argsString` into JSON. If error, log and return `null`.
        *   `const parsedArgs = LLMGeneratedArgumentsSchema.safeParse(JSON.parse(argsString));`
        *   If `parsedArgs.success`:
            *   `const plan = { backendId, mcpMethod: parsedArgs.data.mcp_method, mcpParams: parsedArgs.data.mcp_params };`
            *   `LLMPlanSchema.parse(plan);` (Final validation of overall plan structure).
            *   `this.logger.info({ plan }, "LLM generated valid plan");`
            *   Return `plan`.
        *   Else: `this.logger.error({ error: parsedArgs.error.format(), argsString }, "LLM generated invalid arguments structure"); return null;`
    8.  Else: `this.logger.warn({ tool_calls: response.choices[0].message.tool_calls }, "LLM did not choose exactly one tool or chose no tool."); return null;`
    9.  Catch API errors, log with `this.logger.error`, return `null`.

**5.5. `server.ts` (Core Server Logic)**

*   Module should export a main function, e.g., `export async function startAgentifyServer(initialCliOptions?: Partial<GatewayOptions>)`.
*   Inside this function:
    *   Declare `logger!: pino.Logger;`, `gatewayOptions!: GatewayOptions;`, etc.
    *   Set up `connection = createMessageConnection(process.stdin, process.stdout);` (pass a temporary console logger initially).
    *   `connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult>)`:
        *   Merge `initialCliOptions` with `params.initializationOptions`.
        *   Validate merged options with `GatewayOptionsSchema.parse()`. If error, log and throw `ResponseError`. Store as `gatewayOptions`.
        *   Initialize `logger = initializeLogger(gatewayOptions.logLevel);`.
        *   Re-assign `connection.logger = logger.child({ component: 'jsonrpc-client-facing' });`.
        *   Log `gatewayOptions` (sanitized).
        *   Initialize `backendManager = new BackendManager(logger.child({ component: 'BackendManager' }));` and call `await backendManager.initializeAllBackends(gatewayOptions.backends);`.
        *   Initialize `llmOrchestrator = new LLMOrchestratorService(gatewayOptions.OPENAI_API_KEY, gatewayOptions.backends, logger.child({ component: 'LLMOrchestrator' }));`.
        *   (Optional) `if (gatewayOptions.DEBUG_PORT) { startDebugWebServer(gatewayOptions.DEBUG_PORT, logger, backendManager); }`
        *   Return `InitializeResult` (e.g., `{ capabilities: {}, serverInfo: { name: "mcp-agentify", version: "0.1.0" } }`).
    *   `connection.onRequest('agentify/orchestrateTask', async (requestParams: unknown, _token, rpcMessage: RequestMessage) => { ... })`:
        1.  Log incoming request with `logger.info` and (optionally) `traceMcpMessage`.
        2.  Validate `requestParams` using `AgentifyOrchestrateTaskParamsSchema.safeParse()`. If error, log with Zod error details and throw `ResponseError(ErrorCodes.InvalidParams, ...)`.
        3.  If `!llmOrchestrator || !backendManager`, throw `ResponseError(-32001, "Gateway not fully initialized")`.
        4.  `const plan = await llmOrchestrator.orchestrate(validatedParams.data.query, validatedParams.data.context);`
        5.  If `!plan`: Log and throw `ResponseError(-32000, "AI orchestrator could not determine an action for your query.", { query: validatedParams.data.query });`
        6.  `const result = await backendManager.executeOnBackend(plan.backendId, plan.mcpMethod, plan.mcpParams);`
        7.  Log success and result.
        8.  Return `result`.
        9.  Catch all errors: log, trace, and re-throw as `ResponseError` with plain text message and error data.
    *   Handle `onShutdown`, `onExit` (call `backendManager.shutdownAllBackends()`).
    *   `connection.listen();`
    *   `logger.info("mcp-agentify server logic started, listening for client connection via stdio.");`

**5.6. `cli.ts`**

```typescript
// src/cli.ts
import 'dotenv/config'; // Load .env file at the very top
import { startAgentifyServer } from './server'; // Assuming server.ts exports this
import { initializeLogger, getLogger } from './logger'; // For pre-server logging

// Initialize a basic logger early for CLI messages before full server init
const cliLogger = initializeLogger(process.env.LOG_LEVEL as pino.Level || 'info');

async function main() {
    cliLogger.info("Starting mcp-agentify CLI...");
    // No CLI options for PoC, server will get all config from 'initialize'
    await startAgentifyServer();
}

main().catch(error => {
    const logger = getLogger() || cliLogger; // Use initialized logger if available
    logger.fatal({ err: error }, "mcp-agentify CLI failed to start or encountered a fatal error.");
    process.exit(1);
});
```

**5.7. `debugWebServer.ts` (Optional)**
    *   Implement using `express` and `ws`.
    *   Accept `pino.Logger` and `BackendManager` instances.
    *   Endpoints: `/api/status`, `/api/backends` (from `BackendManager.getBackendStates()`), `/api/config` (sanitized `gatewayOptions`), `/api/logs`, `/api/mcptrace`.
    *   WebSockets `/ws/logs`, `/ws/mcptrace` (stream pino JSON log objects or `McpTraceEntry` objects).

**6. Configuration (`initializationOptions`) & `.env`**

*   **`.env` / `.env.example`:**
    ```env
    OPENAI_API_KEY=sk-YourActualOpenAIKey
    # BROWSERBASE_API_KEY=bb_api_... (if Browserbase takes key from env)
    # LOG_LEVEL=debug (optional, can also be set in initializationOptions)
    # DEBUG_PORT=3001 (optional for debug UI)
    ```
*   **`initializationOptions` Example (passed by Client IDE):**
    ```json
    {
      "logLevel": "debug",
      "OPENAI_API_KEY": "sk-PASSED_VIA_INIT_OPTIONS_IF_NOT_IN_ENV_OR_OVERRIDE",
      "DEBUG_PORT": 3001,
      "backends": [
        {
          "id": "filesystem",
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@modelcontextprotocol/server-filesystem", "/Users/Shared/TestPoCDir1", "/tmp/TestPoCDir2"]
        },
        {
          "id": "mcpBrowserbase",
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@smithery/cli@latest", "run", "@browserbasehq/mcp-browserbase", "--key", "bb_api_YOUR_KEY_FROM_USER_CONFIG"]
        }
      ]
    }
    ```
    *   **API Key Priority:** `process.env.OPENAI_API_KEY` > `initializationOptions.OPENAI_API_KEY`.

**7. PoC Backend Tool Descriptions (for `llmOrchestrator.ts`)**

*   **`filesystem` Tool:**
    *   `name`: `"filesystem"`
    *   `description`: "Handles local filesystem operations like reading/writing files, listing directories, creating/deleting within pre-configured accessible paths. Use context like `currentWorkingDirectory` or `activeDocumentURI` to resolve relative paths if a query implies it. Key methods: 'fs/readFile' (params: {path: string}), 'fs/writeFile' (params: {path: string, content: string}), 'fs/readdir' (params: {path: string}), 'fs/mkdir' (params: {path: string}), 'fs/rm' (params: {path: string, recursive?: boolean}). Paths should typically be absolute or be resolvable using provided context within the allowed mounted points."
*   **`mcpBrowserbase` Tool:**
    *   `name`: `"mcpBrowserbase"`
    *   `description`: "Controls a cloud browser (Browserbase) for web interactions. Can load URLs, take screenshots, extract text or HTML, and run JavaScript on pages. Useful for web scraping, fetching live web content, or simple web automation. Context can inform URLs or search queries. Key methods: 'browser/loadUrl' (params: {url: string}), 'browser/screenshot' (params: {sessionId?: string, format?: 'png'|'jpeg'}), 'browser/extractText' (params: {sessionId?: string}), 'browser/extractHtml' (params: {sessionId?: string}). A session is typically initiated by 'browser/loadUrl'."

**8. Error Handling**
    *   Utilize Zod for parsing `initializationOptions` and `agentify/orchestrateTask` parameters. Return `ErrorCodes.InvalidParams` with Zod error details on failure.
    *   LLM failures (no tool chosen, API error) result in a user-friendly JSON-RPC error from `agentify/orchestrateTask` (e.g., message: "AI orchestrator could not determine an action.").
    *   Errors from backend MCP calls are caught by the Gateway and re-thrown as JSON-RPC errors, including a plain text summary of the backend error.
    *   Log all errors comprehensively using `pino`.

**9. Testing Strategy (`vitest`)**
    *   **`vitest.config.ts`:** Configure for TypeScript.
    *   **Unit Tests (`tests/unit/`):** For `schemas.ts`, `llmOrchestrator.ts` (mocking `openai` API calls with `vi.fn()` or `vi.spyOn()`), `logger.ts`.
    *   **Integration Tests (`tests/integration/`):**
        *   Test `BackendManager` with mock `child_process.spawn` and mock `MessageConnection`.
        *   Test `server.ts`'s `startAgentifyServer` by creating a test MCP client. Mock `LLMOrchestratorService.orchestrate` to return predefined `Plan`s. Configure `backends` to use simple mock stdio MCP server scripts (e.g., an echo server). Verify correct calls to mock backends and propagation of results/errors.
    *   (Optional E2E tests): Minimal tests with live OpenAI API calls for simple queries.

**10. Development Workflow (`scripts/dev.sh`)**
```bash
#!/bin/bash
# scripts/dev.sh
echo "Starting mcp-agentify in development mode (via ts-node)..."
# Ensure OPENAI_API_KEY is set in .env or your shell environment
nodemon --watch src --ext ts,json --exec "NODE_ENV=development ts-node ./src/cli.ts"
```

**11. `package.json`**
    *   `name: "@your-scope/mcp-agentify"`
    *   `bin: { "mcp-agentify": "./dist/cli.js" }`, `main: "dist/cli.js"`
    *   `scripts`: `build`, `start`, `dev`, `lint`, `format`, `test`, `test:watch`.
    *   `dependencies`: `vscode-jsonrpc-node`, `openai`, `pino`, `zod`, `express` (opt), `ws` (opt), `dotenv`.
    *   `devDependencies`: `typescript`, `@types/node`, `ts-node`, `nodemon`, `pino-pretty`, `vitest`, `@types/express` (opt), `@types/ws` (opt), ESLint/Prettier deps.
    *   `files: ["dist/**/*", "README.md", "LICENSE"]`, `engines: { "node": ">=18.0.0" }`

---
