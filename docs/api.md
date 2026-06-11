# MCP API

`mcp-agentify` is an MCP server over stdio. It uses standard MCP initialization, tool discovery, and tool calls through `@modelcontextprotocol/sdk`.

## `orchestrate_task`

Routes a natural-language request to exactly one tool discovered from the configured backend MCP servers.

Input:

```json
{
  "query": "List the files in /tmp/example",
  "context": {
    "activeDocumentURI": "file:///tmp/example/README.md",
    "currentWorkingDirectory": "/tmp/example",
    "selectionText": "optional selected text"
  }
}
```

`query` is required. Every `context` field is optional.

The result is the selected backend tool's standard MCP `CallToolResult`, including its `content`, `structuredContent`, and `isError` fields when provided.

If no single tool can satisfy the request, the gateway returns:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "No configured backend tool could satisfy the request."
    }
  ]
}
```

## Backend discovery

At startup the gateway:

1. Starts every configured stdio backend.
2. Completes standard MCP initialization.
3. Calls `tools/list` on each backend.
4. Converts every discovered tool schema into an OpenAI function definition.
5. Refuses startup if any configured backend fails.

The gateway chooses one backend tool per `orchestrate_task` call. It does not execute autonomous multi-step loops.

## Configuration

```ts
interface GatewayConfig {
  backends: Array<{
    id: string;
    displayName?: string;
    type: 'stdio';
    command: string;
    args?: string[];
    env?: Record<string, string>;
    inheritEnv?: string[];
    startupTimeoutMs?: number;
  }>;
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';
  frontendPort?: number | null;
  openaiModel?: string;
  agents?: Array<`openai/${string}`>;
}
```

Backend IDs must be unique and contain only letters, numbers, `_`, or `-`.

`env` values may reference gateway variables with `${VARIABLE_NAME}`. Missing referenced or inherited variables fail startup rather than silently passing an empty credential.

## Dashboard API

When the local dashboard is enabled:

- `GET /api/status`
- `GET /api/config`
- `GET /api/logs`
- `GET /api/traces`
- `GET /api/agents`
- `POST /api/chat-with-agent`
- `WS /ws`

The dashboard binds only to `127.0.0.1`. It rejects non-local `Host` headers, cross-origin browser requests and WebSockets, and non-JSON API posts. Responses are redacted before transmission.
