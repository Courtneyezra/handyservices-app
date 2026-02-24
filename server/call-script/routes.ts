/**
 * Call Script API Routes
 *
 * Provides REST API endpoints for the Call Script Tube Map system:
 * - Session state retrieval
 * - VA action handling
 * - Active session listing
 *
 * Owner: Agent 5 (WebSocket Integration)
 */

import { Router, Request, Response } from 'express';
import {
    handleVAAction,
    getActiveSession,
    getActiveSessionSummaries,
    hasActiveSession,
} from './realtime-handler';
import { sessionManager } from './session-manager';

export const callScriptRouter = Router();

/**
 * GET /api/call-script/session/:callId
 *
 * Get current session state for a call
 * First checks active in-memory sessions, then tries to restore from DB
 */
callScriptRouter.get('/api/call-script/session/:callId', async (req: Request, res: Response) => {
    const { callId } = req.params;

    try {
        // Check active session first
        const machine = getActiveSession(callId);
        if (machine) {
            return res.json({
                success: true,
                active: true,
                state: machine.toJSON(),
            });
        }

        // Try to restore from DB (for reconnection scenarios)
        const restored = await sessionManager.restoreSession(callId);
        if (restored) {
            return res.json({
                success: true,
                active: false, // Not actively being processed
                restored: true,
                state: restored.toJSON(),
            });
        }

        return res.status(404).json({
            success: false,
            error: 'Session not found',
        });
    } catch (error) {
        console.error(`[CallScript-API] Error getting session ${callId}:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get session',
        });
    }
});

/**
 * POST /api/call-script/session/:callId/action
 *
 * Execute a VA action on a call session
 * Supported actions:
 * - confirm_station: Advance to next station
 * - select_segment: Manually select a segment
 * - set_qualified: Set qualification status
 * - select_destination: Select final destination
 * - update_info: Update captured info
 * - fast_track: Fast-track to destination (emergencies)
 */
callScriptRouter.post('/api/call-script/session/:callId/action', (req: Request, res: Response) => {
    const { callId } = req.params;
    const { action, payload } = req.body;

    if (!action) {
        return res.status(400).json({
            success: false,
            error: 'Action is required',
        });
    }

    try {
        const result = handleVAAction(callId, action, payload || {});

        if (result.success) {
            return res.json(result);
        }

        return res.status(400).json(result);
    } catch (error) {
        console.error(`[CallScript-API] Error handling action ${action} for ${callId}:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to process action',
        });
    }
});

/**
 * GET /api/call-script/sessions
 *
 * List all active call script sessions
 * Returns summary information for each session
 */
callScriptRouter.get('/api/call-script/sessions', (req: Request, res: Response) => {
    try {
        const sessions = getActiveSessionSummaries();
        return res.json({
            success: true,
            count: sessions.length,
            sessions,
        });
    } catch (error) {
        console.error('[CallScript-API] Error listing sessions:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to list sessions',
        });
    }
});

/**
 * GET /api/call-script/session/:callId/exists
 *
 * Quick check if a session exists (active)
 * Useful for frontend to determine if live call view should be shown
 */
callScriptRouter.get('/api/call-script/session/:callId/exists', (req: Request, res: Response) => {
    const { callId } = req.params;

    return res.json({
        success: true,
        exists: hasActiveSession(callId),
    });
});

/**
 * DELETE /api/call-script/session/:callId
 *
 * Manually end a call script session
 * Used for cleanup or testing
 */
