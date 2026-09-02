/**
 * The spine's switch — app_settings key `spine`, read through the SAME fail-closed pattern as
 * `comms_agent` (server/agents/comms.ts): a row we cannot read is not permission to run anything.
 *
 * Phase 2 ships DARK: `enabled: false` here and in the live row until Phase 3 flips it. Every
 * entry point (comms-lanes arm, comms-sweep tick, Ops Manager's delegation tool) asks
 * `isSpineEnabled()` first and falls through to byte-for-byte legacy behaviour when it is off.
 *
 * Process-local mode exists for the same reason as the comms one (21 Aug 2026 incident): a test
 * suite must never read or write the live row.
 */
import { db } from '../db';
import { appSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export const SPINE_SETTING_KEY = 'spine';

export interface SpineConfig {
    /** Master switch. Off = nothing in server/spine runs against customers. */
    enabled: boolean;
    /** How many due runs one worker tick may execute. */
    sweepLimit: number;
    /** Inbound debounce: one run after a burst, not three during it. */
    debounceMinutes: number;
    /** The triage model (design §3.8: Haiku 4.5). */
    triageModel: string;
    /** Pack-level city key (§3.4): the second city is config. */
    city: string;
}

export const DEFAULT_SPINE_CONFIG: SpineConfig = {
    enabled: false,
    sweepLimit: 3,
    debounceMinutes: 10,
    triageModel: 'claude-haiku-4-5',
    city: 'nottingham',
};

let localConfig: SpineConfig | null = null;

/** Suites call this once; from then on this process never touches the live row. */
export function useProcessLocalSpineConfig(seed?: Partial<SpineConfig>): SpineConfig {
    localConfig = { ...DEFAULT_SPINE_CONFIG, ...(seed ?? {}) };
    console.log('[Spine] Config is PROCESS-LOCAL from here: the live spine row will be neither read nor written by this process.');
    return structuredClone(localConfig);
}

export async function getSpineConfig(): Promise<SpineConfig> {
    if (localConfig) return structuredClone(localConfig);
    try {
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SPINE_SETTING_KEY));
        if (!row) return { ...DEFAULT_SPINE_CONFIG };
        return { ...DEFAULT_SPINE_CONFIG, ...((row.value ?? {}) as Partial<SpineConfig>) };
    } catch (error: any) {
        console.error('[Spine] Could not read config, treating as disabled:', error?.message ?? error);
        return { ...DEFAULT_SPINE_CONFIG, enabled: false }; // fail closed
    }
}

export async function isSpineEnabled(): Promise<boolean> {
    return (await getSpineConfig()).enabled === true;
}

/** Flip or tune the spine. Every change is a system event, so /admin/activity shows who flipped what. */
export async function setSpineConfig(patch: Partial<SpineConfig>, by = 'system'): Promise<SpineConfig> {
    const current = await getSpineConfig();
    const next: SpineConfig = { ...current, ...patch };
    if (localConfig) {
        localConfig = next;
        return structuredClone(next);
    }
    await db.insert(appSettings)
        .values({ id: randomUUID(), key: SPINE_SETTING_KEY, value: next, description: 'Comms spine (Phase 2): master switch + debounce + triage model' })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
    try {
        const { logSystemEvent } = await import('../system-events');
        void logSystemEvent({ kind: 'config_change', summary: `spine config changed by ${by}: ${JSON.stringify(patch)}`, detail: { before: current, after: next, by }, source: 'spine' });
    } catch { /* bookkeeping only */ }
    return next;
}
