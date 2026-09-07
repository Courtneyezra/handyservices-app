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
 *
 * B6 (7 Sep 2026, PRD v3 §5.4 — demotion while the autonomy flag is off):
 *   - `evaluateAutonomy({ mode: 'demote_only' })` decides exactly as above but applies only
 *     demotions; a promotion is reported and held. The 07:30 job runs in this mode whenever the
 *     spine is on and `autonomy.enabled` is off (server/spine/config.ts autonomyJobMode), so a
 *     tier a person set to SEND always has an automatic way back down.
 *   - The evidence floor: when the newest tier event on a (pack, intent) is a HUMAN promotion to
 *     SEND, the demotion signals (unsafe verdicts, unsafe samples, incidents, the sampled set) are
 *     counted only from that moment. A person's SEND means "judged with what was known then";
 *     anything after it still demotes. A system:autonomy promotion is not floored on purpose.
 *   - `demoteOnUnsafeVerdict`: the moment an `unsafe` verdict lands (server/verdicts.ts), the
 *     intent it belongs to drops to DRAFT if it is at SEND, `changed_by system:verdict`, without
 *     waiting for the morning run.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PACKS, tierFor, assertPromotable, isForbiddenIntent, applyTierOverlay, refreshTierOverlay, tierSourceFor, currentTierOverlay } from './packs';
import { TIERS } from './vocab';
import type { PolicyPack, Tier } from './types';
import { notSandboxRunSql } from './sandbox';

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
export interface TierChange { tier: Tier; at: string; by: string; reason: string | null; /** epoch ms of `at`, when the row carried one (B6 floor) */ atMs?: number | null }

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
    /** B6: ISO time the demotion signals were counted from (a human SEND), or null when the full 30-day window applies. */
    evidenceFloor?: string | null;
    /** B6: set on the minimal evidence a synchronous demotion writes to pack_tier_events — the verdict that caused it. */
    trigger?: { draftId: string; runId: string | null; verdictBy: string; verdictId: string | null; verdict: string; at: string };
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

// ---------------------------------------------------------------- B6: the evidence floor (pure)

/**
 * The moment demotion signals count from, as epoch ms, or null for the whole window. Only a HUMAN
 * promotion to SEND floors the evidence: `by` starts with `human:` and the tier is SEND. Anything
 * else (a system:autonomy promotion, a demotion, no event) leaves the 30-day window intact, so the
 * job's own signals keep blocking its own re-promotion.
 */
export function evidenceFloorMs(last: TierChange | null | undefined): number | null {
    if (!last || last.tier !== 'SEND' || !last.by.startsWith('human:')) return null;
    const ms = last.atMs ?? Date.parse(last.at);
    return Number.isFinite(ms) ? ms : null;
}

/** One draft_verdicts row inside the window, with the run's pack and the resolved intent. */
export type VerdictEventRow = { pack_id: string; intent: string | null; verdict: string; reason: string | null; at_ms: number };
/** One `send` run on a conversation carrying an incident tag inside the window. */
export type IncidentEventRow = { pack_id: string; intent: string | null; at_ms: number };

/**
 * Fold one intent's rows into its 30-day counts, applying the floor to the demotion signals only:
 * `unsafe`, the sampled set (fine / not fine / not fine: unsafe / approval %) and incidents count
 * from `floorMs`; the human verdict counts (approve / edit / reject, unedited %, first_at) count
 * over the whole window as today, because they are promotion evidence and a SEND does not promote.
 */
export function foldWindow(verdictRows: VerdictEventRow[], incidentRows: IncidentEventRow[], floorMs: number | null): { verdicts: VerdictCounts; samples: SampleCounts; incidents30: number } {
    const all = foldVerdicts(verdictRows.map(asGrouped));
    if (floorMs === null) return { verdicts: all.verdicts, samples: all.samples, incidents30: incidentRows.length };
    const after = foldVerdicts(verdictRows.filter((r) => Number(r.at_ms) >= floorMs).map(asGrouped));
    return {
        verdicts: { ...all.verdicts, unsafe: after.verdicts.unsafe },
        samples: after.samples,
        incidents30: incidentRows.filter((r) => Number(r.at_ms) >= floorMs).length,
    };
}

