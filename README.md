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

`mcp-agentify` requires configuration for its operation, primarily the OpenAI API key and backend MCP server definitions. Configuration can be provided via a `.env` file (for environment variables) and/or through the `initializationOptions` during the MCP `initialize` handshake when an MCP client connects.

**Priority of Settings:**
1.  **Environment Variables (`.env` or shell):** Settings like `OPENAI_API_KEY`, `LOG_LEVEL`, and `DEBUG_PORT` read from the environment take the highest precedence and are used for pre-initialization tasks like starting the debug web server.
2.  **`initializationOptions` from Client:** Settings provided by the connecting MCP client (IDE) are merged. For `OPENAI_API_KEY`, `LOG_LEVEL`, and `DEBUG_PORT`, the environment variable values will still be used if present; client options serve as a fallback or can specify other settings like `backends`.
3.  **Default Values:** If a setting is not found in environment variables or client options, internal defaults are used (e.g., `logLevel` defaults to 'info').

### 1. Environment Variables (`.env` file)

For local development or when running the gateway directly, create a `.env` file in the project root. This is the **recommended way** to set `OPENAI_API_KEY`, `LOG_LEVEL`, and `DEBUG_PORT` for `mcp-agentify` itself, especially for enabling the Debug UI immediately on startup.

**Example `.env` file:**
```env
# Required for LLM orchestration. mcp-agentify will use this key.
OPENAI_API_KEY=sk-YourOpenAIKeyHereFromDotEnv

# Optional: Default log level for the gateway.
# Can be one of: trace, debug, info, warn, error, fatal, silent. Defaults to 'info'.
LOG_LEVEL=debug

# Optional: Port to enable the Debug Web UI.
# If set, the Debug UI will be accessible at http://localhost:YOUR_PORT immediately on start.
DEBUG_PORT=3030

# Optional: API key for a specific backend, if that backend expects its key from an env var.
# This would be configured in the backend's own `env` block within mcp-agentify's `backends` config (see below),
# OR set globally if the backend reads it from the main process environment.
# Example: BROWSERBASE_API_KEY_FOR_BACKEND_PROCESS=bb_api_YourBrowserbaseKeyHere
```
*   `OPENAI_API_KEY`: Essential for the LLM orchestrator. Sourced primarily from here.
*   `LOG_LEVEL`: Controls gateway log verbosity. Sourced primarily from here.
*   `DEBUG_PORT`: Enables and sets the port for the Debug Web UI, starting it immediately. Sourced primarily from here.

### 2. MCP `initialize` Request (`initializationOptions`)

The client IDE (e.g., Cursor, Windsurf) provides dynamic configuration through the `initializationOptions` parameter of the MCP `initialize` request. This is primarily used for defining `backends`.

**Note on `OPENAI_API_KEY`, `LOG_LEVEL`, `DEBUG_PORT` in `initializationOptions`:**
While `mcp-agentify` *can* technically accept these in `initializationOptions` (as a fallback if not set in the environment), the recommended approach for configuring `mcp-agentify`'s own API key, log level, and debug port is via environment variables (e.g., using a `.env` file or an `env` block in your IDE's MCP server definition for `mcp-agentify`, which sets environment variables for the spawned process). This ensures the debug server can start immediately.

**Example `initializationOptions` focusing on `backends` (client-provided):**
```json
{
  // Recommended: Set logLevel, OPENAI_API_KEY, DEBUG_PORT via mcp-agentify's environment
  // "logLevel": "trace", // Can be set here, but env var takes precedence
  // "OPENAI_API_KEY": "sk-ClientProvidedKeyAsFallback", // Can be set here, but env var takes precedence
  // "DEBUG_PORT": 3001, // Can be set here, but env var takes precedence for early start

  "backends": [
    {
      "id": "filesystem",
      "displayName": "Local Filesystem Access",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/Shared/Projects", // Example: Map a host directory
        "/tmp/agentify-work"     // Example: Another mapped directory
      ],
      "env": { // Environment variables specifically for THIS backend process
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
        "--key", "bb_api_YOUR_KEY_AS_ARG" // Browserbase key passed as command arg
      ],
      "env": { // Alternatively, if Browserbase MCP took key from env for its process:
        // "BROWSERBASE_API_KEY": "bb_api_YOUR_KEY_FOR_BACKEND_ENV"
      }
    }
  ]
}
```
**Key fields in `initializationOptions`:**
*   `backends` (required, array): Defines the backend MCP servers.
    *   `id`: Unique identifier (e.g., "filesystem", "mcpBrowserbase").
    *   `displayName` (optional): Human-readable name.
    *   `type`: `\"stdio\"`.
    *   `command`: Command to start the backend.
    *   `args` (optional): Arguments for the command.
    *   `env` (optional): Environment variables *for the spawned backend process*.

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

