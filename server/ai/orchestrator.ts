/**
 * AI Orchestrator
 *
 * Central coordinator for the Property Maintenance AI system.
 * Routes conversations to appropriate workers and maintains context.
 */

import { createAIProvider, AIProvider, AIMessage } from './provider';
import { BaseWorker, WorkerType, WorkerResult } from './workers/base-worker';
import { TenantWorker } from './workers/tenant-worker';
import { TriageWorker } from './workers/triage-worker';
import { DispatchWorker } from './workers/dispatch-worker';
import { LandlordWorker } from './workers/landlord-worker';
import { db } from '../db';
import { tenants, properties, leads, tenantIssues, landlordSettings, conversations, messages, WorkerContext, TenantIssue, Tenant, Property, Lead, LandlordSettings, Message } from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// Message direction type
type MessageDirection = 'inbound' | 'outbound';

// Incoming message structure
export interface IncomingMessage {
    from: string;
    type: 'text' | 'audio' | 'image' | 'video';
    content: string | null;
    mediaUrl?: string;
    conversationId?: string;
    metadata?: Record<string, unknown>;
}

// Orchestrator response
export interface OrchestratorResponse {
    message: string;
    issueId?: string;
    stateUpdates?: Partial<TenantIssue>;
    workerUsed: WorkerType;
    toolsExecuted: string[];
}

export class Orchestrator {
    private provider: AIProvider;
    private workers: Map<WorkerType, BaseWorker>;

    constructor(providerType?: 'openai' | 'anthropic') {
        this.provider = createAIProvider(providerType);

        // Initialize all workers
        this.workers = new Map();
        this.workers.set('TENANT_WORKER', new TenantWorker(this.provider));
        this.workers.set('TRIAGE_WORKER', new TriageWorker(this.provider));
        this.workers.set('DISPATCH_WORKER', new DispatchWorker(this.provider));
        this.workers.set('LANDLORD_WORKER', new LandlordWorker(this.provider));
        // INSPECTOR_WORKER to be added in future
    }

    /**
     * Main entry point - route a message to the appropriate worker
     */
    async route(message: IncomingMessage): Promise<OrchestratorResponse> {
        console.log(`[Orchestrator] Routing message from ${message.from}`);

        // 1. Identify sender
        const sender = await this.identifySender(message.from);

        if (!sender) {
            return this.handleUnknownSender(message);
        }

        // 2. Build context
        const context = await this.buildContext(sender, message);

        // 3. Determine which worker to use
        const workerType = this.determineWorker(sender, context);

        // 4. Execute worker
        const worker = this.workers.get(workerType);
        if (!worker) {
            console.error(`[Orchestrator] Worker ${workerType} not found`);
            return {
                message: 'Sorry, something went wrong. Please try again.',
                workerUsed: workerType,
                toolsExecuted: []
            };
        }

        const result = await worker.execute(message.content || '', context);

        // 5. Handle handoffs if needed
        let finalResult = result;
        if (result.shouldHandoff && result.nextWorker) {
            finalResult = await this.handleHandoff(result, context, message.content || '');
        }

        // 6. Update issue state if needed
        if (finalResult.stateUpdates && context.currentIssue) {
            await this.updateIssueState(context.currentIssue.id, finalResult.stateUpdates);
        }

        // 7. Save conversation
        await this.saveConversation(context.conversationId, message, finalResult);

        return {
            message: finalResult.message,
            issueId: context.currentIssue?.id,
            stateUpdates: finalResult.stateUpdates,
            workerUsed: finalResult.nextWorker || workerType,
            toolsExecuted: finalResult.toolCalls.map(tc => tc.tool)
        };
    }

    /**
     * Identify the sender by phone number
     */
    private async identifySender(phone: string): Promise<{
        type: 'tenant' | 'landlord';
        tenant?: Tenant;
        property?: Property;
        landlord?: Lead;
    } | null> {
        const normalizedPhone = this.normalizePhone(phone);

        // Check if tenant
        const tenant = await db.query.tenants.findFirst({
            where: eq(tenants.phone, normalizedPhone),
            with: {
                property: {
                    with: {
                        landlord: true
                    }
                }
            }
        });

        if (tenant) {
            return {
                type: 'tenant',
                tenant,
                property: tenant.property,
                landlord: tenant.property?.landlord as Lead | undefined
            };
        }

        // Check if landlord
        const landlord = await db.query.leads.findFirst({
            where: and(
                eq(leads.phone, normalizedPhone),
                // Check for landlord segments
            )
        });

        if (landlord && ['LANDLORD', 'PROP_MGR'].includes(landlord.segment || '')) {
            return {
                type: 'landlord',
                landlord
            };
        }

        return null;
    }

