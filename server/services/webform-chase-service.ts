/**
 * Web Form Auto-Chase Service
 *
 * Handles automated follow-up for web form leads:
 * 1. Immediate acknowledgment WhatsApp when form submitted
 * 2. 2-hour follow-up if no response
 * 3. 24-hour mark as "needs_chase" for manual attention
 *
 * Integrates with Lead Tube Map for tracking and broadcasting.
 */

import { db } from "../db";
import { leads, conversations, messages, LeadStage } from "@shared/schema";
import { eq, and, lt, isNull, isNotNull, or, desc, gte } from "drizzle-orm";
import { sendWhatsAppMessage } from "../meta-whatsapp";
import { updateLeadStage } from "../lead-stage-engine";

// Timing configuration
export const WEBFORM_CHASE_TIMING = {
    IMMEDIATE_ACK: 0, // Send immediately
    FIRST_FOLLOWUP: 2 * 60 * 60 * 1000, // 2 hours
    NEEDS_CHASE_MARK: 24 * 60 * 60 * 1000, // 24 hours
};

// Message templates
const WEBFORM_TEMPLATES = {
    IMMEDIATE_ACK: (name: string, jobDesc: string) => {
        const jobSnippet = jobDesc ? ` about "${jobDesc.slice(0, 30)}${jobDesc.length > 30 ? '...' : ''}"` : '';
        return `Hi ${name}! Thanks for your enquiry${jobSnippet}! When's a good time to call you?`;
    },

    FIRST_FOLLOWUP: (name: string) =>
        `Hi ${name}! Just checking in - we received your enquiry. Let us know when's a good time to call and discuss your project!`,

    SECOND_FOLLOWUP: (name: string) =>
        `Hey ${name}, wanted to follow up on your enquiry. If you're still interested, just reply and we'll get you sorted!`,
};

export interface WebFormChaseResult {
    leadId: string;
    customerName: string;
    action: 'ack_sent' | 'followup_sent' | 'marked_needs_chase' | 'skipped' | 'error';
    message?: string;
    error?: string;
    timestamp: Date;
}

/**
 * Process a newly submitted web form lead
 *
 * 1. Send immediate WhatsApp acknowledgment
 * 2. Mark lead as 'contacted' if message sent successfully
 *
 * @param leadId The ID of the newly created lead
 */
export async function processWebFormLead(leadId: string): Promise<WebFormChaseResult> {
    try {
        // Get the lead
        const [lead] = await db.select()
            .from(leads)
            .where(eq(leads.id, leadId));

        if (!lead) {
            return {
                leadId,
                customerName: 'Unknown',
                action: 'error',
                error: 'Lead not found',
                timestamp: new Date(),
            };
        }

        // Check if lead is from web form
        if (!['web_quote', 'webform', 'website'].includes(lead.source || '')) {
            return {
                leadId,
                customerName: lead.customerName,
                action: 'skipped',
                message: 'Not a web form lead',
                timestamp: new Date(),
            };
        }

        // Check if we already contacted this lead
        if (lead.stage !== 'new_lead') {
            return {
                leadId,
                customerName: lead.customerName,
                action: 'skipped',
                message: `Already in stage: ${lead.stage}`,
                timestamp: new Date(),
            };
        }

        // Prepare the acknowledgment message
        const firstName = lead.customerName.split(' ')[0];
        const message = WEBFORM_TEMPLATES.IMMEDIATE_ACK(firstName, lead.jobDescription || '');

        // Send WhatsApp message
        await sendWhatsAppMessage(lead.phone, message);

        // Update lead stage to contacted
        await updateLeadStage(leadId, 'contacted' as LeadStage, {
            reason: 'Web form auto-acknowledgment sent',
        });

        console.log(`[WebFormChase] Sent immediate ack to ${lead.customerName} (${leadId})`);

        return {
            leadId,
            customerName: lead.customerName,
            action: 'ack_sent',
            message,
            timestamp: new Date(),
        };

    } catch (error) {
        console.error(`[WebFormChase] Error processing lead ${leadId}:`, error);
        return {
            leadId,
            customerName: 'Unknown',
            action: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date(),
        };
    }
}

