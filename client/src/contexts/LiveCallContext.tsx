import React, { createContext, useContext, useState, useEffect, useRef, ReactNode, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from "@/hooks/use-toast";
import type { CallScriptSegment } from '@shared/schema';
import type { DetectedJob } from '@/components/live-call/JobsDetectedPanel';

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
    hasUnmatched?: boolean; // True if any jobs couldn't be matched to SKUs
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

// Journey state types for tube map
export interface JourneyState {
    currentStation: string;
    completedStations: string[];
    journeyFlags: Record<string, boolean | string>;
    journeyPath: string[]; // History of visited stations
}

export interface JourneyActions {
    setCurrentStation: (stationId: string) => void;
    completeStation: (stationId: string) => void;
    selectOption: (stationId: string, optionId: string, nextStationId?: string) => void;
    setJourneyFlag: (key: string, value: boolean | string) => void;
    resetJourney: () => void;
    goBack: () => void;
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

// Segment option from AI detection
export interface SegmentOption {
    segment: CallScriptSegment;
    confidence: number;
    signals: string[];
}

// Extracted customer info from voice analysis
export interface ExtractedCustomerInfo {
    name: string;
    address: string;
    postcode: string;
}

interface LiveCallContextType {
    isLive: boolean; // Derived: if liveCallData !== null
    activeCallSid: string | null; // Current call SID for tube map integration
    liveCallData: LiveCallData | null;
    interimTranscript: string;
    isSimulating: boolean;
    startSimulation: (options?: SimulationOptions) => void;
    startCallScriptSimulation: (transcript: string[]) => Promise<string | null>;
    clearCall: () => void;
    updateMetadata: (updates: Partial<LiveMetadataJson>) => void;
    detectedPostcode: string | null;
    duplicateWarning: string | null;
    addressValidation: AddressValidationResult | null;
    audioQuality: "GOOD" | "POOR" | "DROPOUT";

    // Extracted customer info from voice analysis (for CallHUD auto-population)
    extractedCustomerInfo: ExtractedCustomerInfo;

    // Journey state for tube map
    journey: JourneyState;
    journeyActions: JourneyActions;

    // Segment state
    currentSegment: CallScriptSegment | null;
    segmentConfidence: number;
    segmentOptions: SegmentOption[];
    setCurrentSegment: (segment: CallScriptSegment) => void;

    // SKU detection state
    skuMatched: boolean;
    hasUnmatchedSku: boolean;

    // Jobs detection state
    detectedJobs: DetectedJob[];
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

// Default journey state
const DEFAULT_JOURNEY_STATE: JourneyState = {
    currentStation: 'opening',
    completedStations: [],
    journeyFlags: {},
    journeyPath: ['opening'],
};

// Default extracted customer info
const DEFAULT_EXTRACTED_CUSTOMER_INFO: ExtractedCustomerInfo = {
    name: '',
    address: '',
    postcode: '',
};

export function LiveCallProvider({ children }: { children: ReactNode }) {
    const [liveCallData, setLiveCallData] = useState<LiveCallData | null>(null);
    const [activeCallSid, setActiveCallSid] = useState<string | null>(null);
    const [interimTranscript, setInterimTranscript] = useState<string>("");
    const [isSimulating, setIsSimulating] = useState(false);
    const [isRehydrating, setIsRehydrating] = useState(true);

    // Singleton context extras
    const [detectedPostcode, setDetectedPostcode] = useState<string | null>(null);
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
    const [addressValidation, setAddressValidation] = useState<AddressValidationResult | null>(null);
    const [audioQuality, setAudioQuality] = useState<"GOOD" | "POOR" | "DROPOUT">("GOOD");

    // Journey state for tube map
    const [journey, setJourney] = useState<JourneyState>(DEFAULT_JOURNEY_STATE);

    // Segment state
    const [currentSegment, setCurrentSegmentState] = useState<CallScriptSegment | null>(null);
    const [segmentConfidence, setSegmentConfidence] = useState<number>(0);
    const [segmentOptions, setSegmentOptions] = useState<SegmentOption[]>([]);

    // SKU detection state
    const [skuMatched, setSkuMatched] = useState<boolean>(false);
    const [hasUnmatchedSku, setHasUnmatchedSku] = useState<boolean>(true);

    // Jobs detection state
    const [detectedJobs, setDetectedJobs] = useState<DetectedJob[]>([]);

    // Extracted customer info from voice analysis
    const [extractedCustomerInfo, setExtractedCustomerInfo] = useState<ExtractedCustomerInfo>(DEFAULT_EXTRACTED_CUSTOMER_INFO);

    const isSimulatingRef = useRef(false);
    const wsRef = useRef<WebSocket | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // Derived state
    const isLive = liveCallData !== null;

    const clearCall = () => {
        setLiveCallData(null);
        setActiveCallSid(null);
        setInterimTranscript("");
        setDetectedPostcode(null);
        setDuplicateWarning(null);
        setAddressValidation(null);
        setAudioQuality("GOOD");
        // Reset journey state
        setJourney(DEFAULT_JOURNEY_STATE);
        setCurrentSegmentState(null);
        setSegmentConfidence(0);
        setSegmentOptions([]);
        setSkuMatched(false);
        setHasUnmatchedSku(true);
        setDetectedJobs([]);
        setExtractedCustomerInfo(DEFAULT_EXTRACTED_CUSTOMER_INFO);
    };

    // Journey actions
    const setCurrentStation = useCallback((stationId: string) => {
        setJourney(prev => ({
            ...prev,
            currentStation: stationId,
            journeyPath: [...prev.journeyPath, stationId],
        }));
    }, []);

    const completeStation = useCallback((stationId: string) => {
        setJourney(prev => ({
            ...prev,
            completedStations: prev.completedStations.includes(stationId)
                ? prev.completedStations
                : [...prev.completedStations, stationId],
        }));
    }, []);

    const selectOption = useCallback((stationId: string, optionId: string, nextStationId?: string) => {
        setJourney(prev => {
            const newState: JourneyState = {
                ...prev,
                completedStations: prev.completedStations.includes(stationId)
                    ? prev.completedStations
                    : [...prev.completedStations, stationId],
                journeyFlags: {
                    ...prev.journeyFlags,
                    [`${stationId}_selected`]: optionId,
                },
            };

            if (nextStationId) {
                newState.currentStation = nextStationId;
                newState.journeyPath = [...prev.journeyPath, nextStationId];
            }

            return newState;
        });
    }, []);

    const setJourneyFlag = useCallback((key: string, value: boolean | string) => {
        setJourney(prev => ({
            ...prev,
            journeyFlags: {
                ...prev.journeyFlags,
                [key]: value,
            },
        }));
    }, []);

    const resetJourney = useCallback(() => {
        setJourney(DEFAULT_JOURNEY_STATE);
    }, []);

    const goBack = useCallback(() => {
        setJourney(prev => {
            if (prev.journeyPath.length <= 1) return prev;

            const newPath = prev.journeyPath.slice(0, -1);
            const previousStation = newPath[newPath.length - 1];

            // Remove the current station from completed if it was there
            const newCompleted = prev.completedStations.filter(
                s => s !== prev.currentStation
            );

            return {
                ...prev,
                currentStation: previousStation,
                completedStations: newCompleted,
                journeyPath: newPath,
            };
        });
    }, []);

    // Segment selection
    const setCurrentSegment = useCallback((segment: CallScriptSegment) => {
        setCurrentSegmentState(segment);
        setSegmentConfidence(100); // Manual selection = 100% confidence
        // Reset journey when segment changes
        setJourney(DEFAULT_JOURNEY_STATE);
    }, []);

    // Journey actions object for context
    const journeyActions: JourneyActions = {
        setCurrentStation,
        completeStation,
        selectOption,
        setJourneyFlag,
        resetJourney,
        goBack,
    };

    // Start a call script simulation via API and update state directly
    const startCallScriptSimulation = async (transcript: string[]): Promise<string | null> => {
        if (isLive) return null;

        try {
            const response = await fetch('/api/call-script/simulate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: '+447700900123',
                    transcript
                })
            });

            const data = await response.json();
            if (data.success && data.callId) {
                // Set state directly to activate the UI
                setActiveCallSid(data.callId);
                setLiveCallData({
                    transcription: transcript.join(' '),
                    segments: transcript.map((text, i) => ({
                        speaker: 0 as const,
                        text,
                        start: Date.now() + i * 1000,
                        end: Date.now() + i * 1000 + 500,
                    })),
                    detection: {
                        matched: !!data.state?.detectedSegment,
                        sku: null,
                        confidence: data.state?.segmentConfidence || 0,
                        method: 'realtime',
                        rationale: `Detected: ${data.state?.detectedSegment || 'Unknown'}`,
                        nextRoute: 'UNKNOWN',
                    },
                    metadata: {
                        customerName: 'Simulated Caller',
                        address: null,
                        urgency: 'Standard',
                        leadType: 'Unknown',
                        phoneNumber: '+447700900123',
                    }
                });

                console.log('[LiveCall] Call script simulation started:', data.callId);
                return data.callId;
            } else {
                console.error('[LiveCall] Simulation failed:', data.error);
                return null;
            }
        } catch (error) {
            console.error('[LiveCall] Error starting simulation:', error);
            return null;
        }
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
                        setActiveCallSid(activeCall.callSid || activeCall.id);
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
                    setActiveCallSid(callSid);
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
                    // Update extracted customer info for CallHUD auto-population
                    const metadata = msg.data.metadata;
                    if (metadata) {
                        setExtractedCustomerInfo(prev => {
                            const updates: Partial<ExtractedCustomerInfo> = {};
                            if (metadata.customerName) {
                                updates.name = metadata.customerName;
                            }
                            if (metadata.address) {
                                updates.address = metadata.address;
                            }
                            if (metadata.postcode) {
                                updates.postcode = metadata.postcode;
                            }
                            return Object.keys(updates).length > 0 ? { ...prev, ...updates } : prev;
                        });
                    }
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
                        setActiveCallSid(null);
                        setInterimTranscript("");
                    }, 5000);
                    queryClient.invalidateQueries({ queryKey: ['calls'] });
                } else if (msg.type === 'call:created' || msg.type === 'call:updated' || msg.type === 'call:skus_detected') {
                    queryClient.invalidateQueries({ queryKey: ['calls'] });
                    if (msg.data.id) {
                        queryClient.invalidateQueries({ queryKey: ['call', msg.data.id] });
                    }
                }
                // Journey & Segment related messages
                else if (msg.type === 'callscript:segment_detected') {
                    console.log('[LiveCall] Segment detected:', msg.data.segment, msg.data.confidence);
                    setCurrentSegmentState(msg.data.segment);
                    setSegmentConfidence(msg.data.confidence);

                    // Build segment options from primary and alternatives
                    const options: SegmentOption[] = [{
                        segment: msg.data.segment,
                        confidence: msg.data.confidence,
                        signals: msg.data.signals || [],
                    }];

                    if (msg.data.alternatives) {
                        options.push(...msg.data.alternatives.map((alt: any) => ({
                            segment: alt.segment,
                            confidence: alt.confidence,
                            signals: alt.signals || [],
                        })));
                    }

                    // Sort by confidence and take top 3
                    options.sort((a, b) => b.confidence - a.confidence);
                    setSegmentOptions(options.slice(0, 3));
                }
                else if (msg.type === 'callscript:segment_confirmed') {
                    console.log('[LiveCall] Segment confirmed:', msg.data.segment);
                    setCurrentSegmentState(msg.data.segment);
                    setSegmentConfidence(100);
                }
                else if (msg.type === 'callscript:journey_update') {
                    console.log('[LiveCall] Journey update:', msg.data);
                    if (msg.data.journey) {
                        setJourney(msg.data.journey);
                    }
                }
                else if (msg.type === 'callscript:sku_match_update') {
                    console.log('[LiveCall] SKU match update:', msg.data);
                    setSkuMatched(msg.data.matched || false);
                    setHasUnmatchedSku(msg.data.hasUnmatched ?? true);
                }
                else if (msg.type === 'callscript:job_detected') {
                    console.log('[LiveCall] Job detected:', msg.data);
                    const newJob: DetectedJob = {
                        id: msg.data.id || `job-${Date.now()}`,
                        description: msg.data.description,
                        matched: msg.data.matched || false,
                        sku: msg.data.sku,
                        confidence: msg.data.confidence,
                        timestamp: new Date(),
                    };
                    setDetectedJobs(prev => [...prev, newJob]);

                    // Update SKU match status based on jobs
                    if (newJob.matched && newJob.sku) {
                        setSkuMatched(true);
                    }
                    if (!newJob.matched) {
                        setHasUnmatchedSku(true);
                    }
                }
                else if (msg.type === 'callscript:jobs_update') {
                    // Full jobs list update
                    console.log('[LiveCall] Jobs update:', msg.data.jobs);
                    setDetectedJobs(msg.data.jobs || []);
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
            activeCallSid,
            liveCallData,
            interimTranscript,
            isSimulating,
            startSimulation,
            startCallScriptSimulation,
            clearCall,
            updateMetadata,
            detectedPostcode,
            duplicateWarning,
            addressValidation,
            audioQuality,

            // Extracted customer info from voice analysis (for CallHUD auto-population)
            extractedCustomerInfo,

            // Journey state for tube map
            journey,
            journeyActions,

            // Segment state
            currentSegment,
            segmentConfidence,
            segmentOptions,
            setCurrentSegment,

            // SKU detection state
            skuMatched,
            hasUnmatchedSku,

            // Jobs detection state
            detectedJobs,
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
