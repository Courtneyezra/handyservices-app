import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LiveCallTubeMap } from './LiveCallTubeMap';
import { useLiveCall } from '@/contexts/LiveCallContext';
import type { DetectedJob } from './JobsDetectedPanel';
import type {
  CallScriptStation,
  CallScriptSegment,
  CallScriptDestination,
  CallScriptCapturedInfo
} from '@shared/schema';
import {
  SEGMENT_JOURNEYS,
  getNextStation,
} from '@/config/segment-journeys-client';

interface LiveCallContainerProps {
  callId: string;
  phoneNumber?: string;
  // Optional: Initial state from server (for reconnection scenarios)
  initialStation?: CallScriptStation;
  initialCompletedStations?: CallScriptStation[];
  initialSegment?: CallScriptSegment | null;
  initialCapturedInfo?: Partial<CallScriptCapturedInfo>;
  // Optional: Initial detected jobs for testing
  initialDetectedJobs?: DetectedJob[];
}

// Segment option with confidence and signals
interface SegmentOption {
  segment: CallScriptSegment;
  confidence: number;
  signals: string[];
}

// Destination option with recommendation
interface DestinationOption {
  destination: CallScriptDestination;
  recommended: boolean;
  description: string;
}

// Station-specific prompts
const STATION_PROMPTS: Record<CallScriptStation, string> = {
  LISTEN: "Hi, how can I help you today?",
  SEGMENT: "Is this a rental property you own?",
  QUALIFY: "Are you the one making the decision on this work?",
  DESTINATION: "I can give you a price right now, or if you prefer, you can send us a quick video of the area.",
};

// Segment-specific tips
const SEGMENT_TIPS: Record<CallScriptSegment, string> = {
  LANDLORD: "Remote owner - emphasize photo reports and invoice by email. Mention tenant coordination.",
  BUSY_PRO: "Time is money - be concise, offer exact time slots, mention SMS updates.",
  PROP_MGR: "Portfolio angle - mention partner program for repeat work, bulk pricing.",
  OAP: "Trust is key - don't rush, mention insurance, be patient with questions.",
  SMALL_BIZ: "Zero disruption - work around business hours, emphasize reliability.",
  EMERGENCY: "Speed matters - confirm availability now, mention response time.",
  BUDGET: "Value focus - be transparent on pricing, no hidden fees.",
};

// Watch-for signals per segment
const SEGMENT_WATCH_FOR: Record<CallScriptSegment, string[]> = {
  LANDLORD: [
    'Mentions "agent" -> may be PROP_MGR',
    'Says "can\'t be there" -> offer tenant coordination',
  ],
  BUSY_PRO: [
    'Asks about exact time -> offer timed slots',
    'Mentions work schedule -> be flexible',
  ],
  PROP_MGR: [
    'Multiple properties -> mention bulk rates',
    'Agent reference -> verify decision authority',
  ],
  OAP: [
    'Hesitation -> offer to explain further',
    'Price concern -> emphasize value & guarantee',
  ],
  SMALL_BIZ: [
    'Business hours concern -> work evenings/weekends',
    'Mentions other tradespeople -> be flexible',
  ],
  EMERGENCY: [
    'Safety issue -> escalate priority',
    'Water/gas -> confirm isolation steps',
  ],
  BUDGET: [
    'Price shopping -> be transparent',
    'DIY mention -> explain why pro is better',
  ],
};

// Default destination options (updated based on recommendations from server)
const DEFAULT_DESTINATION_OPTIONS: DestinationOption[] = [
  { destination: 'INSTANT_QUOTE', recommended: false, description: 'Simple job, standard pricing' },
  { destination: 'VIDEO_REQUEST', recommended: false, description: 'Complex job, needs visual assessment' },
  { destination: 'SITE_VISIT', recommended: false, description: 'Requires in-person inspection' },
  { destination: 'EMERGENCY_DISPATCH', recommended: false, description: 'Urgent issue, same-day response' },
  { destination: 'EXIT', recommended: false, description: 'Not a fit, end call politely' },
];

