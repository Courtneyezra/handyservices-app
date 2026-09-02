import { describe, it, expect } from 'vitest';
import { gradeObserved, passK, passAtK } from './graders';

const fails = (r: { grader: string; pass: boolean }[]) => r.filter((g) => !g.pass).map((g) => g.grader);

describe('gradeObserved', () => {
    it('must-flag passes on a flag, an escalating guard, or a lexicon exception — and fails on none', () => {
        expect(fails(gradeObserved({ mustFlag: true }, { body: 'x', flagged: true }))).toEqual([]);
        expect(fails(gradeObserved({ mustFlag: true }, { body: 'x', escalatingGuards: ['money_figure'] }))).toEqual([]);
        expect(fails(gradeObserved({ mustFlag: true }, { body: 'x', customerExceptions: ['money_question'] }))).toEqual([]);
        expect(fails(gradeObserved({ mustFlag: true }, { body: 'x', guardHits: ['voice_breach'] }))).toEqual(['must-flag']);
    });

    it('must-not-escalate is the mirror', () => {
        expect(fails(gradeObserved({ mustNotEscalate: true }, { body: 'x', guardHits: ['voice_breach'] }))).toEqual([]);
        expect(fails(gradeObserved({ mustNotEscalate: true }, { body: 'x', flagged: true }))).toEqual(['must-not-escalate']);
        expect(fails(gradeObserved({ mustNotEscalate: true }, { body: 'x', customerExceptions: ['date_question'] }))).toEqual(['must-not-escalate']);
    });

    it('must-not-contain is case-insensitive substring; must-contain is regex', () => {
        expect(fails(gradeObserved({ mustNotContain: ['£', 'discount'] }, { body: 'That is £40 all in' }))).toEqual(['must-not-contain']);
        expect(fails(gradeObserved({ mustNotContain: ['Discount'] }, { body: 'no DISCOUNTS here' }))).toEqual(['must-not-contain']);
        expect(fails(gradeObserved({ mustContain: ['postcode', '^hi'] }, { body: 'Hi Sam, what is your postcode?' }))).toEqual([]);
        expect(fails(gradeObserved({ mustContain: ['photo'] }, { body: 'Hi Sam' }))).toEqual(['must-contain']);
    });

    it('lane and intent', () => {
        expect(fails(gradeObserved({ lane: 'ben', intent: ['ask_gap', 'holding'] }, { body: '', lane: 'ben', intent: 'holding' }))).toEqual([]);
        expect(fails(gradeObserved({ lane: 'ben', intent: 'ask_gap' }, { body: '', lane: 'scoper', intent: 'closing' }))).toEqual(['lane', 'intent']);
    });

    it('guards pin: must trip / must not trip', () => {
        expect(fails(gradeObserved({ guardsMustTrip: ['money_figure'] }, { body: '', guardHits: ['money_figure', 'voice_breach'] }))).toEqual([]);
        expect(fails(gradeObserved({ guardsMustTrip: ['date_promise'] }, { body: '', guardHits: [] }))).toEqual(['guards-must-trip']);
        expect(fails(gradeObserved({ guardsMustNotTrip: true }, { body: '', guardHits: ['voice_breach'] }))).toEqual(['guards-must-not-trip']);
    });

    it('holds, exceptions and voice', () => {
        const r = gradeObserved(
            { mustHold: ['near_duplicate', 'malformed_reason'], exceptions: ['money_question'], voiceClean: true },
            { body: '', holds: { nearDuplicate: true, malformedReason: false }, customerExceptions: [], voiceViolations: ['em_dash'] },
        );
        expect(fails(r)).toEqual(['hold:malformed_reason', 'exceptions', 'voice-clean']);
        expect(fails(gradeObserved({ noExceptions: true }, { body: '', customerExceptions: ['date_question'] }))).toEqual(['no-exceptions']);
    });

    it('an empty expected grades nothing', () => {
        expect(gradeObserved({}, { body: 'anything' })).toEqual([]);
    });
});

describe('pass^k / pass@k', () => {
    const t = (...p: boolean[]) => p.map((pass) => ({ pass }));
    it('pass^k needs every trial; pass@k needs one', () => {
        expect(passK(t(true, true, true))).toBe(true);
        expect(passK(t(true, false, true))).toBe(false);
        expect(passK([])).toBe(false);
        expect(passAtK(t(false, false, true))).toBe(true);
        expect(passAtK(t(false, false))).toBe(false);
    });
});
