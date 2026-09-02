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
import { priceEstimate, defaultPricingDeps, type PriceEstimateDeps, type PricingSuggestions } from './pricing-bridge';
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
}

export interface RouteADeps {
    pricing?: PriceEstimateDeps;
    settings?: () => Promise<{ materialsMarginPercent: number; depositPercent: number; surveyFeePence: number }>;
    estimate?: typeof estimateProposal;
    createDraft?: typeof createPricedDraft;
    supersede?: typeof supersedeEstimatesForConversation;
    notify?: (alert: { conversationId: string; customerName?: string | null; postcode?: string | null; slug: string; lines: string[]; checkThis: number; suggestedTotalPence?: number | null }) => Promise<void>;
    log?: (e: { kind: 'other' | 'hold'; summary: string; detail: Record<string, unknown>; conversationId: string; source: string }) => Promise<void>;
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

    // 2. Estimate (its own agent_runs row, child of the clerk's pass).
    const estimatorRunId = newRunId('run');
    const proposal = await (deps.estimate ?? estimateProposal)({ caseFile, pack: { id: pack.id, version: pack.version }, triage, runId: estimatorRunId, intakeRunId: clerkRunId, intakeLines, parentRunId: clerkRunId });
    const estimate = proposal?.artifact?.kind === 'quote_estimate' ? (proposal.artifact.data as QuoteEstimate) : null;
    if (!estimate) return { ran: true, reason: 'estimator returned nothing', supersededEstimates };

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
    try {
        const { finishEstimate } = await import('./estimate-store');
        await finishEstimate(estimate.id, { status: 'complete', draftQuoteId: draft.id });
    } catch { /* bookkeeping */ }
    const checkThis = suggestions.lines.filter((l) => l.checkThis).length;
    await log({
        kind: 'other', source: 'route-a', conversationId: caseFile.conversationId,
        summary: `Route A: draft ${draft.slug} from estimate ${estimate.id} (${suggestions.lines.length} lines, ${checkThis} check_this${supersededEstimates.length || draft.superseded.length ? `; superseded ${supersededEstimates.length} estimate(s), ${draft.superseded.length} draft(s)` : ''})`,
        detail: { estimateId: estimate.id, draftId: draft.id, slug: draft.slug, clerkRunId, estimatorRunId, supersededEstimates, supersededDrafts: draft.superseded, totals: suggestions.totals },
    }).catch(() => undefined);

    // 5. Ben.
    try {
        const notify = deps.notify ?? (async (a) => { const { notifyQuoteReadyToPrice } = await import('../pushover'); await notifyQuoteReadyToPrice(a); });
        await notify({ conversationId: caseFile.conversationId, customerName: intake.customerName ?? caseFile.contactName ?? null, postcode: intake.postcode, slug: draft.slug, lines: intake.lines.map((l) => l.title), checkThis, suggestedTotalPence: suggestions.totals.suggestedPence });
    } catch (e: any) {
        console.warn('[RouteA] Pushover failed (draft stands):', e?.message ?? e);
    }
    return { ran: true, estimateId: estimate.id, draftSlug: draft.slug, supersededEstimates, supersededDrafts: draft.superseded, checkThis };
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
