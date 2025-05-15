// tests/unit/llmOrchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import OpenAI from 'openai'; // Real import for SUT's type checking, mock handles runtime
import { LLMOrchestratorService } from '../../src/llmOrchestrator';
import type { BackendConfig, OrchestrationContext, Plan, BackendStdioConfig } from '../../src/interfaces';
import { initializeLogger, resetLoggerForTest } from '../../src/logger';
import type { PinoLogger } from 'pino';

const mockCreate = vi.fn();
vi.mock('openai', () => {
    // Define MockOpenAIAPIError *inside* the factory to avoid hoisting issues
    class MockAPIErrorInsideFactory extends Error {
        status?: number;
        headers?: Record<string, string>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        error?: Record<string, any>;
        constructor(message: string, status?: number) {
            super(message);
            this.name = 'APIError'; // Critical: SUT checks `instanceof APIError` which resolves to this class.
            // The `name` property is often checked by `instanceof` for duck typing or by error handlers.
            this.status = status;
        }
    }
    return {
        default: vi.fn().mockImplementation(() => ({
            chat: {
                completions: {
                    create: mockCreate,
                },
            },
        })),
        APIError: MockAPIErrorInsideFactory, // Export the class defined within the factory
    };
});

const mockPinoLogger = initializeLogger({ logLevel: 'silent' });
const mockBackendConfigs: BackendConfig[] = [
    { id: 'filesystem', type: 'stdio', command: 'cmd1', displayName: 'File System Service' },
    { id: 'mcpBrowserbase', type: 'stdio', command: 'cmd2', displayName: 'Browser Service' },
];

