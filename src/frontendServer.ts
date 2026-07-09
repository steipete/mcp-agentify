import { existsSync } from 'node:fs';
import * as http from 'node:http';
import { resolve } from 'node:path';
import { Writable } from 'node:stream';
import express, { type Application, type RequestHandler } from 'express';
import type { Logger } from 'pino';
import { WebSocket, WebSocketServer, type VerifyClientCallbackSync } from 'ws';
import type { BackendManager } from './backendManager';
import type { GatewayOptions, LogEntry, McpTraceEntry } from './interfaces';
import type { PinoLogLevel } from './logger';
import type { LLMOrchestratorService } from './llmOrchestrator';
import { redactGatewayOptions, redactText, redactValue } from './redaction';
import { getPackageVersion } from './utils';

const MAX_BUFFER_SIZE = 500;

export class FrontendServer {
    private readonly app: Application;
    private readonly httpServer: http.Server;
    private readonly wss: WebSocketServer;
    private port: number;
    private logger: Logger<PinoLogLevel>;
    private readonly gatewayOptions: GatewayOptions;
    private backendManager: BackendManager;
    private llmOrchestrator?: LLMOrchestratorService;
    private readonly logBuffer: LogEntry[] = [];
    private readonly mcpTraceBuffer: McpTraceEntry[] = [];
    private readonly logPassthroughStream: Writable;

    constructor(
        port: number,
        logger: Logger<PinoLogLevel>,
        backendManager: BackendManager,
        gatewayOptions: GatewayOptions,
    ) {
        this.port = port;
        this.logger = logger.child({ component: 'FrontendServer' });
        this.backendManager = backendManager;
        this.gatewayOptions = gatewayOptions;
        this.app = express();
        this.httpServer = http.createServer(this.app);
        const verifyClient: VerifyClientCallbackSync = ({ origin, req }) =>
            this.isAllowedWebSocketRequest(origin, req.headers.host);
        this.wss = new WebSocketServer({
            server: this.httpServer,
            verifyClient,
        });
        this.logPassthroughStream = this.createLogStream();

        this.backendManager.on('mcpTrace', (trace: McpTraceEntry) => this.addMcpTrace(trace));
        this.setupRoutes();
        this.setupWebSockets();
    }

    public getLogStream(): Writable {
        return this.logPassthroughStream;
    }

    public updateLogger(logger: Logger<PinoLogLevel>): void {
        this.logger = logger.child({ component: 'FrontendServer' });
    }

    public setLlmOrchestrator(orchestrator: LLMOrchestratorService): void {
        this.llmOrchestrator = orchestrator;
    }

    public getPort(): number {
        return this.port;
    }

