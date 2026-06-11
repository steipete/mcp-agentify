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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMOrchestratorService = void 0;
const node_crypto_1 = require("node:crypto");
const openai_1 = __importStar(require("openai"));
const redaction_1 = require("./redaction");
const schemas_1 = require("./schemas");
function createFunctionName(tool, existingNames) {
    const rawName = `${tool.backendId}__${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (rawName.length <= 64 && !existingNames.has(rawName)) {
        return rawName;
    }
    const suffix = (0, node_crypto_1.createHash)('sha256').update(`${tool.backendId}\0${tool.name}`).digest('hex').slice(0, 8);
    return `${rawName.slice(0, 55)}_${suffix}`;
}
class LLMOrchestratorService {
    constructor(apiKey, model, backendTools, logger, baseURL) {
        this.toolTargets = new Map();
        this.logger = logger.child({ component: 'LLMOrchestratorService' });
        this.model = model;
        this.openai = new openai_1.default({ apiKey, baseURL });
        const functionNames = new Set();
        this.tools = backendTools.map((tool) => {
            const functionName = createFunctionName(tool, functionNames);
            functionNames.add(functionName);
            this.toolTargets.set(functionName, { backendId: tool.backendId, toolName: tool.name });
            return {
                type: 'function',
                function: {
                    name: functionName,
                    description: [
                        `Backend: ${tool.backendDisplayName}.`,
                        tool.description || `Call the ${tool.name} MCP tool.`,
                    ].join(' '),
                    parameters: tool.inputSchema,
                },
            };
        });
    }
    getAvailableToolCount() {
        return this.tools.length;
    }
    removeBackendTools(backendId) {
        for (const [functionName, target] of this.toolTargets) {
            if (target.backendId === backendId) {
                this.toolTargets.delete(functionName);
            }
        }
        this.tools = this.tools.filter((tool) => this.toolTargets.has(tool.function.name));
    }
    async orchestrate(query, context) {
        if (this.tools.length === 0) {
            return null;
        }
        const response = await this.createCompletion({
            model: this.model,
            messages: [
                {
                    role: 'system',
                    content: 'Choose exactly one available MCP tool that best satisfies the request. ' +
                        'Use the tool input schema exactly. Do not call a tool when required information is missing.',
                },
                {
                    role: 'user',
                    content: JSON.stringify({ query, context: context || null }),
                },
            ],
            tools: this.tools,
            tool_choice: 'auto',
            parallel_tool_calls: false,
        });
        const toolCalls = response.choices[0]?.message?.tool_calls;
        if (!toolCalls || toolCalls.length !== 1 || toolCalls[0].type !== 'function') {
            this.logger.warn({ toolCallCount: toolCalls?.length || 0 }, 'OpenAI did not select exactly one tool.');
            return null;
        }
        const toolCall = toolCalls[0].function;
        const target = this.toolTargets.get(toolCall.name);
        if (!target) {
            this.logger.warn({ functionName: toolCall.name }, 'OpenAI selected an unknown generated tool name.');
            return null;
        }
        let parsedArguments;
        try {
            parsedArguments = JSON.parse(toolCall.arguments);
        }
        catch (error) {
            this.logger.warn({ err: error }, 'OpenAI returned invalid JSON tool arguments.');
            return null;
        }
        const result = schemas_1.LLMPlanSchema.safeParse({
            backendId: target.backendId,
            toolName: target.toolName,
            arguments: parsedArguments,
        });
        if (!result.success) {
            this.logger.warn({ validationErrors: result.error.format() }, 'OpenAI returned invalid tool arguments.');
            return null;
        }
        return result.data;
    }
    async chatWithAgent(agentModelString, userQuery) {
        const [vendor, model] = agentModelString.split('/', 2);
        if (vendor?.toLowerCase() !== 'openai' || !model) {
            throw new Error(`Unsupported agent ${agentModelString}. Expected openai/<model>.`);
        }
        const response = await this.createCompletion({
            model,
            messages: [
                { role: 'system', content: 'Respond directly and concisely to the user.' },
                { role: 'user', content: userQuery },
            ],
        });
        const message = response.choices[0]?.message?.content;
        if (!message) {
            throw new Error('OpenAI returned no message content.');
        }
        return { message, model };
    }
    async createCompletion(request) {
        try {
            return await this.openai.chat.completions.create(request);
        }
        catch (error) {
            if (error instanceof openai_1.APIError) {
                this.logger.error({
                    status: error.status,
                    code: error.code,
                    requestId: error.request_id,
                    message: (0, redaction_1.redactText)(error.message),
                }, 'OpenAI request failed.');
            }
            else {
                this.logger.error({ err: error }, 'OpenAI request failed.');
            }
            throw error;
        }
    }
}
exports.LLMOrchestratorService = LLMOrchestratorService;
//# sourceMappingURL=llmOrchestrator.js.map