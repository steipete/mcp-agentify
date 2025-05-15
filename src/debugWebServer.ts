// src/debugWebServer.ts
import * as http from 'node:http';
import express, { type Request, type Response, type NextFunction, type Application, type RequestHandler } from 'express';
import { WebSocketServer, WebSocket } from 'ws'; // Ensure WebSocket is imported as a value
import type { Logger as PinoLoggerBase } from 'pino'; // Use base type for generic
import type { PinoLogLevel } from './logger'; // Import the specific level type
import { resolve } from 'node:path';
import type { BackendManager } from './backendManager'; // For future use in API endpoints
import type { GatewayOptions, LogEntry, McpTraceEntry } from './interfaces'; // Corrected
import type { GatewayClientInitOptions } from './schemas'; // Import from schemas
import { Writable } from 'node:stream'; // Import Writable

// Forward declaration for types used by LogBuffer/TraceBuffer if they are complex

const MAX_BUFFER_SIZE = 500; // Max entries for logs/traces in memory

export class DebugWebServer {
    private app: Application;
    private httpServer: http.Server;
    private wss: WebSocketServer;
    private port: number;
    private logger: PinoLoggerBase<PinoLogLevel>;
    private backendManager?: BackendManager; // Made optional for now
    private gatewayOptions?: GatewayOptions; // Made optional for now
    private initialEnvConfig?: Partial<GatewayOptions>;
    private clientSentInitOptions?: GatewayClientInitOptions; // Store the validated client options
    private finalEffectiveConfig?: GatewayOptions;

    // In-memory buffers for logs and traces
    private logBuffer: LogEntry[] = [];
    private mcpTraceBuffer: McpTraceEntry[] = [];
    private debugLogPassthroughStream: Writable | undefined;

