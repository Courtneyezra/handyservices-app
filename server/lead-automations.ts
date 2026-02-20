/**
 * Lead Automations Service
 *
 * Handles timed automation triggers for lead follow-ups:
 * - New lead follow-up (30 minutes)
 * - Quote sent reminder (12 hours)
 * - Quote viewed follow-up (24 hours)
 * - Payment pending alert (12 hours)
 * - Lost lead auto-mark (7 days)
 * - Lost lead recovery (7 days after lost)
 */

import { db } from "./db";
import { leads, personalizedQuotes, calls, type LeadStage } from "@shared/schema";
import { eq, desc, and, lt, isNull, isNotNull, or, ne } from "drizzle-orm";
import { updateLeadStage, STAGE_SLA_HOURS } from "./lead-stage-engine";
import { sendWhatsAppMessage } from "./meta-whatsapp";
import { checkWebFormFollowups } from "./services/webform-chase-service";

// Automation timing configuration (in milliseconds)
export const AUTOMATION_TIMING = {
    NEW_LEAD_FOLLOWUP: 30 * 60 * 1000, // 30 minutes
    QUOTE_SENT_REMINDER: 12 * 60 * 60 * 1000, // 12 hours
    QUOTE_VIEWED_FOLLOWUP: 24 * 60 * 60 * 1000, // 24 hours
    AWAITING_PAYMENT_ALERT: 12 * 60 * 60 * 1000, // 12 hours
    AWAITING_VIDEO_REMINDER: 24 * 60 * 60 * 1000, // 24 hours
    LOST_LEAD_AUTO_MARK: 7 * 24 * 60 * 60 * 1000, // 7 days
    LOST_LEAD_RECOVERY: 7 * 24 * 60 * 60 * 1000, // 7 days after marked lost
};

// Automation result for tracking
export interface AutomationResult {
    type: string;
    leadId: string;
    customerName: string;
    action: string;
    success: boolean;
    error?: string;
    timestamp: Date;
}

// Store recent automation results (in-memory)
const automationLog: AutomationResult[] = [];

/**
 * Get recent automation results
 */
export function getAutomationLog(limit: number = 50): AutomationResult[] {
    return automationLog.slice(0, limit);
}

/**
 * Log an automation result
 */
function logAutomation(result: AutomationResult) {
    automationLog.unshift(result);
    if (automationLog.length > 100) {
        automationLog.pop();
    }
    console.log(`[Automation] ${result.type}: ${result.action} for ${result.customerName} - ${result.success ? 'OK' : 'FAILED'}`);
}

/**
 * WhatsApp message templates for automations
 */
const TEMPLATES = {
    NEW_LEAD_ACKNOWLEDGMENT: (name: string) =>
        `Hi ${name}! Thanks for getting in touch. We've received your request and we're reviewing it now. We'll get back to you shortly with a quote!`,

    QUOTE_SENT_REMINDER: (name: string, link: string) =>
        `Hi ${name}! Your quote is ready and waiting for you. Tap here to view it: ${link}`,

    QUOTE_VIEWED_FOLLOWUP: (name: string) =>
        `Hi ${name}! Just checking in - did you have any questions about your quote? Happy to chat if anything's unclear.`,

    AWAITING_PAYMENT_NUDGE: (name: string) =>
        `Hi ${name}! Just a quick reminder - your quote is ready for booking. Let us know if you'd like to go ahead!`,

    AWAITING_VIDEO_REMINDER: (name: string) =>
        `Hi ${name}! Just following up - we're still waiting on that video so we can get you a proper quote. No rush, just send it over when you can!`,

    LOST_LEAD_RECOVERY: (name: string, jobType: string) =>
        `Hi ${name}! Still need help with that ${jobType || 'job'}? We'd love to help if you're still looking.`,
};

/**
 * Run automation check for new leads (30 min follow-up)
 */
