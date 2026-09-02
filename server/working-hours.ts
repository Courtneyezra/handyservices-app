/**
 * WORKING-HOURS ARITHMETIC — the one implementation (Phase 1 of the comms rebuild, 2 Sep 2026).
 *
 * Before this file the codebase had four copies of "what hour is it in Nottingham" and two
 * different working clocks: comms-sla.ts counted Mon–Fri 08–18 for the board's SLA colour, and
 * promise-tracker.ts added hours inside a daily 08–20 window for promise timers, VA call tasks and
 * the SLA sweep. Both were right for their job and both are kept — as NAMED CLOCKS here, on one
 * engine — so a due time and an alert window can never drift apart again.
 *
 *   OFFICE_HOURS  Mon–Fri 08:00–18:00 Europe/London. The clock for `due_at` on drafts and flags
 *                 (design §4: 4 working hours; 20 minutes for callback_requested / urgent).
 *   BEN_HOURS     every day 08:00–20:00 Europe/London. The clock every Ben-facing alert, the
 *                 proactive-send gate and the promise timers already used. Unchanged semantics.
 *
 * Everything is pure and takes `now` so tests run at fixed instants. All wall-clock reads go
 * through Intl with timeZone 'Europe/London', so the server's own TZ is irrelevant and DST is
 * handled by re-reading the clock after every jump rather than by assuming 24-hour days.
 */

export interface WorkingClock {
    /** First working hour, inclusive (local). */
    startHour: number;
    /** End hour, exclusive (local). */
    endHour: number;
    /** Working weekdays, 0 = Sunday … 6 = Saturday. */
    days: readonly number[];
}

export const OFFICE_HOURS: WorkingClock = { startHour: 8, endHour: 18, days: [1, 2, 3, 4, 5] };
export const BEN_HOURS: WorkingClock = { startHour: 8, endHour: 20, days: [0, 1, 2, 3, 4, 5, 6] };

/** Defaults from the design (§4). Flags: 4 working hours; urgent / callback_requested: 20 minutes. */
export const DRAFT_DUE_WORKING_HOURS = 4;
export const FLAG_DUE_WORKING_HOURS = 4;
export const URGENT_FLAG_DUE_WORKING_MINUTES = 20;

export const UK_TIMEZONE = 'Europe/London';

export interface UkParts {
    year: number;
    month: number;   // 1–12
    day: number;     // 1–31
    hour: number;    // 0–23
    minute: number;  // 0–59
    weekday: number; // 0 = Sunday … 6 = Saturday
}

const PARTS_FMT = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
});
const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of an instant in Europe/London. */
export function ukParts(d: Date): UkParts {
    const p = Object.fromEntries(PARTS_FMT.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
    return {
        year: Number(p.year),
        month: Number(p.month),
        day: Number(p.day),
        hour: Number(p.hour) % 24, // some ICU builds render midnight as "24"
        minute: Number(p.minute),
        weekday: WEEKDAYS[p.weekday] ?? 0,
    };
}

/** UK local hour of an instant (default: now). */
export function ukHour(d: Date = new Date()): number {
    return ukParts(d).hour;
}

/** Kept under the name four modules already used. */
export function ukHourNow(): number {
    return ukHour(new Date());
}

/** Inside the clock right now? */
export function isWithinClock(d: Date, clock: WorkingClock): boolean {
    const p = ukParts(d);
    return clock.days.includes(p.weekday) && p.hour >= clock.startHour && p.hour < clock.endHour;
}

/**
 * The historical 08–20 boundary every Ben alert and proactive send used, expressed as a plain
 * hour test so existing callers (`isOutOfHours(hour)`) keep their signature. Daily, no weekend
 * rule: Ben's phone is on at the weekend, the office clock is a different question.
 */
export function isOutOfHours(hour: number = ukHourNow()): boolean {
    return hour < BEN_HOURS.startHour || hour >= BEN_HOURS.endHour;
}

export function isOfficeHours(d: Date = new Date()): boolean {
    return isWithinClock(d, OFFICE_HOURS);
}

export function isBenHours(d: Date = new Date()): boolean {
    return isWithinClock(d, BEN_HOURS);
}

const MINUTE = 60_000;
const MAX_ITERATIONS = 2_000; // ~ a year of daily jumps; a guard, never a limit anyone hits

/**
 * Move `t` forward to the next instant that is inside the clock (or return it unchanged if it
 * already is). Jumps are computed on the wall clock and then RE-READ, so a jump that lands an
 * hour off because of a DST change is corrected on the next loop rather than trusted.
 */
export function nextWorkingSlot(from: Date, clock: WorkingClock = OFFICE_HOURS): Date {
    let t = from.getTime();
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        const p = ukParts(new Date(t));
        const working = clock.days.includes(p.weekday);
        if (working && p.hour >= clock.startHour && p.hour < clock.endHour) return new Date(t);
        if (working && p.hour < clock.startHour) {
            // Same day, before opening: jump to opening.
            t += ((clock.startHour - p.hour) * 60 - p.minute) * MINUTE;
            continue;
        }
        // Past close today, or a non-working day: jump to tomorrow's opening and re-check
        // (the weekday test above handles a run of non-working days one jump at a time).
        t += ((24 - p.hour + clock.startHour) * 60 - p.minute) * MINUTE;
        // Second-level precision is not needed for due times; snap to the minute so the result
        // is a clean "08:00" rather than "08:00:37".
        t -= new Date(t).getSeconds() * 1000 + new Date(t).getMilliseconds();
    }
    return new Date(t);
}

