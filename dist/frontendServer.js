"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrontendServer = void 0;
const node_fs_1 = require("node:fs");
const http = __importStar(require("node:http"));
const node_path_1 = require("node:path");
const node_stream_1 = require("node:stream");
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const redaction_1 = require("./redaction");
const utils_1 = require("./utils");
const MAX_BUFFER_SIZE = 500;
class FrontendServer {
    constructor(port, logger, backendManager, gatewayOptions) {
        this.logBuffer = [];
        this.mcpTraceBuffer = [];
        this.port = port;
        this.logger = logger.child({ component: 'FrontendServer' });
        this.backendManager = backendManager;
        this.gatewayOptions = gatewayOptions;
        this.app = (0, express_1.default)();
        this.httpServer = http.createServer(this.app);
        const verifyClient = ({ origin, req }) => this.isAllowedWebSocketRequest(origin, req.headers.host);
        this.wss = new ws_1.WebSocketServer({
            server: this.httpServer,
            verifyClient,
        });
        this.logPassthroughStream = this.createLogStream();
        this.backendManager.on('mcpTrace', (trace) => this.addMcpTrace(trace));
        this.setupRoutes();
        this.setupWebSockets();
    }
    getLogStream() {
        return this.logPassthroughStream;
    }
    updateLogger(logger) {
        this.logger = logger.child({ component: 'FrontendServer' });
    }
    setLlmOrchestrator(orchestrator) {
        this.llmOrchestrator = orchestrator;
    }
    getPort() {
        return this.port;
    }
    async start() {
        const initialPort = this.port;
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const port = initialPort + attempt;
            try {
                await new Promise((resolvePromise, rejectPromise) => {
                    const onError = (error) => {
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
            }
            catch (error) {
                if (error.code !== 'EADDRINUSE' || attempt === 9) {
                    throw error;
                }
            }
        }
    }
    async stop() {
        for (const client of this.wss.clients) {
            client.terminate();
        }
        await new Promise((resolvePromise) => this.wss.close(() => resolvePromise()));
        if (!this.httpServer.listening) {
            return;
        }
        await new Promise((resolvePromise, rejectPromise) => {
            this.httpServer.close((error) => (error ? rejectPromise(error) : resolvePromise()));
        });
    }
    addMcpTrace(trace) {
        const sanitized = (0, redaction_1.redactValue)(trace);
        this.pushBounded(this.mcpTraceBuffer, sanitized);
        this.broadcast({ type: 'mcp_trace_entry', payload: sanitized });
    }
    setupRoutes() {
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
            if (request.method === 'POST' &&
                request.path.startsWith('/api/') &&
                request.is('application/json') !== 'application/json') {
                response.status(415).json({ message: 'Dashboard API requires application/json.' });
                return;
            }
            next();
        });
        this.app.use(express_1.default.json({ limit: '256kb' }));
        const packagedStaticPath = (0, node_path_1.resolve)(__dirname, 'frontend');
        const staticPath = (0, node_fs_1.existsSync)((0, node_path_1.resolve)(packagedStaticPath, 'index.html'))
            ? packagedStaticPath
            : (0, node_path_1.resolve)(__dirname, '..', 'dist', 'frontend');
        this.app.use(express_1.default.static(staticPath));
        this.app.get('/', (_request, response) => response.sendFile((0, node_path_1.resolve)(staticPath, 'index.html')));
        this.app.get('/api/status', (_request, response) => {
            response.json({
                status: 'running',
                uptime: process.uptime(),
                openaiConfigured: Boolean(this.gatewayOptions.openaiApiKey),
                openaiModel: this.gatewayOptions.openaiModel,
                backends: this.backendManager.getAllBackendStates(),
            });
        });
        const sanitizedConfig = () => (0, redaction_1.redactGatewayOptions)(this.gatewayOptions);
        this.app.get('/api/config', (_request, response) => response.json(sanitizedConfig()));
        this.app.get('/api/config-details', (_request, response) => {
            response.json({
                loadedConfig: sanitizedConfig(),
                finalEffectiveConfig: sanitizedConfig(),
            });
        });
        this.app.get('/api/gateway-version', (_request, response) => {
            response.json({ version: (0, utils_1.getPackageVersion)() });
        });
        this.app.get('/api/logs', this.paginatedHandler(this.logBuffer, 'logs'));
        this.app.get('/api/traces', this.paginatedHandler(this.mcpTraceBuffer, 'traces'));
        this.app.post('/api/chat-with-agent', async (request, response) => {
            const body = request.body;
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
            }
            catch (error) {
                this.logger.error({ err: error, agent }, 'UI agent chat failed.');
                response.status(502).json({
                    message: error instanceof Error ? (0, redaction_1.redactText)(error.message) : 'Agent request failed.',
                });
            }
        });
    }
    setupWebSockets() {
        this.wss.on('connection', (socket) => {
            socket.send(JSON.stringify({ type: 'info', message: 'Connected to mcp-agentify.' }));
        });
    }
    isAllowedWebSocketRequest(origin, host) {
        return Boolean(origin && this.isAllowedDashboardOrigin(origin, host));
    }
    isAllowedDashboardHost(host) {
        if (!host)
            return false;
        try {
            const parsedHost = new URL(`http://${host}`);
            const allowedHostname = parsedHost.hostname === '127.0.0.1' || parsedHost.hostname === 'localhost';
            return (allowedHostname &&
                !parsedHost.username &&
                !parsedHost.password &&
                Number(parsedHost.port || '80') === this.port);
        }
        catch {
            return false;
        }
    }
    isAllowedDashboardOrigin(origin, host) {
        if (!this.isAllowedDashboardHost(host))
            return false;
        try {
            const parsedOrigin = new URL(origin);
            const parsedHost = new URL(`http://${host}`);
            return (parsedOrigin.protocol === 'http:' &&
                parsedOrigin.hostname === parsedHost.hostname &&
                Number(parsedOrigin.port || '80') === this.port);
        }
        catch {
            return false;
        }
    }
    createLogStream() {
        return new node_stream_1.Writable({
            write: (chunk, _encoding, callback) => {
                for (const line of String(chunk).split('\n')) {
                    if (!line.trim()) {
                        continue;
                    }
                    try {
                        const logObject = JSON.parse(line);
                        const entry = {
                            timestamp: typeof logObject.time === 'number' ? logObject.time : Date.now(),
                            level: this.pinoLevelToName(logObject.level),
                            message: typeof logObject.msg === 'string' ? (0, redaction_1.redactText)(logObject.msg) : 'Log entry',
                            details: (0, redaction_1.redactValue)(Object.fromEntries(Object.entries(logObject).filter(([key]) => !['time', 'level', 'msg'].includes(key)))),
                        };
                        this.pushBounded(this.logBuffer, entry);
                        this.broadcast({ type: 'log_entry', payload: entry });
                    }
                    catch {
                        const entry = {
                            timestamp: Date.now(),
                            level: 'INFO',
                            message: (0, redaction_1.redactText)(line),
                        };
                        this.pushBounded(this.logBuffer, entry);
                    }
                }
                callback();
            },
        });
    }
    paginatedHandler(items, propertyName) {
        return (request, response) => {
            const page = Math.max(0, Number.parseInt(String(request.query.page || '0'), 10) || 0);
            const pageSize = Math.min(500, Math.max(1, Number.parseInt(String(request.query.pageSize || '100'), 10) || 100));
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
    pinoLevelToName(level) {
        if (typeof level !== 'number' || level <= 10)
            return 'TRACE';
        if (level <= 20)
            return 'DEBUG';
        if (level <= 30)
            return 'INFO';
        if (level <= 40)
            return 'WARN';
        if (level <= 50)
            return 'ERROR';
        return 'FATAL';
    }
    pushBounded(items, item) {
        if (items.length >= MAX_BUFFER_SIZE) {
            items.shift();
        }
        items.push(item);
    }
    broadcast(message) {
        const serialized = JSON.stringify(message);
        for (const client of this.wss.clients) {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(serialized);
            }
        }
    }
}
exports.FrontendServer = FrontendServer;
//# sourceMappingURL=frontendServer.js.map