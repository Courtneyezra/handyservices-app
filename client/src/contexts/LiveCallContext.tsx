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
    complexity?: 'SIMPLE' | 'MESSY' | 'EMERGENCY' | 'LANDLORD' | 'RANDOM';
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

        const complexity = options?.complexity || 'SIMPLE';
        const testNumber = options?.phoneNumber || (complexity === 'EMERGENCY' ? "+447911123456" : "+447700900123");
        const testName = options?.customerName || (complexity === 'LANDLORD' ? "James Sterling" : "Mrs. Henderson");
        const jobDesc = options?.jobDescription || "leaking tap";

        console.log(`[Simulation] Starting ${complexity} call for ${testNumber}...`);

        setInterimTranscript("");
        setLiveCallData({
            transcription: "",
            segments: [],
            detection: {
                matched: false,
                sku: null,
                confidence: 0,
                method: "realtime",
                rationale: "Scanning voice for intent...",
                nextRoute: "UNKNOWN"
            },
            metadata: {
                customerName: "Incoming Call...",
                address: null,
                urgency: "Standard",
                leadType: "Unknown",
                phoneNumber: testNumber
            }
        });

        // Generate steps based on complexity
        let steps: any[] = [];

        if (complexity === 'RANDOM') {
            const randomScenarios = [
                {
                    name: "Locked Out",
                    segments: ["Hi, I'm stuck outside my house, I've left the keys in the lock on the inside!", "Can you get someone to me within 30 minutes? It's freezing."],
                    metadata: { urgency: 'Critical', customerName: 'David Lee', address: '7 High St' },
                    analysis: { name: 'Emergency Locksmith', route: 'SITE_VISIT', script: "Don't worry, David. Our locksmith is nearby and can be there in 20 minutes." }
                },
                {
                    name: "Full House Paint",
                    segments: ["I've just bought a new place and I want the whole interior painted before we move in.", "It's a 3 bedroom semi. Are you guys available next week?"],
                    metadata: { urgency: 'Standard', customerName: 'Sarah Jenkins', address: '12 Willow Way' },
                    analysis: { name: 'Full Interior Decorating', route: 'VIDEO_QUOTE', script: "Congratulations on the new place! To give you a precise quote for 3 bedrooms, could you send a video of the rooms?" }
                },
                {
                    name: "Flickering Lights",
                    segments: ["All the lights in my kitchen are flickering and there's a buzzing sound from the fuse box.", "I'm worried about a fire, can you help?"],
                    metadata: { urgency: 'Critical', customerName: 'Mr. White', address: 'Room 101, Grand Hotel' },
                    analysis: { name: 'Emergency Electrical Fix', route: 'SITE_VISIT', script: "Please turn off your main power switch immediately. I am sending an electrician to you now." }
                },
                {
                    name: "Gutter Clearance",
                    segments: ["My gutters are overflowing and the water is coming down the walls.", "Can you clear them and check for any leaks?"],
                    metadata: { urgency: 'High', customerName: 'Mrs. Gable', address: 'High View' },
                    analysis: { name: 'Gutter & Fascia Service', route: 'VIDEO_QUOTE', script: "I can help with that. Could you send a quick video of the gutters from the ground?" }
                },
                {
                    name: "IKEA Assembly",
                    segments: ["I've got three PAX wardrobes and a MALM bed that need building.", "I'm struggling with the instructions, please help!"],
                    metadata: { urgency: 'Standard', customerName: 'Ben Foster', address: 'New Flat 4' },
                    analysis: { name: 'Flat-Pack Assembly (PAX)', route: 'INSTANT_PRICE', script: "We build PAX furniture every week! That will be £150 for the wardrobes and £45 for the bed. Total £195." }
                }
            ];

            const picked = randomScenarios[Math.floor(Math.random() * randomScenarios.length)];
            steps = [
                { type: 'segment', delay: 1000, text: picked.segments[0], speaker: 1 },
                { type: 'segment', delay: 4000, text: picked.segments[1], speaker: 1 },
                {
                    type: 'analysis',
                    delay: 6000,
                    data: {
                        matched: true,
                        sku: { name: picked.analysis.name, category: 'Surprise', pricePence: 0 },
                        confidence: 88,
                        method: 'gpt',
                        rationale: `Randomized training scenario: ${picked.name}`,
                        nextRoute: picked.analysis.route,
                        suggestedScript: picked.analysis.script
                    }
                },
                { delay: 9000, type: 'metadata', data: { ...picked.metadata, leadType: 'Homeowner', phoneNumber: testNumber } },
                { delay: 11000, type: 'end' }
            ];
        } else if (complexity === 'MESSY') {
            steps = [
                { type: 'segment', delay: 1000, text: "Hello? Is this the handyman service? I'm calling about a dripping tap.", speaker: 1 },
                {
                    type: 'analysis',
                    delay: 2000,
                    data: {
                        matched: true,
                        sku: { name: 'Tap Washer Fix', category: 'Plumbing', pricePence: 6500 },
                        confidence: 60,
                        method: 'gpt',
                        rationale: 'Initial mention of a dripping tap.',
                        nextRoute: 'VIDEO_QUOTE',
                        suggestedScript: "I can help with a dripping tap. I'll need a quick video to see the type of tap."
                    }
                },
                { type: 'segment', delay: 4000, text: "Wait, actually, I just looked and it's not a drip anymore, the whole pipe has burst!", speaker: 1 },
                { type: 'segment', delay: 6000, text: "The water is starting to fill up the cupboard and I can't reach the valve!", speaker: 1 },
                {
                    type: 'analysis',
                    delay: 8000,
                    data: {
                        matched: true,
                        sku: { name: 'Emergency Leak Response', category: 'Emergency', pricePence: 12000 },
                        confidence: 98,
                        method: 'gpt',
                        rationale: 'Customer escalated from "dripping" to "burst pipe". High risk detected.',
                        nextRoute: 'SITE_VISIT',
                        suggestedScript: "I'm upgrading this to an emergency site visit. I'll have someone there in 20 minutes."
                    }
                },
                { type: 'segment', delay: 11000, text: "Please hurry, I'm at 15 Derby Road.", speaker: 1 },
                { delay: 13000, type: 'metadata', data: { customerName: "Henderson", address: "15 Derby Road, Derby", urgency: "Critical", leadType: "Homeowner", phoneNumber: testNumber } },
                { delay: 15000, type: 'end' }
            ];
        } else if (complexity === 'EMERGENCY') {
            steps = [
                { type: 'segment', delay: 1000, text: "HELP! I've got water pouring through the light fixture in the kitchen!", speaker: 1 },
                { type: 'segment', delay: 3000, text: "I'm terrified to touch anything. Can you send someone immediately?", speaker: 1 },
                {
                    type: 'analysis',
                    delay: 5000,
                    data: {
                        matched: true,
                        sku: {
                            id: 'emergency-01',
                            skuCode: 'EMR-01',
                            name: 'Emergency Investigation',
                            category: 'Emergency',
                            pricePence: 12000,
                            description: 'Immediate dispatch for life/property threat.'
                        },
                        confidence: 96,
                        method: 'realtime',
                        rationale: 'Keywords: "Water through light", "Immediately", "Terrified".',
                        nextRoute: 'SITE_VISIT',
                        suggestedScript: "Stay away from the light fixture. I'm dispatching our emergency engineer to you right now. Do you know where the stopcock is?",
                    }
                },
                { delay: 8000, type: 'metadata', data: { customerName: "URGENT", address: "10 Downing Street, London", urgency: "Critical", leadType: "Homeowner", phoneNumber: testNumber } },
                { delay: 10000, type: 'end' }
            ];
        } else if (complexity === 'LANDLORD') {
            steps = [
                { type: 'segment', delay: 1000, text: "Hi, it's James Sterling here. I have four properties that need annual safety inspections and basic maintenance.", speaker: 1 },
                { type: 'segment', delay: 4000, text: "We're looking for a reliable partner for our portfolio. Can you handle large volumes?", speaker: 1 },
                {
                    type: 'analysis',
                    delay: 6000,
                    data: {
                        matched: true,
                        sku: { name: 'Commercial Portfolio Review', category: 'Contract', pricePence: 0 },
                        confidence: 90,
                        method: 'gpt',
                        rationale: 'High-value recurring lead. Property manager intent.',
                        nextRoute: 'VIDEO_QUOTE',
                        suggestedScript: "We specialize in property portfolios. I'll send you our commercial rate card via WhatsApp now.",
                    }
                },
                { delay: 9000, type: 'metadata', data: { customerName: "Sterling properties", leadType: "Property Manager", urgency: "Standard", phoneNumber: testNumber } },
                { delay: 11000, type: 'end' }
            ];
        } else {
            // SIMPLE default
            steps = [
                { type: 'segment', delay: 1000, text: `Hi there, I'm calling because I have a bit of an issue with ${jobDesc}.`, speaker: 1 },
                { type: 'segment', delay: 3500, text: `It's quite urgent, I was hoping you could get someone out to look at the ${jobDesc.split(' ').pop()} as soon as possible.`, speaker: 1 },
                {
                    type: 'analysis',
                    delay: 5000,
                    data: {
                        matched: true,
                        sku: jobDesc.toLowerCase().includes('leak') ? {
                            id: 'plumbing-emergency',
                            skuCode: 'PLUMB-EMR',
                            name: 'Emergency Plumbing Investigation',
                            category: 'Plumbing',
                            pricePence: 9500,
                            description: 'Emergency investigation and first hour of labor for plumbing leaks.'
                        } : {
                            id: 'general-handyman',
                            skuCode: 'HANDY-GEN',
                            name: 'Handyman General Service',
                            category: 'General',
                            pricePence: 6500,
                            description: 'General handyman services for various home repairs.'
                        },
                        confidence: 85,
                        method: 'gpt',
                        rationale: `Customer specifically mentioned: "${jobDesc}". AI identified this as a priority job.`,
                        nextRoute: jobDesc.toLowerCase().includes('leak') ? 'SITE_VISIT' : 'VIDEO_QUOTE',
                        suggestedScript: `I understand you're having trouble with ${jobDesc}. I can certainly help. For something like this, we usually recommend ${jobDesc.toLowerCase().includes('leak') ? 'an emergency site visit' : 'a quick video survey'} so we can give you a firm price.`,
                        hasMultiple: false,
                        totalMatchedPrice: jobDesc.toLowerCase().includes('leak') ? 9500 : 0,
                        matchedServices: [],
                        unmatchedTasks: []
                    }
                },
                { delay: 8000, type: 'segment', speaker: 1, text: "Can you tell me how much that usually costs?" },
                { delay: 10000, type: 'segment', speaker: 0, text: `For ${jobDesc}, it depends on the exact scope, but I'll send you a link to upload a video now.` },
                { delay: 12000, type: 'metadata', data: { customerName: testName, address: "10 Downing Street, London", urgency: jobDesc.toLowerCase().includes('leak') ? "Critical" : "Standard", leadType: "Homeowner", phoneNumber: testNumber } },
                { delay: 14000, type: 'end' }
            ];
        }

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
