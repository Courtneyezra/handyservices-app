// server/notifications/quiet-hours.ts
//
// Module 10 — Notifications Layer: defer rules.
//
// Customer-facing WhatsApp/SMS are not sent between 21:00 and 07:00 in the
// recipient's local time. Contractor offers, day-of arrival pings, and
// dispute/no-show alerts bypass the rule.
//
// Refs: docs/architecture/modules/10-notifications.md §10

import type { NotificationEvent, NotificationRequest, RecipientType } from './types';

const DEFAULT_TZ = 'Europe/London';

/**
 * Events that are time-critical and bypass quiet hours, regardless of
 * recipient. Contractor offers were consented to in supply onboarding;
 * arrival pings and ops alerts must reach the recipient now or never.
 */
const URGENT_EVENTS: ReadonlySet<NotificationEvent> = new Set<NotificationEvent>([
    // Contractor offers — time-critical, supply-side consented
    'routing_offer_round_1',
    'routing_offer_round_2',
    'routing_offer_broadcast',
    'pack_offered',

    // Day-of operational pings
    'pre_arrival_reminder',
    'check_in_no_show',
    'pack_released',

    // Ops/admin signals — admin always reachable
    'pay_adjustment_filed',
]);

/**
 * Recipient roles where quiet hours are skipped entirely. Admins are an
 * inbox, not a person we wake up — but we still send them ops alerts.
 * Contractors can opt in/out at unit level (future); for now, contractors
 * receive offers around the clock per supply contract.
 */
const ROLES_BYPASSING_QUIET_HOURS: ReadonlySet<RecipientType> = new Set<RecipientType>([
    'admin',
]);

/**
 * Return the local hour in the given IANA timezone. Falls back to system
 * time when the runtime can't resolve the zone (very rare).
 */
export function localHour(now: Date, timezone: string = DEFAULT_TZ): number {
    try {
        const fmt = new Intl.DateTimeFormat('en-GB', {
            hour: 'numeric',
            hour12: false,
            timeZone: timezone,
        });
        // 24h: "07", "21", or sometimes "24" on Node — clamp.
        const parts = fmt.formatToParts(now);
        const hourPart = parts.find((p) => p.type === 'hour');
        const h = Number(hourPart?.value ?? now.getHours());
        if (!Number.isFinite(h)) return now.getHours();
        return h % 24;
    } catch {
        return now.getHours();
    }
}

/** True when the recipient's local time is in [21:00, 24:00) ∪ [00:00, 07:00). */
export function isQuietHours(now: Date, recipientTimezone: string = DEFAULT_TZ): boolean {
    const h = localHour(now, recipientTimezone);
    return h >= 21 || h < 7;
}

/**
 * Decide whether a notification request should be deferred until the next
 * 07:00 local. Returns true only when ALL of:
 *   - it's currently quiet hours,
 *   - the request is not flagged urgent,
 *   - the event is not in the always-urgent set,
 *   - the recipient role is not exempt.
 */
export function shouldDeferUntilMorning(req: NotificationRequest, now: Date = new Date()): boolean {
    if (req.urgent) return false;
    if (URGENT_EVENTS.has(req.event)) return false;
    if (ROLES_BYPASSING_QUIET_HOURS.has(req.recipient.type)) return false;
    return isQuietHours(now, req.recipient.timezone ?? DEFAULT_TZ);
}

/**
 * Compute the next 07:00 in the recipient's local timezone. Used as
 * `defer_until` for the outbox row so the worker fires at 07:01.
 */
export function nextMorningSlot(now: Date, recipientTimezone: string = DEFAULT_TZ): Date {
    // Strategy: ask the formatter for current local "Y-M-D H" in TZ; if hour
    // ≥ 7, jump to next day; build a UTC instant by subtracting the offset.
    // For simplicity (and since BST/GMT are the only zones we currently see),
    // we approximate by adding ms until the next 07:00 wall-clock crossing.
    const target = new Date(now.getTime());
    while (true) {
        const h = localHour(target, recipientTimezone);
        if (h === 7) break;
        target.setTime(target.getTime() + 60 * 60 * 1000);  // +1h
        // Safety break — at most 24 iterations
        if (target.getTime() - now.getTime() > 25 * 60 * 60 * 1000) break;
    }
    // Snap to xx:01 to avoid the racy 07:00 boundary.
    target.setMinutes(1, 0, 0);
    return target;
}

// Test seam — exposes constants so tests can assert membership without
// duplicating the list.
export const __test__ = { URGENT_EVENTS, ROLES_BYPASSING_QUIET_HOURS };
