**Product Requirements Document: `mcp-agentify`**
*AI-Powered MCP Gateway for Tool Orchestration*

**1. Introduction**

**1.1. Purpose**
This document outlines the product requirements for `mcp-agentify`, a Node.js-based application that functions as an intelligent gateway and orchestrator for backend MCP (Model Context Protocol) servers. `mcp-agentify` enables a client application (e.g., an IDE agent in Cursor) to interact with a multitude of specialized MCP tools through a unified, natural language-driven interface. It "agentifies" these tools by using a Large Language Model (LLM) to interpret user intent and dispatch tasks to the appropriate backend.

**1.2. Scope (Proof of Concept - Phase 1)**
The initial version (PoC) of `mcp-agentify` will demonstrate its core capabilities:
    *   Acting as an MCP server itself.
    *   Dynamically launching and managing connections to a configurable set of backend MCP servers (initially targeting `@modelcontextprotocol/server-filesystem` and `@browserbasehq/mcp-browserbase`).
    *   Utilizing OpenAI's GPT-4.x API (Tool Calling feature) to understand natural language queries, select the appropriate backend MCP tool, and formulate the specific MCP call for that tool.
    *   Proxying the call and returning the result/error.
    *   Being configurable via `initializationOptions` passed by the client IDE.

**1.3. Target Users (of `mcp-agentify`)**
    *   **Primary:** Developers building AI agents or IDE extensions (e.g., for environments like Cursor) who need to integrate multiple MCP-compliant tools without wanting their agent to manage each tool connection and decision logic individually.
    *   **Secondary:** Developers of `mcp-agentify` itself, requiring robust internal logging and debugging capabilities.

**1.4. Goals**
    *   **G1: Unified MCP Endpoint:** Provide a single MCP server endpoint that client applications can connect to, abstracting away the complexity of multiple underlying MCP tools.
    *   **G2: Intelligent Task Orchestration:** Leverage a powerful LLM to interpret natural language queries and route them to the most suitable configured backend MCP tool.
    *   **G3: Dynamic Backend Management:** Allow flexible configuration of backend MCP tools (their launch commands, arguments, and necessary API keys/environment variables) via `initializationOptions`.
    *   **G4: Simplified Client Logic:** Reduce the burden on client applications (IDE agents) by centralizing the tool selection and MCP call formulation logic within `mcp-agentify`.
    *   **G5: Extensibility:** Create a foundation that can be easily extended to support more backend MCP tools and more complex orchestration patterns in the future.
    *   **G6: Developer-Friendly PoC:** Ensure the PoC is well-structured, testable, and includes good local development support.

**1.5. Non-Goals (for PoC - Phase 1)**
    *   Support for backend MCP servers communicating over protocols other than `stdio`.
    *   Complex multi-step, multi-tool chained execution planned by the LLM (PoC focuses on single tool selection per query).
    *   User-configurable LLM models or providers (hardcoded to OpenAI GPT-4.x for PoC).
    *   Persistent state management across multiple `agentify/orchestrateTask` calls.
    *   Dynamic generation of tool descriptions for the LLM by introspecting backend capabilities (descriptions will be manually defined within `mcp-agentify` for PoC).

**2. Functional Requirements**

**FR1: Core MCP Gateway Functionality**
    *   **FR1.1: Act as MCP Server:** `mcp-agentify` MUST implement an MCP server communicating via `stdio`.
    *   **FR1.2: Initialization:**
        *   MUST handle the standard MCP `initialize` request.
        *   MUST accept `initializationOptions` containing `GatewayOptions` (defined in technical spec: `OPENAI_API_KEY`, `backends` array, `logLevel`, `DEBUG_PORT`).
        *   MUST validate `GatewayOptions` using a Zod schema.
        *   MUST use the provided configuration to initialize backend MCP server connections and the LLM orchestration service.
        *   MUST respond with standard `InitializeResult` including its server info (name: "mcp-agentify", version).
    *   **FR1.3: Orchestration Endpoint:**
        *   MUST expose a primary MCP request method: `agentify/orchestrateTask`.
        *   This method MUST accept parameters: `query` (string) and `context` (object, optional, containing fields like `activeDocumentURI`, `currentWorkingDirectory`, `selectionText`).
        *   Parameters for `agentify/orchestrateTask` MUST be validated using a Zod schema.
    *   **FR1.4: Shutdown/Exit:** MUST gracefully handle MCP `shutdown` and `exit` notifications by terminating backend processes and exiting.

