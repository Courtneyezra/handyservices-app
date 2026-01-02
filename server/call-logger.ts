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
    liveAnalysisJson?: any;  // Real-time analysis state for reconnecting clients
    metadataJson?: any;      // Real-time metadata (customer name, address, etc.)
    localRecordingPath?: string;
    status?: string;
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
    await db.update(calls)
        .set({
            ...data,
            lastEditedAt: new Date(),
        })
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

    await db.update(calls)
        .set({
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
        })
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
