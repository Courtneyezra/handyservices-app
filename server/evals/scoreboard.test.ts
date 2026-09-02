import { describe, it, expect } from 'vitest';
import { deltaFor, summarise, scoreboardMarkdown, type CaseOutcome, type EvalRunV2 } from './scoreboard';

const co = (id: string, passK: boolean | null, extra: Partial<CaseOutcome> = {}): CaseOutcome => ({
    id, family: 'guards', kind: 'regression', adapter: 'replay',
    trials: passK === null ? [{ trial: 1, pass: false, graders: [], skipped: 'no candidate' }] : [1, 2, 3].map((t) => ({ trial: t, pass: passK, graders: passK ? [] : [{ grader: 'must-flag', pass: false }] })),
    passK, passAny: passK, ...extra,
});
const run = (cases: CaseOutcome[], id = 'r1'): EvalRunV2 => ({ runId: id, startedAt: 't', finishedAt: 't', gitRef: 'abc', trialsRequested: 3, adapters: ['replay'], cases });

describe('deltaFor', () => {
    it('classifies every transition', () => {
        expect(deltaFor(co('a', true), undefined)).toBe('new');
        expect(deltaFor(co('a', true), co('a', true))).toBe('same');
        expect(deltaFor(co('a', true), co('a', false))).toBe('fixed');
        expect(deltaFor(co('a', false), co('a', true))).toBe('regressed');
        expect(deltaFor(co('a', null), co('a', true))).toBe('skipped');
        expect(deltaFor(co('a', true), co('a', null))).toBe('unskipped');
        expect(deltaFor(co('a', null), co('a', null))).toBe('skipped');
    });
    it('capability cases use pass@k as the headline', () => {
        const cap = co('c', false, { kind: 'capability', passAny: true });
        expect(deltaFor(cap, co('c', false, { kind: 'capability', passAny: false }))).toBe('fixed');
    });
});

describe('summarise', () => {
    it('counts green / red / skipped overall and per family', () => {
        const s = summarise([co('a', true), co('b', false), co('c', null), co('d', true, { family: 'absence' })]);
        expect(s).toMatchObject({ total: 4, green: 2, red: 1, skipped: 1 });
        expect(s.byFamily.guards).toEqual({ total: 3, green: 1, red: 1, skipped: 1 });
        expect(s.byFamily.absence).toEqual({ total: 1, green: 1, red: 0, skipped: 0 });
    });
});

describe('scoreboardMarkdown', () => {
    it('shows deltas against the previous run and puts red cases first', () => {
        const prev = run([co('a', true), co('b', true)], 'r0');
        const md = scoreboardMarkdown(run([co('a', true), co('b', false), co('z', true)]), prev);
        expect(md).toContain('Compared against `r0`');
        expect(md).toContain('| b | guards | replay | ❌ pass^3 | 🔻 REGRESSED | must-flag |');
        expect(md).toContain('| a | guards | replay | ✅ pass^3 | = | — |');
        expect(md).toContain('| z | guards | replay | ✅ pass^3 | new | — |');
        expect(md.indexOf('| b |')).toBeLessThan(md.indexOf('| a |'));
        expect(md).toContain('**2 green · 1 red · 0 skipped** of 3.');
    });
    it('renders the guard false-negative block when present', () => {
        const r = run([co('a', true)]);
        r.guardFalseNegative = { shouldHold: 10, caughtByTextGuard: 1, caughtByLexiconOnly: 6, missed: 3, textGuardFalseNegativeRate: 0.9, combinedFalseNegativeRate: 0.3, missedIds: ['x', 'y', 'z'], labels: { unsafe_missed: 3 } };
        const md = scoreboardMarkdown(r, null);
        expect(md).toContain('Text-guard false-negative rate: **90%** · with lexicon pre-checks: **30%**');
        expect(md).toContain('Missed: x, y, z');
        expect(md).toContain('No previous run');
    });
});
