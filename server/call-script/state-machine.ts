/**
 * Call Script State Machine
 *
 * Manages the state transitions for VA-guided calls through the Tube Map flow:
 * LISTEN -> SEGMENT -> QUALIFY -> DESTINATION
 *
 * Features:
 * - Event-driven architecture for WebSocket integration
 * - Station validation and transition guards
 * - Segment detection and confirmation
 * - Qualification tracking
 * - Destination recommendation based on segment
 *
 * Owner: Agent 2 (State Machine Agent)
 */

import {
    CallScriptStation,
    CallScriptState,
    CallScriptSegment,
    CallScriptDestination,
    CallScriptCapturedInfo,
    CallScriptStationValues,
    CallScriptStateWithJourney,
    JourneyStation,
    StationOption,
} from '../../shared/schema';
import { SEGMENT_CONFIGS, getDefaultDestination } from './segment-config';
import { STATION_PROMPTS, DESTINATION_PROMPTS } from './station-prompts';
import {
    getSegmentJourney,
    getJourneyEntryStation,
    getJourneyStation,
    getNextStation,
    isOptionAvailable,
} from './segment-journeys';

/**
 * Event types emitted by the state machine
 */
export type StateMachineEventType =
    | 'station:changed'
    | 'segment:detected'
    | 'segment:confirmed'
    | 'info:captured'
    | 'qualified:set'
    | 'destination:selected'
    | 'journey:started'
    | 'journey:station:changed'
    | 'journey:flag:set'
    | 'journey:reset'
    | 'error';

/**
 * Event payload types
 */
export interface StationChangedEvent {
    from: CallScriptStation;
    to: CallScriptStation;
}

export interface SegmentDetectedEvent {
    segment: CallScriptSegment;
    confidence: number;
    signals: string[];
}

export interface SegmentConfirmedEvent {
    segment: CallScriptSegment;
}

export interface InfoCapturedEvent {
    updates: Partial<CallScriptCapturedInfo>;
}

export interface QualifiedSetEvent {
    qualified: boolean;
    notes: string[];
}

export interface DestinationSelectedEvent {
    destination: CallScriptDestination;
}

export interface ErrorEvent {
    message: string;
    context?: Record<string, unknown>;
}

export interface JourneyStartedEvent {
    segmentId: CallScriptSegment;
    entryStation: string;
}

export interface JourneyStationChangedEvent {
    from: string | null;
    to: string;
    station: JourneyStation;
}

export interface JourneyFlagSetEvent {
    flags: Record<string, boolean | string>;
}

export interface JourneyResetEvent {
    reason: 'segment_change' | 'manual_reset';
    previousSegment: CallScriptSegment | null;
}

export type StateMachineEventPayload =
    | StationChangedEvent
    | SegmentDetectedEvent
    | SegmentConfirmedEvent
    | InfoCapturedEvent
    | QualifiedSetEvent
    | DestinationSelectedEvent
    | JourneyStartedEvent
    | JourneyStationChangedEvent
    | JourneyFlagSetEvent
    | JourneyResetEvent
    | ErrorEvent;

export type StateMachineEventHandler = (data: StateMachineEventPayload) => void;

/**
 * Call Script State Machine
 *
 * Manages state transitions for a single call through the Tube Map flow.
 * Now with segment journey tree tracking.
 */
export class CallScriptStateMachine {
    private state: CallScriptStateWithJourney;
    private listeners: Map<string, StateMachineEventHandler[]> = new Map();

    constructor(callId: string, initialState?: Partial<CallScriptStateWithJourney>) {
        this.state = this.createInitialState(callId, initialState);
    }

