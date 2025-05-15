"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAgentifyServer = startAgentifyServer;
const node_1 = require("vscode-jsonrpc/node");
const logger_1 = require("./logger");
const backendManager_1 = require("./backendManager");
const llmOrchestrator_1 = require("./llmOrchestrator");
const debugWebServer_1 = require("./debugWebServer");
const schemas_1 = require("./schemas");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
let pinoLogger;
let gatewayOptions;
let backendManager;
let llmOrchestrator;
let debugWebServerInstance;
const tempConsoleLogger = {
    error: (message) => console.error(`[TEMP ERROR] ${message}`),
    warn: (message) => console.warn(`[TEMP WARN] ${message}`),
    info: (message) => console.error(`[TEMP INFO] ${message}`),
    log: (message) => console.error(`[TEMP LOG] ${message}`),
};
function getPackageVersion() {
    try {
        const packageJsonPath = (0, node_path_1.resolve)(process.cwd(), 'package.json');
        const packageJson = JSON.parse((0, node_fs_1.readFileSync)(packageJsonPath, 'utf-8'));
        return packageJson.version || '0.1.0';
    }
    catch (error) {
        (pinoLogger || tempConsoleLogger).warn({ err: error }, 'Could not read package.json version, defaulting.');
        return '0.1.0';
    }
}
async function startAgentifyServer(initialCliOptions) {
    const connection = (0, node_1.createMessageConnection)(process.stdin, process.stdout, tempConsoleLogger);
    connection.onClose(() => {
        (0, logger_1.getLogger)().info('Client connection closed.');
        if (backendManager) {
            backendManager
                .shutdownAllBackends()
                .catch((err) => (0, logger_1.getLogger)().error({ err }, `Error during shutdownAllBackends on connection close: ${err.message}`));
        }
    });
    connection.onError((error) => {
        (0, logger_1.getLogger)().error({ error }, `Connection error: ${JSON.stringify(error)}`);
    });
    connection.onNotification('shutdown', async () => {
        (0, logger_1.getLogger)().info('Received shutdown notification from client. Initiating graceful shutdown...');
        if (debugWebServerInstance) {
            await debugWebServerInstance
                .stop()
                .catch((err) => (0, logger_1.getLogger)().error({ err }, 'Error stopping debug web server during shutdown'));
        }
        if (backendManager) {
            try {
                await backendManager.shutdownAllBackends();
                (0, logger_1.getLogger)().info('All backends successfully shut down.');
            }
            catch (err) {
                (0, logger_1.getLogger)().error({ err }, 'Error during shutdownAllBackends call from shutdown notification.');
            }
        }
    });
    connection.onNotification('exit', () => {
        (0, logger_1.getLogger)().info('Received exit notification from client. Exiting process now.');
        if (debugWebServerInstance) {
            debugWebServerInstance
                .stop()
                .catch((err) => (0, logger_1.getLogger)().error({ err }, 'Error stopping debug web server during exit'));
        }
        if (backendManager) {
            backendManager.shutdownAllBackends().catch((err) => {
                (0, logger_1.getLogger)().error({ err }, 'Error during final backend shutdown on exit notification.');
            });
        }
        process.exit(0);
    });
    connection.onRequest(new node_1.RequestType('initialize'), async (params, _token) => {
        const handlerLogger = pinoLogger || tempConsoleLogger;
        handlerLogger.info({ initParamsReceived: params }, "[GATEWAY SERVER] 'initialize' handler started.");
        try {
            const earlyLogger = pinoLogger || tempConsoleLogger;
            earlyLogger.info({ initParamsReceived: params }, "[GATEWAY SERVER] Received 'initialize' request.");
            const mergedOptionsFromClientAndCli = {
                ...(initialCliOptions || {}),
                ...(params.initializationOptions || {}),
            };
            const validationResult = schemas_1.GatewayOptionsSchema.safeParse(mergedOptionsFromClientAndCli);
            if (!validationResult.success) {
                const errorMsg = 'Invalid initialization options provided.';
                tempConsoleLogger.error(`${errorMsg} Errors: ${JSON.stringify(validationResult.error.format())}`);
                throw new node_1.ResponseError(node_1.ErrorCodes.InvalidParams, errorMsg, {
                    validationErrors: validationResult.error.format(),
                });
            }
            gatewayOptions = validationResult.data;
            const apiKeyToUse = process.env.OPENAI_API_KEY || gatewayOptions.OPENAI_API_KEY;
            if (!apiKeyToUse) {
                const errorMsg = 'OpenAI API Key is required but not found in environment variables or initialization options.';
                tempConsoleLogger.error(errorMsg);
                throw new node_1.ResponseError(node_1.ErrorCodes.InvalidParams, errorMsg, { missingKey: 'OPENAI_API_KEY' });
            }
            pinoLogger = (0, logger_1.initializeLogger)({ logLevel: gatewayOptions.logLevel });
            pinoLogger.info({ gatewayOptions: { ...gatewayOptions, OPENAI_API_KEY: '***' } }, '[GATEWAY SERVER] Options processed. Logger initialized.');
            pinoLogger.info('[GATEWAY SERVER] Initializing BackendManager...');
            backendManager = new backendManager_1.BackendManager(pinoLogger);
            try {
                await backendManager.initializeAllBackends(gatewayOptions.backends);
                pinoLogger.info('[GATEWAY SERVER] BackendManager initialized all backends successfully.');
            }
            catch (err) {
                const backendInitErrorMsg = `Critical error during BackendManager initialization: ${err.message}`;
                pinoLogger.error({ err }, `[GATEWAY SERVER] ${backendInitErrorMsg}`);
                throw new node_1.ResponseError(-32006, backendInitErrorMsg, { originalError: err.message });
            }
            pinoLogger.info('[GATEWAY SERVER] Initializing LLMOrchestratorService...');
            try {
                llmOrchestrator = new llmOrchestrator_1.LLMOrchestratorService(apiKeyToUse, gatewayOptions.backends, pinoLogger);
                pinoLogger.info('[GATEWAY SERVER] LLMOrchestratorService initialized.');
            }
            catch (err) {
                const llmInitErrorMsg = `Fatal error initializing LLMOrchestratorService: ${err.message}`;
                pinoLogger.error({ err }, `[GATEWAY SERVER] ${llmInitErrorMsg}`);
                throw new node_1.ResponseError(-32005, llmInitErrorMsg, { originalError: err.message });
            }
            if (gatewayOptions.DEBUG_PORT && gatewayOptions.DEBUG_PORT > 0) {
                pinoLogger.info(`[GATEWAY SERVER] Debug port ${gatewayOptions.DEBUG_PORT} specified. Initializing DebugWebServer.`);
                try {
                    debugWebServerInstance = new debugWebServer_1.DebugWebServer(gatewayOptions.DEBUG_PORT, pinoLogger, backendManager, gatewayOptions);
                    debugWebServerInstance.start();
                    pinoLogger.info('[GATEWAY SERVER] DebugWebServer started.');
                }
                catch (err) {
                    pinoLogger.error({ err }, '[GATEWAY SERVER] Failed to start DebugWebServer.');
                }
            }
            pinoLogger.info('[GATEWAY SERVER] SUCCESSFULLY COMPLETED ALL INITIALIZATION LOGIC. ABOUT TO RETURN InitializeResult.');
            const serverCapabilities = {};
            return {
                capabilities: serverCapabilities,
                serverInfo: { name: 'mcp-agentify', version: getPackageVersion() },
            };
        }
        catch (error) {
            const finalLogger = pinoLogger || tempConsoleLogger;
            finalLogger.error({ errCaughtInInitialize: error }, "[GATEWAY SERVER] Error caught at top of 'initialize' handler.");
            if (error instanceof node_1.ResponseError) {
                throw error;
            }
            throw new node_1.ResponseError(node_1.ErrorCodes.InternalError, 'Internal server error during initialization.', {
                originalMessage: error.message,
            });
        }
    });
    connection.onRequest('agentify/orchestrateTask', async (requestParams, _cancellationToken, rpcMessage) => {
        const handlerLogger = (0, logger_1.getLogger)();
        handlerLogger.info({ method: rpcMessage?.method, id: rpcMessage?.id, params: requestParams }, "[GATEWAY SERVER] 'agentify/orchestrateTask' handler started.");
        try {
            const validatedParams = schemas_1.AgentifyOrchestrateTaskParamsSchema.safeParse(requestParams);
            if (!validatedParams.success) {
                handlerLogger.error({ errors: validatedParams.error.format(), requestParams }, "Invalid parameters for 'agentify/orchestrateTask'.");
                throw new node_1.ResponseError(node_1.ErrorCodes.InvalidParams, 'Invalid parameters provided.', {
                    validationErrors: validatedParams.error.format(),
                });
            }
            if (!llmOrchestrator || !backendManager || !gatewayOptions) {
                handlerLogger.warn("'agentify/orchestrateTask' called before gateway was fully initialized (llm, backend, or options missing).");
                throw new node_1.ResponseError(-32001, 'Gateway not fully initialized. Please wait or ensure the initialize request was successful.');
            }
            handlerLogger.debug('Calling LLM orchestrator...');
            let plan;
            try {
                plan = await llmOrchestrator.orchestrate(validatedParams.data.query, validatedParams.data.context);
            }
            catch (err) {
                handlerLogger.error({ err }, 'LLM orchestrator threw an unexpected error.');
                throw new node_1.ResponseError(-32003, 'Error during AI orchestration step.');
            }
            if (!plan) {
                handlerLogger.warn({ query: validatedParams.data.query }, 'AI orchestrator could not determine an action for the query.');
                throw new node_1.ResponseError(-32000, 'AI orchestrator could not determine an action for your query.', {
                    query: validatedParams.data.query,
                });
            }
            handlerLogger.info({ plan }, 'LLM orchestrator returned a plan.');
            handlerLogger.debug(`Executing plan on backend: ${plan.backendId}, method: ${plan.mcpMethod}`);
            try {
                const result = await backendManager.executeOnBackend(plan.backendId, plan.mcpMethod, plan.mcpParams);
                handlerLogger.info({ backendId: plan.backendId, method: plan.mcpMethod, result }, 'Successfully executed plan on backend.');
                return result;
            }
            catch (err) {
                handlerLogger.error({ err, plan }, 'Error executing plan on backend.');
                const errorForClient = err instanceof Error ? err.message : 'Unknown error executing backend plan.';
                const errorData = {
                    backendId: plan.backendId,
                    mcpMethod: plan.mcpMethod,
                    originalError: errorForClient,
                };
                throw new node_1.ResponseError(-32004, `Error executing plan on backend '${plan.backendId}': ${errorForClient}`, errorData);
            }
        }
        catch (error) {
            const finalLogger = (0, logger_1.getLogger)();
            finalLogger.error({ errCaughtInOrchestrate: error }, "[GATEWAY SERVER] Error caught at top of 'agentify/orchestrateTask' handler.");
            if (error instanceof node_1.ResponseError) {
                throw error;
            }
            throw new node_1.ResponseError(node_1.ErrorCodes.InternalError, 'Internal server error during task orchestration.', {
                originalMessage: error.message,
            });
        }
    });
    connection.onRequest('ping', () => {
        (pinoLogger || tempConsoleLogger).info("[GATEWAY SERVER] Received 'ping', sending 'pong'.");
        return 'pong';
    });
    connection.listen();
    tempConsoleLogger.info("mcp-agentify server logic started. Listening for client connection via stdio. Logger will be fully initialized upon receiving 'initialize' request.");
}
//# sourceMappingURL=server.js.map