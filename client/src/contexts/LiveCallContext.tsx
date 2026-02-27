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

// Route recommendation from tiered job classification
export interface RouteRecommendation {
    route: 'instant' | 'video' | 'visit' | 'refer';
    color: string;
    reason: string;
    confidence: number;
}

// Connection state for WebSocket reconnection
export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

// Call ended state for showing "reviewing summary" indicator
export type CallEndedState = 'active' | 'ended_reviewing' | 'cleared';

interface LiveCallContextType {
    isLive: boolean; // Derived: if liveCallData !== null
    activeCallSid: string | null; // Current call SID for tube map integration
    liveCallData: LiveCallData | null;
    interimTranscript: string;
    isSimulating: boolean;
    connectionState: ConnectionState; // WebSocket connection state
    callEndedState: CallEndedState; // Track call end state for UI indicator
    startSimulation: (options?: SimulationOptions) => void;
    startCallScriptSimulation: (transcript: string[]) => Promise<string | null>;
    clearCall: () => void;
    keepCallOpen: () => void; // Prevent auto-clear
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
    routeRecommendation: RouteRecommendation | null;
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
    const [routeRecommendation, setRouteRecommendation] = useState<RouteRecommendation | null>(null);

    // Extracted customer info from voice analysis
    const [extractedCustomerInfo, setExtractedCustomerInfo] = useState<ExtractedCustomerInfo>(DEFAULT_EXTRACTED_CUSTOMER_INFO);

    // Call ended state for UI indicator
    const [callEndedState, setCallEndedState] = useState<CallEndedState>('cleared');
    const callEndedTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const isSimulatingRef = useRef(false);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectAttemptsRef = useRef(0);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const queryClient = useQueryClient();
    const { toast } = useToast();

    // WebSocket connection state
    const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');

    // Derived state
    const isLive = liveCallData !== null;

    const clearCall = () => {
        // Cancel any pending auto-clear timeout
        if (callEndedTimeoutRef.current) {
            clearTimeout(callEndedTimeoutRef.current);
            callEndedTimeoutRef.current = null;
        }
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
        setRouteRecommendation(null);
        setExtractedCustomerInfo(DEFAULT_EXTRACTED_CUSTOMER_INFO);
        setCallEndedState('cleared');
    };

    // Keep call open - cancel auto-clear timeout
    const keepCallOpen = useCallback(() => {
        if (callEndedTimeoutRef.current) {
            clearTimeout(callEndedTimeoutRef.current);
            callEndedTimeoutRef.current = null;
        }
        // Stay in ended_reviewing state but don't auto-clear
        console.log('[LiveCall] Keep open requested - auto-clear cancelled');
    }, []);

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

                const fullTranscript = transcript.join(' ');

                setLiveCallData({
                    transcription: fullTranscript,
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

                // Run full simulation analysis: SKU detection + Segment classification + Info extraction
                try {
                    const analysisResponse = await fetch('/api/test/simulate-full', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ transcript })
                    });

