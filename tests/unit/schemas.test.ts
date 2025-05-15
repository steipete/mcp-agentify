// tests/unit/schemas.test.ts
import { describe, it, expect } from 'vitest';
import {
    BackendStdioConfigSchema,
    BackendConfigSchema, // This is an alias to BackendStdioConfigSchema in PoC
    OrchestrationContextSchema,
    GatewayOptionsSchema,
    AgentifyOrchestrateTaskParamsSchema,
    LLMGeneratedArgumentsSchema,
    LLMPlanSchema,
} from '../../src/schemas'; // Adjust path if Vitest root is different

describe('BackendStdioConfigSchema (and BackendConfigSchema)', () => {
    const baseValidConfig = {
        id: 'filesystem-tool',
        type: 'stdio' as const,
        command: 'npx',
    };

    it('should validate a basic valid config', () => {
        const result = BackendStdioConfigSchema.safeParse(baseValidConfig);
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should validate with optional fields (displayName, args, env)', () => {
        const result = BackendStdioConfigSchema.safeParse({
            ...baseValidConfig,
            displayName: 'My Filesystem',
            args: ['arg1', 'arg2'],
            env: { VAR: 'value' },
        });
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should reject if id is missing', () => {
        const { id, ...invalid } = baseValidConfig;
        const result = BackendStdioConfigSchema.safeParse(invalid);
        expect(result.success).toBe(false);
    });

    it('should reject if id does not match regex', () => {
        const result = BackendStdioConfigSchema.safeParse({ ...baseValidConfig, id: 'invalid id with spaces' });
        expect(result.success).toBe(false);
    });

    it('should reject if type is not stdio', () => {
        const result = BackendStdioConfigSchema.safeParse({ ...baseValidConfig, type: 'other' });
        expect(result.success).toBe(false);
    });

    it('should reject if command is missing or empty', () => {
        const { command, ...invalid } = baseValidConfig;
        expect(BackendStdioConfigSchema.safeParse(invalid).success).toBe(false);
        expect(BackendStdioConfigSchema.safeParse({ ...baseValidConfig, command: '' }).success).toBe(false);
    });
});