function asGrouped(r: VerdictEventRow): VerdictRow {
    return { pack_id: r.pack_id, intent: r.intent, verdict: r.verdict, reason: r.reason, n: 1, first_at: Number.isFinite(Number(r.at_ms)) ? new Date(Number(r.at_ms)).toISOString() : null };
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

type SqlTag = typeof import('drizzle-orm').sql;
/**
 * The intent a verdict belongs to: the spine run's proposal, else the draft reason's [intent]
 * prefix. Shared by the job's evidence queries and the synchronous demoter (B6) so the two can
 * never disagree about which intent a verdict is on. Aliases: `ar` = agent_runs, `md` = message_drafts.
 */
export function intentExprSql(sql: SqlTag) {
    return sql`COALESCE(ar.proposal->'proposal'->>'intent', substring(md.reason from '^\\s*\\[([a-z0-9_]+)\\]'))`;
}

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

    const INTENT_EXPR = intentExprSql(sql);

    // T5: a comms-sandbox pass (server/spine/sandbox.ts) is never evidence. The draft-joined
    // queries already cannot see one (a dry run queues no draft); the two that read agent_runs
    // alone would count its flag / send decisions, so every query carries the same exclusion.
    const NOT_SANDBOX_AR = notSandboxRunSql('ar');
    const NOT_SANDBOX = notSandboxRunSql();
    // B6: the 30-day verdict and incident rows come back ungrouped with their time (the ledger holds
    // tens of rows, not thousands) so the per-intent evidence floor can be applied in the fold.
    const [verdicts30, unsafeEver, escalations14, incidents30, tierRows, lastEvents] = await Promise.all([
        rowsOf<VerdictEventRow>(sql`
            SELECT ar.pack_id, ${INTENT_EXPR} AS intent, dv.verdict, dv.reason, (extract(epoch from dv.created_at) * 1000)::float8 AS at_ms
            FROM draft_verdicts dv
            JOIN message_drafts md ON md.id = dv.draft_id
            JOIN agent_runs ar ON ar.id = COALESCE(dv.run_id, md.run_id)
            WHERE ar.pack_id IS NOT NULL AND dv.created_at >= ${since30} AND ${NOT_SANDBOX_AR}`),
        rowsOf<CountRow>(sql`
            SELECT ar.pack_id, ${INTENT_EXPR} AS intent, count(*)::int AS n
            FROM draft_verdicts dv
            JOIN message_drafts md ON md.id = dv.draft_id
            JOIN agent_runs ar ON ar.id = COALESCE(dv.run_id, md.run_id)
            WHERE ar.pack_id IS NOT NULL AND dv.reason = 'unsafe' AND dv.verdict <> 'sample_fine' AND ${NOT_SANDBOX_AR}
            GROUP BY 1, 2`),
        rowsOf<CountRow>(sql`
            SELECT pack_id, proposal->'proposal'->>'intent' AS intent, count(*)::int AS n
            FROM agent_runs
            WHERE pack_id IS NOT NULL AND started_at >= ${since14} AND decision = 'flag' AND cardinality(guards_hit) > 0 AND ${NOT_SANDBOX}
            GROUP BY 1, 2`),
        rowsOf<IncidentEventRow>(sql`
            SELECT ar.pack_id, ar.proposal->'proposal'->>'intent' AS intent, (extract(epoch from ar.started_at) * 1000)::float8 AS at_ms
            FROM agent_runs ar
            JOIN conversations c ON c.id = ar.conversation_id
            WHERE ar.pack_id IS NOT NULL AND ar.started_at >= ${since30} AND ar.decision = 'send' AND ${NOT_SANDBOX_AR}
              AND c.tags && ${sql.raw(`ARRAY[${INCIDENT_TAGS.map((t) => `'${t}'`).join(',')}]::text[]`)}`),
        rowsOf<{ pack_id: string; intent: string; tier: string; reason: string | null; changed_by: string | null; changed_at: string; at_ms: number | null }>(sql`
            SELECT pack_id, intent, tier, reason, changed_by, changed_at::text, (extract(epoch from changed_at) * 1000)::float8 AS at_ms FROM pack_intent_tiers`),
        rowsOf<{ pack_id: string; intent: string; to_tier: string; reason: string | null; by: string; at: string; at_ms: number | null }>(sql`
            SELECT DISTINCT ON (pack_id, intent) pack_id, intent, to_tier, reason, by, at::text, (extract(epoch from at) * 1000)::float8 AS at_ms
            FROM pack_tier_events ORDER BY pack_id, intent, at DESC`),
    ]);
    await refreshTierOverlay(true);
    const board = readLatestScoreboard(opts.evalResultsDir);
    const key = (p: string, i: string | null) => `${p}|${i ?? ''}`;
    const unsafeBy = new Map(unsafeEver.map((r) => [key(r.pack_id, r.intent), Number(r.n)]));
    const escBy = new Map(escalations14.map((r) => [key(r.pack_id, r.intent), Number(r.n)]));
    const lastBy = new Map(lastEvents.map((r) => [key(r.pack_id, r.intent), r]));
    const tierBy = new Map(tierRows.map((r) => [key(r.pack_id, r.intent), r]));

    const out: IntentEvidence[] = [];
    for (const staticPack of ladderPacks(opts.packs)) {
        const pack = applyTierOverlay(staticPack, currentTierOverlay().get(staticPack.id));
        const packRows = verdicts30.filter((r) => r.pack_id === pack.id);
        const packVerdicts30 = foldVerdicts(packRows.map(asGrouped)).verdicts;
        for (const intent of pack.allowedIntents) {
            const k = key(pack.id, intent);
            const last = lastBy.get(k);
            const tierRow = tierBy.get(k);
            const lastChange: TierChange | null = last ? { tier: last.to_tier as Tier, at: last.at, by: last.by, reason: last.reason, atMs: last.at_ms == null ? null : Number(last.at_ms) }
                : tierRow ? { tier: tierRow.tier as Tier, at: tierRow.changed_at, by: tierRow.changed_by ?? 'unknown', reason: tierRow.reason, atMs: tierRow.at_ms == null ? null : Number(tierRow.at_ms) } : null;
            // B6: a human SEND floors the demotion signals at the moment it was set.
            const floorMs = evidenceFloorMs(lastChange);
            const { verdicts, samples, incidents30: incidents } = foldWindow(
                packRows.filter((r) => r.intent === intent),
                incidents30.filter((r) => r.pack_id === pack.id && r.intent === intent),
                floorMs,
            );
            out.push({
                packId: pack.id, intent, tier: tierFor(pack, intent), tierSource: tierSourceFor(pack.id, intent), allowed: true,
                packVerdicts30, intentVerdicts30: verdicts,
                unsafeEver: unsafeBy.get(k) ?? 0, escalations14: escBy.get(k) ?? 0, samples30: samples, incidents30: incidents,
                evalFamily: evalFamilyFrom(board, intent),
                lastChange,
                evidenceFloor: floorMs === null ? null : new Date(floorMs).toISOString(),
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

// ---------------------------------------------------------------- B6: synchronous demotion on an unsafe verdict

export interface UnsafeVerdictInput {
    draftId: string;
    runId?: string | null;
    verdict: string;
    reason: string | null;
    /** Who recorded the verdict: human:<id>, or the sampler's judge. */
    by: string;
    verdictId?: string | null;
}

export interface UnsafeVerdictDeps {
    /** Injected for tests: (pack, intent) of the verdict's run. Default reads agent_runs + message_drafts with the job's own intent expression. */
    resolve?: (input: UnsafeVerdictInput) => Promise<{ packId: string | null; intent: string | null } | null>;
    /** Injected for tests: the effective tier now. */
    currentTier?: (packId: string, intent: string) => Promise<Tier>;
    /** Injected for tests: the write. Default is applyDecision (same tables, same event log, same ping). */
    apply?: (d: AutonomyDecision, evidence: IntentEvidence, deps: ApplyDeps) => Promise<void>;
    notify?: ApplyDeps['notify'];
    packs?: Record<string, PolicyPack>;
    now?: Date;
}

export type UnsafeVerdictOutcome = { demoted: boolean; why: string; decision?: AutonomyDecision };

/** The (pack, intent) a verdict belongs to, resolved exactly as gatherEvidence resolves it. */
async function resolveVerdictIntent(input: UnsafeVerdictInput): Promise<{ packId: string | null; intent: string | null } | null> {
    const { db } = await import('../db');
    const { sql } = await import('drizzle-orm');
    const r: any = await db.execute(sql`
        SELECT ar.pack_id, ${intentExprSql(sql)} AS intent
        FROM message_drafts md
        JOIN agent_runs ar ON ar.id = COALESCE(${input.runId ?? null}, md.run_id)
        WHERE md.id = ${input.draftId}
        LIMIT 1`);
    const rows = (r.rows ?? r) as { pack_id: string | null; intent: string | null }[];
    return rows[0] ? { packId: rows[0].pack_id ?? null, intent: rows[0].intent ?? null } : null;
}

/**
 * The moment an `unsafe` verdict is recorded (any verdict but `sample_fine`), take the intent it
 * belongs to down to DRAFT if it is at SEND. Fired from server/verdicts.ts after the verdict row
 * has landed, outside its transaction: the verdict is never at risk, and a demotion that fails
 * here is caught by the next 07:30 run, whose `unsafe` query has no author filter either.
 *
 * Idempotent: an intent not at SEND (already demoted, or never promoted) writes nothing and pings
 * nobody. Same tables and event log as the job, `changed_by system:verdict` so the event log says
 * which mechanism moved the tier. Never throws; every failure is one warning line.
 */
export async function demoteOnUnsafeVerdict(input: UnsafeVerdictInput, deps: UnsafeVerdictDeps = {}): Promise<UnsafeVerdictOutcome> {
    try {
        if (input.reason !== 'unsafe' || input.verdict === 'sample_fine') return { demoted: false, why: 'not an unsafe verdict' };
        const resolved = await (deps.resolve ?? resolveVerdictIntent)(input);
        const packId = resolved?.packId ?? null;
        const intent = resolved?.intent ?? null;
        if (!packId || !intent) return { demoted: false, why: `no pack or intent for draft ${input.draftId}` };
        const pack = ladderPacks(deps.packs).find((p) => p.id === packId);
        if (!pack) return { demoted: false, why: `pack ${packId} is not on the DRAFT → SEND ladder` };
        if (!(pack.allowedIntents as readonly string[]).includes(intent)) return { demoted: false, why: `${intent} is not an intent of pack ${packId}` };
        const tier = await (deps.currentTier ?? effectiveTier)(packId, intent);
        if (tier !== 'SEND') return { demoted: false, why: `${packId}/${intent} is at ${tier}, nothing to demote` };
        const at = (deps.now ?? new Date()).toISOString();
        const decision: AutonomyDecision = {
            packId, intent, from: 'SEND', to: 'DRAFT', action: 'demote', rule: 'unsafe_verdict',
            reasons: [`unsafe verdict (${input.verdict}) by ${input.by} on draft ${input.draftId} at ${at}`],
        };
        const evidence: IntentEvidence = {
            packId, intent, tier: 'SEND', tierSource: tierSourceFor(packId, intent), allowed: true,
            packVerdicts30: emptyVerdicts(), intentVerdicts30: { ...emptyVerdicts(), unsafe: 1 },
            unsafeEver: 1, escalations14: 0, samples30: emptySamples(), incidents30: 0,
            evalFamily: { status: 'missing', cases: 0, passed: 0 }, lastChange: null,
            trigger: { draftId: input.draftId, runId: input.runId ?? null, verdictBy: input.by, verdictId: input.verdictId ?? null, verdict: input.verdict, at },
        };
        await (deps.apply ?? applyDecision)(decision, evidence, { by: 'system:verdict', ...(deps.notify ? { notify: deps.notify } : {}) });
        console.log(`[Autonomy] synchronous demotion: ${packId}/${intent} SEND → DRAFT on ${input.verdict} (unsafe) by ${input.by}, draft ${input.draftId}`);
        return { demoted: true, why: decision.reasons[0], decision };
    } catch (error: any) {
        console.warn(`[Autonomy] synchronous demotion failed for draft ${input.draftId} (the verdict stands; the 07:30 run will re-check):`, error?.message ?? error);
        return { demoted: false, why: `failed: ${error?.message ?? error}` };
    }
}

// ---------------------------------------------------------------- the job

/**
 * B6: `full` promotes and demotes (the earned ladder, behind spine.autonomy.enabled); `demote_only`
 * decides identically but applies only demotions — a promotion is reported in `held`, never written.
 */
export type AutonomyMode = 'full' | 'demote_only';

export interface AutonomyReport {
    at: string;
    dryRun: boolean;
    mode: AutonomyMode;
    evidence: IntentEvidence[];
    decisions: AutonomyDecision[];
    applied: AutonomyDecision[];
    /** B6: promotions the run decided but did not apply because the mode is demote-only. */
    held: AutonomyDecision[];
    errors: string[];
    table: string;
}

export interface EvaluateOpts extends GatherOpts, ApplyDeps {
    dryRun?: boolean;
    /** B6: default 'full' — every existing caller is unchanged. */
    mode?: AutonomyMode;
    /** Injected for tests: skip the database and decide over these. */
    evidence?: IntentEvidence[];
    apply?: (d: AutonomyDecision, ev: IntentEvidence) => Promise<void>;
}

export async function evaluateAutonomy(opts: EvaluateOpts = {}): Promise<AutonomyReport> {
    const now = opts.now ?? new Date();
    const dryRun = opts.dryRun !== false;
    const mode: AutonomyMode = opts.mode ?? 'full';
    const evidence = opts.evidence ?? await gatherEvidence(opts);
    const decisions: AutonomyDecision[] = [];
    const applied: AutonomyDecision[] = [];
    const held: AutonomyDecision[] = [];
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
        // B6: demote-only never promotes. The decision stands in the report; the write does not happen.
        if (d.action === 'promote' && mode === 'demote_only') { held.push(d); continue; }
        if (d.action === 'hold' || dryRun) continue;
        try {
            await (opts.apply ?? ((dd, e) => applyDecision(dd, e, opts)))(d, ev);
            applied.push(d);
        } catch (error: any) {
            errors.push(`${ev.packId}/${ev.intent}: apply failed: ${error?.message ?? error}`);
        }
    }
    const report: AutonomyReport = { at: now.toISOString(), dryRun, mode, evidence, decisions, applied, held, errors, table: '' };
    report.table = renderAutonomyTable(report);
    return report;
}

export function renderAutonomyTable(report: AutonomyReport): string {
    const demoteOnly = report.mode === 'demote_only';
    const rows = report.evidence.map((ev) => {
        const d = report.decisions.find((x) => x.packId === ev.packId && x.intent === ev.intent);
        const heldHere = !!d && demoteOnly && d.action === 'promote';
        return [
            ev.packId.padEnd(20), ev.intent.padEnd(22), ev.tier.padEnd(7),
            String(ev.intentVerdicts30.human).padStart(4), String(ev.intentVerdicts30.uneditedPct ?? '–').padStart(5), String(ev.intentVerdicts30.reject).padStart(3),
            String(ev.unsafeEver).padStart(3), String(ev.escalations14).padStart(3), `${ev.samples30.fine}/${ev.samples30.total}`.padStart(7),
            ev.evalFamily.status.padEnd(7), (d ? `${d.action}${d.action !== 'hold' ? ` → ${d.to} (${d.rule})` : ''}${heldHere ? ' [held: demote-only]' : ''}` : 'n/a').padEnd(28),
            [d?.reasons[0] ?? '', ev.evidenceFloor ? `(signals counted from human SEND at ${ev.evidenceFloor})` : ''].filter(Boolean).join(' '),
        ].join(' ');
    });
    const head = ['pack'.padEnd(20), 'intent'.padEnd(22), 'tier'.padEnd(7), 'verd'.padStart(4), 'uned%'.padStart(5), 'rej'.padStart(3), 'uns'.padStart(3), 'esc'.padStart(3), 'samples'.padStart(7), 'eval'.padEnd(7), 'decision'.padEnd(28), 'why'].join(' ');
    const pack30 = Array.from(new Set(report.evidence.map((e) => e.packId))).map((p) => {
        const e = report.evidence.find((x) => x.packId === p)!;
        return `${p}: ${e.packVerdicts30.human} pack verdicts in ${GATE.verdictWindowDays}d, ${e.packVerdicts30.uneditedPct ?? '–'}% unedited`;
    });
    return [
        `Autonomy ${report.dryRun ? 'DRY RUN' : 'APPLIED'}${demoteOnly ? ' (demote-only: promotions are reported, never applied)' : ''} at ${report.at}`,
        ...pack30,
        head, ...rows,
        ...(report.applied.length ? [`applied: ${report.applied.map((d) => `${d.intent} → ${d.to}`).join(', ')}`] : []),
        ...(report.held?.length ? [`held (demote-only): ${report.held.map((d) => `${d.intent} → ${d.to} (${d.rule})`).join(', ')}`] : []),
        ...(report.errors.length ? [`errors: ${report.errors.join(' | ')}`] : []),
    ].join('\n');
}
