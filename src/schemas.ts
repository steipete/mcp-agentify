import { z } from 'zod';

export const BackendStdioConfigSchema = z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Backend ID must be OpenAI Tool Name compliant.'),
    displayName: z.string().optional(),
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
});
export type BackendStdioConfig = z.infer<typeof BackendStdioConfigSchema>;

export const BackendConfigSchema = BackendStdioConfigSchema; // PoC only supports stdio as per spec.md
export type BackendConfig = z.infer<typeof BackendConfigSchema>;

export const OrchestrationContextSchema = z
    .object({
        activeDocumentURI: z.string().url().optional().nullable(),
        currentWorkingDirectory: z.string().optional().nullable(),
        selectionText: z.string().optional().nullable(),
    })
    .optional()
    .nullable();
export type OrchestrationContext = z.infer<typeof OrchestrationContextSchema>;

export const GatewayOptionsSchema = z.object({
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional().default('info'),
    OPENAI_API_KEY: z.string().min(1).optional(),
    backends: z.array(BackendConfigSchema).min(1, 'At least one backend configuration is required.'),
    DEBUG_PORT: z.number().int().positive().optional().nullable(),
});
export type GatewayOptions = z.infer<typeof GatewayOptionsSchema>;

export const AgentifyOrchestrateTaskParamsSchema = z.object({
    query: z.string().min(1),
    context: OrchestrationContextSchema, // Uses the schema defined above
});
export type AgentifyOrchestrateTaskParams = z.infer<typeof AgentifyOrchestrateTaskParamsSchema>;

export const LLMGeneratedArgumentsSchema = z.object({
    mcp_method: z.string().min(1),
    mcp_params: z.record(z.unknown()), // Generic object, as params vary widely
});
export type LLMGeneratedArguments = z.infer<typeof LLMGeneratedArgumentsSchema>;

export const LLMPlanSchema = z.object({
    backendId: z.string(), // Corresponds to BackendConfig.id
    mcpMethod: z.string(),
    mcpParams: z.record(z.unknown()),
});
export type Plan = z.infer<typeof LLMPlanSchema>; // spec.md refers to this as Plan
