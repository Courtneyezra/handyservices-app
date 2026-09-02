/**
 * Earned autonomy (Phase 3, COMMS_AGENTS_V3_DESIGN §4, §5, §0b): the daily promotion / demotion
 * job. Nothing ships sending; an intent EARNS SEND from evidence and LOSES it from evidence.
 *
 * Promotion (DRAFT → SEND), per (pack, intent), full gate:
 *   - the intent's eval family passes pass^3 = 100% in the latest scoreboard (eval-results/latest.json)
 *   - ≥ 30 human verdicts across the PACK in 30 days with unedited approval ≥ 90%
 *   - zero `unsafe` verdicts on this intent, ever
 *   - zero guard escalations attributed to this intent in 14 days
 * Fast track (§0b), `ask_gap` and `confirm_received` only: no eval-family precondition; instead
 *   ≥ 14 days of verdicts on the intent, ≥ 20 verdicts, zero rejects, unedited ≥ 90%
 *   (plus the same zero-unsafe / zero-escalation sanity checks).
 * Demotion (SEND → DRAFT), checked every run:
 *   - any `unsafe` verdict, or a sample `not fine` with reason unsafe, on the intent in 30 days
 *   - any incident tag on a conversation the intent SENT to in 30 days
 *   - sampled approval < 80% over the trailing window (once there are enough samples to mean it)
 *
 * The decision function is pure (`decideTier`) and unit-tested; evidence gathering is a handful
 * of grouped queries; applying a decision writes pack_intent_tiers + pack_tier_events, refreshes
 * the in-process overlay, and pings the owner. Idempotent: a re-run with the same evidence changes
 * nothing. `dryRun` prints the table and writes nothing.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PACKS, tierFor, assertPromotable, isForbiddenIntent, applyTierOverlay, refreshTierOverlay, tierSourceFor, currentTierOverlay } from './packs';
import { TIERS } from './vocab';
import type { PolicyPack, Tier } from './types';

// ---------------------------------------------------------------- the gate, as numbers

export const FAST_TRACK_INTENTS: readonly string[] = ['ask_gap', 'confirm_received'];

export const GATE = {
    verdictWindowDays: 30,
    minPackVerdicts: 30,
    minUneditedPct: 90,
    escalationWindowDays: 14,
    fastTrackMinDays: 14,
    fastTrackMinVerdicts: 20,
    sampleWindowDays: 30,
    /** Below this many samples a rate is noise, not evidence. */
    minSamplesForRate: 5,
    minSampleApprovalPct: 80,
} as const;

/** Conversation tags that count as an incident on a run (§4 "any incident tag"). */
export const INCIDENT_TAGS: readonly string[] = ['incident', 'trust_concern', 'complaint'];

// ---------------------------------------------------------------- evidence shapes

export interface VerdictCounts {
    human: number;          // approve + edit + reject
    approve: number;
    edit: number;
    reject: number;
    unsafe: number;         // any verdict with reason 'unsafe' in the window
    uneditedPct: number | null;
    firstAt: string | null; // earliest verdict in the window
}
export interface SampleCounts { fine: number; notFine: number; notFineUnsafe: number; total: number; approvalPct: number | null }
export interface EvalFamilyStatus {
    status: 'pass' | 'fail' | 'skipped' | 'missing';
    cases: number;
    passed: number;
    runId?: string | null;
    at?: string | null;
}
export interface TierChange { tier: Tier; at: string; by: string; reason: string | null }

export interface IntentEvidence {
    packId: string;
    intent: string;
    tier: Tier;
    tierSource: 'db' | 'static';
    allowed: boolean;
    packVerdicts30: VerdictCounts;
    intentVerdicts30: VerdictCounts;
    unsafeEver: number;
    escalations14: number;
    samples30: SampleCounts;
    incidents30: number;
    evalFamily: EvalFamilyStatus;
    lastChange: TierChange | null;
}

export type AutonomyRule = 'full_gate' | 'fast_track' | 'unsafe_verdict' | 'unsafe_sample' | 'incident' | 'sample_approval' | 'not_promotable' | 'hold' | 'human';

