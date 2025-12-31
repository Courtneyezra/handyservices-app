import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useMemo } from 'react';
import { queryClient } from "@/lib/queryClient";

interface SkuDetectionResult {
    matched: boolean;
    sku: {
        id: string;
        skuCode: string;
        name: string;
        category: string;
        pricePence: number;
        description: string;
    } | null;
    confidence: number;
    method: 'keyword' | 'embedding' | 'gpt' | 'hybrid' | 'cached' | 'realtime' | 'none';
    rationale: string;
    nextRoute: 'INSTANT_PRICE' | 'VIDEO_QUOTE' | 'SITE_VISIT' | 'UNKNOWN';
    suggestedScript?: string;

    // Performance & UI Optimizations (F1, F3)
    isPreliminaryResult?: boolean; // If true, show loading spinner while fetching full result
    detectionTime?: number;        // Time taken in ms
    cacheHit?: boolean;            // Was embedding cached?

    // Multi-SKU fields
    matchedServices?: Array<{
        sku: {
            id: string;
            skuCode: string;
            name: string;
            category: string;
            pricePence: number;
            description: string;
        };
        confidence: number;
        task: { description: string; quantity: number };
    }>;
    unmatchedTasks?: Array<{ description: string; quantity: number }>;
    totalMatchedPrice?: number;
    hasMultiple?: boolean;
}

interface Segment {
    speaker: number;
    text: string;
    start: number;
    end: number;
}

interface CallMetadata {
    customerName: string | null;
    address: string | null;
    urgency: "Critical" | "High" | "Standard" | "Low";
    leadType: "Homeowner" | "Landlord" | "Property Manager" | "Tenant" | "Unknown";
    phoneNumber?: string; // Caller ID
    postcode?: string | null;
    addressRaw?: string;
    addressCanonical?: string;
    coordinates?: { lat: number, lng: number };
}

interface DuplicateInfo {
    existingLeadId: string;
    confidence: number;
    matchReason: string;
}

interface UploadResponse {
    transcription: string;
    segments: Segment[];
    detection: SkuDetectionResult;
    metadata: CallMetadata;
}

interface SimulationOptions {
    phoneNumber?: string;
    customerName?: string;
    jobDescription?: string;
}

interface LiveCallContextType {
    isLive: boolean;
    liveCallData: UploadResponse | null;
    interimTranscript: string;
    isSimulating: boolean;
    startSimulation: (options?: SimulationOptions) => void;
    clearCall: () => void; // Manual reset function
    updateMetadata: (metadata: Partial<CallMetadata>) => void;
    detectedPostcode: string | null;
    setDetectedPostcode: (postcode: string | null) => void;
    duplicateWarning: DuplicateInfo | null;
    setDuplicateWarning: (info: DuplicateInfo | null) => void;
    addressValidation: any | null;  // AddressValidation from server
    setAddressValidation: (validation: any | null) => void;
    audioQuality: 'GOOD' | 'DEGRADED' | 'POOR'; // Clean Mode: Audio quality indicator
}

const LiveCallContext = createContext<LiveCallContextType | undefined>(undefined);

