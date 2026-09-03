/**
 * P15 part 3 vitest: the "second window kit" extra on MJ's job, end to end through Route A with a
 * FAKE estimator — the estimator measures, the engine prices, and the pack line and the pay come out
 * the far end. No model, no db, no network.
 *
 * MJ, booking 2d21da09-6fc4-42b6-b036-ea013bb654c6, pack jp_55ci9dr8mtl3crnz, contractor Craig
 * (hp_aa21264a-…) — the brief's test case.
 */
import { describe, it, expect, vi } from 'vitest';
import { priceExtraLine } from './variation-route-a';
import {
    appendVariationLine, clerkLineForExtra, extraMessage, packLineForVariation, payDeltaFor,
    readBrief, validateExtra, variationLineId, variationScreen, writeBrief, type VariationRow,
} from './variation';
import { lock, newPack } from './job-pack';
import { getPack } from './packs';
import type { PriceEstimateDeps } from './pricing-bridge';
import type { QuoteEstimate } from './estimate-store';

const VARIATION_ID = 'dv_mjwindow';
const LINE_ID = variationLineId(VARIATION_ID);
const BOOKING_ID = '2d21da09-6fc4-42b6-b036-ea013bb654c6';
const CRAIG = 'hp_aa21264a-0000-0000-0000-000000000000';

/** A £30/hr reference rate with a £55 minimum — the shape route-a.test.ts uses. */
const reference: PriceEstimateDeps['reference'] = (_c, minutes) => ({ hourlyPence: 3000, minChargePence: 5500, pricePence: Math.max(5500, Math.round((3000 / 60) * minutes)) });
const settings = async () => ({ materialsMarginPercent: 27, depositPercent: 30 });

/**
 * The engine, faked: labour at £40/hr on the minutes it is handed (so the setup/cleanup allowance is
 * visible in the answer) and materials at the 27% margin. The request/result shapes are the real
 * ones — `lines` in, `lineItems` out (server/contextual-pricing/multi-line-engine.ts).
 */
function fakeEngine() {
    return vi.fn(async (request: any) => ({
        lineItems: (request.lines ?? []).map((l: any) => ({
            lineId: l.id, category: l.category ?? 'carpentry',
            guardedPricePence: Math.round((4000 / 60) * l.timeEstimateMinutes),
            materialsWithMarginPence: Math.round((l.materialsCostPence ?? 0) * 1.27),
            timeEstimateMinutes: l.timeEstimateMinutes,
        })),
        guardrails: { adjustments: [] }, batchDiscount: { applied: false },
    }));
}

/** The estimator, faked: 150 minutes and one £30 kit for the second window. Never a price. */
function fakeEstimator(over: Partial<QuoteEstimate['lines'][number]> = {}) {
    return vi.fn(async (input: any) => ({
        intent: 'propose_estimate', body: [], reasons: [], citations: [],
        artifact: {
            kind: 'quote_estimate', summary: '1 line', childRunId: null,
            data: {
                id: 'est_mj_extra', conversationId: input.caseFile.conversationId, runId: input.runId, draftQuoteId: null,
                intakeRunId: input.intakeRunId, status: 'complete',
                lines: [{
                    lineId: input.intakeLines[0].lineId, title: input.intakeLines[0].title, category: 'carpentry',
                    minutesLow: 120, minutesPoint: 150, minutesHigh: 200, minutesSource: 'model',
                    materials: [{ name: 'Window trim kit', qty: 1, unitCostPence: 3000, source: 'screwfix' }],
                    flags: [], confidence: 'medium', reasoning: 'same kit as the sill line already on the quote',
                    timeSource: 'model', assumptions: [], procedure: ['Measure', 'Fit the kit', 'Seal'], unresolved: null,
                    ...over,
                }],
                job: { setupMinutes: 15, cleanupMinutes: 15, accessNotes: [] },
                confidence: 'medium', model: 'fake', costPence: 1,
                createdAt: '2026-09-03T09:00:00.000Z', finishedAt: '2026-09-03T09:00:10.000Z', supersededAt: null,
            } as QuoteEstimate,
        },
    })) as any;
}

const deps = (over: any = {}) => ({
    estimate: fakeEstimator(), settings, pricing: { engine: fakeEngine(), reference },
    pack: async () => getPack('customer.default'), now: () => new Date('2026-09-03T09:00:00.000Z'),
    ...over,
});