export interface AutonomyDecision {
    packId: string;
    intent: string;
    from: Tier;
    to: Tier;
    action: 'promote' | 'demote' | 'hold';
    rule: AutonomyRule;
    reasons: string[];
}

function emptyVerdicts(): VerdictCounts {
    return { human: 0, approve: 0, edit: 0, reject: 0, unsafe: 0, uneditedPct: null, firstAt: null };
}
function emptySamples(): SampleCounts {
    return { fine: 0, notFine: 0, notFineUnsafe: 0, total: 0, approvalPct: null };
}

// ---------------------------------------------------------------- the decision (pure)

/**
 * The signals that drop a SEND intent to DRAFT. The same signals block a promotion, so an intent
 * demoted yesterday cannot be fast-tracked straight back today while the evidence is still inside
 * its window: it re-earns SEND only once the window has cleared.
 */
export function demotionSignals(ev: IntentEvidence): { rule: AutonomyRule; reason: string }[] {
    const out: { rule: AutonomyRule; reason: string }[] = [];
    if (ev.intentVerdicts30.unsafe > 0) out.push({ rule: 'unsafe_verdict', reason: `${ev.intentVerdicts30.unsafe} unsafe verdict(s) in ${GATE.verdictWindowDays}d` });
    if (ev.samples30.notFineUnsafe > 0) out.push({ rule: 'unsafe_sample', reason: `${ev.samples30.notFineUnsafe} sampled send(s) marked not fine: unsafe in ${GATE.sampleWindowDays}d` });
    if (ev.incidents30 > 0) out.push({ rule: 'incident', reason: `${ev.incidents30} run(s) on conversations carrying an incident tag in ${GATE.sampleWindowDays}d` });
    if (ev.samples30.total >= GATE.minSamplesForRate && ev.samples30.approvalPct !== null && ev.samples30.approvalPct < GATE.minSampleApprovalPct) {
        out.push({ rule: 'sample_approval', reason: `sampled approval ${ev.samples30.approvalPct}% of ${ev.samples30.total} < ${GATE.minSampleApprovalPct}%` });
    }
    return out;
}

