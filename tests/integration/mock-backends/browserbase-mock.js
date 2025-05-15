// tests/integration/mock-backends/browserbase-mock.js
// A very simple mock MCP server for browserbase operations (CommonJS)
const rpc = require('vscode-jsonrpc/node');
console.error('[browserbase-mock.js] ALIVE AND STARTING'); // Log on start

const connection = rpc.createMessageConnection(process.stdin, process.stdout);

connection.onRequest('initialize', (params) => {
  console.error(`[browserbase-mock.js] Received 'initialize', params: ${JSON.stringify(params)}. Responding...`);
  return { capabilities: {} };
});

connection.onRequest('browser/loadUrl', (params) => {
  console.error(`[browserbase-mock.js] Received 'browser/loadUrl', params: ${JSON.stringify(params)}. Responding...`);
  if (params && params.url && params.url.includes('example.com')) {
    return { sessionId: 'mockSession123', title: 'Mock Page Title' };
  }
  return rpc.ResponseError(rpc.ErrorCodes.InvalidParams, 'URL not supported by mock');
});

connection.onRequest('browser/extractText', (params) => {
    // console.error(`[browserbase-mock] Received browser/extractText with params: ${JSON.stringify(params)}`);
    if (params && params.sessionId === 'mockSession123') {
        return { text: "Mocked webpage text content from example.com" };
    }
    return { text: "Session not found or no content for this mock session." };
});

connection.onNotification('shutdown', () => {
  console.error('[browserbase-mock.js] Received shutdown');
  connection.dispose();
});

connection.onNotification('exit', () => {
  console.error('[browserbase-mock.js] Received exit, exiting process.');
  process.exit(0);
});

console.error('[browserbase-mock.js] Listening for MCP messages...');
connection.listen(); 