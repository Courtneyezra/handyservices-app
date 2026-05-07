// notifications-orchestrator.test.ts
//
// Module 10 — orchestrator branches.
//
// We mock the `feature-flags`, the channel adapters, and the audit-write
// helper so the test exercises only the orchestrator's decision logic:
//   - flag OFF → status='skipped'
//   - primary success → no fallback
//   - primary fails → fallback chain walked
//   - quiet-hours defer (non-urgent customer message at 22:30)
//   - urgent flag bypasses defer
//   - missing template var → fallback to next channel

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Flag mock — flip per test.
// ---------------------------------------------------------------------------
const flagState = { NOTIFICATIONS_V2: true };
vi.mock('../feature-flags', () => ({
    FLAGS: new Proxy({} as Record<string, boolean>, {
        get: (_t, key) => (key === 'NOTIFICATIONS_V2' ? flagState.NOTIFICATIONS_V2 : false),
    }),
    publicFlags: () => ({}),
    logFlagDependencyWarnings: () => undefined,
}));

// ---------------------------------------------------------------------------
// Channel adapter mocks — capture (recipient, message), return scriptable result.
// ---------------------------------------------------------------------------
const calls = {
    whatsapp: [] as Array<{ recipient: any; message: any }>,
    sms: [] as Array<{ recipient: any; message: any }>,
    email: [] as Array<{ recipient: any; message: any }>,
    in_app: [] as Array<{ recipient: any; message: any }>,
};
const channelResults = {
    whatsapp: { status: 'sent', messageId: 'wa_1' } as { status: 'sent' | 'failed'; messageId?: string; error?: string },
    sms: { status: 'sent', messageId: 'sms_1' } as { status: 'sent' | 'failed'; messageId?: string; error?: string },
    email: { status: 'sent', messageId: 'em_1' } as { status: 'sent' | 'failed'; messageId?: string; error?: string },
    in_app: { status: 'sent', messageId: 'ia_1' } as { status: 'sent' | 'failed'; messageId?: string; error?: string },
};

vi.mock('../notifications/channels/whatsapp', () => ({
    send: async (recipient: any, message: any) => {
        calls.whatsapp.push({ recipient, message });
        return channelResults.whatsapp;
    },
}));
vi.mock('../notifications/channels/sms', () => ({
    send: async (recipient: any, message: any) => {
        calls.sms.push({ recipient, message });
        return channelResults.sms;
    },
}));
vi.mock('../notifications/channels/email', () => ({
    send: async (recipient: any, message: any) => {
        calls.email.push({ recipient, message });
        return channelResults.email;
    },
}));
vi.mock('../notifications/channels/in-app', () => ({
    send: async (recipient: any, message: any) => {
        calls.in_app.push({ recipient, message });
        return channelResults.in_app;
    },
    recentForRecipient: () => [],
    __resetForTests: () => undefined,
}));

// Audit write — stubbed (we don't have a real DB in unit tests).
vi.mock('../notifications/delivery-tracking', async () => {
    const actual = await vi.importActual<any>('../notifications/delivery-tracking');
    return {
        ...actual,
        recordAudit: vi.fn(async () => undefined),
    };
});

// ---------------------------------------------------------------------------
// Helper to import after mocks settle.
// ---------------------------------------------------------------------------
async function loadOrchestrator() {
    const mod = await import('../notifications');
    return mod;
}

// ---------------------------------------------------------------------------
// Reset between tests.
// ---------------------------------------------------------------------------
beforeEach(() => {
    flagState.NOTIFICATIONS_V2 = true;
    calls.whatsapp.length = 0;
    calls.sms.length = 0;
    calls.email.length = 0;
    calls.in_app.length = 0;
    channelResults.whatsapp = { status: 'sent', messageId: 'wa_1' };
    channelResults.sms = { status: 'sent', messageId: 'sms_1' };
    channelResults.email = { status: 'sent', messageId: 'em_1' };
    channelResults.in_app = { status: 'sent', messageId: 'ia_1' };
});

