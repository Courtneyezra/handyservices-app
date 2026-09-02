/**
 * getIntake precedence (P8 / C), proved on the pure resolver without a database:
 *   spine artifact > human override (only against the intake it was made on) > legacy blob.
 * Plus the one derived state: quote_ready with an estimate in flight reads as quote_pending.
 */
import { describe, it, expect } from 'vitest';
import {
    resolveIntake, overrideApplies, overrideFrom, intakeViewFrom, estimatePhase, toQuoteIntake,
    spineSourceFromRuns, legacySourceFromMetadata, type EstimateStatus, type IntakeOverride,
} from './intake';

const clerkData = (over: Record<string, unknown> = {}) => ({
    customerName: 'Gemma', postcode: 'ng5 2ab', customerType: 'homeowner', readiness: 'quote_ready',
    lines: [
        { title: 'Re-hang bathroom door', detail: 'dropped, catches frame', category: 'door_fitting', assumptions: ['hinges reusable'] },
        { title: 'Fill and repaint kitchen window sill', detail: 'soft corner', category: 'painting', assumptions: [] },
    ],
    assumptions: ['access on the day'], gaps: [], declineReason: null, excluded: [], urgency: 'med',
    ...over,
});
const legacyData = (over: Record<string, unknown> = {}) => ({
    customerName: 'Old Thread', phone: '+447700900123', postcode: 'NG1 1AA', customerType: 'landlord', readiness: 'needs_info',
    lines: [{ title: 'Fix leaking tap', detail: 'kitchen', assumptions: [] }],
    assumptions: [], gaps: [{ question: 'Which tap?', audience: 'customer', lineIndex: 1, impact: 'small' }],
    declineReason: null, excluded: [], urgency: 'low',
    ...over,
});
const spine = (over: Partial<{ runId: string; data: unknown }> = {}) => ({ runId: 'run_spine_1', at: '2026-09-03T10:00:00Z', summary: '2 line(s), readiness quote_ready, 0 gap(s)', data: clerkData(), ...over });
const legacy = (over: Record<string, unknown> = {}) => ({ at: '2026-09-01T08:00:00Z', data: legacyData(over) });
const override = (over: Partial<IntakeOverride> = {}): IntakeOverride => ({ readiness: 'visit_first', runId: 'run_spine_1', from: 'quote_ready', by: 'ben@handy', at: '2026-09-03T10:30:00Z', reason: 'I know this job', ...over });
const running: EstimateStatus = { id: 'est_1', status: 'running', phase: 'running', createdAt: null, draftQuoteId: null, draftSlug: null };
const done: EstimateStatus = { id: 'est_1', status: 'priced', phase: 'done', createdAt: null, draftQuoteId: 'quote_1', draftSlug: 'gemma-door-sill' };

describe('resolveIntake precedence', () => {
    it('spine artifact wins over a fresher-looking legacy blob', () => {
        const r = resolveIntake({ spine: spine(), legacy: legacy({ readiness: 'quote_ready' }), override: null });
        expect(r?.source).toBe('spine');
        expect(r?.runId).toBe('run_spine_1');
        expect(r?.intake.customerName).toBe('Gemma');
        expect(r?.intake.lines.map((l) => l.title)).toEqual(['Re-hang bathroom door', 'Fill and repaint kitchen window sill']);
        expect(r?.intake.lines[0].category).toBe('door_fitting');
        expect(r?.readiness).toBe('quote_ready');
        expect(r?.clerkReadiness).toBe('quote_ready');
        expect(r?.overrideApplied).toBe(false);
    });

    it('legacy blob is the fallback ONLY when there is no spine artifact', () => {
        const r = resolveIntake({ spine: null, legacy: legacy(), override: null });
        expect(r?.source).toBe('legacy');
        expect(r?.runId).toBeNull();
        expect(r?.intake.customerName).toBe('Old Thread');
        expect(r?.readiness).toBe('needs_info');
        expect(r?.intake.gaps[0].question).toBe('Which tap?');
        expect(resolveIntake({ spine: null, legacy: null, override: override() })).toBeNull();
    });

    it('a human override applies on top of the spine intake it was made against', () => {
        const r = resolveIntake({ spine: spine(), legacy: null, override: override() });
        expect(r?.readiness).toBe('visit_first');
        expect(r?.intake.readiness).toBe('visit_first');
        expect(r?.clerkReadiness).toBe('quote_ready');
        expect(r?.overrideApplied).toBe(true);
        expect(r?.override?.by).toBe('ben@handy');
    });

    it('a fresh clerk run supersedes an older override (the record survives, unapplied)', () => {
        const r = resolveIntake({ spine: spine({ runId: 'run_spine_2' }), legacy: null, override: override({ runId: 'run_spine_1' }) });
        expect(r?.readiness).toBe('quote_ready');
        expect(r?.overrideApplied).toBe(false);
        expect(r?.override).not.toBeNull();
    });

    it('an override made on a legacy blob applies to the legacy fallback and never to a spine artifact', () => {
        const legacyOverride = override({ runId: 'legacy', readiness: 'decline' });
        expect(resolveIntake({ spine: null, legacy: legacy(), override: legacyOverride })?.readiness).toBe('decline');
        expect(resolveIntake({ spine: spine(), legacy: legacy(), override: legacyOverride })?.readiness).toBe('quote_ready');
        expect(overrideApplies(legacyOverride, { source: 'spine', runId: 'run_spine_1' })).toBe(false);
        expect(overrideApplies(override({ runId: null }), { source: 'legacy', runId: null })).toBe(true);
        expect(overrideApplies(null, { source: 'spine', runId: 'run_spine_1' })).toBe(false);
    });

    it('quote_ready with an estimate in flight reads as quote_pending; done or absent reads as quote_ready', () => {
        expect(resolveIntake({ spine: spine(), legacy: null, override: null, estimate: running })?.readiness).toBe('quote_pending');
        const r = resolveIntake({ spine: spine(), legacy: null, override: null, estimate: done });
        expect(r?.readiness).toBe('quote_ready');
        expect(r?.estimate?.draftSlug).toBe('gemma-door-sill');
        // a stale legacy quote_pending with nothing running is ready
        expect(resolveIntake({ spine: null, legacy: legacy({ readiness: 'quote_pending' }), override: null })?.readiness).toBe('quote_ready');
        // an override to visit_first is not turned into pending by a running estimate
        expect(resolveIntake({ spine: spine(), legacy: null, override: override(), estimate: running })?.readiness).toBe('visit_first');
    });

    it('estimate phases follow pane A\'s status vocabulary defensively', () => {
        expect(estimatePhase('running')).toBe('running');
        expect(estimatePhase('pending')).toBe('running');
        expect(estimatePhase('priced')).toBe('done');
        expect(estimatePhase('complete')).toBe('done');
        expect(estimatePhase('failed')).toBe('failed');
        expect(estimatePhase(null)).toBe('done');
    });
});