    /**
     * Create initial state with defaults (including journey tracking)
     */
    private createInitialState(callId: string, overrides?: Partial<CallScriptStateWithJourney>): CallScriptStateWithJourney {
        const now = new Date();
        const defaultState: CallScriptStateWithJourney = {
            callId,
            currentStation: 'LISTEN',
            completedStations: [],
            detectedSegment: null,
            segmentConfidence: 0,
            segmentSignals: [],
            capturedInfo: {
                job: null,
                postcode: null,
                name: null,
                contact: null,
                isDecisionMaker: null,
                isRemote: null,
                hasTenant: null,
            },
            isQualified: null,
            qualificationNotes: [],
            recommendedDestination: null,
            selectedDestination: null,
            stationEnteredAt: now,
            createdAt: now,
            updatedAt: now,
            // Journey tracking fields
            journeyPath: [],
            currentJourneyStation: null,
            journeyFlags: {},
        };

        if (overrides) {
            // Deep merge capturedInfo
            if (overrides.capturedInfo) {
                defaultState.capturedInfo = {
                    ...defaultState.capturedInfo,
                    ...overrides.capturedInfo,
                };
            }
            // Deep merge journeyFlags
            if (overrides.journeyFlags) {
                defaultState.journeyFlags = {
                    ...defaultState.journeyFlags,
                    ...overrides.journeyFlags,
                };
            }
            // Merge other fields
            return {
                ...defaultState,
                ...overrides,
                capturedInfo: defaultState.capturedInfo,
                journeyFlags: defaultState.journeyFlags,
            };
        }

        return defaultState;
    }

    /**
     * Get current state (immutable copy)
     */
    getState(): CallScriptStateWithJourney {
        return {
            ...this.state,
            completedStations: [...this.state.completedStations],
            segmentSignals: [...this.state.segmentSignals],
            capturedInfo: { ...this.state.capturedInfo },
            qualificationNotes: [...this.state.qualificationNotes],
            journeyPath: [...this.state.journeyPath],
            journeyFlags: { ...this.state.journeyFlags },
        };
    }

    /**
     * Get base state without journey fields (for backwards compatibility)
     */
    getBaseState(): CallScriptState {
        const { journeyPath, currentJourneyStation, journeyFlags, ...baseState } = this.getState();
        return baseState;
    }

    /**
     * Get current station
     */
    getCurrentStation(): CallScriptStation {
        return this.state.currentStation;
    }

    /**
     * Get call ID
     */
    getCallId(): string {
        return this.state.callId;
    }

    /**
     * Check if can advance to next station
     */
    canAdvanceToStation(targetStation: CallScriptStation): { allowed: boolean; reason?: string } {
        const stationOrder = CallScriptStationValues;
        const currentIndex = stationOrder.indexOf(this.state.currentStation);
        const targetIndex = stationOrder.indexOf(targetStation);

        // Can't go backwards
        if (targetIndex <= currentIndex) {
            return { allowed: false, reason: 'Cannot go backwards in the flow' };
        }

        // Can only advance one station at a time (except EMERGENCY fast-track)
        if (targetIndex !== currentIndex + 1) {
            // Allow EMERGENCY segment to skip directly to DESTINATION
            if (
                this.state.detectedSegment === 'EMERGENCY' &&
                targetStation === 'DESTINATION' &&
                this.state.capturedInfo.job
            ) {
                return { allowed: true };
            }
            return { allowed: false, reason: 'Must complete stations in order' };
        }

        // Check station-specific requirements
        switch (this.state.currentStation) {
            case 'LISTEN':
                // Must have captured job description
                if (!this.state.capturedInfo.job) {
                    return { allowed: false, reason: 'Job description not captured' };
                }
                break;
            case 'SEGMENT':
                // Must have confirmed segment
                if (!this.state.detectedSegment) {
                    return { allowed: false, reason: 'Segment not confirmed' };
                }
                break;
            case 'QUALIFY':
                // Must have qualification decision
                if (this.state.isQualified === null) {
                    return { allowed: false, reason: 'Qualification not confirmed' };
                }
                break;
            case 'DESTINATION':
                // Already at final station
                return { allowed: false, reason: 'Already at final station' };
        }

        return { allowed: true };
    }

    /**
     * Confirm current station and advance to next (VA manual approval)
     */
    confirmStation(): { success: boolean; newStation?: CallScriptStation; error?: string } {
        const nextStationIndex = CallScriptStationValues.indexOf(this.state.currentStation) + 1;

        if (nextStationIndex >= CallScriptStationValues.length) {
            return { success: false, error: 'Already at final station' };
        }

        const nextStation = CallScriptStationValues[nextStationIndex];
        const canAdvance = this.canAdvanceToStation(nextStation);

        if (!canAdvance.allowed) {
            this.emit('error', { message: canAdvance.reason || 'Cannot advance' });
            return { success: false, error: canAdvance.reason };
        }

        const previousStation = this.state.currentStation;

        // Mark current as complete
        this.state.completedStations.push(this.state.currentStation);
        this.state.currentStation = nextStation;
        this.state.stationEnteredAt = new Date();
        this.state.updatedAt = new Date();

        // Set recommended destination when entering DESTINATION station
        if (nextStation === 'DESTINATION' && this.state.detectedSegment) {
            this.state.recommendedDestination = getDefaultDestination(this.state.detectedSegment);
        }

        this.emit('station:changed', {
            from: previousStation,
            to: nextStation,
        });

        return { success: true, newStation: nextStation };
    }

