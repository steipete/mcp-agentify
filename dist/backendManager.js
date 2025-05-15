"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendManager = void 0;
const node_child_process_1 = require("node:child_process");
const node_1 = require("vscode-jsonrpc/node");
const logger_1 = require("./logger"); // Import the utility
// MessageConnection will be used in a later subtask (4.2)
// import type { MessageConnection } from 'vscode-jsonrpc/node';
// Adapter for Pino logger to VSCode JSON-RPC Logger interface
const createRpcLoggerAdapter = (pinoLogger) => ({
    error: (message) => pinoLogger.error(message),
    warn: (message) => pinoLogger.warn(message),
    info: (message) => pinoLogger.info(message),
    log: (message) => pinoLogger.debug(message), // Map VSCodeJsonRpcLogger.log to pinoLogger.debug
});
class BackendManager {
    constructor(logger) {
        this.backendInstances = new Map();
        this.logger = logger.child({ component: 'BackendManager' });
        this.logger.info('BackendManager initialized');
    }
    async initializeBackend(config) {
        if (config.type !== 'stdio') {
            (0, logger_1.logError)({ backendId: config.id, type: config.type }, new Error('Unsupported backend type'), 'BackendManager: Unsupported backend type');
            return false;
        }
        const stdioConfig = config;
        const backendId = stdioConfig.id;
        const backendDisplayName = stdioConfig.displayName || backendId;
        const backendPinoLogger = this.logger.child({ backendId });
        backendPinoLogger.debug('[BM] Top of initializeBackend');
        this.logger.info({ backendId, command: stdioConfig.command, args: stdioConfig.args }, `Initializing backend: ${backendDisplayName}`);
        let backendProcess;
        let connection;
        let backendInstanceToStore;
        try {
            backendPinoLogger.debug('[BM] About to spawn process');
            backendProcess = (0, node_child_process_1.spawn)(stdioConfig.command, stdioConfig.args || [], {
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
            connection = (0, node_1.createMessageConnection)(backendProcess.stdout, backendProcess.stdin, rpcLogger);
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
                (0, logger_1.logError)({ backendId, processError: err.message }, err, 'Backend process critical error');
                const instance = this.backendInstances.get(backendId);
                if (instance)
                    instance.isReady = false;
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
            const initializeParams = {
                processId: process.pid || null,
                clientInfo: { name: 'mcp-agentify-gateway', version: '0.1.0' },
                capabilities: {},
                rootUri: null,
            };
            backendPinoLogger.info({ params: initializeParams }, '[BM] Sending initialize request to backend script');
            // Add timeout for backend initialize request
            const backendInitPromise = connection.sendRequest('initialize', initializeParams);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout: Backend ${backendId} did not respond to initialize within 5s`)), 5000));
            const initializeResult = (await Promise.race([
                backendInitPromise,
                timeoutPromise,
            ]));
            // If timeoutPromise rejected, this line won't be hit due to await throwing.
            // If backendInitPromise resolved, it will be the result.
            backendPinoLogger.info({ capabilities: initializeResult.capabilities }, '[BM] Backend script MCP initialized successfully');
            if (backendInstanceToStore) {
                // Check because it's in a larger try
                backendInstanceToStore.isReady = true;
            }
            this.logger.info({ backendId }, `[BM] Backend ${backendDisplayName} marked as ready.`);
            return true;
        }
        catch (err) {
            backendPinoLogger.error({ errDetails: err, message: err.message }, '[BM] Error during initializeBackend sequence (spawn, connection, or MCP init).');
            (0, logger_1.logError)({ backendId, errorDetail: err.message }, err, 'Error in initializeBackend');
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
    async initializeAllBackends(backendConfigs) {
        this.logger.info({ count: backendConfigs.length }, 'Attempting to initialize all configured backends...');
        const initializationPromises = backendConfigs.map((config) => this.initializeBackend(config).catch((err) => {
            // Ensure individual initializeBackend errors are caught and transformed if necessary,
            // or that they return false consistently.
            // Current initializeBackend returns true/false and logs its own errors.
            this.logger.error({ err, backendId: config.id }, `Caught error directly from initializeBackend for ${config.id}`);
            return false; // Ensure promise resolves to false on error
        }));
        const results = await Promise.all(initializationPromises);
        const successfulInitializations = results.filter((r) => r === true).length;
        const failedCount = backendConfigs.length - successfulInitializations;
        if (failedCount > 0) {
            this.logger.error({ successfulCount: successfulInitializations, failedCount, total: backendConfigs.length }, `${failedCount} backend(s) failed to initialize fully.`);
            // For PoC, we might still allow the gateway to start if some backends fail.
            // However, if any backend failure should prevent gateway init, throw an error here.
            // Spec doesn't explicitly state if all backends MUST succeed for gateway init to succeed.
            // Let's make it strict for now: if one fails, gateway init fails.
            throw new Error(`${failedCount} backend(s) failed to initialize. Check logs for details on specific backends.`);
        }
        if (backendConfigs.length > 0) {
            this.logger.info(`All ${successfulInitializations} configured backend(s) processed for initialization by BackendManager.`);
        }
        else {
            this.logger.info('No backends configured for initialization.');
        }
    }
    getBackendInstance(backendId) {
        return this.backendInstances.get(backendId);
    }
    getAllBackendStates() {
        return Array.from(this.backendInstances.values()).map((instance) => ({
            id: instance.id,
            isReady: instance.isReady,
            config: instance.config,
        }));
    }
    async executeOnBackend(backendId, method, params) {
        const backendLogger = this.logger.child({ backendId, operation: 'executeOnBackend', requestMethod: method });
        const instance = this.backendInstances.get(backendId);
        if (!instance) {
            const errMsg = `Backend ${backendId} not found.`;
            (0, logger_1.logError)({ backendId, method, params }, new Error(errMsg), 'executeOnBackend: Backend not found');
            throw new Error(errMsg);
        }
        if (!instance.connection) {
            const errMsg = `Backend ${backendId} has no active connection.`;
            (0, logger_1.logError)({ backendId, method, params }, new Error(errMsg), 'executeOnBackend: No active connection');
            throw new Error(errMsg);
        }
        if (!instance.isReady) {
            const errMsg = `Backend ${backendId} is not ready.`;
            // This is a common case if init failed, log as warn or info
            backendLogger.warn({ params }, `Attempt to use non-ready backend: ${errMsg}`);
            throw new Error(errMsg);
        }
        backendLogger.debug({ params }, `Sending request to backend method '${method}'`);
        try {
            const result = await instance.connection.sendRequest(method, params);
            backendLogger.debug({ result }, `Received response from backend method '${method}'`);
            return result;
        }
        catch (error) {
            (0, logger_1.logError)({ backendId, method, params, errorDetail: error.message }, error, `Error during request to backend method '${method}'`);
            throw error;
        }
    }
    async shutdownAllBackends() {
        this.logger.info('Shutting down all backends...');
        const shutdownPromises = [];
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
                    }
                    catch (err) {
                        (0, logger_1.logError)({ backendId, errorDetail: err.message }, err, 'Error sending shutdown/exit notifications');
                    }
                    instance.connection.dispose();
                    backendPinoLogger.info('Connection disposed.');
                }
                if (instance.process && !instance.process.killed) {
                    backendPinoLogger.info('Killing process with SIGTERM.');
                    instance.process.kill('SIGTERM');
                    await new Promise((resolve) => {
                        const timeout = setTimeout(() => {
                            if (instance.process && !instance.process.killed) {
                                backendPinoLogger.warn('Process did not exit gracefully after SIGTERM, sending SIGKILL.');
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
exports.BackendManager = BackendManager;
//# sourceMappingURL=backendManager.js.map