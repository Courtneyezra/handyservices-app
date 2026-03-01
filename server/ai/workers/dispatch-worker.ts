/**
 * Dispatch Worker
 *
 * Handles job dispatch decisions based on landlord rules.
 * Checks availability and books jobs when auto-approved.
 */

import { BaseWorker, commonTools } from './base-worker';
import { Tool, AIProvider } from '../provider';
import { evaluateDispatchRules } from '../../rules-engine';
import { db } from '../../db';
import { landlordSettings, tenantIssues, leads, TenantIssue, LandlordSettings, PriceEstimate } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';

const DISPATCH_SYSTEM_PROMPT = `You are a property maintenance dispatch coordinator.
Your job is to make dispatch decisions based on landlord rules and book jobs when appropriate.

## Your Goals

1. **Check Rules** - Look up landlord auto-approval settings
2. **Decide** - Auto-dispatch, request approval, or escalate
3. **Book** - If auto-approved, check availability and book
4. **Notify** - Send appropriate notifications

## Decision Flow
1. Emergency issues → Auto-dispatch (safety first)
2. Check if price is under auto-approve threshold
3. Check if category is in auto-approve list
4. Check monthly budget constraints
5. If all pass → Auto-dispatch
6. Otherwise → Request landlord approval

## Notification Rules
- Auto-dispatch: Notify landlord if they opted in
- Request approval: Always notify landlord
- Emergency: Always notify landlord after dispatch
`;

export class DispatchWorker extends BaseWorker {
    name: 'DISPATCH_WORKER' = 'DISPATCH_WORKER';
    systemPrompt = DISPATCH_SYSTEM_PROMPT;

    constructor(provider: AIProvider) {
        super(provider);
        this.chatOptions = {
            temperature: 0.2, // Very low for consistent decisions
            maxTokens: 512
        };
    }