    /**
     * Fast-track to DESTINATION station (for emergencies)
     */
    fastTrackToDestination(): { success: boolean; error?: string } {
        if (this.state.currentStation === 'DESTINATION') {
            return { success: false, error: 'Already at DESTINATION' };
        }

        if (!this.state.capturedInfo.job) {
            return { success: false, error: 'Job description required for fast-track' };
        }

        const previousStation = this.state.currentStation;

        // Mark all intermediate stations as complete
        const stationOrder = CallScriptStationValues;
        const currentIndex = stationOrder.indexOf(this.state.currentStation);
        const destIndex = stationOrder.indexOf('DESTINATION');

        for (let i = currentIndex; i < destIndex; i++) {
            if (!this.state.completedStations.includes(stationOrder[i])) {
                this.state.completedStations.push(stationOrder[i]);
            }
        }

        this.state.currentStation = 'DESTINATION';
        this.state.stationEnteredAt = new Date();
        this.state.updatedAt = new Date();

        // Set EMERGENCY destination by default for fast-track
        if (this.state.detectedSegment === 'EMERGENCY') {
            this.state.recommendedDestination = 'EMERGENCY_DISPATCH';
        } else if (this.state.detectedSegment) {
            this.state.recommendedDestination = getDefaultDestination(this.state.detectedSegment);
        }

        this.emit('station:changed', {
            from: previousStation,
            to: 'DESTINATION',
        });

        return { success: true };
    }

    /**
     * Update detected segment (from classifier or manual)
     */
    updateSegment(segment: CallScriptSegment, confidence: number, signals: string[]): void {
        this.state.detectedSegment = segment;
        this.state.segmentConfidence = confidence;
        this.state.segmentSignals = [...signals];
        this.state.updatedAt = new Date();

        this.emit('segment:detected', { segment, confidence, signals });
    }

    /**
     * Confirm segment (VA approval)
     * This also initializes the segment journey
     */
    confirmSegment(segment: CallScriptSegment): void {
        const previousSegment = this.state.detectedSegment;

        // If segment is changing, reset journey
        if (previousSegment && previousSegment !== segment) {
            this.resetJourney('segment_change');
        }

        this.state.detectedSegment = segment;
        this.state.segmentConfidence = 100; // Confirmed = full confidence
        this.state.updatedAt = new Date();

        this.emit('segment:confirmed', { segment });

        // Initialize journey for the confirmed segment
        this.initializeJourney(segment);
    }

    /**
     * Add signal to segment signals
     */
    addSegmentSignal(signal: string): void {
        if (!this.state.segmentSignals.includes(signal)) {
            this.state.segmentSignals.push(signal);
            this.state.updatedAt = new Date();
        }
    }

    /**
     * Update captured info (partial update)
     */
    updateCapturedInfo(updates: Partial<CallScriptCapturedInfo>): void {
        // Only update fields that are provided and non-null
        const filteredUpdates: Partial<CallScriptCapturedInfo> = {};

        for (const [key, value] of Object.entries(updates)) {
            if (value !== undefined) {
                (filteredUpdates as Record<string, unknown>)[key] = value;
            }
        }

        this.state.capturedInfo = { ...this.state.capturedInfo, ...filteredUpdates };
        this.state.updatedAt = new Date();

        this.emit('info:captured', { updates: filteredUpdates });
    }

    /**
     * Set qualification status
     */
    setQualified(qualified: boolean, notes: string[] = []): void {
        this.state.isQualified = qualified;
        this.state.qualificationNotes = [...notes];
        this.state.updatedAt = new Date();

        this.emit('qualified:set', { qualified, notes });
    }

    /**
     * Add qualification note
     */
    addQualificationNote(note: string): void {
        if (!this.state.qualificationNotes.includes(note)) {
            this.state.qualificationNotes.push(note);
            this.state.updatedAt = new Date();
        }
    }

    /**
     * Select destination (VA choice)
     */
    selectDestination(destination: CallScriptDestination): void {
        this.state.selectedDestination = destination;
        this.state.updatedAt = new Date();

        this.emit('destination:selected', { destination });
    }

