/**
 * P8 vitest: the pricing bridge with a fake engine. Band = engine at low / high; ONE setup + ONE
 * cleanup per job allocated across lines; materials margin from SETTINGS (27 vs 35, never a
 * constant); fallback lines priced from the reference rate with check_this. No model, no db.
 */
import { describe, it, expect, vi } from 'vitest';
import { depositFor } from '@shared/pricing-settings';
import { priceEstimate, allocateAllowance, toJobCategory, isFallbackLine, labourBandFromMinutes, FALLBACK_MINUTES, type PriceEstimateDeps } from './pricing-bridge';
import type { QuoteEstimate, EstimateLine } from './estimate-store';
import type { MultiLineRequest, MultiLineResult } from '@shared/contextual-pricing-types';
import { DEFAULT_PRICING_SETTINGS } from '@shared/pricing-settings';

const line = (over: Partial<EstimateLine> = {}): EstimateLine => ({
    lineId: 'card_1', title: 'Replace kitchen mixer tap', category: 'plumbing_minor', minutesLow: 40, minutesHigh: 80, minutesPoint: 60,
    materials: [{ name: 'Mixer tap', qty: 1, unitCostPence: 4000, source: 'screwfix' }], flags: [], confidence: 'medium', reasoning: '5 similar jobs', timeSource: 'history', ...over,
});
const estimate = (lines: EstimateLine[], job = { setupMinutes: 15, cleanupMinutes: 15, accessNotes: [] }): QuoteEstimate => ({
    id: 'est_1', conversationId: 'c1', runId: 'run_e', draftQuoteId: null, intakeRunId: 'run_c', status: 'complete', lines, job,
    confidence: 'medium', model: 'm', costPence: 3, createdAt: '2026-09-04T09:00:00.000Z', finishedAt: null, supersededAt: null,
});

/** A fake engine: £60/hr labour on the request's minutes, materials at the margin it is told. */
function fakeEngine(marginPct: number) {
    const calls: MultiLineRequest[] = [];
    const engine = vi.fn(async (req: MultiLineRequest): Promise<MultiLineResult> => {
        calls.push(req);
        const lineItems = req.lines.map((l) => {
            const labour = Math.round((6000 / 60) * l.timeEstimateMinutes);
            const mats = l.materialsCostPence ?? 0;
            return {
                lineId: l.id, description: l.description, category: l.category, timeEstimateMinutes: l.timeEstimateMinutes,
                referencePricePence: Math.round((3000 / 60) * l.timeEstimateMinutes), llmSuggestedPricePence: labour, guardedPricePence: labour,
                adjustmentFactors: [], materialsCostPence: mats, materialsWithMarginPence: Math.round(mats * (1 + marginPct / 100)),
            } as any;
        });
        return { lineItems, subtotalPence: 0, totalMaterialsWithMarginPence: 0, batchDiscount: { applied: false, discountPercent: 0 } as any, finalPricePence: 0, layerBreakdown: {} as any, reasoning: '', confidence: 'medium', contextualHeadline: '', contextualMessage: '', guardrails: { adjustments: ['Floor: raised'] } as any, messaging: {} as any };
    });
    return { engine, calls };
}
const reference: PriceEstimateDeps['reference'] = (category, minutes) => ({ hourlyPence: 3000, minChargePence: 5500, pricePence: Math.max(5500, Math.round((3000 / 60) * minutes)) });
const settings = (over: Partial<typeof DEFAULT_PRICING_SETTINGS> = {}) => ({ ...DEFAULT_PRICING_SETTINGS, ...over });

