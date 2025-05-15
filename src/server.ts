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
import { FrontendServer } from './frontendServer';
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
import { getPackageVersion } from './utils';

let pinoLogger: PinoLoggerType<PinoLogLevel>;
let internalGatewayOptions: GatewayOptions; // Renamed for clarity, this is the true internal config
let backendManager: BackendManager | undefined;
let llmOrchestrator: LLMOrchestratorService | undefined;
let frontendServerInstance: FrontendServer | undefined;
let mcpConnection: MessageConnection | undefined; // Store the connection

// Expose a function to send requests on the main MCP connection
export type McpRequester = (method: string, params: unknown) => Promise<unknown>;
let mcpRequester: McpRequester | undefined;

const tempConsoleLogger = {
    error: (message: string) => console.error(`[TEMP ERROR] ${message}`),
    warn: (message: string) => console.warn(`[TEMP WARN] ${message}`),
    info: (message: string) => console.error(`[TEMP INFO] ${message}`),
    log: (message: string) => console.error(`[TEMP LOG] ${message}`),
};

export async function startAgentifyServer(initialCliOptions?: Partial<GatewayOptions>) {
    // Determine initial settings from CLI options or defaults
    const initialLogLevel: PinoLogLevel = initialCliOptions?.logLevel || 'info';
    const initialFrontendPort: number | null = initialCliOptions?.FRONTEND_PORT === undefined ? 3030 : initialCliOptions.FRONTEND_PORT; // Default to 3030 if not provided, allow null
    const envOpenApiKey: string | undefined = initialCliOptions?.OPENAI_API_KEY;

    // Initialize logger - this will be the primary logger instance, potentially updated later
    pinoLogger = initializeLogger({ logLevel: initialLogLevel });
    pinoLogger.info('[GATEWAY SERVER PRE-INIT] Initializing Agentify server...');

    // Construct the initial part of internalGatewayOptions
    // `backends` will be added during 'initialize'
    // FrontendServer will be started after 'initialize'
    internalGatewayOptions = {
        logLevel: initialLogLevel,
        FRONTEND_PORT: initialFrontendPort,
        OPENAI_API_KEY: envOpenApiKey,
        backends: [], // Initialize with empty backends; will be populated from client
        // gptAgents will be derived from client options or other config mechanism if needed
    };

    if (!internalGatewayOptions.OPENAI_API_KEY) {
        pinoLogger.fatal(
            '[GATEWAY SERVER] CRITICAL: OPENAI_API_KEY is not set. mcp-agentify may not function fully.',
        );
        // Allow to connect; 'initialize' or 'orchestrateTask' will fail if key is truly missing & needed.
    }

    pinoLogger.info(
        {
            initialConfig: {
                logLevel: internalGatewayOptions.logLevel,
                FRONTEND_PORT: internalGatewayOptions.FRONTEND_PORT,
                OPENAI_API_KEY: internalGatewayOptions.OPENAI_API_KEY ? '***' : undefined,
            },
        },
        '[GATEWAY SERVER] Initial core configuration from environment/CLI options.',
    );

    const connection: MessageConnection = createMessageConnection(process.stdin, process.stdout, tempConsoleLogger);
    mcpConnection = connection;

    mcpRequester = async (method: string, params: unknown) => {
        if (!mcpConnection) {
            pinoLogger.error('MCP connection not available for mcpRequester.');
            throw new Error('MCP connection not available');
        }
        pinoLogger.info({ method, params }, '[mcpRequester] Sending request via main connection.');
        return mcpConnection.sendRequest(method, params);
    };

    // Dynamic agent registration can happen here if AGENTS are from a source other than client initOptions
    // For now, assuming if gptAgents are needed, they'd come via a consolidated config mechanism
    // or be explicitly passed during 'initialize' if that's the design.
    // The original logic for gptAgents relied on internalGatewayOptions.gptAgents, which might be better populated
    // after client initOptions are processed if they are to be configurable by the client.
    // If gptAgents are from ENV only, this could stay. Let's assume for now they might be influenced by client options
    // and move registration logic to after `initialize` or make it depend on a fully formed config.
    // For safety, this dynamic registration is removed from here. If needed, it should be done post-initialize.

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
        // Stop FrontendServer if it was started
        if (frontendServerInstance) {
            frontendServerInstance.stop().catch(err => getLogger().error({ err }, 'Error stopping frontend server on close.'));
        }
    });

    connection.onError((error) => {
        getLogger().error({ error }, `Connection error: ${JSON.stringify(error)}`);
    });

    connection.onNotification('shutdown', async () => {
        getLogger().info('Received shutdown notification from client. Initiating graceful shutdown...');
        if (frontendServerInstance) {
            await frontendServerInstance
                .stop()
                .catch((err) => getLogger().error({ err }, 'Error stopping frontend server during shutdown'));
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
        if (frontendServerInstance) {
            frontendServerInstance
                .stop()
                .catch((err) => getLogger().error({ err }, 'Error stopping frontend server during exit'));
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
            pinoLogger.info({ initParamsReceived: params }, "[GATEWAY SERVER] 'initialize' handler started.");
            try {
                const clientOptionsValidation = GatewayClientInitOptionsSchema.safeParse(params.initializationOptions);
                if (!clientOptionsValidation.success) {
                    const errorMsg = 'Invalid client initializationOptions structure.';
                    pinoLogger.error({ error: clientOptionsValidation.error.format() }, errorMsg);
                    throw new ResponseError(ErrorCodes.InvalidParams, errorMsg, {
                        validationErrors: clientOptionsValidation.error.format(),
                    });
                }
                const clientSentOptions: GatewayClientInitOptions = clientOptionsValidation.data;

                // Update internalGatewayOptions with client-provided values
                internalGatewayOptions.backends = clientSentOptions.backends;

                if (clientSentOptions.logLevel !== undefined) {
                    pinoLogger.info(`[GATEWAY SERVER] Client requested logLevel: ${clientSentOptions.logLevel}. Overriding initial setting: ${internalGatewayOptions.logLevel}.`);
                    internalGatewayOptions.logLevel = clientSentOptions.logLevel;
                    // Re-initialize the main pinoLogger with the new level. Stream will be added after FrontendServer starts.
                    pinoLogger = initializeLogger({ logLevel: internalGatewayOptions.logLevel });
                }

                if (clientSentOptions.FRONTEND_PORT !== undefined) {
                     pinoLogger.info(`[GATEWAY SERVER] Client requested FRONTEND_PORT: ${clientSentOptions.FRONTEND_PORT}. Overriding initial setting: ${internalGatewayOptions.FRONTEND_PORT}.`);
                    internalGatewayOptions.FRONTEND_PORT = clientSentOptions.FRONTEND_PORT;
                }
                
                // Also handle gptAgents from clientSentOptions if it's part of GatewayClientInitOptionsSchema
                if (clientSentOptions.gptAgents && clientSentOptions.gptAgents.length > 0) {
                    internalGatewayOptions.gptAgents = clientSentOptions.gptAgents;
                     pinoLogger.info({ agents: internalGatewayOptions.gptAgents }, "[GATEWAY SERVER] Using gptAgents from client initializationOptions.");
                }


                // Now start FrontendServer if configured
                if (internalGatewayOptions.FRONTEND_PORT !== null && internalGatewayOptions.FRONTEND_PORT > 0) {
                    pinoLogger.info(
                        `[GATEWAY SERVER] Attempting to start FrontendServer on port ${internalGatewayOptions.FRONTEND_PORT}.`,
                    );
                    try {
                        frontendServerInstance = new FrontendServer(
                            internalGatewayOptions.FRONTEND_PORT,
                            pinoLogger, // Pass the current pinoLogger
                            undefined, // No backendManager yet
                            internalGatewayOptions, // Pass the current (partially final) options
                        );
                        await frontendServerInstance.start(); // Assuming start can be async
                        pinoLogger.info(
                            `[GATEWAY SERVER] FrontendServer started on port ${internalGatewayOptions.FRONTEND_PORT}.`,
                        );

                        const logStreamForPino = frontendServerInstance?.getLogStream();
                        if (logStreamForPino) {
                            pinoLogger = initializeLogger({ logLevel: internalGatewayOptions.logLevel }, undefined, logStreamForPino);
                            frontendServerInstance.updateLogger(pinoLogger); // Update FrontendServer with the new logger
                            pinoLogger.info(
                                '[GATEWAY SERVER] Main logger updated with FrontendServer stream.',
                            );
                        }
                    } catch (err) {
                        pinoLogger.error({ err }, `[GATEWAY SERVER] Failed to start FrontendServer on port ${internalGatewayOptions.FRONTEND_PORT}.`);
                        // Continue without frontend server if it fails to start? Or throw?
                        // For now, log error and continue. Client might not need it.
                    }
                } else {
                    pinoLogger.info('[GATEWAY SERVER] FrontendServer is disabled (FRONTEND_PORT is null or invalid).');
                }
                
                if (frontendServerInstance) {
                    frontendServerInstance.setClientSentInitOptions(clientSentOptions);
                    frontendServerInstance.setFinalEffectiveConfig(internalGatewayOptions);
                    if (mcpRequester) {
                        frontendServerInstance.setMcpRequester(mcpRequester);
                    }
                }


                // OPENAI_API_KEY check, crucial for operation
                if (!internalGatewayOptions.OPENAI_API_KEY) {
                    const errorMsg =
                        'OpenAI API Key is required for mcp-agentify to function and was not found or provided.';
                    pinoLogger.error(errorMsg);
                    throw new ResponseError(ErrorCodes.ServerNotInitialized, errorMsg, {
                        missingKey: 'OPENAI_API_KEY',
                    });
                }
                
                // Dynamically register agent methods based on AGENTS (now potentially from client options)
                if (internalGatewayOptions.gptAgents && internalGatewayOptions.gptAgents.length > 0) {
                    pinoLogger.info(
                        { agents: internalGatewayOptions.gptAgents },
                        '[GATEWAY SERVER] Registering dynamic agent methods from effective AGENTS config...',
                    );
                    for (const fullAgentString of internalGatewayOptions.gptAgents) {
                        const sanitizedMethodPart = fullAgentString.replace(/[^a-zA-Z0-9_\/]/g, '_').replace(/\//g, '_');
                        const methodName = `agentify/agent_${sanitizedMethodPart}`;

                        pinoLogger.info(`[GATEWAY SERVER] Registering method: ${methodName} for agent: ${fullAgentString}`);

                        connection.onRequest(methodName, async (requestParams: { query: string; context?: OrchestrationContext }) => {
                            // Note: requestParams, not params here to avoid conflict
                            pinoLogger.info(
                                { method: methodName, agent: fullAgentString, params: requestParams },
                                `Dynamic agent method ${methodName} called.`,
                            );
                            if (!llmOrchestrator) {
                                pinoLogger.error({ method: methodName }, 'LLMOrchestrator not available for dynamic agent call.');
                                throw new ResponseError(ErrorCodes.InternalError, 'LLMOrchestrator not initialized');
                            }
                            // TODO: Future - llmOrchestrator.invokeAgent(fullAgentString, requestParams.query, requestParams.context);
                            return {
                                message: `Agent '${fullAgentString}' received query: "${requestParams.query}". Context: ${JSON.stringify(
                                    requestParams.context || {},
                                )}`,
                                note: 'This is a placeholder response. Full LLM interaction for dynamic agents is not yet implemented.',
                            };
                        });
                    }
                }


                pinoLogger.info(
                    { finalGatewayConfig: { ...internalGatewayOptions, OPENAI_API_KEY: '***' } },
                    '[GATEWAY SERVER] Final gateway configuration assembled post-initialize.',
                );

                pinoLogger.info('[GATEWAY SERVER] Initializing BackendManager...');
                backendManager = new BackendManager(pinoLogger); // Use the potentially updated pinoLogger
                try {
                    await backendManager.initializeAllBackends(internalGatewayOptions.backends);
                    pinoLogger.info('[GATEWAY SERVER] BackendManager initialized all backends successfully.');
                    backendManager.on('mcpTrace', (traceEntry: McpTraceEntry) => {
                        if (frontendServerInstance) {
                            frontendServerInstance.addMcpTrace(traceEntry);
                        }
                    });
                } catch (err: unknown) {
                    const backendInitErrorMsg = `Critical error during BackendManager initialization: ${
                        (err as Error).message
                    }`;
                    pinoLogger.error({ err }, `[GATEWAY SERVER] ${backendInitErrorMsg}`);
                    throw new ResponseError(-32006, backendInitErrorMsg, { originalError: (err as Error).message });
                }

                pinoLogger.info('[GATEWAY SERVER] Initializing LLMOrchestratorService...');
                try {
                    llmOrchestrator = new LLMOrchestratorService(
                        internalGatewayOptions.OPENAI_API_KEY,
                        internalGatewayOptions.backends,
                        pinoLogger, // Use the potentially updated pinoLogger
                    );
                    pinoLogger.info('[GATEWAY SERVER] LLMOrchestratorService initialized.');
                } catch (err: unknown) {
                    const llmInitErrorMsg = `Fatal error initializing LLMOrchestratorService: ${(err as Error).message}`;
                    pinoLogger.error({ err }, `[GATEWAY SERVER] ${llmInitErrorMsg}`);
                    throw new ResponseError(-32005, llmInitErrorMsg, { originalError: (err as Error).message });
                }
                
                // If frontendServerInstance was started, it might need a reference to backendManager
                // This is more of an internal wiring detail, depending on FrontendServer's capabilities
                 if (frontendServerInstance && backendManager && typeof (frontendServerInstance as any).setBackendManager === 'function') {
                    (frontendServerInstance as any).setBackendManager(backendManager);
                     pinoLogger.info('[GATEWAY SERVER] Passed BackendManager reference to FrontendServer.');
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
                const finalLogger = pinoLogger || tempConsoleLogger; // pinoLogger should be defined
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
            if (frontendServerInstance && rpcMessage) {
                const traceEntry: McpTraceEntry = {
                    timestamp: Date.now(),
                    direction: 'INCOMING_TO_GATEWAY',
                    backendId: undefined,
                    id: rpcMessage.id !== undefined ? String(rpcMessage.id) : undefined,
                    method: rpcMessage.method,
                    paramsOrResult: requestParams,
                };
                frontendServerInstance.addMcpTrace(traceEntry);
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
    pinoLogger.info('[GATEWAY SERVER] MCP Agentify server fully started and listening on stdio.');
    // Keep the server alive indefinitely until an exit event
    return new Promise(() => {
        /* This promise never resolves, keeping the process alive */
    });
}