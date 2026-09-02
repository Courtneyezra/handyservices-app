/**
 * The spine's master switch — `app_settings.spine`, `{ enabled: false }` by default.
 *
 * Phase 2 ships DARK: everything under server/spine/ is registered and testable, nothing runs on a
 * customer thread until Phase 3 flips this. Same fail-closed shape as comms_agent's config
 * (server/agents/comms.ts): a missing row is off, an unreadable row is off, and suites use a
 * process-local store so they can never read or write the live row.
 *
 * db is imported lazily so this module loads without DATABASE_URL.
 */
export const SPINE_SETTING_KEY = 'spine';

export interface SpineConfig {
    /** Master: may the spine run agents on real threads at all? */
    enabled: boolean;
    /** Per-agent off switches (kill switches, §3.9). Absent = on when the master is on. */
    agents: Partial<Record<'scoper' | 'quote_clerk' | 'recovery' | 'verifier' | 'triage', { enabled: boolean }>>;
    /** Shadow mode: build and log proposals, never decide/exit. Off until Phase 3. */
    shadow: boolean;
}

export const DEFAULT_SPINE_CONFIG: SpineConfig = { enabled: false, agents: {}, shadow: false };

function mergeOverDefaults(patch: Partial<SpineConfig> | null | undefined): SpineConfig {
    return {
        ...DEFAULT_SPINE_CONFIG,
        ...(patch ?? {}),
        agents: { ...(patch?.agents ?? {}) },
    };
}

let localConfig: SpineConfig | null = null;

/** Test seam: from here on this process never reads or writes the live row. */
export function useProcessLocalSpineConfig(seed?: Partial<SpineConfig>): SpineConfig {
    localConfig = mergeOverDefaults(seed);
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
        return { ...DEFAULT_SPINE_CONFIG, enabled: false };
    }
}

export async function isSpineEnabled(agent?: keyof SpineConfig['agents']): Promise<boolean> {
    const cfg = await getSpineConfig();
    if (!cfg.enabled) return false;
    if (agent && cfg.agents[agent] && cfg.agents[agent]!.enabled === false) return false;
    return true;
}
