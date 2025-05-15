import { createMessageConnection, ErrorCodes, ResponseError, RequestType } from 'vscode-jsonrpc/node';
import type { MessageConnection, RequestMessage } from 'vscode-jsonrpc/node';
import type { InitializeParams, InitializeResult, ServerCapabilities } from 'vscode-languageserver-protocol';
import type { CancellationToken } from 'vscode-jsonrpc';

import type { Logger as PinoLoggerType } from 'pino';

import { initializeLogger, getLogger, PinoLogLevel } from './logger'; // App's logger
import { BackendManager } from './backendManager';
import { LLMOrchestratorService } from './llmOrchestrator';
import type { GatewayOptions, AgentifyOrchestrateTaskParams, Plan } from './interfaces';
import { GatewayOptionsSchema, AgentifyOrchestrateTaskParamsSchema } from './schemas';
import { readFileSync } from 'node:fs'; // For reading package.json version
import { resolve } from 'node:path'; // For resolving package.json path

// Module-level state, will be initialized in onInitialize
let pinoLogger: PinoLoggerType<PinoLogLevel>;
let gatewayOptions: GatewayOptions | undefined;
let backendManager: BackendManager | undefined;
let llmOrchestrator: LLMOrchestratorService | undefined;

// Temporary logger for very early messages, ALL output to stderr
const tempConsoleLogger = {
    error: (message: string) => console.error(`[TEMP ERROR] ${message}`),
    warn: (message: string) => console.warn(`[TEMP WARN] ${message}`), // console.warn typically goes to stderr
    info: (message: string) => console.error(`[TEMP INFO] ${message}`), // Explicitly use console.error for info
    log: (message: string) => console.error(`[TEMP LOG] ${message}`), // Explicitly use console.error for generic log
};

// Function to get package version
function getPackageVersion(): string {
    try {
        const packageJsonPath = resolve(process.cwd(), 'package.json');
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        return packageJson.version || '0.1.0'; // Default if version not found
    } catch (error) {
        (pinoLogger || tempConsoleLogger).warn({ err: error }, 'Could not read package.json version, defaulting.');
        return '0.1.0'; // Default on error
    }
}