    public async start(): Promise<void> {
        const initialPort = this.port;
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const port = initialPort + attempt;
            try {
                await new Promise<void>((resolvePromise, rejectPromise) => {
                    const onError = (error: NodeJS.ErrnoException) => {
                        this.httpServer.off('listening', onListening);
                        rejectPromise(error);
                    };
                    const onListening = () => {
                        this.httpServer.off('error', onError);
                        resolvePromise();
                    };
                    this.httpServer.once('error', onError);
                    this.httpServer.once('listening', onListening);
                    this.httpServer.listen(port, '127.0.0.1');
                });
                this.port = port;
                this.logger.info({ url: `http://127.0.0.1:${port}` }, 'Frontend UI listening.');
                return;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' || attempt === 9) {
                    throw error;
                }
            }
        }
    }

    public async stop(): Promise<void> {
        for (const client of this.wss.clients) {
            client.terminate();
        }
        await new Promise<void>((resolvePromise) => this.wss.close(() => resolvePromise()));
        if (!this.httpServer.listening) {
            return;
        }
        await new Promise<void>((resolvePromise, rejectPromise) => {
            this.httpServer.close((error) => (error ? rejectPromise(error) : resolvePromise()));
        });
    }

    public addMcpTrace(trace: McpTraceEntry): void {
        const sanitized = redactValue(trace) as McpTraceEntry;
        this.pushBounded(this.mcpTraceBuffer, sanitized);
        this.broadcast({ type: 'mcp_trace_entry', payload: sanitized });
    }

    private setupRoutes(): void {
        this.app.use((request, response, next) => {
            const host = request.headers.host;
            if (!this.isAllowedDashboardHost(host)) {
                response.status(403).json({ message: 'Dashboard host is not allowed.' });
                return;
            }
            const origin = request.headers.origin;
            if (origin && !this.isAllowedDashboardOrigin(origin, host)) {
                response.status(403).json({ message: 'Dashboard origin is not allowed.' });
                return;
            }
            if (
                request.method === 'POST' &&
                request.path.startsWith('/api/') &&
                request.is('application/json') !== 'application/json'
            ) {
                response.status(415).json({ message: 'Dashboard API requires application/json.' });
                return;
            }
            next();
        });
        this.app.use(express.json({ limit: '256kb' }));
        const packagedStaticPath = resolve(__dirname, 'frontend');
        const staticPath = existsSync(resolve(packagedStaticPath, 'index.html'))
            ? packagedStaticPath
            : resolve(__dirname, '..', 'dist', 'frontend');
        this.app.use(express.static(staticPath));
        this.app.get('/', (_request, response) => response.sendFile(resolve(staticPath, 'index.html')));

        this.app.get('/api/status', (_request, response) => {
            response.json({
                status: 'running',
                uptime: process.uptime(),
                openaiConfigured: Boolean(this.gatewayOptions.openaiApiKey),
                openaiModel: this.gatewayOptions.openaiModel,
                backends: this.backendManager.getAllBackendStates(),
            });
        });

        const sanitizedConfig = () => redactGatewayOptions(this.gatewayOptions);
        this.app.get('/api/config', (_request, response) => response.json(sanitizedConfig()));
        this.app.get('/api/config-details', (_request, response) => {
            response.json({
                loadedConfig: sanitizedConfig(),
                finalEffectiveConfig: sanitizedConfig(),
            });
        });
        this.app.get('/api/gateway-version', (_request, response) => {
            response.json({ version: getPackageVersion() });
        });
        this.app.get('/api/logs', this.paginatedHandler(this.logBuffer, 'logs'));
        this.app.get('/api/traces', this.paginatedHandler(this.mcpTraceBuffer, 'traces'));

        this.app.post('/api/chat-with-agent', async (request, response) => {
            const body = (request.body ?? {}) as {
                agentModelString?: string;
                params?: { query?: string };
            };
            const agent = body.agentModelString;
            const query = body.params?.query;
            if (!agent || !query) {
                response.status(400).json({ message: 'agentModelString and params.query are required.' });
                return;
            }
            if (!this.gatewayOptions.agents.includes(agent)) {
                response.status(403).json({ message: 'The requested agent is not configured.' });
                return;
            }
            if (!this.llmOrchestrator) {
                response.status(503).json({ message: 'OpenAI orchestration is not ready.' });
                return;
            }

            try {
                response.json(await this.llmOrchestrator.chatWithAgent(agent, query));
            } catch (error) {
                this.logger.error({ err: error, agent }, 'UI agent chat failed.');
                response.status(502).json({
                    message: error instanceof Error ? redactText(error.message) : 'Agent request failed.',
                });
            }
        });
    }

    private setupWebSockets(): void {
        this.wss.on('connection', (socket) => {
            socket.send(JSON.stringify({ type: 'info', message: 'Connected to mcp-agentify.' }));
        });
    }

    private isAllowedWebSocketRequest(origin: string | undefined, host: string | undefined): boolean {
        return Boolean(origin && this.isAllowedDashboardOrigin(origin, host));
    }

    private isAllowedDashboardHost(host: string | undefined): boolean {
        if (!host) return false;
        try {
            const parsedHost = new URL(`http://${host}`);
            const allowedHostname = parsedHost.hostname === '127.0.0.1' || parsedHost.hostname === 'localhost';
            return (
                allowedHostname &&
                !parsedHost.username &&
                !parsedHost.password &&
                Number(parsedHost.port || '80') === this.port
            );
        } catch {
            return false;
        }
    }

    private isAllowedDashboardOrigin(origin: string, host: string | undefined): boolean {
        if (!this.isAllowedDashboardHost(host)) return false;
        try {
            const parsedOrigin = new URL(origin);
            const parsedHost = new URL(`http://${host}`);
            return (
                parsedOrigin.protocol === 'http:' &&
                parsedOrigin.hostname === parsedHost.hostname &&
                Number(parsedOrigin.port || '80') === this.port
            );
        } catch {
            return false;
        }
    }

    private createLogStream(): Writable {
        return new Writable({
            write: (chunk, _encoding, callback) => {
                for (const line of String(chunk).split('\n')) {
                    if (!line.trim()) {
                        continue;
                    }
                    try {
                        const logObject = JSON.parse(line) as Record<string, unknown>;
                        const entry: LogEntry = {
                            timestamp: typeof logObject.time === 'number' ? logObject.time : Date.now(),
                            level: this.pinoLevelToName(logObject.level),
                            message: typeof logObject.msg === 'string' ? redactText(logObject.msg) : 'Log entry',
                            details: redactValue(
                                Object.fromEntries(
                                    Object.entries(logObject).filter(
                                        ([key]) => !['time', 'level', 'msg'].includes(key),
                                    ),
                                ),
                            ),
                        };
                        this.pushBounded(this.logBuffer, entry);
                        this.broadcast({ type: 'log_entry', payload: entry });
                    } catch {
                        const entry: LogEntry = {
                            timestamp: Date.now(),
                            level: 'INFO',
                            message: redactText(line),
                        };
                        this.pushBounded(this.logBuffer, entry);
                    }
                }
                callback();
            },
        });
    }

    private paginatedHandler<T>(items: T[], propertyName: string): RequestHandler {
        return (request, response) => {
            const page = Math.max(0, Number.parseInt(String(request.query.page || '0'), 10) || 0);
            const pageSize = Math.min(
                500,
                Math.max(1, Number.parseInt(String(request.query.pageSize || '100'), 10) || 100),
            );
            const end = Math.max(0, items.length - page * pageSize);
            const start = Math.max(0, end - pageSize);
            response.json({
                [propertyName]: items.slice(start, end).reverse(),
                total: items.length,
                page,
                pageSize,
            });
        };
    }

    private pinoLevelToName(level: unknown): LogEntry['level'] {
        if (typeof level !== 'number' || level <= 10) return 'TRACE';
        if (level <= 20) return 'DEBUG';
        if (level <= 30) return 'INFO';
        if (level <= 40) return 'WARN';
        if (level <= 50) return 'ERROR';
        return 'FATAL';
    }

    private pushBounded<T>(items: T[], item: T): void {
        if (items.length >= MAX_BUFFER_SIZE) {
            items.shift();
        }
        items.push(item);
    }

    private broadcast(message: object): void {
        const serialized = JSON.stringify(message);
        for (const client of this.wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(serialized);
            }
        }
    }
}
