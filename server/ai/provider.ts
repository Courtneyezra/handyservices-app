/**
 * AI Provider Abstraction Layer
 *
 * Provides a unified interface for OpenAI and Anthropic, allowing
 * easy provider swapping without code changes.
 *
 * Note: Anthropic SDK is optional. Install @anthropic-ai/sdk to use it.
 */

import OpenAI from 'openai';

// Anthropic SDK is optional - try to import it
let Anthropic: any = null;
try {
    Anthropic = require('@anthropic-ai/sdk').default;
} catch {
    // Anthropic SDK not installed, that's fine
}

// Tool definition that works with both providers
export interface Tool {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>, context?: unknown) => Promise<unknown>;
}

// Standard message format
export interface AIMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    name?: string;
    toolCallId?: string;
    toolCalls?: ToolCall[];
}

// Tool call from model response
export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
}

// Model response
export interface AIResponse {
    content: string;
    toolCalls: ToolCall[];
    finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
}

// Provider interface
export interface AIProvider {
    name: 'openai' | 'anthropic';
    chat(messages: AIMessage[], tools?: Tool[], options?: ChatOptions): Promise<AIResponse>;
}

export interface ChatOptions {
    temperature?: number;
    maxTokens?: number;
    model?: string;
}

/**
 * OpenAI Provider Implementation
 */
class OpenAIProvider implements AIProvider {
    name: 'openai' = 'openai';
    private client: OpenAI;
    private defaultModel = 'gpt-4o';

    constructor(apiKey?: string) {
        this.client = new OpenAI({
            apiKey: apiKey || process.env.OPENAI_API_KEY
        });
    }

    async chat(messages: AIMessage[], tools?: Tool[], options?: ChatOptions): Promise<AIResponse> {
        // Convert messages to OpenAI format
        const openaiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map(msg => {
            if (msg.role === 'tool') {
                return {
                    role: 'tool' as const,
                    content: msg.content,
                    tool_call_id: msg.toolCallId || ''
                };
            }
            if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
                return {
                    role: 'assistant' as const,
                    content: msg.content || null,
                    tool_calls: msg.toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function' as const,
                        function: {
                            name: tc.name,
                            arguments: JSON.stringify(tc.args)
                        }
                    }))
                };
            }
            return {
                role: msg.role as 'system' | 'user' | 'assistant',
                content: msg.content
            };
        });

        // Convert tools to OpenAI format
        const openaiTools: OpenAI.Chat.ChatCompletionTool[] | undefined = tools?.map(tool => ({
            type: 'function' as const,
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters as OpenAI.FunctionParameters
            }
        }));

        const response = await this.client.chat.completions.create({
            model: options?.model || this.defaultModel,
            messages: openaiMessages,
            tools: openaiTools,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 2048
        });

        const choice = response.choices[0];
        const toolCalls: ToolCall[] = [];

        if (choice.message.tool_calls) {
            for (const tc of choice.message.tool_calls) {
                toolCalls.push({
                    id: tc.id,
                    name: tc.function.name,
                    args: JSON.parse(tc.function.arguments)
                });
            }
        }

        return {
            content: choice.message.content || '',
            toolCalls,
            finishReason: choice.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
            usage: response.usage ? {
                promptTokens: response.usage.prompt_tokens,
                completionTokens: response.usage.completion_tokens
            } : undefined
        };
    }
}

/**
 * Anthropic Provider Implementation
 * Note: Requires @anthropic-ai/sdk to be installed
 */
class AnthropicProvider implements AIProvider {
    name: 'anthropic' = 'anthropic';
    private client: any;
    private defaultModel = 'claude-sonnet-4-20250514';

    constructor(apiKey?: string) {
        if (!Anthropic) {
            throw new Error('Anthropic SDK not installed. Run: npm install @anthropic-ai/sdk');
        }
        this.client = new Anthropic({
            apiKey: apiKey || process.env.ANTHROPIC_API_KEY
        });
    }