export async function startAgentifyServer(initialCliOptions?: Partial<GatewayOptions>) {
    // Create the main connection to the client (e.g., IDE) via stdio
    const connection: MessageConnection = createMessageConnection(
        process.stdin,
        process.stdout,

        tempConsoleLogger as any, // Cast for bootstrap phase, actual logger set in onInitialize
    );

    connection.onClose(() => {
        // Use getLogger for safety, as pinoLogger might not be set if onClose fires before onInitialize completes
        getLogger().info('Client connection closed.');
        if (backendManager) {
            // This check is crucial
            backendManager.shutdownAllBackends().catch((err) => {
                getLogger().error(
                    { err },
                    `Error during shutdownAllBackends on connection close: ${(err as Error).message}`,
                );
            });
        }
    });

    connection.onError((error) => {
        getLogger().error({ error }, `Connection error: ${JSON.stringify(error)}`);
    });

    // Shutdown notification from client
    connection.onNotification('shutdown', async () => {
        getLogger().info('Received shutdown notification from client. Initiating graceful shutdown of backends.');
        if (backendManager) {
            // Crucial check
            try {
                await backendManager.shutdownAllBackends();
                getLogger().info('All backends successfully shut down.');
            } catch (err) {
                getLogger().error({ err }, 'Error during shutdownAllBackends call from shutdown notification.');
            }
        }
        // Client is expected to send 'exit' after this, or close connection.
    });

    // Exit notification from client
    connection.onNotification('exit', () => {
        getLogger().info('Received exit notification from client. Exiting process now.');
        if (backendManager) {
            // Crucial check
            backendManager.shutdownAllBackends().catch((err) => {
                getLogger().error({ err }, 'Error during final backend shutdown on exit notification.');
            });
        }
        process.exit(0);
    });

    // Initialize handler
    connection.onRequest(
        new RequestType<InitializeParams, InitializeResult, ResponseError<undefined>>('initialize'),
        async (params: InitializeParams, token: CancellationToken): Promise<InitializeResult> => {
            const handlerLogger = pinoLogger || tempConsoleLogger;
            handlerLogger.info({ initParamsReceived: params }, "[GATEWAY SERVER] 'initialize' handler started.");
            try {
                const earlyLogger = pinoLogger || tempConsoleLogger; // Logger available at this point might be temp
                earlyLogger.info({ initParamsReceived: params }, "[GATEWAY SERVER] Received 'initialize' request.");

                const mergedOptionsFromClientAndCli = {
                    ...(initialCliOptions || {}),
                    ...(params.initializationOptions || {}),
                };
                // Validate the structure of what we received, OPENAI_API_KEY is now optional here.
                const validationResult = GatewayOptionsSchema.safeParse(mergedOptionsFromClientAndCli);
                if (!validationResult.success) {
                    const errorMsg = 'Invalid initialization options provided.';
                    tempConsoleLogger.error(`${errorMsg} Errors: ${JSON.stringify(validationResult.error.format())}`);
                    throw new ResponseError(ErrorCodes.InvalidParams, errorMsg, {
                        validationErrors: validationResult.error.format(),
                    });
                }
                gatewayOptions = validationResult.data; // This now has OPENAI_API_KEY as potentially undefined

                // Determine final API key based on priority: env > client options (passed via mergedOptions)
                const apiKeyToUse = process.env.OPENAI_API_KEY || gatewayOptions.OPENAI_API_KEY;

                if (!apiKeyToUse) {
                    const errorMsg =
                        'OpenAI API Key is required but not found in environment variables or initialization options.';
                    tempConsoleLogger.error(errorMsg);
                    throw new ResponseError(ErrorCodes.InvalidParams, errorMsg, { missingKey: 'OPENAI_API_KEY' });
                }

                // Now, pinoLogger can be initialized using the determined logLevel
                pinoLogger = initializeLogger({ logLevel: gatewayOptions.logLevel as PinoLogLevel });
                pinoLogger.info(
                    { gatewayOptions: { ...gatewayOptions, OPENAI_API_KEY: '***' } },
                    '[GATEWAY SERVER] Options processed. Logger initialized.',
                );

                // Initialize BackendManager (as before)
                pinoLogger.info('[GATEWAY SERVER] Initializing BackendManager...');
                backendManager = new BackendManager(pinoLogger);
                try {
                    await backendManager.initializeAllBackends(gatewayOptions.backends);
                    pinoLogger.info('[GATEWAY SERVER] BackendManager initialized all backends successfully.');
                } catch (err: unknown) {
                    const backendInitErrorMsg = `Critical error during BackendManager initialization: ${(err as Error).message}`;
                    pinoLogger.error({ err }, `[GATEWAY SERVER] ${backendInitErrorMsg}`);
                    // This is a fatal error for the gateway if backends are essential.
                    throw new ResponseError(-32006, backendInitErrorMsg, { originalError: (err as Error).message });
                }

                // Initialize LLMOrchestratorService with the prioritized apiKeyToUse
                pinoLogger.info('[GATEWAY SERVER] Initializing LLMOrchestratorService...');
                try {
                    llmOrchestrator = new LLMOrchestratorService(
                        apiKeyToUse, // Use the prioritized key
                        gatewayOptions.backends,
                        pinoLogger,
                    );
                    pinoLogger.info('[GATEWAY SERVER] LLMOrchestratorService initialized.');
                } catch (err: unknown) {
                    const llmInitErrorMsg = `Fatal error initializing LLMOrchestratorService: ${(err as Error).message}`;
                    pinoLogger.error({ err }, `[GATEWAY SERVER] ${llmInitErrorMsg}`);
                    throw new ResponseError(-32005, llmInitErrorMsg, { originalError: (err as Error).message });
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
                    throw error; // Re-throw ResponseError as is
                }
                // Convert other errors to a generic internal server error
                throw new ResponseError(ErrorCodes.InternalError, 'Internal server error during initialization.', {
                    originalMessage: (error as Error).message,
                });
            }
        },
    );

    // Request handler for 'agentify/orchestrateTask'
    connection.onRequest(
        'agentify/orchestrateTask',
        async (
            requestParams: AgentifyOrchestrateTaskParams,
            cancellationToken: CancellationToken,
            rpcMessage?: RequestMessage,
        ) => {
            const handlerLogger = getLogger(); // Assumes pinoLogger is initialized
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
                const finalLogger = getLogger(); // pinoLogger should be set
                finalLogger.error(
                    { errCaughtInOrchestrate: error },
                    "[GATEWAY SERVER] Error caught at top of 'agentify/orchestrateTask' handler.",
                );
                if (error instanceof ResponseError) {
                    throw error; // Re-throw known ResponseErrors
                }
                throw new ResponseError(ErrorCodes.InternalError, 'Internal server error during task orchestration.', {
                    originalMessage: (error as Error).message,
                });
            }
        },
    );

    // Add a simple ping handler for integration testing
    connection.onRequest('ping', () => {
        (pinoLogger || tempConsoleLogger).info("[GATEWAY SERVER] Received 'ping', sending 'pong'.");
        return 'pong';
    });

    connection.listen();
    // This initial startup message now also goes to stderr via tempConsoleLogger.error or .info (which is now console.error)
    tempConsoleLogger.info(
        "mcp-agentify server logic started. Listening for client connection via stdio. Logger will be fully initialized upon receiving 'initialize' request.",
    );
}
