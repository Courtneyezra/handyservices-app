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

import { OFFICE_HOURS, workingHoursBetween as workingHoursBetweenOnClock } from './working-hours';

/** Europe/London, Mon-Fri, 08:00-18:00 — the OFFICE clock in server/working-hours.ts (Phase 1: one implementation). */
export const WORKING = OFFICE_HOURS;

/** Default SLA: reply within this many WORKING hours or the conversation is breaching. */
export const DEFAULT_SLA_WORKING_HOURS = 4;

/**
 * Working hours elapsed between two instants on the office clock. Delegates to the shared
 * engine (hour-bucket walk, memoised, capped at 14 days) so the board and the due-time
 * arithmetic can never disagree about what a working hour is.
 */
export function workingHoursBetween(from: Date, to: Date): number {
    return workingHoursBetweenOnClock(from, to, OFFICE_HOURS);
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