export function LiveCallProvider({ children }: { children: ReactNode }) {
    const [liveCallData, setLiveCallData] = useState<UploadResponse | null>(null);
    const [interimTranscript, setInterimTranscript] = useState<string>("");
    const [isLive, setIsLive] = useState(false);
    const [isSimulating, setIsSimulating] = useState(false);
    const [detectedPostcode, setDetectedPostcode] = useState<string | null>(null);
    const [duplicateWarning, setDuplicateWarning] = useState<DuplicateInfo | null>(null);
    const [addressValidation, setAddressValidation] = useState<any | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const isSimulatingRef = useRef(false);
    const [isRehydrating, setIsRehydrating] = useState(false);

    // F1: Fetch active call from database for reconnecting clients
    async function fetchActiveCall() {
        try {
            const res = await fetch('/api/calls/active');
            const data = await res.json();
            return data.activeCall;
        } catch (e) {
            console.error('[LiveCall] Failed to fetch active call:', e);
            return null;
        }
    }

    // Clean Mode: Derive audio quality from transcript patterns
    const audioQuality = useMemo((): 'GOOD' | 'DEGRADED' | 'POOR' => {
        if (!liveCallData) return 'GOOD';

        const segmentCount = liveCallData.segments.length;
        const transcriptionLength = liveCallData.transcription.length;
        const avgSegmentLength = segmentCount > 0 ? transcriptionLength / segmentCount : 0;
        const confidence = liveCallData.detection?.confidence || 0;

        // Poor: Many tiny segments (fragmented audio) or very low confidence
        if (segmentCount > 5 && avgSegmentLength < 15) return 'POOR';
        if (confidence === 0 && segmentCount > 3) return 'POOR';

        // Degraded: Low confidence with some data
        if (confidence < 30 && confidence > 0) return 'DEGRADED';
        if (segmentCount > 3 && avgSegmentLength < 25) return 'DEGRADED';

        return 'GOOD';
    }, [liveCallData]);

    const clearCall = () => {
        console.log('[LiveCall] Manual reset triggered');
        isSimulatingRef.current = false;
        setIsSimulating(false);
        setIsLive(false);
        setLiveCallData(null);
        setInterimTranscript("");
        setDetectedPostcode(null);
        setDuplicateWarning(null);
        setAddressValidation(null);
    };

    const updateMetadata = (metadata: Partial<CallMetadata>) => {
        setLiveCallData(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                metadata: { ...prev.metadata, ...metadata }
            };
        });
    };

    const startSimulation = (options?: SimulationOptions) => {
        if (isLive || isSimulatingRef.current) return;

        isSimulatingRef.current = true;
        setIsSimulating(true);
        setIsLive(true);

        const testNumber = options?.phoneNumber || "+84357691573";
        const testName = options?.customerName || "Vinh";
        const jobDesc = options?.jobDescription || "major leak in the kitchen";

        console.log(`[Simulation] Starting dummy call for ${testNumber} with job: ${jobDesc}...`);

        setInterimTranscript("");
        setLiveCallData({
            transcription: "",
            segments: [],
            detection: {
                matched: false,
                sku: null,
                confidence: 0,
                method: "realtime",
                rationale: "Waiting for speech...",
                nextRoute: "UNKNOWN"
            },
            metadata: {
                customerName: "Customer",
                address: null,
                urgency: "Standard",
                leadType: "Unknown",
                phoneNumber: testNumber
            }
        });

        const steps = [
            { type: 'segment', delay: 1000, text: "Hi, I have a few jobs that need doing.", speaker: 1 },
            { type: 'segment', delay: 3500, text: "I need my 55 inch TV mounted on the wall in the living room.", speaker: 1 },
            { type: 'segment', delay: 6000, text: "And also one of the fence panels in the back garden has blown down and needs replacing.", speaker: 1 },
            {
                type: 'analysis',
                delay: 7000,
                data: {
                    matched: true,
                    sku: {
                        id: 'tv-mount-standard',
                        skuCode: 'TV-MOUNT-55',
                        name: 'TV Mounting (Standard)',
                        category: 'Mounting',
                        pricePence: 7500,
                        description: 'Wall mounting for TVs up to 65 inches on standard partial/brick walls.'
                    },
                    confidence: 92,
                    method: 'gpt',
                    rationale: 'Customer explicitly requested TV mounting and fence repair.',
                    nextRoute: 'INSTANT_PRICE',
                    suggestedScript: "I can help with those. The TV mounting is £75 and the fence panel replacement is £120. Total would be £195.",

                    // New Multi-SKU Simulation Data
                    hasMultiple: true,
                    totalMatchedPrice: 19500,
                    matchedServices: [
                        {
                            sku: {
                                id: 'tv-mount-standard',
                                skuCode: 'TV-MOUNT-55',
                                name: 'TV Mounting (Standard)',
                                category: 'Mounting',
                                pricePence: 7500,
                                description: 'Wall mounting for TVs up to 65 inches.'
                            },
                            confidence: 95,
                            task: { description: "Mount 55 inch TV", quantity: 1 }
                        },
                        {
                            sku: {
                                id: 'fence-repair-panel',
                                skuCode: 'FENCE-PANEL',
                                name: 'Fence Panel Replacement',
                                category: 'Outdoor',
                                pricePence: 12000,
                                description: 'Supply and fit standard lap panel.'
                            },
                            confidence: 88,
                            task: { description: "Replace fence panel", quantity: 1 }
                        }
                    ],
                    unmatchedTasks: []
                }
            },
            { delay: 10000, type: 'segment', speaker: 1, text: "I've got that. Can you confirm your address for me?" },
            { delay: 12000, type: 'segment', speaker: 0, text: "I'm at 42 Maple Street. Please send someone fast!" },
            { delay: 14000, type: 'metadata', data: { customerName: testName, address: "42 Maple Street", urgency: "Critical", leadType: "Homeowner", phoneNumber: testNumber } },
            { delay: 16000, type: 'end' }
        ];

        let currentStep = 0;
        const runNextStep = () => {
            if (currentStep >= steps.length || !isSimulatingRef.current) return;
            const step = steps[currentStep];

            const waitTime = currentStep === 0 ? step.delay : (steps[currentStep].delay - steps[currentStep - 1].delay);

            setTimeout(() => {
                if (!isSimulatingRef.current) return;

                switch (step.type) {
                    case 'segment':
                        console.log(`[Simulation] Step ${currentStep + 1}: Speaker ${step.speaker} says "${step.text}"`);
                        setLiveCallData(prev => {
                            if (!prev) return prev;
                            const text = step.text as string;
                            return {
                                ...prev,
                                transcription: prev.transcription + text + " ",
                                segments: [...prev.segments, {
                                    speaker: (step as any).speaker || 0,
                                    text: text,
                                    start: Date.now(),
                                    end: Date.now()
                                }]
                            };
                        });
                        break;
                    case 'analysis':
                        console.log(`[Simulation] Step ${currentStep + 1}: Triggering analysis result`);
                        setLiveCallData(prev => prev ? { ...prev, detection: step.data as any } : null);
                        break;
                    case 'metadata':
                        console.log(`[Simulation] Step ${currentStep + 1}: Updating call metadata`);
                        setLiveCallData(prev => prev ? { ...prev, metadata: step.data as any } : null);
                        break;
                    case 'end':
                        console.log(`[Simulation] Step ${currentStep + 1}: Simulation finished`);
                        isSimulatingRef.current = false;
                        setIsLive(false);
                        setIsSimulating(false);
                        break;
                }

                currentStep++;
                if (currentStep < steps.length && isSimulatingRef.current) {
                    runNextStep();
                }
            }, waitTime);
        };

        runNextStep();
    };

    useEffect(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws/client`;
        console.log('[LiveCall] Connecting to WebSocket:', wsUrl);

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = async () => {
            console.log('[LiveCall] WebSocket CONNECTED');

            // F2: Rehydrate from any active call in DB
            if (!isSimulatingRef.current) {
                setIsRehydrating(true);
                try {
                    const activeCall = await fetchActiveCall();
                    if (activeCall && activeCall.status === 'in-progress') {
                        console.log('[LiveCall] Rehydrating from active call:', activeCall.id);
                        setIsLive(true);
                        setLiveCallData({
                            transcription: activeCall.transcription || "",
                            segments: activeCall.segments || [],
                            detection: activeCall.liveAnalysisJson || {
                                matched: false,
                                sku: null,
                                confidence: 0,
                                method: "realtime",
                                rationale: "Call in progress...",
                                nextRoute: "UNKNOWN"
                            },
                            metadata: activeCall.metadataJson || {
                                customerName: activeCall.customerName || "Incoming Call...",
                                address: activeCall.address,
                                urgency: activeCall.urgency || "Standard",
                                leadType: activeCall.leadType || "Unknown",
                                phoneNumber: activeCall.phoneNumber
                            }
                        });
                        if (activeCall.metadataJson?.postcode) {
                            setDetectedPostcode(activeCall.metadataJson.postcode);
                        }
                    }
                } catch (e) {
                    console.error('[LiveCall] Rehydration failed:', e);
                } finally {
                    setIsRehydrating(false);
                }
            }
        };

        ws.onerror = (error) => {
            console.error('[LiveCall] WebSocket ERROR:', error);
        };

        ws.onmessage = (event) => {
            console.log('[LiveCall] Message received:', event.data.substring(0, 100));
            if (isSimulating) {
                console.log('[LiveCall] Ignoring - simulation active');
                return; // Ignore real events during simulation
            }
            try {
                const msg = JSON.parse(event.data);
                console.log('[LiveCall] Parsed message type:', msg.type);
                if (msg.type === 'voice:call_started') {
                    setIsLive(true);
                    setInterimTranscript("");
                    setLiveCallData({
                        transcription: "",
                        segments: [],
                        detection: {
                            matched: false,
                            sku: null,
                            confidence: 0,
                            method: "realtime",
                            rationale: "Waiting for speech...",
                            nextRoute: "UNKNOWN"
                        },
                        metadata: {
                            customerName: "Incoming Call...",
                            address: null,
                            urgency: "Standard",
                            leadType: "Unknown",
                            phoneNumber: msg.data.phoneNumber || "Unknown"
                        }
                    });
                } else if (msg.type === 'voice:live_segment') {
                    const { transcript, isFinal } = msg.data;
                    if (isFinal) {
                        setInterimTranscript("");
                        setLiveCallData(prev => {
                            if (!prev) return prev;
                            return {
                                ...prev,
                                transcription: prev.transcription + transcript + " ",
                                segments: [...prev.segments, {
                                    speaker: 0,
                                    text: transcript,
                                    start: Date.now(),
                                    end: Date.now()
                                }]
                            };
                        });
                    } else {
                        setInterimTranscript(transcript);
                    }
                } else if (msg.type === 'voice:analysis_update') {
                    setLiveCallData(prev => {
                        if (!prev) return prev;
                        // Map metadata if present
                        const metadata = msg.data.metadata ? { ...prev.metadata, ...msg.data.metadata } : prev.metadata;
                        return { ...prev, detection: msg.data.analysis, metadata };
                    });
                } else if (msg.type === 'voice:postcode_detected') {
                    console.log(`[LiveCall] Postcode detected: ${msg.data.postcode}`);
                    setDetectedPostcode(msg.data.postcode);
                } else if (msg.type === 'voice:address_validated') {
                    console.log(`[LiveCall] Address validated: ${msg.data.validation.confidence}% confidence`);
                    setAddressValidation(msg.data.validation);
                } else if (msg.type === 'voice:duplicate_detected') {
                    console.log(`[LiveCall] Duplicate detected! Confidence: ${msg.data.confidence}%`);
                    setDuplicateWarning({
                        existingLeadId: msg.data.existingLeadId,
                        confidence: msg.data.confidence,
                        matchReason: msg.data.matchReason
                    });
                } else if (msg.type === 'voice:call_ended') {
                    setIsLive(false);
                    setInterimTranscript("");
                    setLiveCallData(prev => {
                        if (!prev) return prev;
                        return {
                            ...prev,
                            transcription: msg.data.finalTranscript,
                            detection: msg.data.analysis,
                            metadata: {
                                ...prev.metadata,
                                customerName: "Recent Voice Lead"
                            }
                        };
                    });
                    queryClient.invalidateQueries({ queryKey: ['calls'] }); // Refresh list
                } else if (msg.type === 'call:created' || msg.type === 'call:updated' || msg.type === 'call:skus_detected') {
                    // Refresh calls list and specific call details
                    queryClient.invalidateQueries({ queryKey: ['calls'] });
                    if (msg.data.id || msg.data.callId) {
                        // Some events use id, others use callId (record ID vs Twilio CallSid might be mixed, but standardizing on record ID 'id' is best)
                        // B6 implementation returns 'id' for call record.
                        const recordId = msg.data.id;
                        if (recordId) {
                            queryClient.invalidateQueries({ queryKey: ['call', recordId] });
                        }
                    }
                }
            } catch (e) {
                console.error("Voice WS Parse Error", e);
            }
        };

        return () => ws.close();
    }, [isSimulating]);

    return (
        <LiveCallContext.Provider value={{
            isLive, liveCallData, interimTranscript, isSimulating, startSimulation, clearCall, updateMetadata,
            detectedPostcode, setDetectedPostcode,
            duplicateWarning, setDuplicateWarning,
            addressValidation, setAddressValidation,
            audioQuality
        }}>
            {children}
        </LiveCallContext.Provider>
    );
}

export function useLiveCall() {
    const context = useContext(LiveCallContext);
    if (context === undefined) {
        throw new Error('useLiveCall must be used within a LiveCallProvider');
    }
    return context;
}