    /**
     * Get current station prompt/guidance
     */
    getCurrentPrompt(): {
        instruction: string;
        prompt?: string;
        watchFor?: string[];
        segmentTip?: string;
        tips?: string[];
    } {
        const stationPrompt = STATION_PROMPTS[this.state.currentStation];
        const segmentConfig = this.state.detectedSegment
            ? SEGMENT_CONFIGS[this.state.detectedSegment]
            : null;

        return {
            instruction: stationPrompt.instruction,
            prompt: stationPrompt.prompt,
            watchFor: stationPrompt.watchFor,
            tips: stationPrompt.tips,
            segmentTip: segmentConfig?.oneLiner,
        };
    }

    /**
     * Get available destinations based on segment
     */
    getAvailableDestinations(): {
        destination: CallScriptDestination;
        recommended: boolean;
        description: string;
        color: string;
        name: string;
    }[] {
        const segment = this.state.detectedSegment;
        const defaultDest = segment ? getDefaultDestination(segment) : null;

        const destinations: CallScriptDestination[] = [];

        // Add EMERGENCY_DISPATCH only for EMERGENCY segment
        if (segment === 'EMERGENCY') {
            destinations.push('EMERGENCY_DISPATCH');
        }

        // Standard destinations
        destinations.push('INSTANT_QUOTE', 'VIDEO_REQUEST', 'SITE_VISIT');

        // Add EXIT for any segment (VA can always exit)
        destinations.push('EXIT');

        return destinations.map((dest) => {
            const promptConfig = DESTINATION_PROMPTS[dest];
            return {
                destination: dest,
                recommended: dest === defaultDest,
                description: promptConfig?.description || '',
                color: promptConfig?.color || '#6B7280',
                name: promptConfig?.name || dest,
            };
        });
    }

    /**
     * Check if segment has been detected
     */
    hasSegment(): boolean {
        return this.state.detectedSegment !== null;
    }

    /**
     * Check if qualified
     */
    isQualified(): boolean | null {
        return this.state.isQualified;
    }

    /**
     * Check if at final station
     */
    isAtFinalStation(): boolean {
        return this.state.currentStation === 'DESTINATION';
    }

    /**
     * Get time spent in current station (ms)
     */
    getTimeInCurrentStation(): number {
        return Date.now() - this.state.stationEnteredAt.getTime();
    }

    // ==========================================
    // JOURNEY TRACKING METHODS
    // ==========================================

    /**
     * Initialize the journey for a confirmed segment
     */
    initializeJourney(segmentId: CallScriptSegment): void {
        const journey = getSegmentJourney(segmentId);
        if (!journey) {
            this.emit('error', { message: `No journey found for segment ${segmentId}` });
            return;
        }

        const entryStation = getJourneyEntryStation(segmentId);
        if (!entryStation) {
            this.emit('error', { message: `No entry station found for segment ${segmentId}` });
            return;
        }

        // Reset journey state and start fresh
        this.state.journeyPath = [entryStation.id];
        this.state.currentJourneyStation = entryStation.id;
        this.state.journeyFlags = {};
        this.state.updatedAt = new Date();

        this.emit('journey:started', {
            segmentId,
            entryStation: entryStation.id,
        });

        this.emit('journey:station:changed', {
            from: null,
            to: entryStation.id,
            station: entryStation,
        });
    }

    /**
     * Get the current journey station configuration
     */
    getCurrentJourneyStation(): JourneyStation | null {
        if (!this.state.detectedSegment || !this.state.currentJourneyStation) {
            return null;
        }
        return getJourneyStation(this.state.detectedSegment, this.state.currentJourneyStation);
    }

    /**
     * Get available options for the current journey station
     */
    getJourneyStationOptions(context?: {
        hasSkuMatch?: boolean;
        hasVideo?: boolean;
        isEmergency?: boolean;
    }): StationOption[] {
        const station = this.getCurrentJourneyStation();
        if (!station?.options) {
            return [];
        }

        const ctx = context || {
            hasSkuMatch: false,
            hasVideo: false,
            isEmergency: this.state.detectedSegment === 'EMERGENCY',
        };

        return station.options.filter(opt => isOptionAvailable(opt, ctx));
    }