/**
 * Check and process follow-ups for web form leads
 *
 * Runs through leads that need follow-up actions:
 * - 2 hours: Send first follow-up if no response
 * - 24 hours: Mark as needs_chase for manual attention
 *
 * Should be called by a cron job (e.g., every 15 minutes)
 */
export async function checkWebFormFollowups(): Promise<WebFormChaseResult[]> {
    const results: WebFormChaseResult[] = [];
    const now = Date.now();

    try {
        // Get all web form leads that need attention
        const webFormLeads = await db.select()
            .from(leads)
            .where(and(
                or(
                    eq(leads.source, 'web_quote'),
                    eq(leads.source, 'webform'),
                    eq(leads.source, 'website')
                ),
                or(
                    eq(leads.stage, 'new_lead'),
                    eq(leads.stage, 'contacted')
                ),
                isNull(leads.mergedIntoId),
                isNull(leads.snoozedUntil) // Don't chase snoozed leads
            ))
            .orderBy(leads.createdAt);

        for (const lead of webFormLeads) {
            const leadAge = now - new Date(lead.createdAt!).getTime();
            const result = await processLeadFollowup(lead, leadAge);
            if (result) {
                results.push(result);
            }
        }

    } catch (error) {
        console.error('[WebFormChase] Error checking followups:', error);
    }

    if (results.length > 0) {
        console.log(`[WebFormChase] Processed ${results.length} follow-ups`);
    }

    return results;
}

/**
 * Process follow-up for a single lead based on its age
 */
async function processLeadFollowup(
    lead: any,
    leadAge: number
): Promise<WebFormChaseResult | null> {
    const firstName = lead.customerName.split(' ')[0];

    // Check if customer has responded (via WhatsApp)
    const hasResponse = await checkForCustomerResponse(lead.phone);

    if (hasResponse) {
        // Customer has responded - no need for auto-chase
        return null;
    }

    // 24-hour mark: Flag for manual attention
    if (leadAge >= WEBFORM_CHASE_TIMING.NEEDS_CHASE_MARK) {
        // Only flag once (check if already flagged by looking at tags/status)
        if (lead.status === 'needs_chase') {
            return null;
        }

        await db.update(leads)
            .set({
                status: 'needs_chase',
                updatedAt: new Date(),
            })
            .where(eq(leads.id, lead.id));

        console.log(`[WebFormChase] Marked ${lead.customerName} as needs_chase (24h+)`);

        return {
            leadId: lead.id,
            customerName: lead.customerName,
            action: 'marked_needs_chase',
            message: 'No response for 24 hours',
            timestamp: new Date(),
        };
    }

    // 2-hour mark: Send first follow-up
    if (leadAge >= WEBFORM_CHASE_TIMING.FIRST_FOLLOWUP) {
        // Check if we already sent a follow-up
        const alreadyFollowedUp = await checkFollowupSent(lead.phone, lead.createdAt);
        if (alreadyFollowedUp) {
            return null;
        }

        try {
            const message = WEBFORM_TEMPLATES.FIRST_FOLLOWUP(firstName);
            await sendWhatsAppMessage(lead.phone, message);

            console.log(`[WebFormChase] Sent 2h follow-up to ${lead.customerName}`);

            return {
                leadId: lead.id,
                customerName: lead.customerName,
                action: 'followup_sent',
                message,
                timestamp: new Date(),
            };
        } catch (error) {
            console.error(`[WebFormChase] Failed to send follow-up to ${lead.customerName}:`, error);
            return {
                leadId: lead.id,
                customerName: lead.customerName,
                action: 'error',
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date(),
            };
        }
    }

    return null;
}

/**
 * Check if customer has responded via WhatsApp
 */
