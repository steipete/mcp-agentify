"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startAgentifyServer = startAgentifyServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const v4_1 = require("zod/v4");
const backendManager_1 = require("./backendManager");
const frontendServer_1 = require("./frontendServer");
const logger_1 = require("./logger");
const llmOrchestrator_1 = require("./llmOrchestrator");
const redaction_1 = require("./redaction");
const utils_1 = require("./utils");
async function startAgentifyServer(options) {
    let logger = (0, logger_1.initializeLogger)({ logLevel: options.logLevel });
    const backendManager = new backendManager_1.BackendManager(logger);
    let frontendServer;
    if (options.frontendPort) {
        frontendServer = new frontendServer_1.FrontendServer(options.frontendPort, logger, backendManager, options);
        await frontendServer.start();
        const logStream = frontendServer.getLogStream();
        if (logStream) {
            logger = (0, logger_1.initializeLogger)({ logLevel: options.logLevel }, undefined, logStream);
            frontendServer.updateLogger(logger);
            backendManager.updateLogger(logger);
        }
    }
    try {
        await backendManager.initializeAllBackends(options.backends);
    }
    catch (error) {
        await frontendServer?.stop().catch(() => undefined);
        throw error;
    }
    const orchestrator = new llmOrchestrator_1.LLMOrchestratorService(options.openaiApiKey, options.openaiModel, backendManager.getAvailableTools(), logger, options.openaiBaseUrl);
    frontendServer?.setLlmOrchestrator(orchestrator);
    backendManager.on('backendUnavailable', (backendId) => {
        orchestrator.removeBackendTools(backendId);
    });
    const server = new mcp_js_1.McpServer({
        name: 'mcp-agentify',
        version: (0, utils_1.getPackageVersion)(),
        websiteUrl: 'https://github.com/steipete/mcp-agentify',
    }, {
        capabilities: {
            logging: {},
        },
    });
    server.registerTool('orchestrate_task', {
        title: 'Orchestrate MCP Task',
        description: 'Route a natural-language task to exactly one tool exposed by the configured backend MCP servers.',
        inputSchema: {
            query: v4_1.z.string().min(1).describe('Natural-language task to route.'),
            context: v4_1.z
                .object({
                activeDocumentURI: v4_1.z.string().url().optional(),
                currentWorkingDirectory: v4_1.z.string().optional(),
                selectionText: v4_1.z.string().optional(),
            })
                .optional(),
        },
    }, async ({ query, context }) => {
        frontendServer?.addMcpTrace({
            timestamp: Date.now(),
            direction: 'INCOMING_TO_GATEWAY',
            method: 'orchestrate_task',
            paramsOrResult: { query, context },
        });
        try {
            const plan = await orchestrator.orchestrate(query, context);
            if (!plan) {
                return {
                    isError: true,
                    content: [{ type: 'text', text: 'No configured backend tool could satisfy the request.' }],
                };
            }
            logger.info({ backendId: plan.backendId, toolName: plan.toolName }, 'Executing orchestrated backend tool.');
            const result = await backendManager.executeOnBackend(plan.backendId, plan.toolName, plan.arguments);
            return result;
        }
        catch (error) {
            const message = (0, redaction_1.redactText)(error instanceof Error ? error.message : String(error));
            logger.error({ err: error }, 'Task orchestration failed.');
            return {
                isError: true,
                content: [{ type: 'text', text: message }],
            };
        }
    });
    const transport = new stdio_js_1.StdioServerTransport();
    let shuttingDown = false;
    const shutdown = async (signal) => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;
        logger.info({ signal }, 'Shutting down.');
        await Promise.allSettled([
            server.close(),
            backendManager.shutdownAllBackends(),
            frontendServer?.stop() || Promise.resolve(),
        ]);
    };
    process.once('SIGINT', () => {
        void shutdown('SIGINT').finally(() => process.exit(0));
    });
    process.once('SIGTERM', () => {
        void shutdown('SIGTERM').finally(() => process.exit(0));
    });
    const handleStdioDisconnect = () => {
        void shutdown('stdio-disconnect').finally(() => process.exit(0));
    };
    process.stdin.once('end', handleStdioDisconnect);
    process.stdin.once('close', handleStdioDisconnect);
    await server.connect(transport);
    logger.info({
        backendCount: options.backends.length,
        toolCount: orchestrator.getAvailableToolCount(),
        frontendPort: frontendServer?.getPort() || null,
    }, 'mcp-agentify ready.');
}
//# sourceMappingURL=server.js.map