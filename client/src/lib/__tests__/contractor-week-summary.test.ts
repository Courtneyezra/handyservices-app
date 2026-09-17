import { describe, it, expect } from 'vitest';
import { weekSummary, flexHasOptions, weekSummaryLine, stuckLine } from '@/lib/contractor-week-summary';

const flex = (over: Partial<{ multiDay: boolean; suggestions: unknown[]; blockStarts: unknown[]; payoutPence: number }> = {}) => ({
    multiDay: false, suggestions: [{ date: '2026-09-20' }], blockStarts: [], payoutPence: 9000, ...over,
});

describe('weekSummary: counts, never a sum of pay', () => {
    it('counts booked jobs, ready flex jobs and stuck ones', () => {
        const ready = flex();
        const block = flex({ multiDay: true, suggestions: [], blockStarts: [{ startDate: '2026-09-21' }] });
        const stuck = flex({ suggestions: [] });
        const stuckBlock = flex({ multiDay: true, suggestions: [{ date: 'x' }], blockStarts: [] });
        const s = weekSummary({ booked: [{ payoutPence: 15000 }, { payoutPence: 12000 }], flex: [ready, block, stuck, stuckBlock] });
        expect(s.bookedJobs).toBe(2);
        expect(s.readyCount).toBe(2);
        expect(s.stuck).toEqual([stuck, stuckBlock]);
        expect(Object.keys(s).filter((k) => /pence/i.test(k))).toEqual([]);
    });

    it('is empty before the jobs load', () => {
        expect(weekSummary(undefined)).toEqual({ bookedJobs: 0, readyCount: 0, stuck: [] });
        expect(flexHasOptions(flex({ suggestions: [] }))).toBe(false);
    });

    it('words the summary as jobs, with no money in it', () => {
        const s = weekSummary({ booked: [{}], flex: [flex(), flex(), flex({ suggestions: [] })] });
        expect(weekSummaryLine(s)).toBe('1 job booked · 2 ready to book');
        expect(stuckLine(s)).toBe('1 job waiting — open days to take it');
        expect(weekSummaryLine(weekSummary({ booked: [], flex: [] }))).toBe('0 jobs booked');
        expect(stuckLine(weekSummary({ booked: [], flex: [] }))).toBeNull();
        expect(stuckLine(weekSummary({ booked: [], flex: [flex({ suggestions: [] }), flex({ suggestions: [] })] }))).toBe('2 jobs waiting — open days to take them');
        for (const line of [weekSummaryLine(s), stuckLine(s)]) expect(line).not.toMatch(/£/);
    });
});
