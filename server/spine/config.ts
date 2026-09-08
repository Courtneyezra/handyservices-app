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

/**
 * The per-agent kill switches, `spine.agents.<key>.enabled`, shown on /admin/staff.
 *
 * 0.2 (8 Sep 2026) — item G. Until this date these switches named agents and stopped nothing:
 * `isSpineEnabled('scoper')` was called from ONE place, scoper-adapter.ts, which the live pass does
 * not go through. A control that does not control is worse than no control, so each key is now
 * wired to the thing it names (server/spine/index.ts for the lane agents and the triage model,
 * server/spine/sampler.ts for the verifier), and `contractor_liaison` was added because the
 * contractor pack is a lane agent like the others and had no switch at all.
 */
export type SpineAgentKey = 'scoper' | 'quote_clerk' | 'recovery' | 'contractor_liaison' | 'verifier' | 'triage';

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
    /** Phase 3: the rules layer's content-free asks (ask_media / ask_postcode) from the spine exit (§3.5). */
    asks: { enabled: boolean };
    /**
     * Phase 4: describe_video via Gemini 2.5 Flash, direct (§3.8). Off = media items carry no
     * description. `images` sends photos too. `maxPerRun` bounds how many items one case-file
     * build may describe (the NEWEST that many; see describeCaseFileMedia).
     *
     * T7 (7 Sep 2026): note that the Scoper reads media as text only (id, kind, description) —
     * `loadCaseFileImageBlocks` exists but nothing calls it — so with `enabled` off, or `images`
     * off for a photo, the reply-writing agent learns NOTHING about what the customer sent.
     * The description is the only route. `maxPerRun` is bounded by VIDEO_MAX_PER_RUN on write.
     */
    video: { enabled: boolean; images: boolean; maxPerRun: number };
    /**
     * 0.5 "The switch" (build plan v2, 8 Sep 2026; the captain's answer 16 — "sandbox checklist
     * first, then all live threads", flipped on his word).
     *
     * WHICH DESK BEHAVIOUR IS LIVE, not whether the spine runs at all:
     *   v3  today. The Scoper's replies land as pending drafts and wait for Ben.
     *   v4  reply by default. The desk answers on its own and holds only on the exceptions.
     *
     * The desk is ALREADY live in production, so without this key every behaviour change in
     * weeks 2–4 would reach real customers the moment its PR deployed, before one checklist line
     * had passed in the sandbox (reviews s28 C, s29 1.5). Default `v3`: a row that does not carry
     * the key, or carries anything else, reads as today's behaviour (mergeOverDefaults).
     *
     * Read it ONLY through `isDeskV4()`. Nothing consults it yet — the items that gate behaviour
     * on it (the pack resolver, the lane table, the decision, the ack config, the silence clock)
     * are plan items 1.x / 2.x and land in their own PRs. Flipping it is 6.2; flipping it back is
     * the rollback (docs/comms-build/CUTOVER.md §4), which does NOT touch `mode`.
     */
    desk: DeskBehaviour;
    /**
     * 0.2: the sender registry's switches, keyed by `SenderEntry.switchKey`
     * (server/sender-registry.ts). Absent = ON — this is the ONE spine setting that fails open,
     * because it gates a message someone already composed rather than an agent's decision to run,
     * and a transactional sender never appears here at all. Only `{ enabled: false }` stops a send.
     */
    senders: Partial<Record<string, { enabled: boolean }>>;
}

/**
 * 0.5: the two desk behaviours. `v3` is what the desk does today (every reply waits for Ben);
 * `v4` is reply-by-default. There is no third value: anything else is not a behaviour this code
 * knows how to run, so it is refused on the way in and read as `v3` on the way out.
 */
export const DESK_BEHAVIOURS = ['v3', 'v4'] as const;
export type DeskBehaviour = (typeof DESK_BEHAVIOURS)[number];

/** Narrowing guard — the one place the vocabulary is checked (route validation and row reads). */
export function isDeskBehaviour(value: unknown): value is DeskBehaviour {
    return typeof value === 'string' && (DESK_BEHAVIOURS as readonly string[]).includes(value);
}

/**
 * 0.5: THE ONLY SANCTIONED WAY TO ASK "is the v4 desk live?".
 *
 * Every later item reads the switch through this helper and never `cfg.desk` directly, so there
 * is exactly one place to change if the question ever grows a second condition, and exactly one
 * name to grep for when asking what the flip actually moves.
 *
 * It is a BEHAVIOUR selector, not a permission: it says nothing about whether the spine may run
 * on a customer at all. `isSpineEnabled()` / `spineMode()` remain the permission, and an off or
 * shadow spine sends nothing whatever this returns. Fail closed: absent, unreadable or unknown
 * is `false`, i.e. today's desk.
 */
export function isDeskV4(cfg: Pick<SpineConfig, 'desk'> | null | undefined): boolean {
    return cfg?.desk === 'v4';
}

/**
 * T7: the only values `video.maxPerRun` may take through the settings route. The ceiling matches
 * MAX_MEDIA_ITEMS in server/agents/media-context.ts, the most media the legacy image-block path
 * ever embedded ("enough for any real enquiry"). Every item above the cache is one paid Gemini
 * call, and the case-file build waits for them, so the ceiling is a latency bound as much as a
 * cost bound. Enforced in validateSpineConfigPatch (server/spine/controls.ts), not on read: a row
 * a script already wrote keeps whatever it holds.
 */
export const VIDEO_MAX_PER_RUN = { min: 1, max: 12 } as const;

