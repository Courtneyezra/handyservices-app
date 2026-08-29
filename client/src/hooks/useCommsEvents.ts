/**
 * useCommsEvents — one shared SSE connection to GET /api/comms/events, turned into React Query
 * cache invalidations (and, optionally, a raw event feed for other consumers such as the live
 * run panel).
 *
 * The stream is a VIEW over DB state, never the source of truth. Events carry no payloads worth
 * trusting — each one is only a hint that a query is stale:
 *   board_delta → invalidate ['comms-board'] (all lanes)
 *   draft_delta → invalidate ['comms-thread'] (drafts ride inside the thread response)
 *   open/reopen → invalidate BOTH, because any gap in the stream may have swallowed events.
 *
 * One EventSource is shared module-wide however many components mount the hook; the FIRST
 * mounted instance owns invalidation so a second consumer (LiveRunPanel) cannot double-refetch.
 * EventSource cannot set headers, so the admin session token travels as ?token= — the server
 * runs the exact same requireAdmin check against it.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/** Mirror of the server's CommsEvent union (server/comms-events.ts). Extend only additively. */
export type CommsEvent =
    | { type: 'board_delta'; conversationId: string; reason: 'inbound' | 'outbound' | 'stage' | 'tags' | 'priority' | 'sla' | 'other'; at: string }
    | { type: 'draft_delta'; draftId: number | string; conversationId?: string; status: 'pending' | 'approved' | 'sent' | 'rejected' | 'blocked' | 'edited'; at: string }
    | { type: 'run_started'; runId: string; conversationId: string; at: string }
    | { type: 'run_event'; runId: string; conversationId: string; event: unknown; at: string }
    | { type: 'run_finished'; runId: string; conversationId: string; ok: boolean; at: string };

type Subscriber = {
    id: symbol;
    onEvent?: (evt: CommsEvent) => void;
    onOpen?: () => void;
};

// ------------------------------------------------------------------ recent-change registry
//
// Attention cues for the board: every board_delta that arrives over the stream lands here
// (conversationId → what changed, when) so a Card can flash the change as the refetched data
// paints. EVENT-driven only, on purpose — the 5-minute fallback refetch and manual refreshes
// never touch this registry, so a background refetch can't flash 400 cards at once.

/** Reason carried by a board_delta — what changed about the conversation. */
export type BoardChangeReason = Extract<CommsEvent, { type: 'board_delta' }>['reason'];

const FLASH_WINDOW_MS = 2_500;
const recentBoardChanges = new Map<string, { at: number; reason: BoardChangeReason }>();
const recentChangeListeners = new Set<() => void>();

function recordBoardChange(evt: Extract<CommsEvent, { type: 'board_delta' }>): void {
    const now = Date.now();
    recentBoardChanges.set(evt.conversationId, { at: now, reason: evt.reason });
    // Opportunistic sweep: entries expire on read anyway, this just stops a long session's
    // map growing without bound.
    for (const [id, rec] of recentBoardChanges) {
        if (now - rec.at >= FLASH_WINDOW_MS) recentBoardChanges.delete(id);
    }
    for (const listener of recentChangeListeners) {
        try {
            listener();
        } catch (error) {
            console.warn('[useCommsEvents] recent-change listener failed:', error);
        }
    }
}

// ------------------------------------------------------------------ shared connection state
//
// Module-level on purpose: every mounted hook shares ONE EventSource. `subscribers` is a Map
// (insertion-ordered) so "the first mounted instance" is a well-defined invalidation owner.

const subscribers = new Map<symbol, Subscriber>();
let source: EventSource | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function streamUrl(): string {
    const token = localStorage.getItem('adminToken') ?? '';
    return `/api/comms/events?token=${encodeURIComponent(token)}`;
}

function isOwner(id: symbol): boolean {
    const first = subscribers.keys().next();
    return !first.done && first.value === id;
}

function dispatch(fn: (sub: Subscriber) => void): void {
    for (const sub of subscribers.values()) {
        try {
            fn(sub);
        } catch (error) {
            // One consumer's render-time bug must not starve the others of events.
            console.warn('[useCommsEvents] subscriber callback failed:', error);
        }
    }
}

