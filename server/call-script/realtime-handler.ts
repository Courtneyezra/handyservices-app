/**
 * Call Script Realtime Handler
 *
 * Integrates the Call Script Tube Map system with real-time WebSocket events.
 * Handles:
 * - Session initialization for new calls
 * - Streaming segment classification
 * - Streaming info extraction
 * - Event broadcasting to connected clients
 * - VA action handling
 *
 * Owner: Agent 5 (WebSocket Integration)
 */

import { CallScriptStateMachine, sessionManager } from './index';
import { StreamingClassifier } from '../services/segment-classifier';
import { StreamingInfoExtractor, type ExtractedInfo } from '../services/info-extractor';
import { getCallTimingSettings } from '../settings';
import type {
    CallScriptSegment,
    CallScriptDestination,
    CallScriptCapturedInfo,
    CallScriptState,
} from '../../shared/schema';

// Import broadcast function - will be set via initialization
let broadcastToClients: ((message: any) => void) | null = null;

/**
 * Initialize the realtime handler with the broadcast function
 * Called from server/index.ts after WebSocket server is set up
 */
export function initializeRealtimeHandler(broadcastFn: (message: any) => void): void {
    broadcastToClients = broadcastFn;
    console.log('[CallScript-RT] Realtime handler initialized');
}

/**
 * Active call handler with all processing components
 */
interface ActiveCallHandler {
    machine: CallScriptStateMachine;
    classifier: StreamingClassifier;
    infoExtractor: StreamingInfoExtractor;
    phone: string;
}

const activeHandlers: Map<string, ActiveCallHandler> = new Map();

/**
 * Broadcast a call script event to all connected clients
 */
function broadcast(type: string, data: Record<string, unknown>): void {
    if (!broadcastToClients) {
        console.warn('[CallScript-RT] Broadcast function not initialized');
        return;
    }

    broadcastToClients({
        type,
        data,
        timestamp: new Date().toISOString(),
    });
}

/**
 * Initialize call script handling for a new call
 *
 * @param callId - Unique call identifier (e.g., Twilio CallSid)
 * @param phone - Caller phone number
 * @returns The state machine for this call
 */
export async function initializeCallScriptForCall(
    callId: string,
    phone: string
): Promise<CallScriptStateMachine> {
    // Check if already initialized
    const existing = activeHandlers.get(callId);
    if (existing) {
        console.log(`[CallScript-RT] Session ${callId} already exists, returning existing`);
        return existing.machine;
    }

    // Create session via session manager (handles DB persistence)
    const machine = await sessionManager.createSession(callId, phone);

    // Load configurable timing settings
    const timingSettings = await getCallTimingSettings();
    console.log(`[CallScript-RT] Using tier2LlmDebounceMs=${timingSettings.tier2LlmDebounceMs} for call ${callId}`);

    // Create streaming classifier with update callback
    const classifier = new StreamingClassifier(
        (result) => {
            // Update state machine with new classification
            machine.updateSegment(
                result.primary.segment,
                result.primary.confidence,
                result.primary.signals
            );

            // Broadcast to connected clients
            broadcast('callscript:segment_detected', {
                callId,
                segment: result.primary.segment,
                confidence: result.primary.confidence,
                signals: result.primary.signals,
                alternatives: result.alternatives,
                tier: result.primary.tier,
            });
        },
        {
            debounceMs: timingSettings.tier2LlmDebounceMs,
            useTier2: true,
            tier1MinConfidence: 70,
        }
    );

    // Create streaming info extractor with update callback
    const infoExtractor = new StreamingInfoExtractor((info: ExtractedInfo) => {
        // Convert ExtractedInfo to CallScriptCapturedInfo
        const capturedInfo: Partial<CallScriptCapturedInfo> = {
            job: info.job,
            postcode: info.postcode,
            name: info.name,
            contact: info.contact,
            isDecisionMaker: info.isDecisionMaker,
            isRemote: info.isRemote,
            hasTenant: info.hasTenant,
        };

        // Update state machine
        machine.updateCapturedInfo(capturedInfo);

        // Broadcast to connected clients
        broadcast('callscript:info_captured', {
            callId,
            capturedInfo,
        });
    });

    // Set up event listeners on the state machine
    machine.on('station:changed', (data) => {
        broadcast('callscript:station_update', {
            callId,
            ...data,
            state: machine.toJSON(),
        });

        // Persist state on station change
        sessionManager.persistSession(callId).catch((err) => {
            console.error(`[CallScript-RT] Failed to persist session ${callId}:`, err);
        });
    });

    machine.on('segment:confirmed', (data) => {
        broadcast('callscript:segment_confirmed', {
            callId,
            ...data,
        });
    });

    machine.on('qualified:set', (data) => {
        broadcast('callscript:qualified_set', {
            callId,
            ...data,
        });
    });

    machine.on('destination:selected', (data) => {
        broadcast('callscript:destination_selected', {
            callId,
            ...data,
            state: machine.toJSON(),
        });
    });

    machine.on('error', (data) => {
        broadcast('callscript:error', {
            callId,
            ...data,
        });
    });

    // Store the handler
    activeHandlers.set(callId, {
        machine,
        classifier,
        infoExtractor,
        phone,
    });

    // Broadcast session started
    broadcast('callscript:session_started', {
        callId,
        phone,
        state: machine.toJSON(),
    });

    console.log(`[CallScript-RT] Initialized session for call ${callId} (${phone})`);

    return machine;
}

