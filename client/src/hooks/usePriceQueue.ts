/**
 * usePriceQueue (T9) — the one query behind the price queue: the page at /admin/price, the
 * sidebar badge and the strip on /admin/price/:slug all read this cached query, so on the price
 * screen three consumers cost one request. Invalidate `PRICE_QUEUE_KEY` after anything that takes
 * a quote out of the queue (a send, a hold) and every consumer moves together.
 *
 * Data: GET /api/spine/price-queue (server/spine/price-queue.ts). Read-only; no pence field.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';

export const PRICE_QUEUE_KEY = ['spine-price-queue'] as const;
export const PRICE_QUEUE_URL = '/api/spine/price-queue';

export interface PriceQueueSignals { checkThis: number; unpriced: number; contradictions: number; lowConfidence: number; estimateStatus: string | null }
export interface PriceQueueItem {
    slug: string; quoteId: string; firstName: string; name: string; postcode: string | null; customerType: string;
    job: string; lineCount: number; createdAt: string | null; waitingMs: number; sourceChannel: string | null; signals: PriceQueueSignals;
}
export interface PriceQueuePayload { count: number; items: PriceQueueItem[]; oldestWaitingMs: number | null; at: string }

export function adminAuthHeaders(): Record<string, string> {
    try {
        const token = localStorage.getItem('adminToken');
        return token ? { Authorization: `Bearer ${token}` } : {};
    } catch { return {}; }
}

export function hasAdminToken(): boolean {
    try { return !!localStorage.getItem('adminToken'); } catch { return false; }
}

export async function fetchPriceQueue(): Promise<PriceQueuePayload> {
    const res = await fetch(PRICE_QUEUE_URL, { headers: adminAuthHeaders() });
    if (res.status === 401 || res.status === 403) throw new Error('AUTH');
    if (!res.ok) throw new Error(`price queue ${res.status}`);
    return res.json();
}

/** The queue. `enabled: false` skips the request entirely (the sidebar with no admin token). */
export function usePriceQueue(opts: { enabled?: boolean; refetchInterval?: number | false } = {}) {
    return useQuery<PriceQueuePayload>({
        queryKey: PRICE_QUEUE_KEY,
        queryFn: fetchPriceQueue,
        enabled: opts.enabled ?? true,
        staleTime: 30_000,
        refetchInterval: opts.refetchInterval ?? 60_000,
        refetchOnWindowFocus: true,
        retry: false,
    });
}

export function invalidatePriceQueue(qc: QueryClient): Promise<void> {
    return qc.invalidateQueries({ queryKey: PRICE_QUEUE_KEY });
}

// ---------------------------------------------------------------- pure (exported for tests)

const HOUR = 3_600_000, DAY = 24 * HOUR;

/** "just now" · "35 min" · "3 h" · "1 day" · "4 days": how long a quote has waited, for a card. */
export function ageLabel(ms: number): string {
    if (!Number.isFinite(ms) || ms < 60_000) return 'just now';
    if (ms < HOUR) return `${Math.floor(ms / 60_000)} min`;
    if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
    const days = Math.floor(ms / DAY);
    return days === 1 ? '1 day' : `${days} days`;
}

/** Under 4 h is quiet, 4 h to a day is amber, a day or more is red: the age is the point of the page. */
export type AgeTone = 'fresh' | 'warm' | 'stale';
export function ageTone(ms: number): AgeTone {
    if (!Number.isFinite(ms) || ms < 4 * HOUR) return 'fresh';
    if (ms < DAY) return 'warm';
    return 'stale';
}

/** The queue less the quote on screen: what the price screen's strip and confirm screen show. */
export function queueExcluding(q: PriceQueuePayload | undefined, slug: string): { count: number; next: PriceQueueItem | null } {
    if (!q) return { count: 0, next: null };
    const rest = q.items.filter((i) => i.slug !== slug);
    return { count: rest.length, next: rest[0] ?? null };
}
