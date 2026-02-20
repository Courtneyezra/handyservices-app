/**
 * Auto-Video Service
 *
 * Orchestrates automatic video request sending after calls:
 * 1. Analyzes call transcript for video agreement
 * 2. Sends contextual WhatsApp message if confidence is high
 * 3. Updates lead stage to awaiting_video
 * 4. Logs activity for the live stream
 */

import { db } from "../db";
import { leads, calls, conversations, type LeadStage } from "@shared/schema";
import { eq, desc, or } from "drizzle-orm";
import { updateLeadStage } from "../lead-stage-engine";
import { sendWhatsAppMessage } from "../meta-whatsapp";
import { twilioClient } from "../twilio-client";
import {
    analyzeCallForVideoRequest,
    generateVideoRequestMessage,
    shouldAutoSendVideoRequest,
    type VideoAnalysis,
} from "./video-context-extractor";

// Configuration
export interface AutoVideoConfig {
    confidenceThreshold: number; // Minimum confidence to auto-send (default: 80)
    enabled: boolean; // Master toggle
    delayMs: number; // Delay before sending (default: 30000ms = 30s)
    preferredChannel: 'whatsapp' | 'sms' | 'auto'; // Which channel to use
}

const DEFAULT_CONFIG: AutoVideoConfig = {
    confidenceThreshold: 80,
    enabled: true,
    delayMs: 30000, // 30 seconds - allows call wrap-up
    preferredChannel: 'auto', // 'auto' = try WhatsApp first, fall back to SMS
};

/**
 * Check if we're within WhatsApp 24h window for this phone
 */
async function hasWhatsAppWindow(phone: string): Promise<boolean> {
    const cleanPhone = phone.replace(/\D/g, '');
    const phoneNumber = `${cleanPhone}@c.us`;

    const [conv] = await db
        .select({ lastInboundAt: conversations.lastInboundAt })
        .from(conversations)
        .where(eq(conversations.phoneNumber, phoneNumber))
        .limit(1);

    if (!conv?.lastInboundAt) return false;

    const windowMs = 24 * 60 * 60 * 1000; // 24 hours
    const now = Date.now();
    const inboundTime = new Date(conv.lastInboundAt).getTime();

    return (now - inboundTime) < windowMs;
}

/**
 * Send video request via WhatsApp template or SMS fallback
 *
 * WhatsApp requires pre-approved templates for messages outside the 24h window.
 * We use the 'video_request' template with variables:
 * - {{customer_name}} - Customer's first name
 * - {{video_subject}} - What they need to video (e.g., "the leaking tap")
 */
