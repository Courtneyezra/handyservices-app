/**
 * Base Worker Class
 *
 * Abstract base class for all AI workers in the Property Maintenance system.
 * Each worker has a focused purpose and its own tools.
 */

import { AIProvider, AIMessage, Tool, runConversationTurn, ChatOptions } from '../provider';
import { WorkerContext, WorkerResponse, TenantIssue } from '@shared/schema';

export type WorkerType =
    | 'TENANT_WORKER'
    | 'TRIAGE_WORKER'
    | 'DISPATCH_WORKER'
    | 'LANDLORD_WORKER'
    | 'INSPECTOR_WORKER';

export interface WorkerResult {
    message: string;
    nextWorker?: WorkerType;
    stateUpdates?: Partial<TenantIssue>;
    toolCalls: Array<{
        tool: string;
        args: Record<string, unknown>;
        result: unknown;
    }>;
    shouldHandoff: boolean;
}

export abstract class BaseWorker {
    abstract name: WorkerType;
    abstract systemPrompt: string;
    abstract tools: Tool[];

    protected provider: AIProvider;
    protected chatOptions: ChatOptions = {
        temperature: 0.7,
        maxTokens: 1024
    };

    constructor(provider: AIProvider) {
        this.provider = provider;
    }

    /**
     * Build the system prompt with context
     */
    protected buildSystemPrompt(context: WorkerContext): string {
        let prompt = this.systemPrompt;

        // Add context information
        if (context.tenant) {
            prompt += `\n\n## Current Context
- Tenant: ${context.tenant.name}
- Phone: ${context.tenant.phone}`;
        }

        if (context.property) {
            prompt += `
- Property: ${context.property.address}
- Postcode: ${context.property.postcode}`;
        }

        if (context.landlord) {
            prompt += `
- Landlord: ${context.landlord.customerName}`;
        }

        if (context.currentIssue) {
            prompt += `

## Current Issue
- Description: ${context.currentIssue.issueDescription || 'Not yet provided'}
- Status: ${context.currentIssue.status}
- Category: ${context.currentIssue.issueCategory || 'Not categorized'}
- Urgency: ${context.currentIssue.urgency || 'Not assessed'}`;
        }

        return prompt;
    }

    /**
     * Build messages from conversation history
     */
    protected buildMessages(
        currentMessage: string,
        context: WorkerContext
    ): AIMessage[] {
        const messages: AIMessage[] = [
            {
                role: 'system',
                content: this.buildSystemPrompt(context)
            }
        ];

        // Add recent conversation history (last 10 messages)
        const recentHistory = context.conversationHistory.slice(-10);
        for (const msg of recentHistory) {
            messages.push({
                role: msg.direction === 'inbound' ? 'user' : 'assistant',
                content: msg.content || ''
            });
        }

        // Add current message
        messages.push({
            role: 'user',
            content: currentMessage
        });

        return messages;
    }

    /**
     * Execute the worker with the given message and context
     */
    async execute(
        message: string,
        context: WorkerContext,
        additionalTools?: Tool[]
    ): Promise<WorkerResult> {
        const messages = this.buildMessages(message, context);
        const allTools = [...this.tools, ...(additionalTools || [])];

        const { response, toolResults } = await runConversationTurn(
            this.provider,
            messages,
            allTools,
            context,
            this.chatOptions
        );

        // Parse response for handoff indicators
        const { cleanedResponse, nextWorker, stateUpdates } = this.parseResponse(response, toolResults);

        return {
            message: cleanedResponse,
            nextWorker,
            stateUpdates,
            toolCalls: toolResults,
            shouldHandoff: !!nextWorker
        };
    }

    /**
     * Parse the response for control flow indicators
     */
    protected parseResponse(
        response: string,
        toolResults: Array<{ tool: string; args: Record<string, unknown>; result: unknown }>
    ): {
        cleanedResponse: string;
        nextWorker?: WorkerType;
        stateUpdates?: Partial<TenantIssue>;
    } {
        let cleanedResponse = response;
        let nextWorker: WorkerType | undefined;
        let stateUpdates: Partial<TenantIssue> | undefined;

        // Check tool results for handoff signals
        for (const result of toolResults) {
            if (result.tool === 'handoff_to_worker') {
                nextWorker = (result.args as { worker: WorkerType }).worker;
            }
            if (result.tool === 'update_issue_state') {
                stateUpdates = {
                    ...(stateUpdates || {}),
                    ...(result.args as Partial<TenantIssue>)
                };
            }
        }

        return { cleanedResponse, nextWorker, stateUpdates };
    }
}

/**
 * Common tools available to all workers
 */
export const commonTools: Tool[] = [
    {
        name: 'handoff_to_worker',
        description: 'Hand off the conversation to a different specialized worker',
        parameters: {
            type: 'object',
            properties: {
                worker: {
                    type: 'string',
                    enum: ['TENANT_WORKER', 'TRIAGE_WORKER', 'DISPATCH_WORKER', 'LANDLORD_WORKER', 'INSPECTOR_WORKER'],
                    description: 'The worker to hand off to'
                },
                reason: {
                    type: 'string',
                    description: 'Why this handoff is happening'
                }
            },
            required: ['worker', 'reason']
        },
        handler: async (args) => {
            console.log(`[Worker] Handoff requested to ${args.worker}: ${args.reason}`);
            return { success: true, handoff: args.worker };
        }
    },
    {
        name: 'update_issue_state',
        description: 'Update the current issue state',
        parameters: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    enum: ['new', 'ai_helping', 'awaiting_details', 'reported', 'quoted', 'approved', 'scheduled', 'completed', 'resolved_diy', 'cancelled'],
                    description: 'New status for the issue'
                },
                urgency: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'emergency'],
                    description: 'Urgency level'
                },
                issueCategory: {
                    type: 'string',
                    description: 'Category of the issue'
                },
                issueDescription: {
                    type: 'string',
                    description: 'Updated description'
                },
                tenantAvailability: {
                    type: 'string',
                    description: 'When tenant is available'
                },
                accessInstructions: {
                    type: 'string',
                    description: 'How to access the property'
                }
            }
        },
        handler: async (args) => {
            console.log('[Worker] Issue state update:', args);
            return { success: true, updates: args };
        }
    },
    {
        name: 'escalate_to_human',
        description: 'Flag this conversation for human review due to urgency or complexity',
        parameters: {
            type: 'object',
            properties: {
                reason: {
                    type: 'string',
                    description: 'Why human review is needed'
                },
                urgency: {
                    type: 'string',
                    enum: ['low', 'medium', 'high', 'emergency'],
                    description: 'How urgent is this escalation'
                }
            },
            required: ['reason', 'urgency']
        },
        handler: async (args) => {
            console.log(`[Worker] Escalation to human: ${args.reason} (${args.urgency})`);
            // In production, this would create an alert in the admin dashboard
            return { escalated: true, reason: args.reason };
        }
    }
];
