const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');

const server = new McpServer({ name: 'exiting-mock', version: '1.0.0' });

server.registerTool(
  'temporary_tool',
  {
    description: 'Tool exposed briefly before the backend exits.',
  },
  async () => ({ content: [{ type: 'text', text: 'temporary' }] }),
);

server.connect(new StdioServerTransport()).then(() => {
  setTimeout(() => process.exit(0), 250);
});
