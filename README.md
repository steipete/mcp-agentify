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
- **Optional Debug UI:** For observing logs, traces, and status.

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

`mcp-agentify` is configured through a combination of environment variables (often set via a `.env` file for local development or an `env` block in an IDE's server configuration) and `initializationOptions` provided by the connecting MCP client during the `initialize` handshake.

**Priority of Core Settings (for `mcp-agentify` itself):**
1.  **Environment Variables:** `OPENAI_API_KEY`, `LOG_LEVEL`, `DEBUG_PORT` set in `mcp-agentify`'s own execution environment (e.g., from `.env` or IDE's `env` block for the server process) take highest precedence. This allows the Debug Web Server to start immediately.
2.  **`initializationOptions` from Client:** These same keys can be provided by the client as fallbacks if not set in the environment.
3.  **Internal Defaults:** (e.g., `logLevel` defaults to 'info').

### 1. Environment Variables (`.env` file or IDE `env` block)

This is the **recommended way** to set `OPENAI_API_KEY`, `LOG_LEVEL`, and `DEBUG_PORT` for `mcp-agentify`'s own operation.

**Example `.env` file (for local `scripts/dev.sh` or `npm run dev`):**
```env
OPENAI_API_KEY=sk-YourOpenAIKeyHereFromDotEnv
LOG_LEVEL=debug
DEBUG_PORT=3030

# Optional: Define dynamic agents. Comma-separated list of "Vendor/ModelName".
# Example: AGENTS="OpenAI/gpt-4.1,OpenAI/o3,Anthropic/claude-3-opus"
# This will expose MCP methods like: agentify/agent_OpenAI_gpt_4_1, agentify/agent_OpenAI_o3, etc.
AGENTS="OpenAI/gpt-4.1,OpenAI/o3"
```

When configuring `mcp-agentify` in an IDE, you'll typically have a way to specify environment variables for the server process. This is where these should go.

### 2. MCP `initialize` Request (`initializationOptions`)

The connecting client (IDE) sends `initializationOptions`. This is **primarily used to define the `backends`** that `mcp-agentify` will orchestrate.

**Example `initializationOptions` (JSON sent by client):**
```json
{
  "logLevel": "trace",
  "OPENAI_API_KEY": "sk-ClientProvidedKeyAsFallbackIfEnvNotSet",
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
        "/Users/Shared/Projects",
        "/tmp/agentify-work"
      ],
      "env": {
        "FILESYSTEM_LOG_LEVEL": "debug"
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
        "--key", "bb_api_YOUR_KEY_AS_ARG_FOR_BROWSERBASE"
      ]
    }
  ]
}
```
**Key fields in `initializationOptions`:**
*   `logLevel`, `OPENAI_API_KEY`, `DEBUG_PORT` (optional fallbacks): As mentioned, `mcp-agentify` prioritizes its own environment variables for these.
*   `backends` (required, array): Defines the backend MCP servers.
    *   `id`: Unique identifier (e.g., "filesystem").
    *   `displayName` (optional): Human-readable name.
    *   `type`: Must be `"stdio"`.
    *   `command`: Command to start the backend.
    *   `args` (optional): Arguments for the command.
    *   `env` (optional): Environment variables specifically for *this spawned backend process*.

## How to Run & Configure with an MCP Client (IDE)

Your IDE (e.g., Cursor, Windsurf, Claude Desktop) will launch `mcp-agentify`.

### Configuring Your IDE

You need to tell your IDE:
1.  **How to start `mcp-agentify`**: This is typically the `command` and `args` (if any), and the `workingDirectory`. For local development, this often points to `bash scripts/dev.sh` or `npm run dev`.
2.  **Environment Variables for `mcp-agentify`**: Set `OPENAI_API_KEY`, `LOG_LEVEL`, `DEBUG_PORT` here.
3.  **`initializationOptions`**: Provide the JSON for `backends` and any fallback settings.

