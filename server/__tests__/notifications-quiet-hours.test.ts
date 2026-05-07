// notifications-quiet-hours.test.ts
//
// Module 10 — verify quiet-hours defer rules.
//
// We pin "now" to specific UTC instants and rely on Europe/London (BST +1
// in summer, GMT +0 in winter) — using a winter date keeps the math
// trivial: Europe/London hour == UTC hour.

import { describe, expect, it } from 'vitest';
import {
    isQuietHours,
    localHour,
    nextMorningSlot,
    shouldDeferUntilMorning,
    __test__,
} from '../notifications/quiet-hours';
import type { NotificationRequest } from '../notifications/types';

// Winter dates → Europe/London == UTC; pin the date so we don't drift on tz changes.
const WINTER_22 = new Date('2026-01-15T22:30:00.000Z');   // 22:30 London
const WINTER_06 = new Date('2026-01-15T06:30:00.000Z');   // 06:30 London
const WINTER_14 = new Date('2026-01-15T14:00:00.000Z');   // 14:00 London
const WINTER_07 = new Date('2026-01-15T07:00:00.000Z');   // 07:00 London — boundary

describe('notifications/quiet-hours — localHour', () => {
    it('returns London hour for winter UTC instants', () => {
        expect(localHour(WINTER_22, 'Europe/London')).toBe(22);
        expect(localHour(WINTER_06, 'Europe/London')).toBe(6);
        expect(localHour(WINTER_14, 'Europe/London')).toBe(14);
    });
});

describe('notifications/quiet-hours — isQuietHours', () => {
    it('22:00 London is quiet', () => {
        expect(isQuietHours(WINTER_22)).toBe(true);
    });
    it('06:00 London is quiet', () => {
        expect(isQuietHours(WINTER_06)).toBe(true);
    });
    it('14:00 London is not quiet', () => {
        expect(isQuietHours(WINTER_14)).toBe(false);
    });
    it('07:00 London is not quiet (boundary)', () => {
        expect(isQuietHours(WINTER_07)).toBe(false);
    });
});

describe('notifications/quiet-hours — shouldDeferUntilMorning', () => {
    function req(overrides: Partial<NotificationRequest> = {}): NotificationRequest {
        return {
            event: 'quote_sent',
            recipient: { type: 'customer', id: 'cust_1', phone: '+447900000000' },
            payload: { customerName: 'Alex', url: 'https://example.com' },
            ...overrides,
        };
    }

    it('defers a non-urgent customer message at 22:30', () => {
        expect(shouldDeferUntilMorning(req(), WINTER_22)).toBe(true);
    });

    it('does NOT defer when urgent=true', () => {
        expect(shouldDeferUntilMorning(req({ urgent: true }), WINTER_22)).toBe(false);
    });

    it('does NOT defer urgent-event types regardless of hour', () => {
        const r = req({ event: 'routing_offer_round_1', recipient: { type: 'contractor', id: 'c1', phone: '+447900000001' } });
        expect(shouldDeferUntilMorning(r, WINTER_22)).toBe(false);
    });

    it('does NOT defer admin recipients', () => {
        const r = req({ recipient: { type: 'admin', id: 'admin', email: 'admin@example.com' }, event: 'check_in_no_show' });
        expect(shouldDeferUntilMorning(r, WINTER_22)).toBe(false);
    });

    it('does NOT defer during business hours', () => {
        expect(shouldDeferUntilMorning(req(), WINTER_14)).toBe(false);
    });
});

describe('notifications/quiet-hours — nextMorningSlot', () => {
    it('07:01 the next morning when called late evening', () => {
        const target = nextMorningSlot(WINTER_22, 'Europe/London');
        const targetHour = localHour(target, 'Europe/London');
        expect(targetHour).toBe(7);
        // Should be after now, by less than 14 hours.
        expect(target.getTime() - WINTER_22.getTime()).toBeGreaterThan(0);
        expect(target.getTime() - WINTER_22.getTime()).toBeLessThan(14 * 3600 * 1000);
    });
});

describe('notifications/quiet-hours — URGENT_EVENTS membership', () => {
    it('contains the contractor-offer events', () => {
        expect(__test__.URGENT_EVENTS.has('routing_offer_round_1')).toBe(true);
        expect(__test__.URGENT_EVENTS.has('routing_offer_round_2')).toBe(true);
        expect(__test__.URGENT_EVENTS.has('routing_offer_broadcast')).toBe(true);
        expect(__test__.URGENT_EVENTS.has('pack_offered')).toBe(true);
    });
    it('does NOT contain customer review prompt', () => {
        expect(__test__.URGENT_EVENTS.has('job_completed')).toBe(false);
        expect(__test__.URGENT_EVENTS.has('quote_sent')).toBe(false);
    });
});