async function sendVideoRequestMessage(
    phone: string,
    customerName: string,
    videoSubject: string,
    fallbackMessage: string,
    preferredChannel: 'whatsapp' | 'sms' | 'auto'
): Promise<{ channel: 'whatsapp' | 'sms'; success: boolean; error?: string }> {
    const cleanPhone = phone.replace(/\D/g, '');

    // Always try WhatsApp first with template (templates work outside 24h window)
    const useWhatsApp = preferredChannel !== 'sms';

    if (useWhatsApp) {
        try {
            // Send using approved Twilio Content Template
            const VIDEO_REQUEST_TEMPLATE_SID = process.env.TWILIO_VIDEO_REQUEST_CONTENT_SID || 'HX3ecffe34fcde66b5a64a964a306026f2';

            await sendWhatsAppMessage(cleanPhone, fallbackMessage, {
                contentSid: VIDEO_REQUEST_TEMPLATE_SID,
                contentVariables: {
                    "1": customerName,
                    "2": videoSubject
                }
            });
            console.log(`[AutoVideo] WhatsApp template sent to ${cleanPhone} (ContentSid: ${VIDEO_REQUEST_TEMPLATE_SID})`);
            return { channel: 'whatsapp', success: true };
        } catch (error) {
            console.error('[AutoVideo] WhatsApp template failed, falling back to SMS:', error);
            // Fall through to SMS
        }
    }

    // Send via SMS (uses plain text message)
    try {
        await twilioClient.messages.create({
            to: `+${cleanPhone}`,
            from: process.env.TWILIO_PHONE_NUMBER,
            body: fallbackMessage,
        });
        return { channel: 'sms', success: true };
    } catch (error) {
        console.error('[AutoVideo] SMS failed:', error);
        return {
            channel: 'sms',
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

// Activity types for live stream
export interface VideoRequestActivity {
    type: "video_requested" | "video_request_skipped";
    timestamp: Date;
    callId: string;
    leadId: string;
    customerName: string;
    customerPhone: string;
    confidence: number;
    videoContext: string;
    reason: string;
}

// Store recent activities for the live stream (in-memory, recent 50)
const recentActivities: VideoRequestActivity[] = [];

/**
 * Get recent video request activities for the live stream
 */
export function getRecentVideoActivities(limit: number = 20): VideoRequestActivity[] {
    return recentActivities.slice(0, limit);
}

/**
 * Add activity to the recent list
 */
function recordActivity(activity: VideoRequestActivity) {
    recentActivities.unshift(activity);
    // Keep only last 50
    if (recentActivities.length > 50) {
        recentActivities.pop();
    }
    console.log(`[AutoVideo] Activity recorded: ${activity.type} for ${activity.customerName}`);
}

/**
 * Process a completed call for automatic video request
 *
 * Called after call ends with transcript available.
 * Analyzes transcript and sends video request if appropriate.
 *
 * @param callId The call ID
 * @param leadId The associated lead ID
 * @param transcript The call transcript
 * @param customerPhone Customer's phone number
 * @param customerName Customer's name
 * @param config Optional configuration overrides
 */
export async function processCallForAutoVideo(
    callId: string,
    leadId: string,
    transcript: string,
    customerPhone: string,
    customerName: string,
    config: Partial<AutoVideoConfig> = {}
): Promise<{ sent: boolean; reason: string; analysis?: VideoAnalysis }> {
    const cfg = { ...DEFAULT_CONFIG, ...config };

    console.log(`[AutoVideo] Processing call ${callId} for lead ${leadId}`);

    // Check if feature is enabled
    if (!cfg.enabled) {
        return { sent: false, reason: "Auto-video feature disabled" };
    }

    // Validate required data
    if (!customerPhone) {
        console.warn(`[AutoVideo] No phone number for call ${callId}`);
        return { sent: false, reason: "No customer phone number" };
    }

    if (!transcript || transcript.length < 50) {
        console.warn(`[AutoVideo] Transcript too short for call ${callId}`);
        return { sent: false, reason: "Transcript too short for analysis" };
    }

    try {
        // Analyze the transcript
        const analysis = await analyzeCallForVideoRequest(transcript);

        // Check if we should auto-send
        if (!shouldAutoSendVideoRequest(analysis, cfg.confidenceThreshold)) {
            console.log(
                `[AutoVideo] Below threshold (${analysis.confidence}% < ${cfg.confidenceThreshold}%) - skipping auto-send`
            );

            // Record as skipped activity
            recordActivity({
                type: "video_request_skipped",
                timestamp: new Date(),
                callId,
                leadId,
                customerName,
                customerPhone,
                confidence: analysis.confidence,
                videoContext: analysis.videoContext,
                reason: `Confidence ${analysis.confidence}% below threshold ${cfg.confidenceThreshold}%`,
            });

            // Update the call record with the analysis for manual review
            await db
                .update(calls)
                .set({
                    metadataJson: {
                        videoAnalysis: analysis,
                        autoVideoSkipped: true,
                        skipReason: `Confidence ${analysis.confidence}% below threshold`,
                    },
                })
                .where(eq(calls.id, callId));

            return {
                sent: false,
                reason: `Confidence ${analysis.confidence}% below threshold ${cfg.confidenceThreshold}%`,
                analysis,
            };
        }

        // Generate the fallback message (used for SMS)
        const fallbackMessage = generateVideoRequestMessage(analysis);

        // Extract first name for template
        const firstName = analysis.customerFirstName || customerName.split(' ')[0] || 'there';

        // Send with delay to allow call wrap-up
        if (cfg.delayMs > 0) {
            console.log(`[AutoVideo] Waiting ${cfg.delayMs}ms before sending...`);
            await new Promise((resolve) => setTimeout(resolve, cfg.delayMs));
        }

        // Send message via WhatsApp template (with SMS fallback)
        const sendResult = await sendVideoRequestMessage(
            customerPhone,
            firstName,
            analysis.videoContext,
            fallbackMessage,
            cfg.preferredChannel
        );

        if (!sendResult.success) {
            console.error(`[AutoVideo] Failed to send via ${sendResult.channel}: ${sendResult.error}`);
            return {
                sent: false,
                reason: `Failed to send message: ${sendResult.error}`,
                analysis,
            };
        }

        console.log(`[AutoVideo] Video request sent to ${customerPhone} via ${sendResult.channel}`);

        // Update lead stage to awaiting_video
        if (leadId) {
            await updateLeadStage(leadId, "awaiting_video" as LeadStage, {
                reason: `Auto video request sent (confidence: ${analysis.confidence}%)`,
            });
        }

        // Update lead's awaitingVideo flag
        await db
            .update(leads)
            .set({
                awaitingVideo: true,
                updatedAt: new Date(),
            })
            .where(eq(leads.id, leadId));

        // Update call record
        await db
            .update(calls)
            .set({
                videoRequestSentAt: new Date(),
                metadataJson: {
                    videoAnalysis: analysis,
                    autoVideoSent: true,
                    templateUsed: sendResult.channel === 'whatsapp' ? 'video_request' : null,
                    templateParams: { customer_name: firstName, video_subject: analysis.videoContext },
                    fallbackMessage,
                    sentVia: sendResult.channel,
                },
            })
            .where(eq(calls.id, callId));

        // Record activity
        recordActivity({
            type: "video_requested",
            timestamp: new Date(),
            callId,
            leadId,
            customerName,
            customerPhone,
            confidence: analysis.confidence,
            videoContext: analysis.videoContext,
            reason: `Auto-sent via ${sendResult.channel}`,
        });

        return {
            sent: true,
            reason: `Video request sent via ${sendResult.channel} (confidence: ${analysis.confidence}%)`,
            analysis,
        };
    } catch (error) {
        console.error(`[AutoVideo] Error processing call ${callId}:`, error);
        return {
            sent: false,
            reason: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        };
    }
}

/**
 * Check for video requests that need follow-up
 * Leads in awaiting_video stage for >24 hours
 */
export async function checkPendingVideoRequests(): Promise<{
    overdue: Array<{ leadId: string; customerName: string; phone: string; hoursWaiting: number }>;
}> {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const overdueLeads = await db
        .select({
            id: leads.id,
            customerName: leads.customerName,
            phone: leads.phone,
            stageUpdatedAt: leads.stageUpdatedAt,
        })
        .from(leads)
        .where(eq(leads.stage, "awaiting_video"));

    const overdue = overdueLeads
        .filter((lead) => {
            if (!lead.stageUpdatedAt) return false;
            return new Date(lead.stageUpdatedAt) < twentyFourHoursAgo;
        })
        .map((lead) => ({
            leadId: lead.id,
            customerName: lead.customerName,
            phone: lead.phone,
            hoursWaiting: Math.floor(
                (Date.now() - new Date(lead.stageUpdatedAt!).getTime()) / (1000 * 60 * 60)
            ),
        }));

    return { overdue };
}

/**
 * Handle video received - update lead stage
 * Called when WhatsApp receives a video/image from a customer
 */
export async function handleVideoReceived(
    customerPhone: string
): Promise<{ updated: boolean; leadId?: string }> {
    // Find lead by phone
    const [lead] = await db
        .select()
        .from(leads)
        .where(eq(leads.phone, customerPhone))
        .orderBy(desc(leads.createdAt))
        .limit(1);

    if (!lead) {
        console.log(`[AutoVideo] No lead found for video from ${customerPhone}`);
        return { updated: false };
    }

    // Only update if in awaiting_video stage
    if (lead.stage !== "awaiting_video") {
        console.log(`[AutoVideo] Lead ${lead.id} not in awaiting_video stage`);
        return { updated: false, leadId: lead.id };
    }

    // Update lead
    await db
        .update(leads)
        .set({
            awaitingVideo: false,
            videoReceivedAt: new Date(),
            updatedAt: new Date(),
        })
        .where(eq(leads.id, lead.id));

    // Progress to next stage (back to contacted, ready for quote)
    await updateLeadStage(lead.id, "contacted" as LeadStage, {
        reason: "Video received from customer",
    });

    console.log(`[AutoVideo] Video received from ${customerPhone}, lead ${lead.id} updated`);

    return { updated: true, leadId: lead.id };
}
