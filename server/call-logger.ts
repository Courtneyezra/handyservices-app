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

    // VA performance tracking (call dashboard)
    ringSeconds?: number;       // time-to-answer in seconds (derived in dial-status webhook)
    handledBy?: string;         // 'va' | 'ai_agent' | 'missed' | 'voicemail'
    handledByUserId?: string;   // user id when handledBy = 'va'
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

    // Put the call on the comms board straight away, while it is still ringing. Roughly 4% of call
    // records never reach finalizeCall (no status callback ever arrives, so they sit at 'ringing'
    // forever) and those are exactly the ones nobody answered. Waiting for finalization would hide
    // the most urgent cards. The row is rewritten on finalization with the real outcome; no ack
    // fires here because we do not yet know whether anyone picked up.
    //
    // Fire-and-forget on purpose: the caller of this function is the Twilio voice webhook, and
    // every millisecond spent here is a millisecond of silence before the phone rings. Board
    // bookkeeping must never sit between a customer and a dial tone.
    if (data.direction === 'inbound') {
        void (async () => {
            const { ingestCallIntoThread } = await import('./call-thread');
            const res = await ingestCallIntoThread(callRecordId, { markUnread: true });
            if (res.status !== 'skipped') {
                console.log(`[CallLogger] Call ${callRecordId} on the board (${res.reason}${res.conversationCreated ? ', new conversation' : ''})`);
            }
        })().catch((e: any) => console.warn('[CallLogger] Could not add call to comms thread:', e?.message ?? e));
    }

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
        inboundRecordingUrl?: string;  // Caller audio
        outboundRecordingUrl?: string; // Agent audio
        detectedSkusJson?: any;        // AI-detected SKUs
    }
): Promise<void> {

    // Extract job summary if transcription is available
    let jobSummary: string | undefined;
    if (data.transcription) {
        jobSummary = await extractJobSummary(data.transcription);
    }

    // On a call BEN DIALLED, the dial-status webhook has already written the truth and this
    // function is about to overwrite it with something worse.
    //
    // finalizeCall is driven by the media stream, which starts with the TwiML (before the dial) and
    // stops when the call ends, so its `duration` is ring time PLUS talk time and its `outcome` is
    // whatever the agentic summariser guessed. /api/twilio/sip-outbound-status, by contrast, gets
    // DialCallDuration — the real talk time, 0 when nobody answered — and records OUTBOUND_ANSWERED
    // or OUTBOUND_NO_ANSWER. It fires first, so without this guard a call that rang for 25 seconds
    // and was never picked up would end up stored as a 25-second call with no record that it went
    // unanswered, and the outbound card gate would open a card for it.
    const [before] = await db.select({ direction: calls.direction, outcome: calls.outcome })
        .from(calls).where(eq(calls.id, callRecordId)).limit(1);
    const dialResultAlreadyRecorded = (before?.direction ?? '').startsWith('out')
        && (before?.outcome ?? '').startsWith('OUTBOUND_');

    // Filter out undefined values to prevent overwriting existing data with NULL
    const dataToUpdate = Object.fromEntries(
        Object.entries({
            duration: dialResultAlreadyRecorded ? undefined : data.duration,
            endTime: data.endTime || new Date(),
            recordingUrl: data.recordingUrl,
            outcome: dialResultAlreadyRecorded ? undefined : data.outcome,
            transcription: data.transcription,
            jobSummary: jobSummary,
            segments: data.segments,
            status: 'completed',
            localRecordingPath: data.localRecordingPath,
            inboundRecordingUrl: data.inboundRecordingUrl,
            outboundRecordingUrl: data.outboundRecordingUrl,
            detectedSkusJson: data.detectedSkusJson,
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

    // --- COMMS BOARD: the call becomes thread activity ---
    //
    // Rewrites the row created at ring time now that duration, outcome and the AI job summary are
    // known, and creates the conversation if the caller never had one. This is what gives a
    // call-only thread its preview, its phone icon, its SLA clock and its place in the Unanswered
    // headline. Awaited (not fire-and-forget) so it lands before the post-call outreach that runs
    // straight after this in the status callback: that path checks "have we ever messaged this
    // person", and the two must not race.
    //
    // Deliberately does NOT touch conversations.lastInboundAt — a call does not open WhatsApp's
    // 24h freeform window. See server/call-thread.ts.
    //
    // outboundOpensCard is set HERE and nowhere else. This is the live, forward-looking path — the
    // one call that just happened — so it is the only place a call Ben made is allowed to start a
    // new thread. The backfill script shares this module's ingest function and must keep the
    // default (off): the owner wants future calls captured, not history rewritten.
    try {
        const { ingestCallIntoThread } = await import('./call-thread');
        const board = await ingestCallIntoThread(callRecordId, {
            markUnread: true,
            ack: true,
            outboundOpensCard: true,
            continuation: true,
        });
        if (board.status !== 'skipped') {
            console.log(`[CallLogger] Call ${callRecordId} thread activity: ${board.reason} "${board.preview}"${board.ack ? ` | ack: ${board.ack.reason}` : ''}`);
        }
    } catch (e: any) {
        console.warn('[CallLogger] Comms thread ingest failed (call still finalized):', e?.message ?? e);
    }

    // Call scoring (opus scorecard) and the agentic one-click plan were removed 24 Aug 2026
    // (Switchboard Atlas step 5): the scorecard was condemned in review and the plan ran on the
    // dead OpenAI account. Post-call intelligence now lives in the recorder's close() chain:
    // batch transcription -> classification -> outreach -> lead upsert (server/call-lead.ts).
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
