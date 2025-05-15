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
    // --- START EARLY AND FINAL CORE INITIALIZATION ---
    const envLogLevel: PinoLogLevel = initialCliOptions?.logLevel || 'info';
    // Ensure FRONTEND_PORT from initialCliOptions is used, default to 3030 if undefined, respect null if 'disabled'
    const envFrontendPort: number | null = initialCliOptions?.FRONTEND_PORT === undefined 
        ? 3030 
        : initialCliOptions.FRONTEND_PORT;
    const envOpenApiKey: string | undefined = initialCliOptions?.OPENAI_API_KEY;
    const envGptAgents: string[] | undefined = initialCliOptions?.gptAgents;

    // Initialize logger first, it might be updated if FrontendServer provides a stream
    let tempPinoLogger: PinoLoggerType<PinoLogLevel> = initializeLogger({ logLevel: envLogLevel });
    pinoLogger = tempPinoLogger; // Assign to module scope early

    pinoLogger.info('[GATEWAY SERVER PRE-INIT] Initializing Agentify server...');

    // Start FrontendServer early if configured and not explicitly disabled
    if (typeof envFrontendPort === 'number' && envFrontendPort > 0) {
        pinoLogger.info(
            `[GATEWAY SERVER PRE-INIT] FRONTEND_PORT ${envFrontendPort} active. Attempting to start FrontendServer.`,
        );
        try {
            frontendServerInstance = new FrontendServer(
                envFrontendPort,
                pinoLogger, // Pass current logger
                undefined, // BackendManager not available yet
                { FRONTEND_PORT: envFrontendPort, logLevel: envLogLevel, OPENAI_API_KEY: envOpenApiKey } as GatewayOptions, // Pass relevant initial config
            );
            await frontendServerInstance.start(); 

            const logStreamForPino = frontendServerInstance?.getLogStream();
            if (logStreamForPino) {
                pinoLogger = initializeLogger({ logLevel: envLogLevel }, undefined, logStreamForPino);
                frontendServerInstance.updateLogger(pinoLogger);
                pinoLogger.info(
                    '[GATEWAY SERVER PRE-INIT] Main logger updated with FrontendServer stream.',
                );
            }
        } catch (err) {
            pinoLogger.error({ err }, `[GATEWAY SERVER PRE-INIT] Failed to start FrontendServer on port ${envFrontendPort}.`);
        }
    } else {
        pinoLogger.info('[GATEWAY SERVER PRE-INIT] FrontendServer is disabled (FRONTEND_PORT is null, zero, or not a number).');
    }

    // Construct the initial internalGatewayOptions from environment variables / defaults
    internalGatewayOptions = {
        logLevel: envLogLevel,
        FRONTEND_PORT: envFrontendPort,
        OPENAI_API_KEY: envOpenApiKey,
        backends: [], // Initialize with empty backends; will be populated from client
        gptAgents: envGptAgents || [],
    };

    if (!internalGatewayOptions.OPENAI_API_KEY) {
        pinoLogger.warn(
            '[GATEWAY SERVER] WARNING: OPENAI_API_KEY is not set. Orchestration features will fail.'
        );
    }

    pinoLogger.info(
        {
            initialConfig: {
                logLevel: internalGatewayOptions.logLevel,
                FRONTEND_PORT: internalGatewayOptions.FRONTEND_PORT,
                OPENAI_API_KEY: internalGatewayOptions.OPENAI_API_KEY ? '***' : undefined,
                gptAgents: internalGatewayOptions.gptAgents,
            },
        },
        '[GATEWAY SERVER] Initial core configuration from environment/CLI options established.',
    );

    const connection: MessageConnection = createMessageConnection(process.stdin, process.stdout, tempConsoleLogger as any);
    mcpConnection = connection;

    mcpRequester = async (method: string, params: unknown) => {
        if (!mcpConnection) {
            pinoLogger.error('MCP connection not available for mcpRequester.');
            throw new Error('MCP connection not available');
        }
        pinoLogger.info({ method, params }, '[mcpRequester] Sending request via main connection.');
        return mcpConnection.sendRequest(method, params);
    };

    if (frontendServerInstance && mcpRequester && typeof frontendServerInstance.setMcpRequester === 'function') {
        frontendServerInstance.setMcpRequester(mcpRequester);
    }

    // Dynamic agent registration
    if (internalGatewayOptions.gptAgents && internalGatewayOptions.gptAgents.length > 0) {
        pinoLogger.info(
            { agents: internalGatewayOptions.gptAgents },
            '[GATEWAY SERVER] Registering dynamic agent methods from AGENTS config...',
        );
        for (const fullAgentString of internalGatewayOptions.gptAgents) {
            const sanitizedMethodPart = fullAgentString.replace(/[^a-zA-Z0-9_\/]/g, '_').replace(/\//g, '_');
            const methodName = `agentify/agent_${sanitizedMethodPart}`;
            pinoLogger.info(
                `[GATEWAY SERVER] Registering method: ${methodName} for agent: ${fullAgentString}`
            );
            connection.onRequest(
                methodName, 
                async (requestParams: { query: string; context?: OrchestrationContext }) => {
                    pinoLogger.info(
                        { method: methodName, agent: fullAgentString, params: requestParams },
                        `Dynamic agent method ${methodName} called.`,
                    );
                    if (!llmOrchestrator) {
                        pinoLogger.error(
                            { method: methodName }, 
                            "LLMOrchestrator not available yet for dynamic agent call (waits for client 'initialize')."
                        );
                        return {
                            message: `Agent '${fullAgentString}' called too early. LLM Orchestrator not ready.`,
                            note: "LLM Orchestrator is initialized after client sends MCP 'initialize' request."
                        };
                    }
                    if (!internalGatewayOptions.OPENAI_API_KEY) { // Check API key before attempting to use LLM
                        pinoLogger.error(
                            { method: methodName, agent: fullAgentString }, 
                            "Cannot process dynamic agent request: OpenAI API key is not configured."
                        );
                        throw new ResponseError(ErrorCodes.InternalError, "OpenAI API key not configured for this agent.");
                    }
                    // TODO: Future - llmOrchestrator.invokeAgent(fullAgentString, requestParams.query, requestParams.context);
                    return {
                        message: `Agent '${fullAgentString}' received query: "${requestParams.query}". Context: ${JSON.stringify(
                            requestParams.context || {},
                        )}`,
                        note: 'This is a placeholder response. Full LLM interaction for dynamic agents is not yet implemented for early calls.',
                    };
                }
            );
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
        // Stop FrontendServer if it was started
        if (frontendServerInstance) {
            frontendServerInstance
                .stop()
                .catch((err) => getLogger().error({ err }, 'Error stopping frontend server on close.'));
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
            pinoLogger.info(
                { initParamsReceivedClient: params.initializationOptions },
                "[GATEWAY SERVER] 'initialize' handler: Received options from client."
            );

            const clientOptionsValidation = GatewayClientInitOptionsSchema.safeParse(params.initializationOptions);
            if (!clientOptionsValidation.success) {
                const errorMsg = 'Invalid client initializationOptions structure (backends are required).';
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
            await backendManager.initializeAllBackends(internalGatewayOptions.backends);
            if (frontendServerInstance && backendManager && typeof frontendServerInstance.setBackendManager === 'function') {
                frontendServerInstance.setBackendManager(backendManager);
            }

            llmOrchestrator = new LLMOrchestratorService(
                internalGatewayOptions.OPENAI_API_KEY,
                internalGatewayOptions.backends,
                pinoLogger,
            );
            pinoLogger.info('[GATEWAY SERVER] LLMOrchestratorService initialized.');

            pinoLogger.info(
                '[GATEWAY SERVER] SUCCESSFULLY COMPLETED ALL INITIALIZATION LOGIC. ABOUT TO RETURN InitializeResult.',
            );
            return { capabilities: {}, serverInfo: { name: 'mcp-agentify', version: getPackageVersion() } };
        }
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