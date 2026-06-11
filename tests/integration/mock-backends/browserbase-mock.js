const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod/v4');

const server = new McpServer({ name: 'browserbase-mock', version: '1.0.0' });

server.registerTool(
  'navigate',
  {
    description: 'Navigate a browser session to a URL.',
    inputSchema: { url: z.string().url() },
  },
  async ({ url }) => ({
    content: [{ type: 'text', text: JSON.stringify({ url, title: 'Mock Page Title' }) }],
  }),
);

server.connect(new StdioServerTransport()).catch((error) => {
  console.error(error);
  process.exit(1);
});
