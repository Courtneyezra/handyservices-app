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
import { createCall, updateCall, addDetectedSkus, finalizeCall, findCallByTwilioSid } from './call-logger'; // Call logging integration
import { analyzeCallTranscript } from './services/call-analyzer'; // Call analysis for lead scoring
import {
    classifyJobComplexitySync,
    classifyMultipleJobs,
    getOverallRouteRecommendation,
    type JobComplexityResult,
    type DetectedJobInput,
} from './services/job-complexity-classifier'; // Tiered job complexity classification
import {
    initializeCallScriptForCall,
    handleTranscriptChunk as handleCallScriptTranscript,
    endCallScriptSession,
    getActiveSession,
} from './call-script'; // Call Script Tube Map integration
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { storageService } from './storage';
import { getCallTimingSettings, CallTimingSettings } from './settings';

// WisprFlow imports
import { createWisprFlowClient, WisprFlowClient, TranscriptEvent } from './wisprflow';
import { convertTwilioToWisprFlow } from './audio-converter';

// Determine which transcription service to use
const WISPRFLOW_API_KEY = process.env.WISPRFLOW_API_KEY || "";
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";
const USE_WISPRFLOW = !!WISPRFLOW_API_KEY;

if (USE_WISPRFLOW) {
    console.log(`[Transcription] Using WisprFlow (Key length: ${WISPRFLOW_API_KEY.length}, starts with: ${WISPRFLOW_API_KEY.substring(0, 4)}...)`);
} else if (DEEPGRAM_API_KEY) {
    console.log(`[Transcription] Using Deepgram fallback (Key length: ${DEEPGRAM_API_KEY.length}, starts with: ${DEEPGRAM_API_KEY.substring(0, 4)}...)`);
} else {
    console.warn("[Transcription] Warning: Neither WISPRFLOW_API_KEY nor DEEPGRAM_API_KEY is set");
}

// Initialize Deepgram (fallback)
const deepgram = DEEPGRAM_API_KEY ? createClient(DEEPGRAM_API_KEY) : null;

// Active Call Tracking
let activeCallCount = 0;

export function getActiveCallCount() {
    return activeCallCount;
}

/**
 * Tiered traffic light classification using job-complexity-classifier
 *
 * Tier 1: Instant keyword matching (<50ms) - used for real-time UI
 * Tier 2: LLM classification (<400ms) - used for refined recommendations
 *
 * GREEN = SKU matched (instant price available)
 * AMBER = Needs video/visit for assessment
 * RED = Specialist work, refer out
 */
function getTrafficLightSync(matched: boolean, description: string): {
    trafficLight: 'green' | 'amber' | 'red';
    result: JobComplexityResult;
} {
    const { result } = classifyJobComplexitySync(description, matched);
    return {
        trafficLight: result.trafficLight,
        result,
    };
}

export class MediaStreamTranscriber {
    private callSid: string;
    private streamSid: string;
    private ws: WebSocket;
    private dgLiveInbound: any;  // Deepgram stream for caller audio (fallback)
    private dgLiveOutbound: any; // Deepgram stream for agent audio (fallback)
    // WisprFlow clients for dual-track transcription
    private wisprInbound: WisprFlowClient | null = null;
    private wisprOutbound: WisprFlowClient | null = null;
    private wisprInboundConnected: boolean = false;
    private wisprOutboundConnected: boolean = false;
    private fullTranscript: string = "";
    private isClosed = false;
    private broadcast: (message: any) => void;
    private history: string[] = []; // Live session history

    // B4: Debouncing - configurable via admin settings
    private debounceTimer: NodeJS.Timeout | null = null;
    private debounceMs: number = 300; // Default, will be overridden by settings
    private metadataChunkInterval: number = 5; // Extract metadata every N chunks
    private metadataCharThreshold: number = 150; // Extract metadata when transcript > N chars

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

    // Segment tracking for lead creation
    private detectedSegment: string | null = null;
    private segmentConfidence: number = 0;
    private segmentSignals: string[] = [];
    private vaWasPresent: boolean = false; // Did VA interact with HUD during call?
    private callStartTime: Date;
    private segments: any[] = []; // Store transcript segments
    private recordingPath: string | null = null;
    private recordingStream: fs.WriteStream | null = null;
    // Dual-channel recording: separate streams for inbound (caller) and outbound (agent)
    private inboundRecordingPath: string | null = null;
    private outboundRecordingPath: string | null = null;
    private inboundRecordingStream: fs.WriteStream | null = null;
    private outboundRecordingStream: fs.WriteStream | null = null;
    private skipTranscription: boolean = false; // Flag to skip transcription for Eleven Labs calls

