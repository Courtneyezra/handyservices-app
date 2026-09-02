/**
 * Route A (P8): intake → estimate → priced draft → Ben confirms → send.
 *
 *   clerk scopes    a quote_clerk run whose artifact says readiness quote_ready
 *   estimator       measures: time ranges, materials with cost, flags (agents/estimator.ts) — no price
 *   engine prices   the ONLY engine (pricing-bridge.ts → multi-line-engine.ts, live settings)
 *   draft           personalized_quotes draft with suggestions in pricing_suggestions, every
 *                   customer-visible price NULL (quote-intake.ts createPricedDraft)
 *   Ben decides     Pushover "Quote ready to price" → /admin/price/<slug> (pane B)
 *
 * Runs INLINE in the same spine pass as the clerk (server/spine/index.ts) — chosen over a queued
 * `cadence` re-run so the estimate and the draft exist before the pass ends and the card can show
 * "Estimating…" → "Price and send" without a second claim; a manual / cadence trigger re-runs it
 * through the estimator agent's `accepts`. Runs in shadow too: nothing here reaches a customer
 * (the draft is unsent, prices are null), and the spine clerk is the only intake since P8 (f).
 *
 * A new intake on a thread supersedes earlier estimates and unsent drafts first (P7 pattern:
 * system_events row; the ledger has no estimate event type and is not extended).
 */
import type { CaseFile, PolicyPack, Proposal, TriageResult } from './types';
import { estimateProposal, intakeLinesFromArtifact } from './agents/estimator';
import { supersedeEstimatesForConversation, type QuoteEstimate } from './estimate-store';
import { priceEstimate, defaultPricingDeps, ESTIMATOR_FAILED_PREFIX, type PriceEstimateDeps, type PricingSuggestions } from './pricing-bridge';
import type { IntakeLineForEstimate } from './agents/estimator';
import { intakeFromArtifact, createPricedDraft } from './quote-intake';
import { buildSurveyOfferProposal, surveyWhyFrom } from './survey-offer';
import { newRunId } from '../approver';

export interface RouteAOutcome {
    ran: boolean;
    reason?: string;
    estimateId?: string;
    draftSlug?: string;
    supersededEstimates?: string[];
    supersededDrafts?: string[];
    checkThis?: number;
    /** P8-fix: the estimator failed; the draft was priced from reference rates, every line check_this. */
    fallback?: boolean;
}

export interface RouteADeps {
    pricing?: PriceEstimateDeps;
    settings?: () => Promise<{ materialsMarginPercent: number; depositPercent: number; surveyFeePence: number }>;
    estimate?: typeof estimateProposal;
    createDraft?: typeof createPricedDraft;
    supersede?: typeof supersedeEstimatesForConversation;
    notify?: (alert: { conversationId: string; customerName?: string | null; postcode?: string | null; slug: string; lines: string[]; checkThis: number; suggestedTotalPence?: number | null; estimatorFailed?: string | null }) => Promise<void>;
    log?: (e: { kind: 'other' | 'hold'; summary: string; detail: Record<string, unknown>; conversationId: string; source: string }) => Promise<void>;
}

/**
 * Pure (P8-fix): the estimate Route A prices when the estimator failed — every intake line as a
 * fallback line (no minutes, no materials, low confidence, reasoning "estimator failed: …"), so
 * the pricing bridge prices each from the reference rate with check_this and that reason.
 * `id` is the failed quote_estimates row when there is one, so the price screen shows the failure.
 */