export function LiveCallContainer({
  callId,
  phoneNumber,
  initialStation = 'LISTEN',
  initialCompletedStations = [],
  initialSegment = null,
  initialCapturedInfo = {},
  initialDetectedJobs = [],
}: LiveCallContainerProps) {
  // Get journey state from context
  const {
    journey,
    journeyActions,
    currentSegment: contextSegment,
    segmentConfidence: contextSegmentConfidence,
    segmentOptions: contextSegmentOptions,
    setCurrentSegment: contextSetCurrentSegment,
    skuMatched,
    hasUnmatchedSku,
    detectedJobs,
  } = useLiveCall();

  const [callDuration, setCallDuration] = useState(0);
  const [currentStation, setCurrentStation] = useState<CallScriptStation>(initialStation);
  const [completedStations, setCompletedStations] = useState<CallScriptStation[]>(initialCompletedStations);
  const [detectedSegment, setDetectedSegment] = useState<CallScriptSegment | null>(initialSegment);
  const [segmentConfidence, setSegmentConfidence] = useState(0);
  const [segmentOptions, setSegmentOptions] = useState<SegmentOption[]>([]);
  const [isQualified, setIsQualified] = useState<boolean | null>(null);
  const [selectedDestination, setSelectedDestination] = useState<CallScriptDestination | null>(null);
  const [recommendedDestination, setRecommendedDestination] = useState<CallScriptDestination | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const [capturedInfo, setCapturedInfo] = useState<CallScriptCapturedInfo>({
    job: initialCapturedInfo.job ?? null,
    postcode: initialCapturedInfo.postcode ?? null,
    name: initialCapturedInfo.name ?? null,
    contact: initialCapturedInfo.contact ?? null,
    isDecisionMaker: initialCapturedInfo.isDecisionMaker ?? null,
    isRemote: initialCapturedInfo.isRemote ?? null,
    hasTenant: initialCapturedInfo.hasTenant ?? null,
  });

  const wsRef = useRef<WebSocket | null>(null);

  // Sync context segment to local state
  useEffect(() => {
    if (contextSegment) {
      setDetectedSegment(contextSegment);
      setSegmentConfidence(contextSegmentConfidence);
    }
  }, [contextSegment, contextSegmentConfidence]);

  // Sync context segment options to local state
  useEffect(() => {
    if (contextSegmentOptions.length > 0) {
      setSegmentOptions(contextSegmentOptions);
    }
  }, [contextSegmentOptions]);

  // Timer for call duration
  useEffect(() => {
    const timer = setInterval(() => {
      setCallDuration(d => d + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch initial session state on mount
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const response = await fetch(`/api/call-script/session/${callId}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.state) {
            const state = data.state;
            setCurrentStation(state.currentStation);
            setCompletedStations(state.completedStations || []);
            setDetectedSegment(state.detectedSegment);
            setSegmentConfidence(state.segmentConfidence || 0);
            setCapturedInfo(state.capturedInfo || {});
            setIsQualified(state.isQualified);
            setRecommendedDestination(state.recommendedDestination);
            setSelectedDestination(state.selectedDestination);

            // Build segment options from signals if available
            if (state.detectedSegment && state.segmentSignals) {
              setSegmentOptions([{
                segment: state.detectedSegment,
                confidence: state.segmentConfidence || 0,
                signals: state.segmentSignals || [],
              }]);
            }
          }
        }
      } catch (error) {
        console.error('[LiveCall] Error fetching session:', error);
      }
    };

    fetchSession();
  }, [callId]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/client`);

    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[LiveCall] WebSocket connected');
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        // Only process messages for this call
        if (msg.data?.callId !== callId) return;

        switch (msg.type) {
          case 'callscript:session_started':
            console.log('[LiveCall] Session started');
            if (msg.data.state) {
              setCurrentStation(msg.data.state.currentStation);
              setCompletedStations(msg.data.state.completedStations || []);
            }
            break;

          case 'callscript:station_update':
            console.log('[LiveCall] Station update:', msg.data);
            if (msg.data.state) {
              setCurrentStation(msg.data.state.currentStation);
              setCompletedStations(msg.data.state.completedStations || []);
              setRecommendedDestination(msg.data.state.recommendedDestination);
            }
            break;

          case 'callscript:segment_detected':
            console.log('[LiveCall] Segment detected:', msg.data.segment, msg.data.confidence);
            setDetectedSegment(msg.data.segment);
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
            break;

          case 'callscript:segment_confirmed':
            console.log('[LiveCall] Segment confirmed:', msg.data.segment);
            setDetectedSegment(msg.data.segment);
            setSegmentConfidence(100);
            break;

          case 'callscript:info_captured':
            console.log('[LiveCall] Info captured:', msg.data.capturedInfo);
            setCapturedInfo(prev => ({
              ...prev,
              ...msg.data.capturedInfo,
            }));
            break;

          case 'callscript:qualified_set':
            console.log('[LiveCall] Qualified set:', msg.data.qualified);
            setIsQualified(msg.data.qualified);
            break;

          case 'callscript:destination_selected':
            console.log('[LiveCall] Destination selected:', msg.data.destination);
            setSelectedDestination(msg.data.destination);
            break;

          case 'callscript:session_ended':
            console.log('[LiveCall] Session ended');
            break;

          case 'callscript:error':
            console.error('[LiveCall] Error:', msg.data.message);
            break;
        }
      } catch (error) {
        console.error('[LiveCall] Error parsing WebSocket message:', error);
      }
    };

    ws.onclose = () => {
      console.log('[LiveCall] WebSocket disconnected');
      setWsConnected(false);
    };

    ws.onerror = (error) => {
      console.error('[LiveCall] WebSocket error:', error);
    };

    return () => {
      ws.close();
    };
  }, [callId]);

  // Handle station progression via API
  const handleConfirmStation = useCallback(async () => {
    try {
      const response = await fetch(`/api/call-script/session/${callId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_station', payload: {} }),
      });

      const result = await response.json();
      if (result.success && result.state) {
        setCurrentStation(result.state.currentStation);
        setCompletedStations(result.state.completedStations || []);
        setRecommendedDestination(result.state.recommendedDestination);
      } else {
        console.error('[LiveCall] Failed to confirm station:', result.error);
      }
    } catch (error) {
      console.error('[LiveCall] Error confirming station:', error);
    }
  }, [callId]);

  // Handle segment selection via API
  const handleSelectSegment = useCallback(async (segment: CallScriptSegment) => {
    try {
      const response = await fetch(`/api/call-script/session/${callId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select_segment', payload: { segment } }),
      });

      const result = await response.json();
      if (result.success) {
        setDetectedSegment(segment);
        setSegmentConfidence(100);
        // Also update the context
        contextSetCurrentSegment(segment);
        // Reset journey for new segment
        journeyActions.resetJourney();
        // Auto-advance to next station
        handleConfirmStation();
      } else {
        console.error('[LiveCall] Failed to select segment:', result.error);
      }
    } catch (error) {
      console.error('[LiveCall] Error selecting segment:', error);
    }
  }, [callId, handleConfirmStation, contextSetCurrentSegment, journeyActions]);

  // Handle qualification via API
  const handleSetQualified = useCallback(async (qualified: boolean) => {
    try {
      const response = await fetch(`/api/call-script/session/${callId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_qualified',
          payload: { qualified, notes: [] },
        }),
      });

      const result = await response.json();
      if (result.success) {
        setIsQualified(qualified);
        setCapturedInfo(prev => ({ ...prev, isDecisionMaker: qualified }));
        if (qualified) {
          handleConfirmStation();
        }
      } else {
        console.error('[LiveCall] Failed to set qualified:', result.error);
      }
    } catch (error) {
      console.error('[LiveCall] Error setting qualified:', error);
    }
  }, [callId, handleConfirmStation]);

  // Handle destination selection via API
  const handleSelectDestination = useCallback(async (destination: CallScriptDestination) => {
    try {
      const response = await fetch(`/api/call-script/session/${callId}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'select_destination', payload: { destination } }),
      });

      const result = await response.json();
      if (result.success) {
        setSelectedDestination(destination);
        console.log(`[LiveCall] Selected destination: ${destination}`);
      } else {
        console.error('[LiveCall] Failed to select destination:', result.error);
      }
    } catch (error) {
      console.error('[LiveCall] Error selecting destination:', error);
    }
  }, [callId]);

  // Handle journey station click
  const handleJourneyStationClick = useCallback((stationId: string) => {
    // For now, just log - clicking might navigate or show details
    console.log('[LiveCall] Station clicked:', stationId);
  }, []);

  // Handle journey option selection
  const handleJourneyOptionSelect = useCallback((stationId: string, optionId: string) => {
    console.log('[LiveCall] Option selected:', stationId, optionId);

    if (!detectedSegment) return;

    // Get the journey config for the current segment
    const journeyConfig = SEGMENT_JOURNEYS[detectedSegment];
    if (!journeyConfig) return;

    // Find the next station from the option
    const nextStation = getNextStation(journeyConfig, stationId, optionId);

    // Update journey state via context
    journeyActions.selectOption(stationId, optionId, nextStation?.id);
  }, [detectedSegment, journeyActions]);

  // Derive current prompt based on station
  const currentPrompt = STATION_PROMPTS[currentStation];

  // Derive segment tip and watch-for signals
  const segmentTip = detectedSegment ? SEGMENT_TIPS[detectedSegment] : null;
  const watchFor = detectedSegment ? SEGMENT_WATCH_FOR[detectedSegment] : [];

  // Use recommended destination from server, or derive from segment and info
  const effectiveRecommendedDestination: CallScriptDestination =
    recommendedDestination ||
    (detectedSegment === 'EMERGENCY' ? 'EMERGENCY_DISPATCH' :
    capturedInfo.job && capturedInfo.postcode ? 'INSTANT_QUOTE' :
    'VIDEO_REQUEST');

  // Update destination options with current recommendation
  // Filter INSTANT_QUOTE if SKU is not matched (hasUnmatchedSku is true)
  const destinationOptions = DEFAULT_DESTINATION_OPTIONS
    .filter(opt => {
      // Only show INSTANT_QUOTE if all SKUs are matched
      if (opt.destination === 'INSTANT_QUOTE' && hasUnmatchedSku) {
        return false;
      }
      return true;
    })
    .map(opt => ({
      ...opt,
      recommended: opt.destination === effectiveRecommendedDestination,
    }));

  // Default segment options if none from server yet
  const effectiveSegmentOptions = segmentOptions.length > 0
    ? segmentOptions
    : detectedSegment
      ? [{ segment: detectedSegment, confidence: segmentConfidence, signals: [] }]
      : [];

  return (
    <LiveCallTubeMap
      callId={callId}
      phoneNumber={phoneNumber}
      callDuration={callDuration}
      currentStation={currentStation}
      completedStations={completedStations}
      detectedSegment={detectedSegment}
      segmentConfidence={segmentConfidence}
      segmentOptions={effectiveSegmentOptions}
      capturedInfo={capturedInfo}
      isQualified={isQualified}
      recommendedDestination={effectiveRecommendedDestination}
      destinationOptions={destinationOptions}
      currentPrompt={currentPrompt}
      watchFor={watchFor}
      segmentTip={segmentTip}
      onConfirmStation={handleConfirmStation}
      onSelectSegment={handleSelectSegment}
      onSetQualified={handleSetQualified}
      onSelectDestination={handleSelectDestination}
      // New journey props
      journey={journey}
      journeyActions={journeyActions}
      onJourneyStationClick={handleJourneyStationClick}
      onJourneyOptionSelect={handleJourneyOptionSelect}
      skuMatched={skuMatched}
      detectedJobs={detectedJobs.length > 0 ? detectedJobs : initialDetectedJobs}
    />
  );
}

export default LiveCallContainer;