describe('views and sources', () => {
    it('intakeViewFrom is defensive about the stored shape and upper-cases the postcode', () => {
        const v = intakeViewFrom(clerkData({ postcode: 'ng5 2ab', gaps: [{ question: 'Which door?', audience: 'customer', lineIndex: 1 }, { text: 'legacy text gap', audience: 'ben' }] }));
        expect(v?.postcode).toBe('NG5 2AB');
        expect(v?.gaps).toEqual([
            { question: 'Which door?', audience: 'customer', lineIndex: 1 },
            { question: 'legacy text gap', audience: 'ben', lineIndex: null },
        ]);
        expect(intakeViewFrom(null)).toBeNull();
        expect(intakeViewFrom({ foo: 'bar' })).toBeNull();
        expect(intakeViewFrom({ readiness: 'decline', declineReason: 'roofing_height', lines: [] })?.declineReason).toBe('roofing_height');
    });

    it('overrideFrom reads the stored record (and the older to/from spelling)', () => {
        expect(overrideFrom(null)).toBeNull();
        expect(overrideFrom({ to: 'needs_info', from: 'quote_ready', by: 'va@handy', at: '2026-09-03T10:00:00Z' })?.readiness).toBe('needs_info');
        expect(overrideFrom({ readiness: 'nonsense' })).toBeNull();
    });

    it('spineSourceFromRuns picks the newest quote_intake artifact from either proposal shape', () => {
        const runs = [
            { id: 'r_old', startedAt: '2026-09-01T10:00:00Z', finishedAt: '2026-09-01T10:01:00Z', proposal: { artifact: { kind: 'quote_intake', summary: 'old', data: clerkData({ customerName: 'Old' }) } } },
            { id: 'r_new', startedAt: '2026-09-03T10:00:00Z', finishedAt: '2026-09-03T10:01:00Z', proposal: { proposal: { artifact: { kind: 'quote_intake', summary: 'new', data: clerkData({ customerName: 'New' }) } } } },
            { id: 'r_none', startedAt: '2026-09-04T10:00:00Z', finishedAt: null, proposal: { triage: {} } },
        ];
        const s = spineSourceFromRuns(runs);
        expect(s?.runId).toBe('r_new');
        expect((s?.data as any).customerName).toBe('New');
        expect(spineSourceFromRuns([])).toBeNull();
    });

    it('legacySourceFromMetadata reads the blob and its run time; toQuoteIntake restores the clerk shape', () => {
        const src = legacySourceFromMetadata({ quotePrepIntake: legacyData(), quotePrepAuto: { lastRunAt: '2026-09-01T08:00:00Z' } });
        expect(src?.at).toBe('2026-09-01T08:00:00Z');
        expect(legacySourceFromMetadata({})).toBeNull();
        const r = resolveIntake({ spine: spine(), legacy: null, override: null })!;
        const q = toQuoteIntake(r, '+447700900999');
        expect(q.phone).toBe('+447700900999');
        expect(q.lines[0]).toEqual({ title: 'Re-hang bathroom door', detail: 'dropped, catches frame', assumptions: ['hinges reusable'] });
        expect(q.readiness).toBe('quote_ready');
        expect(JSON.stringify(q)).not.toMatch(/price|pence/i);
    });
});
