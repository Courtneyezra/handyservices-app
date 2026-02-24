/**
 * Call Script Tube Map Module
 *
 * Exports all call script types, configs, and utilities for the VA call flow system.
 */

// Re-export types from shared schema
export type {
    CallScriptStation,
    CallScriptSegment,
    CallScriptDestination,
    CallScriptCapturedInfo,
    CallScriptState,
    CallScriptStateWithJourney,
    SegmentConfig,
    LiveCallSession,
    InsertLiveCallSession,
    // Journey types
    JourneyStationType,
    StationOptionCondition,
    StationOptionAction,
    StationOption,
    JourneyStation,
    QuoteForkDestination,
    JourneyFinalDestination,
    SegmentJourney,
} from '../../shared/schema';

// Re-export value arrays for validation/iteration
export {
    CallScriptStationValues,
    CallScriptSegmentValues,
    CallScriptDestinationValues,
    liveCallSessions,
    insertLiveCallSessionSchema,
} from '../../shared/schema';

// Export segment configs and utilities
export {
    SEGMENT_CONFIGS,
    getSegmentConfig,
    getAllSegmentConfigs,
    detectSegmentFromText,
    getDefaultDestination,
} from './segment-config';

// Export station prompts and utilities
export {
    STATION_PROMPTS,
    DESTINATION_PROMPTS,
    getStationPrompt,
    getDestinationPrompt,
    getAllStationPrompts,
    getAllDestinationPrompts,
} from './station-prompts';

export type { StationPromptConfig, DestinationPromptConfig } from './station-prompts';

// Export segment journeys and utilities
export {
    SEGMENT_JOURNEYS,
    getSegmentJourney,
    getAllSegmentJourneys,
    getJourneyEntryStation,
    getJourneyStation,
    getNextStation,
    getJourneyDestinations,
    isOptionAvailable,
    getSegmentPrimaryFear,
    getSegmentOptimizations,
    SEGMENT_VA_PROMPTS,
} from './segment-journeys';

// Export state machine
export {
    CallScriptStateMachine,
} from './state-machine';

export type {
    StateMachineEventType,
    StateMachineEventHandler,
    StateMachineEventPayload,
    StationChangedEvent,
    SegmentDetectedEvent,
    SegmentConfirmedEvent,
    InfoCapturedEvent,
    QualifiedSetEvent,
    DestinationSelectedEvent,
    JourneyStartedEvent,
    JourneyStationChangedEvent,
    JourneyFlagSetEvent,
    JourneyResetEvent,
    ErrorEvent,
} from './state-machine';

// Export session manager
export {
    sessionManager,
    CallScriptSessionManager,
} from './session-manager';

export type { SessionMetadata } from './session-manager';

// Export realtime handler for WebSocket integration
export {
    initializeRealtimeHandler,
    initializeCallScriptForCall,
    handleTranscriptChunk,
    endCallScriptSession,
    handleVAAction,
    getActiveSession,
    hasActiveSession,
    getActiveSessionSummaries,
    getActiveSessionCount,
} from './realtime-handler';

// Export API routes
export { callScriptRouter, setSimulateBroadcast } from './routes';
