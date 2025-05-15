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
import type {
    GatewayOptions,
    AgentifyOrchestrateTaskParams,
    Plan,
    McpTraceEntry,
    OrchestrationContext,
} from './interfaces';
import {
    GatewayClientInitOptionsSchema,
    type GatewayClientInitOptions,
    AgentifyOrchestrateTaskParamsSchema,
} from './schemas';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let pinoLogger: PinoLoggerType<PinoLogLevel>;
let internalGatewayOptions: GatewayOptions; // Renamed for clarity, this is the true internal config
let backendManager: BackendManager | undefined;
let llmOrchestrator: LLMOrchestratorService | undefined;
let debugWebServerInstance: DebugWebServer | undefined;
let mcpConnection: MessageConnection | undefined; // Store the connection

// Expose a function to send requests on the main MCP connection
export type McpRequester = (method: string, params: any) => Promise<any>;
let mcpRequester: McpRequester | undefined;

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
    // --- START EARLY AND FINAL CORE INITIALIZATION ---
    const envLogLevel: PinoLogLevel = initialCliOptions?.logLevel || 'info';
    const envDebugPort: number | null = initialCliOptions?.DEBUG_PORT || 3030; // Default to 3030
    const envOpenApiKey: string | undefined = initialCliOptions?.OPENAI_API_KEY; // From env

    let tempPinoLogger: PinoLoggerType<PinoLogLevel> = initializeLogger({ logLevel: envLogLevel });

    if (envDebugPort && envDebugPort > 0) {
        tempPinoLogger.info(
            `[GATEWAY SERVER PRE-INIT] DEBUG_PORT ${envDebugPort} active (from env or default). Attempting to start DebugWebServer.`,
        );
        try {
            debugWebServerInstance = new DebugWebServer(
                envDebugPort,
                tempPinoLogger,
                undefined,
                { DEBUG_PORT: envDebugPort, logLevel: envLogLevel } as GatewayOptions, // Partial for early start
            );
            debugWebServerInstance.start();
            const debugStreamForPino = debugWebServerInstance?.getLogStream();
            if (debugStreamForPino) {
                tempPinoLogger = initializeLogger(
                    { logLevel: envLogLevel }, undefined, debugStreamForPino
                );
                debugWebServerInstance.updateLogger(tempPinoLogger);
                tempPinoLogger.info(
                    '[GATEWAY SERVER PRE-INIT] DebugWebServer started and logger updated with its stream.',
                );
            }
        } catch (err) {
            tempPinoLogger.error({ err }, '[GATEWAY SERVER PRE-INIT] Failed to start DebugWebServer early.');
        }
    }
    pinoLogger = tempPinoLogger;

    // Construct the core part of internalGatewayOptions from environment variables / defaults
    // `backends` will be added during 'initialize'
    internalGatewayOptions = {
        logLevel: envLogLevel,
        DEBUG_PORT: envDebugPort,
        OPENAI_API_KEY: envOpenApiKey,
        backends: [], // Initialize with empty backends; will be populated from client
    };

    if (!internalGatewayOptions.OPENAI_API_KEY) {
        pinoLogger.fatal(
            '[GATEWAY SERVER] CRITICAL: OPENAI_API_KEY is not set in the environment. mcp-agentify cannot function.',
        );
        // Allow to connect but orchestrateTask will fail if key is missing.
        // Or: process.exit(1); // More drastic: refuse to start without API key
    }

    pinoLogger.info(
        {
            configFromEnv: {
                logLevel: internalGatewayOptions.logLevel,
                DEBUG_PORT: internalGatewayOptions.DEBUG_PORT,
                OPENAI_API_KEY: internalGatewayOptions.OPENAI_API_KEY ? '***' : undefined,
            },
        },
        '[GATEWAY SERVER] Core configuration initialized from environment/defaults.',
    );

    // --- END EARLY AND FINAL CORE INITIALIZATION ---

    const connection: MessageConnection = createMessageConnection(
        process.stdin,
        process.stdout,
        tempConsoleLogger as any,
    );
    mcpConnection = connection; // Assign to module-scoped variable

    // Define the requester function
    mcpRequester = async (method: string, params: any) => {
        if (!mcpConnection) {
            pinoLogger.error('MCP connection not available for mcpRequester.');
            throw new Error('MCP connection not available');
        }
        pinoLogger.info({ method, params }, '[mcpRequester] Sending request via main connection.');
        return mcpConnection.sendRequest(method, params);
    };

    // Pass the mcpRequester to DebugWebServer if it exists
    if (debugWebServerInstance && typeof debugWebServerInstance.setMcpRequester === 'function') {
        debugWebServerInstance.setMcpRequester(mcpRequester);
    }

    // Dynamically register agent methods based on AGENTS from environment
    if (internalGatewayOptions.gptAgents && internalGatewayOptions.gptAgents.length > 0) {
        pinoLogger.info({ agents: internalGatewayOptions.gptAgents }, '[GATEWAY SERVER] Registering dynamic agent methods from AGENTS env var...');
        for (const fullAgentString of internalGatewayOptions.gptAgents) { // e.g., "OpenAI/gpt-4.1"
            // Sanitize the full string for the method name: replace non-alphanumeric (except /) with _
            // Then replace / with _ to ensure it's a single segment after agent_
            const sanitizedMethodPart = fullAgentString.replace(/[^a-zA-Z0-9_\/]/g, '_').replace(/\//g, '_');
            const methodName = `agentify/agent_${sanitizedMethodPart}`;
            
            pinoLogger.info(`[GATEWAY SERVER] Registering method: ${methodName} for agent: ${fullAgentString}`);

            connection.onRequest(methodName, async (params: { query: string; context?: OrchestrationContext }) => {
                pinoLogger.info({ method: methodName, agent: fullAgentString, params }, `Dynamic agent method ${methodName} called.`);
                if (!llmOrchestrator) {
                    pinoLogger.error({ method: methodName }, 'LLMOrchestrator not available for dynamic agent call.');
                    throw new ResponseError(ErrorCodes.InternalError, 'LLMOrchestrator not initialized');
                }
                // TODO: Future - llmOrchestrator.invokeAgent(fullAgentString, params.query, params.context);
                return {
                    message: `Agent '${fullAgentString}' received query: "${params.query}". Context: ${JSON.stringify(params.context || {})}`,
                    note: "This is a placeholder response. Full LLM interaction for dynamic agents is not yet implemented."
                };
            });
        }
    }

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

                pinoLogger.info(
                    { initParamsReceived: params.initializationOptions },
                    "[GATEWAY SERVER] Received 'initialize' request with client options.",
                );

                // Validate client-provided options, primarily for `backends`
                const clientOptionsValidation = GatewayClientInitOptionsSchema.safeParse(params.initializationOptions);
                if (!clientOptionsValidation.success) {
                    const errorMsg = 'Invalid client initializationOptions structure (backends are required).';
                    pinoLogger.error({ error: clientOptionsValidation.error.format() }, errorMsg);
                    throw new ResponseError(ErrorCodes.InvalidParams, errorMsg, {
                        validationErrors: clientOptionsValidation.error.format(),
                    });
                }
                const clientSentOptions: GatewayClientInitOptions = clientOptionsValidation.data;
                if (debugWebServerInstance) {
                    debugWebServerInstance.setClientSentInitOptions(clientSentOptions);
                }

                // Populate `backends` in the internalGatewayOptions
                internalGatewayOptions.backends = clientSentOptions.backends;

                // OPENAI_API_KEY check again, crucial for operation, should be from ENV already
                if (!internalGatewayOptions.OPENAI_API_KEY) {
                    const errorMsg =
                        'OpenAI API Key is required for mcp-agentify to function and was not found in its environment.';
                    pinoLogger.error(errorMsg);
                    throw new ResponseError(ErrorCodes.ServerNotInitialized, errorMsg, {
                        missingKey: 'OPENAI_API_KEY',
                    });
                }

                // Debug Web Server should already be running if DEBUG_PORT was set via ENV or defaulted.
                // If client *also* sent a DEBUG_PORT in its (now mostly ignored for this) options, log it but take no action if different.
                if (
                    params.initializationOptions?.DEBUG_PORT &&
                    params.initializationOptions.DEBUG_PORT !== internalGatewayOptions.DEBUG_PORT
                ) {
                    pinoLogger.warn(
                        `[GATEWAY SERVER] Client sent DEBUG_PORT ${params.initializationOptions.DEBUG_PORT}, but gateway is using ${internalGatewayOptions.DEBUG_PORT} (from env/default).`,
                    );
                }
                // Same for logLevel
                if (
                    params.initializationOptions?.logLevel &&
                    params.initializationOptions.logLevel !== internalGatewayOptions.logLevel
                ) {
                    pinoLogger.warn(
                        `[GATEWAY SERVER] Client sent logLevel ${params.initializationOptions.logLevel}, but gateway is using ${internalGatewayOptions.logLevel} (from env/default).`,
                    );
                }

                pinoLogger.info(
                    { finalGatewayConfig: { ...internalGatewayOptions, OPENAI_API_KEY: '***' } },
                    '[GATEWAY SERVER] Final gateway configuration assembled.',
                );
                if (debugWebServerInstance) {
                    // Pass the final, fully assembled internal config
                    debugWebServerInstance.setFinalEffectiveConfig(internalGatewayOptions); 
                }

                pinoLogger.info('[GATEWAY SERVER] Initializing BackendManager...');
                backendManager = new BackendManager(pinoLogger);
                try {
                    await backendManager.initializeAllBackends(internalGatewayOptions.backends);
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
                    llmOrchestrator = new LLMOrchestratorService(
                        internalGatewayOptions.OPENAI_API_KEY, // Definitely use the one from env
                        internalGatewayOptions.backends,
                        pinoLogger,
                    );
                    pinoLogger.info('[GATEWAY SERVER] LLMOrchestratorService initialized.');
                } catch (err: unknown) {
                    const llmInitErrorMsg = `Fatal error initializing LLMOrchestratorService: ${(err as Error).message}`;
                    pinoLogger.error({ err }, `[GATEWAY SERVER] ${llmInitErrorMsg}`);
                    throw new ResponseError(-32005, llmInitErrorMsg, { originalError: (err as Error).message });
                }

                if (debugWebServerInstance && backendManager) {
                    // Update DebugWebServer with BackendManager if it has a method to accept it for /api/status
                    // For now, constructor takes it as optional. If it was started early, it won't have it.
                    // This is a good place to provide it if a method exists, e.g., debugWebServerInstance.setBackendManager(backendManager);
                    pinoLogger.info(
                        '[GATEWAY SERVER] DebugWebServer (if running) can now associate with BackendManager.',
                    );
                }

                // After all initializations, if debugWebServerInstance exists and needs the requester again (e.g. if re-created)
                if (debugWebServerInstance && mcpRequester && typeof debugWebServerInstance.setMcpRequester === 'function') {
                     // This might be redundant if already set, but ensures it has it.
                    // debugWebServerInstance.setMcpRequester(mcpRequester);
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
                if (!llmOrchestrator || !backendManager || !internalGatewayOptions.backends.length) {
                    handlerLogger.warn(
                        "'agentify/orchestrateTask' called before gateway was fully initialized (llm, backend, or backends config missing).",
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
    pinoLogger.info(
        "[GATEWAY SERVER] MCP Agentify server fully started and listening on stdio."
    );
    // Keep the server alive indefinitely until an exit event
    return new Promise(() => { /* This promise never resolves, keeping the process alive */ });
}
