/**
 * Call Script Session Manager
 *
 * Manages active call sessions, handles persistence to database,
 * and provides session lifecycle management for the Tube Map system.
 *
 * Features:
 * - In-memory session cache for fast access
 * - Database persistence for durability
 * - Session restoration on reconnect
 * - Automatic cleanup of stale sessions
 *
 * Owner: Agent 2 (State Machine Agent)
 */

import { db } from '../db';
import { liveCallSessions } from '../../shared/schema';
import { CallScriptStateMachine } from './state-machine';
import { eq, and, lt } from 'drizzle-orm';
import type {
    CallScriptStation,
    CallScriptSegment,
    CallScriptDestination,
    CallScriptCapturedInfo,
} from '../../shared/schema';

/**
 * Session metadata stored alongside the state machine
 */
export interface SessionMetadata {
    phone: string;
    createdAt: Date;
    lastActivityAt: Date;
}

/**
 * Call Script Session Manager
 *
 * Singleton that manages all active call sessions.
 */
class CallScriptSessionManager {
    private activeSessions: Map<string, CallScriptStateMachine> = new Map();
    private sessionMetadata: Map<string, SessionMetadata> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor() {
        // Start cleanup interval (every 5 minutes)
        this.startCleanupInterval();
    }

    /**
     * Create new session for incoming call
     */
    async createSession(callId: string, phone: string): Promise<CallScriptStateMachine> {
        // Check if session already exists
        if (this.activeSessions.has(callId)) {
            console.log(`[SessionManager] Session ${callId} already exists, returning existing`);
            return this.activeSessions.get(callId)!;
        }

        const machine = new CallScriptStateMachine(callId);
        this.activeSessions.set(callId, machine);

        const now = new Date();
        this.sessionMetadata.set(callId, {
            phone,
            createdAt: now,
            lastActivityAt: now,
        });

        // Persist to DB
        try {
            await db.insert(liveCallSessions).values({
                id: `session_${callId}`,
                callId,
                phone,
                currentStation: 'LISTEN',
                completedStations: [],
                capturedInfo: {},
                createdAt: now,
                updatedAt: now,
            });
            console.log(`[SessionManager] Created session ${callId} for ${phone}`);
        } catch (error) {
            console.error(`[SessionManager] Failed to persist session ${callId}:`, error);
            // Don't throw - session is still usable in memory
        }

        return machine;
    }

    /**
     * Get active session by call ID
     */
    getSession(callId: string): CallScriptStateMachine | undefined {
        const machine = this.activeSessions.get(callId);
        if (machine) {
            // Update last activity
            const metadata = this.sessionMetadata.get(callId);
            if (metadata) {
                metadata.lastActivityAt = new Date();
            }
        }
        return machine;
    }

    /**
     * Get session metadata
     */
    getSessionMetadata(callId: string): SessionMetadata | undefined {
        return this.sessionMetadata.get(callId);
    }

    /**
     * Check if session exists
     */
    hasSession(callId: string): boolean {
        return this.activeSessions.has(callId);
    }

    /**
     * Get all active session IDs
     */
    getActiveSessionIds(): string[] {
        return Array.from(this.activeSessions.keys());
    }

    /**
     * Get count of active sessions
     */
    getActiveSessionCount(): number {
        return this.activeSessions.size;
    }

    /**
     * Update session activity timestamp
     */
    touchSession(callId: string): void {
        const metadata = this.sessionMetadata.get(callId);
        if (metadata) {
            metadata.lastActivityAt = new Date();
        }
    }

    /**
     * Persist session state to database
     */
    async persistSession(callId: string): Promise<void> {
        const machine = this.activeSessions.get(callId);
        if (!machine) {
            console.warn(`[SessionManager] Cannot persist session ${callId}: not found`);
            return;
        }

        const state = machine.toJSON();

        try {
            await db
                .update(liveCallSessions)
                .set({
                    currentStation: state.currentStation,
                    completedStations: state.completedStations,
                    detectedSegment: state.detectedSegment,
                    segmentConfidence: state.segmentConfidence,
                    segmentSignals: state.segmentSignals,
                    capturedInfo: state.capturedInfo,
                    isQualified: state.isQualified,
                    qualificationNotes: state.qualificationNotes,
                    recommendedDestination: state.recommendedDestination,
                    selectedDestination: state.selectedDestination,
                    stationEnteredAt: state.stationEnteredAt,
                    updatedAt: new Date(),
                })
                .where(eq(liveCallSessions.callId, callId));
        } catch (error) {
            console.error(`[SessionManager] Failed to persist session ${callId}:`, error);
            throw error;
        }
    }

    /**
     * End session and remove from memory
     */
    async endSession(callId: string): Promise<void> {
        // Persist final state before removing
        try {
            await this.persistSession(callId);
        } catch (error) {
            console.error(`[SessionManager] Error persisting session ${callId} on end:`, error);
        }

        this.activeSessions.delete(callId);
        this.sessionMetadata.delete(callId);
        console.log(`[SessionManager] Ended session ${callId}`);
    }

