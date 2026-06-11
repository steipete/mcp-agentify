import { createHash } from 'node:crypto';
import OpenAI, { APIError } from 'openai';
import type { Logger } from 'pino';
import type { BackendTool, OrchestrationContext, Plan } from './interfaces';
import type { PinoLogLevel } from './logger';
import { redactText } from './redaction';
import { LLMPlanSchema } from './schemas';

interface ToolTarget {
    backendId: string;
    toolName: string;
}

export interface AgentChatResult {
    message: string;
    model: string;
}

function createFunctionName(tool: BackendTool, existingNames: Set<string>): string {
    const rawName = `${tool.backendId}__${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (rawName.length <= 64 && !existingNames.has(rawName)) {
        return rawName;
    }

    const suffix = createHash('sha256').update(`${tool.backendId}\0${tool.name}`).digest('hex').slice(0, 8);
    return `${rawName.slice(0, 55)}_${suffix}`;
}

export class LLMOrchestratorService {
    private readonly openai: OpenAI;
    private readonly logger: Logger<PinoLogLevel>;
    private readonly model: string;
    private tools: OpenAI.Chat.Completions.ChatCompletionTool[];
    private readonly toolTargets = new Map<string, ToolTarget>();

    constructor(
        apiKey: string,
        model: string,
        backendTools: BackendTool[],
        logger: Logger<PinoLogLevel>,
        baseURL?: string,
    ) {
        this.logger = logger.child({ component: 'LLMOrchestratorService' });
        this.model = model;
        this.openai = new OpenAI({ apiKey, baseURL });

        const functionNames = new Set<string>();
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

    public getAvailableToolCount(): number {
        return this.tools.length;
    }

    public removeBackendTools(backendId: string): void {
        for (const [functionName, target] of this.toolTargets) {
            if (target.backendId === backendId) {
                this.toolTargets.delete(functionName);
            }
        }
        this.tools = this.tools.filter((tool) => this.toolTargets.has(tool.function.name));
    }

    public async orchestrate(query: string, context?: OrchestrationContext): Promise<Plan | null> {
        if (this.tools.length === 0) {
            return null;
        }

        const response = await this.createCompletion({
            model: this.model,
            messages: [
                {
                    role: 'system',
                    content:
                        'Choose exactly one available MCP tool that best satisfies the request. ' +
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

        let parsedArguments: unknown;
        try {
            parsedArguments = JSON.parse(toolCall.arguments);
        } catch (error) {
            this.logger.warn({ err: error }, 'OpenAI returned invalid JSON tool arguments.');
            return null;
        }

        const result = LLMPlanSchema.safeParse({
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

    public async chatWithAgent(agentModelString: string, userQuery: string): Promise<AgentChatResult> {
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

    private async createCompletion(
        request: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
        try {
            return await this.openai.chat.completions.create(request);
        } catch (error) {
            if (error instanceof APIError) {
                this.logger.error(
                    {
                        status: error.status,
                        code: error.code,
                        requestId: error.request_id,
                        message: redactText(error.message),
                    },
                    'OpenAI request failed.',
                );
            } else {
                this.logger.error({ err: error }, 'OpenAI request failed.');
            }
            throw error;
        }
    }
}
