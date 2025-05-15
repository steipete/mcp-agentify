import OpenAI, { APIError } from 'openai';
import type { Logger as PinoLoggerBase } from 'pino';
import { PinoLogLevel } from './logger';
import type { BackendConfig, OrchestrationContext, Plan, BackendStdioConfig } from './interfaces';
import { LLMGeneratedArgumentsSchema, LLMPlanSchema } from './schemas';
// OrchestrationContext, Plan, LLMGeneratedArgumentsSchema, LLMPlanSchema will be used in later subtasks.

export class LLMOrchestratorService {
    private openai: OpenAI;
    private logger: PinoLoggerBase<PinoLogLevel>;
    private availableToolsForLLM: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

    constructor(apiKey: string, backendConfigs: BackendConfig[], logger: PinoLoggerBase<PinoLogLevel>) {
        if (!apiKey) {
            // Logger might not be initialized yet if this constructor is called before logger.ts is ready
            // However, logger is passed in, so it should be available.
            logger.error('OpenAI API key is required for LLMOrchestratorService but was not provided.');
            throw new Error('OpenAI API key is required for LLMOrchestratorService.');
        }
        this.logger = logger.child({ component: 'LLMOrchestratorService' });

        try {
            this.openai = new OpenAI({
                apiKey: apiKey,
                // Default timeout and retry settings from the library are generally good for PoC.
                // maxRetries: 2, // Example: Customize if needed
                // timeout: 60 * 1000, // 60 seconds (default is 10 minutes)
            });
            this.logger.info('OpenAI client initialized successfully.');
        } catch (error: unknown) {
            let errorMsg = 'Unknown error during OpenAI client init';
            if (error instanceof Error) errorMsg = error.message;
            this.logger.error({ err: error, rawErrorMsg: errorMsg }, 'Failed to initialize OpenAI client');
            throw error;
        }

        this.generateOpenAITools(backendConfigs);
    }

    /**
     * Generates OpenAI tool definitions from backend configurations as per spec.md.
     * @param backendConfigs - Array of backend configurations.
     */
    private generateOpenAITools(backendConfigs: BackendConfig[]): void {
        this.availableToolsForLLM = []; // Clear any existing tools
        if (!backendConfigs || backendConfigs.length === 0) {
            this.logger.warn(
                'generateOpenAITools called with no backend configurations. No tools will be available to the LLM.',
            );
            return;
        }

        // Type parameters as Record<string, unknown> which is compatible with OpenAI's FunctionParameters
        const standardToolParameters: Record<string, unknown> = {
            type: 'object',
            properties: {
                mcp_method: {
                    type: 'string',
                    description: 'The specific MCP method to invoke on the selected backend service.',
                },
                mcp_params: {
                    type: 'object',
                    description:
                        'A key-value object containing parameters for the mcp_method. Structure varies by method.',
                },
            },
            required: ['mcp_method', 'mcp_params'],
        };

        for (const config of backendConfigs) {
            // spec.md states function.name MUST be backendConfig.id
            const toolName = config.id;
            let toolDescription = '';

            // Use descriptions from spec.md section 7
            // This mapping should ideally be more robust if many tools are expected.
            switch (toolName) {
                case 'filesystem':
                    toolDescription =
                        "Handles local filesystem operations like reading/writing files, listing directories, creating/deleting within pre-configured accessible paths. Use context like `currentWorkingDirectory` or `activeDocumentURI` to resolve relative paths if a query implies it. Key methods: 'fs/readFile' (params: {path: string}), 'fs/writeFile' (params: {path: string, content: string}), 'fs/readdir' (params: {path: string}), 'fs/mkdir' (params: {path: string}), 'fs/rm' (params: {path: string, recursive?: boolean}). Paths should typically be absolute or be resolvable using provided context within the allowed mounted points.";
                    break;
                case 'mcpBrowserbase': // As per spec.md example initializationOptions
                    toolDescription =
                        "Controls a cloud browser (Browserbase) for web interactions. Can load URLs, take screenshots, extract text or HTML, and run JavaScript on pages. Useful for web scraping, fetching live web content, or simple web automation. Context can inform URLs or search queries. Key methods: 'browser/loadUrl' (params: {url: string}), 'browser/screenshot' (params: {sessionId?: string, format?: \'png\'|\'jpeg\'}), 'browser/extractText' (params: {sessionId?: string}), 'browser/extractHtml' (params: {sessionId?: string}). A session is typically initiated by 'browser/loadUrl'.";
                    break;
                default: {
                    this.logger.warn(
                        { backendId: toolName, backendType: (config as BackendStdioConfig).type },
                        `No specific description found for tool ID '${toolName}'. Using a generic description. Please update spec.md or this mapping.`,
                    );
                    // Use displayName from config if available, otherwise id itself for a generic description
                    const displayName = (config as BackendStdioConfig).displayName || toolName;
                    toolDescription = `Interface to the ${displayName} backend service. Provide mcp_method and mcp_params to interact.`;
                    break; // Good practice to have a break in default too, though logically last here.
                }
            }

            // Infer the type for toolFunction from the ChatCompletionTool type
            const toolFunction: OpenAI.Chat.Completions.ChatCompletionTool['function'] = {
                name: toolName,
                description: toolDescription,
                parameters: standardToolParameters, // Assign the Record<string, unknown> object
            };

            const tool: OpenAI.Chat.Completions.ChatCompletionTool = {
                type: 'function',
                function: toolFunction,
            };
            this.availableToolsForLLM.push(tool);
            this.logger.debug({ toolName: tool.function.name }, 'Generated OpenAI tool definition');
        }
        this.logger.info({ count: this.availableToolsForLLM.length }, 'OpenAI tool definitions generated.');
    }

