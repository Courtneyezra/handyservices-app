/**
 * Lead Stage Engine
 *
 * Computes and manages lead funnel stages based on data from multiple sources:
 * - leads table
 * - calls table
 * - personalized_quotes table
 * - contractor_jobs table
 * - conversations table (WhatsApp)
 */

import { db } from "./db";
import { leads, calls, personalizedQuotes, contractorJobs, conversations, LeadStage, LeadStageValues } from "@shared/schema";
import { eq, desc, and, isNotNull, gte, lte, or } from "drizzle-orm";

// Lead Route type (imported from schema)
export type LeadRoute = 'video' | 'instant_quote' | 'site_visit';

// Stage priority for computation (higher = further in funnel)
const STAGE_PRIORITY: Record<LeadStage, number> = {
    'new_lead': 0,
    'contacted': 1,
    'awaiting_video': 2,      // Video route: waiting for customer video
    'video_received': 3,      // Video route: video received, ready to quote
    'visit_scheduled': 2,     // Site visit route: visit booked
    'visit_done': 3,          // Site visit route: visit completed, ready to quote
    'quote_sent': 4,
    'quote_viewed': 5,
    'awaiting_payment': 6,
    'booked': 7,
    'in_progress': 8,
    'completed': 9,
    'lost': -1,      // Terminal negative
    'expired': -2,   // Terminal negative
    'declined': -3,  // Terminal negative
};

// Route-specific stage sequences
export const ROUTE_STAGES: Record<LeadRoute, LeadStage[]> = {
    'video': [
        'new_lead',
        'contacted',
        'awaiting_video',
        'video_received',
        'quote_sent',
        'quote_viewed',
        'awaiting_payment',
        'booked',
        'in_progress',
        'completed',
    ],
    'instant_quote': [
        'new_lead',
        'contacted',
        'quote_sent',
        'quote_viewed',
        'awaiting_payment',
        'booked',
        'in_progress',
        'completed',
    ],
    'site_visit': [
        'new_lead',
        'contacted',
        'visit_scheduled',
        'visit_done',
        'quote_sent',
        'quote_viewed',
        'awaiting_payment',
        'booked',
        'in_progress',
        'completed',
    ],
};

// SLA thresholds in hours for each stage
export const STAGE_SLA_HOURS: Record<LeadStage, number | null> = {
    'new_lead': 0.5,        // 30 minutes to contact
    'contacted': 24,        // 24 hours to send quote
    'awaiting_video': 24,   // 24 hours to receive video from customer
    'video_received': 4,    // 4 hours to process video and send quote
    'visit_scheduled': null, // No SLA - waiting for visit date
    'visit_done': 8,        // 8 hours to send quote after visit
    'quote_sent': 12,       // 12 hours for them to view
    'quote_viewed': 24,     // 24 hours to select
    'awaiting_payment': 12, // 12 hours to pay
    'booked': null,         // No SLA - waiting for job date
    'in_progress': null,    // No SLA - job in progress
    'completed': null,      // No SLA - done
    'lost': null,           // Terminal
    'expired': null,        // Terminal
    'declined': null,       // Terminal
};

interface StageComputationResult {
    stage: LeadStage;
    reason: string;
    dataSource: 'lead' | 'call' | 'quote' | 'job' | 'conversation' | 'computed';
}

/**
 * Compute the current stage of a lead based on all data sources
 * Uses the highest priority (furthest in funnel) stage found
 */
