/**
 * B7a vitest: the `precondition` grader and the eval-context media mapping, both pure.
 */
import { describe, it, expect } from 'vitest';
import { gradeObserved } from './graders';
import { caseFileFromContext } from './case-file-from-context';

const only = (r: { grader: string; pass: boolean; note?: string }[]) => r.find((g) => g.grader === 'precondition')!;

describe('precondition grader', () => {
    it('null means "may send": passes only when decide said send', () => {
        expect(only(gradeObserved({ precondition: null }, { body: null, precondition: null })).pass).toBe(true);
        expect(only(gradeObserved({ precondition: null }, { body: null, precondition: 'ask_gap:quote_on_case' })).pass).toBe(false);
        expect(only(gradeObserved({ precondition: null }, { body: null, precondition: undefined, decision: 'flag: money' })).pass).toBe(false);
    });
    it('a code passes only on that exact code', () => {
        expect(only(gradeObserved({ precondition: 'ask_gap:quote_on_case' }, { body: null, precondition: 'ask_gap:quote_on_case' })).pass).toBe(true);
        expect(only(gradeObserved({ precondition: 'ask_gap:quote_on_case' }, { body: null, precondition: 'ask_gap:date_asked' })).pass).toBe(false);
        expect(only(gradeObserved({ precondition: 'ask_gap:quote_on_case' }, { body: null, precondition: null })).pass).toBe(false);
    });
    it('a run that never reached the tier step fails with the decision in the note', () => {
        const g = only(gradeObserved({ precondition: 'ask_gap:quote_on_case' }, { body: null, decision: 'flag: money lexicon' }));
        expect(g.pass).toBe(false);
        expect(g.note).toMatch(/not reached \(flag: money lexicon\)/);
    });
    it('is not graded when the case does not ask for it', () => {
        expect(gradeObserved({ mustFlag: true }, { body: null, flagged: true, precondition: null }).find((g) => g.grader === 'precondition')).toBeUndefined();
    });
});

describe('caseFileFromContext media', () => {
    it('context.media becomes media items and mediaIds on that inbound', () => {
        const cf = caseFileFromContext({ id: 'x', family: 'f', expected: {}, context: [
            { direction: 'outbound', body: 'What needs doing?' },
            { direction: 'inbound', body: 'here you go', media: ['image', 'video'] },
        ] });
        expect(cf.media.map((m) => m.kind)).toEqual(['image', 'video']);
        expect(cf.timeline[1].mediaIds).toEqual(cf.media.map((m) => m.id));
        expect(cf.timeline[0].mediaIds).toBeUndefined();
    });
    it('no media field: no media, exactly as before', () => {
        const cf = caseFileFromContext({ id: 'y', family: 'f', expected: {}, context: [{ direction: 'inbound', body: '[photo]' }] });
        expect(cf.media).toEqual([]);
        expect(cf.timeline[0].mediaIds).toBeUndefined();
    });
});
