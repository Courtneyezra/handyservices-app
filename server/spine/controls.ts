/**
 * Switch controls for /admin/staff (P6 close-out / A2; design §3.9 "every kill switch visible and
 * flippable on /admin/staff, every flip logged").
 *
 * Two write routes sit on top of the existing setters (setSpineConfig / setCommsAgentConfig, which
 * already write app_settings and log a `config_change` system event); this module is the PURE part:
 *
 *   validateSpineConfigPatch   what the body may contain, typed, unknown fields refused, and which
 *                              rights it needs (owner-only for mode / autonomy; any admin incl. the
 *                              VA for asks / sampler / video / per-agent switches)
 *   validateCommsConfigPatch   same for the two legacy flags (autosend.enabled, onInbound):
 *                              autosend is owner-only and turning it ON needs the typed word
 *   isOwner                    the owner account or role admin — never `va`
 *   lastChangeByField          "who changed this, when" per control, folded from the
 *                              config_change events the setters wrote
 *
 * The `LIVE` confirmation: `mode: 'live'` (spine) and `autosend.enabled: true` (legacy) both change
 * who answers real customers, so the body must carry `confirm: 'LIVE'`; the route additionally runs
 * the go-live check before a live flip and refuses on any NO-GO (server/spine/golive-check.ts).
 */
import type { SpineConfig } from './config';
import { isSpineMode, type SpineMode } from './switch';

export const OWNER_EMAIL = 'ezramarketingltd@gmail.com';
export const LIVE_CONFIRM_WORD = 'LIVE';

export interface SessionUserLike { id?: string | null; email?: string | null; role?: string | null }

/** Owner-only controls: the owner account, or role `admin`. A `va` session is an admin for everything else. */
export function isOwner(user: SessionUserLike | null | undefined): boolean {
    if (!user) return false;
    if ((user.email ?? '').trim().toLowerCase() === OWNER_EMAIL) return true;
    return user.role === 'admin';
}

export type Right = 'owner' | 'admin';

export interface SpinePatchVerdict {
    ok: true;
    patch: Partial<SpineConfig>;
    /** Which rights the patch needs (the strictest wins). */
    needs: Right;
    /** The patch asks to go live (mode 'live'); needs the confirm word AND a passing go-live check. */
    goesLive: boolean;
    confirmed: boolean;
    /** Human-readable list of what changes, for the event summary. */
    changes: string[];
}
export interface PatchRefusal { ok: false; errors: string[] }

const SPINE_KEYS = ['mode', 'agents', 'asks', 'autonomy', 'sampler', 'video', 'confirm'] as const;
const AGENT_KEYS = ['scoper', 'quote_clerk', 'recovery', 'verifier', 'triage'] as const;

function boolField(obj: unknown, key: string, errors: string[], label: string): boolean | undefined {
    if (obj == null || typeof obj !== 'object') { errors.push(`${label} must be an object`); return undefined; }
    const v = (obj as Record<string, unknown>)[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'boolean') { errors.push(`${label}.${key} must be true or false`); return undefined; }
    return v;
}