export async function computeLeadStage(leadId: string): Promise<StageComputationResult> {
    // Get lead data
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));

    if (!lead) {
        return { stage: 'new_lead', reason: 'Lead not found', dataSource: 'computed' };
    }

    // Track the highest priority stage found
    let bestStage: LeadStage = 'new_lead';
    let bestReason = 'Default stage';
    let bestSource: StageComputationResult['dataSource'] = 'lead';

    // Helper to update if higher priority
    const updateIfHigher = (stage: LeadStage, reason: string, source: StageComputationResult['dataSource']) => {
        // Don't override terminal negative states with positive states
        if (STAGE_PRIORITY[bestStage] < 0) return;

        if (STAGE_PRIORITY[stage] > STAGE_PRIORITY[bestStage]) {
            bestStage = stage;
            bestReason = reason;
            bestSource = source;
        }
    };

    // 1. Check existing lead stage field (manual overrides)
    if (lead.stage && STAGE_PRIORITY[lead.stage as LeadStage] !== undefined) {
        const leadStage = lead.stage as LeadStage;
        // If already marked as terminal, respect that
        if (STAGE_PRIORITY[leadStage] < 0) {
            return { stage: leadStage, reason: 'Manually marked', dataSource: 'lead' };
        }
        updateIfHigher(leadStage, 'From lead record', 'lead');
    }

    // 2. Check calls for this lead
    const relatedCalls = await db.select()
        .from(calls)
        .where(or(
            eq(calls.leadId, leadId),
            eq(calls.phoneNumber, lead.phone)
        ))
        .orderBy(desc(calls.startTime))
        .limit(5);

    for (const call of relatedCalls) {
        if (call.outcome === 'INSTANT_PRICE' || call.outcome === 'LEAD_CAPTURED') {
            updateIfHigher('contacted', `Call outcome: ${call.outcome}`, 'call');
        } else if (call.outcome === 'NO_ANSWER' || call.outcome === 'VOICEMAIL') {
            // Don't upgrade stage, but track
        }
    }

    // 3. Check quotes linked to this lead
    const relatedQuotes = await db.select()
        .from(personalizedQuotes)
        .where(or(
            eq(personalizedQuotes.leadId, leadId),
            eq(personalizedQuotes.phone, lead.phone)
        ))
        .orderBy(desc(personalizedQuotes.createdAt))
        .limit(5);

    for (const quote of relatedQuotes) {
        // Quote created = quote_sent
        if (quote.createdAt) {
            updateIfHigher('quote_sent', 'Quote created', 'quote');
        }

        // Quote viewed
        if (quote.viewedAt) {
            updateIfHigher('quote_viewed', 'Quote viewed', 'quote');
        }

        // Package selected = awaiting_payment
        if (quote.selectedAt && !quote.bookedAt) {
            updateIfHigher('awaiting_payment', 'Package selected', 'quote');
        }

        // Deposit paid = booked
        if (quote.depositPaidAt || quote.bookedAt) {
            updateIfHigher('booked', 'Deposit paid', 'quote');
        }

        // Check for declined/expired
        if (quote.rejectionReason) {
            if (STAGE_PRIORITY[bestStage] >= 0 && STAGE_PRIORITY[bestStage] < 5) {
                bestStage = 'declined';
                bestReason = quote.rejectionReason;
                bestSource = 'quote';
            }
        }
    }

    // 4. Check jobs for this lead
    const relatedJobs = await db.select()
        .from(contractorJobs)
        .where(or(
            eq(contractorJobs.leadId, leadId),
            eq(contractorJobs.customerPhone, lead.phone)
        ))
        .orderBy(desc(contractorJobs.createdAt))
        .limit(3);

    for (const job of relatedJobs) {
        if (job.status === 'in_progress') {
            updateIfHigher('in_progress', 'Job in progress', 'job');
        } else if (job.status === 'completed') {
            updateIfHigher('completed', 'Job completed', 'job');
        } else if (job.status === 'pending' || job.status === 'accepted') {
            updateIfHigher('booked', `Job status: ${job.status}`, 'job');
        }
    }

    // 5. Check WhatsApp conversations
    const [conversation] = await db.select()
        .from(conversations)
        .where(eq(conversations.phoneNumber, lead.phone))
        .limit(1);

    if (conversation) {
        // If there's recent inbound activity and stage is new_lead, upgrade to contacted
        if (conversation.lastInboundAt && bestStage === 'new_lead') {
            updateIfHigher('contacted', 'WhatsApp conversation active', 'conversation');
        }
    }

    // 6. Check for lost lead (no activity for 7 days after quote sent)
    if (bestStage === 'quote_sent' || bestStage === 'quote_viewed') {
        const latestQuote = relatedQuotes[0];
        if (latestQuote) {
            const quoteDate = new Date(latestQuote.createdAt!);
            const daysSinceQuote = (Date.now() - quoteDate.getTime()) / (1000 * 60 * 60 * 24);

            if (daysSinceQuote > 7) {
                bestStage = 'lost';
                bestReason = 'No activity for 7 days after quote';
                bestSource = 'computed';
            }
        }
    }

    return { stage: bestStage, reason: bestReason, dataSource: bestSource };
}

/**
 * Update a lead's stage and trigger any automations
 */
