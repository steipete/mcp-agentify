// tests/integration/mock-backends/filesystem-mock.js
// A very simple mock MCP server for filesystem operations (CommonJS)
const rpc = require('vscode-jsonrpc/node');

const connection = rpc.createMessageConnection(process.stdin, process.stdout);

connection.onRequest('initialize', (params) => {
  // console.error('[filesystem-mock] Received initialize');
  return { capabilities: { textDocumentSync: 1 } }; // Example capabilities
});

connection.onRequest('fs/list', (params) => {
  // console.error(`[filesystem-mock] Received fs/list with params: ${JSON.stringify(params)}`);
  if (params && params.path === '/testpath') {
    return { files: ['file1.txt', 'file2.js'], path: params.path };
  }
  return { files: [], path: params ? params.path : 'unknown' };
});

connection.onRequest('fs/readFile', (params) => {
  // console.error(`[filesystem-mock] Received fs/readFile with params: ${JSON.stringify(params)}`);
  if (params && params.path === '/testpath/file1.txt') {
    return { content: 'Hello from mock filesystem!' };
  }
  return rpc.ResponseError(rpc.ErrorCodes.InvalidParams, 'File not found by mock');
});

connection.onNotification('shutdown', () => {
  // console.error('[filesystem-mock] Received shutdown');
  connection.dispose();
});

connection.onNotification('exit', () => {
  // console.error('[filesystem-mock] Received exit');
  process.exit(0);
});

// console.error('[filesystem-mock] Listening...');
connection.listen(); 