/** The three-way mode Phase 3 reads: off (nothing runs), shadow (compute + record, never exit), live. */
export type SpineMode = 'off' | 'shadow' | 'live';
/** Pure derivation; server/spine/switch.ts wraps it with the DB read. `enabled:false` always wins. */
export function spineMode(c: Pick<SpineConfig, 'enabled' | 'shadow' | 'mode'>): SpineMode {
    if (!c.enabled) return 'off';
    if (c.mode === 'off' || c.mode === 'shadow' || c.mode === 'live') return c.mode;
    return c.shadow ? 'shadow' : 'live';
}

export const DEFAULT_SPINE_CONFIG: SpineConfig = {
    enabled: false,
    agents: {},
    shadow: false,
    sweepLimit: 3,
    debounceMinutes: 10,
    triageModel: 'claude-haiku-4-5',
    city: 'nottingham',
    asks: { enabled: false },
    autonomy: { enabled: false },
    sampler: { enabled: false, rate: 0.1, min: 1, max: 15 },
    // T7: 3 → 6. The bursts on record are 2 photos (P19 thread, MJ backfill), 4 photos (P13c
    // pack, the job drawer's cap), one video + follow-up shots; 6 covers every one of them
    // with room for an earlier item, at half the legacy 12-item ceiling. Applies only where no
    // row is stored: the live row keeps its own value until someone changes it on /admin/staff.
    video: { enabled: false, images: false, maxPerRun: 6 },
    // 0.5: today's desk. Nothing changes for a customer until someone writes 'v4' into the row.
    desk: 'v3',
    // 0.2: no row = every registered sender is on, which is today's behaviour for all of them.
    senders: {},
};

function mergeOverDefaults(patch: Partial<SpineConfig> | null | undefined): SpineConfig {
    return {
        ...DEFAULT_SPINE_CONFIG,
        ...(patch ?? {}),
        agents: { ...(patch?.agents ?? {}) },
        asks: { ...DEFAULT_SPINE_CONFIG.asks, ...(patch?.asks ?? {}) },
        autonomy: { ...DEFAULT_SPINE_CONFIG.autonomy, ...(patch?.autonomy ?? {}) },
        sampler: { ...DEFAULT_SPINE_CONFIG.sampler, ...(patch?.sampler ?? {}) },
        video: { ...DEFAULT_SPINE_CONFIG.video, ...(patch?.video ?? {}) },
        // 0.5: the vocabulary is enforced on READ as well as on write. A row that carries no
        // `desk`, or one a script put a typo in, is today's desk — never an unknown behaviour.
        desk: isDeskBehaviour(patch?.desk) ? patch.desk : DEFAULT_SPINE_CONFIG.desk,
        senders: { ...(patch?.senders ?? {}) },
    };
}

/** Phase 3: the promotion/demotion job runs only with the master switch AND its own switch on. */
export async function isAutonomyEnabled(): Promise<boolean> {
    const cfg = await getSpineConfig();
    return cfg.enabled === true && cfg.autonomy.enabled === true;
}

/**
 * B6 (PRD v3 §5.4): what the 07:30 autonomy job does, derived from the row with no flag of its own.
 *   off          master switch off — nothing runs (fail closed, like every other spine entry point)
 *   full         master on, autonomy on — promote and demote, today's behaviour byte for byte
 *   demote_only  master on, autonomy off — the job still runs every morning but may only take a
 *                tier AWAY; a promotion is reported and held. This is what makes a human SEND
 *                (POST /api/spine/tiers) safe to set before the earned ladder is honest: there is
 *                no flag to remember, so there is no flag to forget.
 */
export type AutonomyJobMode = 'off' | 'demote_only' | 'full';
export function autonomyJobMode(c: Pick<SpineConfig, 'enabled'> & { autonomy?: Partial<SpineConfig['autonomy']> | null }): AutonomyJobMode {
    if (c.enabled !== true) return 'off';
    return c.autonomy?.enabled === true ? 'full' : 'demote_only';
}
/** The DB-read wrapper the cron job calls. Fail closed: an unreadable row is `off`. */
export async function getAutonomyJobMode(): Promise<AutonomyJobMode> {
    return autonomyJobMode(await getSpineConfig());
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
    const next: SpineConfig = mergeOverDefaults({
        ...current, ...patch,
        agents: { ...current.agents, ...(patch.agents ?? {}) },
        senders: { ...current.senders, ...(patch.senders ?? {}) },
    });
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

/**
 * 0.2 item G: the per-agent switch ALONE — `spine.agents.<key>.enabled`, and nothing else.
 *
 * `isSpineEnabled(agent)` answers a different question: "is the spine on AND this agent not
 * switched off?". That is the right question for a caller deciding whether to START a pass, and
 * the wrong one for a pass that is ALREADY running: `runOnce` is called directly by the shadow
 * runner and by the sandbox (server/spine/sandbox-routes.ts), both of which run with the master
 * switch off by design. Reading the master switch inside the pass would have silenced every agent
 * in the sandbox the moment the spine was not live, which is a regression dressed as a control.
 *
 * So: only the named row is read. Absent means ON, which is what `agents: {}` has always meant,
 * and an unreadable settings row means ON too — the caller that started this pass has already
 * asked the fail-closed question.
 */
export async function isAgentSwitchOn(agent: SpineAgentKey): Promise<boolean> {
    try {
        const cfg = await getSpineConfig();
        return cfg.agents?.[agent]?.enabled !== false;
    } catch (error: any) {
        console.warn(`[Spine] Could not read the ${agent} switch (treating it as on):`, error?.message ?? error);
        return true;
    }
}
