import { z } from 'zod';
import type { PinoLogLevel } from './logger';

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

// This schema now primarily validates the structure of `backends` when parsing client-provided initializationOptions.
// Core gateway settings (logLevel, OPENAI_API_KEY, FRONTEND_PORT) are now strictly environment-driven and set pre-MCP handshake.
export const GatewayClientInitOptionsSchema = z.object({
    backends: z.array(BackendConfigSchema).min(1, 'At least one backend configuration is required.'),
    // The following are optional if a client *really* wants to send them, but mcp-agentify will ignore them
    // in favor of environment variables for its own configuration.
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    COHERE_API_KEY: z.string().optional(),
    FRONTEND_PORT: z.number().int().positive().optional().nullable(),
});
export type GatewayClientInitOptions = z.infer<typeof GatewayClientInitOptionsSchema>;

// GatewayOptions now represents the final, merged, and internally used configuration.
// It will be populated from environment variables first, then potentially from client for `backends`.
export const GatewayOptionsSchema = z.object({
    logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).optional().default('info'),
    OPENAI_API_KEY: z.string().optional(), // Can be from env or client, env takes precedence.
    ANTHROPIC_API_KEY: z.string().optional(),
    COHERE_API_KEY: z.string().optional(),
    // Add other API keys as needed following the same pattern

    // FRONTEND_PORT is now FRONTEND_PORT. It determines if and on what port the debug web server runs.
    // This is primarily controlled by the mcp-agentify server's own environment.
    // If not in env, client can suggest it, but env is king.
    // If neither, it might not start, or start on a default if the server logic implies one (e.g., 3030).
    FRONTEND_PORT: z.number().int().positive().optional().nullable(),

    // `backends` configuration is primarily client-driven via initializationOptions.
    backends: z.array(BackendConfigSchema).min(1, 'At least one backend configuration is required.'),
    gptAgents: z.array(z.string()).optional(), // For dynamically exposed agent methods
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
