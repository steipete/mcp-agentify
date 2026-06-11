"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMPlanSchema = exports.GatewayOptionsSchema = exports.GatewayFileConfigSchema = exports.AgentifyOrchestrateTaskParamsSchema = exports.OrchestrationContextSchema = exports.BackendConfigSchema = exports.BackendStdioConfigSchema = void 0;
const zod_1 = require("zod");
const EnvironmentVariableNameSchema = zod_1.z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Expected an environment variable name.');
exports.BackendStdioConfigSchema = zod_1.z.object({
    id: zod_1.z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Backend ID must contain only letters, numbers, _ or -.'),
    displayName: zod_1.z.string().min(1).optional(),
    type: zod_1.z.literal('stdio'),
    command: zod_1.z.string().min(1),
    args: zod_1.z.array(zod_1.z.string()).optional().default([]),
    env: zod_1.z.record(zod_1.z.string()).optional().default({}),
    inheritEnv: zod_1.z.array(EnvironmentVariableNameSchema).optional().default([]),
    startupTimeoutMs: zod_1.z.number().int().min(1000).max(120000).optional().default(30000),
});
exports.BackendConfigSchema = exports.BackendStdioConfigSchema;
exports.OrchestrationContextSchema = zod_1.z
    .object({
    activeDocumentURI: zod_1.z.string().url().optional().nullable(),
    currentWorkingDirectory: zod_1.z.string().optional().nullable(),
    selectionText: zod_1.z.string().optional().nullable(),
})
    .optional()
    .nullable();
exports.AgentifyOrchestrateTaskParamsSchema = zod_1.z.object({
    query: zod_1.z.string().min(1),
    context: exports.OrchestrationContextSchema,
});
const GatewayConfigShape = {
    backends: zod_1.z.array(exports.BackendConfigSchema).min(1, 'At least one backend configuration is required.'),
    logLevel: zod_1.z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional().default('info'),
    frontendPort: zod_1.z.number().int().min(1).max(65535).optional().nullable().default(null),
    openaiModel: zod_1.z.string().min(1).optional().default('gpt-4.1-mini'),
    agents: zod_1.z
        .array(zod_1.z.string().regex(/^openai\/.+$/i, 'Only OpenAI agents are supported.'))
        .optional()
        .default([]),
};
exports.GatewayFileConfigSchema = zod_1.z.object(GatewayConfigShape).superRefine((value, context) => {
    const ids = new Set();
    for (const backend of value.backends) {
        if (ids.has(backend.id)) {
            context.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                path: ['backends'],
                message: `Duplicate backend id: ${backend.id}`,
            });
        }
        ids.add(backend.id);
    }
});
exports.GatewayOptionsSchema = zod_1.z.object({
    ...GatewayConfigShape,
    openaiApiKey: zod_1.z.string().min(1, 'OPENAI_API_KEY is required.'),
    openaiBaseUrl: zod_1.z.string().url().optional(),
    configPath: zod_1.z.string().optional(),
});
exports.LLMPlanSchema = zod_1.z.object({
    backendId: zod_1.z.string().min(1),
    toolName: zod_1.z.string().min(1),
    arguments: zod_1.z.record(zod_1.z.unknown()),
});
//# sourceMappingURL=schemas.js.map