export function fallbackEstimate(input: { conversationId: string; intakeRunId: string; runId: string; intakeLines: IntakeLineForEstimate[]; error: string; id: string | null; now?: Date }): QuoteEstimate {
    const at = (input.now ?? new Date()).toISOString();
    return {
        id: input.id ?? `est_fallback_${input.intakeRunId}`, conversationId: input.conversationId, runId: input.runId, draftQuoteId: null, intakeRunId: input.intakeRunId,
        status: 'failed', error: input.error,
        lines: input.intakeLines.map((l) => ({
            lineId: l.lineId, title: l.title, category: String(l.category ?? 'other'), minutesLow: 0, minutesHigh: 0, minutesPoint: 0,
            materials: [], flags: [], confidence: 'low', reasoning: `${ESTIMATOR_FAILED_PREFIX}${input.error}`.slice(0, 400), timeSource: 'fallback',
            assumptions: l.assumptions ?? [], procedure: [], unresolved: null,
        })),
        job: { setupMinutes: 0, cleanupMinutes: 0, accessNotes: [] },
        confidence: 'low', model: null, costPence: null, createdAt: at, finishedAt: at, supersededAt: null,
    };
}

/** Pure: readiness off a clerk artifact. */
export function artifactReadiness(artifact: { kind?: string; data?: unknown } | null | undefined): string | null {
    if (!artifact || artifact.kind !== 'quote_intake') return null;
    const r = (artifact.data as any)?.readiness;
    return typeof r === 'string' ? r : null;
}

