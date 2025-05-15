// src/frontendServer.ts
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
import type { McpRequester } from './server'; // Corrected import path assuming server.ts is in the same directory

// Forward declaration for types used by LogBuffer/TraceBuffer if they are complex

const MAX_BUFFER_SIZE = 500; // Max entries for logs/traces in memory

export class FrontendServer {
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
    private mcpRequester?: McpRequester;

    // In-memory buffers for logs and traces
    private logBuffer: LogEntry[] = [];
    private mcpTraceBuffer: McpTraceEntry[] = [];
    private logPassthroughStream: Writable | undefined;

    constructor(
        port: number,
        mainLogger: PinoLoggerBase<PinoLogLevel>,
        // backendManager is now passed via a setter after BackendManager is fully initialized
        initialBackendManager?: BackendManager, // Keep it optional in constructor for early start
        initialConfig?: Partial<GatewayOptions>,
    ) {
        this.port = port;
        this.logger = mainLogger.child({ component: 'FrontendServer' });
        this.backendManager = initialBackendManager; // Can be undefined
        this.initialEnvConfig = initialConfig ? this.sanitizePartialConfig(initialConfig) : undefined;
        this.gatewayOptions = initialConfig ? this.sanitizePartialConfig(initialConfig) as GatewayOptions : undefined;

        this.app = express();
        this.httpServer = http.createServer(this.app);
        this.wss = new WebSocketServer({ server: this.httpServer });

        this.setupExpressMiddleware();
        this.setupApiRoutes();
        this.setupWebSockets();

        this.logger.info('Frontend WebServer initialized.');
        this.initializeLogStream();
    }

