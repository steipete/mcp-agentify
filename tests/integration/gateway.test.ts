import { spawn } from 'node:child_process';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';

const TEST_TIMEOUT = 30_000;

async function listenOnEphemeralPort(server: Server): Promise<number> {
    return new Promise((resolvePromise, rejectPromise) => {
        server.once('error', rejectPromise);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                rejectPromise(new Error('Could not determine server port.'));
                return;
            }
            resolvePromise(address.port);
        });
    });
}

async function closeServer(server: Server): Promise<void> {
    if (!server.listening) return;
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
    });
}

async function requestDashboardStatus(
    port: number,
    options: {
        method?: string;
        path?: string;
        headers?: Record<string, string>;
        body?: string;
    } = {},
): Promise<number> {
    return new Promise((resolvePromise, rejectPromise) => {
        const request = httpRequest(
            {
                hostname: '127.0.0.1',
                port,
                method: options.method ?? 'GET',
                path: options.path ?? '/api/status',
                headers: options.headers,
            },
            (response) => {
                response.resume();
                response.once('end', () => resolvePromise(response.statusCode ?? 0));
            },
        );
        request.once('error', rejectPromise);
        if (options.body) request.write(options.body);
        request.end();
    });
}

describe('packaged gateway', { timeout: TEST_TIMEOUT }, () => {
    let openaiServer: Server;
    let openaiPort: number;
    let frontendPort: number;
    let tempDirectory: string;
    let client: Client;
    let transport: StdioClientTransport;
    let gatewayStderr = '';

    beforeAll(async () => {
        openaiServer = createServer((request, response) => {
            let body = '';
            request.on('data', (chunk) => {
                body += String(chunk);
            });
            request.on('end', () => {
                const payload = JSON.parse(body);
                const userMessage = payload.messages?.at(-1)?.content;
                if (userMessage === 'Trigger provider error.') {
                    response.writeHead(500, { 'Content-Type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            error: {
                                message: 'Provider rejected sk-test-never-log-this-value.',
                                type: 'server_error',
                            },
                        }),
                    );
                    return;
                }
                if (!payload.tools) {
                    response.writeHead(200, { 'Content-Type': 'application/json' });
                    response.end(
                        JSON.stringify({
                            id: 'chatcmpl-test-chat',
                            object: 'chat.completion',
                            created: Math.floor(Date.now() / 1000),
                            model: payload.model,
                            choices: [
                                {
                                    index: 0,
                                    finish_reason: 'stop',
                                    message: { role: 'assistant', content: 'Test response.' },
                                },
                            ],
                            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                        }),
                    );
                    return;
                }
                const selectedTool = payload.tools.find(
                    (tool: { function: { name: string } }) => tool.function.name === 'filesystem__list_directory',
                );
                response.writeHead(200, { 'Content-Type': 'application/json' });
                response.end(
                    JSON.stringify({
                        id: 'chatcmpl-test',
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: payload.model,
                        choices: [
                            {
                                index: 0,
                                finish_reason: 'tool_calls',
                                message: {
                                    role: 'assistant',
                                    content: null,
                                    tool_calls: [
                                        {
                                            id: 'call-test',
                                            type: 'function',
                                            function: {
                                                name: selectedTool.function.name,
                                                arguments: JSON.stringify({ path: '/testpath' }),
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                    }),
                );
            });
        });
        openaiPort = await listenOnEphemeralPort(openaiServer);

        const frontendReservation = createServer();
        frontendPort = await listenOnEphemeralPort(frontendReservation);
        await closeServer(frontendReservation);

        tempDirectory = mkdtempSync(join(tmpdir(), 'mcp-agentify-test-'));
        const configPath = join(tempDirectory, 'mcp-agentify.json');
        writeFileSync(
            configPath,
            JSON.stringify({
                frontendPort,
                logLevel: 'debug',
                openaiModel: 'test-model',
                agents: ['openai/test-model'],
                backends: [
                    {
                        id: 'filesystem',
                        type: 'stdio',
                        command: process.execPath,
                        args: [resolve('tests/integration/mock-backends/filesystem-mock.js')],
                        env: { RUNTIME_VALUE: 'custom-secret-without-known-prefix' },
                    },
                ],
            }),
        );

        transport = new StdioClientTransport({
            command: process.execPath,
            args: [resolve('dist/cli.js'), '--config', configPath],
            env: {
                ...getDefaultEnvironment(),
                NODE_ENV: 'production',
                OPENAI_API_KEY: 'sk-test-never-log-this-value',
                OPENAI_BASE_URL: `http://127.0.0.1:${openaiPort}/v1`,
            },
            stderr: 'pipe',
        });
        transport.stderr?.on('data', (chunk) => {
            gatewayStderr += String(chunk);
        });
        client = new Client({ name: 'gateway-test', version: '1.0.0' }, { capabilities: {} });
        await client.connect(transport);
    }, TEST_TIMEOUT);

    afterAll(async () => {
        await client?.close();
        await closeServer(openaiServer);
        if (tempDirectory) rmSync(tempDirectory, { recursive: true, force: true });
    });

    it('exposes a standard MCP orchestration tool', async () => {
        const tools = await client.listTools();
        expect(tools.tools).toEqual([
            expect.objectContaining({
                name: 'orchestrate_task',
                inputSchema: expect.objectContaining({ type: 'object' }),
            }),
        ]);
    });

    it('routes a request through OpenAI to a discovered backend MCP tool', async () => {
        const result = await client.callTool({
            name: 'orchestrate_task',
            arguments: { query: 'List files in /testpath.' },
        });
        expect(result.isError).not.toBe(true);
        expect(result.content).toEqual([
            { type: 'text', text: JSON.stringify({ files: ['file1.txt', 'file2.js'], path: '/testpath' }) },
        ]);
        const traces = (await fetch(`http://127.0.0.1:${frontendPort}/api/traces`).then((response) =>
            response.json(),
        )) as { traces: Array<{ backendId?: string; method: string; direction: string }> };
        const backendTraces = traces.traces
            .filter((trace) => trace.backendId === 'filesystem' && trace.method === 'list_directory')
            .map((trace) => trace.direction)
            .sort();
        expect(backendTraces).toEqual(['INCOMING_TO_GATEWAY', 'OUTGOING_FROM_GATEWAY']);
    });

    it('serves the packaged UI on localhost with redacted configuration', async () => {
        const status = await fetch(`http://127.0.0.1:${frontendPort}/api/status`).then((response) => response.json());
        const configText = await fetch(`http://127.0.0.1:${frontendPort}/api/config`).then((response) =>
            response.text(),
        );
        const html = await fetch(`http://127.0.0.1:${frontendPort}/`).then((response) => response.text());

        expect(status).toMatchObject({
            status: 'running',
            openaiConfigured: true,
            backends: [expect.objectContaining({ id: 'filesystem', isReady: true, toolCount: 2 })],
        });
        expect(configText).toContain('[REDACTED]');
        expect(configText).not.toContain('sk-test-never-log-this-value');
        expect(configText).not.toContain('custom-secret-without-known-prefix');
        expect(html).toContain('MCP Agentify');
        const logsText = await fetch(`http://127.0.0.1:${frontendPort}/api/logs`).then((response) => response.text());
        expect(logsText).toContain('Backend stderr.');
        expect(logsText).toContain('[REDACTED]');
        expect(gatewayStderr).not.toContain('sk-test-never-log-this-value');
        expect(gatewayStderr).not.toContain('custom-secret-without-known-prefix');
    });

    it('redacts provider failures from dashboard responses and logs', async () => {
        const response = await fetch(`http://127.0.0.1:${frontendPort}/api/chat-with-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agentModelString: 'openai/test-model',
                params: { query: 'Trigger provider error.' },
            }),
        });
        const responseText = await response.text();
        const logsText = await fetch(`http://127.0.0.1:${frontendPort}/api/logs`).then((logsResponse) =>
            logsResponse.text(),
        );

        expect(response.status).toBe(502);
        expect(responseText).toContain('sk-REDACTED');
        expect(responseText).not.toContain('sk-test-never-log-this-value');
        expect(logsText).not.toContain('sk-test-never-log-this-value');
        expect(logsText).not.toContain('custom-secret-without-known-prefix');
        expect(gatewayStderr).not.toContain('sk-test-never-log-this-value');
        expect(gatewayStderr).not.toContain('custom-secret-without-known-prefix');
    });

    it('rejects untrusted dashboard hosts, origins, and content types', async () => {
        const reboundStatus = await requestDashboardStatus(frontendPort, {
            headers: { Host: 'attacker.example' },
        });
        const originStatus = await requestDashboardStatus(frontendPort, {
            headers: {
                Host: `127.0.0.1:${frontendPort}`,
                Origin: 'https://example.com',
            },
        });
        const contentTypeStatus = await requestDashboardStatus(frontendPort, {
            method: 'POST',
            path: '/api/chat-with-agent',
            headers: {
                Host: `127.0.0.1:${frontendPort}`,
                'Content-Type': 'text/plain',
            },
            body: '{}',
        });

        expect(reboundStatus).toBe(403);
        expect(originStatus).toBe(403);
        expect(contentTypeStatus).toBe(415);
    });

    it('accepts only same-origin dashboard WebSockets', async () => {
        await new Promise<void>((resolvePromise, rejectPromise) => {
            const socket = new WebSocket(`ws://127.0.0.1:${frontendPort}/ws`, {
                headers: { Origin: `http://127.0.0.1:${frontendPort}` },
            });
            socket.once('open', () => {
                socket.close();
                resolvePromise();
            });
            socket.once('error', rejectPromise);
        });

        await new Promise<void>((resolvePromise, rejectPromise) => {
            const socket = new WebSocket(`ws://127.0.0.1:${frontendPort}/ws`, {
                headers: { Origin: 'https://example.com' },
            });
            socket.once('unexpected-response', (_request, response) => {
                expect(response.statusCode).toBe(401);
                resolvePromise();
            });
            socket.once('open', () => rejectPromise(new Error('Cross-origin WebSocket was accepted.')));
            socket.once('error', () => undefined);
        });
    });

    it('lets CLI and environment overrides disable a configured dashboard', async () => {
        const cases: Array<{
            label: string;
            args: string[];
            environment: Record<string, string>;
        }> = [
            { label: '--no-ui', args: ['--no-ui'], environment: {} },
            { label: 'FRONTEND_PORT=disabled', args: [], environment: { FRONTEND_PORT: 'disabled' } },
        ];

        for (const testCase of cases) {
            const reservation = createServer();
            const disabledPort = await listenOnEphemeralPort(reservation);
            await closeServer(reservation);
            const configPath = join(tempDirectory, `disabled-ui-${disabledPort}.json`);
            writeFileSync(
                configPath,
                JSON.stringify({
                    frontendPort: disabledPort,
                    openaiModel: 'test-model',
                    backends: [
                        {
                            id: 'filesystem',
                            type: 'stdio',
                            command: process.execPath,
                            args: [resolve('tests/integration/mock-backends/filesystem-mock.js')],
                        },
                    ],
                }),
            );

            const disabledTransport = new StdioClientTransport({
                command: process.execPath,
                args: [resolve('dist/cli.js'), '--config', configPath, ...testCase.args],
                env: {
                    ...getDefaultEnvironment(),
                    NODE_ENV: 'production',
                    OPENAI_API_KEY: 'sk-test-never-log-this-value',
                    OPENAI_BASE_URL: `http://127.0.0.1:${openaiPort}/v1`,
                    ...testCase.environment,
                },
                stderr: 'pipe',
            });
            const disabledClient = new Client(
                { name: `gateway-test-${testCase.label}`, version: '1.0.0' },
                { capabilities: {} },
            );

            try {
                await disabledClient.connect(disabledTransport);
                await expect(fetch(`http://127.0.0.1:${disabledPort}/api/status`)).rejects.toThrow();
            } finally {
                await disabledClient.close();
            }
        }
    });

    it('shuts down when the MCP client closes stdin', async () => {
        const configPath = join(tempDirectory, 'stdio-disconnect.json');
        writeFileSync(
            configPath,
            JSON.stringify({
                frontendPort: null,
                openaiModel: 'test-model',
                backends: [
                    {
                        id: 'filesystem',
                        type: 'stdio',
                        command: process.execPath,
                        args: [resolve('tests/integration/mock-backends/filesystem-mock.js')],
                    },
                ],
            }),
        );
        const child = spawn(process.execPath, [resolve('dist/cli.js'), '--config', configPath], {
            env: {
                ...getDefaultEnvironment(),
                NODE_ENV: 'production',
                OPENAI_API_KEY: 'sk-test-never-log-this-value',
                OPENAI_BASE_URL: `http://127.0.0.1:${openaiPort}/v1`,
            },
            stdio: 'pipe',
        });

        try {
            await new Promise<void>((resolvePromise, rejectPromise) => {
                const timeout = setTimeout(() => rejectPromise(new Error('Gateway did not become ready.')), 10_000);
                child.stderr.on('data', (chunk) => {
                    if (String(chunk).includes('mcp-agentify ready.')) {
                        clearTimeout(timeout);
                        resolvePromise();
                    }
                });
                child.once('error', rejectPromise);
            });
            child.stdin.end();
            const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
                const timeout = setTimeout(
                    () => rejectPromise(new Error('Gateway did not exit after stdin closed.')),
                    10_000,
                );
                child.once('exit', (code) => {
                    clearTimeout(timeout);
                    resolvePromise(code);
                });
            });
            expect(exitCode).toBe(0);
        } finally {
            if (child.exitCode === null) {
                child.kill('SIGKILL');
            }
        }
    });
});
