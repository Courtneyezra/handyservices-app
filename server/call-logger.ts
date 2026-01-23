import { db } from "./db";
import { calls, callSkus, type InsertCall } from "../shared/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";
import { broadcastToClients } from "./index";
import { extractJobSummary } from "./openai";

/**
 * Helper module for call logging operations
 * Used by Twilio webhooks and real-time call handlers
 */

export interface CallSkuData {
    skuId: string;
    quantity: number;
    pricePence: number;
    confidence?: number;
    detectionMethod?: string;
}

export interface CreateCallData {
    callId: string; // Twilio CallSid
    phoneNumber: string;
    direction: string;
    status: string;
    customerName?: string;
    address?: string;
    postcode?: string;
    urgency?: string;
    leadType?: string;
}

export interface UpdateCallData {
    transcription?: string;
    segments?: any[];
    duration?: number;
    endTime?: Date;
    outcome?: string;
    recordingUrl?: string;
    customerName?: string;
    email?: string;
    address?: string;
    postcode?: string;
    urgency?: string;
    leadType?: string;
    notes?: string;
    jobSummary?: string;
    elevenLabsConversationId?: string;
    liveAnalysisJson?: any;  // Real-time analysis state for reconnecting clients
    metadataJson?: any;      // Real-time metadata (customer name, address, etc.)
    localRecordingPath?: string;
    status?: string;

    actionStatus?: string;
    actionUrgency?: number;
    missedReason?: string;
    tags?: string[];
    leadId?: string;
}

/**
 * Create a new call record in the database
 */
export async function createCall(data: CreateCallData): Promise<string> {
    const callRecordId = crypto.randomBytes(16).toString("hex");

    await db.insert(calls).values({
        id: callRecordId,
        callId: data.callId,
        phoneNumber: data.phoneNumber,
        direction: data.direction,
        status: data.status,
        customerName: data.customerName,
        address: data.address,
        postcode: data.postcode,
        urgency: data.urgency || 'Standard',
        leadType: data.leadType || 'Unknown',
        startTime: new Date(),
    });

    // Broadcast to connected clients
    broadcastToClients({
        type: 'call:created',
        data: {
            id: callRecordId,
            callId: data.callId,
            phoneNumber: data.phoneNumber,
            customerName: data.customerName,
            startTime: new Date(),
        }
    });

    console.log(`[CallLogger] Created call record ${callRecordId} for Twilio CallSid ${data.callId}`);

    return callRecordId;
}

/**
 * Update an existing call record
 */
export async function updateCall(callRecordId: string, data: UpdateCallData): Promise<void> {
    // Filter out undefined values
    const dataToUpdate = Object.fromEntries(
        Object.entries({
            ...data,
            lastEditedAt: new Date(),
        }).filter(([_, v]) => v !== undefined)
    );

    await db.update(calls)
        .set(dataToUpdate)
        .where(eq(calls.id, callRecordId));

    // Broadcast to connected clients
    broadcastToClients({
        type: 'call:updated',
        data: {
            id: callRecordId,
            ...data,
        }
    });

    console.log(`[CallLogger] Updated call record ${callRecordId}`);
}



/**
 * Add detected SKUs to a call
 */
export async function addDetectedSkus(callRecordId: string, skus: CallSkuData[]): Promise<void> {
    if (skus.length === 0) return;

    const skuRecords = skus.map(sku => ({
        id: crypto.randomBytes(16).toString("hex"),
        callId: callRecordId,
        skuId: sku.skuId,
        quantity: sku.quantity,
        pricePence: sku.pricePence,
        source: 'detected' as const,
        confidence: sku.confidence,
        detectionMethod: sku.detectionMethod,
    }));

    await db.insert(callSkus).values(skuRecords);

    // Recalculate total price
    const totalPrice = await calculateTotalPrice(callRecordId);
    await db.update(calls)
        .set({
            totalPricePence: totalPrice,
            lastEditedAt: new Date()
        })
        .where(eq(calls.id, callRecordId));

    // Broadcast to connected clients
    broadcastToClients({
        type: 'call:skus_detected',
        data: {
            callId: callRecordId,
            skus: skuRecords,
            totalPricePence: totalPrice,
        }
    });

    console.log(`[CallLogger] Added ${skus.length} detected SKUs to call ${callRecordId}`);
}

/**
 * Calculate total price from all SKUs for a call
 */
async function calculateTotalPrice(callRecordId: string): Promise<number> {
    const skus = await db.select().from(callSkus).where(eq(callSkus.callId, callRecordId));
    return skus.reduce((total, sku) => total + (sku.pricePence * sku.quantity), 0);
}

/**
 * Finalize a call when it ends
 */
