import WebSocket, { WebSocketServer } from 'ws';
import { db } from './db';
import { leads } from '../shared/schema';
import { detectWithContext, detectSku, detectMultipleTasks } from './skuDetector';
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import crypto from 'crypto';
import { extractCallMetadata, extractPostcodeOnly } from './openai'; // B7: Metadata extraction
import { validateExtractedAddress, AddressValidation } from './address-validation'; // Address validation
import { findDuplicateLead, updateExistingLead } from './lead-deduplication'; // B9: Duplicate detection
import { normalizePhoneNumber } from './phone-utils'; // B1: Phone normalization
import { createCall, updateCall, addDetectedSkus, finalizeCall } from './call-logger'; // Call logging integration

const deepgram = createClient(process.env.DEEPGRAM_API_KEY || "");

// Active Call Tracking
let activeCallCount = 0;

export function getActiveCallCount() {
    return activeCallCount;
}


export class MediaStreamTranscriber {
    private callSid: string;
    private streamSid: string;
    private ws: WebSocket;
    private dgLive: any;
    private fullTranscript: string = "";
    private isClosed = false;
    private broadcast: (message: any) => void;
    private history: string[] = []; // Live session history

    // B4: Debouncing
    private debounceTimer: NodeJS.Timeout | null = null;
    private readonly DEBOUNCE_MS = 300; // Wait 300ms after last segment

    private metadata: any = {
        customerName: null,
        address: null,
        postcode: null,
        urgency: "Standard",
        leadType: "Unknown",
        addressValidation: null as AddressValidation | null  // Validation result
    };
    private lastMetadataExtraction: number = 0;
    private segmentCount: number = 0;
    private postcodeDetected: boolean = false;

    private phoneNumber: string;
    private callRecordId: string | null = null; // Track database call record ID
    private callStartTime: Date;
    private segments: any[] = []; // Store transcript segments

    constructor(ws: WebSocket, callSid: string, streamSid: string, phoneNumber: string, broadcast: (message: any) => void) {
        this.ws = ws;
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.phoneNumber = phoneNumber;
        this.broadcast = broadcast;
        this.callStartTime = new Date();

        activeCallCount++;

        // Create call record immediately
        this.createCallRecord();
        this.initializeDeepgram();
    }

    private async createCallRecord() {
        try {
            this.callRecordId = await createCall({
                callId: this.callSid,
                phoneNumber: this.phoneNumber,
                direction: "inbound",
                status: "in-progress",
            });
            console.log(`[CallLogger] Created call record ${this.callRecordId} for ${this.callSid}`);
        } catch (e) {
            console.error("[CallLogger] Failed to create call record:", e);
        }
    }

