/**
 * Spine kill switch — app_settings key `spine` (Phase 2, docs/COMMS_AGENTS_V3_DESIGN.md §3.9, §10).
 *
 * Everything Phase 2 builds ships DARK behind this: `{ enabled: false }` by default, read with the
 * same fail-closed pattern as `comms_agent` (server/agents/comms.ts). A row we cannot read is not
 * permission to route customer work through code nobody has flipped on yet. Legacy paths keep
 * running until Phase 3 flips it on /admin/staff.
 *
 * Process-local mode mirrors useProcessLocalCommsConfig (21 Aug incident): a suite arms an
 * in-memory config and the live row is neither read nor written by that process.
 */
import { db } from '../db';
import { appSettings } from '@shared/schema';
import { eq } from 'drizzle-orm';
import type { AgentName } from './types';

export const SPINE_SETTING_KEY = 'spine';

export interface SpineConfig {
    /** Master: when false, nothing routes through the spine and no SpineAgent runs. */
    enabled: boolean;
    /** Per-agent kill switches; absent = follows `enabled`. Fail closed to DRAFT/off elsewhere (§3.9). */
    agents: Partial<Record<AgentName, boolean>>;
}

export const DEFAULT_SPINE_CONFIG: SpineConfig = { enabled: false, agents: {} };

function merge(o: Partial<SpineConfig> | null | undefined): SpineConfig {
    return { ...DEFAULT_SPINE_CONFIG, ...(o ?? {}), agents: { ...DEFAULT_SPINE_CONFIG.agents, ...(o?.agents ?? {}) } };
}

let localConfig: SpineConfig | null = null;

/** Suites only. Arms an in-memory config for this process; the live row is never touched again. */
export function useProcessLocalSpineConfig(seed?: Partial<SpineConfig>): SpineConfig {
    localConfig = merge(seed);
    console.log('[Spine] Config is PROCESS-LOCAL from here: the live spine row will be neither read nor written by this process.');
    return structuredClone(localConfig);
}

export async function getSpineConfig(): Promise<SpineConfig> {
    if (localConfig) return structuredClone(localConfig);
    try {
        const [row] = await db.select().from(appSettings).where(eq(appSettings.key, SPINE_SETTING_KEY));
        if (!row) return DEFAULT_SPINE_CONFIG;
        return merge(row.value as Partial<SpineConfig>);
    } catch (error) {
        console.error('[Spine] Could not read config, treating as disabled:', error);
        return { ...DEFAULT_SPINE_CONFIG, enabled: false }; // fail closed
    }
}

export async function isSpineEnabled(): Promise<boolean> {
    return (await getSpineConfig()).enabled;
}

/** True when the spine is on AND this agent is not individually switched off. */
export async function isSpineAgentEnabled(agent: AgentName): Promise<boolean> {
    const c = await getSpineConfig();
    if (!c.enabled) return false;
    return c.agents[agent] !== false;
}