export function validateSpineConfigPatch(body: unknown): SpinePatchVerdict | PatchRefusal {
    const errors: string[] = [];
    if (body == null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['body must be an object'] };
    const b = body as Record<string, unknown>;
    for (const k of Object.keys(b)) if (!(SPINE_KEYS as readonly string[]).includes(k)) errors.push(`unknown field ${k}`);

    const patch: Partial<SpineConfig> = {};
    const changes: string[] = [];
    let needs: Right = 'admin';
    let goesLive = false;

    if (b.mode !== undefined) {
        if (!isSpineMode(b.mode)) errors.push("mode must be 'off', 'shadow' or 'live'");
        else {
            const mode = b.mode as SpineMode;
            // The same three fields scripts/_spine-mode.ts writes, so a row flipped here reads the same way.
            patch.mode = mode; patch.enabled = mode !== 'off'; patch.shadow = mode === 'shadow';
            needs = 'owner'; goesLive = mode === 'live'; changes.push(`mode → ${mode}`);
        }
    }
    if (b.autonomy !== undefined) {
        const v = boolField(b.autonomy, 'enabled', errors, 'autonomy');
        if (v !== undefined) { patch.autonomy = { enabled: v }; needs = 'owner'; changes.push(`autonomy → ${v ? 'on' : 'off'}`); }
    }
    if (b.asks !== undefined) {
        const v = boolField(b.asks, 'enabled', errors, 'asks');
        if (v !== undefined) { patch.asks = { enabled: v }; changes.push(`asks → ${v ? 'on' : 'off'}`); }
    }
    if (b.sampler !== undefined) {
        const v = boolField(b.sampler, 'enabled', errors, 'sampler');
        // Only the switch is exposed; rate / min / max stay script-set (setSpineConfig merges over the current values).
        if (v !== undefined) { patch.sampler = { enabled: v } as SpineConfig['sampler']; changes.push(`sampler → ${v ? 'on' : 'off'}`); }
    }
    if (b.video !== undefined) {
        const v = boolField(b.video, 'enabled', errors, 'video');
        const images = boolField(b.video, 'images', errors, 'video');
        if (v !== undefined || images !== undefined) {
            patch.video = { ...(v !== undefined ? { enabled: v } : {}), ...(images !== undefined ? { images } : {}) } as SpineConfig['video'];
            if (v !== undefined) changes.push(`video → ${v ? 'on' : 'off'}`);
            if (images !== undefined) changes.push(`video.images → ${images ? 'on' : 'off'}`);
        }
    }
    if (b.agents !== undefined) {
        if (b.agents == null || typeof b.agents !== 'object' || Array.isArray(b.agents)) errors.push('agents must be an object');
        else {
            const agents: SpineConfig['agents'] = {};
            for (const [k, v] of Object.entries(b.agents as Record<string, unknown>)) {
                if (!(AGENT_KEYS as readonly string[]).includes(k)) { errors.push(`unknown agent ${k}`); continue; }
                const on = boolField(v, 'enabled', errors, `agents.${k}`);
                if (on !== undefined) { agents[k as keyof SpineConfig['agents']] = { enabled: on }; changes.push(`agents.${k} → ${on ? 'on' : 'off'}`); }
            }
            if (Object.keys(agents).length) patch.agents = agents;
        }
    }
    if (b.confirm !== undefined && typeof b.confirm !== 'string') errors.push('confirm must be a string');
    const confirmed = b.confirm === LIVE_CONFIRM_WORD;
    if (goesLive && !confirmed) errors.push(`going live needs confirm: '${LIVE_CONFIRM_WORD}' (typed, exactly)`);
    if (!errors.length && !changes.length) errors.push('nothing to change');
    if (errors.length) return { ok: false, errors };
    return { ok: true, patch, needs, goesLive, confirmed, changes };
}

// Merging `sampler: { enabled }` / `video: { enabled }` over the current row is setSpineConfig's
// job (mergeOverDefaults spreads the current sub-object first), so a partial sub-object is safe.

export interface CommsPatchVerdict {
    ok: true;
    patch: { autosend?: { enabled: boolean }; onInbound?: boolean };
    needs: Right;
    /** Turning legacy direct send ON: needs the confirm word. */
    turnsAutosendOn: boolean;
    confirmed: boolean;
    changes: string[];
}

const COMMS_KEYS = ['autosend', 'onInbound', 'confirm'] as const;

export function validateCommsConfigPatch(body: unknown): CommsPatchVerdict | PatchRefusal {
    const errors: string[] = [];
    if (body == null || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['body must be an object'] };
    const b = body as Record<string, unknown>;
    for (const k of Object.keys(b)) if (!(COMMS_KEYS as readonly string[]).includes(k)) errors.push(`unknown field ${k}`);
    const patch: CommsPatchVerdict['patch'] = {};
    const changes: string[] = [];
    let needs: Right = 'admin';
    let turnsAutosendOn = false;
    if (b.autosend !== undefined) {
        const v = boolField(b.autosend, 'enabled', errors, 'autosend');
        if (v !== undefined) { patch.autosend = { enabled: v }; needs = 'owner'; turnsAutosendOn = v; changes.push(`autosend → ${v ? 'ON' : 'off'}`); }
    }
    if (b.onInbound !== undefined) {
        if (typeof b.onInbound !== 'boolean') errors.push('onInbound must be true or false');
        else { patch.onInbound = b.onInbound; changes.push(`onInbound → ${b.onInbound ? 'on' : 'off'}`); }
    }
    if (b.confirm !== undefined && typeof b.confirm !== 'string') errors.push('confirm must be a string');
    const confirmed = b.confirm === LIVE_CONFIRM_WORD;
    if (turnsAutosendOn && !confirmed) errors.push(`turning legacy autosend ON needs confirm: '${LIVE_CONFIRM_WORD}' (typed, exactly)`);
    if (!errors.length && !changes.length) errors.push('nothing to change');
    if (errors.length) return { ok: false, errors };
    return { ok: true, patch, needs, turnsAutosendOn, confirmed, changes };
}

