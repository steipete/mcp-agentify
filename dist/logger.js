"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeLogger = initializeLogger;
exports.getLogger = getLogger;
exports.resetLoggerForTest = resetLoggerForTest;
const pino_1 = __importDefault(require("pino"));
const redaction_1 = require("./redaction");
let loggerInstance;
function initializeLogger(options, testDestination, debugLogStream) {
    const level = options?.logLevel || 'info';
    const loggerOptions = {
        level,
        serializers: {
            err: (error) => (0, redaction_1.redactValue)(pino_1.default.stdSerializers.err(error)),
            req: pino_1.default.stdSerializers.req,
            res: pino_1.default.stdSerializers.res,
        },
    };
    if (debugLogStream) {
        const streams = [
            { stream: testDestination || pino_1.default.destination(process.stderr.fd), level: 'trace' },
            { stream: debugLogStream, level: 'trace' },
        ];
        loggerInstance = (0, pino_1.default)(loggerOptions, pino_1.default.multistream(streams));
    }
    else if (testDestination) {
        loggerInstance = (0, pino_1.default)(loggerOptions, testDestination);
    }
    else if (process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test') {
        loggerInstance = (0, pino_1.default)({
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
    }
    else {
        loggerInstance = (0, pino_1.default)(loggerOptions, pino_1.default.destination(process.stderr.fd));
    }
    return loggerInstance;
}
function getLogger() {
    return loggerInstance || initializeLogger();
}
function resetLoggerForTest() {
    loggerInstance = undefined;
}
//# sourceMappingURL=logger.js.map