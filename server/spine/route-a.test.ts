/**
 * P8-fix vitest: Route A with fakes — the estimator failing still produces a draft priced from
 * reference rates (every line check_this, reason "estimator failed: …", the Pushover says so);
 * a refused claim (another run holds the intake) produces nothing; the happy path is unchanged.
 * No model, no db.
 */
import { describe, it, expect, vi } from 'vitest';
import { runRouteAChain, fallbackEstimate } from './route-a';
import { EstimateClaimRefused } from './agents/estimator';
import { getPack } from './packs';
import type { CaseFile, TriageResult, Proposal } from './types';
import type { PriceEstimateDeps } from './pricing-bridge';

const cf = (): CaseFile => ({ conversationId: 'c1', phone: '+447700123456', audience: 'customer', stage: 'scoping', contactName: 'Gemma', timeline: [], media: [], window: { canFreeform: true, templateRequired: false, lastInboundAt: null, channelLastUsed: 'whatsapp' }, client: null, quote: null, openPromises: [], openFlags: [], tags: [], lastRun: null, hash: 'h', builtAt: '2026-09-02T17:18:00.000Z' });
const tri = (): TriageResult => ({ audience: 'customer', intent: 'unknown', lane: 'quote_clerk', exceptions: [], stage: 'scoping', tags: [], reasons: [], source: 'rules' });
const artifact: NonNullable<Proposal['artifact']> = {
    kind: 'quote_intake', summary: '2 lines', childRunId: null,
    data: { customerName: 'Gemma', postcode: 'NG2 5AB', customerType: 'homeowner', readiness: 'quote_ready', lines: [{ title: 'Replace window sill', detail: 'upstairs', category: 'carpentry', assumptions: [] }, { title: 'Repaint sill', category: 'painting', assumptions: [] }], assumptions: [], gaps: [] },
};
const reference: PriceEstimateDeps['reference'] = (_c, minutes) => ({ hourlyPence: 3000, minChargePence: 5500, pricePence: Math.max(5500, Math.round((3000 / 60) * minutes)) });
const settings = async () => ({ materialsMarginPercent: 27, depositPercent: 30, surveyFeePence: 4900 });

function deps(over: Partial<Parameters<typeof runRouteAChain>[1]> = {}) {
    const notify = vi.fn(async () => undefined);
    const log = vi.fn(async () => undefined);
    const createDraft = vi.fn(async (i: any) => ({ ok: true as const, id: 'quote_1', slug: 'abc12345', superseded: [] as string[], _in: i }));
    const engine = vi.fn(async () => { throw new Error('the engine must not see fallback lines'); });
    return { notify, log, createDraft, supersede: vi.fn(async () => []), settings, pricing: { engine, reference }, ...over };
}