/**
 * `from` + `minutes` counted only inside the clock. Time outside the window (evenings, weekends
 * for OFFICE_HOURS) does not count. Lands strictly inside the window: exactly on close rolls to
 * the next opening, so a due time is always an hour somebody works.
 */
export function addWorkingMinutes(from: Date, minutes: number, clock: WorkingClock = OFFICE_HOURS): Date {
    let t = nextWorkingSlot(from, clock).getTime();
    let remaining = Math.max(0, minutes) * MINUTE;
    for (let i = 0; i < MAX_ITERATIONS && remaining > 0; i++) {
        const p = ukParts(new Date(t));
        const toClose = ((clock.endHour - p.hour) * 60 - p.minute) * MINUTE;
        const step = Math.min(remaining, toClose);
        t += step;
        remaining -= step;
        if (remaining > 0 || step === toClose) {
            // We hit (or would sit exactly on) close: continue from the next opening.
            t = nextWorkingSlot(new Date(t), clock).getTime();
        }
    }
    return new Date(t);
}

export function addWorkingHours(from: Date, hours: number, clock: WorkingClock = OFFICE_HOURS): Date {
    return addWorkingMinutes(from, hours * 60, clock);
}

// ---------------------------------------------------------------- elapsed

/**
 * Hour-bucket memo: Intl timezone conversion is one of the most expensive calls in JS and the
 * board's SLA colouring walks the same absolute hours for every card (comms-sla.ts found ~500k
 * Intl calls per board load before memoising). Bounded, shared by every caller.
 */
const hourMemo = new Map<number, { weekday: number; hour: number }>();
function partsForHourBucket(t: number): { weekday: number; hour: number } {
    const bucket = Math.floor(t / 3_600_000);
    let p = hourMemo.get(bucket);
    if (!p) {
        const full = ukParts(new Date(bucket * 3_600_000));
        p = { weekday: full.weekday, hour: full.hour };
        if (hourMemo.size > 20_000) hourMemo.clear();
        hourMemo.set(bucket, p);
    }
    return p;
}

/** Cap the scan: past two weeks a breach is simply breached. */
const MAX_HOURS_SCANNED = 24 * 14;

/**
 * Working hours elapsed between two instants on the given clock, to one decimal place. Walks
 * hour buckets, which is coarse but exact enough for SLAs measured in hours and far easier to
 * verify across DST than interval arithmetic.
 */
export function workingHoursBetween(from: Date, to: Date, clock: WorkingClock = OFFICE_HOURS): number {
    if (to <= from) return 0;
    let elapsed = 0;
    let scanned = 0;
    let cursor = from.getTime();
    while (cursor < to.getTime() && scanned < MAX_HOURS_SCANNED) {
        const p = partsForHourBucket(cursor);
        const bucketEnd = (Math.floor(cursor / 3_600_000) + 1) * 3_600_000;
        if (clock.days.includes(p.weekday) && p.hour >= clock.startHour && p.hour < clock.endHour) {
            elapsed += (Math.min(bucketEnd, to.getTime()) - cursor) / 3_600_000;
        }
        cursor = bucketEnd;
        scanned++;
    }
    return Math.round(elapsed * 10) / 10;
}

export function workingMinutesBetween(from: Date, to: Date, clock: WorkingClock = OFFICE_HOURS): number {
    return Math.round(workingHoursBetween(from, to, clock) * 60);
}

// ---------------------------------------------------------------- due times (design §4)

export type DueKind = 'draft' | 'flag' | 'flag_urgent';

/**
 * When something must have happened by. Drafts and ordinary flags: 4 office hours. Urgent flags
 * (callback_requested, or a thread already at priority urgent): 20 office minutes. Outside office
 * hours the clock starts at the next opening, so a 22:00 flag is due 12:00 next working day and a
 * Friday 17:30 flag is due Monday 11:30 — never "2am Saturday".
 */
export function dueAtFor(kind: DueKind, from: Date = new Date()): Date {
    switch (kind) {
        case 'draft': return addWorkingHours(from, DRAFT_DUE_WORKING_HOURS, OFFICE_HOURS);
        case 'flag': return addWorkingHours(from, FLAG_DUE_WORKING_HOURS, OFFICE_HOURS);
        case 'flag_urgent': return addWorkingMinutes(from, URGENT_FLAG_DUE_WORKING_MINUTES, OFFICE_HOURS);
    }
}

/** "Tue 3 Sep, 10:30" in UK time, for Ben-facing notes. */
export function formatUk(d: Date, style: 'datetime' | 'time' = 'datetime'): string {
    if (style === 'time') {
        return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: UK_TIMEZONE }).format(d);
    }
    return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: UK_TIMEZONE }).format(d);
}