export async function updateLeadStage(
    leadId: string,
    newStage: LeadStage,
    options?: { force?: boolean; reason?: string }
): Promise<{ success: boolean; previousStage?: LeadStage; automationsTriggered?: string[] }> {
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId));

    if (!lead) {
        return { success: false };
    }

    const previousStage = (lead.stage as LeadStage) || 'new_lead';

    // Don't allow downgrade unless forced
    if (!options?.force && STAGE_PRIORITY[newStage] < STAGE_PRIORITY[previousStage]) {
        console.log(`[LeadStage] Skipping downgrade from ${previousStage} to ${newStage} for lead ${leadId}`);
        return { success: false, previousStage };
    }

    // Update the stage
    await db.update(leads)
        .set({
            stage: newStage,
            stageUpdatedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(leads.id, leadId));

    console.log(`[LeadStage] Lead ${leadId} stage updated: ${previousStage} -> ${newStage} (${options?.reason || 'no reason'})`);

    // Trigger stage change automations
    const automationsTriggered = await onStageChange(leadId, previousStage, newStage, lead);

    return { success: true, previousStage, automationsTriggered };
}

/**
 * Handle stage change automations
 */
async function onStageChange(
    leadId: string,
    fromStage: LeadStage,
    toStage: LeadStage,
    lead: any
): Promise<string[]> {
    const triggered: string[] = [];

    // Log stage transition for analytics
    console.log(`[LeadStage] Stage transition: ${fromStage} -> ${toStage} for lead ${leadId} (${lead.customerName})`);

    // Broadcast WebSocket event for Pipeline Home dashboard
    // Use dynamic import to avoid circular dependencies
    try {
        const { broadcastLeadStageChange, broadcastPipelineActivity } = await import('./pipeline-events');

        // Broadcast the stage change
        broadcastLeadStageChange({
            leadId,
            customerName: lead.customerName,
            previousStage: fromStage,
            newStage: toStage,
            route: lead.route,
        });

        // For significant transitions, also broadcast as activity
        const significantStages = ['booked', 'in_progress', 'completed', 'lost'];
        if (significantStages.includes(toStage)) {
            const icons: Record<string, string> = {
                booked: '📅',
                in_progress: '🔧',
                completed: '✨',
                lost: '❌',
            };
            broadcastPipelineActivity({
                type: 'stage_change',
                leadId,
                customerName: lead.customerName,
                summary: `Stage changed to ${getStageDisplayName(toStage)}`,
                icon: icons[toStage] || '🔄',
                data: { previousStage: fromStage, newStage: toStage },
            });
        }
    } catch (e) {
        // Don't fail stage update if broadcast fails
        console.warn(`[LeadStage] Failed to broadcast stage change event:`, e);
    }

    // Future automations will be added here:
    // - Send WhatsApp templates
    // - Create admin tasks
    // - Update CRM metadata

    // For now, just log transitions that need attention
    if (toStage === 'lost') {
        triggered.push('add_to_remarketing_list');
        console.log(`[LeadStage] Lead ${leadId} marked as LOST - should add to remarketing`);
    }

    if (toStage === 'booked') {
        triggered.push('send_confirmation');
        console.log(`[LeadStage] Lead ${leadId} BOOKED - confirmation should be sent`);
    }

    return triggered;
}

/**
 * Recompute and sync all leads' stages (batch operation)
 * Useful for backfilling after adding stage field
 */
export async function syncAllLeadStages(): Promise<{ updated: number; errors: number }> {
    const allLeads = await db.select({ id: leads.id }).from(leads);

    let updated = 0;
    let errors = 0;

    for (const lead of allLeads) {
        try {
            const computed = await computeLeadStage(lead.id);
            const [current] = await db.select({ stage: leads.stage }).from(leads).where(eq(leads.id, lead.id));

            if (current.stage !== computed.stage) {
                await updateLeadStage(lead.id, computed.stage, {
                    force: true,
                    reason: `Batch sync: ${computed.reason}`
                });
                updated++;
            }
        } catch (e) {
            console.error(`[LeadStage] Error syncing lead ${lead.id}:`, e);
            errors++;
        }
    }

    console.log(`[LeadStage] Batch sync complete: ${updated} updated, ${errors} errors`);
    return { updated, errors };
}

/**
 * Get SLA status for a lead
 */
