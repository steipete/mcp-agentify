"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeLogger = initializeLogger;
exports.getLogger = getLogger;
exports.logError = logError;
exports.logWarning = logWarning;
exports.logInfo = logInfo;
exports.logDebug = logDebug;
exports.resetLoggerForTest = resetLoggerForTest;
const pino_1 = __importDefault(require("pino"));
let loggerInstance;
function initializeLogger(options, testDestination) {
    const levelToUse = options?.logLevel || 'info';
    const pinoOptions = {
        level: levelToUse,
        serializers: {
            err: pino_1.default.stdSerializers.err, // Standard error serializer
            req: pino_1.default.stdSerializers.req, // Standard request serializer
            res: pino_1.default.stdSerializers.res, // Standard response serializer
            // Potentially add custom serializers here if needed
        },
    };
    let destinationStream = testDestination || pino_1.default.destination(process.stderr.fd); // Default to stderr
    if (process.env.NODE_ENV !== 'production') {
        pinoOptions.transport = {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l', // Example: 2023-10-27 14:30:45.123
                ignore: 'pid,hostname', // Optional: remove pid and hostname from pretty print
            },
        };
    }
    else {
        // For production, no transport means JSON output. It will go to destinationStream (stderr).
    }
    // Use testDestination if provided, otherwise pino defaults to process.stdout
    loggerInstance = (0, pino_1.default)(pinoOptions, destinationStream);
    // Avoid logging during test runs if a testDestination is used, as it might interfere with spy assertions
    // Or, log to the testDestination itself which is fine.
    loggerInstance.info(`Logger initialized with level: ${levelToUse}. Outputting to ${testDestination ? 'test destination' : 'stderr'}. NODE_ENV=${process.env.NODE_ENV}`);
    return loggerInstance;
}
function getLogger() {
    if (!loggerInstance) {
        // Initialize with default if not already done by the main application entry point
        // This is a fallback, ideally initializeLogger is called explicitly at startup.
        loggerInstance = initializeLogger();
    }
    return loggerInstance;
}
// --- Utility Logging Functions ---
/**
 * Logs an error with a contextual message and error object.
 * @param context - A string message or an object for structured context.
 * @param error - The error object.
 * @param message - Optional override message. If context is a string, it's used as the message.
 */
function logError(context, error, message) {
    const logger = getLogger();
    if (typeof context === 'string') {
        logger.error({ err: error }, message || context);
    }
    else {
        logger.error({ ...context, err: error }, message || 'An error occurred');
    }
}
/**
 * Logs a warning message with optional structured context.
 * @param context - A string message or an object for structured context.
 * @param message - Optional override message if context is an object.
 */
function logWarning(context, message) {
    const logger = getLogger();
    if (typeof context === 'string') {
        logger.warn(context);
    }
    else {
        logger.warn(context, message || 'Warning event');
    }
}
/**
 * Logs an informational message with optional structured context.
 * @param context - A string message or an object for structured context.
 * @param message - Optional override message if context is an object.
 */
function logInfo(context, message) {
    const logger = getLogger();
    if (typeof context === 'string') {
        logger.info(context);
    }
    else {
        logger.info(context, message || 'Informational event');
    }
}
/**
 * Logs a debug message with optional structured context.
 * @param context - A string message or an object for structured context.
 * @param message - Optional override message if context is an object.
 */
function logDebug(context, message) {
    const logger = getLogger();
    if (typeof context === 'string') {
        logger.debug(context);
    }
    else {
        logger.debug(context, message || 'Debug event');
    }
}
// Add for testing purposes to reset the module-level loggerInstance
function resetLoggerForTest() {
    if (loggerInstance && typeof loggerInstance.destroy === 'function') {
        // If pino v7+ has a MATE.destroy like method, or if stream needs explicit closing.
        // For basic pino, just nullifying the instance is often enough for testing re-initialization.
    }
    loggerInstance = undefined;
}
//# sourceMappingURL=logger.js.map