    tools: Tool[] = [
        ...commonTools,
        {
            name: 'get_landlord_rules',
            description: 'Get landlord auto-approval rules and settings',
            parameters: {
                type: 'object',
                properties: {
                    landlordId: {
                        type: 'string',
                        description: 'Landlord lead ID'
                    }
                },
                required: ['landlordId']
            },
            handler: async (args) => {
                const { landlordId } = args as { landlordId: string };
                return await getLandlordRules(landlordId);
            }
        },
        {
            name: 'evaluate_dispatch',
            description: 'Evaluate whether to auto-dispatch or request approval',
            parameters: {
                type: 'object',
                properties: {
                    landlordId: {
                        type: 'string',
                        description: 'Landlord lead ID'
                    },
                    issueCategory: {
                        type: 'string',
                        description: 'Category of the issue'
                    },
                    urgency: {
                        type: 'string',
                        enum: ['low', 'medium', 'high', 'emergency'],
                        description: 'Urgency level'
                    },
                    estimateLowPence: {
                        type: 'number',
                        description: 'Low price estimate in pence'
                    },
                    estimateHighPence: {
                        type: 'number',
                        description: 'High price estimate in pence'
                    },
                    estimateMidPence: {
                        type: 'number',
                        description: 'Mid price estimate in pence'
                    },
                    confidence: {
                        type: 'number',
                        description: 'Confidence in estimate (0-100)'
                    }
                },
                required: ['landlordId', 'issueCategory', 'urgency', 'estimateMidPence']
            },
            handler: async (args) => {
                const {
                    landlordId,
                    issueCategory,
                    urgency,
                    estimateLowPence,
                    estimateHighPence,
                    estimateMidPence,
                    confidence
                } = args as {
                    landlordId: string;
                    issueCategory: string;
                    urgency: string;
                    estimateLowPence?: number;
                    estimateHighPence?: number;
                    estimateMidPence: number;
                    confidence?: number;
                };

                const rules = await getLandlordRules(landlordId);

                const estimate: PriceEstimate = {
                    lowPricePence: estimateLowPence || estimateMidPence * 0.8,
                    highPricePence: estimateHighPence || estimateMidPence * 1.2,
                    midPricePence: estimateMidPence,
                    confidence: confidence || 70
                };

                const issue: Partial<TenantIssue> = {
                    issueCategory: issueCategory as any,
                    urgency: urgency as any
                };

                const decision = evaluateDispatchRules(issue, estimate, rules);

                return {
                    decision,
                    rules: {
                        autoApproveUnder: rules?.autoApproveUnderPence,
                        requireApprovalAbove: rules?.requireApprovalAbovePence,
                        autoApproveCategories: rules?.autoApproveCategories,
                        monthlyBudget: rules?.monthlyBudgetPence,
                        currentSpend: rules?.currentMonthSpendPence
                    }
                };
            }
        },
        {
            name: 'check_availability',
            description: 'Check available time slots for a job',
            parameters: {
                type: 'object',
                properties: {
                    postcode: {
                        type: 'string',
                        description: 'Property postcode'
                    },
                    preferredDays: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Preferred days from tenant'
                    },
                    urgency: {
                        type: 'string',
                        enum: ['today', 'tomorrow', 'this_week', 'next_week', 'flexible'],
                        description: 'How soon the job is needed'
                    }
                },
                required: ['postcode']
            },
            handler: async (args) => {
                // In production, this would call the availability engine
                const { urgency } = args as { urgency?: string };

                const today = new Date();
                const slots = [];

                const daysToAdd = urgency === 'today' ? 0 :
                                  urgency === 'tomorrow' ? 1 :
                                  urgency === 'this_week' ? 2 : 3;

                for (let i = daysToAdd; i < daysToAdd + 5; i++) {
                    const date = new Date(today);
                    date.setDate(date.getDate() + i);

                    if (date.getDay() !== 0) { // Skip Sunday
                        slots.push({
                            date: date.toISOString().split('T')[0],
                            dayName: date.toLocaleDateString('en-GB', { weekday: 'long' }),
                            slots: ['09:00-12:00', '13:00-17:00']
                        });
                    }
                }

                return {
                    available: true,
                    slots,
                    nextAvailable: slots[0]?.date
                };
            }
        },
        {
            name: 'book_job',
            description: 'Book a job slot for dispatch',
            parameters: {
                type: 'object',
                properties: {
                    date: {
                        type: 'string',
                        description: 'Date in YYYY-MM-DD format'
                    },
                    slot: {
                        type: 'string',
                        description: 'Time slot (e.g., 09:00-12:00)'
                    },
                    estimatePence: {
                        type: 'number',
                        description: 'Estimated price in pence'
                    },
                    isEmergency: {
                        type: 'boolean',
                        description: 'Whether this is an emergency booking'
                    }
                },
                required: ['date', 'slot', 'estimatePence']
            },
            handler: async (args) => {
                console.log('[DispatchWorker] Booking job:', args);
                // In production, this would create a job and update availability
                return {
                    booked: true,
                    date: args.date,
                    slot: args.slot,
                    reference: `JOB-${Date.now().toString(36).toUpperCase()}`
                };
            }
        },
        {
            name: 'request_landlord_approval',
            description: 'Send approval request to landlord',
            parameters: {
                type: 'object',
                properties: {
                    landlordId: {
                        type: 'string',
                        description: 'Landlord lead ID'
                    },
                    issueId: {
                        type: 'string',
                        description: 'Tenant issue ID'
                    },
                    summary: {
                        type: 'string',
                        description: 'Brief summary of the issue'
                    },
                    estimateLow: {
                        type: 'number',
                        description: 'Low estimate in pounds'
                    },
                    estimateHigh: {
                        type: 'number',
                        description: 'High estimate in pounds'
                    },
                    reason: {
                        type: 'string',
                        description: 'Why approval is needed'
                    }
                },
                required: ['landlordId', 'summary', 'estimateLow', 'estimateHigh', 'reason']
            },
            handler: async (args) => {
                console.log('[DispatchWorker] Requesting landlord approval:', args);
                const { landlordId, summary, estimateLow, estimateHigh } = args as {
                    landlordId: string;
                    issueId?: string;
                    summary: string;
                    estimateLow: number;
                    estimateHigh: number;
                    reason: string;
                };

                // L3: Send actual WhatsApp approval request to landlord
                try {
                    const landlord = await db.query.leads.findFirst({
                        where: eq(leads.id, landlordId)
                    });

                    if (landlord?.phone) {
                        // Find property address from the issue
                        const { sendApprovalRequest } = await import('../../services/landlord-notifications');
                        const issue = args.issueId ? await db.query.tenantIssues.findFirst({
                            where: eq(tenantIssues.id, args.issueId as string),
                            with: { property: true }
                        }) : null;

                        const propertyAddress = issue?.property?.address || 'Your property';

                        await sendApprovalRequest(
                            landlord.phone,
                            propertyAddress,
                            summary,
                            estimateLow,
                            estimateHigh
                        );
                    }
                } catch (err) {
                    console.error('[DispatchWorker] Failed to send approval request via WhatsApp:', err);
                }

                return {
                    sent: true,
                    method: 'whatsapp',
                    landlordId: args.landlordId,
                    awaitingApproval: true
                };
            }
        },
        {
            name: 'notify_landlord',
            description: 'Send notification to landlord (for auto-approved jobs)',
            parameters: {
                type: 'object',
                properties: {
                    landlordId: {
                        type: 'string',
                        description: 'Landlord lead ID'
                    },
                    type: {
                        type: 'string',
                        enum: ['auto_dispatched', 'emergency_dispatched', 'completed'],
                        description: 'Type of notification'
                    },
                    message: {
                        type: 'string',
                        description: 'Notification message'
                    }
                },
                required: ['landlordId', 'type', 'message']
            },
            handler: async (args) => {
                console.log('[DispatchWorker] Notifying landlord:', args);
                const { landlordId, type: notifType, message: notifMessage } = args as {
                    landlordId: string;
                    type: string;
                    message: string;
                };

                // L5: Send actual WhatsApp notification to landlord
                try {
                    const landlord = await db.query.leads.findFirst({
                        where: eq(leads.id, landlordId)
                    });

                    if (landlord?.phone) {
                        if (notifType === 'auto_dispatched' || notifType === 'emergency_dispatched') {
                            // Use the dedicated auto-dispatch notification
                            const { notifyLandlordAutoDispatch } = await import('../../tenant-chat');
                            // Find the latest issue for context
                            const latestIssue = await db.query.tenantIssues.findFirst({
                                where: eq(tenantIssues.landlordLeadId, landlordId),
                                orderBy: desc(tenantIssues.createdAt),
                                with: { property: true }
                            });

                            if (latestIssue) {
                                await notifyLandlordAutoDispatch(
                                    landlord.phone,
                                    latestIssue.property?.address || 'Your property',
                                    latestIssue.issueDescription || 'Maintenance issue',
                                    (latestIssue.priceEstimateLowPence || 0) / 100,
                                    (latestIssue.priceEstimateHighPence || 0) / 100,
                                    new Date().toLocaleDateString('en-GB')
                                );
                            }
                        } else {
                            // Generic notification - send the message directly
                            const { sendWhatsAppMessage } = await import('../../meta-whatsapp');
                            await sendWhatsAppMessage(landlord.phone, notifMessage);
                        }
                    }
                } catch (err) {
                    console.error('[DispatchWorker] Failed to send landlord notification via WhatsApp:', err);
                }

                return {
                    sent: true,
                    method: 'whatsapp',
                    type: args.type
                };
            }
        },
        {
            name: 'update_budget_spend',
            description: 'Update landlord monthly spend after auto-approval',
            parameters: {
                type: 'object',
                properties: {
                    landlordId: {
                        type: 'string',
                        description: 'Landlord lead ID'
                    },
                    amountPence: {
                        type: 'number',
                        description: 'Amount to add to spend'
                    }
                },
                required: ['landlordId', 'amountPence']
            },
            handler: async (args) => {
                const { landlordId, amountPence } = args as { landlordId: string; amountPence: number };
                // In production, update the database
                console.log(`[DispatchWorker] Updating budget spend for ${landlordId}: +£${(amountPence / 100).toFixed(2)}`);
                return { updated: true };
            }
        }
    ];
}

/**
 * Get landlord rules from database
 */
async function getLandlordRules(landlordId: string): Promise<LandlordSettings | null> {
    try {
        const result = await db.query.landlordSettings.findFirst({
            where: eq(landlordSettings.landlordLeadId, landlordId)
        });
        return result || null;
    } catch (error) {
        console.error('[DispatchWorker] Error fetching landlord rules:', error);
        return null;
    }
}
