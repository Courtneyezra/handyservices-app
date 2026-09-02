/**
 * Verdict aggregation — pure, no db, unit-tested (server/verdict-stats.test.ts).
 *
 * Phase 1 / C of the comms rebuild (COMMS_AGENTS_V3_DESIGN §4, §8). The promotion gate reads
 * these numbers: unedited-approval rate across a pack, zero 'unsafe' per intent, reject reasons.
 * Everything here is a fold over rows; the SQL that fetches them lives in server/verdicts.ts.
 */
import { DRAFT_VERDICTS, VERDICT_REASONS, type DraftVerdict, type VerdictReason } from '@shared/schema';

export type { DraftVerdict, VerdictReason };

/** One verdict joined to the draft it was about. `intent` is parsed from the draft's reason tag. */
export interface VerdictRow {
    verdict: string;
    reason: string | null;
    source: string | null;
    intent: string | null;
    by: string;
    createdAt: Date | string;
    /** P6: the draft the verdict is about, so the judge's and a person's rows on one draft can be paired. */
    draftId?: string | null;
}

/** The verifier's approver string (server/spine/sampler.ts SAMPLER_APPROVER); its rows are the judge's. */
export const JUDGE_APPROVER = 'agent.verifier';

/**
 * P6: how often Ben agreed with the judge (design §9: the judge influences nothing until agreement
 * is ≥ 85%). Pairs the `agent.verifier` sample verdict with the `human:*` sample verdict on the
 * same draft; agreement = same verdict (fine / not fine). Human non-sample verdicts (approve / edit /
 * reject) are a different act and are not paired.
 */
export interface SamplerAgreement {
    /** Drafts the judge scored in the window. */
    judged: number;
    /** Of those, drafts a person also scored. */
    humanReviewed: number;
    /** % of humanReviewed where both said the same thing; null until there is one pair. */
    agreement: number | null;
    /** Pairs where the person said fine / not fine against the judge's verdict. */
    disagreements: { judgeFineHumanNot: number; judgeNotHumanFine: number };
}

export function samplerAgreement(rows: VerdictRow[]): SamplerAgreement {
    const isSample = (v: string) => v === 'sample_fine' || v === 'sample_not_fine';
    const judge = new Map<string, string>();
    const human = new Map<string, string>();
    for (const r of rows) {
        if (!r.draftId || !isSample(r.verdict)) continue;
        if (r.by === JUDGE_APPROVER) { if (!judge.has(r.draftId)) judge.set(r.draftId, r.verdict); }
        else if (r.by.startsWith('human:')) { if (!human.has(r.draftId)) human.set(r.draftId, r.verdict); }
    }
    let humanReviewed = 0; let agreed = 0; let judgeFineHumanNot = 0; let judgeNotHumanFine = 0;
    judge.forEach((j, draftId) => { // forEach, not for…of: the project target cannot iterate a Map
        const h = human.get(draftId);
        if (!h) return;
        humanReviewed += 1;
        if (h === j) agreed += 1;
        else if (j === 'sample_fine') judgeFineHumanNot += 1;
        else judgeNotHumanFine += 1;
    });
    return {
        judged: judge.size, humanReviewed,
        agreement: humanReviewed > 0 ? Math.round((agreed / humanReviewed) * 1000) / 10 : null,
        disagreements: { judgeFineHumanNot, judgeNotHumanFine },
    };
}

export interface VerdictBucket {
    approve: number;
    edit: number;
    reject: number;
    sampleFine: number;
    sampleNotFine: number;
    /** approve + edit + reject — the human decisions, samples excluded. */
    human: number;
    total: number;
    /** approve / human, null until there is at least one human verdict. */
    uneditedApprovalRate: number | null;
    /** Rejects + edits tagged 'unsafe' — the demotion trigger (§4). */
    unsafe: number;
    rejectReasons: Record<string, number>;
    editReasons: Record<string, number>;
}

export interface VerdictStats extends VerdictBucket {
    days: number;
    since: string;
    bySource: Array<VerdictBucket & { source: string }>;
    byIntent: Array<VerdictBucket & { intent: string }>;
    byApprover: Array<{ by: string; human: number }>;
    /** P6: judge vs Ben on the sampled sends (server/spine/sampler.ts). */
    sampler: SamplerAgreement;
}

export function isDraftVerdict(v: unknown): v is DraftVerdict {
    return typeof v === 'string' && (DRAFT_VERDICTS as readonly string[]).includes(v);
}

export function isVerdictReason(v: unknown): v is VerdictReason {
    return typeof v === 'string' && (VERDICT_REASONS as readonly string[]).includes(v);
}