**FR2: Backend MCP Server Management**
    *   **FR2.1: Dynamic Launch:** Based on the `backends` array in `GatewayOptions`, `mcp-agentify` MUST launch each configured `stdio`-based backend MCP server as a child process.
        *   It MUST use the specified `command` and `args`.
        *   It MUST pass environment variables from the `env` field of the backend's config, merged with its own environment.
    *   **FR2.2: Connection Establishment:** MUST establish a `vscode-jsonrpc/node` `MessageConnection` to each successfully launched backend server via its `stdio`.
    *   **FR2.3: Lifecycle Management:**
        *   MUST monitor backend processes for errors or unexpected exits.
        *   MUST log such events.
        *   (PoC does not require automatic restart logic).
    *   **FR2.4: Connection Proxying:** MUST provide an internal mechanism to send MCP requests to a specific backend (identified by its `id`) and receive its response.

**FR3: LLM-Powered Orchestration**
    *   **FR3.1: LLM Integration:** MUST integrate with OpenAI's GPT-4.x API using the official `openai` Node.js library.
    *   **FR3.2: Tool Definition:**
        *   For the PoC, `mcp-agentify` WILL contain manually crafted OpenAI Tool Calling definitions for the initial set of backend tools (`@modelcontextprotocol/server-filesystem` and `@browserbasehq/mcp-browserbase`).
        *   Each tool definition MUST include:
            *   `name`: Matching the `id` of the `BackendConfig`.
            *   `description`: A concise summary of the backend's capabilities and typical use cases (see technical spec for examples).
            *   `parameters`: A JSON schema defining two required arguments: `mcp_method` (string) and `mcp_params` (object).
    *   **FR3.3: Task Planning:**
        *   Upon receiving an `agentify/orchestrateTask` request, `mcp-agentify` MUST construct a prompt for the LLM. The prompt will include the user's `query`, `context`, and the predefined list of available tools.
        *   It MUST instruct the LLM to choose exactly one tool and provide the `mcp_method` and `mcp_params` for it.
        *   It MUST make a "Tool Calling" request to the OpenAI API.
    *   **FR3.4: Plan Execution:**
        *   `mcp-agentify` MUST parse the LLM's response.
        *   If the LLM successfully returns a single tool call with valid `mcp_method` and `mcp_params` (validated by a Zod schema like `LLMPlanSchema`), it MUST execute this call on the designated backend MCP server via the `BackendManager`.
        *   The result from the backend server MUST be returned as the result of the `agentify/orchestrateTask` request.

**FR4: Configuration and Security**
    *   **FR4.1: API Key Management:** The `OPENAI_API_KEY` MUST be configurable, primarily via an environment variable (`process.env.OPENAI_API_KEY`) loaded by `dotenv`, with a fallback to `initializationOptions`. API keys for backend tools (e.g., Browserbase) MUST be configurable within their respective `BackendConfig` blocks (either as `args` or in `env`).
    *   **FR4.2: Filesystem Path Restriction (for `server-filesystem`):** The configuration for the filesystem backend MUST allow specification of accessible root paths to limit its scope.