    /**
     * Handle messages from unknown senders
     */
    private async handleUnknownSender(message: IncomingMessage): Promise<OrchestratorResponse> {
        return {
            message: `Hi! I don't have your number registered yet.\n\nCould you tell me your address or postcode so I can find your property?`,
            workerUsed: 'TENANT_WORKER',
            toolsExecuted: []
        };
    }

    /**
     * Build context for the worker
     */
    private async buildContext(
        sender: { type: 'tenant' | 'landlord'; tenant?: Tenant; property?: Property; landlord?: Lead },
        message: IncomingMessage
    ): Promise<WorkerContext> {
        const conversationId = message.conversationId || `${sender.type}_${sender.tenant?.id || sender.landlord?.id}`;

        // Get conversation history
        const history = await this.getConversationHistory(conversationId);

        // Get or create current issue for tenants
        let currentIssue: TenantIssue | undefined;
        let landlordSettingsData: LandlordSettings | undefined;

        if (sender.type === 'tenant' && sender.tenant && sender.property && sender.landlord) {
            currentIssue = await this.getOrCreateIssue(
                sender.tenant,
                sender.property,
                sender.landlord,
                conversationId
            );

            landlordSettingsData = await db.query.landlordSettings.findFirst({
                where: eq(landlordSettings.landlordLeadId, sender.landlord.id)
            }) || undefined;
        }

        if (sender.type === 'landlord' && sender.landlord) {
            landlordSettingsData = await db.query.landlordSettings.findFirst({
                where: eq(landlordSettings.landlordLeadId, sender.landlord.id)
            }) || undefined;
        }

        return {
            conversationId,
            senderId: sender.tenant?.id || sender.landlord?.id || 'unknown',
            senderType: sender.type,
            tenant: sender.tenant,
            property: sender.property,
            landlord: sender.landlord,
            landlordSettings: landlordSettingsData,
            currentIssue,
            conversationHistory: history
        };
    }

    /**
     * Determine which worker should handle this message
     */
    private determineWorker(
        sender: { type: 'tenant' | 'landlord' },
        context: WorkerContext
    ): WorkerType {
        // Landlords always go to landlord worker
        if (sender.type === 'landlord') {
            return 'LANDLORD_WORKER';
        }

        // For tenants, check issue status
        if (context.currentIssue) {
            const status = context.currentIssue.status;

            // If issue is being triaged or dispatched
            if (status === 'awaiting_details') {
                // Check if we have enough details to triage
                if (context.currentIssue.issueDescription &&
                    context.currentIssue.photos?.length &&
                    context.currentIssue.tenantAvailability) {
                    return 'TRIAGE_WORKER';
                }
            }

            if (status === 'reported') {
                return 'DISPATCH_WORKER';
            }
        }

        // Default to tenant worker
        return 'TENANT_WORKER';
    }

    /**
     * Handle worker handoffs
     */
    private async handleHandoff(
        result: WorkerResult,
        context: WorkerContext,
        message: string,
        depth = 0
    ): Promise<WorkerResult> {
        if (depth > 3) {
            console.warn('[Orchestrator] Max handoff depth reached');
            return result;
        }

        if (!result.nextWorker) {
            return result;
        }

        console.log(`[Orchestrator] Handing off to ${result.nextWorker}`);

        const nextWorker = this.workers.get(result.nextWorker);
        if (!nextWorker) {
            console.error(`[Orchestrator] Worker ${result.nextWorker} not found`);
            return result;
        }

        const nextResult = await nextWorker.execute(message, context);

        // Merge tool calls
        nextResult.toolCalls = [...result.toolCalls, ...nextResult.toolCalls];

        // Merge state updates
        if (result.stateUpdates || nextResult.stateUpdates) {
            nextResult.stateUpdates = {
                ...result.stateUpdates,
                ...nextResult.stateUpdates
            };
        }

        // Continue handoff chain if needed
        if (nextResult.shouldHandoff) {
            return this.handleHandoff(nextResult, context, message, depth + 1);
        }

        return nextResult;
    }