    // Tier 2 job complexity classification debounce
    private tier2DebounceTimer: NodeJS.Timeout | null = null;
    private lastJobClassifications: Map<string, JobComplexityResult> = new Map();

    constructor(ws: WebSocket, callSid: string, streamSid: string, phoneNumber: string, broadcast: (message: any) => void, skipTranscription: boolean = false) {
        this.ws = ws;
        this.callSid = callSid;
        this.streamSid = streamSid;
        this.phoneNumber = phoneNumber;
        this.broadcast = broadcast;
        this.callStartTime = new Date();
        this.skipTranscription = skipTranscription;

        // Setup local recording with dual-channel support
        const recordingDir = path.join(process.cwd(), 'storage/recordings');
        if (!fs.existsSync(recordingDir)) {
            fs.mkdirSync(recordingDir, { recursive: true });
        }
        // Legacy single-channel path (for backwards compatibility)
        this.recordingPath = path.join(recordingDir, `call_${callSid}.raw`);
        this.recordingStream = fs.createWriteStream(this.recordingPath, { flags: 'a' });
        // Dual-channel paths: inbound (caller) and outbound (agent)
        this.inboundRecordingPath = path.join(recordingDir, `call_${callSid}_inbound.raw`);
        this.outboundRecordingPath = path.join(recordingDir, `call_${callSid}_outbound.raw`);
        this.inboundRecordingStream = fs.createWriteStream(this.inboundRecordingPath, { flags: 'a' });
        this.outboundRecordingStream = fs.createWriteStream(this.outboundRecordingPath, { flags: 'a' });

        activeCallCount++;

        // Load configurable timing settings
        this.loadTimingSettings();

        // Create call record immediately
        this.createCallRecord();

        // Initialize transcription if not skipped (e.g., for Eleven Labs calls)
        if (!this.skipTranscription) {
            if (USE_WISPRFLOW) {
                // Use WisprFlow for transcription
                this.initializeWisprFlow('inbound', 'Caller');
                this.initializeWisprFlow('outbound', 'Agent');
            } else if (deepgram) {
                // Fallback to Deepgram
                this.initializeDeepgram('inbound', 'Caller');
                this.initializeDeepgram('outbound', 'Agent');
            } else {
                console.warn(`[Transcription] No transcription service available for ${this.callSid}`);
            }
        } else {
            console.log(`[Transcription] Skipping initialization for ${this.callSid} (Eleven Labs call)`);
        }

        // Initialize Call Script Tube Map session for VA coaching
        this.initializeCallScript();
    }

    private async initializeCallScript() {
        try {
            await initializeCallScriptForCall(this.callSid, this.phoneNumber);
            console.log(`[CallScript] Initialized session for call ${this.callSid}`);
        } catch (error) {
            console.error(`[CallScript] Failed to initialize session for ${this.callSid}:`, error);
            // Non-fatal - call can still proceed without call script
        }
    }

    private async loadTimingSettings() {
        try {
            const settings = await getCallTimingSettings();
            this.debounceMs = settings.skuDebounceMs;
            this.metadataChunkInterval = settings.metadataChunkInterval;
            this.metadataCharThreshold = settings.metadataCharThreshold;
            console.log(`[Timing] Loaded settings for ${this.callSid}: debounce=${this.debounceMs}ms, chunkInterval=${this.metadataChunkInterval}, charThreshold=${this.metadataCharThreshold}`);
        } catch (error) {
            console.error(`[Timing] Failed to load settings for ${this.callSid}, using defaults:`, error);
            // Keep defaults already set in class properties
        }
    }

    private async createCallRecord() {
        try {
            // Check if call was already created by the webhook
            const existingCallId = await findCallByTwilioSid(this.callSid);

            if (existingCallId) {
                this.callRecordId = existingCallId;
                await updateCall(this.callRecordId, {
                    status: "in-progress"
                });
                console.log(`[CallLogger] Attached to existing call ${this.callRecordId} for ${this.callSid}`);
            } else {
                this.callRecordId = await createCall({
                    callId: this.callSid,
                    phoneNumber: this.phoneNumber,
                    direction: "inbound",
                    status: "in-progress",
                });
                console.log(`[CallLogger] Created call record ${this.callRecordId} for ${this.callSid}`);
            }
        } catch (e) {
            console.error("[CallLogger] Failed to create/attach call record:", e);
        }
    }

