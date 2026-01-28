import express, { type Request, Response } from "express";
import fs from "fs";
import path from "path";
import { db } from "./db";
import { calls, callSkus, leads, productizedServices, updateCallSchema } from "../shared/schema";
import { eq, desc, and, or, like, sql, gte, lte } from "drizzle-orm";
import { z } from "zod";
import crypto from "crypto";
import { storageService } from "./storage";
import { twilioClient } from "./twilio-client";

const router = express.Router();

// Helper function to calculate total price from callSkus
async function calculateTotalPrice(callId: string): Promise<number> {
    const skus = await db.select().from(callSkus).where(eq(callSkus.callId, callId));
    return skus.reduce((total, sku) => total + (sku.pricePence * sku.quantity), 0);
}

// GET /api/calls/actions - Fetch required actions for the contractor
router.get("/actions", async (req: Request, res: Response) => {
    try {
        // TODO: Implement actual action logic (e.g., missed calls, high priority items)
        // For now, return an empty list or mock data to prevent 404
        const actions: any[] = [];
        res.json(actions);
    } catch (error) {
        console.error("Error fetching call actions:", error);
        res.status(500).json({ error: "Failed to fetch actions" });
    }
});

// GET /api/calls/active - Fetch any in-progress calls with live analysis (for reconnecting clients)
router.get("/active", async (req: Request, res: Response) => {
    try {
        const activeCalls = await db.select()
            .from(calls)
            .where(eq(calls.status, 'in-progress'))
            .orderBy(desc(calls.startTime))
            .limit(1);

        if (activeCalls.length === 0) {
            return res.json({ activeCall: null });
        }

        const activeCall = activeCalls[0];

        // Safeguard: Check if the call is stale (older than 2 hours)
        const now = new Date();
        const callStartTime = new Date(activeCall.startTime);
        const diffHours = (now.getTime() - callStartTime.getTime()) / (1000 * 60 * 60);

        if (diffHours > 2) {
            console.log(`[Auto-Cleanup] Call ${activeCall.id} is stale (>2 hours). Updating to failed.`);

            await db.update(calls)
                .set({
                    status: 'failed',
                    outcome: 'technical_issue',
                    endTime: new Date()
                })
                .where(eq(calls.id, activeCall.id));

            return res.json({ activeCall: null });
        }

        // Return the most recent active call with all analysis data
        res.json({ activeCall });
    } catch (error) {
        console.error("Error fetching active call:", error);
        res.status(500).json({ error: "Failed to fetch active call" });
    }
});

