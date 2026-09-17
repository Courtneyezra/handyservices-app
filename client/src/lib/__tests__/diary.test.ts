/**
 * B6 - the diary's date labels and month arithmetic, which the page's range navigation stands on.
 */
import { describe, expect, it } from 'vitest';
import { addMonths, londonToday, monthOf, monthStart, weekLabel, weeksInMonth } from '@/lib/diary';

describe('diary dates', () => {
    it('labels a week by its Monday to Friday, across a month and a year', () => {
        expect(weekLabel('2026-09-21')).toBe('21–25 Sep 2026');
        expect(weekLabel('2026-09-28')).toBe('28 Sep – 2 Oct 2026');
        expect(weekLabel('2026-12-28')).toBe('28 Dec 2026 – 1 Jan 2027');
        expect(weekLabel('2027-12-27')).toBe('27–31 Dec 2027');
        expect(weekLabel('2025-12-29')).toBe('29 Dec 2025 – 2 Jan 2026');
    });

    it('steps months across a year and counts the Monday-first weeks each spans', () => {
        expect(addMonths('2026-12-01', 1)).toBe('2027-01-01');
        expect(addMonths('2026-01-01', -1)).toBe('2025-12-01');
        expect(monthOf('2026-09-22')).toBe('2026-09-01');
        // Tue 1 Sep: from Mon 31 Aug. Sun 1 Feb and Sat 1 Aug: from the Monday after, skipping a week of the month before.
        expect(monthStart('2026-09-01')).toBe('2026-08-31');
        expect(monthStart('2026-02-01')).toBe('2026-02-02');
        expect(monthStart('2026-08-01')).toBe('2026-08-03');
        expect(weeksInMonth('2026-09-01')).toBe(5);
        expect(weeksInMonth('2026-02-01')).toBe(4);
        expect(weeksInMonth('2027-02-01')).toBe(4);
        expect(weeksInMonth('2026-08-01')).toBe(5);
    });

    it("reads today in London", () => {
        expect(londonToday(new Date('2026-09-21T23:30:00.000Z'))).toBe('2026-09-22');
    });
});
