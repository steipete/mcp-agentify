"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BackendManager = void 0;
const node_events_1 = require("node:events");
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
const redaction_1 = require("./redaction");
const utils_1 = require("./utils");
function withTimeout(promise, timeoutMs, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
function expandEnvironmentValue(value) {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, variableName) => {
        const resolved = process.env[variableName];
        if (resolved === undefined) {
            throw new Error(`Backend environment references missing variable ${variableName}.`);
        }
        return resolved;
    });
}
class BackendManager extends node_events_1.EventEmitter {
    constructor(logger) {
        super();
        this.backendInstances = new Map();
        this.backendSecrets = new Map();
        this.logger = logger.child({ component: 'BackendManager' });
    }
    updateLogger(logger) {
        this.logger = logger.child({ component: 'BackendManager' });
    }
    async initializeBackend(config) {
        const backendLogger = this.logger.child({ backendId: config.id });
        backendLogger.info({ config: (0, redaction_1.redactBackendConfig)(config) }, 'Initializing backend.');
        const environment = (0, stdio_js_1.getDefaultEnvironment)();
        const sensitiveValues = [];
        for (const variableName of config.inheritEnv) {
            const value = process.env[variableName];
            if (value === undefined) {
                throw new Error(`Backend ${config.id} requires missing environment variable ${variableName}.`);
            }
            environment[variableName] = value;
            sensitiveValues.push(value);
        }
        for (const [key, value] of Object.entries(config.env)) {
            const expandedValue = expandEnvironmentValue(value);
            environment[key] = expandedValue;
            sensitiveValues.push(expandedValue);
        }
        const transport = new stdio_js_1.StdioClientTransport({
            command: config.command,
            args: config.args,
            env: environment,
            stderr: 'pipe',
        });
        let transportClosed = false;
        transport.onclose = () => {
            transportClosed = true;
            const instance = this.backendInstances.get(config.id);
            if (instance?.transport === transport) {
                instance.isReady = false;
                instance.error = 'Backend transport closed.';
                this.emit('backendUnavailable', config.id);
                backendLogger.warn('Backend transport closed.');
            }
        };
        transport.onerror = (error) => {
            const message = (0, redaction_1.redactKnownSecrets)(error.message, sensitiveValues);
            backendLogger.warn({ error: { name: error.name, message } }, 'Backend transport error.');
        };
        transport.stderr?.on('data', (chunk) => {
            const message = (0, redaction_1.redactKnownSecrets)(String(chunk).trim(), sensitiveValues);
            if (message) {
                backendLogger.debug({ backendStderr: message }, 'Backend stderr.');
            }
        });
        const client = new index_js_1.Client({ name: 'mcp-agentify', version: (0, utils_1.getPackageVersion)() }, { capabilities: {} });
        try {
            await withTimeout(client.connect(transport), config.startupTimeoutMs, `Backend ${config.id} did not complete MCP initialization within ${config.startupTimeoutMs}ms.`);
            const listToolsResult = await withTimeout(client.listTools(), config.startupTimeoutMs, `Backend ${config.id} did not list tools within ${config.startupTimeoutMs}ms.`);
            const tools = listToolsResult.tools.map((tool) => ({
                backendId: config.id,
                backendDisplayName: config.displayName || config.id,
                name: tool.name,
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: tool.annotations,
            }));
            if (transportClosed) {
                throw new Error(`Backend ${config.id} transport closed during initialization.`);
            }
            this.backendInstances.set(config.id, {
                id: config.id,
                config,
                client,
                transport,
                tools,
                isReady: true,
            });
            this.backendSecrets.set(config.id, sensitiveValues);
            backendLogger.info({ toolCount: tools.length }, 'Backend ready.');
        }
        catch (error) {
            await transport.close().catch(() => undefined);
            const message = (0, redaction_1.redactKnownSecrets)(error instanceof Error ? error.message : String(error), sensitiveValues);
            backendLogger.error({ error: { name: error instanceof Error ? error.name : 'Error', message } }, 'Backend initialization failed.');
            throw new Error(`Backend ${config.id} failed to initialize: ${message}`);
        }
    }
    async initializeAllBackends(configs) {
        const results = await Promise.allSettled(configs.map((config) => this.initializeBackend(config)));
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length > 0) {
            await this.shutdownAllBackends();
            throw new Error(failures.map((failure) => String(failure.reason)).join('; '));
        }
    }
    getAvailableTools() {
        return Array.from(this.backendInstances.values())
            .filter((instance) => instance.isReady)
            .flatMap((instance) => instance.tools);
    }
    getAllBackendStates() {
        return Array.from(this.backendInstances.values()).map((instance) => ({
            id: instance.id,
            displayName: instance.config.displayName || instance.id,
            isReady: instance.isReady,
            toolCount: instance.tools.length,
            error: instance.error,
        }));
    }
    async executeOnBackend(backendId, toolName, arguments_) {
        const instance = this.backendInstances.get(backendId);
        if (!instance?.isReady) {
            throw new Error(`Backend ${backendId} is not ready.`);
        }
        if (!instance.tools.some((tool) => tool.name === toolName)) {
            throw new Error(`Backend ${backendId} does not expose tool ${toolName}.`);
        }
        this.emitTrace('OUTGOING_FROM_GATEWAY', backendId, toolName, arguments_);
        try {
            const result = await instance.client.callTool({ name: toolName, arguments: arguments_ });
            this.emitTrace('INCOMING_TO_GATEWAY', backendId, toolName, result);
            return result;
        }
        catch (error) {
            this.emitTrace('INCOMING_TO_GATEWAY', backendId, toolName, undefined, error);
            const message = (0, redaction_1.redactKnownSecrets)(error instanceof Error ? error.message : String(error), this.backendSecrets.get(backendId) || []);
            this.logger.error({ backendId, toolName, error: { name: error instanceof Error ? error.name : 'Error', message } }, 'Backend tool call failed.');
            throw new Error(message);
        }
    }
    async shutdownAllBackends() {
        const instances = Array.from(this.backendInstances.values());
        this.backendInstances.clear();
        this.backendSecrets.clear();
        await Promise.allSettled(instances.map(async (instance) => {
            instance.isReady = false;
            await instance.client.close();
        }));
    }
    emitTrace(direction, backendId, method, paramsOrResult, error) {
        const secrets = this.backendSecrets.get(backendId) || [];
        this.emit('mcpTrace', {
            timestamp: Date.now(),
            direction,
            backendId,
            method,
            paramsOrResult: (0, redaction_1.redactValue)(paramsOrResult, secrets),
            error: error instanceof Error
                ? { name: error.name, message: (0, redaction_1.redactKnownSecrets)(error.message, secrets) }
                : (0, redaction_1.redactValue)(error, secrets),
        });
    }
}
exports.BackendManager = BackendManager;
//# sourceMappingURL=backendManager.js.map