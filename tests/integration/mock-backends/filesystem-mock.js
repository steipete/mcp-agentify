const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod/v4');

const server = new McpServer({ name: 'filesystem-mock', version: '1.0.0' });

if (process.env.RUNTIME_VALUE) {
  console.error(`backend received ${process.env.RUNTIME_VALUE}`);
}

server.registerTool(
  'list_directory',
  {
    description: 'List files in a directory.',
    inputSchema: { path: z.string() },
  },
  async ({ path }) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          files: path === '/testpath' ? ['file1.txt', 'file2.js'] : [],
          path,
        }),
      },
    ],
  }),
);

server.registerTool(
  'read_text_file',
  {
    description: 'Read a UTF-8 text file.',
    inputSchema: { path: z.string() },
  },
  async ({ path }) => ({
    content: [
      {
        type: 'text',
        text: path === '/testpath/file1.txt' ? 'Hello from mock filesystem!' : 'File not found',
      },
    ],
    isError: path !== '/testpath/file1.txt',
  }),
);

server.connect(new StdioServerTransport()).catch((error) => {
  console.error(error);
  process.exit(1);
});
