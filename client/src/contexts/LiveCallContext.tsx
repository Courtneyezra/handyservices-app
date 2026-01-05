import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from "@/hooks/use-toast";

// --- Types ---

export interface LiveAnalysisJson {
    matched: boolean;
    sku: {
        name: string;
        pricePence: number;
        category?: string;
    } | null;
    confidence: number;
    method: "realtime" | "detailed" | "gpt";
    rationale: string;
    nextRoute: string;
    suggestedScript?: string;
}

export interface LiveMetadataJson {
    customerName: string | null;
    address: string | null;
    urgency: "Emergency" | "High" | "Standard" | "Low" | "Critical";
    leadType: "Landlord" | "Homeowner" | "Tenant" | "Commercial" | "Unknown";
    phoneNumber: string | null;
    postcode?: string | null;
}

export interface Segment {
    speaker: 0 | 1; // 0 = caller, 1 = agent
    text: string;
    start: number;
    end: number;
}

export interface LiveCallData {
    transcription: string;
    segments: Segment[];
    detection: LiveAnalysisJson;
    metadata: LiveMetadataJson;
}


interface SimulationOptions {
    complexity?: 'SIMPLE' | 'COMPLEX' | 'EMERGENCY' | 'LANDLORD' | 'RANDOM' | 'MESSY';
    phoneNumber?: string;
    customerName?: string;
    jobDescription?: string;
}

interface AddressValidationResult {
    isValid: boolean;
    standardizedAddress?: string;
    confidence: number;
    details?: any; // google maps result
}

interface LiveCallContextType {
    isLive: boolean; // Derived: if liveCallData !== null
    liveCallData: LiveCallData | null;
    interimTranscript: string;
    isSimulating: boolean;
    startSimulation: (options?: SimulationOptions) => void;
    clearCall: () => void;
    updateMetadata: (updates: Partial<LiveMetadataJson>) => void;
    detectedPostcode: string | null;
    duplicateWarning: string | null;
    addressValidation: AddressValidationResult | null;
    audioQuality: "GOOD" | "POOR" | "DROPOUT";
}

const LiveCallContext = createContext<LiveCallContextType | undefined>(undefined);

async function fetchActiveCall(): Promise<any> {
    const res = await fetch('/api/calls/active');
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error('Failed to fetch active call');
    }
    return res.json();
}

