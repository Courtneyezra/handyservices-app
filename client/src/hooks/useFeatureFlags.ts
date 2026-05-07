/**
 * useFeatureFlags — single source of truth for client-visible feature flags.
 *
 * Server: GET /api/feature-flags returns `{ data: { flag_key: boolean, ... } }`.
 * Cached 60s per `feature-flags.md` §6.
 *
 * Booking & Dispatch v2 modules read flags via this hook to gate UI behaviour;
 * server-internal flags (LEGACY_BRIDGE, ROUTING_ENGINE) are deliberately not
 * exposed.
 */

import { useQuery } from '@tanstack/react-query';

export interface FeatureFlags {
    flex_tier: boolean;
    job_tagging: boolean;
    units_bench: boolean;
    availability_engine: boolean;
    control_tower: boolean;
    contractor_app_v2: boolean;
    day_pack_page_prod: boolean;
    pay_protection: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
    flex_tier: false,
    job_tagging: false,
    units_bench: false,
    availability_engine: false,
    control_tower: false,
    contractor_app_v2: false,
    day_pack_page_prod: false,
    pay_protection: false,
};

export function useFeatureFlags(): FeatureFlags {
    const { data } = useQuery<{ data: FeatureFlags }>({
        queryKey: ['feature-flags'],
        queryFn: async () => {
            const res = await fetch('/api/feature-flags');
            if (!res.ok) return { data: DEFAULT_FLAGS };
            return res.json();
        },
        staleTime: 60_000, // 60s per spec
    });
    return { ...DEFAULT_FLAGS, ...(data?.data ?? {}) };
}
