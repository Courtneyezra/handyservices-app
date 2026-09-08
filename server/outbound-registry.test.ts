/**
 * THE GATE, WITH THE REGISTRY IN FRONT OF IT (0.2, 8 Sep 2026).
 *
 * Everything below the registry is mocked — no Twilio, no database, no Pushover, no ledger — so
 * these cases are about ONE question: which sends does `sendCustomerMessage` let out, and under
 * what purpose, now that it consults server/sender-registry.ts?
 *
 * The opt-out mock is the real rule in miniature. A PLAIN STOP is a 'marketing' suppression: it
 * blocks a marketing send and lets a service reply through. That is what makes the booking
 * confirmation case (part C) a real regression test rather than a restatement of the fix — the
 * defect was that the confirmation passed no purpose, so the gate read a receipt for money the
 * customer had already paid as marketing and dropped it (S27 §3.1 A6, §7.3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sent: Array<{ to: string; body: string; opts: any }> = [];
const smsSent: Array<{ to: string; body: string }> = [];
let switches: Record<string, { enabled: boolean }> = {};

vi.mock('./meta-whatsapp', () => ({
    sendWhatsAppMessage: vi.fn(async (to: string, body: string, opts: any) => {
        sent.push({ to, body, opts });
        return { sid: 'SM_wa_1', status: 'queued' };
    }),
}));

vi.mock('./sms', () => ({
    sendSmsMessage: vi.fn(async (to: string, body: string) => { smsSent.push({ to, body }); return { sid: 'SM_sms_1', status: 'queued' }; }),
    toE164Recipient: (to: string) => {
        const digits = to.replace('@c.us', '').replace(/\D/g, '');
        if (digits.length < 8) throw new Error(`Invalid phone number: ${to}`);
        return `+${digits}`;
    },
    TwilioSendError: class TwilioSendError extends Error { constructor(m: string, readonly twilioCode: number | null) { super(m); } },
}));

/** A plain STOP: 'marketing' is suppressed, 'service_reply' is not. The real rule, in one line. */
vi.mock('./opt-out', () => ({
    blockedByOptOut: vi.fn(async (_e164: string, purpose: string) =>
        purpose === 'marketing'
            ? { scope: 'marketing' as const, at: new Date('2026-08-01T09:00:00Z'), source: 'sms_keyword', matchedKeyword: 'STOP' }
            : null),
    optOutRefusalMessage: () => 'They asked us to stop.',
    getOptOut: vi.fn(async () => ({ scope: 'marketing', at: new Date('2026-08-01T09:00:00Z'), source: 'sms_keyword' })),
}));

vi.mock('./pushover', () => ({ notifyOutboundSendFailure: vi.fn(async () => {}) }));
vi.mock('./system-events', () => ({ logSystemEvent: vi.fn(async () => {}) }));
vi.mock('./ledger', () => ({ ledgerMessageOut: vi.fn(async () => {}), ledgerDraftSent: vi.fn(async () => {}) }));
vi.mock('./handover', () => ({ noteHumanSend: vi.fn(async () => {}) }));
vi.mock('./db', () => ({ db: {} }));
vi.mock('./spine/config', () => ({ getSpineConfig: async () => ({ senders: switches }) }));

import { sendCustomerMessage } from './outbound';

const TO = '447700900123';

beforeEach(() => {
    sent.length = 0;
    smsSent.length = 0;
    switches = {};
});