function connect(): void {
    if (source || subscribers.size === 0) return;

    const es = new EventSource(streamUrl());
    source = es;

    es.onopen = () => {
        retryAttempt = 0;
        // Snapshot refresh after ANY gap — connect and reconnect look identical here, and
        // events missed while disconnected are unrecoverable by design (the DB has the truth).
        dispatch((sub) => sub.onOpen?.());
    };

    es.onmessage = (msg) => {
        let evt: CommsEvent;
        try {
            evt = JSON.parse(msg.data) as CommsEvent;
        } catch {
            return; // not ours to crash over — heartbeats arrive as comments and never land here
        }
        if (!evt || typeof evt !== 'object' || !('type' in evt)) return;
        if (evt.type === 'board_delta') recordBoardChange(evt);
        dispatch((sub) => sub.onEvent?.(evt));
    };

    es.onerror = () => {
        // EventSource retries transient drops itself. CLOSED means it has given up (e.g. the
        // server restarted mid-handshake, or auth failed) — retry manually with jittered
        // exponential backoff so a redeploy doesn't produce a thundering herd of reconnects.
        if (es.readyState !== EventSource.CLOSED) return;
        es.close();
        if (source === es) source = null;
        if (retryTimer || subscribers.size === 0) return;
        const delay = Math.min(30_000, 1_000 * 2 ** retryAttempt) + Math.random() * 1_000;
        retryAttempt++;
        retryTimer = setTimeout(() => {
            retryTimer = null;
            connect();
        }, delay);
    };
}

function disconnectIfIdle(): void {
    if (subscribers.size > 0) return;
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
    source?.close();
    source = null;
    retryAttempt = 0;
}

// ------------------------------------------------------------------ the hook

/**
 * Subscribe to the shared comms event stream.
 *
 * With no arguments (CommsPage's usage) it just keeps the connection alive and maps events to
 * cache invalidations. Pass `onEvent` to also receive every raw event — this is the subscriber
 * seam other consumers (e.g. LiveRunPanel) build on, without opening a second EventSource.
 */
export function useCommsEvents(onEvent?: (evt: CommsEvent) => void): void {
    const queryClient = useQueryClient();

    // The consumer's callback rides in a ref so a re-render never tears down the subscription
    // (and with it, everyone else's shared connection refcount).
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;

    useEffect(() => {
        const id = Symbol('comms-events-subscriber');

        const invalidateBoard = () => queryClient.invalidateQueries({ queryKey: ['comms-board'] });
        // The ['comms-thread', id] query carries the open thread's messages AND its pending
        // drafts, so it is the target for draft_delta — and for board_delta too, because an
        // inbound/outbound also changed the open thread and the old 15s poll would have caught
        // it. Prefix match: only the currently open thread's query is active anyway.
        const invalidateThread = () => queryClient.invalidateQueries({ queryKey: ['comms-thread'] });

        subscribers.set(id, {
            id,
            onOpen: () => {
                if (!isOwner(id)) return;
                invalidateBoard();
                invalidateThread();
            },
            onEvent: (evt) => {
                onEventRef.current?.(evt);
                // Invalidation runs ONCE per event however many hook instances are mounted.
                if (!isOwner(id)) return;
                if (evt.type === 'board_delta') {
                    invalidateBoard();
                    invalidateThread();
                } else if (evt.type === 'draft_delta') {
                    invalidateThread();
                }
            },
        });
        connect();

        return () => {
            subscribers.delete(id);
            disconnectIfIdle();
        };
    }, [queryClient]);
}

/**
 * Did a board_delta touch this conversation in the last ~2.5s? Returns the delta's reason while
 * the window is open, null after — re-rendering the caller both when the event arrives and when
 * it expires, so a CSS flash keyed off the return value starts AND gets cleaned up.
 *
 * Registry-backed (see recordBoardChange): only real stream events flash, never refetches.
 */
export function useRecentBoardChange(conversationId: string): BoardChangeReason | null {
    const [reason, setReason] = useState<BoardChangeReason | null>(() => {
        const rec = recentBoardChanges.get(conversationId);
        return rec && Date.now() - rec.at < FLASH_WINDOW_MS ? rec.reason : null;
    });

    useEffect(() => {
        let expiry: ReturnType<typeof setTimeout> | null = null;
        const sync = () => {
            const rec = recentBoardChanges.get(conversationId);
            const msLeft = rec ? rec.at + FLASH_WINDOW_MS - Date.now() : 0;
            // setState with an unchanged value is a no-op render-wise, so every mounted card
            // hearing every event is cheap — only the touched card actually re-renders.
            setReason(rec && msLeft > 0 ? rec.reason : null);
            if (expiry) clearTimeout(expiry);
            expiry = rec && msLeft > 0 ? setTimeout(sync, msLeft) : null;
        };
        sync();
        recentChangeListeners.add(sync);
        return () => {
            recentChangeListeners.delete(sync);
            if (expiry) clearTimeout(expiry);
        };
    }, [conversationId]);

    return reason;
}