// GET /api/calls - List all calls with filtering and pagination
router.get("/", async (req: Request, res: Response) => {
    try {
        const {
            page = "1",
            limit = "25",
            startDate,
            endDate,
            hasSkus,
            outcome,
            search
        } = req.query;

        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);
        const offset = (pageNum - 1) * limitNum;

        // Build where conditions
        const conditions = [];

        if (startDate) {
            conditions.push(gte(calls.startTime, new Date(startDate as string)));
        }

        if (endDate) {
            conditions.push(lte(calls.startTime, new Date(endDate as string)));
        }

        if (outcome) {
            conditions.push(eq(calls.outcome, outcome as string));
        }

        if (search) {
            const searchTerm = `%${search}%`;
            conditions.push(
                or(
                    like(calls.customerName, searchTerm),
                    like(calls.phoneNumber, searchTerm),
                    like(calls.address, searchTerm)
                )
            );
        }

        // Query calls
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

        const [callsList, totalCount] = await Promise.all([
            db.select({
                call: calls,
                elevenLabsRecordingUrl: leads.elevenLabsRecordingUrl
            })
                .from(calls)
                .leftJoin(leads, eq(calls.leadId, leads.id))
                .where(whereClause)
                .orderBy(desc(calls.startTime))
                .limit(limitNum)
                .offset(offset),
            db.select({ count: sql<number>`count(*)` })
                .from(calls)
                .where(whereClause)
                .then(result => Number(result[0]?.count || 0))
        ]);

        // If hasSkus filter is set, filter by calls that have SKUs
        let filteredCalls = callsList;
        if (hasSkus === "true") {
            const callsWithSkus = await db.select({ callId: callSkus.callId })
                .from(callSkus)
                .groupBy(callSkus.callId);

            const callIdsWithSkus = new Set(callsWithSkus.map(c => c.callId));
            filteredCalls = callsList.filter(row => callIdsWithSkus.has(row.call.id));
        }

        // Get SKU counts for each call
        const callIds = filteredCalls.map(row => row.call.id);
        const skuCounts = callIds.length > 0
            ? await db.select({
                callId: callSkus.callId,
                count: sql<number>`count(*)`
            })
                .from(callSkus)
                .where(sql`${callSkus.callId} IN ${callIds}`)
                .groupBy(callSkus.callId)
            : [];

        const skuCountMap = new Map(skuCounts.map(sc => [sc.callId, Number(sc.count)]));

        // Format response
        const formattedCalls = filteredCalls.map(({ call, elevenLabsRecordingUrl }) => {
            const finalRecordingUrl = call.recordingUrl || elevenLabsRecordingUrl;

            // Debug log for recording URLs (can be removed later)
            if (finalRecordingUrl) {
                console.log(`[CallsAPI] Found recording for call ${call.id}: ${finalRecordingUrl.substring(0, 50)}...`);
            } else {
                console.log(`[CallsAPI] No recording found for call ${call.id} (leadId: ${call.leadId || 'none'})`);
            }

            return {
                id: call.id,
                callId: call.callId,
                customerName: call.customerName || "Unknown",
                phoneNumber: call.phoneNumber,
                address: call.address,
                startTime: call.startTime,
                jobSummary: call.jobSummary,
                skuCount: skuCountMap.get(call.id) || 0,
                totalPricePence: call.totalPricePence || 0,
                outcome: call.outcome,
                urgency: call.urgency,
                status: call.status,
                metadataJson: call.metadataJson,
                missedReason: call.missedReason,
                recordingUrl: finalRecordingUrl,
                transcription: call.transcription,
                // Expose full AI context for frontend "Smart Actions"
                detectedSkusJson: call.detectedSkusJson,
                metadataJson: call.metadataJson || call.detectedSkusJson, // Fallback mapping for frontend compatibility
            };
        });

        res.json({
            calls: formattedCalls,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limitNum)
            }
        });
    } catch (error) {
        console.error("Error fetching calls:", error);
        res.status(500).json({ error: "Failed to fetch calls" });
    }
});

// GET /api/calls/:id - Get detailed call information
router.get("/:id", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Get call details
        const [call] = await db.select().from(calls).where(eq(calls.id, id));

        if (!call) {
            return res.status(404).json({ error: "Call not found" });
        }

        // Get associated SKUs with full service details
        const skus = await db.select({
            id: callSkus.id,
            callId: callSkus.callId,
            quantity: callSkus.quantity,
            pricePence: callSkus.pricePence,
            source: callSkus.source,
            confidence: callSkus.confidence,
            detectionMethod: callSkus.detectionMethod,
            addedBy: callSkus.addedBy,
            addedAt: callSkus.addedAt,
            updatedAt: callSkus.updatedAt,
            sku: {
                id: productizedServices.id,
                skuCode: productizedServices.skuCode,
                name: productizedServices.name,
                description: productizedServices.description,
                category: productizedServices.category,
                pricePence: productizedServices.pricePence,
            }
        })
            .from(callSkus)
            .leftJoin(productizedServices, eq(callSkus.skuId, productizedServices.id))
            .where(eq(callSkus.callId, id));

        // Separate detected and manual SKUs
        const detectedSkus = skus.filter(s => s.source === 'detected');
        const manualSkus = skus.filter(s => s.source === 'manual');

        res.json({
            ...call,
            detectedSkus,
            manualSkus,
            allSkus: skus,
        });
    } catch (error) {
        console.error("Error fetching call details:", error);
        res.status(500).json({ error: "Failed to fetch call details" });
    }
});