describe('the registry decides whether a sender may send at all', () => {
    it('a name nothing has registered is refused before anything is spent', async () => {
        // The enum belt (`isApprover`) catches it first, which is the point: the enum and the
        // registry cover exactly the same names, and server/__tests__/sender-registry.test.ts is
        // what keeps them that way. The registry check below it is the second line, for the day
        // the two drift — it is also where the purpose and the switch come from, so it runs on
        // every send whether or not it ever refuses one.
        const r = await sendCustomerMessage({ approver: 'agent.rogue' as any, runId: 'run_1', to: TO, body: 'hello' });
        expect(r.ok).toBe(false);
        expect(r.error).toBe('MISSING_RUN_ID_OR_APPROVER');
        expect(sent).toEqual([]);
        expect(smsSent).toEqual([]);
    });

    it('an operational sender switched off in spine.senders is refused', async () => {
        switches = { lead_automations: { enabled: false } };
        const r = await sendCustomerMessage({ approver: 'system.lead_automation', runId: 'run_1', to: TO, body: 'a nudge', purpose: 'service_reply' });
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('SWITCHED_OFF');
        expect(sent).toEqual([]);
    });

    it('a transactional sender has no switch to be off, so nothing in the settings can stop it', async () => {
        // Even a row deliberately naming it: `system.notification` carries switchKey null, so the
        // gate never looks. This is the foot-gun s29 finding 1.16 asked us to make impossible.
        switches = { system_notification: { enabled: false }, notification: { enabled: false } };
        const r = await sendCustomerMessage({ approver: 'system.notification', runId: 'run_1', to: TO, body: 'your job is booked' });
        expect(r.ok).toBe(true);
        expect(sent).toHaveLength(1);
    });

    it('a sender with no row in spine.senders is ON — absent means on, and an unreadable row means on', async () => {
        switches = {};
        const on = await sendCustomerMessage({ approver: 'system.quick_reply', runId: 'run_1', to: TO, body: 'hi' });
        expect(on.ok).toBe(true);
    });
});

describe('the registry supplies the purpose a caller did not', () => {
    it('the booking confirmation reaches a customer who once wrote a plain STOP (part C)', async () => {
        // `system.notification` is the transactional name the booking confirmation, the job
        // notifications and the failure-recovery SMS all send under. No purpose passed here — the
        // registry's 'service_reply' is what carries it past the marketing suppression.
        const r = await sendCustomerMessage({ approver: 'system.notification', runId: 'run_1', to: TO, body: '✅ Booking Confirmed!' });
        expect(r.ok).toBe(true);
        expect(sent).toHaveLength(1);
        expect(sent[0].body).toContain('Booking Confirmed');
    });

    it('and the same STOP still blocks a marketing send to the same person', async () => {
        const r = await sendCustomerMessage({ approver: 'system.lead_automation', runId: 'run_1', to: TO, body: 'Still thinking about that job?' });
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('OPTED_OUT');
        expect(sent).toEqual([]);
    });

    it('an explicit purpose always beats the registered one', async () => {
        // The Twilio failure-recovery SMS says 'marketing' out loud precisely so it keeps failing
        // closed: it re-sends whatever words just failed, and those may have been a campaign.
        const r = await sendCustomerMessage({ approver: 'system.notification', runId: 'run_1', to: TO, body: 'a resend', channel: 'sms', purpose: 'marketing' });
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('OPTED_OUT');
    });

    it('a person carries no registered purpose, so an unstated one still fails closed as marketing', async () => {
        const r = await sendCustomerMessage({ approver: 'human:ben@handyservices.app', runId: 'run_1', to: TO, body: 'typed by hand' });
        expect(r.ok).toBe(false);
        expect(r.reason).toBe('OPTED_OUT');
        const stated = await sendCustomerMessage({ approver: 'human:ben@handyservices.app', runId: 'run_1', to: TO, body: 'typed by hand', purpose: 'service_reply' });
        expect(stated.ok).toBe(true);
    });
});

describe('the composer\'s Meta and template route now travels through the gate (part B)', () => {
    it('the template name reaches the wire, and no SMS fallback is attempted', async () => {
        const r = await sendCustomerMessage({
            approver: 'human:ben@handyservices.app', runId: 'run_1', to: TO, body: 'rendered words',
            via: 'meta', templateName: 'holding_line_v1', templateLanguage: 'en_GB',
            allowSmsFallback: false, purpose: 'service_reply',
        });
        expect(r.ok).toBe(true);
        expect(sent[0].opts).toMatchObject({ via: 'meta', templateName: 'holding_line_v1', templateLanguage: 'en_GB' });
        expect(smsSent).toEqual([]);
    });

    it('a run id is still required on that route, exactly as on every other', async () => {
        const r = await sendCustomerMessage({ approver: 'human:ben@x', runId: '', to: TO, body: 'x', via: 'meta' } as any);
        expect(r.ok).toBe(false);
        expect(r.error).toBe('MISSING_RUN_ID_OR_APPROVER');
    });
});
