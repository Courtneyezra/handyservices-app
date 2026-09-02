/**
 * P8 vitest: supersede on new scope (estimates and unsent drafts), the draft row the chain
 * writes (every customer-visible price null, suggestions in pricing_suggestions), and the
 * overall-confidence fold. Pure.
 */
import { describe, it, expect } from 'vitest';
import { selectSupersededEstimates, overallConfidence, type QuoteEstimate } from './estimate-store';
import { selectSupersededDrafts, pricedDraftRow, ROUTE_A_SOURCE_CHANNEL } from './quote-intake';
import type { PricingSuggestions } from './pricing-bridge';

describe('supersede on new scope', () => {
    it('every live estimate on the thread except the one being kept', () => {
        const rows = [
            { id: 'e1', conversationId: 'c1', supersededAt: null },
            { id: 'e2', conversationId: 'c1', supersededAt: null },
            { id: 'e3', conversationId: 'c1', supersededAt: '2026-09-01T00:00:00Z' },
            { id: 'e4', conversationId: 'c2', supersededAt: null },
        ];
        expect(selectSupersededEstimates(rows, 'c1', 'e2').map((r) => r.id)).toEqual(['e1']);
        expect(selectSupersededEstimates(rows, 'c1').map((r) => r.id)).toEqual(['e1', 'e2']);
    });
    it('unsent drafts only; a sent quote (is_draft cleared), an already-superseded one and the new draft itself are untouched', () => {
        const rows = [
            { id: 'q1', isDraft: true, supersededAt: null },
            { id: 'q2', isDraft: false, supersededAt: null },   // Ben sent it: is_draft cleared
            { id: 'q3', isDraft: null, supersededAt: null },
            { id: 'q4', isDraft: true, supersededAt: '2026-09-01T00:00:00Z' },
            { id: 'new', isDraft: true, supersededAt: null },
        ];
        expect(selectSupersededDrafts(rows, 'new').map((r) => r.id)).toEqual(['q1']);
    });
});

describe('the chain draft row', () => {
    const estimate: QuoteEstimate = {
        id: 'est_1', conversationId: 'c1', runId: 'r', draftQuoteId: null, intakeRunId: 'c', status: 'complete',
        lines: [{ lineId: 'card_1', title: 'Replace tap', category: 'plumbing_minor', minutesLow: 40, minutesHigh: 80, minutesPoint: 60, materials: [{ name: 'Tap', qty: 1, unitCostPence: 4000, source: 'screwfix' }], flags: [], confidence: 'medium', reasoning: '', timeSource: 'history' }],
        job: { setupMinutes: 15, cleanupMinutes: 15, accessNotes: [] }, confidence: 'medium', model: 'm', costPence: 1, createdAt: '2026-09-04T09:00:00.000Z', finishedAt: null, supersededAt: null,
    };
    const suggestions: PricingSuggestions = {
        estimateId: 'est_1', at: '2026-09-04T09:01:00.000Z', engine: 'multi-line-engine', rules: [],
        lines: [{ lineId: 'card_1', title: 'Replace tap', category: 'plumbing_minor', suggestedPence: 14080, bandLowPence: 12080, bandHighPence: 16080, checkThis: false, reason: null, basis: { minutes: 90, minutesLow: 40, minutesHigh: 80, allowanceMinutes: 30, ratePencePerHour: 3000, labourPence: 9000, materialsPence: 4000, materialsWithMarginPence: 5080, marginPct: 27, rules: [], timeSource: 'history', confidence: 'medium' } }],
        totals: { labourPence: 9000, materialsPence: 4000, materialsWithMarginPence: 5080, suggestedPence: 14080, bandLowPence: 12080, bandHighPence: 16080, depositPence: 4224 },
        settings: { materialsMarginPercent: 27, depositPercent: 30, setupMinutes: 15, cleanupMinutes: 15 },
    };
    const intake = { customerName: 'Sam', postcode: 'NG3 7EG', customerType: 'homeowner' as const, readiness: 'quote_ready', lines: [{ title: 'Replace tap', category: 'plumbing_minor', qty: 1, notes: null, assumptions: [] }], assumptions: ['access via side gate'], gaps: [] };
    it('keeps every customer-visible price null and carries the suggestions separately', () => {
        const row = pricedDraftRow({ intake, estimate, suggestions, phone: '+447700123456', media: [{ id: 'm1', url: 'u', mimeType: 'image/jpeg', kind: 'image', at: null }] });
        expect(row.isDraft).toBe(true);
        expect(row.sourceChannel).toBe(ROUTE_A_SOURCE_CHANNEL);
        expect(row.pricingLineItems[0]).toMatchObject({ lineId: 'card_1', pricePence: null, labourPence: null, materialsPence: null, category: 'plumbing_minor', timeEstimateMinutes: 60 });
        expect((row.pricingLineItems[0] as any).materials).toEqual([{ name: 'Tap', qty: 1, unitPricePence: 4000, supplier: 'screwfix' }]);
        expect(row.pricingSuggestions.lines[0].suggestedPence).toBe(14080);
        expect(row.estimateId).toBe('est_1');
        expect(row.customerPhotoUrls).toEqual(['u']);   // all media ticked by default
        expect(row.customerName).toBe('Sam'); expect(row.postcode).toBe('NG3 7EG');
        expect(row.quoteAssumptions).toEqual(['access via side gate']);
        expect(JSON.stringify(row.pricingLineItems)).not.toMatch(/14080/);
    });
    it('overallConfidence is the weakest line', () => {
        expect(overallConfidence([{ ...estimate.lines[0], confidence: 'high' }, { ...estimate.lines[0], confidence: 'low' }])).toBe('low');
        expect(overallConfidence([])).toBeNull();
    });
});

// ---------------------------------------------------------------- P8-fix: single flight

import { canClaim, IN_FLIGHT_MINUTES } from './estimate-store';

describe('canClaim (one estimator per intake run)', () => {
    const now = new Date('2026-09-04T09:00:00Z');
    it('refuses when a live estimate already exists for the intake, whatever its status', () => {
        for (const status of ['running', 'complete', 'failed']) {
            const v = canClaim({ intakeRunId: 'run_c', liveForIntake: { id: 'e1', status }, runningForConversation: [], now });
            expect(v).toMatchObject({ claimed: false, existingId: 'e1' });
            expect((v as any).reason).toMatch(/already exists for intake run run_c/);
        }
    });
    it('refuses while another estimator is in flight on the thread; allows once it is stale', () => {
        const fresh = { id: 'e9', intakeRunId: 'run_other', createdAt: new Date(now.getTime() - 60_000) };
        expect(canClaim({ intakeRunId: 'run_c', liveForIntake: null, runningForConversation: [fresh], now })).toMatchObject({ claimed: false, existingId: 'e9' });
        const stale = { ...fresh, createdAt: new Date(now.getTime() - (IN_FLIGHT_MINUTES + 1) * 60_000) };
        expect(canClaim({ intakeRunId: 'run_c', liveForIntake: null, runningForConversation: [stale], now })).toEqual({ ok: true });
    });
    it('allows a fresh intake with nothing in flight', () => {
        expect(canClaim({ intakeRunId: 'run_c', liveForIntake: null, runningForConversation: [], now })).toEqual({ ok: true });
    });
});