export function getSLAStatus(stage: LeadStage, stageUpdatedAt: Date | null): {
    status: 'ok' | 'warning' | 'overdue';
    hoursRemaining: number | null;
    slaHours: number | null;
} {
    const slaHours = STAGE_SLA_HOURS[stage];

    if (!slaHours || !stageUpdatedAt) {
        return { status: 'ok', hoursRemaining: null, slaHours: null };
    }

    const hoursInStage = (Date.now() - new Date(stageUpdatedAt).getTime()) / (1000 * 60 * 60);
    const hoursRemaining = slaHours - hoursInStage;

    if (hoursRemaining < 0) {
        return { status: 'overdue', hoursRemaining, slaHours };
    } else if (hoursRemaining < slaHours * 0.25) {
        // Warning when <25% time remaining
        return { status: 'warning', hoursRemaining, slaHours };
    }

    return { status: 'ok', hoursRemaining, slaHours };
}

/**
 * Get display name for a stage
 */
export function getStageDisplayName(stage: LeadStage): string {
    const names: Record<LeadStage, string> = {
        'new_lead': 'New Leads',
        'contacted': 'Contacted',
        'awaiting_video': 'Awaiting Video',
        'video_received': 'Video Received',
        'visit_scheduled': 'Visit Scheduled',
        'visit_done': 'Visit Done',
        'quote_sent': 'Quote Sent',
        'quote_viewed': 'Quote Viewed',
        'awaiting_payment': 'Awaiting Payment',
        'booked': 'Booked',
        'in_progress': 'In Progress',
        'completed': 'Completed',
        'lost': 'Lost',
        'expired': 'Expired',
        'declined': 'Declined',
    };
    return names[stage] || stage;
}

/**
 * Get next action required for a stage
 */
export function getNextAction(stage: LeadStage): string {
    const actions: Record<LeadStage, string> = {
        'new_lead': 'Contact customer',
        'contacted': 'Determine route',
        'awaiting_video': 'Chase video',
        'video_received': 'Review & quote',
        'visit_scheduled': 'Attend visit',
        'visit_done': 'Send quote',
        'quote_sent': 'Follow up',
        'quote_viewed': 'Close the deal',
        'awaiting_payment': 'Chase payment',
        'booked': 'Dispatch',
        'in_progress': 'Monitor job',
        'completed': 'Request review',
        'lost': 'Remarketing',
        'expired': 'Re-engage',
        'declined': 'Understand why',
    };
    return actions[stage] || 'Review';
}

/**
 * Get next stage based on route
 * Returns the next logical stage in the funnel based on the lead's route
 */
export function getNextStageForRoute(
    currentStage: LeadStage,
    route: LeadRoute | null
): LeadStage | null {
    // If no route, use default progression
    if (!route) {
        const defaultProgression: Record<LeadStage, LeadStage | null> = {
            'new_lead': 'contacted',
            'contacted': 'quote_sent',
            'awaiting_video': 'video_received',
            'video_received': 'quote_sent',
            'visit_scheduled': 'visit_done',
            'visit_done': 'quote_sent',
            'quote_sent': 'quote_viewed',
            'quote_viewed': 'awaiting_payment',
            'awaiting_payment': 'booked',
            'booked': 'in_progress',
            'in_progress': 'completed',
            'completed': null,
            'lost': null,
            'expired': null,
            'declined': null,
        };
        return defaultProgression[currentStage];
    }

    // Get route-specific stages
    const routeStages = ROUTE_STAGES[route];
    const currentIndex = routeStages.indexOf(currentStage);

    if (currentIndex === -1 || currentIndex >= routeStages.length - 1) {
        return null;
    }

    return routeStages[currentIndex + 1];
}

/**
 * Validate if a stage transition is valid for a given route
 */
export function isValidTransition(
    fromStage: LeadStage,
    toStage: LeadStage,
    route: LeadRoute | null
): boolean {
    // Terminal stages cannot transition
    if (STAGE_PRIORITY[fromStage] < 0) {
        return false;
    }

    // Allow transitions to terminal stages from any state
    if (STAGE_PRIORITY[toStage] < 0) {
        return true;
    }

    // If no route, allow any forward progression
    if (!route) {
        return STAGE_PRIORITY[toStage] > STAGE_PRIORITY[fromStage];
    }

    // Check if both stages are in the route and transition is forward
    const routeStages = ROUTE_STAGES[route];
    const fromIndex = routeStages.indexOf(fromStage);
    const toIndex = routeStages.indexOf(toStage);

    // If source stage isn't in route, allow transition
    if (fromIndex === -1) {
        return true;
    }

    // Target must be in route and after source
    return toIndex !== -1 && toIndex > fromIndex;
}
