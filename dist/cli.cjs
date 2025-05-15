#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/cli.ts
require("dotenv/config"); // Load .env file at the very top
const server_1 = require("./server");
const logger_1 = require("./logger");
// Initialize a basic logger early for CLI messages before full server init
// The final logger configuration (level, etc.) will be set during the MCP 'initialize' handshake.
const preliminaryLogLevel = process.env.LOG_LEVEL || 'info';
const cliLogger = (0, logger_1.initializeLogger)({ logLevel: preliminaryLogLevel });
async function main() {
    cliLogger.info("Starting mcp-agentify CLI...");
    const initialCliOptions = {};
    if (process.env.LOG_LEVEL) {
        initialCliOptions.logLevel = process.env.LOG_LEVEL;
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
    cliLogger.debug({ initialCliOptionsFromEnv: initialCliOptions }, "Initial CLI options prepared from environment.");
    await (0, server_1.startAgentifyServer)(initialCliOptions);
    // Note: At this point, startAgentifyServer has set up its own listeners within server.ts.
    // The listeners below are for the entire CLI process.
}
// Register process-wide event handlers *outside* main, so they are always active.
process.on('uncaughtException', (error) => {
    // Use getLogger() for consistent logging, fallback to cliLogger if main logger isn't set.
    const logger = (0, logger_1.getLogger)() || cliLogger;
    logger.fatal({ err: error, exceptionType: 'uncaughtException' }, "Unhandled Exception at top level. Forcing exit.");
    // Attempt to perform any critical synchronous cleanup if possible, but expect exit.
    // Avoid async operations here as the process state is unstable.
    process.exit(1);
});
process.on('unhandledRejection', (reason, promise) => {
    const logger = (0, logger_1.getLogger)() || cliLogger;
    let errorToLog = reason;
    if (reason instanceof Error) {
        errorToLog = { message: reason.message, stack: reason.stack, name: reason.name };
    }
    logger.fatal({ err: errorToLog, promiseDetails: promise, exceptionType: 'unhandledRejection' }, "Unhandled Rejection at top level. Forcing exit.");
    process.exit(1);
});
process.on('SIGINT', () => {
    const logger = (0, logger_1.getLogger)() || cliLogger;
    logger.info("Received SIGINT signal. Attempting graceful shutdown...");
    // The server.ts connection.onClose and onNotification('exit') should handle backendManager shutdown.
    // Exiting here will trigger stream closures, which should propagate.
    process.exit(0);
});
process.on('SIGTERM', () => {
    const logger = (0, logger_1.getLogger)() || cliLogger;
    logger.info("Received SIGTERM signal. Attempting graceful shutdown...");
    process.exit(0);
});
main().catch(error => {
    const loggerToUse = (0, logger_1.getLogger)() || cliLogger;
    const errorMessage = error instanceof Error ? error.message : String(error);
    // This catch is for errors specifically from the main() async function execution itself.
    loggerToUse.fatal({ err: error, rawErrorMessage: errorMessage }, "mcp-agentify CLI failed during main() execution.");
    process.exit(1);
});
//# sourceMappingURL=cli.js.map