/**
 * Handle a new transcript chunk from the call
 *
 * @param callId - Call identifier
 * @param text - Transcript text
 * @param speaker - Who spoke ('caller', 'agent', 'inbound', 'outbound')
 */
export function handleTranscriptChunk(
    callId: string,
    text: string,
    speaker: string
): void {
    const handler = activeHandlers.get(callId);
    if (!handler) {
        // Session might not be initialized yet for this call
        return;
    }

    // Only process caller/customer speech for classification and info extraction
    // 'inbound' is the Twilio track name for caller audio
    if (speaker === 'caller' || speaker === 'inbound' || speaker === 'Caller') {
        handler.classifier.addChunk(text);
        handler.infoExtractor.addChunk(text);
    }

    // Update session activity
    sessionManager.touchSession(callId);
}

/**
 * End a call script session
 *
 * @param callId - Call identifier
 */
export async function endCallScriptSession(callId: string): Promise<void> {
    const handler = activeHandlers.get(callId);
    if (!handler) {
        console.log(`[CallScript-RT] No active session for ${callId} to end`);
        return;
    }

    // Get final state before cleanup
    const finalState = handler.machine.toJSON();

    // Clean up streaming components
    handler.classifier.reset();
    handler.infoExtractor.reset();

    // Persist and end session via manager
    await sessionManager.endSession(callId);

    // Remove from active handlers
    activeHandlers.delete(callId);

    // Broadcast session ended
    broadcast('callscript:session_ended', {
        callId,
        finalState,
    });

    console.log(`[CallScript-RT] Ended session for call ${callId}`);
}

/**
 * Handle VA actions from the frontend
 *
 * @param callId - Call identifier
 * @param action - Action type
 * @param payload - Action payload
 * @returns Result of the action
 */
export function handleVAAction(
    callId: string,
    action: string,
    payload: Record<string, unknown>
): { success: boolean; error?: string; state?: CallScriptState } {
    const handler = activeHandlers.get(callId);
    if (!handler) {
        return { success: false, error: 'No active session for this call' };
    }

    const { machine } = handler;

    try {
        switch (action) {
            case 'confirm_station': {
                const result = machine.confirmStation();
                if (result.success) {
                    return { success: true, state: machine.toJSON() };
                }
                return { success: false, error: result.error };
            }

            case 'select_segment': {
                const segment = payload.segment as CallScriptSegment;
                if (!segment) {
                    return { success: false, error: 'Segment is required' };
                }
                machine.confirmSegment(segment);
                return { success: true, state: machine.toJSON() };
            }

            case 'set_qualified': {
                const qualified = payload.qualified as boolean;
                const notes = (payload.notes as string[]) || [];
                machine.setQualified(qualified, notes);
                return { success: true, state: machine.toJSON() };
            }

            case 'select_destination': {
                const destination = payload.destination as CallScriptDestination;
                if (!destination) {
                    return { success: false, error: 'Destination is required' };
                }
                machine.selectDestination(destination);
                return { success: true, state: machine.toJSON() };
            }

            case 'update_info': {
                const info = payload.info as Partial<CallScriptCapturedInfo>;
                if (!info) {
                    return { success: false, error: 'Info is required' };
                }
                machine.updateCapturedInfo(info);
                return { success: true, state: machine.toJSON() };
            }

            case 'fast_track': {
                const result = machine.fastTrackToDestination();
                if (result.success) {
                    return { success: true, state: machine.toJSON() };
                }
                return { success: false, error: result.error };
            }

            default:
                return { success: false, error: `Unknown action: ${action}` };
        }
    } catch (err) {
        console.error(`[CallScript-RT] Error handling action ${action}:`, err);
        return {
            success: false,
            error: err instanceof Error ? err.message : 'Unknown error',
        };
    }
}

/**
 * Get an active session by call ID
 *
 * @param callId - Call identifier
 * @returns The state machine if active, undefined otherwise
 */
export function getActiveSession(callId: string): CallScriptStateMachine | undefined {
    return activeHandlers.get(callId)?.machine;
}

/**
 * Check if a session is active
 *
 * @param callId - Call identifier
 * @returns True if session is active
 */
export function hasActiveSession(callId: string): boolean {
    return activeHandlers.has(callId);
}

/**
 * Get all active session summaries (for listing)
 */
export function getActiveSessionSummaries(): Array<{
    callId: string;
    phone: string;
    currentStation: string;
    detectedSegment: string | null;
    createdAt: Date;
}> {
    const summaries: Array<{
        callId: string;
        phone: string;
        currentStation: string;
        detectedSegment: string | null;
        createdAt: Date;
    }> = [];

    activeHandlers.forEach((handler, callId) => {
        const state = handler.machine.toJSON();
        summaries.push({
            callId,
            phone: handler.phone,
            currentStation: state.currentStation,
            detectedSegment: state.detectedSegment,
            createdAt: state.createdAt,
        });
    });

    return summaries;
}

/**
 * Get count of active sessions
 */
export function getActiveSessionCount(): number {
    return activeHandlers.size;
}

export default {
    initializeRealtimeHandler,
    initializeCallScriptForCall,
    handleTranscriptChunk,
    endCallScriptSession,
    handleVAAction,
    getActiveSession,
    hasActiveSession,
    getActiveSessionSummaries,
    getActiveSessionCount,
};
