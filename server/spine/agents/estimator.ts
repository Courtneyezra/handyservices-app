/**
 * The Estimator on the spine (P8 Route A, decision (a)). Tier PROPOSE.
 *
 * Judges every line of a fresh quote_ready intake: category, time as a RANGE, materials with
 * cost, access / difficulty flags, confidence. It NEVER outputs a price: its belt refuses a
 * submit_build that carries one, and its output has no price field to fill.
 *
 * Time comes from history first (`get_time_history`: same category, last 12 months, median +
 * IQR) — the model's own minutes are used only when history has fewer than 3 samples
 * (`timeSource: 'history' | 'model'`); a line the model could not measure is 'fallback' and the
 * pricing bridge prices it from the reference rate with `check_this`.
 *
 * Wraps the legacy runner (server/agents/quote-estimator.ts SYSTEM + runner) with a belt built
 * here; writes a quote_estimates row and returns a Proposal.artifact of kind 'quote_estimate'.
 * Chained by server/spine/index.ts inline after a quote_ready clerk artifact (documented there);
 * `accepts` lets a manual / cadence trigger re-run it on a thread whose fresh intake has no
 * live estimate yet.
 */
import { newRunId } from '../../approver';
import { SYSTEM as ESTIMATOR_SYSTEM } from '../../agents/quote-estimator';
import { buildEstimatorTools, getTimeHistory } from '../../agents/estimator-tools';
import { recordSpineRunStart, recordSpineRunFinish } from '../run-record';
import { insertEstimate, finishEstimate, findLiveEstimateForIntake, overallConfidence, type EstimateLine, type EstimateJob, type EstimateMaterial, type QuoteEstimate, type TimeSource } from '../estimate-store';
import { DEFAULT_SETUP_MIN, DEFAULT_CLEANUP_MIN } from '@shared/schedule-composition';
import type { CaseFile, PolicyPack, Proposal, SpineAgent, TriageResult, Trigger } from '../types';
import type { AgentTool } from '../../agents/runner';

export const ESTIMATOR_TRIGGER = 'spine:estimator';
export const ESTIMATOR_MODEL = 'claude-sonnet-5';
/** Fewer history samples than this and the model's minutes are used. */
export const HISTORY_MIN_SAMPLES = 3;

// ---------------------------------------------------------------- the belt (pure parts)

/** Keys that would be a price. Materials' `unitPricePence` (a COST) is the one money field allowed. */
const PRICE_KEY = /^(price|prices|pricePence|pricing|suggestedPrice|suggestedPricePence|labourPence|labourPricePence|labourPrice|totalPence|total|totalPrice|quotePrice|quoteTotal|charge|chargePence|amountPence|amount|guardedPricePence|llmSuggestedPricePence|referencePricePence|finalPricePence|pricePerLine|linePrice|linePricePence)$/i;
const ALLOWED_MONEY_KEYS = new Set(['unitPricePence', 'unitPriceIncVatPence', 'unitCostPence']);

/** Every path in `input` whose key names a price. Pure. */
export function findPriceFields(input: unknown, path = ''): string[] {
    if (!input || typeof input !== 'object') return [];
    const out: string[] = [];
    if (Array.isArray(input)) {
        input.forEach((v, i) => out.push(...findPriceFields(v, `${path}[${i}]`)));
        return out;
    }
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
        const p = path ? `${path}.${k}` : k;
        if (!ALLOWED_MONEY_KEYS.has(k) && (PRICE_KEY.test(k) || /(^|_)(price|total)(_|$)/i.test(k) && !/^unit/i.test(k))) out.push(p);
        out.push(...findPriceFields(v, p));
    }
    return out;
}

/** Bare money in free text the model could smuggle into a note ("about £180"). Pure. */
export function findMoneyInText(input: unknown): string[] {
    const out: string[] = [];
    const walk = (v: unknown, p: string) => {
        if (typeof v === 'string') { if (/£\s?\d|\b\d{2,5}\s?(quid|pounds|gbp)\b/i.test(v)) out.push(p); return; }
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, p ? `${p}.${k}` : k);
    };
    walk(input, '');
    // Material names / notes may legitimately carry a supplier price string; only line-level prose counts.
    return out.filter((p) => !/materials\[\d+\]/.test(p));
}

/** Median and inter-quartile range of a sample, in minutes. Pure. */
export function historyRange(samples: number[]): { median: number; q1: number; q3: number; n: number } | null {
    const xs = samples.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
    if (xs.length < HISTORY_MIN_SAMPLES) return null;
    const q = (p: number) => { const i = (xs.length - 1) * p; const lo = Math.floor(i); const hi = Math.ceil(i); return Math.round(xs[lo] + (xs[hi] - xs[lo]) * (i - lo)); };
    return { median: q(0.5), q1: q(0.25), q3: q(0.75), n: xs.length };
}