    private initializeWisprFlow(track: 'inbound' | 'outbound', speakerLabel: string) {
        console.log(`[WisprFlow] Initializing ${track} stream (${speakerLabel}) for ${this.callSid}`);

        const client = createWisprFlowClient({
            apiKey: WISPRFLOW_API_KEY,
            language: 'en-GB', // Default to UK English
            contextNames: [], // Could add customer name when detected
        });

        // Store reference to the appropriate stream
        if (track === 'inbound') {
            this.wisprInbound = client;
        } else {
            this.wisprOutbound = client;
        }

        // Handle connection events
        client.on('connected', () => {
            console.log(`[WisprFlow] ${track} (${speakerLabel}) connected for ${this.callSid}`);
            if (track === 'inbound') {
                this.wisprInboundConnected = true;
                // Broadcast call_started once (from inbound)
                this.broadcast({
                    type: 'voice:call_started',
                    data: { callSid: this.callSid, phoneNumber: this.phoneNumber }
                });
            } else {
                this.wisprOutboundConnected = true;
            }
        });

        // Handle transcript events - map to existing broadcast format
        client.on('transcript', (event: TranscriptEvent) => {
            if (event.isFinal && event.text) {
                // Store segment with speaker label based on track
                this.segments.push({
                    text: event.text,
                    speaker: speakerLabel,
                    track: track,
                    timestamp: new Date()
                });

                // Add speaker label to full transcript
                this.fullTranscript += `[${speakerLabel}]: ${event.text}\n`;
                console.log(`\n[WisprFlow] ${speakerLabel}: ${event.text}`);

                // Broadcast final transcript to UI
                this.broadcast({
                    type: 'voice:live_segment',
                    data: {
                        callSid: this.callSid,
                        transcript: event.text,
                        speaker: speakerLabel,
                        track: track,
                        isFinal: true
                    }
                });

                // Feed transcript to Call Script system for segment classification
                handleCallScriptTranscript(this.callSid, event.text, speakerLabel);

                // Debounce the analysis (not the display)
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }

                this.debounceTimer = setTimeout(() => {
                    console.log('[SKU Detector] Debounce timer fired - analyzing transcript');
                    this.analyzeSegment(this.fullTranscript);
                }, this.debounceMs);
            } else if (event.text) {
                // Interim result
                process.stdout.write(`\r[WisprFlow] ${speakerLabel} Interim: ${event.text} `);
                this.broadcast({
                    type: 'voice:live_segment',
                    data: {
                        callSid: this.callSid,
                        transcript: event.text,
                        speaker: speakerLabel,
                        track: track,
                        isFinal: false
                    }
                });
            }
        });

        client.on('error', (err: Error) => {
            console.error(`[WisprFlow] ${speakerLabel} Error:`, err.message);
        });

        client.on('closed', () => {
            console.log(`[WisprFlow] ${speakerLabel} connection closed for ${this.callSid}`);
            if (track === 'inbound') {
                this.wisprInboundConnected = false;
            } else {
                this.wisprOutboundConnected = false;
            }
        });

