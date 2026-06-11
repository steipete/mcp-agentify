import { EventEmitter } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Logger } from 'pino';
import type { BackendConfig, BackendInstance, BackendTool, BackendToolResult, McpTraceEntry } from './interfaces';
import type { PinoLogLevel } from './logger';
import { redactBackendConfig, redactKnownSecrets, redactValue } from './redaction';
import { getPackageVersion } from './utils';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function expandEnvironmentValue(value: string): string {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, variableName: string) => {
        const resolved = process.env[variableName];
        if (resolved === undefined) {
            throw new Error(`Backend environment references missing variable ${variableName}.`);
        }
        return resolved;
    });
}

export class BackendManager extends EventEmitter {
    private readonly backendInstances = new Map<string, BackendInstance>();
    private readonly backendSecrets = new Map<string, string[]>();
    private logger: Logger<PinoLogLevel>;

    constructor(logger: Logger<PinoLogLevel>) {
        super();
        this.logger = logger.child({ component: 'BackendManager' });
    }

    public updateLogger(logger: Logger<PinoLogLevel>): void {
        this.logger = logger.child({ component: 'BackendManager' });
    }

    public async initializeBackend(config: BackendConfig): Promise<void> {
        const backendLogger = this.logger.child({ backendId: config.id });
        backendLogger.info({ config: redactBackendConfig(config) }, 'Initializing backend.');

        const environment = getDefaultEnvironment();
        const sensitiveValues: string[] = [];
        for (const variableName of config.inheritEnv) {
            const value = process.env[variableName];
            if (value === undefined) {
                throw new Error(`Backend ${config.id} requires missing environment variable ${variableName}.`);
            }
            environment[variableName] = value;
            sensitiveValues.push(value);
        }
        for (const [key, value] of Object.entries(config.env)) {
            const expandedValue = expandEnvironmentValue(value);
            environment[key] = expandedValue;
            sensitiveValues.push(expandedValue);
        }

        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: environment,
            stderr: 'pipe',
        });
        let transportClosed = false;
        transport.onclose = () => {
            transportClosed = true;
            const instance = this.backendInstances.get(config.id);
            if (instance?.transport === transport) {
                instance.isReady = false;
                instance.error = 'Backend transport closed.';
                this.emit('backendUnavailable', config.id);
                backendLogger.warn('Backend transport closed.');
            }
        };
        transport.onerror = (error) => {
            const message = redactKnownSecrets(error.message, sensitiveValues);
            backendLogger.warn({ error: { name: error.name, message } }, 'Backend transport error.');
        };
        transport.stderr?.on('data', (chunk) => {
            const message = redactKnownSecrets(String(chunk).trim(), sensitiveValues);
            if (message) {
                backendLogger.debug({ backendStderr: message }, 'Backend stderr.');
            }
        });

        const client = new Client({ name: 'mcp-agentify', version: getPackageVersion() }, { capabilities: {} });

        try {
            await withTimeout(
                client.connect(transport),
                config.startupTimeoutMs,
                `Backend ${config.id} did not complete MCP initialization within ${config.startupTimeoutMs}ms.`,
            );
            const listToolsResult = await withTimeout(
                client.listTools(),
                config.startupTimeoutMs,
                `Backend ${config.id} did not list tools within ${config.startupTimeoutMs}ms.`,
            );
            const tools: BackendTool[] = listToolsResult.tools.map((tool) => ({
                backendId: config.id,
                backendDisplayName: config.displayName || config.id,
                name: tool.name,
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: tool.annotations,
            }));
            if (transportClosed) {
                throw new Error(`Backend ${config.id} transport closed during initialization.`);
            }

            this.backendInstances.set(config.id, {
                id: config.id,
                config,
                client,
                transport,
                tools,
                isReady: true,
            });
            this.backendSecrets.set(config.id, sensitiveValues);
            backendLogger.info({ toolCount: tools.length }, 'Backend ready.');
        } catch (error) {
            await transport.close().catch(() => undefined);
            const message = redactKnownSecrets(error instanceof Error ? error.message : String(error), sensitiveValues);
            backendLogger.error(
                { error: { name: error instanceof Error ? error.name : 'Error', message } },
                'Backend initialization failed.',
            );
            throw new Error(`Backend ${config.id} failed to initialize: ${message}`);
        }
    }

    public async initializeAllBackends(configs: BackendConfig[]): Promise<void> {
        const results = await Promise.allSettled(configs.map((config) => this.initializeBackend(config)));
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failures.length > 0) {
            await this.shutdownAllBackends();
            throw new Error(failures.map((failure) => String(failure.reason)).join('; '));
        }
    }

    public getAvailableTools(): BackendTool[] {
        return Array.from(this.backendInstances.values())
            .filter((instance) => instance.isReady)
            .flatMap((instance) => instance.tools);
    }

    public getAllBackendStates(): Array<{
        id: string;
        displayName: string;
        isReady: boolean;
        toolCount: number;
        error?: string;
    }> {
        return Array.from(this.backendInstances.values()).map((instance) => ({
            id: instance.id,
            displayName: instance.config.displayName || instance.id,
            isReady: instance.isReady,
            toolCount: instance.tools.length,
            error: instance.error,
        }));
    }

    public async executeOnBackend(
        backendId: string,
        toolName: string,
        arguments_: Record<string, unknown>,
    ): Promise<BackendToolResult> {
        const instance = this.backendInstances.get(backendId);
        if (!instance?.isReady) {
            throw new Error(`Backend ${backendId} is not ready.`);
        }
        if (!instance.tools.some((tool) => tool.name === toolName)) {
            throw new Error(`Backend ${backendId} does not expose tool ${toolName}.`);
        }

        this.emitTrace('OUTGOING_FROM_GATEWAY', backendId, toolName, arguments_);
        try {
            const result = await instance.client.callTool({ name: toolName, arguments: arguments_ });
            this.emitTrace('INCOMING_TO_GATEWAY', backendId, toolName, result);
            return result as BackendToolResult;
        } catch (error) {
            this.emitTrace('INCOMING_TO_GATEWAY', backendId, toolName, undefined, error);
            const message = redactKnownSecrets(
                error instanceof Error ? error.message : String(error),
                this.backendSecrets.get(backendId) || [],
            );
            this.logger.error(
                { backendId, toolName, error: { name: error instanceof Error ? error.name : 'Error', message } },
                'Backend tool call failed.',
            );
            throw new Error(message);
        }
    }

    public async shutdownAllBackends(): Promise<void> {
        const instances = Array.from(this.backendInstances.values());
        this.backendInstances.clear();
        this.backendSecrets.clear();
        await Promise.allSettled(
            instances.map(async (instance) => {
                instance.isReady = false;
                await instance.client.close();
            }),
        );
    }

    private emitTrace(
        direction: McpTraceEntry['direction'],
        backendId: string,
        method: string,
        paramsOrResult?: unknown,
        error?: unknown,
    ): void {
        const secrets = this.backendSecrets.get(backendId) || [];
        this.emit('mcpTrace', {
            timestamp: Date.now(),
            direction,
            backendId,
            method,
            paramsOrResult: redactValue(paramsOrResult, secrets),
            error:
                error instanceof Error
                    ? { name: error.name, message: redactKnownSecrets(error.message, secrets) }
                    : redactValue(error, secrets),
        } satisfies McpTraceEntry);
    }
}
