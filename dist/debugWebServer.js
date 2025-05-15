"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebugWebServer = void 0;
// src/debugWebServer.ts
const node_http_1 = __importDefault(require("node:http"));
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws"); // Import WebSocket type as well for client handling
const node_path_1 = require("node:path");
const MAX_BUFFER_SIZE = 500; // Max entries for logs/traces in memory
class DebugWebServer {
    constructor(port, mainLogger, backendManager, gatewayOptions) {
        // In-memory buffers for logs and traces
        this.logBuffer = [];
        this.mcpTraceBuffer = [];
        this.port = port;
        this.logger = mainLogger.child({ component: 'DebugWebServer' });
        this.backendManager = backendManager;
        this.gatewayOptions = gatewayOptions ? this.sanitizeConfig(gatewayOptions) : undefined;
        this.app = (0, express_1.default)();
        this.httpServer = node_http_1.default.createServer(this.app);
        this.wss = new ws_1.WebSocketServer({ server: this.httpServer });
        this.setupExpressMiddleware();
        this.setupApiRoutes();
        this.setupWebSockets();
        this.logger.info('DebugWebServer initialized.');
    }
    sanitizeConfig(config) {
        this.logger.debug('Sanitizing gateway configuration for debug API.');
        const sanitized = JSON.parse(JSON.stringify(config)); // Assume full structure initially
        if (sanitized.OPENAI_API_KEY) {
            sanitized.OPENAI_API_KEY = '[REDACTED]';
        }
        if (sanitized.backends) {
            sanitized.backends = sanitized.backends.map(backend => {
                const newBackend = { ...backend };
                if (newBackend.env) {
                    const newEnv = {};
                    for (const key in newBackend.env) {
                        if (key.toUpperCase().includes('KEY') || key.toUpperCase().includes('SECRET') || key.toUpperCase().includes('TOKEN')) {
                            newEnv[key] = '[REDACTED]';
                        }
                        else {
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
    setupExpressMiddleware() {
        this.app.use(express_1.default.json()); // For parsing application/json in potential POST routes
        // Serve static files from public_debug_ui
        const staticPath = (0, node_path_1.resolve)(process.cwd(), 'public_debug_ui');
        this.app.use(express_1.default.static(staticPath));
        this.logger.info({ path: staticPath }, 'Serving static files for debug UI.');
        // Basic root route for HTML file
        this.app.get('/', (req, res) => {
            res.sendFile((0, node_path_1.resolve)(staticPath, 'index.html'));
        });
    }
    setupApiRoutes() {
        this.logger.info('Setting up API routes for DebugWebServer.');
        this.app.get('/api/status', (req, res) => {
            this.logger.debug('Request received for /api/status');
            if (!this.backendManager) {
                return res.status(503).json({ status: 'initializing', message: 'BackendManager not yet available.' });
            }
            try {
                const backendStates = this.backendManager.getAllBackendStates();
                res.json({
                    status: 'running',
                    uptime: process.uptime(),
                    backends: backendStates.map(b => ({ id: b.id, isReady: b.isReady, displayName: b.config.displayName })),
                    // Add more status info if needed
                });
            }
            catch (error) {
                this.logger.error({ err: error }, "Error fetching /api/status");
                res.status(500).json({ status: 'error', message: 'Failed to retrieve backend status.' });
            }
        });
        this.app.get('/api/config', (req, res) => {
            this.logger.debug('Request received for /api/config');
            if (!this.gatewayOptions) {
                // gatewayOptions is sanitized in constructor. If it was never provided, it's undefined.
                return res.status(404).json({ message: 'Gateway configuration not available or not yet initialized.' });
            }
            res.json(this.gatewayOptions); // Already sanitized
        });
        // Placeholder for /api/logs and /api/traces (Subtask 8.2 continued)
        this.app.get('/api/logs', (req, res) => {
            this.logger.debug({ query: req.query }, 'Request received for /api/logs');
            const page = Number.parseInt(req.query.page || '0', 10);
            const pageSize = Number.parseInt(req.query.pageSize || '100', 10);
            const start = Math.max(0, this.logBuffer.length - (page + 1) * pageSize);
            const end = Math.max(0, this.logBuffer.length - page * pageSize);
            res.json({
                logs: this.logBuffer.slice(start, end).reverse(), // Show recent first
                total: this.logBuffer.length,
                page: page,
                pageSize: pageSize
            });
        });
        this.app.get('/api/traces', (req, res) => {
            this.logger.debug({ query: req.query }, 'Request received for /api/traces');
            const page = Number.parseInt(req.query.page || '0', 10);
            const pageSize = Number.parseInt(req.query.pageSize || '100', 10);
            const start = Math.max(0, this.mcpTraceBuffer.length - (page + 1) * pageSize);
            const end = Math.max(0, this.mcpTraceBuffer.length - page * pageSize);
            res.json({
                traces: this.mcpTraceBuffer.slice(start, end).reverse(), // Show recent first
                total: this.mcpTraceBuffer.length,
                page: page,
                pageSize: pageSize
            });
        });
    }
    setupWebSockets() {
        this.logger.info('Setting up WebSocket listeners (placeholder for Subtask 8.3)');
        this.wss.on('connection', (ws) => {
            this.logger.info('Debug WebSocket client connected.');
            ws.on('message', (message) => {
                this.logger.debug({ message: message.toString() }, 'Received WebSocket message (ignored for now)');
            });
            ws.on('close', () => {
                this.logger.info('Debug WebSocket client disconnected.');
            });
            ws.on('error', (error) => {
                this.logger.error({ err: error }, 'Debug WebSocket error.');
            });
            // Send a welcome message or initial state if needed
            ws.send(JSON.stringify({ type: 'info', message: 'Connected to mcp-agentify debug WebSocket server.' }));
        });
    }
    start() {
        this.httpServer.listen(this.port, () => {
            this.logger.info(`DebugWebServer listening on http://localhost:${this.port}`);
        });
    }
    stop() {
        return new Promise((resolve, reject) => {
            this.logger.info('Attempting to stop DebugWebServer...');
            for (const client of this.wss.clients) {
                client.terminate();
            }
            this.wss.close((errWs) => {
                if (errWs)
                    this.logger.error({ err: errWs }, 'Error closing WebSocketServer');
                else
                    this.logger.info('WebSocketServer closed.');
                this.httpServer.close((errHttp) => {
                    if (errHttp)
                        this.logger.error({ err: errHttp }, 'Error closing HttpServer');
                    else
                        this.logger.info('HttpServer closed.');
                    if (errWs || errHttp)
                        reject(errWs || errHttp);
                    else
                        resolve();
                });
            });
        });
    }
    // Methods for Subtask 8.3 to add logs/traces and broadcast them
    addLogEntry(logEntry) {
        if (this.logBuffer.length >= MAX_BUFFER_SIZE) {
            this.logBuffer.shift(); // Remove oldest
        }
        this.logBuffer.push(logEntry);
        this.broadcastToWebSockets({ type: 'log_entry', payload: logEntry });
    }
    addMcpTrace(traceEntry) {
        if (this.mcpTraceBuffer.length >= MAX_BUFFER_SIZE) {
            this.mcpTraceBuffer.shift(); // Remove oldest
        }
        this.mcpTraceBuffer.push(traceEntry);
        this.broadcastToWebSockets({ type: 'mcp_trace_entry', payload: traceEntry });
    }
    broadcastToWebSockets(message) {
        const jsonMessage = JSON.stringify(message);
        for (const client of this.wss.clients) {
            if (client.readyState === ws_1.WebSocket.OPEN) {
                client.send(jsonMessage);
            }
        }
    }
    // Getter methods for API endpoints (Subtask 8.2)
    getLogBuffer() {
        return [...this.logBuffer];
    }
    getMcpTraceBuffer() {
        return [...this.mcpTraceBuffer];
    }
}
exports.DebugWebServer = DebugWebServer;
//# sourceMappingURL=debugWebServer.js.map