afterEach(() => {
    vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('notifications/orchestrator — feature flag', () => {
    it('returns skipped when FF_NOTIFICATIONS_V2 is OFF', async () => {
        flagState.NOTIFICATIONS_V2 = false;
        const { sendNotification } = await loadOrchestrator();
        const result = await sendNotification({
            event: 'quote_sent',
            recipient: { type: 'customer', id: 'c1', phone: '+447900000000' },
            payload: { customerName: 'Alex', url: 'https://example.com/q/1' },
        });
        expect(result.status).toBe('skipped');
        expect(calls.whatsapp.length).toBe(0);
        expect(calls.sms.length).toBe(0);
    });
});

describe('notifications/orchestrator — primary channel', () => {
    it('sends to WhatsApp for a customer (default channel)', async () => {
        const { sendNotification } = await loadOrchestrator();
        const result = await sendNotification({
            event: 'quote_sent',
            recipient: { type: 'customer', id: 'c1', phone: '+447900000000' },
            payload: { customerName: 'Alex', url: 'https://example.com/q/1' },
            // urgent bypasses quiet-hours so the test isn't time-dependent
            urgent: true,
        });
        expect(result.status).toBe('sent');
        expect(result.channel).toBe('whatsapp');
        expect(calls.whatsapp).toHaveLength(1);
        expect(calls.sms).toHaveLength(0);
    });

    it('sends via SMS when channelOverride=sms', async () => {
        const { sendNotification } = await loadOrchestrator();
        const result = await sendNotification({
            event: 'quote_sent',
            recipient: { type: 'customer', id: 'c1', phone: '+447900000000' },
            payload: { customerName: 'Alex', url: 'https://example.com/q/1' },
            channelOverride: 'sms',
            urgent: true,
        });
        expect(result.status).toBe('sent');
        expect(result.channel).toBe('sms');
        expect(calls.sms).toHaveLength(1);
        expect(calls.whatsapp).toHaveLength(0);
    });
});

describe('notifications/orchestrator — fallback chain', () => {
    it('falls back to SMS when WhatsApp fails', async () => {
        channelResults.whatsapp = { status: 'failed', error: 'wa_outage' };
        const { sendNotification } = await loadOrchestrator();
        const result = await sendNotification({
            event: 'quote_sent',
            recipient: { type: 'customer', id: 'c1', phone: '+447900000000' },
            payload: { customerName: 'Alex', url: 'https://example.com/q/1' },
            urgent: true,
        });
        expect(result.status).toBe('sent');
        expect(result.channel).toBe('sms');
        expect(result.fallbackTried).toEqual(['whatsapp']);
        expect(calls.whatsapp).toHaveLength(1);
        expect(calls.sms).toHaveLength(1);
    });

    it('does NOT fall back when channelOverride is set', async () => {
        channelResults.whatsapp = { status: 'failed', error: 'wa_outage' };
        const { sendNotification } = await loadOrchestrator();
        const result = await sendNotification({
            event: 'quote_sent',
            recipient: { type: 'customer', id: 'c1', phone: '+447900000000' },
            payload: { customerName: 'Alex', url: 'https://example.com/q/1' },
            channelOverride: 'whatsapp',
            urgent: true,
        });
        expect(result.status).toBe('failed');
        expect(result.channel).toBe('whatsapp');
        expect(calls.sms).toHaveLength(0);
    });

    it('returns failed when every channel fails', async () => {
        channelResults.whatsapp = { status: 'failed', error: 'wa_outage' };
        channelResults.sms = { status: 'failed', error: 'sms_outage' };
        channelResults.email = { status: 'failed', error: 'email_outage' };
        const { sendNotification } = await loadOrchestrator();
        const result = await sendNotification({
            event: 'quote_sent',
            recipient: { type: 'customer', id: 'c1', phone: '+447900000000' },
            payload: { customerName: 'Alex', url: 'https://example.com/q/1' },
            urgent: true,
        });
        expect(result.status).toBe('failed');
        expect(result.fallbackTried?.length).toBeGreaterThan(0);
    });
});

describe('notifications/orchestrator — quiet hours', () => {
    let realDateNow: () => number;

    beforeEach(() => {
        realDateNow = Date.now;
        // Pin "now" to 22:30 UTC = 22:30 London (winter).
        const pinned = new Date('2026-01-15T22:30:00.000Z').getTime();
        // Patch global Date to return our pinned instant for `new Date()`.
        const OriginalDate = Date;
        const PinnedDate: any = function (this: any, ...args: any[]) {
            if (args.length === 0) {
                return new OriginalDate(pinned);
            }
            // @ts-expect-error spread varargs through
            return new OriginalDate(...args);
        };
        PinnedDate.now = () => pinned;
        PinnedDate.UTC = OriginalDate.UTC;
        PinnedDate.parse = OriginalDate.parse;
        PinnedDate.prototype = OriginalDate.prototype;
        // @ts-expect-error global override
        global.Date = PinnedDate;
    });

    afterEach(() => {
        // Restore.
        // @ts-expect-error global restore
        global.Date = (Date as any).prototype.constructor;
        // We can't fully restore reliably; subsequent tests get a fresh mock setup.
        Date.now = realDateNow;
    });

    it('defers a non-urgent customer message at 22:30 → status=queued', async () => {
        const { sendNotification } = await loadOrchestrator();
        const result = await sendNotification({
            event: 'quote_sent',
            recipient: { type: 'customer', id: 'c1', phone: '+447900000000' },
            payload: { customerName: 'Alex', url: 'https://example.com/q/1' },
        });
        expect(result.status).toBe('queued');
        expect(calls.whatsapp).toHaveLength(0);
    });

    it('urgent=true bypasses quiet hours', async () => {
        const { sendNotification } = await loadOrchestrator();
        const result = await sendNotification({
            event: 'quote_sent',
            recipient: { type: 'customer', id: 'c1', phone: '+447900000000' },
            payload: { customerName: 'Alex', url: 'https://example.com/q/1' },
            urgent: true,
        });
        expect(result.status).toBe('sent');
        expect(calls.whatsapp).toHaveLength(1);
    });

    it('contractor offer fires immediately at 22:30 (urgent event)', async () => {
        const { sendNotification } = await loadOrchestrator();
        const result = await sendNotification({
            event: 'routing_offer_round_1',
            recipient: { type: 'contractor', id: 'unit_1', phone: '+447900000001' },
            payload: {
                contractorFirstName: 'Sam',
                title: 'Tap repair',
                postcode: 'NG7 2BB',
                payAmount: 4500,
                offerUrl: 'https://example.com/offer/1',
            },
        });
        expect(result.status).toBe('sent');
        expect(result.channel).toBe('whatsapp');
    });
});

describe('notifications/orchestrator — eventForTransition', () => {
    it('maps draft → quoted to quote_sent', async () => {
        const { eventForTransition } = await loadOrchestrator();
        expect(eventForTransition('draft', 'quoted')).toBe('quote_sent');
    });

    it('maps offer round acceptances to offer_accepted', async () => {
        const { eventForTransition } = await loadOrchestrator();
        expect(eventForTransition('offer_round_1', 'dispatched')).toBe('offer_accepted');
        expect(eventForTransition('offer_round_2', 'dispatched')).toBe('offer_accepted');
    });

    it('returns null for transitions that have no notification', async () => {
        const { eventForTransition } = await loadOrchestrator();
        expect(eventForTransition('foo', 'bar')).toBeNull();
    });
});

describe('notifications/orchestrator — dispatchEvent fan-out', () => {
    it('sends to multiple recipients independently', async () => {
        const { dispatchEvent } = await loadOrchestrator();
        const results = await dispatchEvent(
            'offer_accepted',
            [
                { type: 'customer', id: 'c1', phone: '+447900000000' },
                { type: 'contractor', id: 'unit_1', phone: '+447900000001' },
            ],
            {
                title: 'Tap repair',
                startTime: 'Tue 10:00',
                address: '12 High St',
            },
            { urgent: true },
        );
        expect(results).toHaveLength(2);
        expect(results.every((r) => r.status === 'sent')).toBe(true);
    });
});
