import { describe, it, expect } from 'vitest';
import {
    OFFICE_HOURS, BEN_HOURS, ukParts, ukHour, isOutOfHours, isWithinClock, nextWorkingSlot,
    addWorkingMinutes, addWorkingHours, workingHoursBetween, dueAtFor, formatUk,
} from './working-hours';

/** Build an instant from UK wall-clock parts (BST in summer, GMT in winter). */
function uk(iso: string, offset: '+01:00' | '+00:00' = '+01:00'): Date {
    return new Date(`${iso}${offset}`);
}
function ukString(d: Date): string {
    const p = ukParts(d);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.weekday]} ${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

describe('ukParts / ukHour', () => {
    it('reads the London wall clock, not UTC', () => {
        expect(ukHour(new Date('2026-09-02T12:00:00.000Z'))).toBe(13); // BST
        expect(ukHour(new Date('2026-01-15T12:00:00.000Z'))).toBe(12); // GMT
        expect(ukParts(new Date('2026-09-04T23:30:00.000Z'))).toMatchObject({ weekday: 6, day: 5, hour: 0, minute: 30 }); // Sat 00:30 BST
    });
    it('isOutOfHours keeps the daily 08–20 boundary', () => {
        expect(isOutOfHours(7)).toBe(true);
        expect(isOutOfHours(8)).toBe(false);
        expect(isOutOfHours(19)).toBe(false);
        expect(isOutOfHours(20)).toBe(true);
    });
    it('isWithinClock: weekend is off the office clock but on Ben\'s', () => {
        const sat = uk('2026-09-05T10:00:00');
        expect(isWithinClock(sat, OFFICE_HOURS)).toBe(false);
        expect(isWithinClock(sat, BEN_HOURS)).toBe(true);
    });
});

describe('nextWorkingSlot', () => {
    it('returns the instant unchanged inside office hours', () => {
        const d = uk('2026-09-02T10:15:00'); // Wed
        expect(nextWorkingSlot(d).getTime()).toBe(d.getTime());
    });
    it.each([
        ['Wed 06:30 → same day 08:00', '2026-09-02T06:30:00', 'Wed 2026-09-02 08:00'],
        ['Wed 18:00 (on close) → Thu 08:00', '2026-09-02T18:00:00', 'Thu 2026-09-03 08:00'],
        ['Fri 22:00 → Mon 08:00', '2026-09-04T22:00:00', 'Mon 2026-09-07 08:00'],
        ['Sat 10:00 → Mon 08:00', '2026-09-05T10:00:00', 'Mon 2026-09-07 08:00'],
        ['Sun 03:00 → Mon 08:00', '2026-09-06T03:00:00', 'Mon 2026-09-07 08:00'],
    ])('%s', (_label, from, expected) => {
        expect(ukString(nextWorkingSlot(uk(from)))).toBe(expected);
    });
});

describe('addWorkingHours on the OFFICE clock (due_at bank)', () => {
    it.each([
        ['Wed 09:00 + 4h → Wed 13:00', '2026-09-02T09:00:00', 4, 'Wed 2026-09-02 13:00'],
        ['Wed 16:00 + 4h → Thu 10:00 (crosses close)', '2026-09-02T16:00:00', 4, 'Thu 2026-09-03 10:00'],
        ['Wed 14:00 + 4h → Thu 08:00 (lands on close, rolls)', '2026-09-02T14:00:00', 4, 'Thu 2026-09-03 08:00'],
        ['Fri 17:30 + 4h → Mon 11:30 (weekend)', '2026-09-04T17:30:00', 4, 'Mon 2026-09-07 11:30'],
        ['Fri 18:30 + 4h → Mon 12:00 (after close Friday)', '2026-09-04T18:30:00', 4, 'Mon 2026-09-07 12:00'],
        ['Sat 10:00 + 4h → Mon 12:00', '2026-09-05T10:00:00', 4, 'Mon 2026-09-07 12:00'],
        ['Sun 23:59 + 4h → Mon 12:00', '2026-09-06T23:59:00', 4, 'Mon 2026-09-07 12:00'],
        ['Tue 22:00 + 4h → Wed 12:00', '2026-09-01T22:00:00', 4, 'Wed 2026-09-02 12:00'],
        ['Mon 07:00 + 4h → Mon 12:00 (before opening)', '2026-09-07T07:00:00', 4, 'Mon 2026-09-07 12:00'],
        ['Thu 17:00 + 12h → Mon 09:00 (over a weekend, more than a day)', '2026-09-03T17:00:00', 12, 'Mon 2026-09-07 09:00'],
        ['Wed 10:00 + 0h → Wed 10:00', '2026-09-02T10:00:00', 0, 'Wed 2026-09-02 10:00'],
    ])('%s', (_label, from, hours, expected) => {
        expect(ukString(addWorkingHours(uk(from), hours))).toBe(expected);
    });

    it('is the same arithmetic in winter (GMT)', () => {
        expect(ukString(addWorkingHours(uk('2026-01-16T17:30:00', '+00:00'), 4))).toBe('Mon 2026-01-19 11:30'); // Fri → Mon
        expect(ukString(addWorkingHours(uk('2026-01-14T16:00:00', '+00:00'), 4))).toBe('Thu 2026-01-15 10:00');
    });

    it('crosses the spring DST change without losing or gaining a working hour', () => {
        // Fri 27 Mar 2026 17:00 GMT + 4h → Mon 30 Mar 2026 11:00 BST (clocks went forward on Sun 29 Mar).
        expect(ukString(addWorkingHours(uk('2026-03-27T17:00:00', '+00:00'), 4))).toBe('Mon 2026-03-30 11:00');
        // And the autumn one: Fri 23 Oct 2026 17:00 BST + 4h → Mon 26 Oct 11:00 GMT.
        expect(ukString(addWorkingHours(uk('2026-10-23T17:00:00', '+01:00'), 4))).toBe('Mon 2026-10-26 11:00');
    });
});

describe('addWorkingMinutes: the 20-minute urgent flag', () => {
    it.each([
        ['Wed 10:00 + 20m → 10:20', '2026-09-02T10:00:00', 'Wed 2026-09-02 10:20'],
        ['Fri 17:55 + 20m → Mon 08:15', '2026-09-04T17:55:00', 'Mon 2026-09-07 08:15'],
        ['Wed 17:50 + 20m → Thu 08:10', '2026-09-02T17:50:00', 'Thu 2026-09-03 08:10'],
        ['Sat 12:00 + 20m → Mon 08:20', '2026-09-05T12:00:00', 'Mon 2026-09-07 08:20'],
    ])('%s', (_label, from, expected) => {
        expect(ukString(addWorkingMinutes(uk(from), 20))).toBe(expected);
    });
});

describe('the BEN clock keeps promise-tracker semantics (daily 08–20)', () => {
    it.each([
        ['18:30 + 4h → 10:30 next day', '2026-09-02T18:30:00', 'Thu 2026-09-03 10:30'],
        ['Fri 19:00 + 4h → Sat 11:00 (weekends count)', '2026-09-04T19:00:00', 'Sat 2026-09-05 11:00'],
        ['22:30 + 15min → 08:15 next day', '2026-09-02T22:30:00', 'Thu 2026-09-03 08:15'],
        ['landing exactly on 20:00 rolls to 08:00', '2026-09-02T16:00:00', 'Thu 2026-09-03 08:00'],
    ])('%s', (_label, from, expected) => {
        const minutes = _label.includes('15min') ? 15 : 240;
        expect(ukString(addWorkingMinutes(uk(from), minutes, BEN_HOURS))).toBe(expected);
    });
});

describe('workingHoursBetween (OFFICE)', () => {
    it('counts only office hours', () => {
        expect(workingHoursBetween(uk('2026-09-02T09:00:00'), uk('2026-09-02T13:00:00'))).toBe(4);
        expect(workingHoursBetween(uk('2026-09-04T17:30:00'), uk('2026-09-07T11:30:00'))).toBe(4); // Fri 17:30 → Mon 11:30
        expect(workingHoursBetween(uk('2026-09-04T17:55:00'), uk('2026-09-07T07:59:00'))).toBeCloseTo(0.1, 5);
        expect(workingHoursBetween(uk('2026-09-05T10:00:00'), uk('2026-09-06T10:00:00'))).toBe(0); // Sat → Sun
    });
    it('is zero or positive, never negative', () => {
        expect(workingHoursBetween(uk('2026-09-02T13:00:00'), uk('2026-09-02T09:00:00'))).toBe(0);
    });
    it('is the inverse of addWorkingHours across a weekend', () => {
        const from = uk('2026-09-04T15:00:00'); // Fri
        const due = addWorkingHours(from, 4);
        expect(workingHoursBetween(from, due)).toBe(4);
    });
});

describe('dueAtFor', () => {
    it('draft and flag are 4 office hours; urgent flag is 20 office minutes', () => {
        const from = uk('2026-09-04T17:30:00'); // Fri
        expect(ukString(dueAtFor('draft', from))).toBe('Mon 2026-09-07 11:30');
        expect(ukString(dueAtFor('flag', from))).toBe('Mon 2026-09-07 11:30');
        expect(ukString(dueAtFor('flag_urgent', from))).toBe('Fri 2026-09-04 17:50');
        expect(ukString(dueAtFor('flag_urgent', uk('2026-09-04T17:55:00')))).toBe('Mon 2026-09-07 08:15');
    });
    it('formatUk renders UK time', () => {
        expect(formatUk(uk('2026-09-02T10:30:00'), 'time')).toBe('10:30');
        expect(formatUk(uk('2026-09-02T10:30:00'))).toMatch(/2 Sept? 2026, 10:30/);
    });
});
