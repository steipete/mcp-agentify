import type { MessageConnection } from 'vscode-jsonrpc/node';
import type { ChildProcess } from 'node:child_process';

// Import actual Zod-inferred types from schemas.ts
import type {
    BackendConfig as ZodBackendConfig,
    Plan as ZodPlan,
    GatewayOptions as ZodGatewayOptions,
    BackendStdioConfig as ZodBackendStdioConfig,
    OrchestrationContext as ZodOrchestrationContext,
    AgentifyOrchestrateTaskParams as ZodAgentifyOrchestrateTaskParams,
    LLMGeneratedArguments as ZodLLMGeneratedArguments,
} from './schemas';

// --- Gateway & Backend Configuration Types (Re-exporting from schemas) --- //
export type BackendStdioConfig = ZodBackendStdioConfig;
export type BackendConfig = ZodBackendConfig;
export type GatewayOptions = ZodGatewayOptions;

// --- Orchestration & LLM Types (Re-exporting from schemas) --- //
export type OrchestrationContext = ZodOrchestrationContext;
export type AgentifyOrchestrateTaskParams = ZodAgentifyOrchestrateTaskParams;
export type LLMGeneratedArguments = ZodLLMGeneratedArguments;
export type Plan = ZodPlan; // Note: LLMPlanSchema in schemas.ts infers to type 'Plan'

// --- Other Supporting Interfaces (Defined directly here) --- //

export interface BackendInstance {
    id: string;
    config: BackendConfig; // Now uses the imported Zod-inferred type
    connection: MessageConnection;
    process?: ChildProcess;
    isReady: boolean;
}

export interface OpenAIFunctionParameters {
    type: 'object';
    properties: {
        mcp_method: { type: 'string'; description: string };
        mcp_params: { type: 'object'; description: string };
    };
    required: ['mcp_method', 'mcp_params'];
}

export interface OpenAIToolFunction {
    name: string;
    description: string;
    parameters: OpenAIFunctionParameters;
}

export interface OpenAITool {
    type: 'function';
    function: OpenAIToolFunction;
}

export interface LogEntry {
    timestamp: number;
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'TRACE' | 'FATAL';
    message: string;

    details?: any;
}

export interface McpTraceEntry {
    timestamp: number;
    direction: 'INCOMING_TO_GATEWAY' | 'OUTGOING_FROM_GATEWAY';
    backendId?: string;
    id?: string | number;
    method: string;

    paramsOrResult?: any;

    error?: any;
}