    /**
     * Advance to the next journey station
     * @param optionId - For choice stations, the ID of the selected option
     */
    advanceJourney(optionId?: string): { success: boolean; newStation?: JourneyStation; error?: string } {
        if (!this.state.detectedSegment) {
            return { success: false, error: 'No segment confirmed' };
        }

        if (!this.state.currentJourneyStation) {
            return { success: false, error: 'Journey not started' };
        }

        const currentStation = this.getCurrentJourneyStation();
        if (!currentStation) {
            return { success: false, error: 'Current station not found' };
        }

        // Handle option selection for choice/destination stations
        if ((currentStation.type === 'choice' || currentStation.type === 'destination') && currentStation.options) {
            if (!optionId) {
                return { success: false, error: 'Option selection required for this station type' };
            }

            const selectedOption = currentStation.options.find(o => o.id === optionId);
            if (!selectedOption) {
                return { success: false, error: `Option ${optionId} not found` };
            }

            // Execute option action if present
            if (selectedOption.action && selectedOption.actionPayload) {
                this.executeOptionAction(selectedOption);
            }

            // If option has no next station, journey ends here
            if (!selectedOption.nextStation) {
                return { success: true, newStation: undefined };
            }
        }

        // Get next station
        const nextStation = getNextStation(this.state.detectedSegment, this.state.currentJourneyStation, optionId);

        if (!nextStation) {
            // Journey complete (reached destination)
            return { success: true, newStation: undefined };
        }

        const previousStation = this.state.currentJourneyStation;

        // Update journey state
        this.state.journeyPath.push(nextStation.id);
        this.state.currentJourneyStation = nextStation.id;
        this.state.updatedAt = new Date();

        this.emit('journey:station:changed', {
            from: previousStation,
            to: nextStation.id,
            station: nextStation,
        });

        return { success: true, newStation: nextStation };
    }

    /**
     * Go back to the previous journey station
     */
    goBackInJourney(): { success: boolean; newStation?: JourneyStation; error?: string } {
        if (this.state.journeyPath.length <= 1) {
            return { success: false, error: 'Already at the start of the journey' };
        }

        if (!this.state.detectedSegment) {
            return { success: false, error: 'No segment confirmed' };
        }

        // Remove current station from path
        const currentStation = this.state.journeyPath.pop();

        // Get the previous station
        const previousStationId = this.state.journeyPath[this.state.journeyPath.length - 1];
        const previousStation = getJourneyStation(this.state.detectedSegment, previousStationId);

        if (!previousStation) {
            // Restore the path if we cant find the previous station
            if (currentStation) {
                this.state.journeyPath.push(currentStation);
            }
            return { success: false, error: 'Previous station not found' };
        }

        this.state.currentJourneyStation = previousStationId;
        this.state.updatedAt = new Date();

        this.emit('journey:station:changed', {
            from: currentStation || null,
            to: previousStationId,
            station: previousStation,
        });

        return { success: true, newStation: previousStation };
    }

    /**
     * Reset the journey (on segment change or manual reset)
     */
    resetJourney(reason: 'segment_change' | 'manual_reset'): void {
        const previousSegment = this.state.detectedSegment;

        this.state.journeyPath = [];
        this.state.currentJourneyStation = null;
        this.state.journeyFlags = {};
        this.state.updatedAt = new Date();

        this.emit('journey:reset', {
            reason,
            previousSegment,
        });
    }

    /**
     * Set a journey flag
     */
    setJourneyFlag(key: string, value: boolean | string): void {
        this.state.journeyFlags[key] = value;
        this.state.updatedAt = new Date();

        this.emit('journey:flag:set', {
            flags: { [key]: value },
        });
    }

    /**
     * Get a journey flag value
     */
    getJourneyFlag(key: string): boolean | string | undefined {
        return this.state.journeyFlags[key];
    }

    /**
     * Get all journey flags
     */
    getJourneyFlags(): Record<string, boolean | string> {
        return { ...this.state.journeyFlags };
    }

    /**
     * Get the journey path (stations visited)
     */
    getJourneyPath(): string[] {
        return [...this.state.journeyPath];
    }

    /**
     * Check if journey is active
     */
    hasActiveJourney(): boolean {
        return this.state.currentJourneyStation !== null;
    }

    /**
     * Check if journey is complete (at destination station)
     */
    isJourneyComplete(): boolean {
        const station = this.getCurrentJourneyStation();
        return station?.type === 'destination';
    }