    private initializeLogStream(): void {
        this.logPassthroughStream = new Writable({
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
                            this.logger.trace({ rawChunk: logString, err: jsonError }, "LogStream: Failed to parse log line as JSON, adding as raw.");
                            const fallbackEntry: LogEntry = {
                                timestamp: Date.now(),
                                level: 'INFO', // Default level for unparseable lines
                                message: logString,
                            };
                            this.addLogEntry(fallbackEntry);
                        }
                    }
                } catch (error) {
                    this.logger.error({ err: error, chunk }, "Error processing log chunk in FrontendServer's stream.");
                }
                callback();
            },
        });
        this.logger.info('Log passthrough stream initialized for capturing Pino logs.');
    }

    public getLogStream(): Writable | undefined {
        return this.logPassthroughStream;
    }

    private sanitizeConfig(config: GatewayOptions): GatewayOptions {
        this.logger.debug('Sanitizing gateway configuration for frontend API.');
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
        this.logger.debug({configKeys: Object.keys(config)}, 'Sanitizing partial gateway configuration for frontend API.');
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
        // Serve static files from frontend/public
        const staticPath = resolve(process.cwd(), 'frontend/public');
        this.app.use(express.static(staticPath));
        this.logger.info({ path: staticPath }, 'Serving static files for frontend.');

        // Basic root route for HTML file
        this.app.get('/', (req, res) => {
            res.sendFile(resolve(staticPath, 'index.html'));
        });
    }

    private setupApiRoutes(): void {
        this.logger.info('Setting up API routes for FrontendServer.');

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
                initialEnvConfig: this.initialEnvConfig || { note: 'Not set or server started post-env phase' },
                clientSentInitOptions: this.clientSentInitOptions || { note: 'Initialize request not yet received/processed' },
                finalEffectiveConfig: this.finalEffectiveConfig || { note: 'Final configuration not yet set' }
            });
        };
        this.app.get('/api/config-details', configDetailsHandler);

        // Placeholder for /api/logs and /api/traces
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

        // New endpoint for ChatTab to send requests to dynamic agents
        const chatWithAgentHandler: RequestHandler = async (req, res, next) => {
            const { agentMethod, params } = req.body as { agentMethod: string; params: { query: string; context?: any } };
            this.logger.info({ agentMethod, params }, '[FrontendServer] Received /api/chat-with-agent request.');

            if (!this.mcpRequester) {
                this.logger.error('[FrontendServer] McpRequester not available for /api/chat-with-agent.');
                res.status(503).json({ error: 'MCP Requester not available. Gateway might still be initializing.' });
                return;
            }
            if (!agentMethod || !params || typeof params.query !== 'string') {
                 res.status(400).json({ error: 'Invalid request: agentMethod and params.query are required.' });
                 return;
            }

            try {
                const result = await this.mcpRequester(agentMethod, params);
                this.logger.info({ agentMethod, result }, '[FrontendServer] Response from internal MCP request for agent chat.');
                res.json(result);
            } catch (error: any) {
                this.logger.error({ err: error, agentMethod }, '[FrontendServer] Error calling agent via mcpRequester.');
                res.status(500).json({ 
                    error: 'Failed to call agent', 
                    message: error.message, 
                    details: error.data 
                });
            }
        };
        this.app.post('/api/chat-with-agent', express.json(), chatWithAgentHandler);
    }

    private setupWebSockets(): void {
        this.logger.info('Setting up WebSocket listeners');
        this.wss.on('connection', (ws: WebSocket) => {
            this.logger.info('WebSocket client connected.');
            ws.on('message', (message: Buffer | string) => {
                this.logger.debug({ message: message.toString() }, 'Received WebSocket message (ignored for now)');
            });
            ws.on('close', () => {
                this.logger.info('WebSocket client disconnected.');
            });
            ws.on('error', (error: Error) => {
                this.logger.error({ err: error }, 'WebSocket error.');
            });
            // Send a welcome message or initial state if needed
            ws.send(JSON.stringify({ type: 'info', message: 'Connected to mcp-agentify WebSocket server.' }));
        });
    }

    public start(): void {
        const maxRetries = 10;
        let retryCount = 0;
        const startServer = (port: number): void => {
            this.httpServer.listen(port)
                .on('listening', () => {
                    this.port = port; // Update the port with the one we actually bound to
                    this.logger.info(`Frontend WebServer listening on http://localhost:${port}`);
                })
                .on('error', (err: NodeJS.ErrnoException) => {
                    if (err.code === 'EADDRINUSE') {
                        const nextPort = port + 1;
                        retryCount++;
                        if (retryCount < maxRetries) {
                            this.logger.warn(`Port ${port} in use, trying port ${nextPort}`);
                            startServer(nextPort);
                        } else {
                            this.logger.fatal(`Failed to find an available port after ${maxRetries} attempts (tried ${this.port}-${port})`);
                            throw new Error(`Unable to start server: all ports in range ${this.port}-${port} are in use`);
                        }
                    } else {
                        // For any other error type, log and rethrow immediately
                        this.logger.error({ err }, `Error starting server on port ${port}`);
                        throw err;
                    }
                });
        };

        startServer(this.port);
    }

    public getPort(): number {
        return this.port;
    }

    public stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.logger.info('Attempting to stop FrontendServer...');
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

    // Methods to add logs/traces and broadcast them
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

    // Getter methods for API endpoints
    public getLogBuffer(): LogEntry[] {
        return [...this.logBuffer];
    }
    public getMcpTraceBuffer(): McpTraceEntry[] {
        return [...this.mcpTraceBuffer];
    }

    public updateLogger(newLogger: PinoLoggerBase<PinoLogLevel>): void {
        this.logger = newLogger.child({ component: 'FrontendServer' });
        this.logger.info('Successfully updated internal logger instance.');
    }

    // Method to receive client-sent initializationOptions (should be the validated & parsed version)
    public setClientSentInitOptions(options: GatewayClientInitOptions): void {
        this.logger.debug({ options }, 'FrontendServer received client-sent initializationOptions.');
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
        this.logger.debug({ configKeys: Object.keys(config) }, 'FrontendServer received final effective configuration.');
        this.finalEffectiveConfig = this.sanitizeConfig(config); // sanitizeConfig expects full GatewayOptions
        // Update the general this.gatewayOptions for the /api/config endpoint to reflect the latest final config
        this.gatewayOptions = this.finalEffectiveConfig;
    }

    public setMcpRequester(requester: McpRequester): void {
        this.logger.info('[FrontendServer] McpRequester received.');
        this.mcpRequester = requester;
    }

    public setBackendManager(manager: BackendManager): void {
        this.logger.info('[FrontendServer] BackendManager received.');
        this.backendManager = manager; 
        // Potentially re-fetch/update status if UI is already loaded and needs new backend states
    }
}