    /**
     * Restore session from database (on reconnect)
     */
    async restoreSession(callId: string): Promise<CallScriptStateMachine | null> {
        // Check if already in memory
        if (this.activeSessions.has(callId)) {
            return this.activeSessions.get(callId)!;
        }

        try {
            const [session] = await db
                .select()
                .from(liveCallSessions)
                .where(eq(liveCallSessions.callId, callId));

            if (!session) {
                console.log(`[SessionManager] No session found in DB for ${callId}`);
                return null;
            }

            const machine = CallScriptStateMachine.fromJSON({
                callId: session.callId,
                currentStation: session.currentStation as CallScriptStation,
                completedStations: (session.completedStations as CallScriptStation[]) || [],
                detectedSegment: session.detectedSegment as CallScriptSegment | null,
                segmentConfidence: session.segmentConfidence || 0,
                segmentSignals: (session.segmentSignals as string[]) || [],
                capturedInfo: (session.capturedInfo as CallScriptCapturedInfo) || {
                    job: null,
                    postcode: null,
                    name: null,
                    contact: null,
                    isDecisionMaker: null,
                    isRemote: null,
                    hasTenant: null,
                },
                isQualified: session.isQualified ?? null,
                qualificationNotes: (session.qualificationNotes as string[]) || [],
                recommendedDestination: session.recommendedDestination as CallScriptDestination | null,
                selectedDestination: session.selectedDestination as CallScriptDestination | null,
                stationEnteredAt: session.stationEnteredAt || new Date(),
                createdAt: session.createdAt || new Date(),
                updatedAt: session.updatedAt || new Date(),
            });

            this.activeSessions.set(callId, machine);
            this.sessionMetadata.set(callId, {
                phone: session.phone,
                createdAt: session.createdAt || new Date(),
                lastActivityAt: new Date(),
            });

            console.log(`[SessionManager] Restored session ${callId}`);
            return machine;
        } catch (error) {
            console.error(`[SessionManager] Error restoring session ${callId}:`, error);
            return null;
        }
    }

    /**
     * Find session by phone number
     */
    findSessionByPhone(phone: string): CallScriptStateMachine | undefined {
        const entries = Array.from(this.sessionMetadata.entries());
        for (const [callId, metadata] of entries) {
            if (metadata.phone === phone) {
                return this.activeSessions.get(callId);
            }
        }
        return undefined;
    }

    /**
     * Get or create session (helper for reconnection scenarios)
     */
    async getOrCreateSession(callId: string, phone: string): Promise<CallScriptStateMachine> {
        // Try in-memory first
        const existing = this.getSession(callId);
        if (existing) {
            return existing;
        }

        // Try restoring from DB
        const restored = await this.restoreSession(callId);
        if (restored) {
            return restored;
        }

        // Create new
        return this.createSession(callId, phone);
    }

    /**
     * Cleanup stale sessions from memory
     * Sessions inactive for more than 30 minutes are considered stale
     */
    async cleanupStaleSessions(maxAgeMs: number = 30 * 60 * 1000): Promise<number> {
        const now = Date.now();
        const staleSessionIds: string[] = [];

        const entries = Array.from(this.sessionMetadata.entries());
        for (const [callId, metadata] of entries) {
            if (now - metadata.lastActivityAt.getTime() > maxAgeMs) {
                staleSessionIds.push(callId);
            }
        }

        for (const callId of staleSessionIds) {
            await this.endSession(callId);
        }

        if (staleSessionIds.length > 0) {
            console.log(`[SessionManager] Cleaned up ${staleSessionIds.length} stale sessions`);
        }

        return staleSessionIds.length;
    }

    /**
     * Start automatic cleanup interval
     */
    private startCleanupInterval(): void {
        // Cleanup every 5 minutes
        this.cleanupInterval = setInterval(
            () => {
                this.cleanupStaleSessions().catch((error) => {
                    console.error('[SessionManager] Cleanup error:', error);
                });
            },
            5 * 60 * 1000
        );

        // Don't prevent process exit
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }

    /**
     * Stop cleanup interval (for testing/shutdown)
     */
    stopCleanupInterval(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Clear all sessions (for testing)
     */
    clearAll(): void {
        this.activeSessions.clear();
        this.sessionMetadata.clear();
    }

    /**
     * Delete session from database (for cleanup)
     */
    async deleteSessionFromDb(callId: string): Promise<void> {
        try {
            await db.delete(liveCallSessions).where(eq(liveCallSessions.callId, callId));
        } catch (error) {
            console.error(`[SessionManager] Error deleting session ${callId} from DB:`, error);
            throw error;
        }
    }

    /**
     * Cleanup old sessions from database
     * Removes sessions older than specified age (default 24 hours)
     */
    async cleanupOldDbSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
        const cutoff = new Date(Date.now() - maxAgeMs);

        try {
            const result = await db
                .delete(liveCallSessions)
                .where(lt(liveCallSessions.createdAt, cutoff));

            // Note: Drizzle doesn't return count directly, this is a placeholder
            console.log(`[SessionManager] Cleaned up old DB sessions created before ${cutoff}`);
            return 0; // Would need to query count before delete for accurate number
        } catch (error) {
            console.error('[SessionManager] Error cleaning up old DB sessions:', error);
            throw error;
        }
    }
}

// Export singleton instance
export const sessionManager = new CallScriptSessionManager();

// Also export class for testing
export { CallScriptSessionManager };