    /**
     * Execute an option action (set flags, capture info, etc.)
     */
    private executeOptionAction(option: StationOption): void {
        if (!option.action || !option.actionPayload) return;

        switch (option.action) {
            case 'set_flag':
                for (const [key, value] of Object.entries(option.actionPayload)) {
                    if (typeof value === 'boolean' || typeof value === 'string') {
                        this.setJourneyFlag(key, value);
                    }
                }
                break;
            case 'capture_info':
                // Update captured info from payload
                const infoUpdates: Partial<CallScriptCapturedInfo> = {};
                for (const [key, value] of Object.entries(option.actionPayload)) {
                    if (key in this.state.capturedInfo) {
                        (infoUpdates as Record<string, unknown>)[key] = value;
                    }
                }
                if (Object.keys(infoUpdates).length > 0) {
                    this.updateCapturedInfo(infoUpdates);
                }
                break;
            case 'navigate':
                // Navigation is handled by advanceJourney
                break;
            case 'fast_track':
                // Fast track to destination
                this.fastTrackToDestination();
                break;
        }
    }

    /**
     * Register event handler
     */
    on(event: StateMachineEventType, callback: StateMachineEventHandler): void {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push(callback);
    }

    /**
     * Remove event handler
     */
    off(event: StateMachineEventType, callback: StateMachineEventHandler): void {
        const handlers = this.listeners.get(event);
        if (handlers) {
            const index = handlers.indexOf(callback);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    /**
     * Remove all handlers for an event
     */
    removeAllListeners(event?: StateMachineEventType): void {
        if (event) {
            this.listeners.delete(event);
        } else {
            this.listeners.clear();
        }
    }

    /**
     * Emit event to all registered handlers
     */
    private emit(event: StateMachineEventType, data: StateMachineEventPayload): void {
        const callbacks = this.listeners.get(event) || [];
        for (const cb of callbacks) {
            try {
                cb(data);
            } catch (error) {
                console.error(`[CallScriptStateMachine] Handler error for event ${event}:`, error);
            }
        }
    }

    /**
     * Serialize state to JSON (for persistence/WebSocket)
     */
    toJSON(): CallScriptStateWithJourney {
        return this.getState();
    }

    /**
     * Restore from persisted state
     */
    static fromJSON(data: CallScriptState | CallScriptStateWithJourney): CallScriptStateMachine {
        const machine = new CallScriptStateMachine(data.callId);

        // Check if data includes journey fields
        const dataWithJourney = data as CallScriptStateWithJourney;

        machine.state = {
            callId: data.callId,
            currentStation: data.currentStation,
            completedStations: [...(data.completedStations || [])],
            detectedSegment: data.detectedSegment,
            segmentConfidence: data.segmentConfidence || 0,
            segmentSignals: [...(data.segmentSignals || [])],
            capturedInfo: {
                job: data.capturedInfo?.job ?? null,
                postcode: data.capturedInfo?.postcode ?? null,
                name: data.capturedInfo?.name ?? null,
                contact: data.capturedInfo?.contact ?? null,
                isDecisionMaker: data.capturedInfo?.isDecisionMaker ?? null,
                isRemote: data.capturedInfo?.isRemote ?? null,
                hasTenant: data.capturedInfo?.hasTenant ?? null,
            },
            isQualified: data.isQualified ?? null,
            qualificationNotes: [...(data.qualificationNotes || [])],
            recommendedDestination: data.recommendedDestination,
            selectedDestination: data.selectedDestination,
            stationEnteredAt: data.stationEnteredAt instanceof Date
                ? data.stationEnteredAt
                : new Date(data.stationEnteredAt || Date.now()),
            createdAt: data.createdAt instanceof Date
                ? data.createdAt
                : new Date(data.createdAt || Date.now()),
            updatedAt: data.updatedAt instanceof Date
                ? data.updatedAt
                : new Date(data.updatedAt || Date.now()),
            // Journey tracking fields (with defaults for backwards compatibility)
            journeyPath: [...(dataWithJourney.journeyPath || [])],
            currentJourneyStation: dataWithJourney.currentJourneyStation ?? null,
            journeyFlags: { ...(dataWithJourney.journeyFlags || {}) },
        };
        return machine;
    }

    /**
     * Reset state to initial (useful for testing)
     */
    reset(): void {
        const callId = this.state.callId;
        this.state = this.createInitialState(callId);
        this.listeners.clear();
    }
}

export default CallScriptStateMachine;
