// tests/integration/gateway.test.ts
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { createMessageConnection, ResponseError } from 'vscode-jsonrpc/node';
import type { MessageConnection } from 'vscode-jsonrpc/node';
import type { InitializeParams, InitializeResult, ServerCapabilities } from 'vscode-languageserver-protocol';
import type { GatewayOptions, BackendConfig, AgentifyOrchestrateTaskParams, Plan } from '../../src/interfaces';
import { resolve } from 'node:path';
import OpenAI from 'openai';

const INTEGRATION_TEST_TIMEOUT = 40000; // Increased to 40 seconds

// Path to the compiled CLI entry point
const cliPath = resolve(process.cwd(), 'dist/cli.js');

// Mock backend configurations
const mockFilesystemBackendConfig: BackendConfig = {
    id: 'filesystem',
    type: 'stdio',
    command: 'node',
    args: [resolve(process.cwd(), 'tests/integration/mock-backends/filesystem-mock.js')],
};
const mockBrowserbaseBackendConfig: BackendConfig = {
    id: 'mcpBrowserbase',
    type: 'stdio',
    command: 'node',
    args: [resolve(process.cwd(), 'tests/integration/mock-backends/browserbase-mock.js')],
};

// --- Mock OpenAI --- //
const mockOpenAIChatCompletionsCreate = vi.fn();
vi.mock('openai', () => {
    class MockAPIError extends Error {
        constructor(message: string) {
            super(message);
            this.name = 'APIError';
        }
    }
    return {
        default: vi.fn().mockImplementation(() => ({
            chat: {
                completions: {
                    create: mockOpenAIChatCompletionsCreate,
                },
            },
        })),
        APIError: MockAPIError,
    };
});
// --- End Mock OpenAI --- //

