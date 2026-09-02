/**
 * THE SWITCH — Phase 3 ("Earn sending"). One reading of app_settings.spine → 'off' | 'shadow' | 'live'.
 *
 *   off     legacy only. comms-lanes arms the legacy debounce, the legacy tick runs runCommsAgent,
 *           the legacy crons sweep. Nothing under server/spine runs on a customer.
 *   shadow  the spine runs `runOnce` on every due thread with the exit forced off (dryRun), records
 *           agent_runs + shadow_decision, and the legacy path then does exactly what it did before.
 *           The customer sees only legacy. scripts/_shadow-report.ts compares the two.
 *   live    spine only. requestRun/runDue own the debounce; runCommsAgent is never called.
 *
 * Fail closed: an unreadable row is 'off'. An explicit `mode` field wins; without one the mode is
 * derived from the Phase 2 fields so a row written before this file still means what it meant.
 */
import { getSpineConfig, setSpineConfig, type SpineConfig } from './config';

export const SPINE_MODES = ['off', 'shadow', 'live'] as const;
export type SpineMode = (typeof SPINE_MODES)[number];

export function isSpineMode(x: unknown): x is SpineMode {
    return typeof x === 'string' && (SPINE_MODES as readonly string[]).includes(x);
}

/** Parse a CLI flag / setting value. Anything unrecognised is null, never a default. */
export function parseSpineMode(raw: unknown): SpineMode | null {
    if (typeof raw !== 'string') return null;
    const v = raw.trim().toLowerCase().replace(/^--/, '');
    return isSpineMode(v) ? v : null;
}

/** The pure derivation, so the tests can attack every shape the row can take. */
export function spineModeFrom(cfg: Partial<SpineConfig> | null | undefined): SpineMode {
    if (!cfg) return 'off';
    if (isSpineMode(cfg.mode)) {
        // The explicit field wins, but never against the master switch: enabled:false is off.
        if (cfg.mode !== 'off' && cfg.enabled !== true) return 'off';
        return cfg.mode;
    }
    if (cfg.enabled !== true) return 'off';
    return cfg.shadow === true ? 'shadow' : 'live';
}

export async function spineMode(): Promise<SpineMode> {
    try {
        return spineModeFrom(await getSpineConfig());
    } catch (error: any) {
        console.error('[Spine] mode unreadable, treating as off:', error?.message ?? error);
        return 'off';
    }
}

/** Flip the switch. Writes mode + the Phase 2 fields consistently and logs a system event (via setSpineConfig). */
export async function setSpineMode(mode: SpineMode, by = 'system'): Promise<SpineConfig> {
    return setSpineConfig({ mode, enabled: mode !== 'off', shadow: mode === 'shadow' }, by);
}

/** Convenience for the legacy call sites. */
export async function isSpineLive(): Promise<boolean> {
    return (await spineMode()) === 'live';
}