    /**
     * Get or create an issue for the tenant
     */
    private async getOrCreateIssue(
        tenant: Tenant,
        property: Property,
        landlord: Lead,
        conversationId: string
    ): Promise<TenantIssue> {
        // Check for existing open issue
        const existingIssue = await db.query.tenantIssues.findFirst({
            where: and(
                eq(tenantIssues.tenantId, tenant.id),
                eq(tenantIssues.conversationId, conversationId)
            ),
            orderBy: desc(tenantIssues.createdAt)
        });

        // If there's a recent open issue, use it
        if (existingIssue && !['completed', 'resolved_diy', 'cancelled'].includes(existingIssue.status)) {
            return existingIssue;
        }

        // Ensure conversation exists before creating issue (FK constraint)
        const existingConversation = await db.query.conversations.findFirst({
            where: eq(conversations.id, conversationId)
        });

        if (!existingConversation) {
            await db.insert(conversations).values({
                id: conversationId,
                phoneNumber: tenant.phone,
                status: 'active',
                lastMessageAt: new Date(),
                lastMessagePreview: null
            });
        }

        // Create a new issue
        const newIssue: TenantIssue = {
            id: nanoid(),
            tenantId: tenant.id,
            propertyId: property.id,
            landlordLeadId: landlord.id,
            status: 'new',
            issueDescription: null,
            issueCategory: null,
            urgency: null,
            aiResolutionAttempted: false,
            aiSuggestions: null,
            aiResolutionAccepted: null,
            photos: null,
            voiceNotes: null,
            tenantAvailability: null,
            additionalNotes: null,
            accessInstructions: null,
            dispatchDecision: null,
            dispatchReason: null,
            priceEstimateLowPence: null,
            priceEstimateHighPence: null,
            quoteId: null,
            jobId: null,
            conversationId,
            landlordNotifiedAt: null,
            landlordReminderCount: 0,
            landlordLastRemindedAt: null,
            landlordApprovedAt: null,
            landlordRejectedAt: null,
            landlordRejectionReason: null,
            createdAt: new Date(),
            reportedToLandlordAt: null,
            resolvedAt: null,
            updatedAt: new Date()
        };

        await db.insert(tenantIssues).values(newIssue);

        return newIssue;
    }

    /**
     * Update issue state
     */
    private async updateIssueState(issueId: string, updates: Partial<TenantIssue>): Promise<void> {
        try {
            await db.update(tenantIssues)
                .set({
                    ...updates,
                    updatedAt: new Date()
                })
                .where(eq(tenantIssues.id, issueId));
        } catch (error) {
            console.error('[Orchestrator] Error updating issue state:', error);
        }
    }

    /**
     * Get conversation history
     */
    private async getConversationHistory(conversationId: string): Promise<Message[]> {
        try {
            const conversation = await db.query.conversations.findFirst({
                where: eq(conversations.id, conversationId),
                with: {
                    messages: {
                        orderBy: desc(messages.createdAt),
                        limit: 20
                    }
                }
            });

            return (conversation?.messages || []).reverse();
        } catch (error) {
            console.error('[Orchestrator] Error getting conversation history:', error);
            return [];
        }
    }

    /**
     * Save conversation messages
     */
    private async saveConversation(
        conversationId: string,
        inboundMessage: IncomingMessage,
        result: WorkerResult
    ): Promise<void> {
        try {
            // Ensure conversation exists
            const existingConversation = await db.query.conversations.findFirst({
                where: eq(conversations.id, conversationId)
            });

            if (!existingConversation) {
                await db.insert(conversations).values({
                    id: conversationId,
                    phoneNumber: inboundMessage.from,
                    status: 'active',
                    lastMessageAt: new Date(),
                    lastMessagePreview: inboundMessage.content?.substring(0, 100)
                });
            }

            // Save inbound message
            if (inboundMessage.content) {
                await db.insert(messages).values({
                    id: nanoid(),
                    conversationId,
                    direction: 'inbound' as MessageDirection,
                    content: inboundMessage.content,
                    type: inboundMessage.type,
                    mediaUrl: inboundMessage.mediaUrl,
                    status: 'delivered',
                    createdAt: new Date()
                });
            }

            // Save outbound message
            await db.insert(messages).values({
                id: nanoid(),
                conversationId,
                direction: 'outbound' as MessageDirection,
                content: result.message,
                type: 'text',
                status: 'sent',
                createdAt: new Date()
            });

            // Update conversation last message
            await db.update(conversations)
                .set({
                    lastMessageAt: new Date(),
                    lastMessagePreview: result.message.substring(0, 100),
                    updatedAt: new Date()
                })
                .where(eq(conversations.id, conversationId));

        } catch (error) {
            console.error('[Orchestrator] Error saving conversation:', error);
        }
    }

    /**
     * Normalize phone number to E.164 format
     */
    private normalizePhone(phone: string): string {
        // Remove any non-digit characters except +
        let normalized = phone.replace(/[^\d+]/g, '');

        // If starts with 0, assume UK and add +44
        if (normalized.startsWith('0')) {
            normalized = '+44' + normalized.substring(1);
        }

        // If doesn't start with +, add it
        if (!normalized.startsWith('+')) {
            normalized = '+' + normalized;
        }

        return normalized;
    }
}

// Singleton instance
let orchestratorInstance: Orchestrator | null = null;

export function getOrchestrator(provider?: 'openai' | 'anthropic'): Orchestrator {
    if (!orchestratorInstance) {
        orchestratorInstance = new Orchestrator(provider);
    }
    return orchestratorInstance;
}