                    if (analysisResponse.ok) {
                        const analysisData = await analysisResponse.json();
                        console.log('[LiveCall] Full simulation analysis:', analysisData);

                        // Convert to DetectedJob format and update state
                        const jobs: DetectedJob[] = [];

                        // Add matched jobs
                        analysisData.matchedServices?.forEach((match: any, i: number) => {
                            jobs.push({
                                id: `matched-${i}-${Date.now()}`,
                                description: match.task?.description || match.sku?.name || 'Unknown job',
                                matched: true,
                                sku: match.sku ? {
                                    id: match.sku.id,
                                    skuCode: match.sku.skuCode,
                                    name: match.sku.name,
                                    pricePence: match.sku.pricePence,
                                    timeEstimateMinutes: match.sku.timeEstimateMinutes,
                                    category: match.sku.category,
                                } : undefined,
                                confidence: match.confidence,
                            });
                        });

                        // Add unmatched jobs
                        analysisData.unmatchedTasks?.forEach((task: any, i: number) => {
                            jobs.push({
                                id: `unmatched-${i}-${Date.now()}`,
                                description: task.description || 'Unknown job',
                                matched: false,
                            });
                        });

                        setDetectedJobs(jobs);
                        setSkuMatched(jobs.some(j => j.matched));
                        setHasUnmatchedSku(jobs.some(j => !j.matched));

                        // Update segment state
                        if (analysisData.segment) {
                            setCurrentSegmentState(analysisData.segment);
                            setSegmentConfidence(analysisData.segmentConfidence || 0);
                            setSegmentOptions(analysisData.segmentOptions || []);
                        }

                        // Update extracted customer info
                        if (analysisData.extractedInfo) {
                            const postcode = analysisData.extractedInfo.postcode || '';
                            const address = analysisData.extractedInfo.address || '';
                            // Combine address and postcode if both exist
                            const fullAddress = address && postcode ? `${address}, ${postcode}` :
                                               address || postcode || '';

                            setExtractedCustomerInfo({
                                name: analysisData.extractedInfo.name || '',
                                address: fullAddress,
                                postcode: postcode,
                            });
                        }

                        // Update detection info and metadata
                        setLiveCallData(prev => prev ? {
                            ...prev,
                            detection: {
                                ...prev.detection,
                                matched: jobs.some(j => j.matched),
                                nextRoute: analysisData.nextRoute || 'VIDEO_QUOTE',
                                rationale: `Detected ${jobs.filter(j => j.matched).length} matched, ${jobs.filter(j => !j.matched).length} unmatched jobs`,
                            },
                            metadata: {
                                ...prev.metadata,
                                customerName: analysisData.extractedInfo?.name || prev.metadata.customerName,
                                leadType: analysisData.segment === 'LANDLORD' ? 'Landlord' :
                                         analysisData.segment === 'PROP_MGR' ? 'Commercial' : 'Homeowner',
                            }
                        } : prev);
                    }
                } catch (analysisError) {
                    console.error('[LiveCall] Simulation analysis failed:', analysisError);
                }

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

    // WebSocket reconnection constants
    const MAX_RECONNECT_ATTEMPTS = 5;
    const BASE_RECONNECT_DELAY = 1000; // 1 second
    const MAX_RECONNECT_DELAY = 16000; // 16 seconds

    const calculateBackoffDelay = useCallback((attempt: number): number => {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        const delay = Math.min(BASE_RECONNECT_DELAY * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
        return delay;
    }, []);

    const connectWebSocket = useCallback(() => {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/api/ws/client`;
        console.log('[LiveCall] Connecting to WebSocket:', wsUrl);

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = async () => {
            console.log('[LiveCall] WebSocket CONNECTED');
            setConnectionState('connected');
            reconnectAttemptsRef.current = 0; // Reset attempts on successful connection

            // F2: Rehydrate from any active call in DB
            if (!isSimulatingRef.current) {
                setIsRehydrating(true);
                try {
                    const response = await fetchActiveCall();
                    const activeCall = response?.activeCall;
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

                        // Rehydrate detected jobs from detectedSkusJson
                        if (activeCall.detectedSkusJson?.tasks) {
                            console.log('[LiveCall] Rehydrating jobs from detectedSkusJson:', activeCall.detectedSkusJson.tasks.length);
                            const jobs: DetectedJob[] = activeCall.detectedSkusJson.tasks.map((task: any, i: number) => ({
                                id: `rehydrated-${i}-${Date.now()}`,
                                description: task.description || 'Unknown job',
                                matched: task.confidence > 50, // Confidence > 50% = matched
                                confidence: task.confidence || 0,
                                // If there's price info, treat as having SKU match
                                sku: task.priceEstimate > 0 ? {
                                    id: `sku-${i}`,
                                    name: task.description,
                                    pricePence: task.priceEstimate,
                                } : undefined,
                                // Traffic light based on confidence: >70 = green, >30 = amber, else red
                                trafficLight: task.confidence > 70 ? 'green' : task.confidence > 30 ? 'amber' : 'amber',
                            }));
                            setDetectedJobs(jobs);
                            setSkuMatched(jobs.some(j => j.matched));
                            setHasUnmatchedSku(jobs.some(j => !j.matched));

                            // Set route recommendation based on recommendedAction
                            const recommendedAction = activeCall.detectedSkusJson.recommendedAction;
                            if (recommendedAction) {
                                const routeMap: Record<string, RouteRecommendation> = {
                                    'request_video': { route: 'video', color: '#F59E0B', reason: 'Video requested for unpriced jobs', confidence: 80 },
                                    'send_quote': { route: 'instant', color: '#22C55E', reason: 'All jobs priced', confidence: 90 },
                                    'book_visit': { route: 'visit', color: '#3B82F6', reason: 'Site visit required', confidence: 85 },
                                };
                                if (routeMap[recommendedAction]) {
                                    setRouteRecommendation(routeMap[recommendedAction]);
                                }
                            }
                        }

                        // Rehydrate segment info if available
                        if (activeCall.metadataJson?.leadType) {
                            const leadTypeToSegment: Record<string, CallScriptSegment> = {
                                'Landlord': 'LANDLORD',
                                'Commercial': 'PROP_MGR',
                                'Homeowner': 'BUSY_PRO',
                            };
                            const segment = leadTypeToSegment[activeCall.metadataJson.leadType];
                            if (segment) {
                                setCurrentSegmentState(segment);
                                setSegmentConfidence(70);
                            }
                        }

                        // Rehydrate customer info for CallHUD
                        if (activeCall.metadataJson) {
                            const postcode = activeCall.metadataJson.postcode || '';
                            const address = activeCall.metadataJson.address || activeCall.address || '';
                            setExtractedCustomerInfo({
                                name: activeCall.metadataJson.customerName || activeCall.customerName || '',
                                address: address,
                                postcode: postcode,
                            });
                        }
                    }
                } catch (e) {
                    console.error('[LiveCall] Rehydration failed:', e);
                } finally {
                    setIsRehydrating(false);
                }
            }
        };

        ws.onclose = (event) => {
            console.log('[LiveCall] WebSocket CLOSED:', event.code, event.reason);
            wsRef.current = null;

            // Don't reconnect if this was a clean close (code 1000) or intentional
            if (event.code === 1000) {
                setConnectionState('disconnected');
                return;
            }

            // Attempt reconnection with exponential backoff
            if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
                setConnectionState('reconnecting');
                const delay = calculateBackoffDelay(reconnectAttemptsRef.current);
                console.log(`[LiveCall] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${MAX_RECONNECT_ATTEMPTS})`);

                reconnectTimeoutRef.current = setTimeout(() => {
                    reconnectAttemptsRef.current++;
                    connectWebSocket();
                }, delay);
            } else {
                console.error('[LiveCall] Max reconnection attempts reached. Connection lost.');
                setConnectionState('disconnected');
                toast({
                    title: "Connection Lost",
                    description: "Unable to reconnect to live call updates. Please refresh the page.",
                    variant: "destructive",
                });
            }
        };

        ws.onerror = (error) => {
            console.error('[LiveCall] WebSocket error:', error);
            // The onclose handler will be called after this, which handles reconnection
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
                    // Cancel any pending auto-clear from previous call
                    if (callEndedTimeoutRef.current) {
                        clearTimeout(callEndedTimeoutRef.current);
                        callEndedTimeoutRef.current = null;
                    }
                    setCallEndedState('active');
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
                    // Set state to show "reviewing summary" indicator
                    setCallEndedState('ended_reviewing');

                    // Clear any existing timeout
                    if (callEndedTimeoutRef.current) {
                        clearTimeout(callEndedTimeoutRef.current);
                    }

                    // Clear after 15 seconds to allow VA to review summary and take actions
                    callEndedTimeoutRef.current = setTimeout(() => {
                        setLiveCallData(null);
                        setActiveCallSid(null);
                        setInterimTranscript("");
                        setCallEndedState('cleared');
                        callEndedTimeoutRef.current = null;
                    }, 15000);
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
                    // Full jobs list update with tiered classification
                    console.log('[LiveCall] Jobs update:', msg.data.jobs, 'Route:', msg.data.routeRecommendation, 'Tier:', msg.data.tier);
                    setDetectedJobs(msg.data.jobs || []);
                    if (msg.data.routeRecommendation) {
                        setRouteRecommendation(msg.data.routeRecommendation);
                    }
                }
            } catch (e) {
                console.error("Voice WS Parse Error", e);
            }
        };

        return ws;
    }, [calculateBackoffDelay, toast]);

    useEffect(() => {
        connectWebSocket();

        return () => {
            // Clean up on unmount
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            if (callEndedTimeoutRef.current) {
                clearTimeout(callEndedTimeoutRef.current);
            }
            if (wsRef.current) {
                wsRef.current.close(1000, 'Component unmounting'); // Clean close
            }
        };
    }, [connectWebSocket]);

    return (
        <LiveCallContext.Provider value={{
            isLive,
            activeCallSid,
            liveCallData,
            interimTranscript,
            isSimulating,
            connectionState,
            callEndedState,
            startSimulation,
            startCallScriptSimulation,
            clearCall,
            keepCallOpen,
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
            routeRecommendation,
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
