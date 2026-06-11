# Examples

## Filesystem gateway

`mcp-agentify.json`:

```json
{
  "backends": [
    {
      "id": "filesystem",
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem@2026.1.14",
        "/Users/example/Projects/demo"
      ]
    }
  ],
  "openaiModel": "gpt-4.1-mini",
  "frontendPort": null
}
```

Start:

```bash
OPENAI_API_KEY=... mcp-agentify --config ./mcp-agentify.json
```

Example MCP tool call:

```json
{
  "name": "orchestrate_task",
  "arguments": {
    "query": "Read /Users/example/Projects/demo/README.md"
  }
}
```

The model selects a discovered filesystem tool such as `read_text_file`; the gateway returns that backend's MCP result.

## Browserbase gateway

`mcp-agentify.json`:

```json
{
  "backends": [
    {
      "id": "browserbase",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@browserbasehq/mcp@3.0.0"],
      "inheritEnv": [
        "BROWSERBASE_API_KEY",
        "BROWSERBASE_PROJECT_ID",
        "GEMINI_API_KEY"
      ]
    }
  ],
  "openaiModel": "gpt-4.1-mini",
  "frontendPort": 3030,
  "agents": ["openai/gpt-4.1-mini"]
}
```

Start:

```bash
export OPENAI_API_KEY=...
export BROWSERBASE_API_KEY=...
export BROWSERBASE_PROJECT_ID=...
export GEMINI_API_KEY=...
mcp-agentify --config ./mcp-agentify.json
```

Browserbase exposes `start`, `end`, `navigate`, `act`, `observe`, and `extract`. Each is a separate backend tool, so call `orchestrate_task` once per step.

## Programmatic MCP client

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: [
    '-y',
    '@steipete/mcp-agentify',
    '--config',
    '/absolute/path/to/mcp-agentify.json'
  ],
  env: {
    ...process.env,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY
  }
});

const client = new Client(
  { name: 'agentify-example', version: '1.0.0' },
  { capabilities: {} }
);

await client.connect(transport);
console.log(await client.listTools());
console.log(
  await client.callTool({
    name: 'orchestrate_task',
    arguments: { query: 'List the configured filesystem directory' }
  })
);
await client.close();
```