async function checkForCustomerResponse(phone: string): Promise<boolean> {
    try {
        // Format phone for WhatsApp conversation lookup
        const formattedPhone = phone.replace(/^\+/, '').replace(/\D/g, '');

        // Check conversations table for inbound messages
        const [conversation] = await db.select()
            .from(conversations)
            .where(eq(conversations.phoneNumber, formattedPhone))
            .limit(1);

        if (conversation && conversation.lastInboundAt) {
            return true;
        }

        // Also check with + prefix
        const [conversationWithPlus] = await db.select()
            .from(conversations)
            .where(eq(conversations.phoneNumber, `+${formattedPhone}`))
            .limit(1);

        if (conversationWithPlus && conversationWithPlus.lastInboundAt) {
            return true;
        }

        return false;
    } catch (error) {
        console.error('[WebFormChase] Error checking customer response:', error);
        return false; // Assume no response if we can't check
    }
}

/**
 * Check if we already sent a follow-up message after lead creation
 */
async function checkFollowupSent(phone: string, leadCreatedAt: Date | null): Promise<boolean> {
    if (!leadCreatedAt) return false;

    try {
        const formattedPhone = phone.replace(/^\+/, '').replace(/\D/g, '');

        // Find conversation
        const [conversation] = await db.select()
            .from(conversations)
            .where(or(
                eq(conversations.phoneNumber, formattedPhone),
                eq(conversations.phoneNumber, `+${formattedPhone}`)
            ))
            .limit(1);

        if (!conversation) return false;

        // Check for outbound messages after lead creation
        const outboundMessages = await db.select()
            .from(messages)
            .where(and(
                eq(messages.conversationId, conversation.id),
                eq(messages.direction, 'outbound'),
                gte(messages.createdAt, leadCreatedAt)
            ))
            .orderBy(desc(messages.createdAt))
            .limit(5);

        // If we've sent more than 1 outbound message after lead creation,
        // we've already done a follow-up
        return outboundMessages.length > 1;
    } catch (error) {
        console.error('[WebFormChase] Error checking followup sent:', error);
        return false;
    }
}

/**
 * Get summary of web form leads needing attention
 */
export async function getWebFormChaseSummary(): Promise<{
    newLeads: number;
    contacted: number;
    needsChase: number;
    total: number;
}> {
    try {
        const webFormLeads = await db.select({
            stage: leads.stage,
            status: leads.status,
        })
            .from(leads)
            .where(and(
                or(
                    eq(leads.source, 'web_quote'),
                    eq(leads.source, 'webform'),
                    eq(leads.source, 'website')
                ),
                isNull(leads.mergedIntoId)
            ));

        const newLeads = webFormLeads.filter(l => l.stage === 'new_lead').length;
        const contacted = webFormLeads.filter(l => l.stage === 'contacted').length;
        const needsChase = webFormLeads.filter(l => l.status === 'needs_chase').length;

        return {
            newLeads,
            contacted,
            needsChase,
            total: webFormLeads.length,
        };
    } catch (error) {
        console.error('[WebFormChase] Error getting summary:', error);
        return { newLeads: 0, contacted: 0, needsChase: 0, total: 0 };
    }
}

/**
 * Manually trigger a follow-up for a specific lead
 */
export async function triggerManualFollowup(
    leadId: string,
    customMessage?: string
): Promise<WebFormChaseResult> {
    try {
        const [lead] = await db.select()
            .from(leads)
            .where(eq(leads.id, leadId));

        if (!lead) {
            return {
                leadId,
                customerName: 'Unknown',
                action: 'error',
                error: 'Lead not found',
                timestamp: new Date(),
            };
        }

        const firstName = lead.customerName.split(' ')[0];
        const message = customMessage || WEBFORM_TEMPLATES.FIRST_FOLLOWUP(firstName);

        await sendWhatsAppMessage(lead.phone, message);

        // Clear needs_chase status if it was set
        if (lead.status === 'needs_chase') {
            await db.update(leads)
                .set({
                    status: 'chased',
                    updatedAt: new Date(),
                })
                .where(eq(leads.id, leadId));
        }

        console.log(`[WebFormChase] Manual follow-up sent to ${lead.customerName}`);

        return {
            leadId,
            customerName: lead.customerName,
            action: 'followup_sent',
            message,
            timestamp: new Date(),
        };

    } catch (error) {
        console.error(`[WebFormChase] Error in manual follow-up for ${leadId}:`, error);
        return {
            leadId,
            customerName: 'Unknown',
            action: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date(),
        };
    }
}