export interface IntakeLineForEstimate { lineId: string; title: string; detail?: string | null; category?: string | null; assumptions?: string[] }

/** Words worth matching in history for a line. Pure. */
export function keywordsFor(title: string, detail?: string | null): string[] {
    const stop = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'onto', 'a', 'an', 'of', 'to', 'in', 'on', 'at', 'is', 'it', 'new', 'old', 'fit', 'fix', 'replace', 'install']);
    return Array.from(new Set(`${title} ${detail ?? ''}`.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !stop.has(w)))).slice(0, 6);
}

/**
 * Fold the model's build + the history samples into EstimateLines. History wins when it has
 * ≥ 3 samples; the model's range otherwise; a line the model did not return is 'fallback'. Pure.
 */
export function foldEstimateLines(
    intakeLines: IntakeLineForEstimate[],
    build: { lines: Array<{ lineIndex: number; category?: string; time?: { minutes: number; confidence?: string; rangeMinutes?: [number, number] | number[]; note?: string }; materials?: any[]; assumptions?: string[]; procedure?: string[]; unresolved?: string; flags?: string[] }> } | null,
    history: Array<{ median: number; q1: number; q3: number; n: number } | null>,
): EstimateLine[] {
    return intakeLines.map((il, i) => {
        const bl = build?.lines.find((l) => l.lineIndex === i) ?? null;
        const h = history[i] ?? null;
        const materials: EstimateMaterial[] = (bl?.materials ?? []).map((m: any) => ({
            name: String(m.name ?? ''), qty: Number(m.qty) || 1, unitCostPence: Math.max(0, Math.round(Number(m.unitPricePence) || 0)),
            source: (['catalog', 'screwfix', 'web', 'model'] as const).includes(m.supplier) ? m.supplier : 'model',
            needsReview: !!m.needsReview, supplierUrl: m.supplierUrl ?? null, supplierItemNumber: m.supplierItemNumber ?? null, catalogId: m.catalogId ?? null,
        })).filter((m: EstimateMaterial) => m.name);
        const flags = Array.isArray(bl?.flags) ? bl!.flags!.map(String) : [];
        const conf = (bl?.time?.confidence === 'high' || bl?.time?.confidence === 'medium' || bl?.time?.confidence === 'low') ? bl.time.confidence : 'low';
        const base = { lineId: il.lineId, title: il.title, category: String(bl?.category ?? il.category ?? 'other'), materials, flags, procedure: bl?.procedure ?? [], assumptions: [...(il.assumptions ?? []), ...(bl?.assumptions ?? [])], unresolved: bl?.unresolved ?? null };
        if (h) {
            return { ...base, minutesLow: h.q1, minutesHigh: h.q3, minutesPoint: h.median, confidence: h.n >= 6 ? 'high' : 'medium', reasoning: `${h.n} similar jobs in the last 12 months: median ${h.median} min (IQR ${h.q1}–${h.q3})${bl?.time?.note ? `; model: ${bl.time.note}` : ''}`, timeSource: 'history' as TimeSource };
        }
        const minutes = Number(bl?.time?.minutes) || 0;
        if (minutes > 0) {
            const range = Array.isArray(bl?.time?.rangeMinutes) && bl!.time!.rangeMinutes!.length === 2 ? bl!.time!.rangeMinutes as number[] : null;
            const low = range ? Math.min(range[0], minutes) : Math.round(minutes * 0.8);
            const high = range ? Math.max(range[1], minutes) : Math.round(minutes * 1.3);
            return { ...base, minutesLow: Math.max(1, low), minutesHigh: Math.max(minutes, high), minutesPoint: minutes, confidence: conf, reasoning: bl?.time?.note || 'model estimate (fewer than 3 similar jobs in history)', timeSource: 'model' as TimeSource };
        }
        return { ...base, minutesLow: 0, minutesHigh: 0, minutesPoint: 0, confidence: 'low', reasoning: bl ? 'the estimator gave no usable time for this line' : 'the estimator returned no line for this intake line', timeSource: 'fallback' as TimeSource };
    });
}

/** The job-level allowances (decision (c)): ONE setup and ONE cleanup per job. Pure. */
export function jobAllowance(build: { quoteNotes?: string[] } | null, flags: string[]): EstimateJob {
    return { setupMinutes: DEFAULT_SETUP_MIN, cleanupMinutes: DEFAULT_CLEANUP_MIN, accessNotes: Array.from(new Set([...(build?.quoteNotes ?? []), ...flags.filter((f) => /access|parking|ladder|stairs|occupied|lift/i.test(f))])) };
}

