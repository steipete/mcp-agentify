#!/usr/bin/env node
// src/cli.ts
import 'dotenv/config'; // Load .env file at the very top

// Earliest possible point to check raw environment variable
console.error(`[CLI PRE-INIT] Raw process.env.LOG_LEVEL: ${process.env.LOG_LEVEL}`);
console.error(`[CLI PRE-INIT] Raw process.env.DEBUG_PORT: ${process.env.DEBUG_PORT}`);

import { startAgentifyServer } from './server';
import { initializeLogger, getLogger } from './logger';
import type { PinoLogLevel } from './logger';
import type { GatewayOptions } from './interfaces';

// Initialize a basic logger early for CLI messages before full server init
// The final logger configuration (level, etc.) will be set during the MCP 'initialize' handshake.
const preliminaryLogLevel = (process.env.LOG_LEVEL as PinoLogLevel) || 'info';
const cliLogger = initializeLogger({ logLevel: preliminaryLogLevel });

async function main() {
    cliLogger.info('Starting mcp-agentify CLI...');

    const initialCliOptions: Partial<GatewayOptions> = {};
    if (process.env.LOG_LEVEL) {
        initialCliOptions.logLevel = process.env.LOG_LEVEL as PinoLogLevel;
    }
    if (process.env.DEBUG_PORT) {
        const port = Number.parseInt(process.env.DEBUG_PORT, 10);
        if (!Number.isNaN(port) && port > 0) {
            initialCliOptions.DEBUG_PORT = port;
        }
    }
    // OPENAI_API_KEY from .env will be read by GatewayOptionsSchema in onInitialize if not provided by client.
    // Or, we can pass it here if we want .env to be a direct override for initialCliOptions.
    // Spec 6. API Key Priority: process.env.OPENAI_API_KEY > initializationOptions.OPENAI_API_KEY.
    // This means the server logic (onInitialize) should prioritize env if it reads it.
    // For now, pass it if present in env, to make it available to the merge logic in onInitialize.
    if (process.env.OPENAI_API_KEY) {
        initialCliOptions.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    }

    // Read and parse AGENTS environment variable (comma-separated Vendor/ModelName)
    if (process.env.AGENTS) {
        try {
            const agentStrings = process.env.AGENTS.split(',').map(agent => agent.trim()).filter(agent => agent.length > 0);
            const processedAgents: string[] = [];

            for (const agentStr of agentStrings) {
                if (typeof agentStr === 'string' && agentStr.includes('/')) {
                    let [vendor, modelName] = agentStr.split('/', 2);
                    if (vendor.toLowerCase() === 'openai') {
                        vendor = 'openai'; // Standardize to lowercase for OpenAI
                    }
                    processedAgents.push(`${vendor}/${modelName}`);
                } else {
                    cliLogger.warn(`Invalid agent format: '${agentStr}'. Expected 'Vendor/ModelName'. Skipping.`);
                }
            }

            if (processedAgents.length > 0) {
                initialCliOptions.gptAgents = processedAgents;
                cliLogger.info({ gptAgents: processedAgents }, 'AGENTS environment variable processed.');
            } else if (agentStrings.length > 0) { // Some parts were there but all invalid
                 cliLogger.warn('AGENTS environment variable contained no valid Vendor/ModelName entries after parsing.');
            }
            // If agentStrings was empty from start, no warning needed here.

        } catch (error) {
            cliLogger.warn({ err: error, rawValue: process.env.AGENTS }, 'Error processing AGENTS environment variable. Ensure it is a comma-separated string. Ignoring.');
        }
    }

    cliLogger.debug({ initialCliOptionsFromEnv: initialCliOptions }, 'Initial CLI options prepared from environment.');

    await startAgentifyServer(initialCliOptions);

    // Note: At this point, startAgentifyServer has set up its own listeners within server.ts.
    // The listeners below are for the entire CLI process.
}

// Register process-wide event handlers *outside* main, so they are always active.

process.on('uncaughtException', (error: Error) => {
    // Use getLogger() for consistent logging, fallback to cliLogger if main logger isn't set.
    const logger = getLogger() || cliLogger;
    logger.fatal({ err: error, exceptionType: 'uncaughtException' }, 'Unhandled Exception at top level. Forcing exit.');
    // Attempt to perform any critical synchronous cleanup if possible, but expect exit.
    // Avoid async operations here as the process state is unstable.
    process.exit(1);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    const logger = getLogger() || cliLogger;
    let errorToLog = reason;
    if (reason instanceof Error) {
        errorToLog = { message: reason.message, stack: reason.stack, name: reason.name };
    }
    logger.fatal(
        { err: errorToLog, promiseDetails: promise, exceptionType: 'unhandledRejection' },
        'Unhandled Rejection at top level. Forcing exit.',
    );
    process.exit(1);
});

process.on('SIGINT', () => {
    const logger = getLogger() || cliLogger;
    logger.info('Received SIGINT signal. Attempting graceful shutdown...');
    // The server.ts connection.onClose and onNotification('exit') should handle backendManager shutdown.
    // Exiting here will trigger stream closures, which should propagate.
    process.exit(0);
});

process.on('SIGTERM', () => {
    const logger = getLogger() || cliLogger;
    logger.info('Received SIGTERM signal. Attempting graceful shutdown...');
    process.exit(0);
});

main().catch((error) => {
    const loggerToUse = getLogger() || cliLogger;
    const errorMessage = error instanceof Error ? error.message : String(error);
    // This catch is for errors specifically from the main() async function execution itself.
    loggerToUse.fatal(
        { err: error, rawErrorMessage: errorMessage },
        'mcp-agentify CLI failed during main() execution.',
    );
    process.exit(1);
});
