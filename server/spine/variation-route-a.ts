/**
 * P15 part 3: Route A for ONE extra line.
 *
 * The same two steps a first quote gets, and no others: the estimator measures (minutes, materials,
 * flags, never a price), the engine prices. Everything here is reused from the quote path rather
 * than reimplemented, so an extra is priced by exactly the machinery that priced the job it is
 * attached to:
 *
 *   estimateProposal   server/spine/agents/estimator.ts   the same agent, one line
 *   fallbackEstimate   server/spine/route-a.ts            the same failure path (reference rates,
 *                                                         check_this, the error as the reason)
 *   priceEstimate      server/spine/pricing-bridge.ts     the ONE engine, live settings
 *
 * The estimator failing is not a reason to leave the contractor waiting: the line is priced from the
 * reference rate, marked check-this, and Ben is told why on the screen. Nothing here reaches a
 * customer and nothing here writes a customer-visible price — Ben's tap on the one-line screen does
 * both.
 */
import { newRunId } from '../approver';
// The estimator and Route A's fallback are imported lazily: the estimator drags the model + db
// graph in at module load, and nothing on this path needs it until the estimate actually runs.
import type { estimateProposal as EstimateProposalFn } from './agents/estimator';
import { defaultPricingDeps, priceEstimate, type PriceEstimateDeps } from './pricing-bridge';
import { suggestionFrom, type ExtraRequest, type PricedSuggestion } from './variation';
import type { QuoteEstimate } from './estimate-store';
import type { CaseFile, PolicyPack, TriageResult } from './types';

export interface PriceExtraInput {
    variationId: string;
    lineId: string;
    extra: ExtraRequest;
    /** The thread the job's quote lives on; null when the dispatch has no thread (the estimate still runs). */
    conversationId: string | null;
    phone: string | null;
    customerName: string | null;
}

export interface PriceExtraDeps {
    estimate?: typeof EstimateProposalFn;
    pricing?: PriceEstimateDeps;
    settings?: () => Promise<{ materialsMarginPercent: number; depositPercent: number }>;
    pack?: () => Promise<PolicyPack>;
    now?: () => Date;
}

export interface PriceExtraOutcome {
    suggestion: PricedSuggestion | null;
    estimateId: string | null;
    /** Non-null when the estimator failed: the line was priced from reference rates, check-this. */
    estimatorFailed: string | null;
    minutes: number;
    runId: string;
}

/** The minimum case file the estimator needs for a line reported from a job in progress. */
function caseFileFor(input: PriceExtraInput, at: Date): CaseFile {
    return {
        conversationId: input.conversationId ?? `variation:${input.variationId}`,
        phone: input.phone ?? '',
        audience: 'customer', stage: 'booked',
        contactName: input.customerName ?? null,
        timeline: [], media: [],
        window: { canFreeform: false, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' },
        client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null,
        hash: `variation:${input.variationId}`, builtAt: at.toISOString(),
    } as CaseFile;
}

function triageFor(): TriageResult {
    return { audience: 'customer', intent: 'unknown', lane: 'quote_clerk', exceptions: [], stage: 'booked', tags: ['variation'], reasons: ['P15/3: an extra found on site'], source: 'rules' } as TriageResult;
}

/**
 * Estimate and price ONE extra line. Never throws for a pricing problem: an estimator that fails,
 * refuses its claim, or returns nothing produces the reference-rate fallback, so Ben always has a
 * number to accept or overwrite.
 */
export async function priceExtraLine(input: PriceExtraInput, deps: PriceExtraDeps = {}): Promise<PriceExtraOutcome> {
    const at = (deps.now ?? (() => new Date()))();
    const runId = newRunId('run');
    const intakeLines = [{ lineId: input.lineId, title: input.extra.title, detail: input.extra.notes, category: null, assumptions: [] }];
    const caseFile = caseFileFor(input, at);
    const pack = await (deps.pack ?? (async () => (await import('./packs')).getPack('customer.default')))();

    let estimate: QuoteEstimate | null = null;
    let estimatorFailed: string | null = null;
    try {
        const estimateFn = deps.estimate ?? (await import('./agents/estimator')).estimateProposal;
        const proposal = await estimateFn({
            caseFile, pack: { id: pack.id, version: pack.version }, triage: triageFor(),
            runId, intakeRunId: `variation:${input.variationId}`, intakeLines, parentRunId: null,
        });
        estimate = proposal?.artifact?.kind === 'quote_estimate' ? (proposal.artifact.data as QuoteEstimate) : null;
        if (!estimate) estimatorFailed = 'estimator returned nothing';
    } catch (error: any) {
        estimatorFailed = String(error?.message ?? error).slice(0, 300);
        console.error(`[Variation] estimator failed for ${input.variationId}; pricing from reference rates:`, estimatorFailed);
    }
    if (!estimate) {
        const { fallbackEstimate } = await import('./route-a');
        estimate = fallbackEstimate({
            conversationId: caseFile.conversationId, intakeRunId: `variation:${input.variationId}`, runId,
            intakeLines, error: estimatorFailed ?? 'estimator returned nothing', id: null, now: at,
        });
    }

    const settings = await (deps.settings ?? (async () => (await import('../pricing-settings')).getPricingSettings()))();
    const pricing = deps.pricing ?? await defaultPricingDeps();
    const suggestions = await priceEstimate(estimate, settings as any, pricing);
    const line = suggestions.lines.find((l) => l.lineId === input.lineId) ?? suggestions.lines[0] ?? null;
    const suggestion = line ? suggestionFrom(line) : null;

    return {
        suggestion,
        estimateId: estimate.id.startsWith('est_fallback_') ? null : estimate.id,
        estimatorFailed,
        minutes: suggestion?.minutes ?? 0,
        runId,
    };
}
