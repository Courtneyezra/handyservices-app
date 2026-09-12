/**
 * The old inputs behind the one switch: off means nothing runs; on means each event becomes the
 * matching envelope and reaches the gateway.
 */
import { describe, expect, it } from 'vitest';
import type { CaseFile, Turn } from '../desk/case-file';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import { ChannelGateway } from './channel-gateway';
import { INTAKE_ENV, INTAKE_REQUIREMENTS, envelopesOf, forwardNow, forwardToCommsV2, intakeEnabled, resetLiveChannelGateway } from './intake';

const turns: Turn[] = [];
const fakeDesk: DeskLike = {
    async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> { turns.push(turn); return { runId: 'r', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 }; },
    async clockPass(file: CaseFile): Promise<DeskResult> { return this.handleTurn(file, file.turns[0]); },
};

describe('the intake switch', () => {
    it('is off unless COMMS_V2_INTAKE is exactly 1, the way COMMS_WORKER is read, and off means a forward does nothing', () => {
        expect(intakeEnabled({})).toBe(false);
        for (const v of ['0', 'false', 'true', 'on', 'yes', 'TRUE', '11']) expect({ v, on: intakeEnabled({ [INTAKE_ENV]: v }) }).toEqual({ v, on: false });
        for (const v of ['1', ' 1 ']) expect({ v, on: intakeEnabled({ [INTAKE_ENV]: v }) }).toEqual({ v, on: true });
        const before = turns.length;
        forwardToCommsV2({ kind: 'twilio_incoming', body: { From: '+447700900942', Body: 'hi' } }, {});
        expect(turns.length).toBe(before);
    });
    it('refuses to start while a requirement is outstanding: nothing is read, nothing reaches a desk, and the refusal names what is missing', async () => {
        expect(INTAKE_REQUIREMENTS.length).toBeGreaterThan(0);
        resetLiveChannelGateway();
        const before = turns.length;
        await expect(forwardNow({ kind: 'twilio_incoming', body: { From: '+447700900942', Body: 'hi' } })).rejects.toThrow(new RegExp(`${INTAKE_ENV} is on but the intake refuses to start`));
        await expect(forwardNow({ kind: 'twilio_incoming', body: { From: '+447700900942', Body: 'hi' } })).rejects.toThrow(/persistent case file store/);
        await expect(forwardNow({ kind: 'call_finished', callRecordId: 'c1' })).rejects.toThrow(/internal-number directory/);
        expect(turns.length).toBe(before);
        resetLiveChannelGateway();
    });
    it('shapes each event through its adapter: an SMS and a WhatsApp on the Twilio webhook, a form', async () => {
        const sms = await envelopesOf({ kind: 'twilio_incoming', body: { From: '+447700900942', Body: 'hi', MessageSid: 'SM1' } });
        expect(sms.envelopes[0]).toMatchObject({ channel: 'sms', address: '+447700900942', text: 'hi' });
        const wa = await envelopesOf({ kind: 'twilio_incoming', body: { From: 'whatsapp:+447700900942', Body: 'hi', NumMedia: '0' } });
        expect(wa.envelopes[0]).toMatchObject({ channel: 'whatsapp', via: 'twilio' });
        const meta = await envelopesOf({ kind: 'meta_webhook', payload: { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: '447700900942', type: 'text', text: { body: 'yo' } }] } }] }] } });
        expect(meta.envelopes[0]).toMatchObject({ channel: 'whatsapp', via: 'meta', text: 'yo' });
        const form = await envelopesOf({ kind: 'web_form', lead: { customerName: 'P', phone: '07700900942', email: 'p@x.co', jobDescription: 'fan', postcode: 'NG9 2AB', source: 'web_quote', leadId: 'lead_1' } });
        expect(form.envelopes[0]).toMatchObject({ channel: 'form', kind: 'form', providerMessageId: 'lead_1' });
    });
    it('forwards into the gateway when on', async () => {
        resetLiveChannelGateway(new ChannelGateway({ desk: fakeDesk }));
        const before = turns.length;
        const report = await forwardNow({ kind: 'twilio_incoming', body: { From: '+447700900942', Body: 'my gate has dropped' } });
        expect(report).toEqual({ forwarded: 1, skipped: [] });
        expect(turns.length).toBe(before + 1);
        expect(turns[turns.length - 1]).toMatchObject({ channel: 'sms', body: 'my gate has dropped' });
        resetLiveChannelGateway();
    });
});

