// notifications-templates.test.ts
//
// Module 10 — verify the template registry. We test the *catalogue* (all 17
// events render at least one channel) and a sampling of channel renderers
// to confirm payload variables substitute and missing-required throws.

import { describe, expect, it } from 'vitest';
import {
    TEMPLATES,
    hasTemplate,
    listEvents,
    MissingTemplateVarError,
    renderTemplate,
} from '../notifications/templates';
import type { NotificationEvent } from '../notifications/types';

const ALL_EVENTS: NotificationEvent[] = [
    'quote_sent',
    'payment_received',
    'routing_offer_round_1',
    'routing_offer_round_2',
    'routing_offer_broadcast',
    'offer_accepted',
    'pack_offered',
    'pack_accepted',
    'pack_released',
    'pre_arrival_reminder',
    'check_in_no_show',
    'job_completed',
    'review_window_close',
    'payout_fired',
    'pay_adjustment_filed',
    'pay_adjustment_approved',
    'reschedule_required',
];

describe('notifications/templates — catalogue completeness', () => {
    it('lists exactly the 17 events in the spec', () => {
        const events = listEvents();
        expect(events.length).toBe(17);
        for (const e of ALL_EVENTS) {
            expect(events).toContain(e);
        }
    });

    it('every event has at least one channel renderer', () => {
        for (const event of ALL_EVENTS) {
            const channels = Object.keys(TEMPLATES[event] ?? {});
            expect(channels.length, `event ${event} has no templates`).toBeGreaterThan(0);
        }
    });
});

describe('notifications/templates — rendering', () => {
    it('renders quote_sent with payload variables substituted', () => {
        const out = renderTemplate('quote_sent', 'whatsapp', {
            customerName: 'Alex',
            url: 'https://example.com/q/abc',
        });
        expect(out).not.toBeNull();
        expect(out!.body).toContain('Alex');
        expect(out!.body).toContain('https://example.com/q/abc');
    });

    it('renders email subject + body', () => {
        const out = renderTemplate('quote_sent', 'email', {
            customerName: 'Alex',
            url: 'https://example.com/q/abc',
        });
        expect(out!.subject).toBeTruthy();
        expect(out!.body).toContain('Alex');
    });

    it('returns null for an unsupported channel', () => {
        const out = renderTemplate('quote_sent', 'in_app', { customerName: 'Alex', url: 'x' });
        expect(out).toBeNull();
    });

    it('throws MissingTemplateVarError when a required var is absent', () => {
        expect(() => renderTemplate('quote_sent', 'whatsapp', {})).toThrowError(MissingTemplateVarError);
    });

    it('throws when a required var is empty string', () => {
        expect(() => renderTemplate('quote_sent', 'sms', { customerName: 'Alex', url: '' })).toThrowError(MissingTemplateVarError);
    });

    it('routing_offer_round_1 includes pay amount and postcode', () => {
        const out = renderTemplate('routing_offer_round_1', 'whatsapp', {
            contractorFirstName: 'Sam',
            title: 'Tap repair',
            postcode: 'NG7 2BB',
            payAmount: 4500,             // pence
            offerUrl: 'https://example.com/offer/1',
        });
        expect(out!.body).toContain('Sam');
        expect(out!.body).toContain('NG7 2BB');
        expect(out!.body).toContain('£45.00');
        expect(out!.body).toContain('https://example.com/offer/1');
    });

    it('hasTemplate reflects registry entries', () => {
        expect(hasTemplate('quote_sent', 'whatsapp')).toBe(true);
        expect(hasTemplate('quote_sent', 'in_app')).toBe(false);
        expect(hasTemplate('check_in_no_show', 'in_app')).toBe(true);
    });
});
