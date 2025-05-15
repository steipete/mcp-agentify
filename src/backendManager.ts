import { spawn, type ChildProcess } from 'node:child_process';
import type { Logger as PinoLoggerBase } from 'pino';
import type { PinoLogLevel } from './logger';
import type {
    // LSP types
    InitializeParams,
    InitializeResult,
} from 'vscode-languageserver-protocol';
import {
    // Node-specific values (classes/functions)
    createMessageConnection,
    // NotificationType, // Removed as unused
    // RequestType       // Removed as unused
} from 'vscode-jsonrpc/node';
import type {
    // Node-specific types (interfaces/type aliases)
    MessageConnection,
    Logger as VSCodeJsonRpcLogger,
} from 'vscode-jsonrpc/node';
import type { BackendConfig, BackendInstance, BackendStdioConfig, McpTraceEntry } from './interfaces';
import { logError as appLogError } from './logger'; // Import the utility
import { EventEmitter } from 'node:events'; // Import EventEmitter
// MessageConnection will be used in a later subtask (4.2)
// import type { MessageConnection } from 'vscode-jsonrpc/node';

// Adapter for Pino logger to VSCode JSON-RPC Logger interface
const createRpcLoggerAdapter = (pinoLogger: PinoLoggerBase<PinoLogLevel>): VSCodeJsonRpcLogger => ({
    error: (message: string) => pinoLogger.error(message),
    warn: (message: string) => pinoLogger.warn(message),
    info: (message: string) => pinoLogger.info(message),
    log: (message: string) => pinoLogger.debug(message), // Map VSCodeJsonRpcLogger.log to pinoLogger.debug
});

export class BackendManager extends EventEmitter { // Extend EventEmitter
    private backendInstances: Map<string, BackendInstance> = new Map();
    private logger: PinoLoggerBase<PinoLogLevel>;

    constructor(logger: PinoLoggerBase<PinoLogLevel>) {
        super(); // Call super constructor
        this.logger = logger.child({ component: 'BackendManager' });
        this.logger.info('BackendManager initialized');
    }