export async function runRouteAChain(input: {
    caseFile: CaseFile; pack: PolicyPack; triage: TriageResult;
    clerkRunId: string; artifact: NonNullable<Proposal['artifact']>;
}, deps: RouteADeps = {}): Promise<RouteAOutcome> {
    const { caseFile, pack, triage, clerkRunId, artifact } = input;
    const log = deps.log ?? (async (e) => { const { logSystemEvent } = await import('../system-events'); await logSystemEvent({ ...e, phone: caseFile.phone }); });
    const intake = intakeFromArtifact(artifact);
    const intakeLines = intakeLinesFromArtifact(artifact);
    if (!intake || !intakeLines.length) return { ran: false, reason: 'intake has no lines' };

    // 1. A new scope supersedes what came before it (estimates now; drafts inside createPricedDraft).
    const supersededEstimates = await (deps.supersede ?? supersedeEstimatesForConversation)(caseFile.conversationId, null).catch(() => [] as string[]);

    // 2. Estimate (its own agent_runs row, child of the clerk's pass). Single flight: a refused
    //    claim means another run holds this intake — not ours, no draft from here. Any other
    //    failure (max_tokens after the retry, a timeout, the model down) still produces a draft:
    //    every line priced from the reference rate with check_this and the error as the reason,
    //    so Ben always has something to price. The estimate row stays `failed` with the error.
    const estimatorRunId = newRunId('run');
    let estimate: QuoteEstimate | null = null;
    let estimatorFailed: string | null = null;
    try {
        const proposal = await (deps.estimate ?? estimateProposal)({ caseFile, pack: { id: pack.id, version: pack.version }, triage, runId: estimatorRunId, intakeRunId: clerkRunId, intakeLines, parentRunId: clerkRunId });
        estimate = proposal?.artifact?.kind === 'quote_estimate' ? (proposal.artifact.data as QuoteEstimate) : null;
        if (!estimate) estimatorFailed = 'estimator returned nothing';
    } catch (error: any) {
        if (error?.name === 'EstimateClaimRefused') {
            return { ran: false, reason: error.message, supersededEstimates };
        }
        estimatorFailed = String(error?.message ?? error).slice(0, 300);
        const failedId = typeof error?.estimateId === 'string' ? error.estimateId : null;
        console.error(`[RouteA] estimator failed for ${caseFile.conversationId}; pricing the fallback draft:`, estimatorFailed);
        estimate = fallbackEstimate({ conversationId: caseFile.conversationId, intakeRunId: clerkRunId, runId: estimatorRunId, intakeLines, error: estimatorFailed, id: failedId });
    }
    if (!estimate) estimate = fallbackEstimate({ conversationId: caseFile.conversationId, intakeRunId: clerkRunId, runId: estimatorRunId, intakeLines, error: estimatorFailed ?? 'estimator returned nothing', id: null });

    // 3. Price with the real engine and the live settings.
    const settings = await (deps.settings ?? (async () => (await import('../pricing-settings')).getPricingSettings()))();
    const pricing = deps.pricing ?? await defaultPricingDeps();
    const suggestions: PricingSuggestions = await priceEstimate(estimate, settings as any, pricing);

    // 4. The draft: suggestions only, prices null, one per intake run; earlier unsent drafts superseded.
    const draft = await (deps.createDraft ?? createPricedDraft)({ conversationId: caseFile.conversationId, intake, estimate, suggestions });
    if (!draft.ok) {
        await log({ kind: 'hold', summary: `Route A: estimate ${estimate.id} priced but no draft (${draft.errors.join('; ')})`, detail: { estimateId: estimate.id, errors: draft.errors }, conversationId: caseFile.conversationId, source: 'route-a' }).catch(() => undefined);
        return { ran: true, reason: draft.errors.join('; '), estimateId: estimate.id, supersededEstimates };
    }
    // A failed estimate row stays `failed` with its error; only a real estimate is marked complete.
    if (!estimatorFailed) {
        try {
            const { finishEstimate } = await import('./estimate-store');
            await finishEstimate(estimate.id, { status: 'complete', draftQuoteId: draft.id });
        } catch { /* bookkeeping */ }
    } else if (!estimate.id.startsWith('est_fallback_')) {
        try {
            const { finishEstimate } = await import('./estimate-store');
            await finishEstimate(estimate.id, { status: 'failed', error: estimatorFailed, draftQuoteId: draft.id });
        } catch { /* bookkeeping */ }
    }
    const checkThis = suggestions.lines.filter((l) => l.checkThis).length;
    await log({
        kind: 'other', source: 'route-a', conversationId: caseFile.conversationId,
        summary: `Route A: draft ${draft.slug} from ${estimatorFailed ? 'reference rates (estimator failed)' : `estimate ${estimate.id}`} (${suggestions.lines.length} lines, ${checkThis} check_this${supersededEstimates.length || draft.superseded.length ? `; superseded ${supersededEstimates.length} estimate(s), ${draft.superseded.length} draft(s)` : ''})`,
        detail: { estimateId: estimate.id, draftId: draft.id, slug: draft.slug, clerkRunId, estimatorRunId, supersededEstimates, supersededDrafts: draft.superseded, totals: suggestions.totals, estimatorFailed },
    }).catch(() => undefined);

    // 5. Ben.
    try {
        const notify = deps.notify ?? (async (a) => { const { notifyQuoteReadyToPrice } = await import('../pushover'); await notifyQuoteReadyToPrice(a); });
        await notify({ conversationId: caseFile.conversationId, customerName: intake.customerName ?? caseFile.contactName ?? null, postcode: intake.postcode, slug: draft.slug, lines: intake.lines.map((l) => l.title), checkThis, suggestedTotalPence: suggestions.totals.suggestedPence, estimatorFailed });
    } catch (e: any) {
        console.warn('[RouteA] Pushover failed (draft stands):', e?.message ?? e);
    }
    return { ran: true, estimateId: estimate.id, draftSlug: draft.slug, supersededEstimates, supersededDrafts: draft.superseded, checkThis, ...(estimatorFailed ? { fallback: true, reason: `${ESTIMATOR_FAILED_PREFIX}${estimatorFailed}` } : {}) };
}

/**
 * P11: Route A's failure path for an estimate a restart killed (the janitor marked it failed).
 * Outside a spine pass, so it rebuilds what it needs from the row: the clerk artifact on the
 * intake run → fallback estimate (every line from the reference rate, check_this, reason
 * "estimator failed: orphaned: process restarted") → draft → Pushover "priced from reference
 * rates". Nothing when the estimate is superseded, already has a draft, or its intake is gone.
 */
