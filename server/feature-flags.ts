// server/feature-flags.ts
//
// Central feature flag lookup. Every flag-gated module reads from here.
//
// Defaults:
// - All v2 flags default OFF in both prod and non-prod. We do not auto-enable
//   in non-prod at this time — staging is exercised by manually setting envs
//   in Railway. Per ADR-001, FF_LEGACY_BRIDGE defaults ON until Phase 9 cutover.
//
// Configured via Railway env vars (process.env.FF_*). No DB-backed flag store
// — a DB outage cannot wedge feature state.
//
// Flag names + behaviours: docs/architecture/feature-flags.md
// Phase mapping:           docs/architecture/master-plan.md §"Build phases"

function env(key: string, fallback = '0'): string {
    return (process.env[key] ?? fallback).toString().trim();
}

function flag(key: string, defaultProd = '0', defaultNonProd = '0'): boolean {
    const isProd = process.env.NODE_ENV === 'production';
    const def = isProd ? defaultProd : defaultNonProd;
    const v = env(key, def);
    return v === '1' || v.toLowerCase() === 'true';
}

export const FLAGS = {
    FLEX_TIER:           flag('FF_FLEX_TIER'),
    JOB_TAGGING:         flag('FF_JOB_TAGGING'),
    UNITS_BENCH:         flag('FF_UNITS_BENCH'),
    AVAILABILITY_ENGINE: flag('FF_AVAILABILITY_ENGINE'),
    CONTROL_TOWER:       flag('FF_CONTROL_TOWER'),
    ROUTING_ENGINE:      flag('FF_ROUTING_ENGINE'),
    DAY_PACK:            flag('FF_DAY_PACK'),
    PAY_PROTECTION:      flag('FF_PAY_PROTECTION'),
    CONTRACTOR_APP_V2:   flag('FF_CONTRACTOR_APP_V2'),
    DAY_PACK_PAGE_PROD:  flag('FF_DAY_PACK_PAGE_PROD'),
    NOTIFICATIONS_V2:    flag('FF_NOTIFICATIONS_V2'),
    LEGACY_BRIDGE:       flag('FF_LEGACY_BRIDGE', '1', '1'),  // defaults ON per ADR-001
} as const;

export type FlagKey = keyof typeof FLAGS;

// Public surface for the /api/feature-flags endpoint — only flags safe to expose
// to the client. Server-only flags (LEGACY_BRIDGE, ROUTING_ENGINE) are NOT
// included here per feature-flags.md §6.
export function publicFlags(): Record<string, boolean> {
    return {
        flex_tier:           FLAGS.FLEX_TIER,
        job_tagging:         FLAGS.JOB_TAGGING,
        units_bench:         FLAGS.UNITS_BENCH,
        availability_engine: FLAGS.AVAILABILITY_ENGINE,
        control_tower:       FLAGS.CONTROL_TOWER,
        contractor_app_v2:   FLAGS.CONTRACTOR_APP_V2,
        day_pack_page_prod:  FLAGS.DAY_PACK_PAGE_PROD,
    };
}

// Boot-time dependency check (feature-flags.md §4). Logs a warning if a
// dependent flag is ON without its prerequisites. Does not throw — operators
// may flip flags mid-deploy.
export function logFlagDependencyWarnings(): void {
    const warnings: string[] = [];
    if (FLAGS.AVAILABILITY_ENGINE && !FLAGS.UNITS_BENCH) {
        warnings.push('FF_AVAILABILITY_ENGINE requires FF_UNITS_BENCH');
    }
    if (FLAGS.ROUTING_ENGINE && !(FLAGS.UNITS_BENCH && FLAGS.AVAILABILITY_ENGINE && FLAGS.JOB_TAGGING)) {
        warnings.push('FF_ROUTING_ENGINE requires FF_UNITS_BENCH, FF_AVAILABILITY_ENGINE, FF_JOB_TAGGING');
    }
    if (FLAGS.DAY_PACK && !(FLAGS.UNITS_BENCH && FLAGS.AVAILABILITY_ENGINE && FLAGS.ROUTING_ENGINE)) {
        warnings.push('FF_DAY_PACK requires FF_UNITS_BENCH, FF_AVAILABILITY_ENGINE, FF_ROUTING_ENGINE');
    }
    if (FLAGS.PAY_PROTECTION && !FLAGS.UNITS_BENCH) {
        warnings.push('FF_PAY_PROTECTION requires FF_UNITS_BENCH');
    }
    if (FLAGS.CONTROL_TOWER && !FLAGS.JOB_TAGGING) {
        warnings.push('FF_CONTROL_TOWER requires FF_JOB_TAGGING');
    }
    if (FLAGS.CONTRACTOR_APP_V2 && !FLAGS.UNITS_BENCH) {
        warnings.push('FF_CONTRACTOR_APP_V2 requires FF_UNITS_BENCH');
    }
    if (FLAGS.DAY_PACK_PAGE_PROD && !(FLAGS.DAY_PACK && FLAGS.CONTRACTOR_APP_V2)) {
        warnings.push('FF_DAY_PACK_PAGE_PROD requires FF_DAY_PACK, FF_CONTRACTOR_APP_V2');
    }
    for (const w of warnings) {
        console.warn(`[feature-flags] dependency warning: ${w}`);
    }
}
