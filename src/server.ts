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

const logFunctionEntryExit = (logger: PinoLoggerType<PinoLogLevel>, functionName: string, args?: unknown) => {
    if (!logger) { 
        console.error(`[logFunctionEntryExit] Logger not available for ${functionName} entry`);
        return () => console.error(`[logFunctionEntryExit] Logger not available for ${functionName} exit`);
    }
    logger.debug({ function: functionName, args: args || 'none' }, `ENTERING: ${functionName}`);
    return () => logger.debug({ function: functionName }, `EXITING: ${functionName}`);
};

export async function startAgentifyServer(initialCliOptions?: Partial<GatewayOptions> & { projectRoot?: string }) {
    const envLogLevelForServer: PinoLogLevel = initialCliOptions?.logLevel || 'info';

    // Initialize or update the global pinoLogger
    // If FrontendServer later provides a stream, it will get a new logger instance with that stream.
    if (!pinoLogger || pinoLogger.level !== envLogLevelForServer) {
        pinoLogger = initializeLogger({ logLevel: envLogLevelForServer });
        pinoLogger.info(`[startAgentifyServer] Main pinoLogger (re)initialized. Effective Level: ${pinoLogger.level}.`);
    } else {
        pinoLogger.info(`[startAgentifyServer] Main pinoLogger already initialized with correct level. Effective Level: ${pinoLogger.level}`);
    }
    
    const exitLog = logFunctionEntryExit(pinoLogger, 'startAgentifyServer', initialCliOptions);
    pinoLogger.info('[GATEWAY SERVER PRE-INIT] Initializing Agentify server (via startAgentifyServer call)...');

    // --- Potentially move the rest of the env consts here after logger is up ---
    const envFrontendPort: number | null = initialCliOptions?.FRONTEND_PORT === undefined 
        ? 3030 
        : initialCliOptions.FRONTEND_PORT;
    const envOpenApiKey: string | undefined = initialCliOptions?.OPENAI_API_KEY;
    const envGptAgents: string[] | undefined = initialCliOptions?.gptAgents;
    const projectRoot = initialCliOptions?.projectRoot;
    pinoLogger.info({ projectRootFromCli: projectRoot }, '[startAgentifyServer] Received projectRoot from initialCliOptions.');

    internalGatewayOptions = {
        logLevel: envLogLevelForServer,
        FRONTEND_PORT: envFrontendPort,
        OPENAI_API_KEY: envOpenApiKey,
        backends: [], // Start with empty backends for early LLM Orchestrator init
        gptAgents: envGptAgents || [],
        projectRoot: projectRoot,
    };
    pinoLogger.debug({ internalGatewayOptions: { ...internalGatewayOptions, OPENAI_API_KEY: '***' } }, '[startAgentifyServer] Internal gateway options established.');

    // Initialize LLMOrchestratorService EARLIER, before FrontendServer, so it can be passed to constructor
    let localLlmOrchestrator: LLMOrchestratorService | undefined;
    if (internalGatewayOptions.OPENAI_API_KEY) {
        localLlmOrchestrator = new LLMOrchestratorService(
            internalGatewayOptions.OPENAI_API_KEY,
            internalGatewayOptions.backends, // Initially empty
            pinoLogger
        );
        pinoLogger.info('[startAgentifyServer] LLMOrchestratorService initialized at startup (backends may be updated later via re-init in initialize handler).');
    } else {
        pinoLogger.warn('[startAgentifyServer] OPENAI_API_KEY not available. LLMOrchestratorService not initialized at startup. Chat features will likely fail if not set by client init.');
    }
    // Assign to global if needed by other parts of server.ts, or keep it local to pass to FrontendServer
    llmOrchestrator = localLlmOrchestrator; // Update global instance

    // Initialize FrontendServer and pass the llmOrchestrator instance
    if (typeof envFrontendPort === 'number' && envFrontendPort > 0) {
        pinoLogger.debug('[startAgentifyServer] Attempting to start FrontendServer.');
        try {
            frontendServerInstance = new FrontendServer(
                envFrontendPort,
                pinoLogger,
                undefined, // initialBackendManager
                {
                    FRONTEND_PORT: envFrontendPort,
                    logLevel: envLogLevelForServer,
                    OPENAI_API_KEY: envOpenApiKey,
                    gptAgents: envGptAgents || [],
                    projectRoot: projectRoot,
                } as Partial<GatewayOptions>,
                process.env.AGENTS, // raw AGENTS string
                localLlmOrchestrator // Pass to constructor
            );
            await frontendServerInstance.start(); 

            const logStreamForPino = frontendServerInstance?.getLogStream();
            if (logStreamForPino) {
                pinoLogger = initializeLogger({ logLevel: envLogLevelForServer }, undefined, logStreamForPino);
                frontendServerInstance.updateLogger(pinoLogger);
                pinoLogger.info(
                    '[GATEWAY SERVER PRE-INIT] Main logger updated with FrontendServer stream.',
                );
            }
            pinoLogger.debug('[startAgentifyServer] FrontendServer started or start attempted.');
        } catch (err) {
            pinoLogger.error({ err }, '[startAgentifyServer] Error starting FrontendServer.');
        }
    } else {
        pinoLogger.debug('[startAgentifyServer] FrontendServer start skipped.');
    }

    // Initialize MessageConnection
    if (!mcpConnection) {
        pinoLogger.debug('[startAgentifyServer] Creating main MessageConnection.');
        mcpConnection = createMessageConnection(process.stdin, process.stdout, tempConsoleLogger as any);
        pinoLogger.info('[startAgentifyServer] Main MessageConnection created.');
    } else {
        pinoLogger.warn('[startAgentifyServer] Main MessageConnection already exists. Reusing.');
    }

    mcpRequester = async (method: string, params: unknown) => {
        const exitReqLog = logFunctionEntryExit(pinoLogger, 'mcpRequester', { method, params });
        if (!mcpConnection) {
            pinoLogger.error('[mcpRequester] MCP connection not available.');
            exitReqLog();
            throw new Error('MCP connection not available');
        }
        pinoLogger.trace({ method, params }, '[mcpRequester] Attempting mcpConnection.sendRequest.');
        try {
            const result = await mcpConnection.sendRequest(method, params);
            pinoLogger.trace({ method, result }, '[mcpRequester] mcpConnection.sendRequest successful.');
            exitReqLog();
            return result;
        } catch (error) {
            pinoLogger.error({ err: error, method, params }, '[mcpRequester] Error during mcpConnection.sendRequest.');
            exitReqLog();
            throw error;
        }
    };

    // Set dependencies on FrontendServer IF it was created
    if (frontendServerInstance) {
        if (mcpRequester) {
            frontendServerInstance.setMcpRequester(mcpRequester);
        }
    }

    // Dynamic agent registration
    if (internalGatewayOptions.gptAgents && internalGatewayOptions.gptAgents.length > 0) {
        pinoLogger.debug('[startAgentifyServer] Starting dynamic agent registration.');
        for (const fullAgentString of internalGatewayOptions.gptAgents) {
            const sanitizedMethodPart = fullAgentString.replace(/[^a-zA-Z0-9_\/]/g, '_').replace(/\//g, '_');
            const methodName = `agentify/agent_${sanitizedMethodPart}`;
            pinoLogger.trace({ methodName, agent: fullAgentString }, '[startAgentifyServer] Registering dynamic agent handler.');
            pinoLogger.info(
                `[GATEWAY SERVER] Registering method: ${methodName} for agent: ${fullAgentString}`
            );
            mcpConnection.onRequest(
                methodName, 
                async (requestParams: { query: string; context?: OrchestrationContext }) => { 
                    const exitDynLog = logFunctionEntryExit(pinoLogger, `dynamicAgentHandler:${methodName}`, requestParams);
                    pinoLogger.trace({ methodReceived: methodName, agentTarget: fullAgentString, receivedParams: requestParams }, `[DynamicAgentHandler:${methodName}] Request processing started.`);
                    pinoLogger.info(
                        { methodReceived: methodName, agentTarget: fullAgentString, receivedParams: requestParams },
                        `[DynamicAgentHandler:${methodName}] Request successfully routed and received for method: ${methodName}. Target agent: ${fullAgentString}`
                    );
                    if (!llmOrchestrator) {
                        pinoLogger.error(
                            { method: methodName }, 
                            "LLMOrchestrator not available yet for dynamic agent call (waits for client 'initialize')."
                        );
                        exitDynLog();
                        throw new ResponseError(ErrorCodes.ServerNotInitialized, "LLM Orchestrator not ready.", {
                            message: `Agent '${fullAgentString}' called too early. LLM Orchestrator not ready.`,
                            note: "LLM Orchestrator is initialized after client sends MCP 'initialize' request."
                        });
                    }
                    if (!internalGatewayOptions.OPENAI_API_KEY) { 
                        pinoLogger.error(
                            { method: methodName, agent: fullAgentString }, 
                            "Cannot process dynamic agent request: OpenAI API key is not configured."
                        );
                        exitDynLog();
                        throw new ResponseError(ErrorCodes.InternalError, "OpenAI API key not configured for this agent.");
                    }
                    try {
                        const agentResponse = await llmOrchestrator.chatWithAgent(
                            fullAgentString,
                            requestParams.query,
                            requestParams.context
                        );
                        pinoLogger.trace({ agent: fullAgentString, query: requestParams.query }, `[DynamicAgentHandler:${methodName}] chatWithAgent call successful.`);
                        exitDynLog();
                        return agentResponse; 
                    } catch (err) { 
                        pinoLogger.error({ err, agent: fullAgentString, query: requestParams.query }, `Error from llmOrchestrator.chatWithAgent for ${fullAgentString}`);
                        const errorMessage = (err instanceof Error) ? err.message : "An unknown error occurred while interacting with the agent.";
                        exitDynLog();
                        throw new ResponseError(ErrorCodes.InternalError, `Agent Interaction Error: ${errorMessage}`);
                    }
                }
            );
        }
        pinoLogger.debug('[startAgentifyServer] Dynamic agent registration completed.');
    }

    mcpConnection.onClose(() => {
        const exitCloseLog = logFunctionEntryExit(getLogger(), 'mcpConnection.onClose');
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
            frontendServerInstance
                .stop()
                .catch((err) => getLogger().error({ err }, 'Error stopping frontend server on close.'));
        }
        exitCloseLog();
    });

    mcpConnection.onError((error) => {
        const exitErrorLog = logFunctionEntryExit(getLogger(), 'mcpConnection.onError', error);
        getLogger().error({ error }, `Connection error: ${JSON.stringify(error)}`);
        exitErrorLog();
    });

    mcpConnection.onNotification('shutdown', async () => {
        const exitShutdownLog = logFunctionEntryExit(getLogger(), "mcpConnection.onNotification('shutdown')");
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
        exitShutdownLog();
    });

    mcpConnection.onNotification('exit', () => {
        const exitExitLog = logFunctionEntryExit(getLogger(), "mcpConnection.onNotification('exit')");
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
        exitExitLog();
    });

    mcpConnection.onRequest(
        new RequestType<InitializeParams, InitializeResult, ResponseError<undefined>>('initialize'),
        async (params: InitializeParams, _token: CancellationToken): Promise<InitializeResult> => {
            const exitInitLog = logFunctionEntryExit(pinoLogger, 'mcpConnection.onRequest(initialize)', params);
            pinoLogger.trace({ initParams: params }, '[InitializeHandler] Received initialize request.');
            try {
                pinoLogger.info(
                    { initParamsReceivedClient: params.initializationOptions },
                    "[GATEWAY SERVER] 'initialize' handler: Received options from client."
                );

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

                    // Update internalGatewayOptions.backends from client
                    internalGatewayOptions.backends = clientSentOptions.backends;
                    
                    if (clientSentOptions.logLevel !== undefined && clientSentOptions.logLevel !== internalGatewayOptions.logLevel) {
                        pinoLogger.warn(
                            `[GATEWAY SERVER] Client sent logLevel ${clientSentOptions.logLevel}, but gateway is using ${internalGatewayOptions.logLevel} (from env/default).`
                        );
                    }
                    if (clientSentOptions.FRONTEND_PORT !== undefined && clientSentOptions.FRONTEND_PORT !== internalGatewayOptions.FRONTEND_PORT) {
                        pinoLogger.warn(
                            `[GATEWAY SERVER] Client sent FRONTEND_PORT ${clientSentOptions.FRONTEND_PORT}, but gateway is using ${internalGatewayOptions.FRONTEND_PORT} (from env/default). FrontendServer will not change port post-startup.`
                        );
                    }

                    if (frontendServerInstance) {
                        frontendServerInstance.setClientSentInitOptions(clientSentOptions); 
                        frontendServerInstance.setFinalEffectiveConfig(internalGatewayOptions); 
                    }

                    if (!internalGatewayOptions.OPENAI_API_KEY) {
                        const errorMsg = 'OpenAI API Key is required and was not set in environment.';
                        pinoLogger.error(errorMsg);
                        throw new ResponseError(ErrorCodes.ServerNotInitialized, errorMsg, {
                            missingKey: 'OPENAI_API_KEY',
                        });
                    }
                    pinoLogger.info(
                        { finalGatewayConfig: { ...internalGatewayOptions, OPENAI_API_KEY: '***' } },
                        '[GATEWAY SERVER] Final gateway configuration assembled post-initialize.',
                    );

                    backendManager = new BackendManager(pinoLogger);
                    try {
                        await backendManager.initializeAllBackends(internalGatewayOptions.backends);
                        if (frontendServerInstance && backendManager && typeof frontendServerInstance.setBackendManager === 'function') {
                            frontendServerInstance.setBackendManager(backendManager);
                        }
                    } catch (backendError) {
                        pinoLogger.error({ err: backendError }, "[GATEWAY SERVER] Error initializing backends");
                        throw backendError;
                    }

                    if (internalGatewayOptions.OPENAI_API_KEY) {
                        // Re-initialize llmOrchestrator with new backends list for correct tool generation
                        llmOrchestrator = new LLMOrchestratorService(
                            internalGatewayOptions.OPENAI_API_KEY,
                            internalGatewayOptions.backends, // NOW contains client-provided backends
                            pinoLogger
                        );
                        pinoLogger.info('[InitializeHandler] LLMOrchestratorService RE-INITIALIZED with updated backends for tool use.');
                    } else {
                        pinoLogger.warn('[InitializeHandler] OpenAI API key not available after client init. LLMOrchestrator (and tools) might be non-functional.');
                        llmOrchestrator = undefined;
                    }

                    pinoLogger.info(
                        '[GATEWAY SERVER] SUCCESSFULLY COMPLETED ALL INITIALIZATION LOGIC. ABOUT TO RETURN InitializeResult.',
                    );
                    exitInitLog();
                    return { capabilities: {}, serverInfo: { name: 'mcp-agentify', version: getPackageVersion() } };
                } catch (innerError) {
                    // Log the inner error for better debugging
                    pinoLogger.error({ err: innerError }, "[GATEWAY SERVER] Error in 'initialize' handler inner block");
                    // Re-throw the error to be caught by the outer try/catch or propagate to client
                    throw innerError;
                }
            } catch (error) {
                pinoLogger.error({ err: error }, "[GATEWAY SERVER] Unhandled error in 'initialize' handler");
                // If it's already a ResponseError, throw it directly
                if (error instanceof ResponseError) {
                    throw error;
                }
                // Otherwise, wrap it in a ResponseError
                throw new ResponseError(ErrorCodes.InternalError, `Internal server error during initialization: ${(error as Error).message}`);
            }
        }
    );

    mcpConnection.onRequest(
        'agentify/orchestrateTask',
        async (
            requestParams: AgentifyOrchestrateTaskParams,
            _cancellationToken: CancellationToken,
            rpcMessage?: RequestMessage,
        ) => {
            const exitOrchestrateLog = logFunctionEntryExit(getLogger(), 'mcpConnection.onRequest(agentify/orchestrateTask)', requestParams);
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
                    exitOrchestrateLog();
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

    mcpConnection.onRequest('ping', () => {
        const exitPingLog = logFunctionEntryExit(pinoLogger, 'mcpConnection.onRequest(ping)');
        (pinoLogger || tempConsoleLogger).info("[GATEWAY SERVER] Received 'ping', sending 'pong'.");
        exitPingLog();
        return 'pong';
    });

    // Add $/getManifest handler using mcpConnection
    mcpConnection.onRequest('$/getManifest', async (): Promise<{ tools: unknown[] }> => {
        const tools: unknown[] = [];
        pinoLogger.info('[GATEWAY SERVER] Received $/getManifest request.');

        // Static orchestrateTask tool
        tools.push({
            name: 'agentify/orchestrateTask',
            description: 'Plan and run a backend call for a user query based on AI orchestration.',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'The user query or task to orchestrate.' },
                    context: {
                        type: 'object',
                        properties: {
                            activeDocumentURI: {
                                type: 'string',
                                format: 'uri',
                                nullable: true,
                                description: 'URI of the active document.',
                            },
                            currentWorkingDirectory: {
                                type: 'string',
                                nullable: true,
                                description: 'Current working directory.',
                            },
                            selectionText: {
                                type: 'string',
                                nullable: true,
                                description: 'Currently selected text.',
                            },
                        },
                        nullable: true,
                        description: 'Contextual information for the task.',
                    },
                },
                required: ['query'],
            },
        });

        // Dynamic agent tools from AGENTS env var
        if (internalGatewayOptions.gptAgents) { // Check if gptAgents exists
            for (const fullAgentString of internalGatewayOptions.gptAgents) {
                const sanitized = fullAgentString.replace(/[^a-zA-Z0-9_\/]/g, '_').replace(/\//g, '_');
                const methodName = `agentify/agent_${sanitized}`;
                tools.push({
                    name: methodName,
                    description: `Direct chat with agent: ${fullAgentString}`,
                    parameters: {
                        type: 'object',
                        properties: {
                            query: {
                                type: 'string',
                                description: `Query to send to the ${fullAgentString} agent.`,
                            },
                            context: {
                                type: 'object',
                                properties: {
                                    activeDocumentURI: {
                                        type: 'string',
                                        format: 'uri',
                                        nullable: true,
                                    },
                                    currentWorkingDirectory: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                    selectionText: {
                                        type: 'string',
                                        nullable: true,
                                    },
                                },
                                nullable: true,
                            },
                        },
                        required: ['query'],
                    },
                });
            }
        }

        pinoLogger.info({ toolCount: tools.length }, 'Returning manifest.');
        return { tools };
    });

    pinoLogger.debug('[startAgentifyServer] Setting up MCP connection listener.');
    mcpConnection.listen();
    pinoLogger.info('[GATEWAY SERVER] MCP Agentify server fully started and listening on stdio (via startAgentifyServer).');
    
    exitLog();
    return new Promise(() => {
        /* This promise never resolves, keeping the process alive */
    });
}