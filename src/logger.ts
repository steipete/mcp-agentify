import pino from 'pino';
import type { GatewayOptions } from './interfaces';
import { redactValue } from './redaction';

let loggerInstance: pino.Logger<PinoLogLevel> | undefined;

export type PinoLogLevel = pino.LevelWithSilent;

export function initializeLogger(
    options?: Pick<GatewayOptions, 'logLevel'>,
    testDestination?: pino.DestinationStream,
    debugLogStream?: pino.DestinationStream,
): pino.Logger<PinoLogLevel> {
    const level = options?.logLevel || 'info';
    const loggerOptions: pino.LoggerOptions<PinoLogLevel> = {
        level,
        serializers: {
            err: (error) => redactValue(pino.stdSerializers.err(error)),
            req: pino.stdSerializers.req,
            res: pino.stdSerializers.res,
        },
    };

    if (debugLogStream) {
        const streams: pino.StreamEntry[] = [
            { stream: testDestination || pino.destination(process.stderr.fd), level: 'trace' },
            { stream: debugLogStream, level: 'trace' },
        ];
        loggerInstance = pino(loggerOptions, pino.multistream(streams));
    } else if (testDestination) {
        loggerInstance = pino(loggerOptions, testDestination);
    } else if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        loggerInstance = pino({
            ...loggerOptions,
            transport: {
                target: 'pino-pretty',
                options: {
                    colorize: true,
                    destination: 2,
                    ignore: 'pid,hostname',
                    translateTime: 'SYS:standard',
                },
            },
        });
    } else {
        loggerInstance = pino(loggerOptions, pino.destination(process.stderr.fd));
    }

    return loggerInstance;
}

export function getLogger(): pino.Logger<PinoLogLevel> {
    return loggerInstance || initializeLogger();
}

export function resetLoggerForTest(): void {
    loggerInstance = undefined;
}
