import { describe, it, expect } from 'vitest';
import { selectSamples, yesterdayBoundsUk, sampleDueAt, questionIdFor, draftIdFromQuestionId, verdictFromAnswer, type SampleSignal } from './sampler';
import { ukParts } from '../working-hours';

function sends(n: number, flagged: number[] = []): Array<{ id: number; signals: SampleSignal[] }> {
    return Array.from({ length: n }, (_, i) => ({ id: i, signals: flagged.includes(i) ? ['opt_out'] : [] }));
}
/** A deterministic rng: a fixed sequence, cycling. */
function seq(values: number[]): () => number {
    let i = 0;
    return () => values[i++ % values.length];
}

describe('selectSamples', () => {
    it('picks 10% of the unflagged sends, at least 1, at most 15', () => {
        expect(selectSamples(sends(0)).length).toBe(0);
        expect(selectSamples(sends(3), { rng: seq([0.5]) }).length).toBe(1);   // ceil(0.3) = 1, min 1
        expect(selectSamples(sends(40), { rng: seq([0.5]) }).length).toBe(4);  // 10%
        expect(selectSamples(sends(400), { rng: seq([0.5]) }).length).toBe(15); // max
    });
    it('always includes every flagged send, on top of the random draw', () => {
        const picked = selectSamples(sends(50, [3, 7, 11]), { rng: seq([0.5]) });
        const ids = picked.map((p) => p.id);
        expect(ids).toEqual(expect.arrayContaining([3, 7, 11]));
        expect(picked.filter((p) => p.signals.length).length).toBe(3);
        expect(picked.filter((p) => !p.signals.length).length).toBe(5); // ceil(50 * 0.1)
    });
    it('never returns duplicates and respects a custom rate / bounds', () => {
        const picked = selectSamples(sends(20, [0]), { rate: 0.5, min: 2, max: 4, rng: seq([0.1, 0.9, 0.3]) });
        expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length);
        expect(picked.filter((p) => !p.signals.length).length).toBe(4);
    });
    it('all flagged means nothing random is added beyond them', () => {
        const picked = selectSamples(sends(2, [0, 1]), { rng: seq([0.5]) });
        expect(picked.length).toBe(2);
    });
    it('is deterministic for a given rng', () => {
        const a = selectSamples(sends(30), { rng: seq([0.2, 0.8, 0.4]) }).map((p) => p.id);
        const b = selectSamples(sends(30), { rng: seq([0.2, 0.8, 0.4]) }).map((p) => p.id);
        expect(a).toEqual(b);
    });
});

describe('yesterdayBoundsUk / sampleDueAt', () => {
    it('yesterday is the previous UK calendar day, midnight to midnight', () => {
        const now = new Date('2026-09-03T07:30:00.000Z'); // 08:30 BST Thu 3 Sep
        const b = yesterdayBoundsUk(now);
        expect(b.label).toBe('2026-09-02');
        expect(ukParts(b.start)).toMatchObject({ day: 2, hour: 0, minute: 0 });
        expect(ukParts(b.end)).toMatchObject({ day: 3, hour: 0, minute: 0 });
        expect(b.end.getTime() - b.start.getTime()).toBe(24 * 3_600_000);
    });
    it('works in winter too', () => {
        const b = yesterdayBoundsUk(new Date('2026-01-15T08:30:00.000Z'));
        expect(b.label).toBe('2026-01-14');
        expect(ukParts(b.start)).toMatchObject({ day: 14, hour: 0 });
    });
    it('the review is due the next office day at 08:00, never today', () => {
        const thu = sampleDueAt(new Date('2026-09-03T07:30:00.000Z'));
        expect(ukParts(thu)).toMatchObject({ weekday: 5, day: 4, hour: 8, minute: 0 }); // Fri
        const fri = sampleDueAt(new Date('2026-09-04T07:30:00.000Z'));
        expect(ukParts(fri)).toMatchObject({ weekday: 1, day: 7, hour: 8 }); // Mon
    });
});

describe('question ids and Ben\'s answer', () => {
    it('round-trips the draft id', () => {
        expect(draftIdFromQuestionId(questionIdFor('draft_123_abc'))).toBe('draft_123_abc');
        expect(draftIdFromQuestionId('aq_1699_xyz')).toBeNull();
    });
    it('only a clear "fine" is fine', () => {
        expect(verdictFromAnswer('fine')).toBe('sample_fine');
        expect(verdictFromAnswer(' Fine ')).toBe('sample_fine');
        expect(verdictFromAnswer('not fine')).toBe('sample_not_fine');
        expect(verdictFromAnswer('')).toBe('sample_not_fine');
        expect(verdictFromAnswer('fine-ish')).toBe('sample_not_fine');
    });
});