// ---------------------------------------------------------------- who changed what, when

/** A config_change system event as the setters write it (source 'spine' or 'comms-config'). */
export interface ConfigChangeEvent {
    at: Date | string;
    source: string;
    summary: string;
    detail: unknown;
}

export interface LastChange { at: string; by: string; summary: string }

/** The controls the strip shows, keyed the way the client addresses them. */
export const SPINE_CONTROLS = ['mode', 'asks', 'autonomy', 'sampler', 'video', 'agents.scoper', 'agents.quote_clerk', 'agents.recovery', 'agents.verifier', 'agents.triage'] as const;
export const COMMS_CONTROLS = ['autosend', 'onInbound'] as const;
export type ControlKey = (typeof SPINE_CONTROLS)[number] | (typeof COMMS_CONTROLS)[number];

function get(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((o, k) => (o != null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** The value of a control as it reads on a config snapshot (spine or comms). */
function controlValue(control: ControlKey, cfg: unknown): unknown {
    switch (control) {
        case 'mode': {
            const c = cfg as Partial<SpineConfig> | undefined;
            if (!c) return undefined;
            if (c.enabled === false) return 'off';
            if (isSpineMode(c.mode)) return c.mode;
            return c.shadow ? 'shadow' : 'live';
        }
        case 'asks': case 'autonomy': case 'sampler': case 'video': return get(cfg, `${control}.enabled`);
        case 'autosend': return get(cfg, 'autosend.enabled');
        case 'onInbound': return get(cfg, 'onInbound');
        default: return get(cfg, `${control}.enabled`);
    }
}

/**
 * Pure. For each control, the newest event whose before/after (spine: detail.before/after) or
 * patch (comms: detail.patch) touched it. Events newest-first or not — sorted here.
 */
export function lastChangeByField(events: ConfigChangeEvent[]): Partial<Record<ControlKey, LastChange>> {
    const out: Partial<Record<ControlKey, LastChange>> = {};
    const sorted = events.slice().sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    for (const ev of sorted) {
        const d = (ev.detail ?? {}) as Record<string, unknown>;
        const by = typeof d.by === 'string' && d.by ? d.by : 'unknown';
        const at = new Date(ev.at).toISOString();
        if (ev.source === 'spine') {
            for (const c of SPINE_CONTROLS) {
                if (out[c]) continue;
                const before = controlValue(c, d.before); const after = controlValue(c, d.after);
                if (d.after !== undefined && before !== after) out[c] = { at, by, summary: ev.summary };
            }
        } else if (ev.source === 'comms-config') {
            const patch = (d.patch ?? {}) as Record<string, unknown>;
            for (const c of COMMS_CONTROLS) {
                if (out[c]) continue;
                if (controlValue(c, patch) !== undefined) out[c] = { at, by, summary: ev.summary };
            }
        }
    }
    return out;
}

/** The caption under each mode, from CUTOVER §2–3 and §4. */
export const MODE_CAPTIONS: Record<SpineMode, string> = {
    off: 'Legacy only. Nothing under server/spine runs on a customer; the legacy comms agent drafts for Ben as before.',
    shadow: 'The spine runs dry on every due thread and records what it would do (agent_runs.shadow_decision); the customer sees only legacy. scripts/_shadow-report.ts compares the two.',
    live: 'The spine answers: Scoper proposals land as pending drafts with a due time, exceptions as flags, the holding line fires at 10 min and at expiry; the legacy comms agent is never called on the customer lane.',
};
