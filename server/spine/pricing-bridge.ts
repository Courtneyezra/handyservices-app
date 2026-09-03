/**
 * Pricing bridge (P8 Route A, decision (b)): the ONLY way an estimate becomes a price
 * suggestion is server/contextual-pricing/multi-line-engine.ts — the same call the contextual
 * generator makes (contextual-pricing/routes.ts /api/pricing/multi-quote) — with the LIVE
 * settings row (materialsMarginPercent = 27 today, read from settings, never hardcoded). The
 * additive functions in server/pricing-config.ts are never imported here.
 *
 *   labour   = the estimator's on-site minutes per line + ONE setup + ONE cleanup allowance per
 *              job (decision (c); the allowance is allocated across lines in proportion to their
 *              on-site minutes so per-line suggestions and bands are stable — no per-line buffers)
 *   band     = the engine run at minutesLow and at minutesHigh
 *   materials= at settings.materialsMarginPercent, inside the engine
 *   rules    = the engine's own guardrails (floor / minimum / ceiling / batch discount / whole
 *              pounds / returning cap), reported per line; nothing is re-implemented here
 *   fallback = a line the estimator could not measure (timeSource 'fallback', or no minutes):
 *              reference rate × the category's minimum-charge duration from
 *              contextual-pricing/reference-rates.ts, `checkThis: true` with the reason (decision (d))
 *
 * The engine is injectable so the arithmetic is unit-tested without a model or a database.
 */
import type { MultiLineRequest, MultiLineResult, JobCategory, ContextualSignals } from '@shared/contextual-pricing-types';
import { JobCategoryValues } from '@shared/contextual-pricing-types';
import { depositFor, type PricingSettings } from '@shared/pricing-settings';
import type { QuoteMaterial } from '@shared/materials';
import { DEFAULT_SETUP_MIN, DEFAULT_CLEANUP_MIN } from '@shared/schedule-composition';
import type { EstimateLine, EstimateJob, QuoteEstimate } from './estimate-store';

export interface LineSuggestion {
    lineId: string;
    title: string;
    category: string;
    suggestedPence: number;
    bandLowPence: number;
    bandHighPence: number;
    checkThis: boolean;
    reason: string | null;
    basis: {
        minutes: number;
        minutesLow: number;
        minutesHigh: number;
        /** The job's one-off setup + cleanup share allocated onto this line. */
        allowanceMinutes: number;
        ratePencePerHour: number;
        labourPence: number;
        materialsPence: number;
        materialsWithMarginPence: number;
        marginPct: number;
        rules: string[];
        timeSource: EstimateLine['timeSource'];
        confidence: EstimateLine['confidence'];
    };
}

export interface PricingSuggestions {
    estimateId: string;
    at: string;
    lines: LineSuggestion[];
    totals: { labourPence: number; materialsPence: number; materialsWithMarginPence: number; suggestedPence: number; bandLowPence: number; bandHighPence: number; depositPence: number };
    settings: { materialsMarginPercent: number; depositPercent: number; setupMinutes: number; cleanupMinutes: number };
    rules: string[];
    engine: 'multi-line-engine' | 'reference-fallback';
}

export type Engine = (request: MultiLineRequest) => Promise<MultiLineResult>;

export interface PriceEstimateDeps {
    engine: Engine;
    /** Reference rate for a category: hourly pence + minimum charge (contextual-pricing/reference-rates.ts). */
    reference: (category: JobCategory, minutes: number) => { hourlyPence: number; minChargePence: number; pricePence: number };
    signals?: Partial<ContextualSignals>;
    now?: () => Date;
}

/** The minutes a fallback line is priced at when the estimator gave none: the category minimum-charge duration. */
export const FALLBACK_MINUTES = 60;

export function toJobCategory(raw: string | null | undefined): JobCategory {
    return (JobCategoryValues as readonly string[]).includes(String(raw)) ? (raw as JobCategory) : ('other' as JobCategory);
}

