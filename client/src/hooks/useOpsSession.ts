/**
 * useOpsSession — client state for one Ops Manager chat session (B-WP3).
 *
 * React Query owns the durable state (sessions list + session detail from
 * /api/ops); the SSE bus (useCommsEvents, extended with ops_* events) only
 * hints at staleness and carries the LIVE run stream. Contracts are frozen in
 * shared/ops-types.ts.
 *
 * Live-run model: ops_run_started opens a LiveRun, every ops_run_event appends
 * a LeanRunStep, ops_run_finished settles it. While the ops agent has a
 * `run_comms_agent` tool_call outstanding, the delegated comms run's
 * conversation-keyed run_event steps (same SSE bus) are appended NESTED so the
 * dock shows the sub-agent working beneath the delegation step. The finished
 * live transcript stays visible until the assistant message row (which carries
 * the durable transcript) lands in the refetched session detail — the
 * `liveRunVisible` derivation in the dock handles that swap without timers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCommsEvents, type CommsEvent } from '@/hooks/useCommsEvents';
import type { LeanRunStep, OpsMessageDTO, OpsSessionDTO } from '@shared/ops-types';

// ---------------------------------------------------------------- api helpers

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function opsFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
        let message = `${res.status}`;
        try {
            const data = await res.json();
            message = data?.error ?? data?.message ?? message;
        } catch { /* non-JSON error body */ }
        throw new Error(message);
    }
    return res.json() as Promise<T>;
}

export function createOpsSession(title?: string): Promise<OpsSessionDTO> {
    return opsFetch<OpsSessionDTO>('POST', '/api/ops/sessions', title ? { title } : {});
}

export function archiveOpsSession(sessionId: string): Promise<OpsSessionDTO> {
    return opsFetch<OpsSessionDTO>('POST', `/api/ops/sessions/${sessionId}/archive`);
}

// ---------------------------------------------------------------- sessions list

export function useOpsSessions(enabled = true) {
    return useQuery({
        queryKey: ['ops-sessions'],
        queryFn: () => opsFetch<OpsSessionDTO[]>('GET', '/api/ops/sessions?limit=20'),
        enabled,
        staleTime: 60_000,
    });
}

// ---------------------------------------------------------------- live run state

/** One live step: nested = it belongs to a delegated comms-agent sub-run. */
export interface DockRunStep {
    step: LeanRunStep;
    nested: boolean;
}

export interface LiveRun {
    runId: string;
    steps: DockRunStep[];
    finished: null | { ok: boolean };
}

interface SessionDetail {
    session: OpsSessionDTO;
    messages: OpsMessageDTO[];
}

// ---------------------------------------------------------------- the hook

export function useOpsSession(sessionId: string | null) {
    const queryClient = useQueryClient();
    const [liveRun, setLiveRun] = useState<LiveRun | null>(null);
    const [sending, setSending] = useState(false);
    // Is a run_comms_agent tool_call still awaiting its tool_result? While
    // true, conversation-keyed comms run_events are appended as nested steps.
    const nestingRef = useRef(false);

    // Switching sessions: the live run on screen belonged to the old session.
    useEffect(() => {
        setLiveRun(null);
        nestingRef.current = false;
    }, [sessionId]);

    const detail = useQuery({
        queryKey: ['ops-session', sessionId],
        queryFn: () => opsFetch<SessionDetail>('GET', `/api/ops/sessions/${sessionId}`),
        enabled: !!sessionId,
        staleTime: 15_000,
    });

    useCommsEvents(useCallback((evt: CommsEvent) => {
        if (!sessionId) return;

        // Nested comms-agent sub-run: the ops agent delegated via run_comms_agent
        // and the comms run streams conversation-keyed run_events on the same bus.
        if (evt.type === 'run_event') {
            if (!nestingRef.current) return;
            const step = evt.event;
            if (!step || typeof step !== 'object') return;
            setLiveRun((prev) => prev && !prev.finished
                ? { ...prev, steps: [...prev.steps, { step: step as LeanRunStep, nested: true }] }
                : prev);
            return;
        }

        if (evt.type !== 'ops_message' && evt.type !== 'ops_run_started'
            && evt.type !== 'ops_run_event' && evt.type !== 'ops_run_finished') return;
        if (evt.sessionId !== sessionId) return;

        if (evt.type === 'ops_message') {
            queryClient.invalidateQueries({ queryKey: ['ops-session', sessionId] });
            return;
        }
        if (evt.type === 'ops_run_started') {
            nestingRef.current = false;
            setLiveRun({ runId: evt.runId, steps: [], finished: null });
            return;
        }
        if (evt.type === 'ops_run_finished') {
            nestingRef.current = false;
            setLiveRun((prev) => {
                // Joined after run_started: still show the outcome.
                const current = prev && prev.runId === evt.runId ? prev : { runId: evt.runId, steps: [], finished: null };
                return { ...current, finished: { ok: evt.ok !== false } };
            });
            return;
        }
        // ops_run_event
        const step = evt.step;
        if (!step || typeof step !== 'object') return;
        if (step.type === 'tool_call' && step.tool === 'run_comms_agent') nestingRef.current = true;
        if ((step.type === 'tool_result' || step.type === 'tool_error') && step.tool === 'run_comms_agent') nestingRef.current = false;
        setLiveRun((prev) => {
            // Joined mid-run (dock opened after run_started): start tracking anyway.
            const current = prev && prev.runId === evt.runId ? prev : { runId: evt.runId, steps: [], finished: null };
            return { ...current, steps: [...current.steps, { step, nested: false }] };
        });
    }, [sessionId, queryClient]));

    const sendMessage = useCallback(async (content: string): Promise<void> => {
        if (!sessionId) throw new Error('no session selected');
        setSending(true);
        try {
            const { runId } = await opsFetch<{ runId: string }>('POST', `/api/ops/sessions/${sessionId}/messages`, { content });
            // Open the live run immediately — ops_run_started confirms it, but the
            // composer must lock the moment the 202 lands, not an SSE hop later.
            setLiveRun({ runId, steps: [], finished: null });
            queryClient.invalidateQueries({ queryKey: ['ops-session', sessionId] });
        } finally {
            setSending(false);
        }
    }, [sessionId, queryClient]);

    const messages = detail.data?.messages ?? [];
    const activeRunId = liveRun && !liveRun.finished ? liveRun.runId : null;
    // Keep the finished live transcript on screen until the durable assistant
    // row (same runId, carries the persisted transcript) arrives via refetch.
    const liveRunVisible = !!liveRun
        && (!liveRun.finished || !messages.some((m) => m.runId === liveRun.runId));

    return {
        session: detail.data?.session ?? null,
        messages,
        isLoading: detail.isLoading,
        liveRun: liveRunVisible ? liveRun : null,
        activeRunId,
        sending,
        sendMessage,
    };
}