describe('priceEstimate', () => {
    it('runs the engine three times (point, low, high) and the band comes from low / high', async () => {
        const { engine, calls } = fakeEngine(27);
        const s = await priceEstimate(estimate([line()]), settings(), { engine, reference });
        expect(engine).toHaveBeenCalledTimes(3);
        const minutes = calls.map((c) => c.lines[0].timeEstimateMinutes).sort((a, b) => a - b);
        expect(minutes).toEqual([40 + 30, 60 + 30, 80 + 30]); // on-site + the job's 15 + 15 allowance
        const l = s.lines[0];
        expect(l.basis.allowanceMinutes).toBe(30);
        expect(l.suggestedPence).toBe(9000 + 5080);         // 90 min at £60/hr + £40 materials at 27%
        expect(l.bandLowPence).toBe(7000 + 5080);
        expect(l.bandHighPence).toBe(11000 + 5080);
        expect(l.checkThis).toBe(false);
        expect(s.engine).toBe('multi-line-engine');
        expect(s.rules).toContain('Floor: raised');
    });
    it('P12 band bug (Sarah, nine doors): a description-anchored engine returns the same labour at low / point / high; the band still reflects the minutes range', async () => {
        // The real engine's LLM prices "8 oak doors" the same whatever the minutes; only the time
        // floor moves, and £810 sat above the floor at every run, so bandLow = bandHigh = suggested.
        const flatEngine = vi.fn(async (req: MultiLineRequest): Promise<MultiLineResult> => ({
            lineItems: req.lines.map((l) => ({
                lineId: l.id, description: l.description, category: l.category, timeEstimateMinutes: l.timeEstimateMinutes,
                referencePricePence: 50000, llmSuggestedPricePence: 81000, guardedPricePence: 81000,
                adjustmentFactors: [], materialsCostPence: l.materialsCostPence ?? 0, materialsWithMarginPence: Math.round((l.materialsCostPence ?? 0) * 1.27),
            } as any)),
            subtotalPence: 0, totalMaterialsWithMarginPence: 0, batchDiscount: { applied: false, discountPercent: 0 } as any, finalPricePence: 0,
            layerBreakdown: {} as any, reasoning: '', confidence: 'medium', contextualHeadline: '', contextualMessage: '', guardrails: { adjustments: [] } as any, messaging: {} as any,
        }));
        const doors = line({
            lineId: 'card_1', title: '8 oak panelled doors, hung and finished', category: 'joinery', minutesLow: 640, minutesHigh: 1120, minutesPoint: 880,
            materials: [{ name: 'Oak panelled door', qty: 8, unitCostPence: 12000, source: 'screwfix' }, { name: 'Handle set', qty: 7, unitCostPence: 1800, source: 'screwfix' }],
        });
        const s = await priceEstimate(estimate([doors]), settings({ materialsMarginPercent: 27 }), { engine: flatEngine, reference });
        const l = s.lines[0];
        const mats = Math.round((8 * 12000 + 7 * 1800) * 1.27);
        expect(l.suggestedPence).toBe(81000 + mats);
        // 30 min allowance: 670 / 910 / 1150 minutes on the wire.
        expect(l.bandLowPence).toBe(Math.round((81000 * 670) / 910) + mats);
        expect(l.bandHighPence).toBe(Math.round((81000 * 1150) / 910) + mats);
        expect(l.bandLowPence).toBeLessThan(l.suggestedPence);
        expect(l.bandHighPence).toBeGreaterThan(l.suggestedPence);
        expect(s.totals.bandLowPence).toBeLessThan(s.totals.suggestedPence);
    });
    it('labourBandFromMinutes: scales with the range, flat when there is no range, never narrower than the point', () => {
        expect(labourBandFromMinutes({ labourPence: 9000, minutes: 90, minutesLow: 70, minutesHigh: 110 })).toEqual({ low: 7000, high: 11000 });
        expect(labourBandFromMinutes({ labourPence: 9000, minutes: 90, minutesLow: 90, minutesHigh: 90 })).toEqual({ low: 9000, high: 9000 });
        expect(labourBandFromMinutes({ labourPence: 9000, minutes: 90, minutesLow: 120, minutesHigh: 60 })).toEqual({ low: 9000, high: 9000 });
        expect(labourBandFromMinutes({ labourPence: 9000, minutes: 0, minutesLow: 10, minutesHigh: 20 })).toEqual({ low: 9000, high: 9000 });
    });
    it('materials margin comes from settings, never a constant', async () => {
        const a = await priceEstimate(estimate([line()]), settings({ materialsMarginPercent: 27 }), { engine: fakeEngine(27).engine, reference });
        const b = await priceEstimate(estimate([line()]), settings({ materialsMarginPercent: 35 }), { engine: fakeEngine(35).engine, reference });
        expect(a.lines[0].basis.materialsWithMarginPence).toBe(5080);
        expect(b.lines[0].basis.materialsWithMarginPence).toBe(5400);
        expect(a.settings.materialsMarginPercent).toBe(27); expect(b.settings.materialsMarginPercent).toBe(35);
        expect(a.lines[0].basis.marginPct).toBe(27); expect(b.lines[0].basis.marginPct).toBe(35);
    });
    it('setup + cleanup are ONE allowance per job, shared across lines by on-site minutes', async () => {
        const { engine, calls } = fakeEngine(27);
        await priceEstimate(estimate([line({ lineId: 'a', minutesPoint: 60, minutesLow: 60, minutesHigh: 60 }), line({ lineId: 'b', minutesPoint: 120, minutesLow: 120, minutesHigh: 120, materials: [] })]), settings(), { engine, reference });
        const point = calls[0];
        const total = point.lines.reduce((s, l) => s + l.timeEstimateMinutes, 0);
        expect(total).toBe(60 + 120 + 30);              // not 60+30 + 120+30
        expect(point.lines.map((l) => l.timeEstimateMinutes)).toEqual([70, 140]); // 10 + 20 of the 30
        expect(allocateAllowance([{ minutes: 60 }, { minutes: 120 }], 30)).toEqual([10, 20]);
        expect(allocateAllowance([{ minutes: 0 }, { minutes: 0 }], 30)).toEqual([15, 15]);
        expect(allocateAllowance([], 30)).toEqual([]);
    });
    it('a line with no measurement is priced from the reference rate with check_this and a reason; the engine never sees it', async () => {
        const { engine, calls } = fakeEngine(27);
        const s = await priceEstimate(estimate([line(), line({ lineId: 'card_2', title: 'Mystery job', minutesPoint: 0, minutesLow: 0, minutesHigh: 0, timeSource: 'fallback', materials: [], confidence: 'low' })]), settings(), { engine, reference });
        expect(calls[0].lines.map((l) => l.id)).toEqual(['card_1']);
        const fb = s.lines.find((l) => l.lineId === 'card_2')!;
        expect(fb.checkThis).toBe(true);
        expect(fb.reason).toMatch(/no time estimate.*reference rate/);
        expect(fb.suggestedPence).toBe(5500);            // minimum charge at 60 min × £30/hr = £30 → floor £55
        expect(fb.basis.timeSource).toBe('fallback');
        expect(fb.basis.minutes).toBe(FALLBACK_MINUTES);
        expect(s.lines.map((l) => l.lineId)).toEqual(['card_1', 'card_2']); // estimate order kept
        expect(isFallbackLine(line({ timeSource: 'model', minutesPoint: 0 }))).toBe(true);
    });
    it('an estimate of only fallback lines never calls the engine', async () => {
        const { engine } = fakeEngine(27);
        const s = await priceEstimate(estimate([line({ minutesPoint: 0, minutesLow: 0, minutesHigh: 0, timeSource: 'fallback' })]), settings(), { engine, reference });
        expect(engine).not.toHaveBeenCalled();
        expect(s.engine).toBe('reference-fallback');
    });
    it('low confidence flags check_this with the estimator reasoning; totals and deposit follow settings', async () => {
        const s = await priceEstimate(estimate([line({ confidence: 'low', reasoning: 'unsure of the pipework' })]), settings({ depositPercent: 30 }), { engine: fakeEngine(27).engine, reference });
        expect(s.lines[0]).toMatchObject({ checkThis: true, reason: 'low confidence: unsure of the pipework' });
        expect(s.totals.suggestedPence).toBe(14080);
        // P16: one deposit rule, rounded to the pound (14,080 × 30 % = 4,224 → £42).
        expect(s.totals.depositPence).toBe(depositFor(14080, 30));
        expect(s.totals.depositPence).toBe(4_200);
    });
    it('unknown categories map to other', () => {
        expect(toJobCategory('plumbing_minor')).toBe('plumbing_minor');
        expect(toJobCategory('made_up')).toBe('other');
        expect(toJobCategory(null)).toBe('other');
    });
});