    async chat(messages: AIMessage[], tools?: Tool[], options?: ChatOptions): Promise<AIResponse> {
        // Extract system message
        const systemMessage = messages.find(m => m.role === 'system');
        const nonSystemMessages = messages.filter(m => m.role !== 'system');

        // Convert messages to Anthropic format
        const anthropicMessages = nonSystemMessages.map(msg => {
            if (msg.role === 'tool') {
                return {
                    role: 'user' as const,
                    content: [{
                        type: 'tool_result' as const,
                        tool_use_id: msg.toolCallId || '',
                        content: msg.content
                    }]
                };
            }
            return {
                role: msg.role as 'user' | 'assistant',
                content: msg.content
            };
        });

        // Convert tools to Anthropic format
        const anthropicTools = tools?.map(tool => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.parameters
        }));

        const response = await this.client.messages.create({
            model: options?.model || this.defaultModel,
            max_tokens: options?.maxTokens ?? 2048,
            system: systemMessage?.content,
            messages: anthropicMessages,
            tools: anthropicTools
        });

        // Extract content and tool calls
        let textContent = '';
        const toolCalls: ToolCall[] = [];

        for (const block of response.content) {
            if (block.type === 'text') {
                textContent += block.text;
            } else if (block.type === 'tool_use') {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    args: block.input as Record<string, unknown>
                });
            }
        }

        return {
            content: textContent,
            toolCalls,
            finishReason: response.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
            usage: {
                promptTokens: response.usage.input_tokens,
                completionTokens: response.usage.output_tokens
            }
        };
    }
}

/**
 * Factory function to create an AI provider
 */
export function createAIProvider(provider?: 'openai' | 'anthropic'): AIProvider {
    const selectedProvider = provider || (process.env.AI_PROVIDER as 'openai' | 'anthropic') || 'openai';

    switch (selectedProvider) {
        case 'anthropic':
            return new AnthropicProvider();
        case 'openai':
        default:
            return new OpenAIProvider();
    }
}

/**
 * Execute a tool call and return the result
 */
export async function executeToolCall(
    toolCall: ToolCall,
    tools: Tool[],
    context?: unknown
): Promise<string> {
    const tool = tools.find(t => t.name === toolCall.name);
    if (!tool) {
        return JSON.stringify({ error: `Unknown tool: ${toolCall.name}` });
    }

    try {
        const result = await tool.handler(toolCall.args, context);
        return JSON.stringify(result);
    } catch (error) {
        console.error(`[AI Provider] Tool execution error for ${toolCall.name}:`, error);
        return JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}

/**
 * Run a complete conversation turn with automatic tool execution
 */
export async function runConversationTurn(
    provider: AIProvider,
    messages: AIMessage[],
    tools: Tool[],
    context?: unknown,
    options?: ChatOptions,
    maxToolIterations = 5
): Promise<{
    response: string;
    toolResults: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>;
}> {
    let currentMessages = [...messages];
    const toolResults: Array<{ tool: string; args: Record<string, unknown>; result: unknown }> = [];
    let iterations = 0;

    while (iterations < maxToolIterations) {
        const response = await provider.chat(currentMessages, tools, options);

        // If no tool calls, we're done
        if (response.toolCalls.length === 0) {
            return { response: response.content, toolResults };
        }

        // Add assistant message with tool calls (once before all tool results)
        currentMessages.push({
            role: 'assistant',
            content: response.content || '',
            toolCalls: response.toolCalls
        });

        // Execute each tool call and add results
        for (const toolCall of response.toolCalls) {
            const resultStr = await executeToolCall(toolCall, tools, context);
            const result = JSON.parse(resultStr);

            toolResults.push({
                tool: toolCall.name,
                args: toolCall.args,
                result
            });

            // Add tool result
            currentMessages.push({
                role: 'tool',
                content: resultStr,
                toolCallId: toolCall.id,
                name: toolCall.name
            });
        }

        iterations++;
    }

    // Max iterations reached
    console.warn('[AI Provider] Max tool iterations reached');
    return { response: 'I apologize, but I encountered an issue processing your request. Please try again.', toolResults };
}