    private initializeDeepgram() {
        console.log(`[Deepgram] Initializing live stream for ${this.callSid}`);

        this.dgLive = deepgram.listen.live({
            model: "nova-2",
            language: "en-GB", // Default to UK English since localized
            smart_format: true,
            interim_results: true,
            utterance_end_ms: parseInt(process.env.DEEPGRAM_UTTERANCE_MS || "1000"),
            vad_events: true,
            encoding: "mulaw",
            sample_rate: 8000,
        });

        this.dgLive.on(LiveTranscriptionEvents.Open, () => {
            console.log(`[Deepgram] Live connection opened for ${this.callSid}`);
            this.broadcast({
                type: 'voice:call_started',
                data: { callSid: this.callSid, phoneNumber: this.phoneNumber }
            });
        });

        this.dgLive.on(LiveTranscriptionEvents.Transcript, (data: any) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (transcript && data.is_final) {
                this.fullTranscript += transcript + " ";
                console.log(`\n[Deepgram] Final Segment: ${transcript}`);

                // IMMEDIATELY broadcast transcript to UI (no debounce for display)
                this.broadcast({
                    type: 'voice:live_segment',
                    data: {
                        callSid: this.callSid,
                        transcript: transcript,
                        isFinal: true
                    }
                });

                // B4: Debounce ONLY the analysis (not the display)
                // This keeps UI responsive while reducing API calls
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }

                this.debounceTimer = setTimeout(() => {
                    console.log('[SKU Detector] Debounce timer fired - analyzing transcript');
                    this.analyzeSegment(this.fullTranscript);
                }, this.DEBOUNCE_MS);
            } else if (transcript) {
                // Interim result
                process.stdout.write(`\r[Deepgram] Interim: ${transcript} `);
                this.broadcast({
                    type: 'voice:live_segment',
                    data: {
                        callSid: this.callSid,
                        transcript: transcript,
                        isFinal: false
                    }
                });
            }
        });

        this.dgLive.on(LiveTranscriptionEvents.Error, (err: any) => {
            console.error(`[Deepgram] Error: `, err);
        });

        this.dgLive.on(LiveTranscriptionEvents.Close, () => {
            console.log(`[Deepgram] Live connection closed for ${this.callSid}`);
        });
    }

    private async analyzeSegment(text: string) {
        try {
            // Update history (keep last 3 turns)
            this.history.push(text);
            if (this.history.length > 3) this.history.shift();

            this.segmentCount++;

            // B7: Extract postcode every 2 segments OR if transcript length > 100 chars
            if (!this.postcodeDetected && (this.segmentCount % 2 === 0 || this.fullTranscript.length > 100)) {
                const postcode = await extractPostcodeOnly(this.fullTranscript);
                if (postcode && !this.metadata.postcode) {
                    this.metadata.postcode = postcode;
                    this.postcodeDetected = true;

                    console.log(`[Postcode] Detected: ${postcode}`);

                    // B7: Broadcast postcode detection to frontend
                    this.broadcast({
                        type: 'voice:postcode_detected',
                        data: {
                            callSid: this.callSid,
                            postcode: postcode
                        }
                    });
                }
            }

            // Extract name and address periodically (every 5 segments OR if transcript > 150 chars)
            // But not more frequently than every 10 seconds to avoid excessive API calls
            const now = Date.now();
            const shouldExtractMetadata = (this.segmentCount % 5 === 0 || this.fullTranscript.length > 150)
                && (now - this.lastMetadataExtraction > 10000);

            if (shouldExtractMetadata) {
                this.lastMetadataExtraction = now;

                try {
                    const liveMetadata = await extractCallMetadata(this.fullTranscript);

                    // Update metadata if new information is found
                    if (liveMetadata.customerName && !this.metadata.customerName) {
                        this.metadata.customerName = liveMetadata.customerName;
                        console.log(`[Metadata] Customer name detected: ${liveMetadata.customerName}`);
                    }

                    if (liveMetadata.address && !this.metadata.address) {
                        this.metadata.address = liveMetadata.address;
                        console.log(`[Metadata] Address detected: ${liveMetadata.address}`);

                        // Validate the extracted address
                        const validation = await validateExtractedAddress(
                            liveMetadata.address,
                            this.metadata.postcode || liveMetadata.postcode
                        );

                        this.metadata.addressValidation = validation;

                        console.log(`[Address Validation] Confidence: ${validation.confidence}%, Validated: ${validation.validated}`);

                        // Broadcast validation result to frontend
                        this.broadcast({
                            type: 'voice:address_validated',
                            data: {
                                callSid: this.callSid,
                                address: liveMetadata.address,
                                validation: validation
                            }
                        });
                    }

                    // Update urgency and lead type (these can change during the call)
                    if (liveMetadata.urgency) {
                        this.metadata.urgency = liveMetadata.urgency;
                    }

                    if (liveMetadata.leadType && liveMetadata.leadType !== 'Unknown') {
                        this.metadata.leadType = liveMetadata.leadType;
                    }
                } catch (e) {
                    console.error('[Metadata] Extraction error during live call:', e);
                }
            }


            // Use multi-task detection for live analysis with FULL transcript to accumulate SKUs
            const multiTaskResult = await detectMultipleTasks(this.fullTranscript);

            // Map to backward-compatible format
            const result = {
                matched: multiTaskResult.hasMatches,
                sku: multiTaskResult.matchedServices[0]?.sku || null,
                confidence: multiTaskResult.matchedServices[0]?.confidence || 0,
                method: 'realtime',
                rationale: multiTaskResult.matchedServices.length > 0
                    ? `Detected ${multiTaskResult.matchedServices.length} service(s)`
                    : "Listening...",
                nextRoute: multiTaskResult.nextRoute,
                suggestedScript: `I can help with ${multiTaskResult.matchedServices.map(s => s.sku.name).join(' and ')}.`,

                // Multi-SKU data for live display
                matchedServices: multiTaskResult.matchedServices,
                unmatchedTasks: multiTaskResult.unmatchedTasks,
                totalMatchedPrice: multiTaskResult.totalMatchedPrice,
                hasMultiple: multiTaskResult.matchedServices.length > 1
            };

            if (result.matched || result.nextRoute !== 'VIDEO_QUOTE') {
                console.log(`\n[Switchboard] Real-time detection: ${result.matchedServices?.length || 0} service(s) - ${result.sku?.name || result.nextRoute} (${result.confidence}%)`);
                this.broadcast({
                    type: 'voice:analysis_update',
                    data: {
                        callSid: this.callSid,
                        analysis: result,
                        metadata: this.metadata  // B7: Include metadata in broadcast
                    }
                });
            }
        } catch (e) {
            console.error("[Switchboard] Segment analysis error:", e);
        }
    }

    handleAudio(payload: string) {
        if (this.isClosed || !this.dgLive) return;

        try {
            const buffer = Buffer.from(payload, 'base64');
            this.dgLive.send(buffer);
        } catch (e) {
            console.error("[Deepgram] Send error:", e);
        }
    }

    async close() {
        if (this.isClosed) return;
        this.isClosed = true;

        activeCallCount--;

        console.log(`[Twilio] Broadcasting call_ended for ${this.callSid}`);

        // IMMEDIATELY broadcast call ended to UI (before any async processing)
        // This ensures the LIVE badge turns off right away
        this.broadcast({
            type: 'voice:call_ended',
            data: {
                callSid: this.callSid,
                phoneNumber: this.phoneNumber,
                finalTranscript: this.fullTranscript.trim(),
                analysis: {
                    matched: false,
                    sku: null,
                    confidence: 0,
                    method: 'realtime',
                    rationale: 'Call ended - processing...',
                    nextRoute: 'UNKNOWN' as const,
                    matchedServices: [],
                    unmatchedTasks: [],
                    totalMatchedPrice: 0,
                    hasMultiple: false
                },
                metadata: this.metadata
            }
        });

        const finalText = this.fullTranscript.trim();
        if (finalText.length > 5) {
            try {
                // Use multi-task detection
                const multiTaskResult = await detectMultipleTasks(finalText);

                // B9: Final metadata extraction
                const finalMetadata = await extractCallMetadata(finalText);

                // Merge with live metadata (prefer final extraction if available)
                const mergedMetadata = {
                    customerName: finalMetadata.customerName || this.metadata.customerName || "Voice Caller",
                    address: finalMetadata.address || this.metadata.address || null,
                    addressRaw: finalMetadata.address || this.metadata.address || null,
                    postcode: finalMetadata.postcode || this.metadata.postcode || null,
                    urgency: finalMetadata.urgency || this.metadata.urgency,
                    leadType: finalMetadata.leadType || this.metadata.leadType,
                    phoneNumber: normalizePhoneNumber(this.phoneNumber) || this.phoneNumber,
                    // addressValidation might be present in this.metadata if real-time validation succeeded
                    addressValidation: this.metadata.addressValidation
                };

                // Map multi-task result to backward-compatible format
                const routing = {
                    matched: multiTaskResult.hasMatches,
                    sku: multiTaskResult.matchedServices[0]?.sku || null,
                    confidence: multiTaskResult.matchedServices[0]?.confidence || 0,
                    nextRoute: multiTaskResult.nextRoute,
                    rationale: multiTaskResult.matchedServices.length > 0
                        ? `Detected ${multiTaskResult.matchedServices.length} service(s)`
                        : "No specific services detected",

                    // Multi-SKU data
                    matchedServices: multiTaskResult.matchedServices,
                    unmatchedTasks: multiTaskResult.unmatchedTasks,
                    totalMatchedPrice: multiTaskResult.totalMatchedPrice,
                    hasMultiple: multiTaskResult.matchedServices.length > 1
                };

                // B9: Check for duplicate lead before creating
                const duplicateCheck = await findDuplicateLead(this.phoneNumber, {
                    customerName: mergedMetadata.customerName,
                    placeId: mergedMetadata.addressValidation?.placeId || null,
                    postcode: mergedMetadata.postcode
                });

                let leadId: string;

                if (duplicateCheck.isDuplicate && duplicateCheck.confidence >= 80) {
                    // Update existing lead instead of creating new one
                    leadId = duplicateCheck.existingLead!.id;

                    console.log(`[Duplicate] Found existing lead ${leadId} (${duplicateCheck.confidence}% confidence: ${duplicateCheck.matchReason})`);

                    await updateExistingLead(leadId, {
                        transcription: finalText,
                        jobDescription: finalText,
                        metadata: mergedMetadata
                    });

                    /* 
                    // B9: Don't broadcast duplicate detection for auto-merges to reduce manual input
                    // The system successfully merged it, so we don't need to bother the user
                    this.broadcast({
                        type: 'voice:duplicate_detected',
                        data: {
                            callSid: this.callSid,
                            existingLeadId: leadId,
                            confidence: duplicateCheck.confidence,
                            matchReason: duplicateCheck.matchReason
                        }
                    });
                    */
                } else {
                    // Create new lead
                    leadId = `lead_voice_${Date.now()}`;

                    await db.insert(leads).values({
                        id: leadId,
                        customerName: mergedMetadata.customerName,
                        phone: mergedMetadata.phoneNumber,
                        source: "voice_monitor",
                        jobDescription: finalText,
                        transcriptJson: routing as any,
                        status: routing.matched ? "ready" : "review",
                        // B5: Enhanced address fields
                        addressRaw: mergedMetadata.addressRaw,
                        addressCanonical: mergedMetadata.addressValidation?.canonicalAddress || null,
                        placeId: mergedMetadata.addressValidation?.placeId || null,
                        postcode: mergedMetadata.postcode, // Normalized
                        coordinates: mergedMetadata.addressValidation?.coordinates || null
                    });

                    console.log(`[Switchboard] Voice lead created: ${leadId} -> ${routing.nextRoute}`);
                }

                // Update call record with comprehensive data
                if (this.callRecordId) {
                    const duration = Math.floor((new Date().getTime() - this.callStartTime.getTime()) / 1000);

                    // Finalize call with all data
                    await finalizeCall(this.callRecordId, {
                        duration,
                        endTime: new Date(),
                        outcome: routing.nextRoute,
                        transcription: finalText,
                        segments: this.segments,
                    });

                    // Update call with customer metadata
                    await updateCall(this.callRecordId, {
                        customerName: mergedMetadata.customerName,
                        address: mergedMetadata.address,
                        postcode: mergedMetadata.postcode,
                        urgency: mergedMetadata.urgency,
                        leadType: mergedMetadata.leadType,
                    });

                    // Add detected SKUs to call record
                    if (multiTaskResult.matchedServices.length > 0) {
                        const skuData = multiTaskResult.matchedServices.map(service => ({
                            skuId: service.sku.id,
                            quantity: service.task.quantity,
                            pricePence: service.sku.pricePence,
                            confidence: service.confidence,
                            detectionMethod: 'gpt',
                        }));

                        await addDetectedSkus(this.callRecordId, skuData);
                    }
                }

                // Broadcast final analysis update (call_ended was already sent immediately)
                this.broadcast({
                    type: 'voice:analysis_update',
                    data: {
                        callSid: this.callSid,
                        analysis: routing,
                        metadata: mergedMetadata,
                        isFinal: true
                    }
                });
            } catch (e) {
                console.error("[Switchboard] Final processing error:", e);
            }
        }
    }
}

export function setupTwilioSocket(wss: WebSocketServer, broadcast: (message: any) => void) {
    wss.on('connection', (ws: WebSocket) => {
        let transcriber: MediaStreamTranscriber | null = null;

        ws.on('message', (message: WebSocket.Data) => {
            try {
                const msg = JSON.parse(message.toString());
                switch (msg.event) {
                    case 'start':
                        console.log(`[Twilio] Stream started: ${msg.start.streamSid} `);
                        const phoneNumber = msg.start.customParameters?.phoneNumber || "Unknown";
                        transcriber = new MediaStreamTranscriber(ws, msg.start.callSid, msg.start.streamSid, phoneNumber, broadcast);
                        break;
                    case 'media':
                        if (transcriber) {
                            transcriber.handleAudio(msg.media.payload);
                        }
                        break;
                    case 'stop':
                        console.log(`[Twilio] Stream stopped`);
                        if (transcriber) {
                            transcriber.close();
                        }
                        break;
                }
            } catch (e) {
                console.error("[Twilio] Message parse error:", e);
            }
        });

        ws.on('close', () => {
            if (transcriber) {
                transcriber.close();
            }
        });
    });
}
