/**
 * useDayPack — TanStack Query hooks for the production day-pack page
 * (Module 15). Powers `/dispatch/:packId` (DayPackOfferPage.tsx).
 *
 * Backend contract: `server/routes/day-pack-public-routes.ts`
 *   GET  /api/day-packs/:packId/public?token=<unitId>
 *   POST /api/day-packs/:packId/stops/:stopNum/complete
 *   POST /api/day-packs/:packId/materials/collected
 *
 * State sync strategy (per Module 15 §9): WebSocket would be ideal but the
 * Phase 7B build uses a 30s polling fallback only — every state-changing
 * mutation refetches the envelope, and React Query's interval picks up
 * out-of-band changes (e.g. customer cancellation, admin rotation).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DayPackEnvelope } from '@/lib/dayPackTransforms';

const dayPackKey = (packId: string) => ['dayPack', packId] as const;

interface UseDayPackOptions {
    /** Disable polling and fetching when the page hasn't mounted with a token yet. */
    enabled?: boolean;
}

interface DayPackResponse {
    data: DayPackEnvelope;
}

interface ApiError {
    error: string;
    code?: string;
    message?: string;
}

async function fetchDayPack(packId: string, token: string): Promise<DayPackEnvelope> {
    const res = await fetch(`/api/day-packs/${encodeURIComponent(packId)}/public?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
        let body: ApiError | null = null;
        try {
            body = (await res.json()) as ApiError;
        } catch {
            // ignore JSON parse failure — surface status code below
        }
        const err = new Error(body?.message || `day-pack fetch failed (${res.status})`) as Error & {
            status?: number;
            code?: string;
        };
        err.status = res.status;
        err.code = body?.code ?? body?.error;
        throw err;
    }
    const json = (await res.json()) as DayPackResponse;
    return json.data;
}

/**
 * Read the day-pack envelope. Polls every 30 s while the tab is visible so
 * the page reflects out-of-band state changes (admin moves, customer cancel,
 * sibling-device completion).
 */
export function useDayPack(packId: string, token: string, options: UseDayPackOptions = {}) {
    const enabled = options.enabled !== false && !!packId && !!token;
    return useQuery<DayPackEnvelope, Error & { status?: number; code?: string }>({
        queryKey: dayPackKey(packId),
        queryFn: () => fetchDayPack(packId, token),
        enabled,
        refetchInterval: enabled ? 30_000 : false,
        refetchOnWindowFocus: enabled,
        staleTime: 10_000,
        retry: (failureCount, error) => {
            // Don't retry on 401/403/404/410 — those are terminal.
            const status = (error as { status?: number }).status;
            if (status && [401, 403, 404, 410].includes(status)) return false;
            return failureCount < 2;
        },
    });
}

// ───────────────────────────────────────────────────────────────────────────
// Mutations
// ───────────────────────────────────────────────────────────────────────────

interface MarkStopCompleteVars {
    stopNum: number;
    photos: string[];
    notes?: string;
}

export function useMarkStopComplete(packId: string, token: string) {
    const qc = useQueryClient();
    return useMutation<DayPackEnvelope, Error, MarkStopCompleteVars>({
        mutationFn: async ({ stopNum, photos, notes }) => {
            if (!photos || photos.length < 1) {
                throw new Error('At least 1 photo is required to mark a stop complete');
            }
            const res = await fetch(
                `/api/day-packs/${encodeURIComponent(packId)}/stops/${stopNum}/complete?token=${encodeURIComponent(token)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ photos, notes }),
                },
            );
            if (!res.ok) {
                let body: ApiError | null = null;
                try {
                    body = (await res.json()) as ApiError;
                } catch {
                    /* ignore */
                }
                throw new Error(body?.message || `mark complete failed (${res.status})`);
            }
            const json = (await res.json()) as DayPackResponse;
            return json.data;
        },
        onSuccess: (envelope) => {
            qc.setQueryData(dayPackKey(packId), envelope);
        },
    });
}

export function useMarkMaterialsCollected(packId: string, token: string) {
    const qc = useQueryClient();
    return useMutation<DayPackEnvelope, Error, { collected: boolean }>({
        mutationFn: async ({ collected }) => {
            const res = await fetch(
                `/api/day-packs/${encodeURIComponent(packId)}/materials/collected?token=${encodeURIComponent(token)}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ collected }),
                },
            );
            if (!res.ok) {
                let body: ApiError | null = null;
                try {
                    body = (await res.json()) as ApiError;
                } catch {
                    /* ignore */
                }
                throw new Error(body?.message || `materials toggle failed (${res.status})`);
            }
            const json = (await res.json()) as DayPackResponse;
            return json.data;
        },
        onSuccess: (envelope) => {
            qc.setQueryData(dayPackKey(packId), envelope);
        },
    });
}

interface AcceptResult {
    packId: string;
    dispatchIds: string[];
    status?: string;
}

export function useAcceptDayPack(packId: string, token: string) {
    const qc = useQueryClient();
    return useMutation<AcceptResult, Error, void>({
        mutationFn: async () => {
            // Module 06 endpoint — uses X-Contractor-Token header, not query param.
            const res = await fetch(
                `/api/contractor/day-packs/${encodeURIComponent(packId)}/accept`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Contractor-Token': token,
                    },
                },
            );
            if (!res.ok) {
                let body: ApiError | null = null;
                try {
                    body = (await res.json()) as ApiError;
                } catch {
                    /* ignore */
                }
                throw new Error(body?.message || `accept failed (${res.status})`);
            }
            return (await res.json()) as AcceptResult;
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: dayPackKey(packId) });
        },
    });
}

export function useDeclineDayPack(packId: string, token: string) {
    const qc = useQueryClient();
    return useMutation<{ status: string }, Error, { reason?: string }>({
        mutationFn: async ({ reason }) => {
            const res = await fetch(
                `/api/contractor/day-packs/${encodeURIComponent(packId)}/decline`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Contractor-Token': token,
                    },
                    body: JSON.stringify({ reason }),
                },
            );
            if (!res.ok) {
                let body: ApiError | null = null;
                try {
                    body = (await res.json()) as ApiError;
                } catch {
                    /* ignore */
                }
                throw new Error(body?.message || `decline failed (${res.status})`);
            }
            return (await res.json()) as { status: string };
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: dayPackKey(packId) });
        },
    });
}