**Conceptual IDE Configuration Example (e.g., for a `claude_desktop_config.json`-like file):**
```json
{
  "mcpServers": [
    {
      "mcp-agentify": {
        "type": "stdio",
        "command": "/Users/steipete/Projects/mcp-agentify/scripts/dev.sh",
        "env": {
          "logLevel": "trace",
          "DEBUG_PORT": 3030,
          "OPENAI_API_KEY": "sk-YourOpenAIKeyFromIDESettingsPlaceholder"
        },
        "initializationOptions": {
          "backends": [
            {
              "id": "filesystem",
              "displayName": "Local Filesystem (Agentify)",
              "type": "stdio",
              "command": "npx",
              "args": [
                "-y",
                "@modelcontextprotocol/server-filesystem",
                "${workspaceFolder}"
              ]
            },
            {
              "id": "mcpBrowserbase",
              "displayName": "Web Browser (Browserbase via Agentify)",
              "type": "stdio",
              "command": "npx",
              "args": [
                "-y",
                "@smithery/cli@latest",
                "run",
                "@browserbasehq/mcp-browserbase",
                "--key",
                "YOUR_BROWSERBASE_KEY_IF_NEEDED"
              ]
            }
          ]
        }
      }
    }
    // ... other MCP server configurations ...
  ]
}
```
**Key Points for IDE Configuration:**
*   The IDE's `env` block for the `mcp-agentify` server is crucial for setting its core operational parameters like `OPENAI_API_KEY`, `logLevel`, and `DEBUG_PORT` (for immediate debug UI).
*   `initializationOptions` is mainly for defining the `backends` array.
*   Use placeholders like `${workspaceFolder}` if your IDE supports them.

**Local Development Startup Methods (referenced by IDE `command`):**

*   **`bash scripts/dev.sh`**:
    *   Recommended for IDEs.
    *   Uses `nodemon` and `ts-node`.
    *   Picks up `.env` from `mcp-agentify` project root for `OPENAI_API_KEY`, `LOG_LEVEL`, `DEBUG_PORT`.
    *   The IDE's `env` block settings (see example above) would override these if the IDE sets environment variables when launching the script.
*   **`npm run dev`**:
    *   Similar to `bash scripts/dev.sh`.
    *   Also uses `nodemon` and `ts-node`.
*   **`node dist/cli.js`** (after `npm run build`):
    *   Runs compiled code.
    *   Also respects `.env` and environment variables set by the IDE.

## Debug Web UI

`mcp-agentify` includes an optional Debug Web UI.

### Enabling the Debug UI

Set the `DEBUG_PORT` environment variable for `mcp-agentify`. This is best done via:
1.  A `.env` file in the `mcp-agentify` project root when running locally:
    ```env
    DEBUG_PORT=3030
    ```
2.  The `env` block in your IDE's server configuration for `mcp-agentify`.

The Debug UI will start immediately when `mcp-agentify` launches if `DEBUG_PORT` is set in its environment. If provided only as a fallback in `initializationOptions` by a client, it will start after the MCP handshake.

### Accessing the Debug UI

Once `mcp-agentify` is running and the Debug UI is enabled (e.g., `DEBUG_PORT=3030` in its environment), open:
`http://localhost:3030`

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

## Local Install and Global Usage (Advanced)

While `npm run dev` is great for active development and `npx mcp-agentify` (once published) is convenient for project-local use, you might want to install `mcp-agentify` globally from your local clone for broader testing or to simulate how a published global package would behave.

### 1. Global Install from Local Clone

After cloning the repository and ensuring all dependencies are installed (`npm install`):

1.  **Navigate to the project root directory:**
    ```bash
    cd path/to/mcp-agentify
    ```
2.  **Build the project (if you want to install the compiled version):**
    ```bash
    npm run build
    ```
3.  **Install globally:**
    To install the current local version globally, use:
    ```bash
    npm install -g .
    ```
    This command links the current directory (`.`) as a global package. If you've run `npm run build`, it will typically link the compiled version based on your `package.json`'s `bin` and `files` fields.

4.  **Run the globally installed command:**
    Now you should be able to run `mcp-agentify` from any directory:
    ```bash
    mcp-agentify
    ```
    The gateway will start and listen on `stdio`.