describe('Gateway Integration Tests', { timeout: INTEGRATION_TEST_TIMEOUT }, () => {
    let gatewayProcess: ChildProcess | null = null;
    let clientConnection: MessageConnection | null = null;

    beforeAll(async () => {
        // Build the project first to ensure dist/cli.js is up-to-date
        await new Promise<void>((resolvePromise, rejectPromise) => {
            const buildProcess = spawn('npm', ['run', 'build'], { stdio: 'pipe' });
            buildProcess.on('close', (code) => {
                if (code === 0) resolvePromise();
                else rejectPromise(new Error(`Build failed with code ${code}`));
            });
            buildProcess.on('error', rejectPromise);
        });

        gatewayProcess = spawn('node', [cliPath], {
            stdio: 'pipe',
            env: {
                ...process.env,
                OPENAI_API_KEY: 'sk-test-dummy-key-integration', // Dummy key for tests
                LOG_LEVEL: 'debug', // Changed to debug for more visibility
                NODE_ENV: 'production', // Force production mode for gateway's logger
            },
        });

        if (!gatewayProcess || !gatewayProcess.stdout || !gatewayProcess.stdin || !gatewayProcess.stderr) {
            throw new Error('Failed to spawn gateway process or access its stdio.');
        }

        gatewayProcess.on('error', (err) => {
            console.error('[TEST SETUP] Gateway process spawn error:', err);
        });
        
        // Capture stderr for debugging
        let stderrOutput = '';
        gatewayProcess.stderr.on('data', (data) => {
            const output = data.toString();
            stderrOutput += output;
            console.error(`[GATEWAY STDERR]: ${output.trim()}`);
        });
        
        // Capture stdout for debugging
        let stdoutOutput = '';
        gatewayProcess.stdout.on('data', (data) => {
            stdoutOutput += data.toString();
        });

        let gatewayReady = false;
        const readyPromise = new Promise<void>((resolveReady, rejectReady) => {
            const readyTimeout = setTimeout(() => {
                if (!gatewayReady) {
                    console.error('[TEST SETUP] Gateway readiness timeout. stderr collected:', stderrOutput);
                    console.error('[TEST SETUP] stdout collected:', stdoutOutput);
                    rejectReady(new Error('Gateway readiness log message timeout'));
                }
            }, INTEGRATION_TEST_TIMEOUT - 3000);

            gatewayProcess?.stderr?.on('data', (data) => {
                const output = data.toString();
                if (output.includes('mcp-agentify server logic started. Listening for client connection via stdio')) {
                    if (!gatewayReady) {
                        gatewayReady = true;
                        clearTimeout(readyTimeout);
                        console.log('[TEST SETUP] Gateway reported ready via stderr.');
                        resolveReady();
                    }
                }
            });
        });

        clientConnection = createMessageConnection(gatewayProcess!.stdout!, gatewayProcess!.stdin!);
        clientConnection.listen();

        console.log('[TEST SETUP] Waiting for gateway to be ready...');
        try {
            await readyPromise; // Now waits for message on stderr
            console.log('[TEST SETUP] Gateway readiness confirmed by log message.');
        } catch (e) {
            console.error('[TEST SETUP] Gateway readiness timeout or error:', e);
        }
    }, INTEGRATION_TEST_TIMEOUT);

    afterAll(async () => {
        if (clientConnection) {
            try {
                // Attempt graceful shutdown if connection is active
                clientConnection.sendNotification('shutdown');
                await new Promise((resolve) => setTimeout(resolve, 200)); // Give time for shutdown
                clientConnection.sendNotification('exit');
            } catch (e) {
                console.error('[TEST CLEANUP] Error sending shutdown/exit to gateway:', e);
            }
            clientConnection.dispose();
        }
        if (gatewayProcess && !gatewayProcess.killed) {
            const killed = gatewayProcess.kill('SIGTERM'); // Attempt graceful, then SIGKILL if needed after timeout
            if (!killed) gatewayProcess.kill('SIGKILL');
            console.log('[TEST CLEANUP] Gateway process killed.');
        }
        // Wait a bit for process to fully exit to avoid resource conflicts in CI
        await new Promise((resolve) => setTimeout(resolve, 500));
    }, INTEGRATION_TEST_TIMEOUT); // Timeout for afterAll

    beforeEach(() => {
        // Reset mocks before each test in this describe block if needed for orchestrate tests
        mockOpenAIChatCompletionsCreate.mockReset();
    });

    it('test environment should be set up correctly', () => {
        expect(gatewayProcess).toBeDefined();
        expect(gatewayProcess?.pid).toBeGreaterThan(0);
        expect(clientConnection).toBeDefined();
    });
    
    describe('Simple Ping Request', () => {
        it('should respond to ping with pong', async () => {
            if (!clientConnection) throw new Error('Client connection not available');
            try {
                const result = await clientConnection.sendRequest('ping');
                expect(result).toBe('pong');
            } catch (error) {
                console.error('Ping test failed:', error);
                throw error;
            }
        }, 5000); // Shorter timeout for ping
    });

    describe('MCP Initialize Request', () => {
        // Ensure clientConnection is defined for these tests
        // It's initialized in beforeAll, so it should be available.

        it(
            'should initialize successfully with valid backend configurations',
            async () => {
                if (!clientConnection) throw new Error('Client connection not available for test');

                const initParams: InitializeParams = {
                    processId: process.pid || null,
                    clientInfo: { name: 'IntegrationTestClient', version: '1.0' },
                    rootUri: null,
                    capabilities: {},
                    initializationOptions: {
                        OPENAI_API_KEY: 'sk-dummy-key-for-init-test', // Override env for this test
                        backends: [mockFilesystemBackendConfig, mockBrowserbaseBackendConfig],
                        logLevel: 'debug', // Use debug to see backend init logs from gateway
                    },
                };
                const result: InitializeResult = await clientConnection.sendRequest('initialize', initParams);

                expect(result).toBeDefined();
                expect(result.serverInfo?.name).toBe('mcp-agentify');
                expect(result.serverInfo?.version).toMatch(/^\d+\.\d+\.\d+$/); // Semver format
                // Further checks could involve inspecting gateway logs if accessible for backend init messages
            },
            INTEGRATION_TEST_TIMEOUT,
        ); // Longer timeout if backend init is slow

        it(
            'should initialize successfully even if OPENAI_API_KEY is missing in client options, if present in ENV',
            async () => {
                if (!clientConnection) throw new Error('Client connection not available');
                // Gateway process is spawned with OPENAI_API_KEY in its env.
                const initParams: InitializeParams = {
                    processId: null,
                    clientInfo: { name: 'TestAPIKeyFallback' },
                    rootUri: null,
                    capabilities: {},
                    initializationOptions: {
                        // OPENAI_API_KEY is deliberately missing here
                        backends: [mockFilesystemBackendConfig],
                        logLevel: 'debug',
                    },
                };
                // Expect success because the gateway's env should provide the API key.
                try {
                    const result: InitializeResult = await clientConnection.sendRequest('initialize', initParams);
                    expect(result).toBeDefined();
                    expect(result.serverInfo?.name).toBe('mcp-agentify');
                } catch (error) {
                    console.error('Initialize with env API key failed:', error);
                    throw error;
                }
            },
            INTEGRATION_TEST_TIMEOUT,
        );

        it('should reject initialize if backends array is missing', async () => {
            if (!clientConnection) throw new Error('Client connection not available');
            const initParams: InitializeParams = {
                processId: null,
                clientInfo: { name: 'Test' },
                rootUri: null,
                capabilities: {},
                initializationOptions: { OPENAI_API_KEY: 'sk-dummy' /* backends missing */ },
            };
            await expect(clientConnection.sendRequest('initialize', initParams)).rejects.toBeDefined();
        });

        it('should reject initialize if a backend config is invalid', async () => {
            if (!clientConnection) throw new Error('Client connection not available');
            const invalidBackend = { id: 'invalid-backend', type: 'stdio' /* command missing */ } as any;
            const initParams: InitializeParams = {
                processId: null,
                clientInfo: { name: 'Test' },
                rootUri: null,
                capabilities: {},
                initializationOptions: { OPENAI_API_KEY: 'sk-dummy', backends: [invalidBackend] },
            };
            await expect(clientConnection.sendRequest('initialize', initParams)).rejects.toBeDefined();
        });

        // Test for re-initialization is tricky as the connection might close or become unresponsive.
        // The jsonrpc library typically prevents multiple initialize calls.
        // This test might need to re-establish a connection if the first one dies.
        // For PoC, confirming one successful init is primary.
    });

    describe('Agentify OrchestrateTask Request', () => {
        // Helper to ensure gateway is initialized for these tests
        async function ensureGatewayInitialized() {
            if (!clientConnection) throw new Error('Client connection not available for init');
            // Simple init, assuming OPENAI_API_KEY is in gateway's env from beforeAll
            const initParams: InitializeParams = {
                processId: null,
                clientInfo: { name: 'OrchestrateTestClient' },
                rootUri: null,
                capabilities: {},
                initializationOptions: { backends: [mockFilesystemBackendConfig, mockBrowserbaseBackendConfig] },
            };
            try {
                await clientConnection.sendRequest('initialize', initParams);
            } catch (e: unknown) {
                if (e instanceof Error && e.message && e.message.includes('initialize can only be called once')) {
                    console.warn('[TEST WARN] Gateway already initialized, proceeding.');
                } else {
                    throw e;
                }
            }
        }

        beforeEach(async () => {
            await ensureGatewayInitialized();
            // Reset LLM mock specifically for each orchestrate test
            mockOpenAIChatCompletionsCreate.mockReset();
        });

        it(
            'should return -32000 error due to dummy API key when orchestrating',
            async () => {
                if (!clientConnection) throw new Error('Client connection not available');

                // No need to mock mockOpenAIChatCompletionsCreate as the real OpenAI call will fail
                // in the spawned gateway process due to the dummy API key.

                const orchestrateParams: AgentifyOrchestrateTaskParams = {
                    query: 'List files in /testpath on filesystem',
                    context: { currentWorkingDirectory: '/test' },
                };

                try {
                    await clientConnection.sendRequest('agentify/orchestrateTask', orchestrateParams);
                    throw new Error('OrchestrateTask should have rejected due to API key error');
                } catch (error: any) {
                    expect(error).toBeInstanceOf(ResponseError);
                    expect(error.code).toBe(-32000); // "AI orchestrator could not determine an action..."
                    // This is because LLMOrchestrator returns null on APIError,
                    // and server.ts converts that null plan to -32000.
                    expect(error.message).toContain('AI orchestrator could not determine an action');
                }
            },
            INTEGRATION_TEST_TIMEOUT,
        );

        // Test for when LLMOrchestrator explicitly returns null (e.g. no tool calls from LLM)
        // This requires mocking the LLM response *within the gateway process* or more advanced test setup.
        // For PoC, the above test covers LLM interaction failure.
        // The existing 'should return a ResponseError if LLM provides no tool call'
        // was based on mocking the test-side OpenAI, which doesn't affect the gateway.
        // So, that test needs to be re-thought or removed for true integration testing.
        // Let's remove it for now as it's misleading.

        // TODO: Add test for invalid params to agentify/orchestrateTask
    });
});