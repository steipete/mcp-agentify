const readline = require('node:readline');

const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const request = JSON.parse(line);
  if (request.method !== 'initialize') return;

  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32_000,
        message: `Backend rejected ${process.env.RUNTIME_VALUE}`,
      },
    })}\n`,
  );
});
