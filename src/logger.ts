import pino from 'pino';
import type { GatewayOptions } from './interfaces'; // Assuming GatewayOptions will be in interfaces.ts

let loggerInstance: pino.Logger<PinoLogLevel> | undefined;

// Define pino.LevelWithSilent if not already available from pino types directly
// pino v7+ has pino.LevelWithSilent
export type PinoLogLevel = pino.LevelWithSilent;

// pino.multistream can take an array of pino.StreamEntry or just WritableStream instances.
// For clarity, we'll use a more generic stream definition that pino.multistream can handle.
type LoggerStream = NodeJS.WritableStream | pino.DestinationStream | pino.StreamEntry<PinoLogLevel>;

export function initializeLogger(
    options?: Pick<GatewayOptions, 'logLevel'>,
    testDestination?: pino.DestinationStream, // Optional destination for testing
    debugLogStream?: pino.DestinationStream,  // Stream for debug web server
): pino.Logger<PinoLogLevel> {
    const levelToUse: PinoLogLevel = options?.logLevel || 'info';

    const pinoSinks: LoggerStream[] = [];

    // Determine if pino-pretty should be used for console output
    const usePinoPrettyForConsole = process.env.NODE_ENV !== 'production' && !debugLogStream;

    const pinoOptions: pino.LoggerOptions<PinoLogLevel> = {
        level: levelToUse === 'silent' ? 'info' : levelToUse, // pino instance level; 'silent' isn't a stream level
        serializers: {
            err: pino.stdSerializers.err, // Standard error serializer
            req: pino.stdSerializers.req, // Standard request serializer
            res: pino.stdSerializers.res, // Standard response serializer
            // Potentially add custom serializers here if needed
        },
    };

    if (usePinoPrettyForConsole) {
        pinoOptions.transport = {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l', // Example: 2023-10-27 14:30:45.123
                ignore: 'pid,hostname', // Optional: remove pid and hostname from pretty print
                destination: 2, // Send pretty output to stderr (fd 2) to avoid interfering with JSON-RPC over stdout
            },
        };
        // pino-pretty with destination:2 handles stderr output, but we need to make sure any 'normal' logs also go to stderr
        // If testDestination is also provided, it implies we might want non-pretty logs there.
        if (testDestination) {
             // Add testDestination for raw logs if testing alongside pretty-printing to console.
            pinoSinks.push({ stream: testDestination, level: levelToUse === 'silent' ? undefined : levelToUse as pino.Level });
        }
    } else {
        // Not using pino-pretty for console: either production, or debugLogStream is active (forcing JSON for it).
        // Add main output stream (stderr or testDestination) for raw JSON logs.
        const mainOutputStream: pino.DestinationStream = testDestination || pino.destination(process.stderr.fd);
        pinoSinks.push({ stream: mainOutputStream, level: levelToUse === 'silent' ? undefined : levelToUse as pino.Level });
    }

    if (debugLogStream) {
        // Add the debugLogStream to receive all logs from 'trace' upwards that the main logger instance allows.
        // The main logger's level (pinoOptions.level) acts as the primary filter.
        pinoSinks.push({ stream: debugLogStream, level: 'trace' });
    }

    if (usePinoPrettyForConsole) {
        // When pino-pretty transport is used, it dictates the main formatted output.
        // If pinoSinks also has entries (e.g. testDestination for raw logs), 
        // we need to create a base logger for those raw streams and then wrap with pretty.
        // This is complex. For PoC: if usePinoPrettyForConsole, it's the dominant logger.
        // To add other raw streams, pino-pretty should ideally be a stream itself in a multistream setup.
        // Current pino behavior with transport means pino() doesn't use the second stream argument in the same way.
        
        // If only pino-pretty is needed (no other sinks like testDestination when pretty is on)
        if (pinoSinks.length === 0) {
            loggerInstance = pino(pinoOptions);
        } else {
            // This case is tricky: pino-pretty transport + other raw streams.
            // For now, let pino-pretty take over console, and other streams are separate.
            // This might mean testDestination doesn't get logs if pino-pretty is on. Or it might.
            // Safest is to ensure if testDestination is used, pino-pretty is off for that test run if raw logs are needed there.
            // To simplify: if usePinoPrettyForConsole, it is the ONLY output unless debugLogStream forces JSON.
            // The pinoSinks for testDestination in this branch (usePinoPrettyForConsole) is problematic.
            // Let's assume testDestination implies NO pino-pretty for that test run if raw logs are desired there.
            loggerInstance = pino(pinoOptions); // pino-pretty will handle console
            if (testDestination && pinoSinks.find(s => (s as any).stream === testDestination)) {
                 loggerInstance.warn('testDestination provided with pino-pretty. Raw logs to testDestination might be inconsistent.');
            }
        }
    } else if (pinoSinks.length > 0) {
        // No pino-pretty for console, use multistream for all defined sinks (e.g., stderr, debugLogStream, testDestination)
        loggerInstance = pino(pinoOptions, pino.multistream(pinoSinks as pino.StreamEntry<pino.Level>[]));
    } else {
        // Should only happen if no streams configured and not using pino-pretty (e.g. silent level, no debug, no test)
        // Fallback to pino defaults (JSON to stdout)
        loggerInstance = pino(pinoOptions);
    }
    
    if (debugLogStream && process.env.NODE_ENV !== 'production' && !usePinoPrettyForConsole) {
        loggerInstance.warn('pino-pretty transport for console was disabled because debugLogStream is active, ensuring JSON logs for the debug UI stream.');
    }

    loggerInstance.info(
        `Logger initialized. Effective Level: ${loggerInstance.level}. Console Pretty: ${usePinoPrettyForConsole}. DebugStream Active: ${!!debugLogStream}. NODE_ENV=${process.env.NODE_ENV}`,
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
    const localLogger = getLogger();
    if (typeof context === 'string') {
        localLogger.error({ err: error }, message || context);
    } else {
        localLogger.error({ ...context, err: error }, message || 'An error occurred');
    }
}

/**
 * Logs a warning message with optional structured context.
 * @param context - A string message or an object for structured context.
 * @param message - Optional override message if context is an object.
 */
export function logWarning(context: string | Record<string, unknown>, message?: string): void {
    const localLogger = getLogger();
    if (typeof context === 'string') {
        localLogger.warn(context);
    } else {
        localLogger.warn(context, message || 'Warning event');
    }
}

/**
 * Logs an informational message with optional structured context.
 * @param context - A string message or an object for structured context.
 * @param message - Optional override message if context is an object.
 */
export function logInfo(context: string | Record<string, unknown>, message?: string): void {
    const localLogger = getLogger();
    if (typeof context === 'string') {
        localLogger.info(context);
    } else {
        localLogger.info(context, message || 'Informational event');
    }
}

/**
 * Logs a debug message with optional structured context.
 * @param context - A string message or an object for structured context.
 * @param message - Optional override message if context is an object.
 */
export function logDebug(context: string | Record<string, unknown>, message?: string): void {
    const localLogger = getLogger();
    if (typeof context === 'string') {
        localLogger.debug(context);
    } else {
        localLogger.debug(context, message || 'Debug event');
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
 