**FR5: Error Handling and Logging**
    *   **FR5.1: Structured Logging:** `mcp-agentify` MUST use `pino` for structured JSON logging. Log levels (trace, debug, info, warn, error, fatal) MUST be configurable.
    *   **FR5.2: LLM Error Reporting:** If the LLM fails to select a tool, returns an invalid plan, or an OpenAI API error occurs, `mcp-agentify` MUST return a user-friendly, plain-text error message within a JSON-RPC `ResponseError` to the client IDE (e.g., "AI orchestrator could not determine an action.").
    *   **FR5.3: Backend Error Propagation:** If a backend MCP server returns an error, `mcp-agentify` MUST propagate this as a JSON-RPC `ResponseError` to the client IDE, including a plain-text summary of the backend's error.
    *   **FR5.4: Validation Errors:** Zod schema validation failures for `initializationOptions` or `agentify/orchestrateTask` parameters MUST result in appropriate `ErrorCodes.InvalidParams` JSON-RPC errors.

**FR6: Development and Debugging Support**
    *   **FR6.1: Local Development Script:** A `scripts/dev.sh` script MUST be provided to easily start `mcp-agentify` locally using `ts-node` and `nodemon` for development.
    *   **FR6.2: Optional Debug Web Interface:**
        *   If configured (via `DEBUG_PORT` in `GatewayOptions`), `mcp-agentify` SHOULD start a local HTTP server.
        *   This server SHOULD provide endpoints for:
            *   Status of `mcp-agentify` and connected backends.
            *   Viewing (sanitized) current configuration.
            *   Viewing recent logs (streamed via WebSockets or paginated HTTP).
            *   (Optional) Viewing a trace of MCP messages (streamed via WebSockets).

**FR7: Packaging and Distribution**
    *   **FR7.1: NPM Package:** `mcp-agentify` MUST be packageable as an NPM module.
    *   **FR7.2: `npx` Executable:** The NPM package MUST define a binary in `package.json` (e.g., named `mcp-agentify`) so it can be run via `npx @your-scope/mcp-agentify`.

**3. Non-Functional Requirements**

*   **NFR1: Performance (PoC Focus):** While not a primary focus for the PoC, the overhead introduced by `mcp-agentify` (excluding LLM call latency) should be minimal. LLM call latency is acknowledged.
*   **NFR2: Reliability (PoC Focus):** The PoC should be stable enough for demonstration and testing of core user stories. Robust handling of backend process failures is desirable but full auto-recovery is out of scope for PoC.
*   **NFR3: Testability:** The codebase MUST be structured to facilitate unit and integration testing using `vitest`. Key components like LLM interaction and backend management should be mockable.
*   **NFR4: Code Quality:** Code MUST be written in TypeScript, well-formatted (using Prettier), and linted (using ESLint) according to configured project standards.

**4. Success Metrics (for PoC)**

*   **SM1: Core Orchestration Flow:** `mcp-agentify` successfully receives an `agentify/orchestrateTask` request, queries the LLM, receives a valid plan for either the Filesystem or Browserbase tool, executes the call on the correct backend, and returns a result/error to a test MCP client. This should be demonstrable for at least two distinct natural language queries per target backend.
*   **SM2: Dynamic Backend Configuration:** `mcp-agentify` correctly launches and connects to backend MCP servers as defined in `initializationOptions`, including passing necessary arguments/env vars (e.g., Browserbase API key, Filesystem paths).
*   **SM3: Error Handling:** Demonstrable user-friendly error reporting for (a) LLM failing to provide a plan, and (b) a backend tool returning an error.
*   **SM4: Local Development Viability:** The `scripts/dev.sh` script allows a developer to run `mcp-agentify` locally and test it with a simple MCP client script.
*   **SM5: Basic Test Coverage:** Key modules (LLM orchestration, schema validation) have unit tests, and there's at least one integration test demonstrating the end-to-end flow with mocked LLM and mock backends.

**5. Future Considerations (Post-PoC)**
*   Support for more backend tools and socket-based backends.
*   Dynamic generation of LLM tool descriptions via backend capabilities introspection (e.g., `mcp/getCapabilities`).
*   LLM-planned multi-step, multi-tool task execution.
*   More sophisticated context management, conversation history, and state persistence.
*   User-configurable LLM models/providers.

---