/** Pure: the job's one-off setup + cleanup allowance, shared across lines by on-site minutes (rounded, remainder on the first line). */
export function allocateAllowance(lines: Array<{ minutes: number }>, allowanceMinutes: number): number[] {
    const total = lines.reduce((s, l) => s + Math.max(0, l.minutes), 0);
    if (!lines.length || allowanceMinutes <= 0) return lines.map(() => 0);
    if (total <= 0) { const each = Math.floor(allowanceMinutes / lines.length); const out = lines.map(() => each); out[0] += allowanceMinutes - each * lines.length; return out; }
    const out = lines.map((l) => Math.floor((allowanceMinutes * Math.max(0, l.minutes)) / total));
    out[0] += allowanceMinutes - out.reduce((s, x) => s + x, 0);
    return out;
}

function materialsOf(line: EstimateLine): { materials: QuoteMaterial[]; costPence: number } {
    const materials: QuoteMaterial[] = (line.materials ?? []).map((m) => ({
        name: m.name, qty: m.qty, unitPricePence: m.unitCostPence,
        supplier: (m.source === 'catalog' ? 'catalog' : m.source === 'screwfix' ? 'screwfix' : 'manual') as QuoteMaterial['supplier'],
        ...(m.catalogId ? { catalogId: m.catalogId } : {}),
        ...(m.supplierUrl ? { supplierUrl: m.supplierUrl } : {}),
        ...(m.supplierItemNumber ? { supplierItemNumber: m.supplierItemNumber } : {}),
    } as QuoteMaterial));
    const costPence = materials.reduce((s, m) => s + Math.round(m.unitPricePence * m.qty), 0);
    return { materials, costPence };
}

/**
 * Pure (P12): the labour band a minutes range implies. Labour scales with time at the rate the
 * point price paid per minute; a range with no spread (or no point minutes) gives a flat band.
 * Never narrower than the point labour on either side.
 */
export function labourBandFromMinutes(input: { labourPence: number; minutes: number; minutesLow: number; minutesHigh: number }): { low: number; high: number } {
    const { labourPence, minutes } = input;
    if (!(minutes > 0) || !(labourPence > 0)) return { low: labourPence, high: labourPence };
    const lowMin = Math.min(Math.max(1, input.minutesLow || minutes), minutes);
    const highMin = Math.max(input.minutesHigh || minutes, minutes);
    return {
        low: Math.min(labourPence, Math.round((labourPence * lowMin) / minutes)),
        high: Math.max(labourPence, Math.round((labourPence * highMin) / minutes)),
    };
}

/** A line the engine cannot be trusted with: no measurement at all. */
export function isFallbackLine(line: EstimateLine): boolean {
    return line.timeSource === 'fallback' || !(line.minutesPoint > 0);
}

/** P8-fix: the reasoning a fallback estimate carries when the estimator itself failed (route-a.ts). */
export const ESTIMATOR_FAILED_PREFIX = 'estimator failed: ';

function fallbackReason(line: EstimateLine): string {
    if (line.reasoning?.startsWith(ESTIMATOR_FAILED_PREFIX)) return `${line.reasoning}; priced at the ${line.category} reference rate for ${line.minutesPoint > 0 ? line.minutesPoint : FALLBACK_MINUTES} min — check this`;
    if (!(line.minutesPoint > 0)) return `no time estimate for "${line.title}": priced at the ${line.category} reference rate for ${FALLBACK_MINUTES} min — check this`;
    return `${line.title}: no job history and no catalogue match (${line.reasoning || 'estimator fallback'}); reference-rate price — check this`;
}

function buildRequest(lines: EstimateLine[], minutesFor: (l: EstimateLine) => number, allowances: number[], signals: ContextualSignals): MultiLineRequest {
    return {
        lines: lines.map((l, i) => {
            const { materials, costPence } = materialsOf(l);
            return {
                id: l.lineId, description: l.title, category: toJobCategory(l.category),
                timeEstimateMinutes: Math.max(1, Math.round(minutesFor(l) + allowances[i])),
                ...(materials.length ? { materials, materialsCostPence: costPence } : {}),
                source: 'custom' as const,
            } as MultiLineRequest['lines'][number];
        }),
        signals,
    };
}

/**
 * Price an estimate. Three engine runs (point, low, high) over the estimable lines; fallback
 * lines are priced from the reference rate and flagged. Never calls pricing-config.ts.
 */