// POST /api/calls/:id/skus - Add SKU to call
router.post("/:id/skus", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { skuId, quantity = 1 } = req.body;

        if (!skuId) {
            return res.status(400).json({ error: "skuId is required" });
        }

        // Verify call exists
        const [call] = await db.select().from(calls).where(eq(calls.id, id));
        if (!call) {
            return res.status(404).json({ error: "Call not found" });
        }

        // Get SKU details
        const [sku] = await db.select().from(productizedServices).where(eq(productizedServices.id, skuId));
        if (!sku) {
            return res.status(404).json({ error: "SKU not found" });
        }

        // Create call SKU entry
        const callSkuId = crypto.randomBytes(16).toString("hex");
        await db.insert(callSkus).values({
            id: callSkuId,
            callId: id,
            skuId: skuId,
            quantity: quantity,
            pricePence: sku.pricePence,
            source: 'manual',
            addedBy: 'system', // TODO: Get from session when auth is implemented
        });

        // Recalculate total price
        const totalPrice = await calculateTotalPrice(id);
        await db.update(calls)
            .set({
                totalPricePence: totalPrice,
                lastEditedBy: 'system',
                lastEditedAt: new Date()
            })
            .where(eq(calls.id, id));

        // Return updated call
        const [updatedCall] = await db.select().from(calls).where(eq(calls.id, id));

        res.json(updatedCall);
    } catch (error) {
        console.error("Error adding SKU to call:", error);
        res.status(500).json({ error: "Failed to add SKU to call" });
    }
});

// PATCH /api/calls/:id/skus/:skuId - Update SKU quantity
router.patch("/:id/skus/:skuId", async (req: Request, res: Response) => {
    try {
        const { id, skuId } = req.params;
        const { quantity } = req.body;

        if (quantity === undefined || quantity < 1) {
            return res.status(400).json({ error: "Valid quantity is required" });
        }

        // Update SKU quantity
        await db.update(callSkus)
            .set({
                quantity,
                updatedAt: new Date()
            })
            .where(and(
                eq(callSkus.callId, id),
                eq(callSkus.id, skuId)
            ));

        // Recalculate total price
        const totalPrice = await calculateTotalPrice(id);
        await db.update(calls)
            .set({
                totalPricePence: totalPrice,
                lastEditedBy: (req as any).user?.id || 'system',
                lastEditedAt: new Date()
            })
            .where(eq(calls.id, id));

        // Return updated call
        const [updatedCall] = await db.select().from(calls).where(eq(calls.id, id));

        res.json(updatedCall);
    } catch (error) {
        console.error("Error updating SKU quantity:", error);
        res.status(500).json({ error: "Failed to update SKU quantity" });
    }
});

// DELETE /api/calls/:id/skus/:skuId - Remove SKU from call
router.delete("/:id/skus/:skuId", async (req: Request, res: Response) => {
    try {
        const { id, skuId } = req.params;

        // Delete SKU
        await db.delete(callSkus)
            .where(and(
                eq(callSkus.callId, id),
                eq(callSkus.id, skuId)
            ));

        // Recalculate total price
        const totalPrice = await calculateTotalPrice(id);
        await db.update(calls)
            .set({
                totalPricePence: totalPrice,
                lastEditedBy: (req as any).user?.id || 'system',
                lastEditedAt: new Date()
            })
            .where(eq(calls.id, id));

        // Return updated call
        const [updatedCall] = await db.select().from(calls).where(eq(calls.id, id));

        res.json(updatedCall);
    } catch (error) {
        console.error("Error removing SKU from call:", error);
        res.status(500).json({ error: "Failed to remove SKU from call" });
    }
});

