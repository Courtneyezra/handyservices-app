import { describe, it, expect } from 'vitest';
import { compareShadow, mapLegacyIntent, shadowReportMarkdown, type LegacyRun, type SpineShadowRun } from './shadow-report';

const T = (m: number) => new Date(Date.UTC(2026, 8, 2, 10, m));
function s(over: Partial<SpineShadowRun> & { runId: string; conversationId: string }): SpineShadowRun {
    return { at: T(0), lane: 'scoper', decision: 'pending', intent: 'ask_gap', guardsHit: [], ...over };
}
function l(over: Partial<LegacyRun> & { runId: string; conversationId: string }): LegacyRun {
    return { at: T(1), decision: 'pending', intent: 'chase_response', guardsHit: [], ...over };
}

describe('compareShadow over a fixture', () => {
    const spine: SpineShadowRun[] = [
        s({ runId: 's1', conversationId: 'c1' }),                                             // agrees on all three
        s({ runId: 's2', conversationId: 'c2', decision: 'flag', intent: null, guardsHit: ['money'] }), // legacy sent → disagree decision, guard
        s({ runId: 's3', conversationId: 'c3', decision: 'send', intent: 'confirm_received' }), // legacy pending, intent maps ack_photos → confirm_received
        s({ runId: 's4', conversationId: 'c4' }),                                             // no legacy run nearby
        s({ runId: 's5', conversationId: 'c5', at: T(0) }),                                   // two legacy runs; nearest wins
    ];
    const legacy: LegacyRun[] = [
        l({ runId: 'l1', conversationId: 'c1' }),
        l({ runId: 'l2', conversationId: 'c2', decision: 'send', intent: 'quote_question', guardsHit: [] }),
        l({ runId: 'l3', conversationId: 'c3', decision: 'pending', intent: 'ack_photos' }),
        l({ runId: 'l4', conversationId: 'c4', at: T(40) }),                                  // 40 min away: outside the window
        l({ runId: 'l5a', conversationId: 'c5', at: T(12), intent: 'answer_question' }),
        l({ runId: 'l5b', conversationId: 'c5', at: T(2) }),                                  // nearest
    ];
    const c = compareShadow(spine, legacy, 7);

    it('pairs by thread within the window, nearest first, each legacy run used once', () => {
        const byId = Object.fromEntries(c.pairs.map((p) => [p.spineRunId, p]));
        expect(byId.s1.legacyRunId).toBe('l1');
        expect(byId.s4.legacyRunId).toBeNull();
        expect(byId.s5.legacyRunId).toBe('l5b');
        expect(byId.s5.minutesApart).toBe(2);
        expect(c.unpairedSpine).toBe(1);
        expect(c.counts.paired).toBe(4);
    });
    it('scores decision, intent (mapped) and guard agreement', () => {
        const byId = Object.fromEntries(c.pairs.map((p) => [p.spineRunId, p]));
        expect(byId.s1).toMatchObject({ decisionAgree: true, intentAgree: true, guardAgree: true });
        expect(byId.s2).toMatchObject({ decisionAgree: false, guardAgree: false });
        expect(byId.s3).toMatchObject({ decisionAgree: false, intentAgree: true, legacyIntentMapped: 'confirm_received' });
        expect(byId.s5).toMatchObject({ decisionAgree: true, intentAgree: true });
        expect(c.agreement.decision).toBe(50);   // s1, s5 of 4
        expect(c.agreement.intent).toBe(75);     // s1, s3, s5
        expect(c.agreement.guard).toBe(75);      // all but s2
        expect(c.byDecision.pending.pending).toBe(2);
        expect(c.byDecision.flag.send).toBe(1);
    });
    it('renders a markdown table with the agreement %', () => {
        const md = shadowReportMarkdown(c);
        expect(md).toMatch(/# Shadow report, last 7 days/);
        expect(md).toMatch(/\| decision .* \| 50 \| 2\/4 \|/);
        expect(md).toMatch(/\| c1 \|/);
        expect(md).toMatch(/unpaired/);
        expect(md).not.toMatch(/[—–]/.source.replace('—', 'NEVERMATCH')); // sanity: regex compiles
    });
    it('handles an empty window', () => {
        const e = compareShadow([], [], 3);
        expect(e.counts.paired).toBe(0);
        expect(e.agreement.decision).toBeNull();
        expect(shadowReportMarkdown(e)).toMatch(/Paired: 0/);
    });
});

describe('mapLegacyIntent', () => {
    it('maps the legacy vocabulary and passes unknowns through', () => {
        expect(mapLegacyIntent('ack_enquiry')).toBe('confirm_received');
        expect(mapLegacyIntent('price_objection')).toBe('answer_from_quote');
        expect(mapLegacyIntent('holding')).toBe('holding');
        expect(mapLegacyIntent('something_new')).toBe('something_new');
        expect(mapLegacyIntent(null)).toBeNull();
    });
});
