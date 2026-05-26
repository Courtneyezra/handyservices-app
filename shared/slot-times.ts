/**
 * Slot time conventions — single source of truth.
 *
 * Realistic working day for a contractor (used to be 5h/5h/10h, which is
 * unachievable in practice — especially with travel between jobs):
 *
 *   AM:        09:00 – 13:00   (4 working hours)
 *   Lunch gap: 13:00 – 14:00   (unbookable, implicit)
 *   PM:        14:00 – 18:00   (4 working hours)
 *   Full day:  09:00 – 18:00   (wallclock 9h, 8h working with 1h lunch)
 *
 * All slot-aware code MUST import from here rather than hardcoding strings.
 */

export type SlotType = 'am' | 'pm' | 'full_day';

export const SLOT_TIMES: Record<SlotType, { start: string; end: string }> = {
    am: { start: '09:00', end: '13:00' },
    pm: { start: '14:00', end: '18:00' },
    full_day: { start: '09:00', end: '18:00' },
};

/** Minutes of bookable work per slot — used by the booking engine + matrix renderer. */
export const SLOT_CAPACITY_MIN: Record<SlotType, number> = {
    am: 240,   // 4h
    pm: 240,   // 4h
    full_day: 480, // 8h wallclock minus 1h lunch == 7h work, but the renderer treats
                   // it as two 4h halves (AM + PM) with a lunch gap, so total cap = 480.
};

/** Lunch break — falls between AM and PM, never bookable. */
export const LUNCH_BREAK = { start: '13:00', end: '14:00' };

/**
 * Convert HH:MM string to minutes-since-midnight. Returns NaN for invalid input.
 */
export function timeToMinutes(t: string | null | undefined): number {
    if (!t) return NaN;
    const [h, m] = t.split(':').map(Number);
    if (isNaN(h)) return NaN;
    return h * 60 + (m || 0);
}

/**
 * Classify a (start, end) window as am | pm | full_day | other.
 * Used by the matrix endpoint + UI to label saved overrides.
 *
 * Tolerant of legacy data (08:00 starts) by treating "start <= AM_START" as AM.
 */
export function slotFromWindow(startTime: string | null | undefined, endTime: string | null | undefined): SlotType | 'other' {
    const s = startTime || '';
    const e = endTime || '';
    if (s <= SLOT_TIMES.full_day.start && e >= SLOT_TIMES.full_day.end) return 'full_day';
    if (s <= SLOT_TIMES.am.start && e <= SLOT_TIMES.am.end) return 'am';
    if (s >= LUNCH_BREAK.start && e >= SLOT_TIMES.pm.end) return 'pm';
    return 'other';
}

/**
 * Does a contractor's working window cover the requested slot?
 * Single canonical implementation — booking engine, customer date picker, and
 * matrix endpoint all delegate here.
 */
export function timeRangeCoversSlot(startTime: string | null | undefined, endTime: string | null | undefined, slot: SlotType): boolean {
    const start = startTime || SLOT_TIMES.am.start;
    const end = endTime || SLOT_TIMES.full_day.end;
    switch (slot) {
        case 'am':
            return start <= SLOT_TIMES.am.start && end >= SLOT_TIMES.am.end;
        case 'pm':
            return start <= SLOT_TIMES.pm.start && end >= SLOT_TIMES.pm.end;
        case 'full_day':
            return start <= SLOT_TIMES.full_day.start && end >= SLOT_TIMES.full_day.end;
    }
}
