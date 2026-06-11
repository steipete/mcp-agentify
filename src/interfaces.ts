import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
    AgentifyOrchestrateTaskParams as ZodAgentifyOrchestrateTaskParams,
    BackendConfig as ZodBackendConfig,
    BackendStdioConfig as ZodBackendStdioConfig,
    GatewayOptions as ZodGatewayOptions,
    OrchestrationContext as ZodOrchestrationContext,
    Plan as ZodPlan,
} from './schemas';

export type BackendStdioConfig = ZodBackendStdioConfig;
export type BackendConfig = ZodBackendConfig;
export type GatewayOptions = ZodGatewayOptions;
export type OrchestrationContext = ZodOrchestrationContext;
export type AgentifyOrchestrateTaskParams = ZodAgentifyOrchestrateTaskParams;
export type Plan = ZodPlan;

export interface BackendTool {
    backendId: string;
    backendDisplayName: string;
    name: string;
    title?: string;
    description?: string;
    inputSchema: Tool['inputSchema'];
    annotations?: Tool['annotations'];
}

export interface BackendInstance {
    id: string;
    config: BackendConfig;
    client: Client;
    transport: StdioClientTransport;
    tools: BackendTool[];
    isReady: boolean;
    error?: string;
}

export type BackendToolResult = CallToolResult;

export interface LogEntry {
    timestamp: number;
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'TRACE' | 'FATAL';
    message: string;
    details?: unknown;
}

export interface McpTraceEntry {
    timestamp: number;
    direction: 'INCOMING_TO_GATEWAY' | 'OUTGOING_FROM_GATEWAY';
    backendId?: string;
    method: string;
    paramsOrResult?: unknown;
    error?: unknown;
}