export async function priceEstimate(estimate: QuoteEstimate, settings: PricingSettings, deps: PriceEstimateDeps): Promise<PricingSuggestions> {
    const now = (deps.now ?? (() => new Date()))();
    const job: EstimateJob = estimate.job ?? { setupMinutes: DEFAULT_SETUP_MIN, cleanupMinutes: DEFAULT_CLEANUP_MIN, accessNotes: [] };
    const setup = job.setupMinutes ?? DEFAULT_SETUP_MIN;
    const cleanup = job.cleanupMinutes ?? DEFAULT_CLEANUP_MIN;
    const marginPct = settings.materialsMarginPercent;
    const signals: ContextualSignals = {
        urgency: 'standard', timeOfService: 'standard', isReturningCustomer: false, previousJobCount: 0, previousAvgPricePence: 0,
        materialsSupply: estimate.lines.some((l) => l.materials?.length) ? 'we_supply' : 'labor_only',
        ...(deps.signals ?? {}),
    };

    const engineLines = estimate.lines.filter((l) => !isFallbackLine(l));
    const fallbackLines = estimate.lines.filter(isFallbackLine);
    // ONE setup + ONE cleanup per job, shared across the lines that are priced by time.
    const allowances = allocateAllowance(engineLines.map((l) => ({ minutes: l.minutesPoint })), setup + cleanup);

    const out: LineSuggestion[] = [];
    const rules: string[] = [];
    if (engineLines.length) {
        const [point, low, high] = await Promise.all([
            deps.engine(buildRequest(engineLines, (l) => l.minutesPoint, allowances, signals)),
            deps.engine(buildRequest(engineLines, (l) => Math.min(l.minutesLow || l.minutesPoint, l.minutesPoint), allowances, signals)),
            deps.engine(buildRequest(engineLines, (l) => Math.max(l.minutesHigh || l.minutesPoint, l.minutesPoint), allowances, signals)),
        ]);
        rules.push(...(point.guardrails?.adjustments ?? []).map(String));
        if (point.batchDiscount?.applied) rules.push(`batch discount ${point.batchDiscount.discountPercent}% (engine)`);
        engineLines.forEach((l, i) => {
            const li = point.lineItems.find((x) => x.lineId === l.lineId);
            const lo = low.lineItems.find((x) => x.lineId === l.lineId);
            const hi = high.lineItems.find((x) => x.lineId === l.lineId);
            if (!li) return;
            const labour = li.guardedPricePence;
            const mats = li.materialsWithMarginPence ?? 0;
            const suggested = labour + mats;
            const minutes = li.timeEstimateMinutes || (l.minutesPoint + allowances[i]);
            // P12 band fix: the engine's labour price is description-anchored (the LLM prices "8 oak
            // doors" the same at 640 and 1,120 minutes; only the time FLOOR moves with minutes), so
            // the low / high runs came back equal to the point run on Sarah's draft and the band
            // collapsed to the suggestion. The band must reflect the minutes range, so the labour is
            // scaled by the range (materials do not vary with time) and the engine runs only widen it.
            const scaled = labourBandFromMinutes({ labourPence: labour, minutes, minutesLow: l.minutesLow + allowances[i], minutesHigh: l.minutesHigh + allowances[i] });
            const bandLow = Math.min(suggested, scaled.low + mats, (lo?.guardedPricePence ?? labour) + (lo?.materialsWithMarginPence ?? mats));
            const bandHigh = Math.max(suggested, scaled.high + mats, (hi?.guardedPricePence ?? labour) + (hi?.materialsWithMarginPence ?? mats));
            const lowConf = l.confidence === 'low';
            out.push({
                lineId: l.lineId, title: l.title, category: li.category,
                suggestedPence: suggested, bandLowPence: bandLow, bandHighPence: bandHigh,
                checkThis: lowConf || l.timeSource === 'model' && !l.materials?.length && l.flags.includes('unknown_substrate'),
                reason: lowConf ? `low confidence: ${l.reasoning || 'estimator unsure'}` : null,
                basis: {
                    minutes, minutesLow: l.minutesLow, minutesHigh: l.minutesHigh, allowanceMinutes: allowances[i],
                    ratePencePerHour: minutes > 0 ? Math.round((li.referencePricePence * 60) / minutes) : 0,
                    labourPence: labour, materialsPence: li.materialsCostPence ?? 0, materialsWithMarginPence: mats, marginPct,
                    rules: (li.adjustmentFactors ?? []).map((a: any) => typeof a === 'string' ? a : `${a.factor ?? a.name ?? 'factor'}: ${a.description ?? a.adjustment ?? ''}`.trim()),
                    timeSource: l.timeSource, confidence: l.confidence,
                },
            });
        });
    }
    for (const l of fallbackLines) {
        const minutes = l.minutesPoint > 0 ? l.minutesPoint : FALLBACK_MINUTES;
        const ref = deps.reference(toJobCategory(l.category), minutes);
        const { costPence } = materialsOf(l);
        const mats = costPence > 0 ? Math.round(costPence * (1 + marginPct / 100) / 100) * 100 : 0;
        const suggested = ref.pricePence + mats;
        const lowRef = deps.reference(toJobCategory(l.category), Math.max(1, l.minutesLow || minutes)).pricePence;
        const highRef = deps.reference(toJobCategory(l.category), Math.max(minutes, l.minutesHigh || minutes)).pricePence;
        out.push({
            lineId: l.lineId, title: l.title, category: toJobCategory(l.category),
            suggestedPence: suggested, bandLowPence: Math.min(suggested, lowRef + mats), bandHighPence: Math.max(suggested, highRef + mats),
            checkThis: true, reason: fallbackReason(l),
            basis: {
                minutes, minutesLow: l.minutesLow || minutes, minutesHigh: l.minutesHigh || minutes, allowanceMinutes: 0,
                ratePencePerHour: ref.hourlyPence, labourPence: ref.pricePence, materialsPence: costPence, materialsWithMarginPence: mats, marginPct,
                rules: [`reference rate ${(ref.hourlyPence / 100).toFixed(2)}/hr, minimum ${(ref.minChargePence / 100).toFixed(2)}`],
                timeSource: 'fallback', confidence: l.confidence,
            },
        });
    }
    // Keep the estimate's line order.
    const order = new Map(estimate.lines.map((l, i) => [l.lineId, i]));
    out.sort((a, b) => (order.get(a.lineId) ?? 0) - (order.get(b.lineId) ?? 0));

    const totals = out.reduce((t, l) => ({
        labourPence: t.labourPence + l.basis.labourPence, materialsPence: t.materialsPence + l.basis.materialsPence,
        materialsWithMarginPence: t.materialsWithMarginPence + l.basis.materialsWithMarginPence,
        suggestedPence: t.suggestedPence + l.suggestedPence, bandLowPence: t.bandLowPence + l.bandLowPence, bandHighPence: t.bandHighPence + l.bandHighPence, depositPence: 0,
    }), { labourPence: 0, materialsPence: 0, materialsWithMarginPence: 0, suggestedPence: 0, bandLowPence: 0, bandHighPence: 0, depositPence: 0 });
    // P16: the one deposit rule (shared/pricing-settings.ts), so the chain's quote row, Ben's
    // screen and her quote page all quote the same number.
    totals.depositPence = depositFor(totals.suggestedPence, settings.depositPercent);
    return {
        estimateId: estimate.id, at: now.toISOString(), lines: out, totals,
        settings: { materialsMarginPercent: marginPct, depositPercent: settings.depositPercent, setupMinutes: setup, cleanupMinutes: cleanup },
        rules, engine: engineLines.length ? 'multi-line-engine' : 'reference-fallback',
    };
}

// ---------------------------------------------------------------- default deps (the real engine + reference rates)

export async function defaultPricingDeps(): Promise<PriceEstimateDeps> {
    const { generateMultiLinePrice } = await import('../contextual-pricing/multi-line-engine');
    const { getReferencePrice } = await import('../contextual-pricing/reference-rates');
    const { getPricingSettings } = await import('../pricing-settings');
    const settings = await getPricingSettings();
    return {
        engine: (request) => generateMultiLinePrice(request),
        reference: (category, minutes) => {
            const r = getReferencePrice(category, minutes, settings.referenceContingencyPercent);
            return { hourlyPence: r.hourlyRatePence, minChargePence: r.minimumChargePence, pricePence: r.calculatedReferencePence };
        },
    };
}
