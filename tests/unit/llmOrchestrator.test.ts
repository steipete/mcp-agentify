import OpenAI from 'openai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendTool } from '../../src/interfaces';
import { LLMOrchestratorService } from '../../src/llmOrchestrator';
import { initializeLogger } from '../../src/logger';

const createCompletion = vi.fn();
vi.mock('openai', () => ({
    default: vi.fn().mockImplementation(() => ({
        chat: { completions: { create: createCompletion } },
    })),
    APIError: class APIError extends Error {},
}));

const tools: BackendTool[] = [
    {
        backendId: 'filesystem',
        backendDisplayName: 'Filesystem',
        name: 'list_directory',
        description: 'List files in a directory.',
        inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
        },
    },
];

describe('LLMOrchestratorService', () => {
    beforeEach(() => createCompletion.mockReset());

    it('maps discovered MCP tools to OpenAI functions', () => {
        const service = new LLMOrchestratorService(
            'test-key',
            'gpt-4.1-mini',
            tools,
            initializeLogger({ logLevel: 'silent' }),
        );
        expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'test-key', baseURL: undefined });
        expect(service.getAvailableToolCount()).toBe(1);
    });

    it('removes unavailable backend tools from future orchestration', () => {
        const service = new LLMOrchestratorService(
            'test-key',
            'gpt-4.1-mini',
            [
                ...tools,
                {
                    ...tools[0],
                    backendId: 'browserbase',
                    backendDisplayName: 'Browserbase',
                    name: 'navigate',
                },
            ],
            initializeLogger({ logLevel: 'silent' }),
        );

        service.removeBackendTools('browserbase');

        expect(service.getAvailableToolCount()).toBe(1);
    });

    it('returns a backend plan for one valid tool call', async () => {
        createCompletion.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        tool_calls: [
                            {
                                type: 'function',
                                function: {
                                    name: 'filesystem__list_directory',
                                    arguments: JSON.stringify({ path: '/tmp' }),
                                },
                            },
                        ],
                    },
                },
            ],
        });
        const service = new LLMOrchestratorService(
            'test-key',
            'gpt-4.1-mini',
            tools,
            initializeLogger({ logLevel: 'silent' }),
        );

        await expect(service.orchestrate('list files')).resolves.toEqual({
            backendId: 'filesystem',
            toolName: 'list_directory',
            arguments: { path: '/tmp' },
        });
        expect(createCompletion).toHaveBeenCalledWith(
            expect.objectContaining({
                model: 'gpt-4.1-mini',
                parallel_tool_calls: false,
                tools: [
                    expect.objectContaining({
                        function: expect.objectContaining({ name: 'filesystem__list_directory' }),
                    }),
                ],
            }),
        );
    });

    it('rejects missing, multiple, unknown, or malformed tool calls', async () => {
        const service = new LLMOrchestratorService(
            'test-key',
            'gpt-4.1-mini',
            tools,
            initializeLogger({ logLevel: 'silent' }),
        );

        createCompletion.mockResolvedValueOnce({ choices: [{ message: { tool_calls: [] } }] });
        await expect(service.orchestrate('none')).resolves.toBeNull();

        createCompletion.mockResolvedValueOnce({
            choices: [{ message: { tool_calls: [{ type: 'function' }, { type: 'function' }] } }],
        });
        await expect(service.orchestrate('many')).resolves.toBeNull();

        createCompletion.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        tool_calls: [{ type: 'function', function: { name: 'unknown', arguments: '{}' } }],
                    },
                },
            ],
        });
        await expect(service.orchestrate('unknown')).resolves.toBeNull();

        createCompletion.mockResolvedValueOnce({
            choices: [
                {
                    message: {
                        tool_calls: [
                            {
                                type: 'function',
                                function: { name: 'filesystem__list_directory', arguments: '{' },
                            },
                        ],
                    },
                },
            ],
        });
        await expect(service.orchestrate('bad json')).resolves.toBeNull();
    });

    it('supports configured OpenAI agents for UI chat', async () => {
        createCompletion.mockResolvedValueOnce({
            choices: [{ message: { content: 'hello' } }],
        });
        const service = new LLMOrchestratorService(
            'test-key',
            'gpt-4.1-mini',
            tools,
            initializeLogger({ logLevel: 'silent' }),
        );
        await expect(service.chatWithAgent('openai/gpt-4.1-mini', 'hi')).resolves.toEqual({
            message: 'hello',
            model: 'gpt-4.1-mini',
        });
        await expect(service.chatWithAgent('anthropic/claude', 'hi')).rejects.toThrow('Unsupported agent');
    });
});
