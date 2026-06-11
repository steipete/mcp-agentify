# mcp-agentify

AI-powered MCP gateway that discovers tools from backend MCP servers and routes each natural-language request to one backend tool.

> Experimental. The npm package is `@steipete/mcp-agentify`. The unscoped `mcp-agentify` package belongs to an unrelated project.

## Requirements

- Node.js 20.19 or newer
- An OpenAI API key
- At least one stdio MCP backend

## Install

```bash
npm install --global @steipete/mcp-agentify
```

The installed command remains `mcp-agentify`.

## Configure

Create `mcp-agentify.json`:

```json
{
  "openaiModel": "gpt-4.1-mini",
  "frontendPort": 3030,
  "agents": ["openai/gpt-4.1-mini"],
  "backends": [
    {
      "id": "filesystem",
      "displayName": "Workspace files",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem@2026.1.14",
        "/absolute/path/to/allowed/files"
      ]
    },
    {
      "id": "browserbase",
      "displayName": "Browserbase",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@browserbasehq/mcp@3.0.0"],
      "inheritEnv": [
        "BROWSERBASE_API_KEY",
        "BROWSERBASE_PROJECT_ID",
        "GEMINI_API_KEY"
      ]
    }
  ]
}
```

Set credentials in the gateway process environment:

```bash
export OPENAI_API_KEY=...
export BROWSERBASE_API_KEY=...
export BROWSERBASE_PROJECT_ID=...
export GEMINI_API_KEY=...
mcp-agentify --config /absolute/path/to/mcp-agentify.json
```

`inheritEnv` is an explicit allowlist. Backend processes receive a minimal default environment plus only listed variables and configured `env` values. A configured value such as `"TOKEN": "${TOKEN}"` expands from the gateway environment.

## MCP client

Configure the gateway as a stdio MCP server:

```json
{
  "mcpServers": {
    "agentify": {
      "command": "npx",
      "args": [
        "-y",
        "@steipete/mcp-agentify",
        "--config",
        "/absolute/path/to/mcp-agentify.json"
      ],
      "env": {
        "OPENAI_API_KEY": "..."
      }
    }
  }
}
```

The gateway exposes one MCP tool:

- `orchestrate_task`: selects and calls exactly one tool discovered from the configured backends.

Multi-step workflows require multiple `orchestrate_task` calls. For example, a Browserbase workflow can call `start`, then `navigate`, then `extract`.

## CLI

```text
mcp-agentify --config <path> [--frontend-port <port>|--no-ui] [--model <model>]
```

Environment overrides:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Required OpenAI credential |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible base URL |
| `OPENAI_MODEL` | Override `openaiModel` |
| `MCP_AGENTIFY_CONFIG` | Default configuration path |
| `FRONTEND_PORT` | UI port, or `disabled` |
| `LOG_LEVEL` | Pino log level |
| `AGENTS` | Comma-separated `openai/<model>` UI agents |

## Local UI

Set `frontendPort` or pass `--frontend-port`. The dashboard binds to `127.0.0.1` and shows backend status, redacted logs, MCP traces, configuration, and optional direct OpenAI chat.

## Security

- Restrict filesystem backends to the minimum required directories.
- Keep credentials in environment variables; do not put them in JSON or command arguments.
- Only variables listed in `inheritEnv` are forwarded to a backend.
- Configuration, logs, traces, errors, and backend command arguments are redacted before display.
- Dashboard HTTP requests require a localhost `Host`; browser origins and WebSockets must be same-origin.
- The dashboard is local-only and has no authentication. Do not proxy or expose it.

## Development

```bash
npm ci
npm run lint
npm test
npm pack --dry-run
```

`npm test` rebuilds the server and packaged UI before running unit and integration tests.

See [API](docs/api.md), [examples](docs/examples.md), and [release notes](docs/release.md).