/**
 * The comms agent files its drafts as `[intent] rationale…` in message_drafts.reason
 * (queueDraft in server/agents/comms.ts). Everything else has no intent tag → null.
 */
export function intentFromReason(reason: string | null | undefined): string | null {
    if (!reason) return null;
    const m = /^\s*\[([a-z0-9_]+)\]/i.exec(reason);
    return m ? m[1].toLowerCase() : null;
}

function emptyBucket(): VerdictBucket {
    return {
        approve: 0, edit: 0, reject: 0, sampleFine: 0, sampleNotFine: 0,
        human: 0, total: 0, uneditedApprovalRate: null, unsafe: 0,
        rejectReasons: {}, editReasons: {},
    };
}

function bump(counter: Record<string, number>, key: string) {
    counter[key] = (counter[key] ?? 0) + 1;
}

function fold(bucket: VerdictBucket, row: VerdictRow) {
    bucket.total += 1;
    switch (row.verdict) {
        case 'approve': bucket.approve += 1; bucket.human += 1; break;
        case 'edit':
            bucket.edit += 1; bucket.human += 1;
            bump(bucket.editReasons, row.reason ?? 'unspecified');
            if (row.reason === 'unsafe') bucket.unsafe += 1;
            break;
        case 'reject':
            bucket.reject += 1; bucket.human += 1;
            bump(bucket.rejectReasons, row.reason ?? 'unspecified');
            if (row.reason === 'unsafe') bucket.unsafe += 1;
            break;
        case 'sample_fine': bucket.sampleFine += 1; break;
        case 'sample_not_fine':
            bucket.sampleNotFine += 1;
            if (row.reason === 'unsafe') bucket.unsafe += 1;
            break;
        default: break; // unknown verdict strings count in total only
    }
}

function finish(bucket: VerdictBucket): VerdictBucket {
    bucket.uneditedApprovalRate = bucket.human > 0 ? Math.round((bucket.approve / bucket.human) * 1000) / 10 : null;
    return bucket;
}

/** Fold verdict rows into the stats payload. `rows` should already be limited to the window. */
export function aggregateVerdicts(rows: VerdictRow[], opts: { days: number; since: Date }): VerdictStats {
    const overall = emptyBucket();
    const bySource = new Map<string, VerdictBucket>();
    const byIntent = new Map<string, VerdictBucket>();
    const byApprover = new Map<string, number>();

    for (const row of rows) {
        fold(overall, row);
        const source = row.source ?? 'unknown';
        if (!bySource.has(source)) bySource.set(source, emptyBucket());
        fold(bySource.get(source)!, row);
        const intent = row.intent ?? 'untagged';
        if (!byIntent.has(intent)) byIntent.set(intent, emptyBucket());
        fold(byIntent.get(intent)!, row);
        if (row.verdict === 'approve' || row.verdict === 'edit' || row.verdict === 'reject') {
            byApprover.set(row.by, (byApprover.get(row.by) ?? 0) + 1);
        }
    }

    const desc = (a: { total: number }, b: { total: number }) => b.total - a.total;
    return {
        days: opts.days,
        since: opts.since.toISOString(),
        ...finish(overall),
        bySource: Array.from(bySource.entries()).map(([source, b]) => ({ source, ...finish(b) })).sort(desc),
        byIntent: Array.from(byIntent.entries()).map(([intent, b]) => ({ intent, ...finish(b) })).sort(desc),
        byApprover: Array.from(byApprover.entries()).map(([by, human]) => ({ by, human })).sort((a, b) => b.human - a.human),
        sampler: samplerAgreement(rows),
    };
}

/** Sum the buckets for a set of draft sources — one agent's slice of the stats. */
export function bucketForSources(stats: VerdictStats, sources: readonly string[]): VerdictBucket {
    const out = emptyBucket();
    for (const b of stats.bySource) {
        if (!sources.includes(b.source)) continue;
        out.approve += b.approve; out.edit += b.edit; out.reject += b.reject;
        out.sampleFine += b.sampleFine; out.sampleNotFine += b.sampleNotFine;
        out.human += b.human; out.total += b.total; out.unsafe += b.unsafe;
        for (const [k, v] of Object.entries(b.rejectReasons)) out.rejectReasons[k] = (out.rejectReasons[k] ?? 0) + v;
        for (const [k, v] of Object.entries(b.editReasons)) out.editReasons[k] = (out.editReasons[k] ?? 0) + v;
    }
    return finish(out);
}

/** The single most common reason in a counter, or null. */
export function topReason(counter: Record<string, number>): { reason: string; n: number } | null {
    let best: { reason: string; n: number } | null = null;
    for (const [reason, n] of Object.entries(counter)) if (!best || n > best.n) best = { reason, n };
    return best;
}