async function checkNewLeadFollowups(): Promise<AutomationResult[]> {
    const results: AutomationResult[] = [];
    const cutoffTime = new Date(Date.now() - AUTOMATION_TIMING.NEW_LEAD_FOLLOWUP);

    // Find leads in new_lead stage for 30+ minutes without any outbound contact
    const eligibleLeads = await db
        .select()
        .from(leads)
        .where(
            and(
                eq(leads.stage, 'new_lead'),
                lt(leads.createdAt, cutoffTime)
            )
        )
        .limit(10);

    for (const lead of eligibleLeads) {
        try {
            const firstName = lead.customerName.split(' ')[0];
            let jobSummary = lead.jobDescription?.toLowerCase() || 'the work you described';

            // Ensure grammatical flow: "video of [the] leaking tap"
            if (!jobSummary.startsWith('the ') && !jobSummary.startsWith('my ') && !jobSummary.startsWith('our ')) {
                jobSummary = `the ${jobSummary}`;
            }

            // Only send if we have a phone number
            if (lead.phone) {
                // Use approved Twilio Content Template for video request
                const VIDEO_REQUEST_TEMPLATE_SID = process.env.TWILIO_VIDEO_REQUEST_CONTENT_SID || 'HX3ecffe34fcde66b5a64a964a306026f2';

                await sendWhatsAppMessage(lead.phone, '', {
                    contentSid: VIDEO_REQUEST_TEMPLATE_SID,
                    contentVariables: {
                        "1": firstName,      // {{1}} = customer name
                        "2": jobSummary      // {{2}} = video subject
                    }
                });

                // Update stage to awaiting_video
                await updateLeadStage(lead.id, 'awaiting_video' as LeadStage, {
                    reason: 'Video request template sent',
                });

                results.push({
                    type: 'NEW_LEAD_FOLLOWUP',
                    leadId: lead.id,
                    customerName: lead.customerName,
                    action: 'Sent video_request template via WhatsApp API',
                    success: true,
                    timestamp: new Date(),
                });
            }
        } catch (error) {
            results.push({
                type: 'NEW_LEAD_FOLLOWUP',
                leadId: lead.id,
                customerName: lead.customerName,
                action: 'Failed to send WhatsApp template',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date(),
            });
        }
    }

    return results;
}

/**
 * Run automation check for quote sent reminders (12 hours)
 */
async function checkQuoteSentReminders(): Promise<AutomationResult[]> {
    const results: AutomationResult[] = [];
    const cutoffTime = new Date(Date.now() - AUTOMATION_TIMING.QUOTE_SENT_REMINDER);

    // Find quotes sent 12+ hours ago that haven't been viewed
    const eligibleQuotes = await db
        .select({
            quoteId: personalizedQuotes.id,
            shortSlug: personalizedQuotes.shortSlug,
            customerName: personalizedQuotes.customerName,
            phone: personalizedQuotes.phone,
            createdAt: personalizedQuotes.createdAt,
            viewedAt: personalizedQuotes.viewedAt,
            leadId: personalizedQuotes.leadId,
        })
        .from(personalizedQuotes)
        .where(
            and(
                isNull(personalizedQuotes.viewedAt),
                lt(personalizedQuotes.createdAt, cutoffTime),
                isNotNull(personalizedQuotes.phone)
            )
        )
        .limit(10);

    for (const quote of eligibleQuotes) {
        try {
            const firstName = quote.customerName.split(' ')[0];
            const link = `https://v6handy.com/quote-link/${quote.shortSlug}`;
            const message = TEMPLATES.QUOTE_SENT_REMINDER(firstName, link);

            await sendWhatsAppMessage(quote.phone, message);

            results.push({
                type: 'QUOTE_SENT_REMINDER',
                leadId: quote.leadId || quote.quoteId,
                customerName: quote.customerName,
                action: 'Sent quote reminder WhatsApp',
                success: true,
                timestamp: new Date(),
            });
        } catch (error) {
            results.push({
                type: 'QUOTE_SENT_REMINDER',
                leadId: quote.leadId || quote.quoteId,
                customerName: quote.customerName,
                action: 'Failed to send reminder',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date(),
            });
        }
    }

    return results;
}

/**
 * Run automation check for quote viewed follow-ups (24 hours)
 */