        // Connect to WisprFlow
        client.connect().catch((err) => {
            console.error(`[WisprFlow] Failed to connect ${track} stream for ${this.callSid}:`, err);
            // Fallback to Deepgram if WisprFlow fails
            if (deepgram) {
                console.log(`[WisprFlow] Falling back to Deepgram for ${track}`);
                this.initializeDeepgram(track, speakerLabel);
            }
        });
    }

    private initializeDeepgram(track: 'inbound' | 'outbound', speakerLabel: string) {
        if (!deepgram) {
            console.warn(`[Deepgram] Cannot initialize - client not available`);
            return;
        }
        console.log(`[Deepgram] Initializing ${track} stream (${speakerLabel}) for ${this.callSid}`);

        const dgLive = deepgram.listen.live({
            model: "nova-2",
            language: "en-GB", // Default to UK English since localized
            smart_format: true,
            interim_results: true,

            // VAD and utterance settings
            vad_events: true,
            utterance_end_ms: 1000, // Explicitly set to 1s (default is often too short/varied)
            endpointing: 300,       // Help with endpointing silence

            encoding: "mulaw",
            sample_rate: 8000,
            // No diarize needed - we know the speaker from the track
            keywords: [
                "plumbing", "electrician", "handyman",
                "socket", "tap", "leak", "boiler",
                "sink", "switch", "fuse", "quote",
                "price", "call out", "emergency"
            ],
        });

        // Store reference to the appropriate stream
        if (track === 'inbound') {
            this.dgLiveInbound = dgLive;
        } else {
            this.dgLiveOutbound = dgLive;
        }

        dgLive.on(LiveTranscriptionEvents.Open, () => {
            console.log(`[Deepgram] ${track} (${speakerLabel}) connection opened for ${this.callSid}`);
            // Only broadcast call_started once (from inbound)
            if (track === 'inbound') {
                this.broadcast({
                    type: 'voice:call_started',
                    data: { callSid: this.callSid, phoneNumber: this.phoneNumber }
                });
            }
        });

        dgLive.on(LiveTranscriptionEvents.Transcript, (data: any) => {
            const transcript = data.channel.alternatives[0].transcript;
            if (transcript && data.is_final) {
                // Store segment with speaker label based on track
                this.segments.push({
                    text: transcript,
                    speaker: speakerLabel,
                    track: track,
                    timestamp: new Date()
                });

                // Add speaker label to full transcript
                this.fullTranscript += `[${speakerLabel}]: ${transcript}\n`;
                console.log(`\n[Deepgram] ${speakerLabel}: ${transcript}`);

                // IMMEDIATELY broadcast transcript to UI (no debounce for display)
                this.broadcast({
                    type: 'voice:live_segment',
                    data: {
                        callSid: this.callSid,
                        transcript: transcript,
                        speaker: speakerLabel,
                        track: track,
                        isFinal: true
                    }
                });

                // Feed transcript to Call Script system for segment classification and info extraction
                handleCallScriptTranscript(this.callSid, transcript, speakerLabel);

                // B4: Debounce ONLY the analysis (not the display)
                // This keeps UI responsive while reducing API calls
                if (this.debounceTimer) {
                    clearTimeout(this.debounceTimer);
                }

                this.debounceTimer = setTimeout(() => {
                    console.log('[SKU Detector] Debounce timer fired - analyzing transcript');
                    this.analyzeSegment(this.fullTranscript);
                }, this.debounceMs);
            } else if (transcript) {
                // Interim result
                process.stdout.write(`\r[Deepgram] ${speakerLabel} Interim: ${transcript} `);
                this.broadcast({
                    type: 'voice:live_segment',
                    data: {
                        callSid: this.callSid,
                        transcript: transcript,
                        speaker: speakerLabel,
                        track: track,
                        isFinal: false
                    }
                });
            }
        });

        dgLive.on(LiveTranscriptionEvents.Error, (err: any) => {
            console.error(`[Deepgram] ${speakerLabel} Error: `, err);
        });

        dgLive.on(LiveTranscriptionEvents.Close, () => {
            console.log(`[Deepgram] ${speakerLabel} connection closed for ${this.callSid}`);
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

            // Extract name and address periodically (every N segments OR if transcript > N chars)
            // But not more frequently than every 10 seconds to avoid excessive API calls
            // Settings are configurable via admin panel
            const now = Date.now();
            const shouldExtractMetadata = (this.segmentCount % this.metadataChunkInterval === 0 || this.fullTranscript.length > this.metadataCharThreshold)
                && (now - this.lastMetadataExtraction > 10000);

            if (shouldExtractMetadata) {
                this.lastMetadataExtraction = now;

                try {
                    // Pass segments for better speaker-aware extraction
                    const liveMetadata = await extractCallMetadata(this.fullTranscript, this.segments);

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

            // Always broadcast analysis update and jobs when we have any tasks detected
            const hasAnyTasks = multiTaskResult.matchedServices.length > 0 || multiTaskResult.unmatchedTasks.length > 0;

            if (hasAnyTasks || result.matched || result.nextRoute !== 'VIDEO_QUOTE') {
                console.log(`\n[Switchboard] Real-time detection: ${result.matchedServices?.length || 0} matched, ${result.unmatchedTasks?.length || 0} unmatched - ${result.sku?.name || result.nextRoute} (${result.confidence}%)`);
                this.broadcast({
                    type: 'voice:analysis_update',
                    data: {
                        callSid: this.callSid,
                        analysis: result,
                        metadata: this.metadata  // B7: Include metadata in broadcast
                    }
                });

                // Broadcast jobs update for CallHUD with tiered traffic light scoring
                // Tier 1: Instant sync classification (<50ms) for real-time UI
                const jobs = [
                    ...multiTaskResult.matchedServices.map((s, i) => {
                        const jobId = `job-${i}`;
                        const { trafficLight, result } = getTrafficLightSync(true, s.task.description || s.sku.name);
                        this.lastJobClassifications.set(jobId, result);
                        return {
                            id: jobId,
                            description: s.task.description || s.sku.name,
                            matched: true,
                            sku: { pricePence: s.sku.pricePence, id: s.sku.id, name: s.sku.name },
                            trafficLight,
                            complexityScore: result.complexityScore,
                            recommendedRoute: result.recommendedRoute,
                        };
                    }),
                    ...multiTaskResult.unmatchedTasks.map((t, i) => {
                        const jobId = `unmatched-${i}`;
                        const { trafficLight, result } = getTrafficLightSync(false, t.description);
                        this.lastJobClassifications.set(jobId, result);
                        return {
                            id: jobId,
                            description: t.description,
                            matched: false,
                            trafficLight,
                            complexityScore: result.complexityScore,
                            recommendedRoute: result.recommendedRoute,
                        };
                    }),
                ];

                if (jobs.length > 0) {
                    // Get overall route recommendation
                    const routeRecommendation = getOverallRouteRecommendation(this.lastJobClassifications);

                    this.broadcast({
                        type: 'callscript:jobs_update',
                        data: {
                            callId: this.callSid,
                            jobs,
                            routeRecommendation,
                        }
                    });

                    // Broadcast SKU match status for action button state
                    this.broadcast({
                        type: 'callscript:sku_match_update',
                        data: {
                            callId: this.callSid,
                            matched: multiTaskResult.hasMatches,
                            hasUnmatched: multiTaskResult.unmatchedTasks.length > 0,
                        }
                    });

                    // Tier 2: Debounced LLM classification for unmatched jobs (refinement)
                    const unmatchedJobs = jobs.filter(j => !j.matched);
                    if (unmatchedJobs.length > 0) {
                        if (this.tier2DebounceTimer) {
                            clearTimeout(this.tier2DebounceTimer);
                        }
                        this.tier2DebounceTimer = setTimeout(async () => {
                            try {
                                const jobInputs: DetectedJobInput[] = jobs.map(j => ({
                                    id: j.id,
                                    description: j.description,
                                    matched: j.matched,
                                    skuId: j.sku?.id,
                                    skuName: j.sku?.name,
                                    pricePence: j.sku?.pricePence,
                                }));

                                const tier2Results = await classifyMultipleJobs(jobInputs, { useTier2: true });

                                // Update classifications and re-broadcast
                                tier2Results.forEach((result, jobId) => {
                                    this.lastJobClassifications.set(jobId, result);
                                });

                                // Re-broadcast with Tier 2 results
                                const updatedJobs = jobs.map(j => ({
                                    ...j,
                                    trafficLight: this.lastJobClassifications.get(j.id)?.trafficLight || j.trafficLight,
                                    complexityScore: this.lastJobClassifications.get(j.id)?.complexityScore,
                                    recommendedRoute: this.lastJobClassifications.get(j.id)?.recommendedRoute,
                                    needsSpecialist: this.lastJobClassifications.get(j.id)?.needsSpecialist,
                                    reasoning: this.lastJobClassifications.get(j.id)?.reasoning,
                                    tier: this.lastJobClassifications.get(j.id)?.tier,
                                }));

                                const updatedRouteRecommendation = getOverallRouteRecommendation(this.lastJobClassifications);

                                this.broadcast({
                                    type: 'callscript:jobs_update',
                                    data: {
                                        callId: this.callSid,
                                        jobs: updatedJobs,
                                        routeRecommendation: updatedRouteRecommendation,
                                        tier: 2, // Indicate this is refined Tier 2 classification
                                    }
                                });

                                console.log(`[JobComplexity] Tier 2 refinement complete for ${tier2Results.size} jobs`);
                            } catch (err) {
                                console.error('[JobComplexity] Tier 2 classification error:', err);
                            }
                        }, 800); // 800ms debounce for Tier 2 LLM
                    }
                }

                // Persist live analysis to DB for reconnecting clients
                if (this.callRecordId) {
                    updateCall(this.callRecordId, {
                        liveAnalysisJson: result,
                        metadataJson: this.metadata,
                        transcription: this.fullTranscript.trim()
                    }).catch(e => console.error('[CallLogger] Failed to persist live analysis:', e));
                }
            }
        } catch (e) {
            console.error("[Switchboard] Segment analysis error:", e);
        }
    }

    handleAudio(payload: string, track?: string) {
        if (this.isClosed) return;

        try {
            const buffer = Buffer.from(payload, 'base64');

            // Send to appropriate transcription service based on track
            if (USE_WISPRFLOW) {
                // WisprFlow: Convert mu-law to PCM before sending
                const pcmBase64 = convertTwilioToWisprFlow(payload);

                if (track === 'inbound' && this.wisprInbound && this.wisprInboundConnected) {
                    this.wisprInbound.sendAudio(pcmBase64);
                } else if (track === 'outbound' && this.wisprOutbound && this.wisprOutboundConnected) {
                    this.wisprOutbound.sendAudio(pcmBase64);
                } else if (!track && this.wisprInbound && this.wisprInboundConnected) {
                    // Fallback for legacy single-track mode
                    this.wisprInbound.sendAudio(pcmBase64);
                }
            } else {
                // Deepgram fallback: Send mu-law directly
                if (track === 'inbound' && this.dgLiveInbound) {
                    this.dgLiveInbound.send(buffer);
                } else if (track === 'outbound' && this.dgLiveOutbound) {
                    this.dgLiveOutbound.send(buffer);
                } else if (!track && this.dgLiveInbound) {
                    // Fallback for legacy single-track mode
                    this.dgLiveInbound.send(buffer);
                }
            }

            // Write to legacy single-channel recording (inbound only for backwards compat)
            if (this.recordingStream && (!track || track === 'inbound')) {
                this.recordingStream.write(buffer);
            }

            // Write to dual-channel recordings based on track
            if (track === 'inbound' && this.inboundRecordingStream) {
                this.inboundRecordingStream.write(buffer);
            } else if (track === 'outbound' && this.outboundRecordingStream) {
                this.outboundRecordingStream.write(buffer);
            }
        } catch (e) {
            console.error("[Transcription] Send error:", e);
        }
    }

    async close() {
        if (this.isClosed) return;
        this.isClosed = true;

        // Clear Tier 2 debounce timer
        if (this.tier2DebounceTimer) {
            clearTimeout(this.tier2DebounceTimer);
            this.tier2DebounceTimer = null;
        }
        this.lastJobClassifications.clear();

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

        // End Call Script session (persists state and cleans up)
        endCallScriptSession(this.callSid).catch((err) => {
            console.error(`[CallScript] Error ending session for ${this.callSid}:`, err);
        });

        // Close WisprFlow connections
        if (this.wisprInbound) {
            try {
                this.wisprInbound.commit(); // Send final commit
                this.wisprInbound.close();
                console.log(`[WisprFlow] Closed inbound (Caller) stream`);
            } catch (e) {
                console.error(`[WisprFlow] Error closing inbound stream:`, e);
            }
        }
        if (this.wisprOutbound) {
            try {
                this.wisprOutbound.commit(); // Send final commit
                this.wisprOutbound.close();
                console.log(`[WisprFlow] Closed outbound (Agent) stream`);
            } catch (e) {
                console.error(`[WisprFlow] Error closing outbound stream:`, e);
            }
        }

        // Close Deepgram streams (fallback)
        if (this.dgLiveInbound) {
            try {
                this.dgLiveInbound.finish();
                console.log(`[Deepgram] Closed inbound (Caller) stream`);
            } catch (e) {
                console.error(`[Deepgram] Error closing inbound stream:`, e);
            }
        }
        if (this.dgLiveOutbound) {
            try {
                this.dgLiveOutbound.finish();
                console.log(`[Deepgram] Closed outbound (Agent) stream`);
            } catch (e) {
                console.error(`[Deepgram] Error closing outbound stream:`, e);
            }
        }

        // Close all recording streams to ensure flush
        if (this.recordingStream) {
            this.recordingStream.end();
            console.log(`[Recording] Saved raw audio to ${this.recordingPath}`);
        }
        if (this.inboundRecordingStream) {
            this.inboundRecordingStream.end();
            console.log(`[Recording] Saved inbound (caller) audio to ${this.inboundRecordingPath}`);
        }
        if (this.outboundRecordingStream) {
            this.outboundRecordingStream.end();
            console.log(`[Recording] Saved outbound (agent) audio to ${this.outboundRecordingPath}`);
        }
        await new Promise(resolve => setTimeout(resolve, 100)); // Small buffer to ensure flush

        let finalRecordingUrl: string | undefined = undefined;
        let finalLocalPath: string | undefined = this.recordingPath || undefined;
        let inboundRecordingUrl: string | undefined = undefined;
        let outboundRecordingUrl: string | undefined = undefined;

        // Upload/Persist Legacy Recording (for backwards compatibility)
        if (this.recordingPath && fs.existsSync(this.recordingPath)) {
            try {
                const filename = `call_${this.callSid}.raw`;
                finalRecordingUrl = await storageService.uploadRecording(this.recordingPath, filename);
                console.log(`[Recording] Persisted legacy to: ${finalRecordingUrl}`);
                if (finalRecordingUrl.startsWith('http')) {
                    finalLocalPath = undefined;
                } else {
                    finalLocalPath = finalRecordingUrl;
                }
            } catch (error) {
                console.error("[Recording] Failed to persist legacy recording:", error);
            }
        }

        // Upload/Persist Inbound (caller) Recording
        if (this.inboundRecordingPath && fs.existsSync(this.inboundRecordingPath)) {
            try {
                const filename = `call_${this.callSid}_inbound.raw`;
                inboundRecordingUrl = await storageService.uploadRecording(this.inboundRecordingPath, filename);
                console.log(`[Recording] Persisted inbound to: ${inboundRecordingUrl}`);
            } catch (error) {
                console.error("[Recording] Failed to persist inbound recording:", error);
            }
        }

        // Upload/Persist Outbound (agent) Recording
        if (this.outboundRecordingPath && fs.existsSync(this.outboundRecordingPath)) {
            try {
                const filename = `call_${this.callSid}_outbound.raw`;
                outboundRecordingUrl = await storageService.uploadRecording(this.outboundRecordingPath, filename);
                console.log(`[Recording] Persisted outbound to: ${outboundRecordingUrl}`);
            } catch (error) {
                console.error("[Recording] Failed to persist outbound recording:", error);
            }
        }

        // ALWAYS finalize the call record, even if transcript is short/empty
        // This prevents calls from getting stuck as "in-progress" forever
        if (this.callRecordId) {
            const duration = Math.floor((new Date().getTime() - this.callStartTime.getTime()) / 1000);

            // --- AGENTIC LAYER START ---
            let agentPlan = null;
            if (finalText.length > 5) { // Only analyze if there's content
                try {
                    const { analyzeLeadActionPlan } = await import('./services/agentic-service');
                    console.log(`[Twilio-Agent] Analyzing call ${this.callRecordId}...`);
                    agentPlan = await analyzeLeadActionPlan(finalText);
                    console.log(`[Twilio-Agent] Plan generated:`, JSON.stringify(agentPlan, null, 2));
                } catch (err) {
                    console.error(`[Twilio-Agent] Analysis failed:`, err);
                }
            }
            // --- AGENTIC LAYER END ---

            try {
                await finalizeCall(this.callRecordId, {
                    duration,
                    endTime: new Date(),
                    outcome: agentPlan ? (agentPlan.recommendedAction === 'book_visit' ? 'SITE_VISIT' : 'INSTANT_PRICE') : 'UNKNOWN',
                    transcription: finalText || undefined,
                    segments: this.segments,
                    localRecordingPath: finalLocalPath,
                    recordingUrl: finalRecordingUrl || undefined,
                    inboundRecordingUrl: inboundRecordingUrl || undefined,
                    outboundRecordingUrl: outboundRecordingUrl || undefined,
                    detectedSkusJson: agentPlan ? agentPlan : undefined // Store the Brain Dump
                });
                console.log(`[CallLogger] Finalized call ${this.callRecordId} with duration ${duration}s`);
            } catch (e) {
                console.error("[CallLogger] Failed to finalize call:", e);
            }
        }

        // Close recording stream - (Already closed above)
        /* 
        if (this.recordingStream) {
            this.recordingStream.end();
             console.log(`[Recording] Saved raw audio to ${this.recordingPath}`);
        } 
        */

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

                // Get segment data from call-script session
                const callScriptSession = getActiveSession(this.callSid);
                const sessionState = callScriptSession?.toJSON();
                const detectedSegment = sessionState?.detectedSegment || null;
                const segmentConfidence = sessionState?.segmentConfidence || 0;
                const segmentSignals = sessionState?.segmentSignals || [];

                // Determine if VA was present (confirmed a segment or took an action)
                const segmentWasConfirmed = sessionState?.confirmedSegment !== null;
                const needsSegmentApproval = detectedSegment && !segmentWasConfirmed;

                // B9: Check for duplicate lead before creating
                // Remove company info from name for cleaner match (e.g. "John (Acme)" -> "John")
                const cleanNameForCheck = mergedMetadata.customerName
                    ? mergedMetadata.customerName.replace(/\s*\(.*?\)/, '').trim()
                    : null;

                const duplicateCheck = await findDuplicateLead(this.phoneNumber, {
                    customerName: cleanNameForCheck,
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
                        metadata: mergedMetadata,
                        // Update segment if we have a detection
                        ...(detectedSegment && {
                            segment: detectedSegment,
                            segmentConfidence: segmentConfidence,
                            segmentSignals: segmentSignals,
                        }),
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

                    // Update call with leadId
                    if (this.callRecordId) {
                        await updateCall(this.callRecordId, {
                            leadId: leadId
                        });
                    }
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
                        status: needsSegmentApproval ? "needs_review" : (routing.matched ? "ready" : "review"),
                        // B5: Enhanced address fields
                        addressRaw: mergedMetadata.addressRaw,
                        addressCanonical: mergedMetadata.addressValidation?.canonicalAddress || null,
                        placeId: mergedMetadata.addressValidation?.placeId || null,
                        postcode: mergedMetadata.postcode, // Normalized
                        coordinates: mergedMetadata.addressValidation?.coordinates || null,
                        // Segment detection data
                        segment: detectedSegment as any,
                        segmentConfidence: segmentConfidence,
                        segmentSignals: segmentSignals as any,
                    });

                    console.log(`[Switchboard] Voice lead created: ${leadId} -> ${routing.nextRoute} | Segment: ${detectedSegment || 'UNKNOWN'} (${segmentConfidence}%) | Needs approval: ${needsSegmentApproval}`);
                }

                // Update call record with analysis results (outcome will be updated from UNKNOWN)
                if (this.callRecordId) {
                    // Update call with customer metadata and proper outcome
                    await updateCall(this.callRecordId, {
                        customerName: mergedMetadata.customerName,
                        address: mergedMetadata.address,
                        postcode: mergedMetadata.postcode,
                        urgency: mergedMetadata.urgency,
                        leadType: mergedMetadata.leadType,
                        outcome: routing.nextRoute,
                        metadataJson: mergedMetadata,
                        leadId: leadId
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

                // === AUTO-VIDEO PROCESSING ===
                // Fire-and-forget: Analyze transcript for video request agreement
                // and auto-send WhatsApp if confidence is high enough
                if (leadId && mergedMetadata.phoneNumber && finalText.length > 100) {
                    (async () => {
                        try {
                            const { processCallForAutoVideo } = await import('./services/auto-video-service');
                            console.log(`[AutoVideo] Processing call ${this.callRecordId} for lead ${leadId}...`);

                            const result = await processCallForAutoVideo(
                                this.callRecordId || '',
                                leadId,
                                finalText,
                                mergedMetadata.phoneNumber,
                                mergedMetadata.customerName || 'there'
                            );

                            if (result.sent) {
                                console.log(`[AutoVideo] Video request auto-sent for lead ${leadId}`);
                            } else {
                                console.log(`[AutoVideo] Skipped for lead ${leadId}: ${result.reason}`);
                            }
                        } catch (err) {
                            console.error(`[AutoVideo] Error processing:`, err);
                        }
                    })();
                }

                // === CALL ANALYZER & LEAD SCORING ===
                // Fire-and-forget: Analyze transcript for lead qualification and segmentation
                if (leadId && finalText.length > 50) {
                    (async () => {
                        try {
                            console.log(`[CallAnalyzer] Analyzing call for lead ${leadId}...`);
                            const analysis = await analyzeCallTranscript(finalText);

                            // Update lead with analysis results
                            await db.update(leads)
                                .set({
                                    qualificationScore: analysis.qualificationScore,
                                    qualificationGrade: analysis.qualificationGrade,
                                    segment: analysis.segment as any, // Cast to match enum type
                                    segmentConfidence: analysis.segmentConfidence,
                                    segmentSignals: analysis.segmentSignals,
                                    redFlags: analysis.redFlags
                                })
                                .where(eq(leads.id, leadId));

                            console.log(`[CallAnalyzer] Lead ${leadId} scored: ${analysis.qualificationGrade} (${analysis.qualificationScore}), segment: ${analysis.segment}`);
                        } catch (err) {
                            console.error('[CallAnalyzer] Error analyzing call:', err);
                        }
                    })();
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
                        // Support both old and new parameter names for backwards compatibility
                        const skipTranscription = msg.start.customParameters?.skipTranscription === 'true' ||
                                                  msg.start.customParameters?.skipDeepgram === 'true';
                        transcriber = new MediaStreamTranscriber(ws, msg.start.callSid, msg.start.streamSid, phoneNumber, broadcast, skipTranscription);
                        break;
                    case 'media':
                        if (transcriber) {
                            // Pass track info for dual-channel recording ('inbound' = caller, 'outbound' = agent)
                            transcriber.handleAudio(msg.media.payload, msg.media.track);
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