export function decideTier(ev: IntentEvidence, now: Date = new Date()): AutonomyDecision {
    // The assertion the brief asks for: money and dates are not intents; nothing may promote them.
    if (isForbiddenIntent(ev.intent)) throw new Error(`[Autonomy] ${ev.intent} may carry money or dates and can never be promoted`);
    const base = { packId: ev.packId, intent: ev.intent, from: ev.tier };

    if (!ev.allowed) {
        return { ...base, to: ev.tier === 'SEND' ? 'DRAFT' : ev.tier, action: ev.tier === 'SEND' ? 'demote' : 'hold', rule: 'not_promotable', reasons: [`${ev.intent} is not in pack ${ev.packId}`] };
    }

    const signals = demotionSignals(ev);
    if (ev.tier === 'SEND') {
        if (signals.length) return { ...base, to: 'DRAFT', action: 'demote', rule: signals[0].rule, reasons: signals.map((x) => x.reason) };
        return { ...base, to: 'SEND', action: 'hold', rule: 'hold', reasons: ['SEND, no demotion signal'] };
    }

    if (ev.tier !== 'DRAFT') {
        return { ...base, to: ev.tier, action: 'hold', rule: 'hold', reasons: [`tier ${ev.tier} is not on the DRAFT → SEND ladder`] };
    }

    const misses: string[] = [];
    const sanity: string[] = signals.map((x) => `demotion signal still in window: ${x.reason}`);
    if (ev.unsafeEver > 0) sanity.push(`${ev.unsafeEver} unsafe verdict(s) on this intent, ever`);
    if (ev.escalations14 > 0) sanity.push(`${ev.escalations14} guard escalation(s) in ${GATE.escalationWindowDays}d`);

    // Full gate.
    if (ev.evalFamily.status !== 'pass') misses.push(`eval family ${ev.intent}: ${ev.evalFamily.status}${ev.evalFamily.cases ? ` (${ev.evalFamily.passed}/${ev.evalFamily.cases} pass^3)` : ''}`);
    if (ev.packVerdicts30.human < GATE.minPackVerdicts) misses.push(`pack verdicts ${ev.packVerdicts30.human}/${GATE.minPackVerdicts} in ${GATE.verdictWindowDays}d`);
    if (ev.packVerdicts30.uneditedPct === null || ev.packVerdicts30.uneditedPct < GATE.minUneditedPct) misses.push(`pack unedited ${ev.packVerdicts30.uneditedPct ?? '–'}% < ${GATE.minUneditedPct}%`);
    if (!misses.length && !sanity.length) {
        return { ...base, to: 'SEND', action: 'promote', rule: 'full_gate', reasons: [
            `eval family pass^3 ${ev.evalFamily.passed}/${ev.evalFamily.cases}`,
            `pack verdicts ${ev.packVerdicts30.human} (${ev.packVerdicts30.uneditedPct}% unedited) in ${GATE.verdictWindowDays}d`,
            'zero unsafe ever, zero escalations in 14d',
        ] };
    }

    // Fast track (§0b).
    if (FAST_TRACK_INTENTS.includes(ev.intent)) {
        const v = ev.intentVerdicts30;
        const days = v.firstAt ? (now.getTime() - new Date(v.firstAt).getTime()) / 86_400_000 : 0;
        const ftMisses: string[] = [];
        if (days < GATE.fastTrackMinDays) ftMisses.push(`${days.toFixed(1)}/${GATE.fastTrackMinDays} days of verdicts`);
        if (v.human < GATE.fastTrackMinVerdicts) ftMisses.push(`intent verdicts ${v.human}/${GATE.fastTrackMinVerdicts}`);
        if (v.reject > 0) ftMisses.push(`${v.reject} reject(s)`);
        if (v.uneditedPct === null || v.uneditedPct < GATE.minUneditedPct) ftMisses.push(`intent unedited ${v.uneditedPct ?? '–'}% < ${GATE.minUneditedPct}%`);
        if (!ftMisses.length && !sanity.length) {
            return { ...base, to: 'SEND', action: 'promote', rule: 'fast_track', reasons: [
                `fast track: ${days.toFixed(0)} days, ${v.human} verdicts, 0 rejects, ${v.uneditedPct}% unedited`,
                'zero unsafe ever, zero escalations in 14d',
            ] };
        }
        return { ...base, to: 'DRAFT', action: 'hold', rule: 'hold', reasons: [...misses.map((m) => `full gate: ${m}`), ...ftMisses.map((m) => `fast track: ${m}`), ...sanity] };
    }
    return { ...base, to: 'DRAFT', action: 'hold', rule: 'hold', reasons: [...misses, ...sanity] };
}

// ---------------------------------------------------------------- eval scoreboard

interface ScoreboardCase { family: string; kind: 'regression' | 'capability'; passK: boolean | null }
interface Scoreboard { runId?: string; finishedAt?: string; cases?: ScoreboardCase[] }

export function evalFamilyFrom(board: Scoreboard | null, intent: string): EvalFamilyStatus {
    const cases = (board?.cases ?? []).filter((c) => c.family === intent && c.kind === 'regression');
    if (!cases.length) return { status: 'missing', cases: 0, passed: 0, runId: board?.runId ?? null, at: board?.finishedAt ?? null };
    const graded = cases.filter((c) => c.passK !== null);
    const passed = graded.filter((c) => c.passK === true).length;
    if (!graded.length) return { status: 'skipped', cases: cases.length, passed: 0, runId: board?.runId ?? null, at: board?.finishedAt ?? null };
    return { status: passed === cases.length ? 'pass' : 'fail', cases: cases.length, passed, runId: board?.runId ?? null, at: board?.finishedAt ?? null };
}