// PATCH /api/calls/:id - Update call metadata
router.patch("/:id", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Validate request body
        const validatedData = updateCallSchema.parse(req.body);

        // Update call
        await db.update(calls)
            .set({
                ...validatedData,
                lastEditedBy: 'system',
                lastEditedAt: new Date()
            })
            .where(eq(calls.id, id));

        // Return updated call
        const [updatedCall] = await db.select().from(calls).where(eq(calls.id, id));

        if (!updatedCall) {
            return res.status(404).json({ error: "Call not found" });
        }

        res.json(updatedCall);
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: "Invalid request data", details: error.errors });
        }
        console.error("Error updating call:", error);
        res.status(500).json({ error: "Failed to update call" });
    }
});

// GET /api/calls/:id/recording - Proxy Twilio recording with authentication
router.get("/:id/recording", async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Get call details to find recording URL
        const [result] = await db.select({
            call: calls,
            lead: leads
        })
            .from(calls)
            .leftJoin(leads, eq(calls.leadId, leads.id))
            .where(eq(calls.id, id));

        if (!result || !result.call) {
            return res.status(404).json({ error: "Call not found" });
        }

        const { call, lead } = result;

        const targetUrl = call.recordingUrl || lead?.elevenLabsRecordingUrl;

        if (!targetUrl) {
            return res.status(404).json({ error: "No recording available for this call" });
        }

        // --- NEW: S3 Presigned URL + RAW File Handling ---
        const signedUrl = await storageService.getSignedRecordingUrl(targetUrl);
        const isRaw = targetUrl.endsWith('.raw');
        const isRemote = signedUrl.startsWith('http');

        if (isRemote) {
            // If it's a RAW file (Twilio stream), we MUST wrap it in a WAV container
            if (isRaw) {
                try {
                    const response = await fetch(signedUrl);
                    if (!response.ok) {
                        if (response.status === 404) {
                            console.warn(`[CallsAPI] Recording not found in S3: ${signedUrl}. Checking Twilio fallback...`);

                            // Fallback: Check Twilio API
                            try {
                                const recordings = await twilioClient.recordings.list({ callSid: call.callId, limit: 1 });
                                if (recordings.length > 0) {
                                    const twilioRec = recordings[0];
                                    // Fetch mp3/wav from Twilio using credentials
                                    const mediaUrl = `https://api.twilio.com${twilioRec.uri.replace('.json', '.wav')}`;
                                    console.log(`[CallsAPI] Found Twilio backup: ${mediaUrl}`);

                                    const twilioRes = await fetch(mediaUrl); // twitch-client lib usually handles auth? No, this is manual fetch
                                    // Wait, better to use the client request or manually construct auth header
                                    // simple fetch with Basic Auth
                                    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
                                    const twilioFetch = await fetch(mediaUrl, {
                                        headers: { 'Authorization': `Basic ${auth}` }
                                    });

                                    if (twilioFetch.ok) {
                                        const buffer = Buffer.from(await twilioFetch.arrayBuffer());
                                        res.setHeader('Content-Type', 'audio/wav');
                                        res.send(buffer);
                                        return;
                                    }
                                }
                            } catch (twilioErr) {
                                console.error("[CallsAPI] Twilio fallback failed:", twilioErr);
                            }

                            return res.status(404).json({ error: "Recording not available in S3 or Twilio" });
                        }
                        throw new Error(`Fetch failed: ${response.status}`);
                    }

                    const arrayBuffer = await response.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const header = createWavHeader(buffer.length);

                    res.setHeader('Content-Type', 'audio/wav');
                    res.send(Buffer.concat([header, buffer]));
                    return;
                } catch (error) {
                    console.error("Error proxying raw S3 audio:", error);
                    return res.status(500).json({ error: "Failed to fetch recording" });
                }
            }

            // Normal S3 file (mp3/wav) -> Redirect
            if (!targetUrl.includes('twilio.com')) {
                return res.redirect(signedUrl);
            }
        }

        // Local File Handling
        if (!targetUrl.startsWith('http')) {
            const absolutePath = path.resolve(process.cwd(), targetUrl);

            // Security check: ensure it's within storage directory
            if (!absolutePath.includes('storage/recordings')) {
                return res.status(403).json({ error: "Access denied" });
            }

            if (fs.existsSync(absolutePath)) {
                if (isRaw) {
                    const buffer = fs.readFileSync(absolutePath);
                    const header = createWavHeader(buffer.length);
                    res.setHeader('Content-Type', 'audio/wav');
                    res.send(Buffer.concat([header, buffer]));
                    return;
                }
                return res.sendFile(absolutePath);
            } else {
                console.warn(`[CallsAPI] Local file missing: ${absolutePath}. Checking Twilio fallback...`);
                try {
                    const recordings = await twilioClient.recordings.list({ callSid: call.callId, limit: 1 });
                    if (recordings.length > 0) {
                        const twilioRec = recordings[0];
                        const mediaUrl = `https://api.twilio.com${twilioRec.uri.replace('.json', '.wav')}`;
                        console.log(`[CallsAPI] Found Twilio backup: ${mediaUrl}`);

                        const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
                        const twilioFetch = await fetch(mediaUrl, {
                            headers: { 'Authorization': `Basic ${auth}` }
                        });

                        if (twilioFetch.ok) {
                            const buffer = Buffer.from(await twilioFetch.arrayBuffer());
                            res.setHeader('Content-Type', 'audio/wav');
                            res.send(buffer);
                            return;
                        }
                    }
                } catch (twilioErr) {
                    console.error("[CallsAPI] Twilio fallback failed:", twilioErr);
                }
                return res.status(404).send("File not found");
            }
        }

        // Check if it is a Twilio URL
        const isTwilio = targetUrl.includes('twilio.com');

        if (!isTwilio) {
            // For ElevenLabs or other external URLs, stream directly

            const headers: HeadersInit = {};

            // Should we add API Key?
            // If it is an Eleven Labs API URL for audio, we definitely need the key.
            if (targetUrl.includes('api.elevenlabs.io')) {
                const { elevenLabsApiKey } = await import("./settings").then(m => m.getTwilioSettings());
                if (elevenLabsApiKey) {
                    headers['xi-api-key'] = elevenLabsApiKey;
                }
            }

            const response = await fetch(targetUrl, { headers });

            if (!response.ok) {
                console.error(`External recording fetch failed: ${response.status}`);
                return res.status(response.status).json({ error: "Failed to fetch recording" });
            }

            res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
            res.setHeader('Content-Length', response.headers.get('content-length') || '');
            res.setHeader('Accept-Ranges', 'bytes');

            const arrayBuffer = await response.arrayBuffer();
            return res.send(Buffer.from(arrayBuffer));
        }

        // Fetch recording from Twilio with Basic Auth
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;

        if (!accountSid || !authToken) {
            return res.status(500).json({ error: "Twilio credentials not configured" });
        }

        const response = await fetch(targetUrl, {
            headers: {
                Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64')
            }
        });

        if (!response.ok) {
            console.error(`Twilio recording fetch failed: ${response.status}`);
            return res.status(response.status).json({ error: "Failed to fetch recording from Twilio" });
        }

        // Stream the audio back to the client
        res.setHeader('Content-Type', response.headers.get('content-type') || 'audio/mpeg');
        res.setHeader('Content-Length', response.headers.get('content-length') || '');
        res.setHeader('Accept-Ranges', 'bytes');

        const arrayBuffer = await response.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));

    } catch (error) {
        console.error("Error proxying recording:", error);
        res.status(500).json({ error: "Failed to proxy recording" });
    }
});

export default router;

function createWavHeader(dataLength: number) {
    const buffer = Buffer.alloc(44);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataLength, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(7, 20); // Mu-law
    buffer.writeUInt16LE(1, 22); // Channels
    buffer.writeUInt32LE(8000, 24); // Sample Rate
    buffer.writeUInt32LE(8000, 28); // Byte Rate
    buffer.writeUInt16LE(1, 32); // Block Align
    buffer.writeUInt16LE(8, 34); // Bits per sample
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataLength, 40);
    return buffer;
}