/**
 * The belt: the legacy estimator's tools, with submit_build replaced by a validator that refuses
 * any price (decision (a)) and captures the build for the fold.
 */
export function buildEstimatorBelt(conversationId: string | undefined): { tools: AgentTool[]; getBuild: () => any } {
    const legacy = buildEstimatorTools({ conversationId });
    let accepted: any = null;
    const tools = legacy.tools.map((t) => {
        if (t.name !== 'submit_build') return t;
        return {
            ...t,
            description: `${t.description} NEVER include a price, total or charge of any kind: only time (minutes, range, confidence, basis), materials with their unit COST, procedure, assumptions and flags. A submission carrying a price is refused.`,
            run: async (input: any) => {
                const priceFields = findPriceFields(input);
                const moneyText = findMoneyInText(input);
                if (priceFields.length || moneyText.length) {
                    throw new Error(`Refused: the estimator never outputs a price. Remove ${[...priceFields, ...moneyText].slice(0, 6).join(', ')} and resubmit with time, materials (unit cost only), procedure, assumptions and flags.`);
                }
                // Validate through the legacy normaliser (throws readable errors), but keep the raw
                // input too so optional fields it drops (flags) survive.
                const r = await t.run(input);
                accepted = { ...legacy.getBuild(), lines: (legacy.getBuild()?.lines ?? []).map((l: any, i: number) => ({ ...l, flags: Array.isArray(input?.lines?.[i]?.flags) ? input.lines[i].flags : [] })) };
                return r;
            },
        } as AgentTool;
    });
    return { tools, getBuild: () => accepted };
}

// ---------------------------------------------------------------- reading the intake

/** The clerk's artifact lines, as the estimator wants them. Pure. */
export function intakeLinesFromArtifact(artifact: { data?: unknown } | null | undefined): IntakeLineForEstimate[] {
    const d = (artifact?.data ?? {}) as Record<string, any>;
    if (!Array.isArray(d.lines)) return [];
    return d.lines.map((l: any, i: number) => ({ lineId: `card_${i + 1}`, title: String(l?.title ?? '').trim(), detail: l?.detail ?? null, category: l?.category ?? null, assumptions: Array.isArray(l?.assumptions) ? l.assumptions.map(String) : [] })).filter((l: IntakeLineForEstimate) => l.title);
}

export interface EstimateRunInput {
    caseFile: CaseFile;
    pack: Pick<PolicyPack, 'id' | 'version'>;
    triage: TriageResult;
    /** The spine run id for the estimator's own agent_runs row. */
    runId: string;
    /** The quote_clerk run whose artifact is being estimated. */
    intakeRunId: string;
    intakeLines: IntakeLineForEstimate[];
    parentRunId?: string | null;
}

export interface EstimateRunDeps {
    /** The model runner (server/agents/runner.ts runAgent). Injected for tests. */
    runAgent?: (opts: any) => Promise<{ finalText: string; turns: number; usage?: any; costPence?: number | null; model?: string }>;
    history?: (category: string, keywords: string[]) => Promise<number[]>;
    store?: { insert: typeof insertEstimate; finish: typeof finishEstimate };
}

/** Run the estimator on one intake and persist the row. Never prices. */
export async function runEstimateForIntake(input: EstimateRunInput, deps: EstimateRunDeps = {}): Promise<QuoteEstimate> {
    const store = deps.store ?? { insert: insertEstimate, finish: finishEstimate };
    const history = deps.history ?? (async (category: string, keywords: string[]) => (await getTimeHistory({ category, keywords })).estimates.map((e) => e.minutes));
    const runAgent = deps.runAgent ?? (async (opts: any) => (await import('../../agents/runner')).runAgent(opts));

    const estimateId = await store.insert({ conversationId: input.caseFile.conversationId, runId: input.runId, intakeRunId: input.intakeRunId, status: 'running', model: ESTIMATOR_MODEL });
    const startedAt = Date.now();
    try {
        // History first (decision: the model only when history < 3 samples).
        const hist = await Promise.all(input.intakeLines.map(async (l) => {
            try { return historyRange(await history(String(l.category ?? 'other'), keywordsFor(l.title, l.detail))); } catch { return null; }
        }));
        const belt = buildEstimatorBelt(input.caseFile.conversationId);
        const goal = [
            'Estimate the following job lines. Time: minutes with a [min, max] range and a confidence; materials with unit COST; a procedure; assumptions; and `flags` per line for access or difficulty (e.g. "ladder", "no_parking", "occupied", "unknown_substrate"). Never a price.',
            '', ...input.intakeLines.map((l, i) => `${i + 1}. ${l.title}${l.detail ? ` — ${l.detail}` : ''}${l.category ? ` [${l.category}]` : ''}`),
            '', 'Then call submit_build once.',
        ].join('\n');
        const result = await runAgent({
            name: 'estimator', system: ESTIMATOR_SYSTEM, goal, tools: belt.tools, model: ESTIMATOR_MODEL, maxTurns: 12, maxTokens: 8000,
            runId: newRunId('run'), trigger: ESTIMATOR_TRIGGER, conversationId: input.caseFile.conversationId, phone: input.caseFile.phone,
            packId: input.pack.id, packVersion: input.pack.version, caseFileRef: input.caseFile.hash, parentRunId: input.runId,
        });
        const build = belt.getBuild();
        const lines = foldEstimateLines(input.intakeLines, build, hist);
        const job = jobAllowance(build, lines.flatMap((l) => l.flags));
        await store.finish(estimateId, { status: 'complete', lines, job, model: result.model ?? ESTIMATOR_MODEL, costPence: result.costPence ?? null });
        return {
            id: estimateId, conversationId: input.caseFile.conversationId, runId: input.runId, draftQuoteId: null, intakeRunId: input.intakeRunId,
            status: 'complete', lines, job, confidence: overallConfidence(lines), model: result.model ?? ESTIMATOR_MODEL, costPence: result.costPence ?? null,
            createdAt: new Date(startedAt).toISOString(), finishedAt: new Date().toISOString(), supersededAt: null,
        };
    } catch (error: any) {
        await store.finish(estimateId, { status: 'failed', error: error?.message ?? String(error) }).catch(() => undefined);
        throw error;
    }
}