export function readLatestScoreboard(dir: string = path.resolve(process.cwd(), 'eval-results')): Scoreboard | null {
    try {
        return JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8')) as Scoreboard;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------- evidence (db)

/** Packs whose intents sit on the DRAFT → SEND ladder. Rules packs are SEND by construction; exception/internal have no ladder. */
export function ladderPacks(packs: Record<string, PolicyPack> = PACKS): PolicyPack[] {
    return Object.values(packs).filter((p) => p.audience !== 'internal' && p.allowedIntents.length > 0 && !p.id.startsWith('rules.'));
}

type VerdictRow = { pack_id: string; intent: string | null; verdict: string; reason: string | null; n: number; first_at: string | null };
type CountRow = { pack_id: string; intent: string | null; n: number };

function pct(num: number, den: number): number | null {
    return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

function foldVerdicts(rows: VerdictRow[]): { verdicts: VerdictCounts; samples: SampleCounts } {
    const v = emptyVerdicts();
    const s = emptySamples();
    for (const r of rows) {
        const n = Number(r.n);
        if (r.verdict === 'approve') v.approve += n;
        else if (r.verdict === 'edit') v.edit += n;
        else if (r.verdict === 'reject') v.reject += n;
        else if (r.verdict === 'sample_fine') s.fine += n;
        else if (r.verdict === 'sample_not_fine') { s.notFine += n; if (r.reason === 'unsafe') s.notFineUnsafe += n; }
        if (r.reason === 'unsafe' && r.verdict !== 'sample_fine') v.unsafe += n;
        if (r.first_at && (!v.firstAt || r.first_at < v.firstAt)) v.firstAt = r.first_at;
    }
    v.human = v.approve + v.edit + v.reject;
    v.uneditedPct = pct(v.approve, v.human);
    s.total = s.fine + s.notFine;
    s.approvalPct = pct(s.fine, s.total);
    return { verdicts: v, samples: s };
}

export interface GatherOpts {
    now?: Date;
    evalResultsDir?: string;
    packs?: Record<string, PolicyPack>;
}

/** Every (pack, intent) on the ladder with its evidence. Five grouped queries + one file read. */
export async function gatherEvidence(opts: GatherOpts = {}): Promise<IntentEvidence[]> {
    const now = opts.now ?? new Date();
    const since30 = new Date(now.getTime() - GATE.verdictWindowDays * 86_400_000);
    const since14 = new Date(now.getTime() - GATE.escalationWindowDays * 86_400_000);
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const rowsOf = async <T,>(q: any): Promise<T[]> => { const r: any = await db.execute(q); return (r.rows ?? r) as T[]; };

    // The intent a verdict belongs to: the spine run's proposal, else the draft reason's [intent] prefix.
    const INTENT_EXPR = sql`COALESCE(ar.proposal->'proposal'->>'intent', substring(md.reason from '^\\s*\\[([a-z0-9_]+)\\]'))`;

    const [verdicts30, unsafeEver, escalations14, incidents30, tierRows, lastEvents] = await Promise.all([
        rowsOf<VerdictRow>(sql`
            SELECT ar.pack_id, ${INTENT_EXPR} AS intent, dv.verdict, dv.reason, count(*)::int AS n, min(dv.created_at)::text AS first_at
            FROM draft_verdicts dv
            JOIN message_drafts md ON md.id = dv.draft_id
            JOIN agent_runs ar ON ar.id = COALESCE(dv.run_id, md.run_id)
            WHERE ar.pack_id IS NOT NULL AND dv.created_at >= ${since30}
            GROUP BY 1, 2, 3, 4`),
        rowsOf<CountRow>(sql`
            SELECT ar.pack_id, ${INTENT_EXPR} AS intent, count(*)::int AS n
            FROM draft_verdicts dv
            JOIN message_drafts md ON md.id = dv.draft_id
            JOIN agent_runs ar ON ar.id = COALESCE(dv.run_id, md.run_id)
            WHERE ar.pack_id IS NOT NULL AND dv.reason = 'unsafe' AND dv.verdict <> 'sample_fine'
            GROUP BY 1, 2`),
        rowsOf<CountRow>(sql`
            SELECT pack_id, proposal->'proposal'->>'intent' AS intent, count(*)::int AS n
            FROM agent_runs
            WHERE pack_id IS NOT NULL AND started_at >= ${since14} AND decision = 'flag' AND cardinality(guards_hit) > 0
            GROUP BY 1, 2`),
        rowsOf<CountRow>(sql`
            SELECT ar.pack_id, ar.proposal->'proposal'->>'intent' AS intent, count(*)::int AS n
            FROM agent_runs ar
            JOIN conversations c ON c.id = ar.conversation_id
            WHERE ar.pack_id IS NOT NULL AND ar.started_at >= ${since30} AND ar.decision = 'send'
              AND c.tags && ${sql.raw(`ARRAY[${INCIDENT_TAGS.map((t) => `'${t}'`).join(',')}]::text[]`)}
            GROUP BY 1, 2`),
        rowsOf<{ pack_id: string; intent: string; tier: string; reason: string | null; changed_by: string | null; changed_at: string }>(sql`
            SELECT pack_id, intent, tier, reason, changed_by, changed_at::text FROM pack_intent_tiers`),
        rowsOf<{ pack_id: string; intent: string; to_tier: string; reason: string | null; by: string; at: string }>(sql`
            SELECT DISTINCT ON (pack_id, intent) pack_id, intent, to_tier, reason, by, at::text
            FROM pack_tier_events ORDER BY pack_id, intent, at DESC`),
    ]);
    await refreshTierOverlay(true);
    const board = readLatestScoreboard(opts.evalResultsDir);
    const key = (p: string, i: string | null) => `${p}|${i ?? ''}`;
    const unsafeBy = new Map(unsafeEver.map((r) => [key(r.pack_id, r.intent), Number(r.n)]));
    const escBy = new Map(escalations14.map((r) => [key(r.pack_id, r.intent), Number(r.n)]));
    const incBy = new Map(incidents30.map((r) => [key(r.pack_id, r.intent), Number(r.n)]));
    const lastBy = new Map(lastEvents.map((r) => [key(r.pack_id, r.intent), r]));
    const tierBy = new Map(tierRows.map((r) => [key(r.pack_id, r.intent), r]));

    const out: IntentEvidence[] = [];
    for (const staticPack of ladderPacks(opts.packs)) {
        const pack = applyTierOverlay(staticPack, currentTierOverlay().get(staticPack.id));
        const packRows = verdicts30.filter((r) => r.pack_id === pack.id);
        const packVerdicts30 = foldVerdicts(packRows).verdicts;
        for (const intent of pack.allowedIntents) {
            const k = key(pack.id, intent);
            const { verdicts, samples } = foldVerdicts(packRows.filter((r) => r.intent === intent));
            const last = lastBy.get(k);
            const tierRow = tierBy.get(k);
            out.push({
                packId: pack.id, intent, tier: tierFor(pack, intent), tierSource: tierSourceFor(pack.id, intent), allowed: true,
                packVerdicts30, intentVerdicts30: verdicts,
                unsafeEver: unsafeBy.get(k) ?? 0, escalations14: escBy.get(k) ?? 0, samples30: samples, incidents30: incBy.get(k) ?? 0,
                evalFamily: evalFamilyFrom(board, intent),
                lastChange: last ? { tier: last.to_tier as Tier, at: last.at, by: last.by, reason: last.reason }
                    : tierRow ? { tier: tierRow.tier as Tier, at: tierRow.changed_at, by: tierRow.changed_by ?? 'unknown', reason: tierRow.reason } : null,
            });
        }
    }
    return out;
}

// ---------------------------------------------------------------- applying a decision

export interface ApplyDeps {
    notify?: (alert: { packId: string; intent: string; fromTier: string; toTier: string; reason: string; dryRun?: boolean }) => Promise<void>;
    by?: string;
}

/** Write the tier + the event, refresh the overlay, ping the owner. Never throws for a ping failure. */
export async function applyDecision(d: AutonomyDecision, evidence: IntentEvidence, deps: ApplyDeps = {}): Promise<void> {
    const pack = PACKS[d.packId];
    if (!pack) throw new Error(`[Autonomy] unknown pack ${d.packId}`);
    if (d.to === 'SEND') assertPromotable(pack, d.intent);
    const by = deps.by ?? 'system:autonomy';
    const reason = `${d.rule}: ${d.reasons.join('; ')}`.slice(0, 1000);
    const { db } = await import('../db');
    const { packIntentTiers, packTierEvents } = await import('@shared/schema');
    await db.insert(packIntentTiers)
        .values({ packId: d.packId, intent: d.intent, tier: d.to, reason, changedBy: by, changedAt: new Date() })
        .onConflictDoUpdate({ target: [packIntentTiers.packId, packIntentTiers.intent], set: { tier: d.to, reason, changedBy: by, changedAt: new Date() } });
    await db.insert(packTierEvents).values({
        id: `pte_${randomUUID()}`, packId: d.packId, intent: d.intent, fromTier: d.from, toTier: d.to, reason,
        evidence: evidence as unknown as Record<string, unknown>, by, at: new Date(),
    });
    await refreshTierOverlay(true);
    try {
        const { logSystemEvent } = await import('../system-events');
        void logSystemEvent({ kind: 'config_change', summary: `${d.intent} ${d.from} → ${d.to} in ${d.packId} (${d.rule})`, detail: { ...d, by }, source: 'autonomy' });
    } catch { /* bookkeeping */ }
    try {
        const notify = deps.notify ?? (async (alert) => { const { notifyAutonomyChange } = await import('../pushover'); await notifyAutonomyChange(alert); });
        await notify({ packId: d.packId, intent: d.intent, fromTier: d.from, toTier: d.to, reason });
    } catch (error: any) {
        console.warn('[Autonomy] owner ping failed (change stands):', error?.message ?? error);
    }
}

// ---------------------------------------------------------------- P6: a person moves the ladder

export interface HumanTierRequest {
    packId: string;
    intent: string;
    tier: string;
    reason: string;
}

export interface HumanTierChange {
    packId: string;
    intent: string;
    from: Tier;
    to: Tier;
    reason: string;
    by: string;
    /** false when the tier was already what was asked for; nothing was written. */
    changed: boolean;
}

/**
 * Validate a human promote / demote request against the packs (pure). Refuses:
 *   - an unknown pack or a tier outside the vocabulary
 *   - an intent the pack does not allow (at ANY tier: the overlay would ignore the row anyway)
 *   - SEND for any intent whose name smells of money or dates (assertPromotable, the same guard
 *     the autonomy job runs) — money and dates are not intents and can never be promoted
 *   - an empty reason: a person's change is evidence too, and evidence needs a why
 * Returns the resolved request or a list of problems.
 */
export function validateHumanTierRequest(req: Partial<HumanTierRequest>, packs: Record<string, PolicyPack> = PACKS): { ok: true; request: HumanTierRequest & { tier: Tier } } | { ok: false; errors: string[] } {
    const errors: string[] = [];
    const packId = String(req.packId ?? '').trim();
    const intent = String(req.intent ?? '').trim();
    const tier = String(req.tier ?? '').trim().toUpperCase();
    const reason = String(req.reason ?? '').trim();
    const pack = packs[packId];
    if (!pack) errors.push(`unknown pack ${packId || '(missing)'}`);
    if (!(TIERS as readonly string[]).includes(tier)) errors.push(`tier must be one of ${TIERS.join(', ')}`);
    if (!reason) errors.push('a reason is required');
    if (reason.length > 1000) errors.push('reason is too long (max 1000 characters)');
    if (pack) {
        if (!intent || !(pack.allowedIntents as string[]).includes(intent)) errors.push(`${intent || '(missing)'} is not an intent of pack ${packId}`);
        else if (tier === 'SEND') {
            try { assertPromotable(pack, intent); } catch (e: any) { errors.push(String(e?.message ?? e).replace(/^\[Spine\]\s*/, '')); }
        }
        if (pack.id.startsWith('rules.') || pack.audience === 'internal') errors.push(`pack ${packId} is not on the DRAFT → SEND ladder`);
    }
    if (errors.length) return { ok: false, errors };
    return { ok: true, request: { packId, intent, tier: tier as Tier, reason } };
}

export interface HumanTierDeps {
    /** `human:<id>` from server/approver.ts — the only thing that may write here besides system:autonomy. */
    by: string;
    notify?: ApplyDeps['notify'];
    /** Injected for tests: the write. Default writes pack_intent_tiers + pack_tier_events, refreshes the overlay, pings the owner. */
    write?: (change: HumanTierChange, evidence: Record<string, unknown>) => Promise<void>;
    /** Injected for tests: the current effective tier. */
    currentTier?: (packId: string, intent: string) => Promise<Tier>;
}

async function effectiveTier(packId: string, intent: string): Promise<Tier> {
    await refreshTierOverlay(true);
    const pack = applyTierOverlay(PACKS[packId], currentTierOverlay().get(packId));
    return tierFor(pack, intent);
}

/**
 * A person promotes or demotes one intent (POST /api/spine/tiers). Same tables and the same
 * event log as the job, `changed_by = human:<id>`, rule 'human'. Idempotent: asking for the tier
 * the intent already has writes nothing. Throws on an invalid request (the route turns that into
 * a 400) and on a `by` that is not a person.
 */
export async function setTierByHuman(input: Partial<HumanTierRequest>, deps: HumanTierDeps): Promise<HumanTierChange> {
    if (!deps.by.startsWith('human:')) throw new Error(`[Autonomy] setTierByHuman needs a human:<id> approver, got ${deps.by}`);
    const v = validateHumanTierRequest(input);
    if (!v.ok) throw new Error(v.errors.join('; '));
    const { packId, intent, tier, reason } = v.request;
    const from = await (deps.currentTier ?? effectiveTier)(packId, intent);
    const change: HumanTierChange = { packId, intent, from, to: tier, reason, by: deps.by, changed: from !== tier };
    if (!change.changed) return change;
    const evidence = { rule: 'human', reason, by: deps.by, from, to: tier, at: new Date().toISOString() };
    await (deps.write ?? defaultHumanTierWrite)(change, evidence);
    try {
        const notify = deps.notify ?? (async (alert) => { const { notifyAutonomyChange } = await import('../pushover'); await notifyAutonomyChange(alert); });
        await notify({ packId, intent, fromTier: from, toTier: tier, reason: `human: ${reason}` });
    } catch (error: any) {
        console.warn('[Autonomy] owner ping failed (change stands):', error?.message ?? error);
    }
    return change;
}

async function defaultHumanTierWrite(change: HumanTierChange, evidence: Record<string, unknown>): Promise<void> {
    const pack = PACKS[change.packId];
    if (change.to === 'SEND') assertPromotable(pack, change.intent); // belt and braces at the write
    const reason = `human: ${change.reason}`.slice(0, 1000);
    const { db } = await import('../db');
    const { packIntentTiers, packTierEvents } = await import('@shared/schema');
    await db.insert(packIntentTiers)
        .values({ packId: change.packId, intent: change.intent, tier: change.to, reason, changedBy: change.by, changedAt: new Date() })
        .onConflictDoUpdate({ target: [packIntentTiers.packId, packIntentTiers.intent], set: { tier: change.to, reason, changedBy: change.by, changedAt: new Date() } });
    await db.insert(packTierEvents).values({
        id: `pte_${randomUUID()}`, packId: change.packId, intent: change.intent, fromTier: change.from, toTier: change.to, reason,
        evidence, by: change.by, at: new Date(),
    });
    await refreshTierOverlay(true);
    try {
        const { logSystemEvent } = await import('../system-events');
        void logSystemEvent({ kind: 'config_change', summary: `${change.intent} ${change.from} → ${change.to} in ${change.packId} (human)`, detail: { ...change }, source: 'autonomy' });
    } catch { /* bookkeeping */ }
}

// ---------------------------------------------------------------- the job

export interface AutonomyReport {
    at: string;
    dryRun: boolean;
    evidence: IntentEvidence[];
    decisions: AutonomyDecision[];
    applied: AutonomyDecision[];
    errors: string[];
    table: string;
}

export interface EvaluateOpts extends GatherOpts, ApplyDeps {
    dryRun?: boolean;
    /** Injected for tests: skip the database and decide over these. */
    evidence?: IntentEvidence[];
    apply?: (d: AutonomyDecision, ev: IntentEvidence) => Promise<void>;
}

export async function evaluateAutonomy(opts: EvaluateOpts = {}): Promise<AutonomyReport> {
    const now = opts.now ?? new Date();
    const dryRun = opts.dryRun !== false;
    const evidence = opts.evidence ?? await gatherEvidence(opts);
    const decisions: AutonomyDecision[] = [];
    const applied: AutonomyDecision[] = [];
    const errors: string[] = [];
    for (const ev of evidence) {
        let d: AutonomyDecision;
        try {
            d = decideTier(ev, now);
        } catch (error: any) {
            errors.push(`${ev.packId}/${ev.intent}: ${error?.message ?? error}`);
            continue;
        }
        decisions.push(d);
        if (d.action === 'hold' || dryRun) continue;
        try {
            await (opts.apply ?? ((dd, e) => applyDecision(dd, e, opts)))(d, ev);
            applied.push(d);
        } catch (error: any) {
            errors.push(`${ev.packId}/${ev.intent}: apply failed: ${error?.message ?? error}`);
        }
    }
    const report: AutonomyReport = { at: now.toISOString(), dryRun, evidence, decisions, applied, errors, table: '' };
    report.table = renderAutonomyTable(report);
    return report;
}

export function renderAutonomyTable(report: AutonomyReport): string {
    const rows = report.evidence.map((ev) => {
        const d = report.decisions.find((x) => x.packId === ev.packId && x.intent === ev.intent);
        return [
            ev.packId.padEnd(20), ev.intent.padEnd(22), ev.tier.padEnd(7),
            String(ev.intentVerdicts30.human).padStart(4), String(ev.intentVerdicts30.uneditedPct ?? '–').padStart(5), String(ev.intentVerdicts30.reject).padStart(3),
            String(ev.unsafeEver).padStart(3), String(ev.escalations14).padStart(3), `${ev.samples30.fine}/${ev.samples30.total}`.padStart(7),
            ev.evalFamily.status.padEnd(7), (d ? `${d.action}${d.action !== 'hold' ? ` → ${d.to} (${d.rule})` : ''}` : 'n/a').padEnd(28),
            d?.reasons[0] ?? '',
        ].join(' ');
    });
    const head = ['pack'.padEnd(20), 'intent'.padEnd(22), 'tier'.padEnd(7), 'verd'.padStart(4), 'uned%'.padStart(5), 'rej'.padStart(3), 'uns'.padStart(3), 'esc'.padStart(3), 'samples'.padStart(7), 'eval'.padEnd(7), 'decision'.padEnd(28), 'why'].join(' ');
    const pack30 = Array.from(new Set(report.evidence.map((e) => e.packId))).map((p) => {
        const e = report.evidence.find((x) => x.packId === p)!;
        return `${p}: ${e.packVerdicts30.human} pack verdicts in ${GATE.verdictWindowDays}d, ${e.packVerdicts30.uneditedPct ?? '–'}% unedited`;
    });
    return [
        `Autonomy ${report.dryRun ? 'DRY RUN' : 'APPLIED'} at ${report.at}`,
        ...pack30,
        head, ...rows,
        ...(report.applied.length ? [`applied: ${report.applied.map((d) => `${d.intent} → ${d.to}`).join(', ')}`] : []),
        ...(report.errors.length ? [`errors: ${report.errors.join(' | ')}`] : []),
    ].join('\n');
}