    public async initializeBackend(config: BackendConfig): Promise<boolean> {
        if (config.type !== 'stdio') {
            appLogError(
                { backendId: config.id, type: config.type },
                new Error('Unsupported backend type'),
                'BackendManager: Unsupported backend type',
            );
            return false;
        }
        const stdioConfig = config as BackendStdioConfig;
        const backendId = stdioConfig.id;
        const backendDisplayName = stdioConfig.displayName || backendId;
        const backendPinoLogger = this.logger.child({ backendId });

        backendPinoLogger.debug('[BM] Top of initializeBackend');
        this.logger.info(
            { backendId, command: stdioConfig.command, args: stdioConfig.args },
            `Initializing backend: ${backendDisplayName}`,
        );

        let backendProcess: ChildProcess | undefined;
        let connection: MessageConnection | undefined;
        let backendInstanceToStore: BackendInstance | undefined;

        try {
            backendPinoLogger.debug('[BM] About to spawn process');
            backendProcess = spawn(stdioConfig.command, stdioConfig.args || [], {
                shell: process.platform === 'win32',
                env: { ...process.env, ...stdioConfig.env },
                stdio: 'pipe',
            });
            backendPinoLogger.debug({ pid: backendProcess.pid }, '[BM] Process spawned');

            if (!backendProcess || !backendProcess.stdout || !backendProcess.stdin) {
                backendPinoLogger.error('[BM] Spawned process is missing required stdio streams (stdout/stdin).');
                throw new Error('Spawned process missing required stdio streams.');
            }

            const rpcLogger = createRpcLoggerAdapter(backendPinoLogger.child({ component: 'jsonrpc' }));
            backendPinoLogger.debug('[BM] About to create message connection with guaranteed streams.');
            connection = createMessageConnection(backendProcess.stdout, backendProcess.stdin, rpcLogger);
            backendPinoLogger.debug('[BM] Message connection created');

            backendInstanceToStore = {
                id: backendId,
                config: stdioConfig,
                process: backendProcess,
                connection,
                isReady: false,
            };
            this.backendInstances.set(backendId, backendInstanceToStore);
            backendPinoLogger.debug('[BM] Backend instance stored in map');

            // Setup event handlers for the process (moved before listen/initialize)
            backendProcess.on('error', (err) => {
                appLogError({ backendId, processError: err.message }, err, 'Backend process critical error');
                const instance = this.backendInstances.get(backendId);
                if (instance) instance.isReady = false;
            });

            backendProcess.on('exit', (code, signal) => {
                backendPinoLogger.info({ code, signal }, 'Backend process exited');
                const instance = this.backendInstances.get(backendId);
                if (instance) {
                    instance.isReady = false;
                    instance.connection?.dispose();
                }
                this.backendInstances.delete(backendId);
            });

            connection.listen();
            backendPinoLogger.info('[BM] JSON-RPC connection listener started.');

            const initializeParams: InitializeParams = {
                processId: process.pid || null,
                clientInfo: { name: 'mcp-agentify-gateway', version: '0.1.0' },
                capabilities: {},
                rootUri: null,
            };
            backendPinoLogger.info({ params: initializeParams }, '[BM] Sending initialize request to backend script');

            // Add timeout for backend initialize request
            const backendInitPromise = connection.sendRequest('initialize', initializeParams);
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(
                    () => reject(new Error(`Timeout: Backend ${backendId} did not respond to initialize within 5s`)),
                    5000,
                ),
            );

            const initializeResult: InitializeResult = (await Promise.race([
                backendInitPromise,
                timeoutPromise,
            ])) as InitializeResult;
            // If timeoutPromise rejected, this line won't be hit due to await throwing.
            // If backendInitPromise resolved, it will be the result.

            backendPinoLogger.info(
                { capabilities: initializeResult.capabilities },
                '[BM] Backend script MCP initialized successfully',
            );

            if (backendInstanceToStore) {
                // Check because it's in a larger try
                backendInstanceToStore.isReady = true;
            }
            this.logger.info({ backendId }, `[BM] Backend ${backendDisplayName} marked as ready.`);
            return true;
        } catch (err: unknown) {
            backendPinoLogger.error(
                { errDetails: err, message: (err as Error).message },
                '[BM] Error during initializeBackend sequence (spawn, connection, or MCP init).',
            );
            appLogError({ backendId, errorDetail: (err as Error).message }, err as Error, 'Error in initializeBackend');

            // Cleanup partially created backend if it exists in the map
            const instance = this.backendInstances.get(backendId);
            if (instance) {
                instance.process?.kill();
                instance.connection?.dispose();
                this.backendInstances.delete(backendId);
            }
            return false;
        }
    }

    public async initializeAllBackends(backendConfigs: BackendConfig[]): Promise<void> {
        this.logger.info({ count: backendConfigs.length }, 'Attempting to initialize all configured backends...');

        const initializationPromises = backendConfigs.map((config) =>
            this.initializeBackend(config).catch((err) => {
                // Ensure individual initializeBackend errors are caught and transformed if necessary,
                // or that they return false consistently.
                // Current initializeBackend returns true/false and logs its own errors.
                this.logger.error(
                    { err, backendId: config.id },
                    `Caught error directly from initializeBackend for ${config.id}`,
                );
                return false; // Ensure promise resolves to false on error
            }),
        );

        const results = await Promise.all(initializationPromises);

        const successfulInitializations = results.filter((r) => r === true).length;
        const failedCount = backendConfigs.length - successfulInitializations;

        if (failedCount > 0) {
            this.logger.error(
                { successfulCount: successfulInitializations, failedCount, total: backendConfigs.length },
                `${failedCount} backend(s) failed to initialize fully.`,
            );
            // For PoC, we might still allow the gateway to start if some backends fail.
            // However, if any backend failure should prevent gateway init, throw an error here.
            // Spec doesn't explicitly state if all backends MUST succeed for gateway init to succeed.
            // Let's make it strict for now: if one fails, gateway init fails.
            throw new Error(
                `${failedCount} backend(s) failed to initialize. Check logs for details on specific backends.`,
            );
        }

        if (backendConfigs.length > 0) {
            this.logger.info(
                `All ${successfulInitializations} configured backend(s) processed for initialization by BackendManager.`,
            );
        } else {
            this.logger.info('No backends configured for initialization.');
        }
    }

    public getBackendInstance(backendId: string): BackendInstance | undefined {
        return this.backendInstances.get(backendId);
    }

    public getAllBackendStates(): Pick<BackendInstance, 'id' | 'isReady' | 'config'>[] {
        return Array.from(this.backendInstances.values()).map((instance) => ({
            id: instance.id,
            isReady: instance.isReady,
            config: instance.config,
        }));
    }

    public async executeOnBackend(backendId: string, method: string, params: any): Promise<any> {
        const backendLogger = this.logger.child({ backendId, operation: 'executeOnBackend', requestMethod: method });
        const instance = this.backendInstances.get(backendId);

        if (!instance) {
            const errMsg = `Backend ${backendId} not found.`;
            appLogError({ backendId, method, params }, new Error(errMsg), 'executeOnBackend: Backend not found');
            throw new Error(errMsg);
        }
        if (!instance.connection) {
            const errMsg = `Backend ${backendId} has no active connection.`;
            appLogError({ backendId, method, params }, new Error(errMsg), 'executeOnBackend: No active connection');
            throw new Error(errMsg);
        }
        if (!instance.isReady) {
            const errMsg = `Backend ${backendId} is not ready.`;
            // This is a common case if init failed, log as warn or info
            backendLogger.warn({ params }, `Attempt to use non-ready backend: ${errMsg}`);
            throw new Error(errMsg);
        }

        backendLogger.debug({ params }, `Sending request to backend method '${method}'`);
        this.emitMcpTrace('OUTGOING_FROM_GATEWAY', backendId, undefined /* id */, method, params);
        try {
            const result = await instance.connection.sendRequest(method, params);
            backendLogger.debug({ result }, `Received response from backend method '${method}'`);
            this.emitMcpTrace('INCOMING_TO_GATEWAY', backendId, undefined /* id */, method, result);
            return result;
        } catch (error) {
            appLogError(
                { backendId, method, params, errorDetail: (error as Error).message },
                error as Error,
                `Error during request to backend method '${method}'`,
            );
            // Emit trace for error response from backend
            this.emitMcpTrace('INCOMING_TO_GATEWAY', backendId, undefined /* id */, method, undefined, error as Error);
            throw error;
        }
    }

    private emitMcpTrace(direction: McpTraceEntry['direction'], backendId: string | undefined, id: string | number | undefined, method: string, paramsOrResult?: any, error?: Error) {
        const traceEntry: McpTraceEntry = {
            timestamp: Date.now(),
            direction,
            backendId,
            id: id !== undefined ? String(id) : undefined, // Ensure id is string or undefined
            method,
            paramsOrResult: this.sanitizeTraceData(paramsOrResult),
            error: error ? { message: error.message, name: error.name, stack: error.stack?.substring(0, 200) } : undefined,
        };
        this.emit('mcpTrace', traceEntry);
    }

    // Basic sanitization for trace data (can be expanded)
    private sanitizeTraceData(data: any): any {
        if (typeof data === 'string' && data.length > 500) {
            return `${data.substring(0, 497)}...`;
        }
        // Basic check for objects that might be too large or contain sensitive info
        // This is very rudimentary; a proper solution would involve deeper inspection or schema-based filtering
        if (typeof data === 'object' && data !== null) {
            try {
                const serialized = JSON.stringify(data);
                if (serialized.length > 1024) { // Arbitrary limit for PoC
                    return { summary: 'Object too large, truncated for trace', keys: Object.keys(data) };
                }
            } catch (e) {
                return { summary: 'Could not serialize object for trace' };
            }
        }
        return data;
    }

    public async shutdownAllBackends(): Promise<void> {
        this.logger.info('Shutting down all backends...');
        const shutdownPromises: Promise<void>[] = [];

        this.backendInstances.forEach((instance, backendId) => {
            const backendPinoLogger = this.logger.child({ backendId }); // Renamed for clarity from original
            backendPinoLogger.info('Attempting graceful shutdown for backend');

            const shutdownPromise = (async () => {
                if (instance.connection) {
                    try {
                        if (instance.isReady) {
                            backendPinoLogger.info('Sending shutdown notification');
                            instance.connection.sendNotification('shutdown');
                            backendPinoLogger.info('Shutdown notification sent. Sending exit notification.');
                            instance.connection.sendNotification('exit');
                            backendPinoLogger.info('Exit notification sent.');
                        }
                    } catch (err) {
                        appLogError(
                            { backendId, errorDetail: (err as Error).message },
                            err as Error,
                            'Error sending shutdown/exit notifications',
                        );
                    }
                    instance.connection.dispose();
                    backendPinoLogger.info('Connection disposed.');
                }

                if (instance.process && !instance.process.killed) {
                    backendPinoLogger.info('Killing process with SIGTERM.');
                    instance.process.kill('SIGTERM');
                    await new Promise<void>((resolve) => {
                        const timeout = setTimeout(() => {
                            if (instance.process && !instance.process.killed) {
                                backendPinoLogger.warn(
                                    'Process did not exit gracefully after SIGTERM, sending SIGKILL.',
                                );
                                instance.process.kill('SIGKILL');
                            }
                            resolve();
                        }, 5000);
                        instance.process?.on('exit', () => {
                            clearTimeout(timeout);
                            backendPinoLogger.info('Process exited.');
                            resolve();
                        });
                    });
                }
                // Process exit handler should remove it, but ensure it's gone.
                this.backendInstances.delete(backendId);
            })();
            shutdownPromises.push(shutdownPromise);
        });

        await Promise.all(shutdownPromises);
        this.logger.info('All backend shutdown procedures attempted.');
    }
}
