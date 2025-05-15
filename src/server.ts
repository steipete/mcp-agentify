import { createMessageConnection, ErrorCodes, ResponseError, RequestType } from 'vscode-jsonrpc/node';
import type {
    MessageConnection,
    RequestMessage,
    // InitializeParams, // Moved to vscode-languageserver-protocol
    // InitializeResult, // Moved to vscode-languageserver-protocol
} from 'vscode-jsonrpc/node';
import type {
    InitializeParams, // From LSP
    InitializeResult, // From LSP
    ServerCapabilities,
    CancellationToken,
} from 'vscode-languageserver-protocol';

import type { Logger as PinoLoggerType } from 'pino';
import { initializeLogger, getLogger, type PinoLogLevel } from './logger';
import { BackendManager } from './backendManager';
import { LLMOrchestratorService } from './llmOrchestrator';
import { DebugWebServer } from './debugWebServer';
import type { GatewayOptions, AgentifyOrchestrateTaskParams, Plan, McpTraceEntry } from './interfaces';
import { GatewayOptionsSchema, AgentifyOrchestrateTaskParamsSchema } from './schemas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let pinoLogger: PinoLoggerType<PinoLogLevel>;
let gatewayOptions: GatewayOptions | undefined;
let backendManager: BackendManager | undefined;
let llmOrchestrator: LLMOrchestratorService | undefined;
let debugWebServerInstance: DebugWebServer | undefined;

const tempConsoleLogger = {
    error: (message: string) => console.error(`[TEMP ERROR] ${message}`),
    warn: (message: string) => console.warn(`[TEMP WARN] ${message}`),
    info: (message: string) => console.error(`[TEMP INFO] ${message}`),
    log: (message: string) => console.error(`[TEMP LOG] ${message}`),
};

