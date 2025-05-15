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
  "OPENAI_API_KEY": "sk-ClientProvidedKeyIfNeededAsFallback",
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
        "--key", "bb_api_YOUR_KEY_FROM_USER_CONFIG"
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

**Example `initializationOptions` (for IDE settings):**

```json
{
  "logLevel": "debug",
  "OPENAI_API_KEY": "sk-YourOpenAIKeyFromASecureSource",
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
        "${workspaceFolder}",
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
        "--key", "bb_api_YOUR_BROWSERBASE_KEY"
      ]
    }
  ]
}
```

**Explanation for IDE Users:**

## How to Run & Configure with an MCP Client (IDE)

This section details how to run `mcp-agentify` and configure your MCP client (like Cursor or Windsurf) to use it. There are several ways to run `mcp-agentify` depending on your needs:

### Method 1: Development Mode using `npm run dev` (Recommended for Active Development)

This is the standard way to run `mcp-agentify` while actively developing its features. It uses `nodemon` for hot-reloading and `ts-node` to execute TypeScript source directly.

1.  **Prerequisites:** Node.js, npm/yarn, Git.
2.  **Clone & Setup:**
    ```bash
    git clone https://github.com/steipete/mcp-agentify.git
    cd mcp-agentify
    npm install
    cp .env.example .env # Edit .env with your OPENAI_API_KEY, etc.
    ```
3.  **Run:**
    ```bash
    npm run dev
    ```
    The gateway starts and listens on `stdio`. Your IDE (MCP Client) should be configured to launch `mcp-agentify` using a command that effectively does this, or by directly executing this if the IDE manages the server lifecycle externally and just needs to connect.

    *To configure your IDE to use this `npm run dev` instance, you would typically point the IDE's MCP server command to `npm` with arguments `run dev` and set the working directory to the `mcp-agentify` project root.*

### Method 2: Running the Compiled Version (Simulating Production)

After building the project, you can run the compiled JavaScript. This is useful for testing the production build or if you prefer not to use `ts-node`.

1.  **Build:** `npm run build`
2.  **Run:** `node dist/cli.js`

    *Your IDE would be configured to run `node /path/to/mcp-agentify/dist/cli.js`.*

### Method 3: Using a Globally Installed or Linked Version

This method is useful if you've installed `mcp-agentify` globally (e.g., via `npm install -g .` from the cloned repo, or `npm install -g @your-scope/mcp-agentify` once published) or linked it using `npm link`. See the "Local Install and Global Usage (Advanced)" section for details on these steps.

    *Your IDE would be configured to run the command `mcp-agentify` (assuming it's in your PATH) or `npx @your-scope/mcp-agentify` (for the future published package).*

### Method 4: Direct Script Execution via `scripts/dev.sh` (Advanced IDE Integration)

This method is for developers who want to integrate their local, source-code version of `mcp-agentify` directly with an IDE for deep testing, using the `scripts/dev.sh` shell script as the entry point.

1.  **Clone, Install Dependencies, Make Executable:** (As per "Development Mode" steps 1-3, plus `chmod +x scripts/dev.sh`)
2.  **IDE Configuration:** Your IDE's MCP server configuration would point its `command` directly to the absolute path of this `scripts/dev.sh` script.

    *Example `command` for IDE: `["/absolute/path/to/your/mcp-agentify/scripts/dev.sh"]`*

### Configuring `initializationOptions` in Your IDE

Regardless of which method above your IDE uses to *start* `mcp-agentify`, it will need to send `initializationOptions` during the MCP `initialize` handshake. You typically provide these options as a JSON object in your IDE's settings for the `mcp-agentify` server.

**Example `initializationOptions` (JSON for IDE settings):**

```json
{
  "logLevel": "trace",
  "OPENAI_API_KEY": "sk-YourOpenAIKeyFromSecureStorageOrEnv",
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
        "${workspaceFolder}", 
        "/tmp/agentify_shared"
      ],
      "env": { 
        "FILESYSTEM_LOG_LEVEL": "debug" 
      }
    },
    {
      "id": "mcpBrowserbase",
      "displayName": "Web Browser (Browserbase)",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y", 
        "@smithery/cli@latest", 
        "run", 
        "@browserbasehq/mcp-browserbase", 
        "--key", "bb_api_YOUR_BROWSERBASE_KEY" 
      ]
    }
  ]
}
```

**Key Points for IDE Configuration:**
*   Refer to your specific IDE's documentation on how to configure an MCP language/tool server and where to provide the startup command and `initializationOptions`.
*   Use placeholders like `${workspaceFolder}` if your IDE supports them; they will be substituted with actual paths.
*   Manage API keys securely. If `OPENAI_API_KEY` is in `mcp-agentify`'s `.env` file, it takes precedence over the one in `initializationOptions`.

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
