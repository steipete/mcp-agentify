import pino from 'pino';
import type { GatewayOptions } from './interfaces'; // Assuming GatewayOptions will be in interfaces.ts

let loggerInstance: pino.Logger<PinoLogLevel> | undefined;

// Define pino.LevelWithSilent if not already available from pino types directly
// pino v7+ has pino.LevelWithSilent
export type PinoLogLevel = pino.LevelWithSilent;

export function initializeLogger(
    options?: Pick<GatewayOptions, 'logLevel'>,
    testDestination?: pino.DestinationStream, // Optional destination for testing
): pino.Logger<PinoLogLevel> {
    const levelToUse = options?.logLevel || 'info';

    const pinoOptions: pino.LoggerOptions<PinoLogLevel> = {
        level: levelToUse,
        serializers: {
            err: pino.stdSerializers.err, // Standard error serializer
            req: pino.stdSerializers.req, // Standard request serializer
            res: pino.stdSerializers.res, // Standard response serializer
            // Potentially add custom serializers here if needed
        },
    };

    let destinationStream: pino.DestinationStream = testDestination || pino.destination(process.stderr.fd); // Default to stderr

    if (process.env.NODE_ENV !== 'production') {
        pinoOptions.transport = {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l', // Example: 2023-10-27 14:30:45.123
                ignore: 'pid,hostname', // Optional: remove pid and hostname from pretty print
            },
        };
    } else {
        // For production, no transport means JSON output. It will go to destinationStream (stderr).
    }

    // Use testDestination if provided, otherwise pino defaults to process.stdout
    loggerInstance = pino(pinoOptions, destinationStream);

    // Avoid logging during test runs if a testDestination is used, as it might interfere with spy assertions
    // Or, log to the testDestination itself which is fine.
    loggerInstance.info(
        `Logger initialized with level: ${levelToUse}. Outputting to ${testDestination ? 'test destination' : 'stderr'}. NODE_ENV=${process.env.NODE_ENV}`,
    );
    return loggerInstance;
}

export function getLogger(): pino.Logger<PinoLogLevel> {
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
export function logError(context: string | Record<string, unknown>, error: Error, message?: string): void {
    const logger = getLogger();
    if (typeof context === 'string') {
        logger.error({ err: error }, message || context);
    } else {
        logger.error({ ...context, err: error }, message || 'An error occurred');
    }
}

/**
 * Logs a warning message with optional structured context.
 * @param context - A string message or an object for structured context.
 * @param message - Optional override message if context is an object.
 */
export function logWarning(context: string | Record<string, unknown>, message?: string): void {
    const logger = getLogger();
    if (typeof context === 'string') {
        logger.warn(context);
    } else {
        logger.warn(context, message || 'Warning event');
    }
}

/**
 * Logs an informational message with optional structured context.
 * @param context - A string message or an object for structured context.
 * @param message - Optional override message if context is an object.
 */
export function logInfo(context: string | Record<string, unknown>, message?: string): void {
    const logger = getLogger();
    if (typeof context === 'string') {
        logger.info(context);
    } else {
        logger.info(context, message || 'Informational event');
    }
}

/**
 * Logs a debug message with optional structured context.
 * @param context - A string message or an object for structured context.
 * @param message - Optional override message if context is an object.
 */
export function logDebug(context: string | Record<string, unknown>, message?: string): void {
    const logger = getLogger();
    if (typeof context === 'string') {
        logger.debug(context);
    } else {
        logger.debug(context, message || 'Debug event');
    }
}

// Add for testing purposes to reset the module-level loggerInstance
export function resetLoggerForTest(): void {
    if (loggerInstance && typeof (loggerInstance as any).destroy === 'function') {
        // If pino v7+ has a MATE.destroy like method, or if stream needs explicit closing.
        // For basic pino, just nullifying the instance is often enough for testing re-initialization.
    }
    loggerInstance = undefined;
}