async function checkQuoteViewedFollowups(): Promise<AutomationResult[]> {
    const results: AutomationResult[] = [];
    const cutoffTime = new Date(Date.now() - AUTOMATION_TIMING.QUOTE_VIEWED_FOLLOWUP);

    // Find quotes viewed 24+ hours ago without selection
    const eligibleQuotes = await db
        .select({
            quoteId: personalizedQuotes.id,
            customerName: personalizedQuotes.customerName,
            phone: personalizedQuotes.phone,
            viewedAt: personalizedQuotes.viewedAt,
            selectedAt: personalizedQuotes.selectedAt,
            leadId: personalizedQuotes.leadId,
        })
        .from(personalizedQuotes)
        .where(
            and(
                isNotNull(personalizedQuotes.viewedAt),
                isNull(personalizedQuotes.selectedAt),
                lt(personalizedQuotes.viewedAt, cutoffTime),
                isNotNull(personalizedQuotes.phone)
            )
        )
        .limit(10);

    for (const quote of eligibleQuotes) {
        try {
            const firstName = quote.customerName.split(' ')[0];
            const message = TEMPLATES.QUOTE_VIEWED_FOLLOWUP(firstName);

            await sendWhatsAppMessage(quote.phone, message);

            results.push({
                type: 'QUOTE_VIEWED_FOLLOWUP',
                leadId: quote.leadId || quote.quoteId,
                customerName: quote.customerName,
                action: 'Sent follow-up WhatsApp',
                success: true,
                timestamp: new Date(),
            });
        } catch (error) {
            results.push({
                type: 'QUOTE_VIEWED_FOLLOWUP',
                leadId: quote.leadId || quote.quoteId,
                customerName: quote.customerName,
                action: 'Failed to send follow-up',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date(),
            });
        }
    }

    return results;
}

/**
 * Run automation check for awaiting video reminders (24 hours)
 */
async function checkAwaitingVideoReminders(): Promise<AutomationResult[]> {
    const results: AutomationResult[] = [];
    const cutoffTime = new Date(Date.now() - AUTOMATION_TIMING.AWAITING_VIDEO_REMINDER);

    // Find leads in awaiting_video stage for 24+ hours
    const eligibleLeads = await db
        .select()
        .from(leads)
        .where(
            and(
                eq(leads.stage, 'awaiting_video'),
                eq(leads.awaitingVideo, true),
                lt(leads.stageUpdatedAt, cutoffTime)
            )
        )
        .limit(10);

    for (const lead of eligibleLeads) {
        try {
            const firstName = lead.customerName.split(' ')[0];
            const message = TEMPLATES.AWAITING_VIDEO_REMINDER(firstName);

            await sendWhatsAppMessage(lead.phone, message);

            results.push({
                type: 'AWAITING_VIDEO_REMINDER',
                leadId: lead.id,
                customerName: lead.customerName,
                action: 'Sent video reminder WhatsApp',
                success: true,
                timestamp: new Date(),
            });
        } catch (error) {
            results.push({
                type: 'AWAITING_VIDEO_REMINDER',
                leadId: lead.id,
                customerName: lead.customerName,
                action: 'Failed to send video reminder',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date(),
            });
        }
    }

    return results;
}

/**
 * Run automation check for lost lead auto-marking (7 days)
 */
async function checkLostLeadAutoMark(): Promise<AutomationResult[]> {
    const results: AutomationResult[] = [];
    const cutoffTime = new Date(Date.now() - AUTOMATION_TIMING.LOST_LEAD_AUTO_MARK);

    // Find leads stuck in quote_sent or quote_viewed for 7+ days
    const eligibleLeads = await db
        .select()
        .from(leads)
        .where(
            and(
                or(
                    eq(leads.stage, 'quote_sent'),
                    eq(leads.stage, 'quote_viewed'),
                    eq(leads.stage, 'awaiting_video')
                ),
                lt(leads.stageUpdatedAt, cutoffTime)
            )
        )
        .limit(20);

    for (const lead of eligibleLeads) {
        try {
            await updateLeadStage(lead.id, 'lost' as LeadStage, {
                force: true,
                reason: 'No activity for 7 days (auto-marked)',
            });

            results.push({
                type: 'LOST_LEAD_AUTO_MARK',
                leadId: lead.id,
                customerName: lead.customerName,
                action: 'Auto-marked as lost',
                success: true,
                timestamp: new Date(),
            });
        } catch (error) {
            results.push({
                type: 'LOST_LEAD_AUTO_MARK',
                leadId: lead.id,
                customerName: lead.customerName,
                action: 'Failed to mark as lost',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date(),
            });
        }
    }

    return results;
}

/**
 * Run automation check for lost lead recovery (7 days after lost)
 */