describe('runRouteAChain — failure still produces the draft (P8-fix)', () => {
    it('estimator max_tokens after the retry → draft from reference rates, every line check_this, reason names the error, Pushover says estimator failed', async () => {
        const boom: any = new Error('Agent "quote-estimator" hit max_tokens (16000) on turn 4 and produced no usable action.');
        boom.estimateId = 'est_failed';
        const d = deps({ estimate: vi.fn(async () => { throw boom; }) });
        const out = await runRouteAChain({ caseFile: cf(), pack: getPack('customer.default'), triage: tri(), clerkRunId: 'run_c', artifact }, d);
        expect(out).toMatchObject({ ran: true, fallback: true, draftSlug: 'abc12345', estimateId: 'est_failed', checkThis: 2 });
        expect(out.reason).toMatch(/^estimator failed: Agent "quote-estimator" hit max_tokens/);
        const draftInput = (d.createDraft as any).mock.calls[0][0];
        expect(draftInput.estimate.status).toBe('failed');
        expect(draftInput.estimate.lines.every((l: any) => l.timeSource === 'fallback')).toBe(true);
        expect(draftInput.suggestions.engine).toBe('reference-fallback');
        expect(draftInput.suggestions.lines).toHaveLength(2);
        for (const l of draftInput.suggestions.lines) {
            expect(l.checkThis).toBe(true);
            expect(l.reason).toMatch(/^estimator failed: .*max_tokens.*reference rate for 60 min — check this$/);
            expect(l.suggestedPence).toBe(5500); // £30/hr × 60 min = £30, floored at the £55 minimum
        }
        expect((d.pricing as any).engine).not.toHaveBeenCalled();
        expect((d.notify as any).mock.calls[0][0]).toMatchObject({ slug: 'abc12345', checkThis: 2, estimatorFailed: expect.stringMatching(/max_tokens/), customerName: 'Gemma' });
        expect((d.log as any).mock.calls[0][0].summary).toMatch(/reference rates \(estimator failed\)/);
    });
    it('an estimator that returns nothing is treated the same way', async () => {
        const d = deps({ estimate: vi.fn(async () => null) });
        const out = await runRouteAChain({ caseFile: cf(), pack: getPack('customer.default'), triage: tri(), clerkRunId: 'run_c', artifact }, d);
        expect(out).toMatchObject({ ran: true, fallback: true, reason: 'estimator failed: estimator returned nothing' });
        expect(out.estimateId).toBe('est_fallback_run_c');
        expect(d.createDraft).toHaveBeenCalledTimes(1);
    });
    it('a refused claim (another run holds this intake) creates nothing and says why', async () => {
        const d = deps({ estimate: vi.fn(async () => { throw new EstimateClaimRefused('estimate est_1 (running) already exists for intake run run_c', 'est_1'); }) });
        const out = await runRouteAChain({ caseFile: cf(), pack: getPack('customer.default'), triage: tri(), clerkRunId: 'run_c', artifact }, d);
        expect(out).toMatchObject({ ran: false, reason: expect.stringMatching(/estimator not started: estimate est_1 \(running\) already exists/) });
        expect(d.createDraft).not.toHaveBeenCalled();
        expect(d.notify).not.toHaveBeenCalled();
    });
    it('the happy path is unchanged: the estimate prices through the engine and the alert carries no failure', async () => {
        const estimate = { id: 'est_ok', conversationId: 'c1', runId: 'r', draftQuoteId: null, intakeRunId: 'run_c', status: 'complete', lines: [{ lineId: 'card_1', title: 'Replace window sill', category: 'carpentry', minutesLow: 60, minutesHigh: 120, minutesPoint: 90, materials: [], flags: [], confidence: 'high', reasoning: 'history', timeSource: 'history' }, { lineId: 'card_2', title: 'Repaint sill', category: 'painting', minutesLow: 30, minutesHigh: 60, minutesPoint: 45, materials: [], flags: [], confidence: 'medium', reasoning: 'model', timeSource: 'model' }], job: { setupMinutes: 15, cleanupMinutes: 15, accessNotes: [] }, confidence: 'medium', model: 'm', costPence: 2, createdAt: 'x', finishedAt: 'y', supersededAt: null };
        const engine = vi.fn(async (req: any) => ({ lineItems: req.lines.map((l: any) => ({ lineId: l.id, category: l.category, timeEstimateMinutes: l.timeEstimateMinutes, referencePricePence: 5000, guardedPricePence: 100 * l.timeEstimateMinutes, materialsCostPence: 0, materialsWithMarginPence: 0, adjustmentFactors: [] })), guardrails: { adjustments: [] }, batchDiscount: { applied: false, discountPercent: 0 } }));
        const d = deps({ estimate: vi.fn(async () => ({ intent: 'propose_estimate', body: [], reasons: [], artifact: { kind: 'quote_estimate', summary: 's', data: estimate, childRunId: null } }) as Proposal), pricing: { engine, reference } });
        const out = await runRouteAChain({ caseFile: cf(), pack: getPack('customer.default'), triage: tri(), clerkRunId: 'run_c', artifact }, d);
        expect(out).toMatchObject({ ran: true, estimateId: 'est_ok', draftSlug: 'abc12345', checkThis: 0 });
        expect(out.fallback).toBeUndefined();
        expect(engine).toHaveBeenCalledTimes(3);
        expect((d.notify as any).mock.calls[0][0].estimatorFailed).toBeNull();
    });
    it('fallbackEstimate is pure and never carries a price', () => {
        const e = fallbackEstimate({ conversationId: 'c1', intakeRunId: 'run_c', runId: 'r', intakeLines: [{ lineId: 'card_1', title: 'X', category: 'other' }], error: 'timed out', id: null, now: new Date('2026-09-04T00:00:00Z') });
        expect(e).toMatchObject({ id: 'est_fallback_run_c', status: 'failed', error: 'timed out', confidence: 'low' });
        expect(e.lines[0]).toMatchObject({ timeSource: 'fallback', minutesPoint: 0, reasoning: 'estimator failed: timed out', materials: [] });
        expect(JSON.stringify(e)).not.toMatch(/"(price|suggested|labour|band)[A-Za-z]*Pence"/); expect(e.costPence).toBeNull();
    });
});