describe('LLMOrchestratorService', () => {
    let orchestrator: LLMOrchestratorService;

    beforeEach(() => {
        resetLoggerForTest();
        mockCreate.mockReset();
        orchestrator = new LLMOrchestratorService('test-api-key', mockBackendConfigs, mockPinoLogger);
    });

    describe('constructor and generateOpenAITools', () => {
        it('should initialize OpenAI client with API key', () => {
            expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'test-api-key' });
        });

        it('should generate available tools based on backendConfigs', () => {
            const tools = orchestrator.getAvailableTools();
            expect(tools).toHaveLength(2);
            expect(tools[0].type).toBe('function');
            expect(tools[0].function.name).toBe('filesystem');
            expect(tools[0].function.description).toContain('Handles local filesystem operations');
            expect(tools[0].function.parameters).toEqual({
                type: 'object',
                properties: {
                    mcp_method: {
                        type: 'string',
                        description: 'The specific MCP method to invoke on the selected backend service.',
                    },
                    mcp_params: {
                        type: 'object',
                        description:
                            'A key-value object containing parameters for the mcp_method. Structure varies by method.',
                    },
                },
                required: ['mcp_method', 'mcp_params'],
            });
            expect(tools[1].function.name).toBe('mcpBrowserbase');
            expect(tools[1].function.description).toContain('Controls a cloud browser (Browserbase)');
        });

        it('should handle empty backendConfigs for tool generation', () => {
            const orchestratorEmpty = new LLMOrchestratorService('test-api-key', [], mockPinoLogger);
            expect(orchestratorEmpty.getAvailableTools()).toHaveLength(0);
        });
        it('should use a generic description for unknown tool IDs', () => {
            const unknownConfig: BackendConfig[] = [
                { id: 'unknownTool', type: 'stdio', command: 'echo', displayName: 'Unknown Thing' },
            ];
            const orchestratorUnknown = new LLMOrchestratorService('test-api-key', unknownConfig, mockPinoLogger);
            const tools = orchestratorUnknown.getAvailableTools();
            expect(tools).toHaveLength(1);
            expect(tools[0].function.name).toBe('unknownTool');
            expect(tools[0].function.description).toContain('Interface to the Unknown Thing backend service');
        });
    });

    describe('orchestrate', () => {
        const validQuery = 'list files in /tmp';
        const validContext: OrchestrationContext = { currentWorkingDirectory: '/app' };

        it('should return a valid plan for a successful tool call', async () => {
            mockCreate.mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            tool_calls: [
                                {
                                    type: 'function',
                                    function: {
                                        name: 'filesystem',
                                        arguments: JSON.stringify({
                                            mcp_method: 'fs/list',
                                            mcp_params: { path: '/tmp' },
                                        }),
                                    },
                                },
                            ],
                        },
                    },
                ],
            });

            const plan = await orchestrator.orchestrate(validQuery, validContext);
            expect(plan).toEqual({
                backendId: 'filesystem',
                mcpMethod: 'fs/list',
                mcpParams: { path: '/tmp' },
            });
            expect(mockCreate).toHaveBeenCalledOnce();
            expect(mockCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    model: 'gpt-4-turbo-preview',
                    tools: orchestrator.getAvailableTools(),
                    messages: expect.arrayContaining([
                        expect.objectContaining({ role: 'system' }),
                        expect.objectContaining({ role: 'user', content: expect.stringContaining(validQuery) }),
                    ]),
                }),
            );
        });

        it('should return null if no tools are available', async () => {
            const orchestratorNoTools = new LLMOrchestratorService('test-api-key', [], mockPinoLogger);
            const plan = await orchestratorNoTools.orchestrate(validQuery, validContext);
            expect(plan).toBeNull();
            expect(mockCreate).not.toHaveBeenCalled();
        });

        it('should return null if LLM does not choose any tool', async () => {
            mockCreate.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [] } }] });
            const plan = await orchestrator.orchestrate(validQuery, validContext);
            expect(plan).toBeNull();
        });

        it('should use the first tool if LLM chooses multiple tools', async () => {
            mockCreate.mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            tool_calls: [
                                {
                                    type: 'function',
                                    function: {
                                        name: 'filesystem',
                                        arguments: JSON.stringify({ mcp_method: 'fs/list', mcp_params: {} }),
                                    },
                                },
                                {
                                    type: 'function',
                                    function: {
                                        name: 'mcpBrowserbase',
                                        arguments: JSON.stringify({ mcp_method: 'browser/load', mcp_params: {} }),
                                    },
                                },
                            ],
                        },
                    },
                ],
            });
            const plan = await orchestrator.orchestrate(validQuery, validContext);
            expect(plan?.backendId).toBe('filesystem');
        });

        it('should return null if LLM tool call is not function type', async () => {
            mockCreate.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [{ type: 'other_type' }] } }] });
            const plan = await orchestrator.orchestrate(validQuery, validContext);
            expect(plan).toBeNull();
        });

        it('should return null if LLM arguments are not valid JSON', async () => {
            mockCreate.mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            tool_calls: [
                                { type: 'function', function: { name: 'filesystem', arguments: 'invalid-json' } },
                            ],
                        },
                    },
                ],
            });
            const plan = await orchestrator.orchestrate(validQuery, validContext);
            expect(plan).toBeNull();
        });

        it('should return null if LLM arguments do not match LLMGeneratedArgumentsSchema', async () => {
            mockCreate.mockResolvedValueOnce({
                choices: [
                    {
                        message: {
                            tool_calls: [
                                {
                                    type: 'function',
                                    function: { name: 'filesystem', arguments: JSON.stringify({ mcp_params: {} }) },
                                },
                            ],
                        },
                    },
                ],
            });
            const plan = await orchestrator.orchestrate(validQuery, validContext);
            expect(plan).toBeNull();
        });

        it('should return null if OpenAI API call fails with an instance of the mocked APIError', async () => {
            // To get the constructor of the mocked APIError for instantiation in the test:
            // We need to get it from the result of the mock factory.
            // This is a bit indirect. A simpler way is to make the mock factory directly accessible
            // or, as done here, ensure the thrown error in the mock matches what `instanceof APIError` (mocked) expects.

            // Get the mocked module (which contains the MockAPIErrorInsideFactory as APIError export)
            const mockedOpenAI = await vi.importMock<typeof OpenAI & { APIError: typeof MockAPIErrorInsideFactory }>(
                'openai',
            );
            const errorToThrow = new mockedOpenAI.APIError('Test API Error from mock', 400);

            mockCreate.mockRejectedValueOnce(errorToThrow);
            const plan = await orchestrator.orchestrate(validQuery, validContext);
            expect(plan).toBeNull();
        });

        it('should return null if OpenAI API call fails with a generic Error (will not be instanceof mocked APIError)', async () => {
            mockCreate.mockRejectedValueOnce(new Error('Generic network error'));
            const plan = await orchestrator.orchestrate(validQuery, validContext);
            expect(plan).toBeNull();
        });
    });
});
