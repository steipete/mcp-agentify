import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { BackendManager } from './backendManager';
import { FrontendServer } from './frontendServer';
import type { GatewayOptions } from './interfaces';
import { initializeLogger } from './logger';
import { LLMOrchestratorService } from './llmOrchestrator';
import { redactText } from './redaction';
import { getPackageVersion } from './utils';

export async function startAgentifyServer(options: GatewayOptions): Promise<void> {
    let logger = initializeLogger({ logLevel: options.logLevel });
    const backendManager = new BackendManager(logger);
    let frontendServer: FrontendServer | undefined;

    if (options.frontendPort) {
        frontendServer = new FrontendServer(options.frontendPort, logger, backendManager, options);
        await frontendServer.start();
        const logStream = frontendServer.getLogStream();
        if (logStream) {
            logger = initializeLogger({ logLevel: options.logLevel }, undefined, logStream);
            frontendServer.updateLogger(logger);
            backendManager.updateLogger(logger);
        }
    }

    try {
        await backendManager.initializeAllBackends(options.backends);
    } catch (error) {
        await frontendServer?.stop().catch(() => undefined);
        throw error;
    }

    const orchestrator = new LLMOrchestratorService(
        options.openaiApiKey,
        options.openaiModel,
        backendManager.getAvailableTools(),
        logger,
        options.openaiBaseUrl,
    );
    frontendServer?.setLlmOrchestrator(orchestrator);
    backendManager.on('backendUnavailable', (backendId: string) => {
        orchestrator.removeBackendTools(backendId);
    });

    const server = new McpServer(
        {
            name: 'mcp-agentify',
            version: getPackageVersion(),
            websiteUrl: 'https://github.com/steipete/mcp-agentify',
        },
        {
            capabilities: {
                logging: {},
            },
        },
    );

    server.registerTool(
        'orchestrate_task',
        {
            title: 'Orchestrate MCP Task',
            description:
                'Route a natural-language task to exactly one tool exposed by the configured backend MCP servers.',
            inputSchema: {
                query: z.string().min(1).describe('Natural-language task to route.'),
                context: z
                    .object({
                        activeDocumentURI: z.string().url().optional(),
                        currentWorkingDirectory: z.string().optional(),
                        selectionText: z.string().optional(),
                    })
                    .optional(),
            },
        },
        async ({ query, context }) => {
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

                logger.info(
                    { backendId: plan.backendId, toolName: plan.toolName },
                    'Executing orchestrated backend tool.',
                );
                const result = await backendManager.executeOnBackend(plan.backendId, plan.toolName, plan.arguments);
                return result;
            } catch (error) {
                const message = redactText(error instanceof Error ? error.message : String(error));
                logger.error({ err: error }, 'Task orchestration failed.');
                return {
                    isError: true,
                    content: [{ type: 'text', text: message }],
                };
            }
        },
    );

    const transport = new StdioServerTransport();
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
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
    logger.info(
        {
            backendCount: options.backends.length,
            toolCount: orchestrator.getAvailableToolCount(),
            frontendPort: frontendServer?.getPort() || null,
        },
        'mcp-agentify ready.',
    );
}