export function LiveCallProvider({ children }: { children: ReactNode }) {
    const [liveCallData, setLiveCallData] = useState<LiveCallData | null>(null);
    const [interimTranscript, setInterimTranscript] = useState<string>("");
    const [isSimulating, setIsSimulating] = useState(false);
    const [isRehydrating, setIsRehydrating] = useState(true);

    // Singleton context extras
    const [detectedPostcode, setDetectedPostcode] = useState<string | null>(null);
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
    const [addressValidation, setAddressValidation] = useState<AddressValidationResult | null>(null);
    const [audioQuality, setAudioQuality] = useState<"GOOD" | "POOR" | "DROPOUT">("GOOD");

    const isSimulatingRef = useRef(false);
    const wsRef = useRef<WebSocket | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Derived state
    const isLive = liveCallData !== null;

    const clearCall = () => {
        setLiveCallData(null);
        setInterimTranscript("");
        setDetectedPostcode(null);
        setDuplicateWarning(null);
        setAddressValidation(null);
        setAudioQuality("GOOD");
    };

    const updateMetadata = (updates: Partial<LiveMetadataJson>) => {
        setLiveCallData(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                metadata: { ...prev.metadata, ...updates }
            };
        });
    };

    const startSimulation = (options?: SimulationOptions) => {
        if (isLive || isSimulatingRef.current) return;

        isSimulatingRef.current = true;
        setIsSimulating(true);

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
                    metadata: { urgency: 'Critical' as const, customerName: 'David Lee', address: '7 High St' },
                    analysis: { name: 'Emergency Locksmith', route: 'SITE_VISIT', script: "Don't worry, David. Our locksmith is nearby and can be there in 20 minutes." }
                },
                {
                    name: "Full House Paint",
                    segments: ["I've just bought a new place and I want the whole interior painted before we move in.", "It's a 3 bedroom semi. Are you guys available next week?"],
                    metadata: { urgency: 'Standard' as const, customerName: 'Sarah Jenkins', address: '12 Willow Way' },
                    analysis: { name: 'Full Interior Decorating', route: 'VIDEO_QUOTE', script: "Congratulations on the new place! To give you a precise quote for 3 bedrooms, could you send a video of the rooms?" }
                }
            ];

            const picked = randomScenarios[Math.floor(Math.random() * randomScenarios.length)];
            steps = [
                { type: 'segment', delay: 1000, text: picked.segments[0] },
                { type: 'segment', delay: 4000, text: picked.segments[1] },
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
        } else {
            steps = [
                { type: 'metadata', delay: 1000, data: { customerName: testName } },
                { type: 'segment', delay: 2000, text: "Hello, I have a problem with..." },
                { type: 'segment', delay: 1500, text: `my ${jobDesc}` },
                { type: 'transcription', delay: 500, text: `Hello, I have a problem with my ${jobDesc}` },
                {
                    type: 'analysis', delay: 1000, data: {
                        matched: true,
                        confidence: 85,
                        method: 'gpt',
                        rationale: 'Customer described a clear maintenance issue.',
                        nextRoute: 'INSTANT_PRICE',
                        sku: { name: 'Standard Callout', pricePence: 8500 }
                    }
                },
                { type: 'end', delay: 3000 }
            ];
        }

        let currentStep = 0;

        const runNextStep = () => {
            if (!isSimulatingRef.current || currentStep >= steps.length) {
                isSimulatingRef.current = false;
                setIsSimulating(false);
                return;
            }

            const step = steps[currentStep];
            const waitTime = step.delay || 1000;

            setTimeout(() => {
                if (!isSimulatingRef.current) return;

                switch (step.type) {
                    case 'metadata':
                        setLiveCallData(prev => prev ? ({ ...prev, metadata: { ...prev.metadata, ...step.data } }) : prev);
                        break;
                    case 'segment':
                        setLiveCallData(prev => prev ? ({
                            ...prev,
                            segments: [...prev.segments, {
                                speaker: 0,
                                text: step.text!,
                                start: Date.now(),
                                end: Date.now()
                            }]
                        }) : prev);
                        break;
                    case 'transcription':
                        setInterimTranscript(step.text!);
                        setLiveCallData(prev => prev ? ({ ...prev, transcription: step.text! }) : prev);
                        break;
                    case 'analysis':
                        setLiveCallData(prev => prev ? ({ ...prev, detection: step.data as any }) : prev);
                        break;
                    case 'end':
                        setLiveCallData(null);
                        setInterimTranscript("");
                        isSimulatingRef.current = false;
                        setIsSimulating(false);
                        break;
                }

                currentStep++;
                runNextStep();
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
                        setInterimTranscript("");
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

        ws.onmessage = (event) => {
            if (isSimulatingRef.current) return;

            try {
                const msg = JSON.parse(event.data);
                const callSid = msg.data?.callSid;

                // Handle both 'call_*' (legacy/simulation) and 'voice:*' (real backend) types if needed
                // But primarily we expect 'voice:*' from the backend now.

                if (msg.type === 'voice:call_started') {
                    console.log('[LiveCall] Call started:', callSid);
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
                                transcription: prev.transcription + " " + transcript,
                                segments: [...prev.segments, {
                                    speaker: 0, // Assume caller for now, or use msg.data.speaker if available
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
                        const metadata = msg.data.metadata ? { ...prev.metadata, ...msg.data.metadata } : prev.metadata;
                        return { ...prev, detection: msg.data.analysis, metadata };
                    });
                } else if (msg.type === 'voice:postcode_detected') {
                    console.log(`[LiveCall] Postcode detected: ${msg.data.postcode}`);
                    setDetectedPostcode(msg.data.postcode);
                } else if (msg.type === 'voice:address_validated') {
                    console.log(`[LiveCall] Address validated: ${msg.data.validation.confidence}% confidence`);
                    setAddressValidation(msg.data.validation);
                } else if (msg.type === 'voice:duplicate_check') {
                    console.log(`[LiveCall] Duplicate check warning: ${msg.data.warning}`);
                    setDuplicateWarning(msg.data.warning);
                } else if (msg.type === 'voice:audio_quality') {
                    setAudioQuality(msg.data.status); // GOOD, POOR, DROPOUT
                    if (msg.data.status === 'POOR') {
                        toast({ title: "Network Unstable", description: "Audio quality is degrading due to network conditions.", variant: "destructive" });
                    }
                } else if (msg.type === 'voice:call_ended') {
                    console.log('[LiveCall] Call ended:', callSid);
                    // Clear after a delay to show summary
                    setTimeout(() => {
                        setLiveCallData(null);
                        setInterimTranscript("");
                    }, 5000);
                    queryClient.invalidateQueries({ queryKey: ['calls'] });
                } else if (msg.type === 'call:created' || msg.type === 'call:updated' || msg.type === 'call:skus_detected') {
                    queryClient.invalidateQueries({ queryKey: ['calls'] });
                    if (msg.data.id) {
                        queryClient.invalidateQueries({ queryKey: ['call', msg.data.id] });
                    }
                }
            } catch (e) {
                console.error("Voice WS Parse Error", e);
            }
        };

        return () => ws.close();
    }, []);

    return (
        <LiveCallContext.Provider value={{
            isLive,
            liveCallData,
            interimTranscript,
            isSimulating,
            startSimulation,
            clearCall,
            updateMetadata,
            detectedPostcode,
            duplicateWarning,
            addressValidation,
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
