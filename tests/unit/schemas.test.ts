import { describe, expect, it } from 'vitest';
import {
    AgentifyOrchestrateTaskParamsSchema,
    BackendConfigSchema,
    GatewayFileConfigSchema,
    GatewayOptionsSchema,
    LLMPlanSchema,
} from '../../src/schemas';

const backend = {
    id: 'filesystem',
    type: 'stdio' as const,
    command: 'node',
};

describe('BackendConfigSchema', () => {
    it('applies safe defaults', () => {
        expect(BackendConfigSchema.parse(backend)).toMatchObject({
            args: [],
            env: {},
            inheritEnv: [],
            startupTimeoutMs: 30_000,
        });
    });

    it('rejects invalid IDs and environment variable names', () => {
        expect(BackendConfigSchema.safeParse({ ...backend, id: 'bad id' }).success).toBe(false);
        expect(BackendConfigSchema.safeParse({ ...backend, inheritEnv: ['BAD-NAME'] }).success).toBe(false);
    });
});

describe('Gateway configuration', () => {
    it('parses file configuration defaults', () => {
        expect(GatewayFileConfigSchema.parse({ backends: [backend] })).toMatchObject({
            logLevel: 'info',
            frontendPort: null,
            openaiModel: 'gpt-4.1-mini',
            agents: [],
        });
    });

    it('rejects duplicate backend IDs', () => {
        expect(GatewayFileConfigSchema.safeParse({ backends: [backend, backend] }).success).toBe(false);
    });

    it('requires the runtime OpenAI key', () => {
        expect(GatewayOptionsSchema.safeParse({ backends: [backend] }).success).toBe(false);
        expect(
            GatewayOptionsSchema.parse({
                backends: [backend],
                openaiApiKey: 'test-key',
            }).openaiApiKey,
        ).toBe('test-key');
    });
});

describe('tool schemas', () => {
    it('validates orchestration input', () => {
        expect(AgentifyOrchestrateTaskParamsSchema.safeParse({ query: 'list files' }).success).toBe(true);
        expect(AgentifyOrchestrateTaskParamsSchema.safeParse({ query: '' }).success).toBe(false);
    });

    it('validates generated plans', () => {
        expect(
            LLMPlanSchema.safeParse({
                backendId: 'filesystem',
                toolName: 'list_directory',
                arguments: { path: '/tmp' },
            }).success,
        ).toBe(true);
        expect(
            LLMPlanSchema.safeParse({
                backendId: 'filesystem',
                arguments: {},
            }).success,
        ).toBe(false);
    });
});