    // orchestrate method will be implemented in Subtask 5.3
    // Getter for testing or other internal uses if necessary
    public getAvailableTools(): OpenAI.Chat.Completions.ChatCompletionTool[] {
        return this.availableToolsForLLM;
    }

    public async orchestrate(query: string, context: OrchestrationContext | null | undefined): Promise<Plan | null> {
        this.logger.info({ query, context }, 'Orchestrating task based on user query and context.');

        if (this.availableToolsForLLM.length === 0) {
            this.logger.warn('No tools available for LLM orchestration. Cannot proceed.');
            return null;
        }

        const systemPrompt =
            "You are an expert AI assistant. Based on the user's query, provided context (such as `currentWorkingDirectory` or `activeDocumentURI`), and available tools, choose exactly one tool to call by specifying its `mcp_method` and `mcp_params`. Use the provided context to inform the parameters if applicable and relevant. If the query is ambiguous, cannot be handled by any tool, or if essential information is missing from the query or context for a tool to operate, you MUST NOT call any tool.";
        const userMessageContent = `User query: "${query}"\n${context ? `Context: ${JSON.stringify(context)}` : ''}`;

        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessageContent },
        ];

        const requestPayload: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
            model: 'gpt-4.1',
            messages: messages,
            tools: this.availableToolsForLLM,
            tool_choice: 'auto' as const,
        };

        this.logger.trace({ requestPayload }, 'Sending request to OpenAI API for tool call generation.');

        try {
            const response = await this.openai.chat.completions.create(requestPayload);
            this.logger.trace({ response }, 'Received response from OpenAI API.');

            const toolCalls = response.choices[0]?.message?.tool_calls;

            if (!toolCalls || toolCalls.length === 0) {
                this.logger.warn({ query, context, choice: response.choices[0] }, 'LLM did not choose any tool.');
                return null;
            }

            if (toolCalls.length > 1) {
                this.logger.warn(
                    { query, context, toolCallsCount: toolCalls.length },
                    'LLM chose multiple tools. Using only the first one as per PoC spec (one-shot operation).',
                );
                // PoC spec implies one-shot, so we take the first.
            }

            const firstToolCall = toolCalls[0];
            if (firstToolCall.type !== 'function') {
                this.logger.error(
                    { toolCallType: firstToolCall.type },
                    'LLM returned a tool call that is not a function type. Cannot proceed.',
                );
                return null;
            }

            const backendId = firstToolCall.function.name;
            const argsString = firstToolCall.function.arguments;
            let parsedArgsJson: unknown;
            try {
                parsedArgsJson = JSON.parse(argsString);
            } catch (parseError: unknown) {
                let errorMsg = 'Unknown JSON parse error';
                if (parseError instanceof Error) errorMsg = parseError.message;
                else if (typeof parseError === 'string') errorMsg = parseError;
                this.logger.error(
                    { err: parseError, argsString, rawErrorMsg: errorMsg },
                    'Failed to parse LLM function arguments JSON string.',
                );
                return null;
            }

            const validatedArgs = LLMGeneratedArgumentsSchema.safeParse(parsedArgsJson);
            if (!validatedArgs.success) {
                this.logger.error(
                    { error: validatedArgs.error.format(), parsedArgsJson },
                    'LLM generated arguments do not match LLMGeneratedArgumentsSchema.',
                );
                return null;
            }

            const planCandidate: Plan = {
                backendId: backendId,
                mcpMethod: validatedArgs.data.mcp_method,
                mcpParams: validatedArgs.data.mcp_params,
            };

            // Final validation of the overall plan structure against LLMPlanSchema
            const validatedPlan = LLMPlanSchema.safeParse(planCandidate);
            if (!validatedPlan.success) {
                this.logger.error(
                    { error: validatedPlan.error.format(), planCandidate },
                    'Constructed plan does not match LLMPlanSchema.',
                );
                return null;
            }

            this.logger.info({ plan: validatedPlan.data }, 'LLM generated a valid plan.');
            return validatedPlan.data;
        } catch (apiError: unknown) {
            if (apiError instanceof APIError) {
                this.logger.error(
                    {
                        err: apiError,
                        name: apiError.name,
                        status: apiError.status,
                        headers: apiError.headers,
                        message: apiError.message,
                    },
                    'OpenAI API Error during tool call generation.',
                );
            } else {
                let errorMsg = 'Unknown error during OpenAI API call';
                if (apiError instanceof Error) errorMsg = apiError.message;
                else if (typeof apiError === 'string') errorMsg = apiError;
                this.logger.error(
                    { err: apiError, rawErrorMsg: errorMsg },
                    'Non-API error during OpenAI call or processing.',
                );
            }
            return null;
        }
    }
}
