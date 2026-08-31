/**
 * useQuoteResearch — fetches and polls the estimator's QuoteBuild for a conversation.
 *
 * The estimator is an async agent run: POST starts it, returning an estimateId;
 * GET polls until status is 'complete' or 'failed'. This hook abstracts that into
 * a single reactive state: { data, isLoading, isResearching, error, refetch, start }.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { QuoteBuild } from '@shared/quote-build';

function getAuthHeaders(): Record<string, string> {
    const token = localStorage.getItem('adminToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
}

interface EstimateResponse {
    status: 'running' | 'complete' | 'failed';
    build?: QuoteBuild;
    summary?: string;
    turns?: number;
    error?: string;
}

interface UseQuoteResearchResult {
    /** The completed QuoteBuild, if available. */
    data: QuoteBuild | null;
    /** True while starting a new estimate. */
    isLoading: boolean;
    /** True while the estimator is running (polling). */
    isResearching: boolean;
    /** Error message if the estimate failed. */
    error: string | null;
    /** Agent's summary text on completion. */
    summary: string | null;
    /** Number of agent turns used. */
    turns: number | null;
    /** Start a new estimator run. */
    start: () => void;
    /** Poll status of the current run. */
    refetch: () => void;
}

/**
 * Custom hook for managing quote research/estimator state.
 *
 * @param conversationId - The conversation to estimate
 * @returns Research state and controls
 */
export function useQuoteResearch(conversationId: string): UseQuoteResearchResult {
    const queryClient = useQueryClient();
    const [estimateId, setEstimateId] = useState<string | null>(null);
    const [isResearching, setIsResearching] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [data, setData] = useState<QuoteBuild | null>(null);
    const [summary, setSummary] = useState<string | null>(null);
    const [turns, setTurns] = useState<number | null>(null);
    const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Start a new estimator run
    const startMutation = useMutation({
        mutationFn: async () => {
            const res = await fetch('/api/pricing/estimate-build', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ conversationId }),
            });
            const result = await res.json();
            if (!res.ok) {
                throw new Error(result.error || `Failed to start estimate (${res.status})`);
            }
            return result as { estimateId: string; status: string };
        },
        onSuccess: (result) => {
            setEstimateId(result.estimateId);
            setIsResearching(true);
            setError(null);
            setData(null);
            setSummary(null);
            setTurns(null);
        },
        onError: (err: Error) => {
            setError(err.message);
            setIsResearching(false);
        },
    });

    // Poll the estimate status
    const poll = useCallback(async () => {
        if (!estimateId) return;

        try {
            const res = await fetch(`/api/pricing/estimate-build/${estimateId}`, {
                headers: getAuthHeaders(),
            });
            const result: EstimateResponse = await res.json();

            if (!res.ok) {
                throw new Error(result.error || `Poll failed (${res.status})`);
            }

            if (result.status === 'complete') {
                setData(result.build ?? null);
                setSummary(result.summary ?? null);
                setTurns(result.turns ?? null);
                setIsResearching(false);
                setEstimateId(null);
            } else if (result.status === 'failed') {
                setError(result.error ?? 'Estimate failed');
                setIsResearching(false);
                setEstimateId(null);
            }
            // 'running' continues polling
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Poll failed');
            setIsResearching(false);
            setEstimateId(null);
        }
    }, [estimateId]);

    // Set up polling interval when researching
    useEffect(() => {
        if (isResearching && estimateId) {
            // Poll every 2 seconds
            pollIntervalRef.current = setInterval(poll, 2000);
            // Also poll immediately
            poll();
        }

        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
            }
        };
    }, [isResearching, estimateId, poll]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
            }
        };
    }, []);

    // Reset state when conversationId changes
    useEffect(() => {
        setEstimateId(null);
        setIsResearching(false);
        setError(null);
        setData(null);
        setSummary(null);
        setTurns(null);
    }, [conversationId]);

    return {
        data,
        isLoading: startMutation.isPending,
        isResearching,
        error,
        summary,
        turns,
        start: () => startMutation.mutate(),
        refetch: poll,
    };
}