async function checkLostLeadRecovery(): Promise<AutomationResult[]> {
    const results: AutomationResult[] = [];
    const cutoffTime = new Date(Date.now() - AUTOMATION_TIMING.LOST_LEAD_RECOVERY);
    const maxCutoff = new Date(Date.now() - AUTOMATION_TIMING.LOST_LEAD_RECOVERY * 2); // Don't recover leads lost > 14 days ago

    // Find leads marked lost 7+ days ago (but less than 14 days)
    const eligibleLeads = await db
        .select()
        .from(leads)
        .where(
            and(
                eq(leads.stage, 'lost'),
                lt(leads.stageUpdatedAt, cutoffTime),
                isNotNull(leads.phone)
            )
        )
        .limit(5);

    for (const lead of eligibleLeads) {
        // Skip if marked lost too long ago
        if (lead.stageUpdatedAt && new Date(lead.stageUpdatedAt) < maxCutoff) {
            continue;
        }

        try {
            const firstName = lead.customerName.split(' ')[0];
            const jobType = lead.jobDescription?.split(' ').slice(0, 3).join(' ') || 'repair';
            const message = TEMPLATES.LOST_LEAD_RECOVERY(firstName, jobType);

            await sendWhatsAppMessage(lead.phone, message);

            results.push({
                type: 'LOST_LEAD_RECOVERY',
                leadId: lead.id,
                customerName: lead.customerName,
                action: 'Sent recovery WhatsApp',
                success: true,
                timestamp: new Date(),
            });
        } catch (error) {
            results.push({
                type: 'LOST_LEAD_RECOVERY',
                leadId: lead.id,
                customerName: lead.customerName,
                action: 'Failed to send recovery',
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date(),
            });
        }
    }

    return results;
}

/**
 * Run all automations - call this periodically (e.g., every 5 minutes via cron)
 */
export async function runAllAutomations(): Promise<{
    total: number;
    successful: number;
    failed: number;
    results: AutomationResult[];
}> {
    console.log('[Automations] Running all automation checks...');

    const allResults: AutomationResult[] = [];

    try {
        // Run all checks in parallel
        const [
            newLeadResults,
            quoteSentResults,
            quoteViewedResults,
            awaitingVideoResults,
            lostMarkResults,
            recoveryResults,
            webFormResults,
        ] = await Promise.all([
            checkNewLeadFollowups(),
            checkQuoteSentReminders(),
            checkQuoteViewedFollowups(),
            checkAwaitingVideoReminders(),
            checkLostLeadAutoMark(),
            checkLostLeadRecovery(),
            checkWebFormFollowups().then(results => results.map(r => ({
                type: 'WEBFORM_CHASE',
                leadId: r.leadId,
                customerName: r.customerName,
                action: r.action === 'ack_sent' ? 'Sent acknowledgment' :
                        r.action === 'followup_sent' ? 'Sent follow-up' :
                        r.action === 'marked_needs_chase' ? 'Marked needs chase' :
                        r.action,
                success: r.action !== 'error',
                error: r.error,
                timestamp: r.timestamp,
            }))),
        ]);

        allResults.push(
            ...newLeadResults,
            ...quoteSentResults,
            ...quoteViewedResults,
            ...awaitingVideoResults,
            ...lostMarkResults,
            ...recoveryResults,
            ...webFormResults
        );
    } catch (error) {
        console.error('[Automations] Error running automations:', error);
    }

    // Log all results
    allResults.forEach(logAutomation);

    const successful = allResults.filter((r) => r.success).length;
    const failed = allResults.filter((r) => !r.success).length;

    console.log(`[Automations] Complete: ${successful} successful, ${failed} failed`);

    return {
        total: allResults.length,
        successful,
        failed,
        results: allResults,
    };
}

/**
 * Create admin task for manual follow-up
 * Used when automated action isn't appropriate but attention is needed
 */
export async function createAdminTask(
    leadId: string,
    taskType: string,
    description: string
): Promise<void> {
    // For now, just log - in future, integrate with a task management system
    console.log(`[AdminTask] ${taskType}: ${description} (Lead: ${leadId})`);

    // Could emit websocket event for real-time admin notification
    // Could create record in an admin_tasks table
    // Could send Slack/email notification
}

/**
 * Schedule the automation runner (call on server startup)
 */
let automationInterval: NodeJS.Timeout | null = null;

export function startAutomationScheduler(intervalMs: number = 5 * 60 * 1000) {
    if (automationInterval) {
        console.log('[Automations] Scheduler already running');
        return;
    }

    console.log(`[Automations] Starting scheduler (every ${intervalMs / 1000}s)`);

    // Run immediately
    runAllAutomations().catch(console.error);

    // Then run on interval
    automationInterval = setInterval(() => {
        runAllAutomations().catch(console.error);
    }, intervalMs);
}

export function stopAutomationScheduler() {
    if (automationInterval) {
        clearInterval(automationInterval);
        automationInterval = null;
        console.log('[Automations] Scheduler stopped');
    }
}