callScriptRouter.delete('/api/call-script/session/:callId', async (req: Request, res: Response) => {
    const { callId } = req.params;

    try {
        // Import endCallScriptSession dynamically to avoid circular deps
        const { endCallScriptSession } = await import('./realtime-handler');
        await endCallScriptSession(callId);

        return res.json({
            success: true,
            message: `Session ${callId} ended`,
        });
    } catch (error) {
        console.error(`[CallScript-API] Error ending session ${callId}:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to end session',
        });
    }
});

/**
 * POST /api/call-script/session/:callId/persist
 *
 * Force persist session state to database
 * Useful for ensuring state is saved before disconnection
 */
callScriptRouter.post('/api/call-script/session/:callId/persist', async (req: Request, res: Response) => {
    const { callId } = req.params;

    if (!hasActiveSession(callId)) {
        return res.status(404).json({
            success: false,
            error: 'No active session to persist',
        });
    }

    try {
        await sessionManager.persistSession(callId);
        return res.json({
            success: true,
            message: `Session ${callId} persisted`,
        });
    } catch (error) {
        console.error(`[CallScript-API] Error persisting session ${callId}:`, error);
        return res.status(500).json({
            success: false,
            error: 'Failed to persist session',
        });
    }
});

// Broadcast function reference (set by server/index.ts)
let broadcastFn: ((msg: any) => void) | null = null;

export function setSimulateBroadcast(fn: (msg: any) => void) {
    broadcastFn = fn;
}

/**
 * POST /api/call-script/simulate
 *
 * Start a simulated call session for testing
 * Creates a test session and optionally feeds transcript chunks
 * Also broadcasts voice:call_started so the frontend UI activates
 */
callScriptRouter.post('/api/call-script/simulate', async (req: Request, res: Response) => {
    const { phone = '+447700900123', transcript } = req.body;

    try {
        // Import the initialization function
        const { initializeCallScriptForCall, handleTranscriptChunk } = await import('./realtime-handler');

        // Create a test call ID
        const callId = `sim-${Date.now()}`;

        // Broadcast voice:call_started so frontend activates
        if (broadcastFn) {
            broadcastFn({
                type: 'voice:call_started',
                data: {
                    callSid: callId,
                    phoneNumber: phone,
                },
                timestamp: new Date().toISOString(),
            });
        }

        // Initialize session (will work in memory even if DB fails)
        const machine = await initializeCallScriptForCall(callId, phone);

        // If transcript provided, feed it through
        if (transcript && typeof transcript === 'string') {
            handleTranscriptChunk(callId, transcript, 'inbound');

            // Broadcast transcript segment
            if (broadcastFn) {
                broadcastFn({
                    type: 'voice:live_segment',
                    data: { callSid: callId, transcript, isFinal: true },
                    timestamp: new Date().toISOString(),
                });
            }
        }

        // If transcripts array provided, feed them
        if (Array.isArray(transcript)) {
            for (const chunk of transcript) {
                handleTranscriptChunk(callId, chunk, 'inbound');

                // Broadcast each transcript segment
                if (broadcastFn) {
                    broadcastFn({
                        type: 'voice:live_segment',
                        data: { callSid: callId, transcript: chunk, isFinal: true },
                        timestamp: new Date().toISOString(),
                    });
                }
            }
        }

        return res.json({
            success: true,
            callId,
            message: 'Simulated call started. Go to /admin/live-call to see it.',
            state: machine.toJSON(),
        });
    } catch (error) {
        console.error('[CallScript-API] Error starting simulation:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to start simulation',
        });
    }
});

/**
 * POST /api/call-script/simulate/:callId/transcript
 *
 * Add transcript to a simulated call
 */
callScriptRouter.post('/api/call-script/simulate/:callId/transcript', async (req: Request, res: Response) => {
    const { callId } = req.params;
    const { text, speaker = 'inbound' } = req.body;

    if (!text) {
        return res.status(400).json({
            success: false,
            error: 'Text is required',
        });
    }

    if (!hasActiveSession(callId)) {
        return res.status(404).json({
            success: false,
            error: 'No active session found',
        });
    }

    try {
        const { handleTranscriptChunk } = await import('./realtime-handler');
        handleTranscriptChunk(callId, text, speaker);

        const machine = getActiveSession(callId);
        return res.json({
            success: true,
            state: machine?.toJSON(),
        });
    } catch (error) {
        console.error('[CallScript-API] Error adding transcript:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to add transcript',
        });
    }
});

export default callScriptRouter;