describe('GatewayOptionsSchema', () => {
    const validBackendConfig = { id: 'test-backend', type: 'stdio' as const, command: 'echo' };
    const baseValidOptionsWithKey = {
        OPENAI_API_KEY: 'sk-testkey',
        backends: [validBackendConfig],
    };
    const baseValidOptionsWithoutKey = {
        // For testing optional OPENAI_API_KEY
        backends: [validBackendConfig],
    };

    it('should validate valid options with required fields', () => {
        const result = GatewayOptionsSchema.safeParse(baseValidOptionsWithKey);
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should apply default logLevel if not provided', () => {
        const result = GatewayOptionsSchema.safeParse(baseValidOptionsWithKey);
        if (result.success) {
            expect(result.data.logLevel).toBe('info');
        }
        expect(result.success).toBe(true);
    });

    it('should validate with all optional fields (logLevel, DEBUG_PORT)', () => {
        const result = GatewayOptionsSchema.safeParse({
            ...baseValidOptionsWithKey,
            logLevel: 'debug',
            DEBUG_PORT: 3001,
        });
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should validate successfully if OPENAI_API_KEY is missing (it is optional in schema)', () => {
        const result = GatewayOptionsSchema.safeParse(baseValidOptionsWithoutKey);
        expect(
            result.success,
            `Schema parse failed: ${JSON.stringify(result.success ? {} : result.error?.format())}`,
        ).toBe(true);
        if (result.success) {
            expect(result.data.OPENAI_API_KEY).toBeUndefined();
        }
    });

    it('should reject if OPENAI_API_KEY is an empty string (due to min(1))', () => {
        const result = GatewayOptionsSchema.safeParse({
            ...baseValidOptionsWithoutKey, // has backends
            OPENAI_API_KEY: '',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
            expect(result.error.flatten().fieldErrors.OPENAI_API_KEY).toContain(
                'String must contain at least 1 character(s)',
            );
        }
    });

    it('should reject if backends array is missing or empty', () => {
        const { backends, ...invalidNoBackends } = baseValidOptionsWithKey;
        expect(GatewayOptionsSchema.safeParse(invalidNoBackends).success).toBe(false);
        expect(GatewayOptionsSchema.safeParse({ ...baseValidOptionsWithKey, backends: [] }).success).toBe(false);
    });

    it('should reject if backends array contains invalid config', () => {
        const result = GatewayOptionsSchema.safeParse({
            ...baseValidOptionsWithKey,
            backends: [{ id: 'bad', type: 'stdio' }], // Missing command
        });
        expect(result.success).toBe(false);
    });
});

describe('OrchestrationContextSchema', () => {
    it('should validate an empty context (optional and nullable)', () => {
        expect(OrchestrationContextSchema.safeParse(null).success).toBe(true);
        expect(OrchestrationContextSchema.safeParse(undefined).success).toBe(true);
        expect(OrchestrationContextSchema.safeParse({}).success).toBe(true);
    });

    it('should validate with all fields present', () => {
        const result = OrchestrationContextSchema.safeParse({
            activeDocumentURI: 'file:///test.ts',
            currentWorkingDirectory: '/test',
            selectionText: 'selected',
        });
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should reject if activeDocumentURI is not a valid URL', () => {
        const result = OrchestrationContextSchema.safeParse({ activeDocumentURI: 'not-a-url' });
        expect(result.success).toBe(false);
    });
});

describe('AgentifyOrchestrateTaskParamsSchema', () => {
    const baseValidParams = { query: 'test query' };

    it('should validate with only query', () => {
        const result = AgentifyOrchestrateTaskParamsSchema.safeParse(baseValidParams);
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should validate with query and valid context', () => {
        const result = AgentifyOrchestrateTaskParamsSchema.safeParse({
            ...baseValidParams,
            context: { currentWorkingDirectory: '/path' },
        });
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should validate with query and null context', () => {
        const result = AgentifyOrchestrateTaskParamsSchema.safeParse({
            ...baseValidParams,
            context: null,
        });
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should reject if query is missing or empty', () => {
        const { query, ...invalid } = baseValidParams;
        expect(AgentifyOrchestrateTaskParamsSchema.safeParse(invalid).success).toBe(false);
        expect(AgentifyOrchestrateTaskParamsSchema.safeParse({ ...baseValidParams, query: '' }).success).toBe(false);
    });

    it('should reject if context is invalid', () => {
        const result = AgentifyOrchestrateTaskParamsSchema.safeParse({
            ...baseValidParams,
            context: { activeDocumentURI: 'invalid-url' },
        });
        expect(result.success).toBe(false);
    });
});

describe('LLMGeneratedArgumentsSchema', () => {
    const baseValidArgs = { mcp_method: 'fs/readFile', mcp_params: { path: '/file.txt' } };

    it('should validate valid arguments', () => {
        const result = LLMGeneratedArgumentsSchema.safeParse(baseValidArgs);
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should reject if mcp_method is missing or empty', () => {
        const { mcp_method, ...invalid } = baseValidArgs;
        expect(LLMGeneratedArgumentsSchema.safeParse(invalid).success).toBe(false);
        expect(LLMGeneratedArgumentsSchema.safeParse({ ...baseValidArgs, mcp_method: '' }).success).toBe(false);
    });

    it('should reject if mcp_params key is missing (as it is required by z.record)', () => {
        const { mcp_params, ...invalidMissingParamsKey } = baseValidArgs; // mcp_params key is removed
        const result = LLMGeneratedArgumentsSchema.safeParse(invalidMissingParamsKey);
        expect(result.success).toBe(false);
    });

    it('should accept various valid object types for mcp_params', () => {
        expect(LLMGeneratedArgumentsSchema.safeParse({ mcp_method: 'test', mcp_params: {} }).success).toBe(true);
        expect(
            LLMGeneratedArgumentsSchema.safeParse({ mcp_method: 'test', mcp_params: { a: 1, b: 'str' } }).success,
        ).toBe(true);
        expect(
            LLMGeneratedArgumentsSchema.safeParse({ mcp_method: 'test', mcp_params: { nested: { value: true } } })
                .success,
        ).toBe(true);
    });
});

describe('LLMPlanSchema', () => {
    const baseValidPlan = {
        backendId: 'filesystem',
        mcpMethod: 'fs/readFile',
        mcpParams: { path: '/file.txt' },
    };

    it('should validate a valid plan', () => {
        const result = LLMPlanSchema.safeParse(baseValidPlan);
        expect(result.success, JSON.stringify(result.success ? {} : result.error.format())).toBe(true);
    });

    it('should reject if backendId is missing', () => {
        const { backendId, ...invalid } = baseValidPlan;
        expect(LLMPlanSchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject if mcpMethod is missing', () => {
        const { mcpMethod, ...invalid } = baseValidPlan;
        expect(LLMPlanSchema.safeParse(invalid).success).toBe(false);
    });

    it('should reject if mcpParams key is missing (as it is required by z.record)', () => {
        const { mcpParams, ...invalidMissingParamsKey } = baseValidPlan; // mcp_params key is removed
        expect(LLMPlanSchema.safeParse(invalidMissingParamsKey).success).toBe(false);
    });

    it('should accept various valid object types for mcpParams in LLMPlanSchema', () => {
        expect(LLMPlanSchema.safeParse({ backendId: 'a', mcpMethod: 'b', mcpParams: {} }).success).toBe(true);
        expect(LLMPlanSchema.safeParse({ backendId: 'a', mcpMethod: 'b', mcpParams: { a: 1 } }).success).toBe(true);
    });
});
