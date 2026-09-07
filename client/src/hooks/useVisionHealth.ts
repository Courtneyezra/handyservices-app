/**
 * useVisionHealth (T14) — is the describer (Gemini, describe_video) working? One cached query
 * behind the red VISION FAILING badge on the sidebar's AI Staff item. The Vision card on
 * /admin/staff and the sandbox banner read the same verdict server-side, so the three agree.
 *
 * Data: GET /api/spine/vision-health (server/spine/vision-health.ts). Read-only.
 */
import { useQuery } from '@tanstack/react-query';
import { adminAuthHeaders } from './usePriceQueue';

export const VISION_HEALTH_KEY = ['spine-vision-health'] as const;
export const VISION_HEALTH_URL = '/api/spine/vision-health';

export interface VisionHealthPayload {
    status: 'ok' | 'failing' | 'idle' | 'unknown';
    failing: boolean;
    permanent: boolean;
    reason: string | null;
    since: string | null;
    lastAt: string | null;
    window: { runs: number; failed: number; described: number };
    checkedAt: string;
}

export async function fetchVisionHealth(): Promise<VisionHealthPayload> {
    const res = await fetch(VISION_HEALTH_URL, { headers: adminAuthHeaders() });
    if (res.status === 401 || res.status === 403) throw new Error('AUTH');
    if (!res.ok) throw new Error(`vision health ${res.status}`);
    return res.json();
}

/** The verdict. `enabled: false` skips the request entirely (the sidebar with no admin token). */
export function useVisionHealth(opts: { enabled?: boolean; refetchInterval?: number | false } = {}) {
    return useQuery<VisionHealthPayload>({
        queryKey: VISION_HEALTH_KEY,
        queryFn: fetchVisionHealth,
        enabled: opts.enabled ?? true,
        staleTime: 30_000,
        refetchInterval: opts.refetchInterval ?? 60_000,
        refetchOnWindowFocus: true,
        retry: false,
    });
}

/** The sidebar badge text, or null when there is nothing to say. */
export function visionBadge(h: VisionHealthPayload | null | undefined): string | null {
    return h?.failing ? 'VISION FAILING' : null;
}
