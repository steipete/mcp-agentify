import { z } from 'zod';

const EnvironmentVariableNameSchema = z
    .string()
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Expected an environment variable name.');

export const BackendStdioConfigSchema = z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, 'Backend ID must contain only letters, numbers, _ or -.'),
    displayName: z.string().min(1).optional(),
    type: z.literal('stdio'),
    command: z.string().min(1),
    args: z.array(z.string()).optional().default([]),
    env: z.record(z.string()).optional().default({}),
    inheritEnv: z.array(EnvironmentVariableNameSchema).optional().default([]),
    startupTimeoutMs: z.number().int().min(1_000).max(120_000).optional().default(30_000),
});
export type BackendStdioConfig = z.infer<typeof BackendStdioConfigSchema>;

export const BackendConfigSchema = BackendStdioConfigSchema;
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

export const AgentifyOrchestrateTaskParamsSchema = z.object({
    query: z.string().min(1),
    context: OrchestrationContextSchema,
});
export type AgentifyOrchestrateTaskParams = z.infer<typeof AgentifyOrchestrateTaskParamsSchema>;

const GatewayConfigShape = {
    backends: z.array(BackendConfigSchema).min(1, 'At least one backend configuration is required.'),
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional().default('info'),
    frontendPort: z.number().int().min(1).max(65_535).optional().nullable().default(null),
    openaiModel: z.string().min(1).optional().default('gpt-4.1-mini'),
    agents: z
        .array(z.string().regex(/^openai\/.+$/i, 'Only OpenAI agents are supported.'))
        .optional()
        .default([]),
};

export const GatewayFileConfigSchema = z.object(GatewayConfigShape).superRefine((value, context) => {
    const ids = new Set<string>();
    for (const backend of value.backends) {
        if (ids.has(backend.id)) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['backends'],
                message: `Duplicate backend id: ${backend.id}`,
            });
        }
        ids.add(backend.id);
    }
});
export type GatewayFileConfig = z.infer<typeof GatewayFileConfigSchema>;

export const GatewayOptionsSchema = z.object({
    ...GatewayConfigShape,
    openaiApiKey: z.string().min(1, 'OPENAI_API_KEY is required.'),
    openaiBaseUrl: z.string().url().optional(),
    configPath: z.string().optional(),
});
export type GatewayOptions = z.infer<typeof GatewayOptionsSchema>;

export const LLMPlanSchema = z.object({
    backendId: z.string().min(1),
    toolName: z.string().min(1),
    arguments: z.record(z.unknown()),
});
export type Plan = z.infer<typeof LLMPlanSchema>;