export async function runFallbackDraftForOrphan(estimateId: string, deps: RouteADeps = {}): Promise<{ ok: boolean; slug?: string; reason?: string }> {
    const { getEstimate, finishEstimate } = await import('./estimate-store');
    const est = await getEstimate(estimateId);
    if (!est) return { ok: false, reason: 'estimate not found' };
    if (est.supersededAt) return { ok: false, reason: 'estimate superseded' };
    if (est.draftQuoteId) return { ok: false, reason: 'estimate already has a draft' };
    if (!est.conversationId || !est.intakeRunId) return { ok: false, reason: 'estimate has no thread or intake run' };
    const { db } = await import('../db');
    const { agentRuns, conversations } = await import('@shared/schema');
    const { eq } = await import('drizzle-orm');
    const [run] = await db.select({ proposal: agentRuns.proposal }).from(agentRuns).where(eq(agentRuns.id, est.intakeRunId)).limit(1);
    const artifact = ((run?.proposal as any)?.artifact ?? (run?.proposal as any)?.proposal?.artifact ?? null) as Proposal['artifact'];
    const intake = intakeFromArtifact(artifact);
    const intakeLines = intakeLinesFromArtifact(artifact);
    if (!intake || !intakeLines.length) return { ok: false, reason: 'intake artifact unreadable' };
    const [conv] = await db.select({ contactName: conversations.contactName }).from(conversations).where(eq(conversations.id, est.conversationId)).limit(1);

    const error = est.error ?? 'orphaned: process restarted';
    const estimate = fallbackEstimate({ conversationId: est.conversationId, intakeRunId: est.intakeRunId, runId: est.runId ?? 'orphan', intakeLines, error, id: est.id });
    const settings = await (deps.settings ?? (async () => (await import('../pricing-settings')).getPricingSettings()))();
    const pricing = deps.pricing ?? await defaultPricingDeps();
    const suggestions = await priceEstimate(estimate, settings as any, pricing);
    const draft = await (deps.createDraft ?? createPricedDraft)({ conversationId: est.conversationId, intake, estimate, suggestions });
    if (!draft.ok) return { ok: false, reason: draft.errors.join('; ') };
    try { await finishEstimate(est.id, { status: 'failed', error, draftQuoteId: draft.id }); } catch { /* bookkeeping */ }
    const checkThis = suggestions.lines.filter((l) => l.checkThis).length;
    const log = deps.log ?? (async (e) => { const { logSystemEvent } = await import('../system-events'); await logSystemEvent(e); });
    await log({ kind: 'other', source: 'route-a', conversationId: est.conversationId, summary: `Route A (janitor): draft ${draft.slug} from reference rates for orphaned estimate ${est.id}`, detail: { estimateId: est.id, draftId: draft.id, slug: draft.slug, error, totals: suggestions.totals } }).catch(() => undefined);
    try {
        const notify = deps.notify ?? (async (a) => { const { notifyQuoteReadyToPrice } = await import('../pushover'); await notifyQuoteReadyToPrice(a); });
        await notify({ conversationId: est.conversationId, customerName: intake.customerName ?? conv?.contactName ?? null, postcode: intake.postcode, slug: draft.slug, lines: intake.lines.map((l) => l.title), checkThis, suggestedTotalPence: suggestions.totals.suggestedPence, estimatorFailed: error });
    } catch (e: any) {
        console.warn('[RouteA] Pushover failed (orphan draft stands):', e?.message ?? e);
    }
    return { ok: true, slug: draft.slug };
}

/** visit_first: the DRAFT survey offer for Ben (decision (e)). Fee from settings; no link (see survey-offer.ts). */
export async function surveyOfferFor(input: { caseFile: CaseFile; clerkRunId: string; artifact: NonNullable<Proposal['artifact']> }, deps: Pick<RouteADeps, 'settings'> = {}): Promise<Proposal | null> {
    const intake = intakeFromArtifact(input.artifact);
    const settings = await (deps.settings ?? (async () => (await import('../pricing-settings')).getPricingSettings()))();
    const fee = Number((settings as any).surveyFeePence);
    if (!Number.isFinite(fee) || fee <= 0) return null;
    const firstName = (intake?.customerName ?? input.caseFile.contactName ?? '').trim().split(/\s+/)[0] || null;
    return buildSurveyOfferProposal({ firstName, feePence: fee, why: surveyWhyFrom(intake), intakeRunId: input.clerkRunId });
}