function getPackageVersion(): string {
    try {
        const packageJsonPath = resolve(process.cwd(), 'package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        return packageJson.version || '0.1.0';
    } catch (error) {
        (pinoLogger || tempConsoleLogger).warn({ err: error }, 'Could not read package.json version, defaulting.');
        return '0.1.0';
    }
}

export async function startAgentifyServer(initialCliOptions?: Partial<GatewayOptions>) {
    // --- START EARLY INITIALIZATION ---
    const earlyLogLevel: PinoLogLevel = initialCliOptions?.logLevel || 'info';
    let tempPinoLogger: PinoLoggerType<PinoLogLevel> = initializeLogger({ logLevel: earlyLogLevel });

    if (initialCliOptions?.DEBUG_PORT && initialCliOptions.DEBUG_PORT > 0) {
        tempPinoLogger.info(
            `[GATEWAY SERVER PRE-INIT] DEBUG_PORT ${initialCliOptions.DEBUG_PORT} found in initial options. Attempting to start DebugWebServer early.`,
        );
        try {
            const partialGatewayOptsForDebug: Partial<GatewayOptions> = {
                DEBUG_PORT: initialCliOptions.DEBUG_PORT,
                logLevel: earlyLogLevel,
            };
            debugWebServerInstance = new DebugWebServer(
                initialCliOptions.DEBUG_PORT,
                tempPinoLogger,
                undefined,
                partialGatewayOptsForDebug as GatewayOptions,
            );
            debugWebServerInstance.start();

            const debugStreamForPino = debugWebServerInstance?.getLogStream();
            if (debugStreamForPino) {
                tempPinoLogger = initializeLogger(
                    { logLevel: earlyLogLevel }, undefined, debugStreamForPino,
                );
                debugWebServerInstance.updateLogger(tempPinoLogger);
                tempPinoLogger.info(
                    '[GATEWAY SERVER PRE-INIT] DebugWebServer started and logger updated with its stream.',
                );
            } else {
                tempPinoLogger.info(
                    '[GATEWAY SERVER PRE-INIT] DebugWebServer started (no stream returned for logger).',
                );
            }
        } catch (err) {
            tempPinoLogger.error({ err }, '[GATEWAY SERVER PRE-INIT] Failed to start DebugWebServer early.');
        }
    }
    pinoLogger = tempPinoLogger;
    // --- END EARLY INITIALIZATION ---

    const connection: MessageConnection = createMessageConnection(
        process.stdin,
        process.stdout,
        tempConsoleLogger as any,
    );

    connection.onClose(() => {
        getLogger().info('Client connection closed.');
        if (backendManager) {
            backendManager
                .shutdownAllBackends()
                .catch((err) =>
                    getLogger().error(
                        { err },
                        `Error during shutdownAllBackends on connection close: ${(err as Error).message}`,
                    ),
                );
        }
    });

    connection.onError((error) => {
        getLogger().error({ error }, `Connection error: ${JSON.stringify(error)}`);
    });

    connection.onNotification('shutdown', async () => {
        getLogger().info('Received shutdown notification from client. Initiating graceful shutdown...');
        if (debugWebServerInstance) {
            await debugWebServerInstance
                .stop()
                .catch((err) => getLogger().error({ err }, 'Error stopping debug web server during shutdown'));
        }
        if (backendManager) {
            try {
                await backendManager.shutdownAllBackends();
                getLogger().info('All backends successfully shut down.');
            } catch (err) {
                getLogger().error({ err }, 'Error during shutdownAllBackends call from shutdown notification.');
            }
        }
    });

    connection.onNotification('exit', () => {
        getLogger().info('Received exit notification from client. Exiting process now.');
        if (debugWebServerInstance) {
            debugWebServerInstance
                .stop()
                .catch((err) => getLogger().error({ err }, 'Error stopping debug web server during exit'));
        }
        if (backendManager) {
            backendManager.shutdownAllBackends().catch((err) => {
                getLogger().error({ err }, 'Error during final backend shutdown on exit notification.');
            });
        }
        process.exit(0);
    });

    connection.onRequest(
        new RequestType<InitializeParams, InitializeResult, ResponseError<undefined>>('initialize'),
        async (params: InitializeParams, _token: CancellationToken): Promise<InitializeResult> => {
            const handlerLogger = pinoLogger || tempConsoleLogger;
            handlerLogger.info({ initParamsReceived: params }, "[GATEWAY SERVER] 'initialize' handler started.");
            try {
                pinoLogger.info({ initParamsReceived: params }, "[GATEWAY SERVER] Received 'initialize' request.");

                const mergedOptionsFromClientAndCli = {
                    ...(initialCliOptions || {}),
                    ...(params.initializationOptions || {}),
                };
                const validationResult = GatewayOptionsSchema.safeParse(mergedOptionsFromClientAndCli);
                if (!validationResult.success) {
                    const errorMsg = 'Invalid initialization options provided.';
                    tempConsoleLogger.error(`${errorMsg} Errors: ${JSON.stringify(validationResult.error.format())}`);
                    throw new ResponseError(ErrorCodes.InvalidParams, errorMsg, {
                        validationErrors: validationResult.error.format(),
                    });
                }
                gatewayOptions = validationResult.data;
                const apiKeyToUse = process.env.OPENAI_API_KEY || gatewayOptions.OPENAI_API_KEY;
                if (!apiKeyToUse) {
                    const errorMsg =
                        'OpenAI API Key is required but not found in environment variables or initialization options.';
                    tempConsoleLogger.error(errorMsg);
                    throw new ResponseError(ErrorCodes.InvalidParams, errorMsg, { missingKey: 'OPENAI_API_KEY' });
                }

                if (gatewayOptions.DEBUG_PORT && gatewayOptions.DEBUG_PORT > 0) {
                    if (!debugWebServerInstance) {
                        pinoLogger.info(
                            `[GATEWAY SERVER] DEBUG_PORT ${gatewayOptions.DEBUG_PORT} specified by client. Initializing DebugWebServer.`,
                        );
                        const loggerForNewDebugServer: PinoLoggerType<PinoLogLevel> = pinoLogger;

                        try {
                            debugWebServerInstance = new DebugWebServer(
                                gatewayOptions.DEBUG_PORT,
                                loggerForNewDebugServer,
                                undefined,
                                gatewayOptions,
                            );
                            debugWebServerInstance.start();

                            const newDebugStream = debugWebServerInstance.getLogStream();
                            if (newDebugStream) {
                                pinoLogger = initializeLogger(
                                    { logLevel: gatewayOptions.logLevel as PinoLogLevel },
                                    undefined,
                                    newDebugStream,
                                );
                                debugWebServerInstance.updateLogger(pinoLogger);
                                pinoLogger.info(
                                    '[GATEWAY SERVER] DebugWebServer started by client options and logger updated.',
                                );
                            } else {
                                pinoLogger.info(
                                    '[GATEWAY SERVER] DebugWebServer started by client options (no stream returned for logger).',
                                );
                            }
                        } catch (err) {
                            pinoLogger.error(
                                { err }, 
                                '[GATEWAY SERVER] Failed to start DebugWebServer as per client options.',
                            );
                        }
                    } else {
                        if (gatewayOptions.logLevel && gatewayOptions.logLevel !== pinoLogger.level) {
                            pinoLogger.info(
                                `[GATEWAY SERVER] Log level changed by client. Re-initializing logger to ${gatewayOptions.logLevel}.`,
                            );
                            const debugStream = debugWebServerInstance.getLogStream();
                            pinoLogger = initializeLogger(
                                { logLevel: gatewayOptions.logLevel as PinoLogLevel },
                                undefined, 
                                debugStream,
                            );
                        }
                        debugWebServerInstance.updateLogger(pinoLogger);
                        pinoLogger.info(
                            '[GATEWAY SERVER] DebugWebServer was already running; logger (if changed) and gateway options updated.',
                        );
                    }
                } else if (debugWebServerInstance) {
                    pinoLogger.warn(
                        '[GATEWAY SERVER] Client did not specify a DEBUG_PORT, but DebugWebServer was running. It will continue to run based on initial (ENV) settings.',
                    );
                }

                if (gatewayOptions.logLevel && gatewayOptions.logLevel !== pinoLogger.level) {
                    pinoLogger.info(
                        `[GATEWAY SERVER] Log level changing from ${pinoLogger.level} to ${gatewayOptions.logLevel} based on final merged options.`,
                    );
                    const currentDebugStream = debugWebServerInstance?.getLogStream();
                    pinoLogger = initializeLogger(
                        { logLevel: gatewayOptions.logLevel as PinoLogLevel },
                        undefined,
                        currentDebugStream,
                    );
                    if (debugWebServerInstance) {
                        debugWebServerInstance.updateLogger(pinoLogger);
                    }
                }

                pinoLogger.info(
                    { gatewayOptions: { ...gatewayOptions, OPENAI_API_KEY: '***' } },
                    '[GATEWAY SERVER] Options processed. Logger initialized.',
                );
                pinoLogger.info('[GATEWAY SERVER] Initializing BackendManager...');
                backendManager = new BackendManager(pinoLogger);
                try {
                    await backendManager.initializeAllBackends(gatewayOptions.backends);
                    pinoLogger.info('[GATEWAY SERVER] BackendManager initialized all backends successfully.');
                    backendManager.on('mcpTrace', (traceEntry: McpTraceEntry) => {
                        if (debugWebServerInstance) {
                            debugWebServerInstance.addMcpTrace(traceEntry);
                        }
                    });
                } catch (err: unknown) {
                    const backendInitErrorMsg = `Critical error during BackendManager initialization: ${(err as Error).message}`;
                    pinoLogger.error({ err }, `[GATEWAY SERVER] ${backendInitErrorMsg}`);
                    throw new ResponseError(-32006, backendInitErrorMsg, { originalError: (err as Error).message });
                }
                pinoLogger.info('[GATEWAY SERVER] Initializing LLMOrchestratorService...');
                try {
                    llmOrchestrator = new LLMOrchestratorService(apiKeyToUse, gatewayOptions.backends, pinoLogger);
                    pinoLogger.info('[GATEWAY SERVER] LLMOrchestratorService initialized.');
                } catch (err: unknown) {
                    const llmInitErrorMsg = `Fatal error initializing LLMOrchestratorService: ${(err as Error).message}`;
                    pinoLogger.error({ err }, `[GATEWAY SERVER] ${llmInitErrorMsg}`);
                    throw new ResponseError(-32005, llmInitErrorMsg, { originalError: (err as Error).message });
                }

                if (debugWebServerInstance && backendManager) {
                    pinoLogger.info(
                        '[GATEWAY SERVER] DebugWebServer (if running) can now access BackendManager (if needed by its API).',
                    );
                }

                pinoLogger.info(
                    '[GATEWAY SERVER] SUCCESSFULLY COMPLETED ALL INITIALIZATION LOGIC. ABOUT TO RETURN InitializeResult.',
                );
                const serverCapabilities: ServerCapabilities = {};
                return {
                    capabilities: serverCapabilities,
                    serverInfo: { name: 'mcp-agentify', version: getPackageVersion() },
                };
            } catch (error: unknown) {
                const finalLogger = pinoLogger || tempConsoleLogger;
                finalLogger.error(
                    { errCaughtInInitialize: error },
                    "[GATEWAY SERVER] Error caught at top of 'initialize' handler.",
                );
                if (error instanceof ResponseError) {
                    throw error;
                }
                throw new ResponseError(ErrorCodes.InternalError, 'Internal server error during initialization.', {
                    originalMessage: (error as Error).message,
                });
            }
        },
    );

    connection.onRequest(
        'agentify/orchestrateTask',
        async (
            requestParams: AgentifyOrchestrateTaskParams,
            _cancellationToken: CancellationToken,
            rpcMessage?: RequestMessage,
        ) => {
            const handlerLogger = getLogger();
            if (debugWebServerInstance && rpcMessage) {
                const traceEntry: McpTraceEntry = {
                    timestamp: Date.now(),
                    direction: 'INCOMING_TO_GATEWAY',
                    backendId: undefined,
                    id: rpcMessage.id !== undefined ? String(rpcMessage.id) : undefined,
                    method: rpcMessage.method,
                    paramsOrResult: requestParams,
                };
                debugWebServerInstance.addMcpTrace(traceEntry);
            }

            handlerLogger.info(
                { method: rpcMessage?.method, id: rpcMessage?.id, params: requestParams },
                "[GATEWAY SERVER] 'agentify/orchestrateTask' handler started.",
            );
            try {
                const validatedParams = AgentifyOrchestrateTaskParamsSchema.safeParse(requestParams);
                if (!validatedParams.success) {
                    handlerLogger.error(
                        { errors: validatedParams.error.format(), requestParams },
                        "Invalid parameters for 'agentify/orchestrateTask'.",
                    );
                    throw new ResponseError(ErrorCodes.InvalidParams, 'Invalid parameters provided.', {
                        validationErrors: validatedParams.error.format(),
                    });
                }
                if (!llmOrchestrator || !backendManager || !gatewayOptions) {
                    handlerLogger.warn(
                        "'agentify/orchestrateTask' called before gateway was fully initialized (llm, backend, or options missing).",
                    );
                    throw new ResponseError(
                        -32001,
                        'Gateway not fully initialized. Please wait or ensure the initialize request was successful.',
                    );
                }
                handlerLogger.debug('Calling LLM orchestrator...');
                let plan: Plan | null;
                try {
                    plan = await llmOrchestrator.orchestrate(validatedParams.data.query, validatedParams.data.context);
                } catch (err) {
                    handlerLogger.error({ err }, 'LLM orchestrator threw an unexpected error.');
                    throw new ResponseError(-32003, 'Error during AI orchestration step.');
                }
                if (!plan) {
                    handlerLogger.warn(
                        { query: validatedParams.data.query },
                        'AI orchestrator could not determine an action for the query.',
                    );
                    throw new ResponseError(-32000, 'AI orchestrator could not determine an action for your query.', {
                        query: validatedParams.data.query,
                    });
                }
                handlerLogger.info({ plan }, 'LLM orchestrator returned a plan.');
                handlerLogger.debug(`Executing plan on backend: ${plan.backendId}, method: ${plan.mcpMethod}`);
                try {
                    const result = await backendManager.executeOnBackend(
                        plan.backendId,
                        plan.mcpMethod,
                        plan.mcpParams,
                    );
                    handlerLogger.info(
                        { backendId: plan.backendId, method: plan.mcpMethod, result },
                        'Successfully executed plan on backend.',
                    );
                    return result;
                } catch (err: unknown) {
                    handlerLogger.error({ err, plan }, 'Error executing plan on backend.');
                    const errorForClient = err instanceof Error ? err.message : 'Unknown error executing backend plan.';
                    const errorData = {
                        backendId: plan.backendId,
                        mcpMethod: plan.mcpMethod,
                        originalError: errorForClient,
                    };
                    throw new ResponseError(
                        -32004,
                        `Error executing plan on backend '${plan.backendId}': ${errorForClient}`,
                        errorData,
                    );
                }
            } catch (error: unknown) {
                const finalLogger = getLogger();
                finalLogger.error(
                    { errCaughtInOrchestrate: error },
                    "[GATEWAY SERVER] Error caught at top of 'agentify/orchestrateTask' handler.",
                );
                if (error instanceof ResponseError) {
                    throw error;
                }
                throw new ResponseError(ErrorCodes.InternalError, 'Internal server error during task orchestration.', {
                    originalMessage: (error as Error).message,
                });
            }
        },
    );

    connection.onRequest('ping', () => {
        (pinoLogger || tempConsoleLogger).info("[GATEWAY SERVER] Received 'ping', sending 'pong'.");
        return 'pong';
    });

    connection.listen();
    tempConsoleLogger.info(
        "mcp-agentify server logic started. Listening for client connection via stdio. Logger will be fully initialized upon receiving 'initialize' request.",
    );
}
