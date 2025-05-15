"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMPlanSchema = exports.LLMGeneratedArgumentsSchema = exports.AgentifyOrchestrateTaskParamsSchema = exports.GatewayOptionsSchema = exports.OrchestrationContextSchema = exports.BackendConfigSchema = exports.BackendStdioConfigSchema = void 0;
const zod_1 = require("zod");
exports.BackendStdioConfigSchema = zod_1.z.object({
    id: zod_1.z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Backend ID must be OpenAI Tool Name compliant.'),
    displayName: zod_1.z.string().optional(),
    type: zod_1.z.literal('stdio'),
    command: zod_1.z.string().min(1),
    args: zod_1.z.array(zod_1.z.string()).optional(),
    env: zod_1.z.record(zod_1.z.string()).optional(),
});
exports.BackendConfigSchema = exports.BackendStdioConfigSchema; // PoC only supports stdio as per spec.md
exports.OrchestrationContextSchema = zod_1.z
    .object({
    activeDocumentURI: zod_1.z.string().url().optional().nullable(),
    currentWorkingDirectory: zod_1.z.string().optional().nullable(),
    selectionText: zod_1.z.string().optional().nullable(),
})
    .optional()
    .nullable();
exports.GatewayOptionsSchema = zod_1.z.object({
    logLevel: zod_1.z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional().default('info'),
    OPENAI_API_KEY: zod_1.z.string().min(1).optional(),
    backends: zod_1.z.array(exports.BackendConfigSchema).min(1, 'At least one backend configuration is required.'),
    DEBUG_PORT: zod_1.z.number().int().positive().optional().nullable(),
});
exports.AgentifyOrchestrateTaskParamsSchema = zod_1.z.object({
    query: zod_1.z.string().min(1),
    context: exports.OrchestrationContextSchema, // Uses the schema defined above
});
exports.LLMGeneratedArgumentsSchema = zod_1.z.object({
    mcp_method: zod_1.z.string().min(1),
    mcp_params: zod_1.z.record(zod_1.z.unknown()), // Generic object, as params vary widely
});
exports.LLMPlanSchema = zod_1.z.object({
    backendId: zod_1.z.string(), // Corresponds to BackendConfig.id
    mcpMethod: zod_1.z.string(),
    mcpParams: zod_1.z.record(zod_1.z.unknown()),
});
//# sourceMappingURL=schemas.js.map