### Configuring `initializationOptions` and Environment in Your IDE

When setting up `mcp-agentify` in your IDE (e.g., Cursor, Windsurf, Claude Desktop), you'll typically configure:
1.  The command to start `mcp-agentify` (e.g., `bash /path/to/mcp-agentify/scripts/dev.sh`).
2.  **Environment variables** for the `mcp-agentify` process itself. This is where you should set `OPENAI_API_KEY`, `LOG_LEVEL`, and `DEBUG_PORT`. Most IDEs provide a way to set environment variables for an MCP server.
3.  The `initializationOptions` JSON object, primarily for the `backends` array.

**Example IDE Configuration Structure (Conceptual - syntax varies by IDE):**

Imagine your IDE's MCP server configuration for `mcp-agentify` looks something like this:

```json
// In your IDE's MCP Server configuration file (e.g., claude_desktop_config.json snippet)
{
  "mcp-agentify-dev-local": {
    "name": "mcp-agentify (Dev)",
    "type": "stdio",
    "command": "/full/path/to/your/mcp-agentify/scripts/dev.sh",
    "workingDirectory": "/full/path/to/your/mcp-agentify",
    "env": { // Environment variables for mcp-agentify process
      "OPENAI_API_KEY": "sk-YourOpenAIKeyFromIDESettings",
      "LOG_LEVEL": "trace",
      "DEBUG_PORT": "3030" // Ensure this is a string if your IDE sets env vars as strings
    },
    "initializationOptions": {
      // `backends` array is the main content here
      "backends": [
        {
          "id": "filesystem",
          "displayName": "Local Filesystem via Agentify",
          "type": "stdio",
          "command": "npx",
          "args": [
            "-y",
            "@modelcontextprotocol/server-filesystem",
            "${workspaceFolder}",
            "/tmp/agentify_shared_from_ide"
          ],
          "env": {
            "FILESYSTEM_LOG_LEVEL": "info"
          }
        },
        {
          "id": "mcpBrowserbase",
          "displayName": "Web Browser via Agentify (Browserbase)",
          "type": "stdio",
          "command": "npx",
          "args": [
            "-y",
            "@smithery/cli@latest",
            "run",
            "@browserbasehq/mcp-browserbase",
            // Example: Key passed as command-line argument to the backend
            "--key", "bb_api_YOUR_BROWSERBASE_KEY_FROM_IDE_CONFIG"
          ]
          // If Browserbase backend needed its key from *its own environment*, you'd use:
          // "env": { "BROWSERBASE_API_KEY": "bb_api_YOUR_KEY" }
        }
        // Add other backend configurations here
      ]
      // It's fine to also have these as fallbacks in initializationOptions,
      // but mcp-agentify will prioritize the values from its own environment.
      // "logLevel": "debug", 
      // "DEBUG_PORT": 3001, 
      // "OPENAI_API_KEY": "sk-FallbackKey" 
    }
  }
}
```

**Key Points for IDE Configuration:**
*   **Prioritize `env` block for `mcp-agentify`'s core settings:** Use your IDE's mechanism to set `OPENAI_API_KEY`, `LOG_LEVEL`, and `DEBUG_PORT` as environment variables for the `mcp-agentify` process. This ensures the debug UI starts immediately and logging is configured early.
*   **Use `initializationOptions` for `backends`:** This is the primary place to define the list of backend services `mcp-agentify` will manage.
*   Placeholders like `${workspaceFolder}` are often supported by IDEs.
*   Manage API keys securely.

## Debug Web UI

`mcp-agentify` includes an optional Debug Web UI for observing operations, logs, and traces.

### Enabling the Debug UI

Set the `DEBUG_PORT` environment variable for the `mcp-agentify` process (e.g., in your `.env` file or IDE's server configuration `env` block):
```env
DEBUG_PORT=3030 # Or your desired port
```
The Debug UI will start immediately when `mcp-agentify` launches.

If `DEBUG_PORT` is not set via an environment variable, it can alternatively be provided by a client in `initializationOptions`, but in this case, the debug server will only start *after* the MCP `initialize` handshake completes. **Using the environment variable is recommended for earlier access during development.**

### Accessing the Debug UI

Once `mcp-agentify` is running and the Debug UI is enabled (e.g., `DEBUG_PORT=3030`), open your web browser to:
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
