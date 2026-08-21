/**
 * "Nothing gets missed" — the SLA clock behind the comms board.
 *
 * A conversation is AWAITING REPLY when its most recent message is inbound: the customer said
 * something and nobody has answered. That, aged against working hours, is the single number the
 * whole board sorts by.
 *
 * Working hours matter because wall-clock hours lie. A message at 17:55 on Friday is not "62 hours
 * late" by Monday morning — it is 5 minutes into the next working day. Ageing on raw elapsed time
 * would paint the whole board red every Monday and train Ben to ignore it, which is the exact
 * failure mode this feature exists to prevent.
 */

/** Europe/London, Mon-Fri, 08:00-18:00. */
export const WORKING = {
    startHour: 8,
    endHour: 18,
    days: [1, 2, 3, 4, 5], // 1 = Monday ... 5 = Friday (Date.getDay in London terms)
};

/** Default SLA: reply within this many WORKING hours or the conversation is breaching. */
export const DEFAULT_SLA_WORKING_HOURS = 4;

/** Reads a Date's wall-clock parts in Europe/London, regardless of server timezone. */
function londonParts(d: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: number } {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    });
    const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value])) as Record<string, string>;
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
        year: Number(p.year),
        month: Number(p.month),
        day: Number(p.day),
        // Intl renders midnight as "24" in some locales; normalize it.
        hour: Number(p.hour) % 24,
        minute: Number(p.minute),
        weekday: weekdayMap[p.weekday] ?? 0,
    };
}

/**
 * Working hours elapsed between two instants.
 *
 * Walks hour by hour, which is coarse but exact enough for an SLA measured in hours and far easier
 * to reason about (and to verify) than interval arithmetic across DST boundaries. Capped so an
 * ancient conversation can't spin the loop.
 */
/**
 * Hour-bucket memo for the scan below. londonParts is an Intl timezone conversion — one of the
 * most expensive calls in JS — and the loop was paying it per hour per card: with a months-old
 * backlog the board burned ~half a second of pure CPU per breached card and took ~20s to load,
 * identically in dev and prod (found 21 Aug; the DB queries measured in milliseconds all along).
 * Every card walks the same absolute hours, so one global memo collapses ~500k Intl calls per
 * board load into a few thousand, once.
 */
const hourPartsMemo = new Map<number, { weekday: string; hour: number }>();
function londonPartsForHour(cursor: Date): { weekday: string; hour: number } {
    const bucket = Math.floor(cursor.getTime() / 3600_000);
    let p = hourPartsMemo.get(bucket);
    if (!p) {
        const full = londonParts(cursor);
        p = { weekday: full.weekday, hour: full.hour };
        if (hourPartsMemo.size > 20_000) hourPartsMemo.clear(); // bounded, effectively never hit
        hourPartsMemo.set(bucket, p);
    }
    return p;
}

export function workingHoursBetween(from: Date, to: Date): number {
    if (to <= from) return 0;

    // 14 days, down from 90: beyond two weeks a breach is simply breached — the board already
    // sorts breached cards by recency, not by this number, so precision past the cap bought
    // nothing but CPU.
    const MAX_HOURS_SCANNED = 24 * 14;
    let elapsed = 0;
    let scanned = 0;
    const cursor = new Date(from.getTime());

    while (cursor < to && scanned < MAX_HOURS_SCANNED) {
        const p = londonPartsForHour(cursor);
        if (WORKING.days.includes(p.weekday) && p.hour >= WORKING.startHour && p.hour < WORKING.endHour) {
            // Count only the portion of this hour that falls before `to`.
            const hourEnd = new Date(cursor.getTime() + 3600_000);
            const slice = Math.min(hourEnd.getTime(), to.getTime()) - cursor.getTime();
            elapsed += slice / 3600_000;
        }
        cursor.setTime(cursor.getTime() + 3600_000);
        scanned++;
    }
    return Math.round(elapsed * 10) / 10;
}

export type WaitState = {
    /** True when the last message on the thread was inbound — i.e. nobody has answered. */
    awaitingReply: boolean;
    /** Working hours the customer has been waiting. 0 when not awaiting. */
    waitingWorkingHours: number;
    /** Raw wall-clock hours, for display ("3 days ago") rather than for judgement. */
    waitingClockHours: number;
    /** True once the wait exceeds the SLA. This is what turns a card red. */
    breached: boolean;
    /** How urgent, for sorting and colour. */
    severity: 'none' | 'ok' | 'due' | 'breached';
};

/**
 * Derives wait state from the last inbound and last outbound timestamps of a thread.
 * Both may be null (a thread we started, or one with nothing in it).
 */
export function computeWaitState(
    lastInboundAt: Date | null,
    lastOutboundAt: Date | null,
    slaWorkingHours: number = DEFAULT_SLA_WORKING_HOURS,
    now: Date = new Date()
): WaitState {
    // Nothing from the customer means there is nobody waiting on us.
    if (!lastInboundAt) {
        return { awaitingReply: false, waitingWorkingHours: 0, waitingClockHours: 0, breached: false, severity: 'none' };
    }
    // Answered if we replied after their last message.
    if (lastOutboundAt && lastOutboundAt >= lastInboundAt) {
        return { awaitingReply: false, waitingWorkingHours: 0, waitingClockHours: 0, breached: false, severity: 'none' };
    }

    const waitingWorkingHours = workingHoursBetween(lastInboundAt, now);
    const waitingClockHours = Math.floor((now.getTime() - lastInboundAt.getTime()) / 3600_000);
    const breached = waitingWorkingHours >= slaWorkingHours;

    return {
        awaitingReply: true,
        waitingWorkingHours,
        waitingClockHours,
        breached,
        // "due" warns before the breach so Ben can act rather than be told he's already late.
        severity: breached ? 'breached' : waitingWorkingHours >= slaWorkingHours * 0.5 ? 'due' : 'ok',
    };
}