    constructor(
        port: number,
        mainLogger: PinoLoggerBase<PinoLogLevel>,
        backendManager?: BackendManager,
        // This gatewayOptions is the initial config based on ENV or defaults when DWS starts early
        initialConfig?: Partial<GatewayOptions>, 
    ) {
        this.port = port;
        this.logger = mainLogger.child({ component: 'DebugWebServer' });
        this.backendManager = backendManager;
        // Store the initial config (likely from ENV vars if DWS starts early)
        this.initialEnvConfig = initialConfig ? this.sanitizePartialConfig(initialConfig) : undefined;
        // this.gatewayOptions was used for /api/config, let's keep it for that specific purpose (showing what DWS *thinks* is current)
        // For now, let's make this.gatewayOptions be the final effective config when available, or initial if not updated.
        this.gatewayOptions = initialConfig ? this.sanitizePartialConfig(initialConfig) as GatewayOptions : undefined;

        this.app = express();
        this.httpServer = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.httpServer });

        this.setupExpressMiddleware();
        this.setupApiRoutes();
        this.setupWebSockets();

        this.logger.info('DebugWebServer initialized.');
        this.initializeLogStream();
    }

    private initializeLogStream(): void {
        this.debugLogPassthroughStream = new Writable({
            objectMode: false, // Expects strings or Buffers from Pino
            write: (chunk, encoding, callback) => {
                try {
                    const logString = chunk.toString();
                    // Pino logs are newline-terminated JSON strings when not using pino-pretty
                    // It's safer to attempt parsing each line if multiple come in a single chunk
                    for (const line of logString.split('\n').filter((s: string) => s.trim() !== '')) {
                        try {
                            const logObject = JSON.parse(line);
                            // Adapt the parsed pino object to LogEntry.
                            // Pino's core fields: level (number), time (epoch ms), msg, pid, hostname
                            // LogEntry expects: level (string), timestamp, message, details
                            const pinoLevelToLogEntryLevel = (level: number): LogEntry['level'] => {
                                if (level <= 10) return 'TRACE'; // trace
                                if (level <= 20) return 'DEBUG'; // debug
                                if (level <= 30) return 'INFO';  // info
                                if (level <= 40) return 'WARN';  // warn
                                if (level <= 50) return 'ERROR'; // error
                                return 'FATAL'; // fatal (60) or higher
                            };

                            const entry: LogEntry = {
                                timestamp: logObject.time || Date.now(),
                                level: pinoLevelToLogEntryLevel(logObject.level),
                                message: logObject.msg || 'No message',
                                details: { ...logObject }, // Keep all other fields in details
                            };
                            const { time, level, msg, ...restDetails } = logObject;
                            entry.details = restDetails;

                            this.addLogEntry(entry);
                        } catch (jsonError) {
                            // If it's not JSON, or already pretty-printed, log it as a simple message string
                            // This can happen if pino-pretty is active AND we are tapping into the stream
                            // Ideally, for the debug stream, pino should output raw JSON.
                            this.logger.trace({ rawChunk: logString, err: jsonError }, "DebugLogStream: Failed to parse log line as JSON, adding as raw.");
                            const fallbackEntry: LogEntry = {
                                timestamp: Date.now(),
                                level: 'INFO', // Default level for unparseable lines
                                message: logString,
                            };
                            this.addLogEntry(fallbackEntry);
                        }
                    }
                } catch (error) {
                    this.logger.error({ err: error, chunk }, "Error processing log chunk in DebugWebServer's stream.");
                }
                callback();
            },
        });
        this.logger.info('Debug log passthrough stream initialized for capturing Pino logs.');
    }

    public getLogStream(): Writable | undefined {
        return this.debugLogPassthroughStream;
    }

    private sanitizeConfig(config: GatewayOptions): GatewayOptions {
        this.logger.debug('Sanitizing gateway configuration for debug API.');
        const sanitized: GatewayOptions = JSON.parse(JSON.stringify(config)); // Assume full structure initially

        if (sanitized.OPENAI_API_KEY) {
            sanitized.OPENAI_API_KEY = '[REDACTED]';
        }

        if (sanitized.backends) {
            sanitized.backends = sanitized.backends.map(backend => {
                const newBackend = { ...backend };
                if (newBackend.env) {
                    const newEnv: Record<string, string> = {};
                    for (const key in newBackend.env) {
                        if (key.toUpperCase().includes('KEY') || key.toUpperCase().includes('SECRET') || key.toUpperCase().includes('TOKEN')) {
                            newEnv[key] = '[REDACTED]';
                        } else {
                            newEnv[key] = newBackend.env[key];
                        }
                    }
                    newBackend.env = newEnv;
                }
                return newBackend;
            });
        }
        // Ensure all required fields of GatewayOptions are still present, even if masked or defaulted.
        // logLevel will have a default from schema. backends is required.
        // OPENAI_API_KEY is optional in schema, so its absence or being '[REDACTED]' is fine.
        return sanitized;
    }

    private sanitizePartialConfig(config: Partial<GatewayOptions>): Partial<GatewayOptions> {
        this.logger.debug({configKeys: Object.keys(config)}, 'Sanitizing partial gateway configuration for debug API.');
        const sanitized: Partial<GatewayOptions> = JSON.parse(JSON.stringify(config)); 

        if (sanitized.OPENAI_API_KEY) {
            sanitized.OPENAI_API_KEY = '[REDACTED]';
        }
        // No backends in initial partial config usually, but if there were, sanitize them.
        if (sanitized.backends) {
             sanitized.backends = sanitized.backends.map(backend => {
                const newBackend = { ...backend };
                if (newBackend.env) {
                    const newEnv: Record<string, string> = {};
                    for (const key in newBackend.env) {
                        if (key.toUpperCase().includes('KEY') || key.toUpperCase().includes('SECRET') || key.toUpperCase().includes('TOKEN')) {
                            newEnv[key] = '[REDACTED]';
                        } else {
                            newEnv[key] = newBackend.env[key];
                        }
                    }
                    newBackend.env = newEnv;
                }
                return newBackend;
            });
        }
        return sanitized;
    }

    private setupExpressMiddleware(): void {
        this.app.use(express.json()); // For parsing application/json in potential POST routes
        // Serve static files from public_debug_ui
        const staticPath = resolve(process.cwd(), 'public_debug_ui');
        this.app.use(express.static(staticPath));
        this.logger.info({ path: staticPath }, 'Serving static files for debug UI.');

        // Basic root route for HTML file
        this.app.get('/', (req, res) => {
            res.sendFile(resolve(staticPath, 'index.html'));
        });
    }

    private setupApiRoutes(): void {
        this.logger.info('Setting up API routes for DebugWebServer.');

        const statusHandler: RequestHandler = (req, res) => {
            this.logger.debug('Request received for /api/status');
            if (!this.backendManager) {
                res.status(503).json({ status: 'initializing', message: 'BackendManager not yet available.' });
                return;
            }
            try {
                const backendStates = this.backendManager.getAllBackendStates();
                res.json({
                    status: 'running',
                    uptime: process.uptime(),
                    backends: backendStates.map(b => ({ id: b.id, isReady: b.isReady, displayName: b.config.displayName })),
                    // Add more status info if needed
                });
            } catch (error) {
                this.logger.error({err: error}, "Error fetching /api/status");
                res.status(500).json({ status: 'error', message: 'Failed to retrieve backend status.'});
            }
        };
        this.app.get('/api/status', statusHandler);

        const configHandler: RequestHandler = (req, res) => {
            this.logger.debug('Request received for /api/config (current effective).');
            if (!this.gatewayOptions) {
                res.status(404).json({ message: 'Current effective gateway configuration not available.' });
                return;
            }
            res.json(this.gatewayOptions); 
        };
        this.app.get('/api/config', configHandler);

        // New endpoint for detailed config states
        const configDetailsHandler: RequestHandler = (req, res) => {
            this.logger.debug('Request received for /api/config-details.');
            res.json({
                initialEnvConfig: this.initialEnvConfig || { note: 'Not set or DWS started post-env phase' },
                clientSentInitOptions: this.clientSentInitOptions || { note: 'Initialize request not yet received/processed' },
                finalEffectiveConfig: this.finalEffectiveConfig || { note: 'Final configuration not yet set' }
            });
        };
        this.app.get('/api/config-details', configDetailsHandler);

        // Placeholder for /api/logs and /api/traces (Subtask 8.2 continued)
        const logsHandler: RequestHandler = (req, res) => {
            this.logger.debug({ query: req.query }, 'Request received for /api/logs');
            const page = Number.parseInt(req.query.page as string || '0', 10);
            const pageSize = Number.parseInt(req.query.pageSize as string || '100', 10);
            const start = Math.max(0, this.logBuffer.length - (page + 1) * pageSize);
            const end = Math.max(0, this.logBuffer.length - page * pageSize);

            res.json({
                logs: this.logBuffer.slice(start, end).reverse(), // Show recent first
                total: this.logBuffer.length,
                page: page,
                pageSize: pageSize
            });
        };
        this.app.get('/api/logs', logsHandler);

        const tracesHandler: RequestHandler = (req, res) => {
            this.logger.debug({ query: req.query }, 'Request received for /api/traces');
            const page = Number.parseInt(req.query.page as string || '0', 10);
            const pageSize = Number.parseInt(req.query.pageSize as string || '100', 10);
            const start = Math.max(0, this.mcpTraceBuffer.length - (page + 1) * pageSize);
            const end = Math.max(0, this.mcpTraceBuffer.length - page * pageSize);

            res.json({
                traces: this.mcpTraceBuffer.slice(start, end).reverse(), // Show recent first
                total: this.mcpTraceBuffer.length,
                page: page,
                pageSize: pageSize
            });
        };
        this.app.get('/api/traces', tracesHandler);
    }

    private setupWebSockets(): void {
        this.logger.info('Setting up WebSocket listeners (placeholder for Subtask 8.3)');
        this.wss.on('connection', (ws: WebSocket) => {
            this.logger.info('Debug WebSocket client connected.');
            ws.on('message', (message: Buffer | string) => {
                this.logger.debug({ message: message.toString() }, 'Received WebSocket message (ignored for now)');
            });
            ws.on('close', () => {
                this.logger.info('Debug WebSocket client disconnected.');
            });
            ws.on('error', (error: Error) => {
                this.logger.error({ err: error }, 'Debug WebSocket error.');
            });
            // Send a welcome message or initial state if needed
            ws.send(JSON.stringify({ type: 'info', message: 'Connected to mcp-agentify debug WebSocket server.' }));
        });
    }

    public start(): void {
        this.httpServer.listen(this.port, () => {
            this.logger.info(`DebugWebServer listening on http://localhost:${this.port}`);
        });
    }

    public getPort(): number {
        return this.port;
    }

    public stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.logger.info('Attempting to stop DebugWebServer...');
            for (const client of this.wss.clients) {
                client.terminate();
            }
            this.wss.close((errWs) => {
                if (errWs) this.logger.error({ err: errWs }, 'Error closing WebSocketServer');
                else this.logger.info('WebSocketServer closed.');

                this.httpServer.close((errHttp) => {
                    if (errHttp) this.logger.error({ err: errHttp }, 'Error closing HttpServer');
                    else this.logger.info('HttpServer closed.');

                    if (errWs || errHttp) reject(errWs || errHttp);
                    else resolve();
                });
            });
        });
    }

    // Methods for Subtask 8.3 to add logs/traces and broadcast them
    public addLogEntry(logEntry: LogEntry): void {
        if (this.logBuffer.length >= MAX_BUFFER_SIZE) {
            this.logBuffer.shift(); // Remove oldest
        }
        this.logBuffer.push(logEntry);
        this.broadcastToWebSockets({ type: 'log_entry', payload: logEntry });
    }

    public addMcpTrace(traceEntry: McpTraceEntry): void {
        if (this.mcpTraceBuffer.length >= MAX_BUFFER_SIZE) {
            this.mcpTraceBuffer.shift(); // Remove oldest
        }
        this.mcpTraceBuffer.push(traceEntry);
        this.broadcastToWebSockets({ type: 'mcp_trace_entry', payload: traceEntry });
    }

    private broadcastToWebSockets(message: object): void {
        const jsonMessage = JSON.stringify(message);
        for (const client of this.wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(jsonMessage);
            }
        }
    }

    // Getter methods for API endpoints (Subtask 8.2)
    public getLogBuffer(): LogEntry[] {
        return [...this.logBuffer];
    }
    public getMcpTraceBuffer(): McpTraceEntry[] {
        return [...this.mcpTraceBuffer];
    }

    public updateLogger(newLogger: PinoLoggerBase<PinoLogLevel>): void {
        this.logger = newLogger.child({ component: 'DebugWebServer' });
        this.logger.info('Successfully updated internal logger instance.');
    }

    // Method to receive client-sent initializationOptions (should be the validated & parsed version)
    public setClientSentInitOptions(options: GatewayClientInitOptions): void {
        this.logger.debug({ options }, 'DebugWebServer received client-sent initializationOptions.');
        // Sanitize if it contains sensitive fields directly (though it shouldn't for core config)
        const sanitizedOptions: GatewayClientInitOptions = JSON.parse(JSON.stringify(options));
        if (sanitizedOptions.OPENAI_API_KEY) {
            (sanitizedOptions.OPENAI_API_KEY as any) = '[REDACTED_IN_CLIENT_OPTIONS_DISPLAY]';
        }
        // Backends in GatewayClientInitOptions are already BackendConfig[], sanitize them further if needed for display.
        if (sanitizedOptions.backends) {
            sanitizedOptions.backends = this.sanitizePartialConfig({ backends: sanitizedOptions.backends }).backends || [];
        }
        this.clientSentInitOptions = sanitizedOptions;
    }

    // Method to receive the final effective merged configuration
    public setFinalEffectiveConfig(config: GatewayOptions): void {
        this.logger.debug({ configKeys: Object.keys(config) }, 'DebugWebServer received final effective configuration.');
        this.finalEffectiveConfig = this.sanitizeConfig(config); // sanitizeConfig expects full GatewayOptions
        // Update the general this.gatewayOptions for the /api/config endpoint to reflect the latest final config
        this.gatewayOptions = this.finalEffectiveConfig;
    }
}