const extra = { title: 'Second window kit', notes: 'Front bedroom, same as the one on the quote', photoUrls: ['https://cdn/mj-window.jpg'] };

describe('MJ · "second window kit" · the extra end to end', () => {
    it('Craig types it, the estimator measures, the engine prices, Ben gets a suggestion with a band', async () => {
        // 1. What Craig typed survives validation, and becomes a clerk-shaped line.
        const v = validateExtra({ title: extra.title, notes: extra.notes, photoUrls: extra.photoUrls });
        expect(v.ok).toBe(true);
        if (!v.ok) return;
        expect(clerkLineForExtra(VARIATION_ID, v.extra)).toMatchObject({ lineId: LINE_ID, category: null });

        // 2. Route A: the SAME estimator + engine as a first quote.
        const d = deps();
        const out = await priceExtraLine({ variationId: VARIATION_ID, lineId: LINE_ID, extra: v.extra, conversationId: 'conv_mj', phone: '+447700900123', customerName: 'MJ Adeyemi' }, d);

        expect(d.estimate).toHaveBeenCalledTimes(1);
        const sentToEstimator = (d.estimate as any).mock.calls[0][0];
        expect(sentToEstimator.intakeLines).toEqual([{ lineId: LINE_ID, title: 'Second window kit', detail: extra.notes, category: null, assumptions: [] }]);
        expect(sentToEstimator.caseFile.conversationId).toBe('conv_mj');

        expect(out.estimatorFailed).toBeNull();
        expect(out.estimateId).toBe('est_mj_extra');
        expect(out.suggestion).not.toBeNull();
        // 150 min of work + the job's 30 min setup/cleanup allowance = 180 min at £40/hr = £120 labour,
        // plus the £30 kit at 27% margin = £38.10. Every figure comes from the engine, none from a model.
        expect(out.suggestion).toMatchObject({ lineId: LINE_ID, title: 'Second window kit', category: 'carpentry', labourPence: 12000, materialsWithMarginPence: 3810, suggestedPence: 15810, minutes: 180 });
        expect(out.suggestion!.bandLowPence).toBeLessThan(out.suggestion!.suggestedPence);
        expect(out.suggestion!.bandHighPence).toBeGreaterThan(out.suggestion!.suggestedPence);
        expect(out.minutes).toBe(180);
    });

    it('Ben sees it on the one-line screen, prices it, and the customer reads one short message', async () => {
        const out = await priceExtraLine({ variationId: VARIATION_ID, lineId: LINE_ID, extra, conversationId: 'conv_mj', phone: '+447700900123', customerName: 'MJ Adeyemi' }, deps());
        const row: VariationRow = {
            id: VARIATION_ID, dispatchId: 'disp_mj', contractorId: CRAIG,
            description: extra.title, reason: extra.notes, additionalPricePence: 0, additionalTimeMins: out.minutes,
            photoUrls: extra.photoUrls, status: 'pending', createdAt: '2026-09-03T09:00:00.000Z',
            adminNotes: writeBrief(null, { quoteId: 'q_mj', bookingId: BOOKING_ID, lineId: LINE_ID, estimateId: out.estimateId, estimatorFailed: out.estimatorFailed, suggestion: out.suggestion }),
        };

        const screen = variationScreen(row, { contractorName: 'Craig Bonnick', customerFirstName: 'MJ Adeyemi', customerPhone: '+447700900123', jobTitle: 'Window sills', quoteUrl: 'https://x/quote/mj123' });
        expect(screen.stage).toBe('to_price');
        expect(screen.defaultPence).toBe(15810);
        expect(screen.bookingId).toBe(BOOKING_ID);
        expect(screen.suggestion!.checkThis).toBe(false);
        // The screen shows his words, unedited, and the photo he took.
        expect(screen.title).toBe('Second window kit');
        expect(screen.photoUrls).toEqual(extra.photoUrls);

        // Ben rounds it to £150 and sends.
        const message = extraMessage({ firstName: screen.customer.firstName, title: row.description, pricePence: 15000 });
        expect(message).toBe('Hi MJ, while we are with you today we spotted second window kit. We can do it for £150 on top of the job. Say yes and we will crack on, or leave it and nothing changes.');
    });

    it('the pack gains the line LOCKED, and Craig’s pay moves through the existing engine', async () => {
        const out = await priceExtraLine({ variationId: VARIATION_ID, lineId: LINE_ID, extra, conversationId: 'conv_mj', phone: null, customerName: 'MJ' }, deps());
        const line = packLineForVariation({ variationId: VARIATION_ID, extra, suggestion: out.suggestion, finalPence: 15000 });

        // MJ's pack was locked at dispatch. The variation path is the only way it grows.
        const packed = appendVariationLine(
            lock({ ...newPack({ quoteId: 'q_mj', conversationId: 'conv_mj' }), id: 'jp_55ci9dr8mtl3crnz' }, 'disp_mj', 'system.staff'),
            line, 'human:ben@handyservices.app', new Date('2026-09-03T10:00:00.000Z'),
        );
        expect(packed.lockedAt).not.toBeNull();
        expect(packed.lines).toHaveLength(1);
        expect(packed.lines[0]).toMatchObject({ lineId: LINE_ID, pricePence: 15000, materialsPence: 3810, labourPence: 11190, variationId: VARIATION_ID, minutesPoint: 180 });
        expect(packed.changeLog.at(-1)).toMatchObject({ field: `line:${LINE_ID}`, source: 'ben', by: 'human:ben@handyservices.app' });

        // His pay is the labour half through computeContractorPay, not a rule invented here.
        const delta = payDeltaFor({ finalPence: 15000, suggestion: out.suggestion, deliveryTier: 'core' });
        expect(delta).toBeGreaterThan(0);
        expect(delta).toBeLessThan(11190);
    });

    it('the estimator failing still gives Ben a number, from reference rates, marked check this', async () => {
        const boom = vi.fn(async () => { throw new Error('Agent "quote-estimator" hit max_tokens (16000) on turn 4.'); });
        const engine = fakeEngine();
        const out = await priceExtraLine({ variationId: VARIATION_ID, lineId: LINE_ID, extra, conversationId: 'conv_mj', phone: null, customerName: 'MJ' }, deps({ estimate: boom, pricing: { engine, reference } }));

        expect(out.estimatorFailed).toMatch(/max_tokens/);
        expect(out.estimateId).toBeNull();          // the fallback has no row of its own
        expect(engine).not.toHaveBeenCalled();      // the engine never sees a fallback line
        expect(out.suggestion).toMatchObject({ lineId: LINE_ID, checkThis: true, suggestedPence: 5500 });
        expect(out.suggestion!.reason).toMatch(/^estimator failed: .*max_tokens/);
    });

    it('an estimator that returns nothing is treated the same way', async () => {
        const out = await priceExtraLine({ variationId: VARIATION_ID, lineId: LINE_ID, extra, conversationId: 'conv_mj', phone: null, customerName: 'MJ' }, deps({ estimate: vi.fn(async () => null) }));
        expect(out.estimatorFailed).toBe('estimator returned nothing');
        expect(out.suggestion!.checkThis).toBe(true);
    });

    it('a low-confidence estimate is marked check this, so Ben looks before he sends', async () => {
        const out = await priceExtraLine({ variationId: VARIATION_ID, lineId: LINE_ID, extra, conversationId: 'conv_mj', phone: null, customerName: 'MJ' }, deps({ estimate: fakeEstimator({ confidence: 'low' }) }));
        expect(out.suggestion!.checkThis).toBe(true);
        expect(out.suggestion!.reason).toMatch(/^low confidence/);
    });

    it('a job with no thread still gets an estimate — the extra is not lost because the dispatch has no conversation', async () => {
        const d = deps();
        const out = await priceExtraLine({ variationId: VARIATION_ID, lineId: LINE_ID, extra, conversationId: null, phone: null, customerName: null }, d);
        expect((d.estimate as any).mock.calls[0][0].caseFile.conversationId).toBe(`variation:${VARIATION_ID}`);
        expect(out.suggestion).not.toBeNull();
    });

    it('the brief round-trips through admin_notes, so no migration is needed', async () => {
        const out = await priceExtraLine({ variationId: VARIATION_ID, lineId: LINE_ID, extra, conversationId: 'conv_mj', phone: null, customerName: 'MJ' }, deps());
        const notes = writeBrief(null, { quoteId: 'q_mj', bookingId: BOOKING_ID, lineId: LINE_ID, estimateId: out.estimateId, suggestion: out.suggestion });
        expect(readBrief(notes).suggestion).toEqual(out.suggestion);
        expect(readBrief(notes).bookingId).toBe(BOOKING_ID);
    });
});