export async function finalizeCall(
    callRecordId: string,
    data: {
        duration?: number;
        endTime?: Date;
        recordingUrl?: string;
        outcome?: string;
        transcription?: string;
        segments?: any[];
        localRecordingPath?: string;
    }
): Promise<void> {

    // Extract job summary if transcription is available
    let jobSummary: string | undefined;
    if (data.transcription) {
        jobSummary = await extractJobSummary(data.transcription);
    }

    // Filter out undefined values to prevent overwriting existing data with NULL
    const dataToUpdate = Object.fromEntries(
        Object.entries({
            duration: data.duration,
            endTime: data.endTime || new Date(),
            recordingUrl: data.recordingUrl,
            outcome: data.outcome,
            transcription: data.transcription,
            jobSummary: jobSummary,
            segments: data.segments,
            status: 'completed',
            localRecordingPath: data.localRecordingPath,
            lastEditedAt: new Date(),
        }).filter(([_, v]) => v !== undefined)
    );

    await db.update(calls)
        .set(dataToUpdate)
        .where(eq(calls.id, callRecordId));

    // Broadcast to connected clients
    broadcastToClients({
        type: 'call:ended',
        data: {
            id: callRecordId,
            duration: data.duration,
            outcome: data.outcome,
        }
    });

    console.log(`[CallLogger] Finalized call record ${callRecordId}`);

    // --- AGENTIC WORKFLOW: ONE-CLICK ACTION ---
    if (data.transcription && data.transcription.length > 50) {
        // Run analysis in background so we don't block the response
        (async () => {
            try {
                const { analyzeLeadActionPlan } = await import("./services/agentic-service");
                // 1. Fetch Call Record to get Customer Name
                const [call] = await db.select().from(calls).where(eq(calls.id, callRecordId));

                if (call) {
                    // 2. Run Analysis (now with Customer Name)
                    console.log(`[Agent-Reflexion] Analyzing transcript for call ${callRecordId} (Customer: ${call.customerName})...`);
                    const plan = await analyzeLeadActionPlan(data.transcription!, call.customerName || undefined);
                    console.log(`[Agent-Reflexion] Generated Plan:`, JSON.stringify(plan, null, 2));

                    const { conversations } = await import("../shared/schema");

                    // Normalize phone (remove + if present, ensure @c.us if needed by schema, 
                    // but schema says "447..." format usually. Let's match existing pattern in meta-whatsapp)
                    // Actually call.phoneNumber is usually like +44...
                    // conversation.phoneNumber is usually 44...@c.us or just number?
                    // Let's rely on a fuzzy match or strict if we know format.
                    // For now, let's try to find it.

                    // Helper to format phone for WhatsApp ID
                    const formatPhoneForWa = (p: string) => p.replace('+', '') + '@c.us';
                    const waId = formatPhoneForWa(call.phoneNumber);

                    // Check if conversation exists
                    let [conv] = await db.select().from(conversations).where(eq(conversations.phoneNumber, waId));

                    if (conv) {
                        await db.update(conversations)
                            .set({
                                metadata: plan as any,
                                lastMessagePreview: `[Agent Plan] ${plan.recommendedAction}: ${plan.draftReply.substring(0, 30)}...`
                            })
                            .where(eq(conversations.id, conv.id));
                    } else {
                        // Create phantom conversation for the Agent Plan to live in the Inbox
                        try {
                            await db.insert(conversations).values({
                                id: crypto.randomBytes(16).toString("hex"),
                                phoneNumber: waId,
                                contactName: call.customerName || "Unknown Caller",
                                status: 'active',
                                unreadCount: 0,
                                lastMessageAt: new Date(),
                                lastMessagePreview: `[Agent Plan] ${plan.recommendedAction}`,
                                metadata: plan as any,
                                // Metadata for timeline
                                stage: 'new',
                                priority: plan.urgency === 'critical' ? 'urgent' : plan.urgency === 'high' ? 'high' : 'normal'
                            });
                            console.log(`[Agent-Reflexion] Created new conversation for ${waId}`);
                        } catch (e) {
                            console.error("Failed to create conversation:", e);
                        }
                    }

                    // 2. Store in Call Metadata (Snapshotted for this specific call)
                    await db.update(calls)
                        .set({
                            metadataJson: { ...call.metadataJson as object, agentPlan: plan },
                            actionStatus: 'pending', // Flag for UI to show "Action Needed"
                            actionUrgency: plan.urgency === 'critical' ? 1 : plan.urgency === 'high' ? 2 : 3
                        })
                        .where(eq(calls.id, callRecordId));

                    console.log(`[Agent-Reflexion] Plan saved to Conversation and Call ${callRecordId}`);
                }
            } catch (err) {
                console.error(`[Agent-Reflexion] Failed to analyze call:`, err);
            }
        })();
    }
}

/**
 * Find call by Twilio CallSid
 */
export async function findCallByTwilioSid(twilioCallSid: string): Promise<string | null> {
    const [call] = await db.select({ id: calls.id })
        .from(calls)
        .where(eq(calls.callId, twilioCallSid))
        .limit(1);

    return call?.id || null;
}
