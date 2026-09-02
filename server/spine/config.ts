/**
 * The spine's switch — app_settings key `spine`, read through the SAME fail-closed pattern as
 * `comms_agent` (server/agents/comms.ts): a row we cannot read is not permission to run anything.
 *
 * Phase 2 ships DARK: `enabled: false` here and in the live row until Phase 3 flips it. Every
 * entry point (comms-lanes arm, comms-sweep tick, Ops Manager's delegation tool) asks
 * `isSpineEnabled()` first and falls through to byte-for-byte legacy behaviour when it is off.
 * Per-agent switches (`agents.scoper.enabled` etc.) let one role be turned off without the rest.
 *
 * Process-local mode exists for the same reason as the comms one (21 Aug 2026 incident): a test
 * suite must never read or write the live row. `SPINE_CONFIG_OVERRIDE` (JSON) is the env seam.
 *
 * Merged 2 Sep 2026 from the two Phase 2 streams (spine core + Scoper) — both fields sets kept.
 */
import { randomUUID } from 'crypto';

export const SPINE_SETTING_KEY = 'spine';

export type SpineAgentKey = 'scoper' | 'quote_clerk' | 'recovery' | 'verifier' | 'triage';

export interface SpineConfig {
    /** Master switch. Off = nothing in server/spine runs against customers. */
    enabled: boolean;
    /** Per-agent switches; absent = follows the master switch. */
    agents: Partial<Record<SpineAgentKey, { enabled: boolean }>>;
    /** Shadow: compute and record every run, never exit. (Phase 3 makes this a three-way mode.) */
    shadow: boolean;
    /** How many due runs one worker tick may execute. */
    sweepLimit: number;
    /** Inbound debounce: one run after a burst, not three during it. */
    debounceMinutes: number;
    /** The triage model (design §3.8: Haiku 4.5). */
    triageModel: string;
    /** Pack-level city key (§3.4): the second city is config. */
    city: string;
    /**
     * Phase 3: the three-way switch. When present it wins; when absent the mode is derived from
     * `enabled` + `shadow` (see server/spine/switch.ts). off = legacy only; shadow = spine runs
     * dry, legacy still drafts; live = spine only.
     */
    mode?: 'off' | 'shadow' | 'live';
    /** Phase 3: promotion/demotion job. Off = tiers never move by themselves. */
    autonomy: { enabled: boolean };
    /** Phase 3: the 08:30 sampler. Off = no judge calls, no review queue. */
    sampler: { enabled: boolean; rate: number; min: number; max: number };
}

export const DEFAULT_SPINE_CONFIG: SpineConfig = {
    enabled: false,
    agents: {},
    shadow: false,
    sweepLimit: 3,
    debounceMinutes: 10,
    triageModel: 'claude-haiku-4-5',
    city: 'nottingham',
    autonomy: { enabled: false },
    sampler: { enabled: false, rate: 0.1, min: 1, max: 15 },
};

function mergeOverDefaults(patch: Partial<SpineConfig> | null | undefined): SpineConfig {
    return {
        ...DEFAULT_SPINE_CONFIG,
        ...(patch ?? {}),
        agents: { ...(patch?.agents ?? {}) },
        autonomy: { ...DEFAULT_SPINE_CONFIG.autonomy, ...(patch?.autonomy ?? {}) },
        sampler: { ...DEFAULT_SPINE_CONFIG.sampler, ...(patch?.sampler ?? {}) },
    };
}

/** Phase 3: the promotion/demotion job runs only with the master switch AND its own switch on. */
export async function isAutonomyEnabled(): Promise<boolean> {
    const cfg = await getSpineConfig();
    return cfg.enabled === true && cfg.autonomy.enabled === true;
}

let localConfig: SpineConfig | null = null;

/** Suites call this once; from then on this process never touches the live row. */
export function useProcessLocalSpineConfig(seed?: Partial<SpineConfig>): SpineConfig {
    localConfig = mergeOverDefaults(seed);
    console.log('[Spine] Config is PROCESS-LOCAL from here: the live spine row will be neither read nor written by this process.');
    return structuredClone(localConfig);
}

export function _resetSpineConfigForTests(): void {
    localConfig = null;
}

/** Fail closed: anything unreadable is `enabled: false`. */
export async function getSpineConfig(): Promise<SpineConfig> {
    if (localConfig) return structuredClone(localConfig);
    const override = process.env.SPINE_CONFIG_OVERRIDE;
    if (override) {
        try { return mergeOverDefaults(JSON.parse(override)); } catch { /* fall through to the row */ }
    }
    try {
        const { db } = await import('../db');
        const { appSettings } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SPINE_SETTING_KEY)).limit(1);
        if (!row) return { ...DEFAULT_SPINE_CONFIG };
        return mergeOverDefaults(row.value as Partial<SpineConfig>);
    } catch (error: any) {
        console.error('[Spine] Could not read config, treating as disabled:', error?.message ?? error);
        return { ...DEFAULT_SPINE_CONFIG, enabled: false }; // fail closed
    }
}

export async function isSpineEnabled(agent?: SpineAgentKey): Promise<boolean> {
    const cfg = await getSpineConfig();
    if (cfg.enabled !== true) return false;
    if (agent && cfg.agents[agent] && cfg.agents[agent]!.enabled === false) return false;
    return true;
}

/** Flip or tune the spine. Every change is a system event, so /admin/activity shows who flipped what. */
export async function setSpineConfig(patch: Partial<SpineConfig>, by = 'system'): Promise<SpineConfig> {
    const current = await getSpineConfig();
    const next: SpineConfig = mergeOverDefaults({ ...current, ...patch, agents: { ...current.agents, ...(patch.agents ?? {}) } });
    if (localConfig) {
        localConfig = next;
        return structuredClone(next);
    }
    const { db } = await import('../db');
    const { appSettings } = await import('@shared/schema');
    await db.insert(appSettings)
        .values({ id: randomUUID(), key: SPINE_SETTING_KEY, value: next, description: 'Comms spine (Phase 2): master switch, per-agent switches, shadow, debounce, triage model' })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
    try {
        const { logSystemEvent } = await import('../system-events');
        void logSystemEvent({ kind: 'config_change', summary: `spine config changed by ${by}: ${JSON.stringify(patch)}`, detail: { before: current, after: next, by }, source: 'spine' });
    } catch { /* bookkeeping only */ }
    return next;
}

/** Per-agent switch (Phase 2 / C name). Same semantics as isSpineEnabled(agent). */
export async function isSpineAgentEnabled(agent: SpineAgentKey): Promise<boolean> {
    return isSpineEnabled(agent);
}