// ---------------------------------------------------------------- the SpineAgent

const CHAIN_TRIGGERS: readonly Trigger[] = ['manual', 'cadence'];

/**
 * As a spine agent: a manual / cadence trigger on a thread whose freshest quote_ready intake has
 * no live estimate. (The inline chain in server/spine/index.ts is the normal path.)
 */
export const estimatorAgent: SpineAgent = {
    name: 'estimator',
    tier: 'PROPOSE',
    accepts: ({ trigger }) => CHAIN_TRIGGERS.includes(trigger),
    async run({ caseFile, pack, triage, runId }): Promise<Proposal | null> {
        const { loadQuoteIntakeCard } = await import('../quote-intake');
        const card = await loadQuoteIntakeCard(caseFile.conversationId);
        if (!card.available || card.intake.readiness !== 'quote_ready') return null;
        if (await findLiveEstimateForIntake(card.runId)) return null;
        const { db } = await import('../../db');
        const { agentRuns } = await import('@shared/schema');
        const { eq } = await import('drizzle-orm');
        const [row] = await db.select({ proposal: agentRuns.proposal }).from(agentRuns).where(eq(agentRuns.id, card.runId)).limit(1);
        const artifact = (row?.proposal as any)?.artifact ?? (row?.proposal as any)?.proposal?.artifact ?? null;
        const intakeLines = intakeLinesFromArtifact(artifact);
        if (!intakeLines.length) return null;
        return estimateProposal({ caseFile, pack, triage, runId, intakeRunId: card.runId, intakeLines });
    },
};

/** Run + record + wrap as a Proposal.artifact (the same thing the inline chain does). */
export async function estimateProposal(input: EstimateRunInput, deps: EstimateRunDeps = {}): Promise<Proposal | null> {
    const startedAt = Date.now();
    await recordSpineRunStart({ runId: input.runId, agent: 'estimator', trigger: ESTIMATOR_TRIGGER, caseFile: input.caseFile, pack: input.pack });
    const meta = { agent: 'estimator' as const, caseFile: input.caseFile };
    try {
        const estimate = await runEstimateForIntake(input, deps);
        const proposal: Proposal = {
            intent: 'propose_estimate', body: [], reasons: [`${estimate.lines.length} line(s) estimated, confidence ${estimate.confidence ?? 'n/a'}`],
            citations: [`quote_estimates:${estimate.id}`, `agent_runs:${input.intakeRunId}`],
            artifact: { kind: 'quote_estimate', summary: `${estimate.lines.length} line(s), ${estimate.lines.filter((l) => l.timeSource === 'history').length} from history, confidence ${estimate.confidence ?? 'n/a'}`, data: estimate, childRunId: null },
        };
        await recordSpineRunFinish(input.runId, meta, { decision: 'PROPOSE', lane: input.triage.lane, durationMs: Date.now() - startedAt, proposal: { intent: proposal.intent, artifact: proposal.artifact }, model: estimate.model, usage: null });
        return proposal;
    } catch (error: any) {
        await recordSpineRunFinish(input.runId, meta, { error: error?.message ?? String(error), durationMs: Date.now() - startedAt, lane: input.triage.lane });
        throw error;
    }
}