5.  **Uninstalling:**
    To remove the global link, you'll typically use the package name defined in `package.json`:
    ```bash
    npm uninstall -g @your-scope/mcp-agentify # Replace with actual package name
    ```
    If you used a different name or if it was just a link, `npm unlink .` from the project directory might also be needed, or check `npm list -g --depth=0` to find the linked package name.

### 2. Using `npm link` (Recommended for Development)

`npm link` is a more development-friendly way to create a global-like symlink to your local project. This means changes you make to your local code (even without rebuilding, if you run the linked version via `ts-node` or if your IDE points to the source) can be reflected immediately when you run the global command.

1.  **Navigate to the project root directory:**
    ```bash
    cd path/to/mcp-agentify
    ```
2.  **Create the link:**
    ```bash
    npm link
    ```
    This creates a global symlink named after your package name (e.g., `mcp-agentify` or `@your-scope/mcp-agentify`) that points to your current project directory.

3.  **Run the linked command:**
    You can now run `mcp-agentify` (or your package name) from any terminal:
    ```bash
    mcp-agentify
    ```
    If your `package.json` `bin` points to `dist/cli.js`, you'll need to run `npm run build` for changes to `src` to be reflected in the linked command. If your `bin` could somehow point to a `ts-node` invoker for `src/cli.ts` (more advanced setup), then changes might be live.

4.  **Unlinking:**
    To remove the symlink:
    ```bash
    npm unlink --no-save @your-scope/mcp-agentify # Replace with actual package name
    # or from the project directory:
    # npm unlink
    ```

**Note on `.env` with Global Installs:**
When running a globally installed or linked `mcp-agentify`, it will look for a `.env` file in the *current working directory* from where you run the command, not necessarily from the `mcp-agentify` project's original root. For consistent behavior, especially with API keys, ensure your `.env` file is in the directory where you execute the `mcp-agentify` command, or configure these settings via `initializationOptions` from your client tool.

## Development

1.  Clone the repository: `git clone https://github.com/steipete/mcp-agentify.git`
2.  Navigate to the project directory: `cd mcp-agentify`
3.  Install dependencies: `npm install`
4.  Create a `.env` file in the project root (copy from `.env.example`) and add your `OPENAI_API_KEY`.
    ```env
    OPENAI_API_KEY=your_openai_api_key_here
    LOG_LEVEL=debug
    DEBUG_PORT=3030
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

### Dynamic Agent Methods via `AGENTS` Environment Variable

`mcp-agentify` can expose direct agent interaction methods on the fly based on the `AGENTS` environment variable. This is useful for quickly testing different models or providing direct access to specific LLM configurations without defining them as full backend tools.

-   Set the `AGENTS` environment variable as a comma-separated string of `"Vendor/ModelName"` pairs.
    -   **Format:** `AGENTS="Vendor1/ModelNameA,Vendor2/ModelNameB"`
    -   **Example:** `AGENTS="OpenAI/gpt-4.1,OpenAI/o3"`
    -   **Note on "OpenAI" vendor:** The vendor name "OpenAI" is treated case-insensitively and will be standardized to lowercase `openai` (e.g., "OPENAI/gpt-4.1" becomes "openai/gpt-4.1"). Other vendor names are case-sensitive.
    -   (Ensure the model names are valid for the specified vendor, e.g., as per OpenAI API documentation for `gpt-4.1`, `o3`, etc.)
-   For each entry, `mcp-agentify` will register an MCP method:
    -   The `Vendor/ModelName` string is sanitized (non-alphanumerics, including `/`, become `_`).
    -   The method will be named `agentify/agent_<sanitized_Vendor_ModelName>`.
    -   **Example:** `AGENTS="OpenAI/gpt-4.1"` creates `agentify/agent_OpenAI_gpt_4_1`.
-   These methods currently accept a `{ query: string, context?: OrchestrationContext }` payload and return a placeholder response.
    Full LLM interaction logic for these dynamic agents will be implemented in the future.
