/**
 * useAskSession - the Handy Desk ask bar's session on the new desk's ask agent
 * (/api/comms-v2/ask, server/comms-v2/ask/routes.ts). Not the old Ops Manager's useOpsSession.
 *
 * React Query holds the durable state: today's session (POST /sessions/today, one per person per
 * London day) and its messages. The shared comms event stream (useCommsEvents) carries the live
 * run as ops_* events for this session, folded by applyAskEvent; an ops_message only marks the
 * session detail stale. The fold and the exchange on screen are in client/src/lib/handy-desk-ask.ts.
 */
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCommsEvents, type CommsEvent } from '@/hooks/useCommsEvents';
import type { AskMessageDTO, AskVia, OpsSessionDTO } from '@shared/ops-types';
import type { DeskSelection } from '@/lib/handy-desk-queue';
import {
    ASK_BASE, LIVE_RUN_POLL_MS, applyAskEvent, askBody, askRefusal, currentExchange, settleRun,
    type AskRun, type PendingAsk,
} from '@/lib/handy-desk-ask';

function authHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

class AskError extends Error {}

async function askFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${ASK_BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new AskError(askRefusal(res.status, data?.error));
    }
    return res.json() as Promise<T>;
}

interface SessionDetail {
    session: OpsSessionDTO;
    messages: AskMessageDTO[];
}

export function useAskSession() {
    const queryClient = useQueryClient();
    const [run, setRun] = useState<AskRun | null>(null);
    const [pending, setPending] = useState<PendingAsk | null>(null);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const today = useQuery({
        queryKey: ['comms-v2-ask-today'],
        queryFn: () => askFetch<OpsSessionDTO>('POST', '/sessions/today'),
        staleTime: 5 * 60_000,
        retry: 1,
    });
    const sessionId = today.data?.id ?? null;

    const detail = useQuery({
        queryKey: ['comms-v2-ask-session', sessionId],
        queryFn: () => askFetch<SessionDetail>('GET', `/sessions/${sessionId}`),
        enabled: !!sessionId,
        staleTime: 15_000,
        refetchInterval: run && !run.finished ? LIVE_RUN_POLL_MS : false,
    });

    useEffect(() => { setRun(null); setPending(null); }, [sessionId]);

    const invalidateHeldDrafts = useCallback(() => {
        // A run may have held a draft on a file: the queue card shows it.
        queryClient.invalidateQueries({ queryKey: ['comms-v2-queue'] });
        queryClient.invalidateQueries({ queryKey: ['comms-v2-case-file'] });
    }, [queryClient]);

    useEffect(() => {
        const settled = settleRun(run, detail.data?.messages ?? []);
        if (settled === run) return;
        setRun(settled);
        invalidateHeldDrafts();
    }, [run, detail.data, invalidateHeldDrafts]);

    useCommsEvents(useCallback((evt: CommsEvent) => {
        if (!sessionId) return;
        setRun((prev) => applyAskEvent(prev, evt, sessionId).run);
        if (applyAskEvent(null, evt, sessionId).effect === 'refetch') {
            queryClient.invalidateQueries({ queryKey: ['comms-v2-ask-session', sessionId] });
        }
        if (evt.type === 'ops_run_finished' && evt.sessionId === sessionId) invalidateHeldDrafts();
    }, [sessionId, queryClient, invalidateHeldDrafts]));

    const ask = useCallback(async (text: string, via: AskVia, selection: DeskSelection | null): Promise<boolean> => {
        const body = askBody(text, via, selection);
        if (!body.text) return false;
        if (!sessionId) return false;
        setSending(true);
        setError(null);
        try {
            const { runId } = await askFetch<{ runId: string }>('POST', `/sessions/${sessionId}/messages`, body);
            // Open the run on the 202, so the thinking card shows before the first event arrives.
            setRun((prev) => (prev && prev.runId === runId ? prev : { runId, steps: [], finished: null }));
            setPending({ text: body.text, via, runId });
            return true;
        } catch (e: any) {
            setError(e instanceof AskError ? e.message : e?.message || 'Could not reach the desk');
            return false;
        } finally {
            setSending(false);
        }
    }, [sessionId]);

    const messages = detail.data?.messages ?? [];
    return {
        sessionId,
        sessionError: today.error ? today.error.message : null,
        exchange: currentExchange(messages, run, pending),
        busy: sending || (!!run && !run.finished),
        error,
        ask,
    };
}
