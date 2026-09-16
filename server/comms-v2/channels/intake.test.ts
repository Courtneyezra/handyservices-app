/**
 * The old inputs behind the one switch: off means nothing runs; on means each event becomes the
 * matching envelope and reaches the gateway.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaseFile, Turn } from '../desk/case-file';
import type { DeskLike, DeskResult } from '../desk/desk-types';
import { ChannelGateway } from './channel-gateway';
import { INTAKE_DESK_MODE, INTAKE_ENV, INTAKE_REQUIREMENTS, builtIntakeGateway, deliveryLabelFor, envelopesOf, forwardNow, forwardToCommsV2, intakeEnabled, liveChannelGateway, resetLiveChannelGateway } from './intake';

const turns: Turn[] = [];
const fakeDesk: DeskLike = {
    async handleTurn(file: CaseFile, turn: Turn): Promise<DeskResult> { turns.push(turn); return { runId: 'r', decision: 'none', partyId: file.parties[0].personId, channel: null, windowState: 'open', templateId: null, bubbles: [], factIds: [], kbIds: [], guards: {} as any, approver: null, hold: null, delivered: false, stageAfter: file.stage, calls: [], note: null, summary: null, error: null, landedTurnId: null, composerCalls: 0 }; },
    async clockPass(file: CaseFile): Promise<DeskResult> { return this.handleTurn(file, file.turns[0]); },
};

describe('the intake switch', () => {
    afterEach(() => { vi.unstubAllEnvs(); });
    it('is off unless COMMS_V2_INTAKE is exactly 1, the way COMMS_WORKER is read, and off means a forward does nothing', () => {
        expect(intakeEnabled({})).toBe(false);
        for (const v of ['0', 'false', 'true', 'on', 'yes', 'TRUE', '11']) expect({ v, on: intakeEnabled({ [INTAKE_ENV]: v }) }).toEqual({ v, on: false });
        for (const v of ['1', ' 1 ']) expect({ v, on: intakeEnabled({ [INTAKE_ENV]: v }) }).toEqual({ v, on: true });
        const before = turns.length;
        forwardToCommsV2({ kind: 'twilio_incoming', body: { From: '+447700900942', Body: 'hi' } }, {});
        expect(turns.length).toBe(before);
    });
    it('has no requirement outstanding once the internal-number directory landed, and a build without the branch database still refuses: nothing reaches a desk', async () => {
        expect(INTAKE_REQUIREMENTS).toEqual([]);
        vi.stubEnv('COMMS_V2_DATABASE_URL', undefined);
        resetLiveChannelGateway();
        const before = turns.length;
        await expect(forwardNow({ kind: 'twilio_incoming', body: { From: '+447700900942', Body: 'hi' } })).rejects.toThrow(/COMMS_V2_DATABASE_URL/);
        expect(turns.length).toBe(before);
        resetLiveChannelGateway();
    });
    it('shapes each event through its adapter: an SMS and a WhatsApp on the Twilio webhook, a form', async () => {
        const sms = await envelopesOf({ kind: 'twilio_incoming', body: { From: '+447700900942', Body: 'hi', MessageSid: 'SM1' } });
        expect(sms.envelopes[0]).toMatchObject({ channel: 'sms', address: '+447700900942', text: 'hi' });
        const wa = await envelopesOf({ kind: 'twilio_incoming', body: { From: 'whatsapp:+447700900942', Body: 'hi', NumMedia: '0' } });
        expect(wa.envelopes[0]).toMatchObject({ channel: 'whatsapp', via: 'twilio' });
        // A received email arrives already read from Resend by the webhook (email-inbound.ts) and passes through as it is.
        const envelope = { channel: 'email' as const, address: 'sam@example.com', name: null, text: 'hi', media: [], at: '2026-09-16T09:00:00.000Z', providerMessageId: '<m@x>', via: 'resend', mediaFailures: [] };
        expect(await envelopesOf({ kind: 'email_received', envelope })).toEqual({ envelopes: [envelope], skipped: [] });
        const meta = await envelopesOf({ kind: 'meta_webhook', payload: { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { messages: [{ from: '447700900942', type: 'text', text: { body: 'yo' } }] } }] }] } });
        expect(meta.envelopes[0]).toMatchObject({ channel: 'whatsapp', via: 'meta', text: 'yo' });
        const form = await envelopesOf({ kind: 'web_form', lead: { customerName: 'P', phone: '07700900942', email: 'p@x.co', jobDescription: 'fan', postcode: 'NG9 2AB', source: 'web_quote', leadId: 'lead_1' } });
        expect(form.envelopes[0]).toMatchObject({ channel: 'form', kind: 'form', providerMessageId: 'lead_1' });
    });
    it('forgets a build that failed, so the next forward builds again rather than repeating the failure for the life of the process', async () => {
        vi.stubEnv('COMMS_V2_DATABASE_URL', undefined);
        resetLiveChannelGateway();
        const first = liveChannelGateway();
        await expect(first).rejects.toThrow();
        const second = liveChannelGateway();
        expect(second).not.toBe(first);
        await expect(second).rejects.toThrow();
        resetLiveChannelGateway();
    });
    it('builds for the purpose the switches give now, shares one build, and builds again for the other purpose when a switch moves', async () => {
        resetLiveChannelGateway();
        let liveNow = false;
        const built: string[] = [];
        const deps = {
            requirements: [] as string[],
            liveState: async () => ({ live: liveNow, off: liveNow ? [] : ['spine.commsDesk = \'comms_v2\''] }),
            build: async (purpose: 'sandbox' | 'live') => { built.push(purpose); return new ChannelGateway({ desk: fakeDesk }); },
        };
        const [a, b] = await Promise.all([liveChannelGateway(deps), liveChannelGateway(deps)]);
        expect(a).toBe(b);
        expect(built).toEqual(['sandbox']);
        liveNow = true;
        const c = await liveChannelGateway(deps);
        expect(c).not.toBe(a);
        expect(built).toEqual(['sandbox', 'live']);
        expect(builtIntakeGateway()).toMatchObject({ purpose: 'live', gateway: c });
        liveNow = false;
        await liveChannelGateway(deps);
        expect(built).toEqual(['sandbox', 'live', 'sandbox']);
        resetLiveChannelGateway();
    });
    it('delivers only from the live desk: the sandbox purpose never delivers', () => {
        expect(INTAKE_DESK_MODE).toEqual({ sandbox: 'dry_run', live: 'live' });
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
    it('labels the decision log with the gateway\'s real delivery mode, never a fixed word', () => {
        expect(deliveryLabelFor('sandbox')).toBe('dry run');
        expect(deliveryLabelFor('live')).toBe('live delivery');
        expect(deliveryLabelFor('any')).toBe('dry run');
        expect(deliveryLabelFor(undefined)).toBe('dry run');
    });
    it('logs each decision with the mode of the gateway that handled it, even when the switches move while the forward runs', async () => {
        const lines: string[] = [];
        const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => { lines.push(String(line)); });
        try {
            const event = { kind: 'twilio_incoming', body: { From: '+447700900942', Body: 'the tap drips' } } as const;
            resetLiveChannelGateway();
            const flipWhileBuilding = async () => { void Promise.resolve().then(() => resetLiveChannelGateway()); return new ChannelGateway({ desk: fakeDesk }); };
            await forwardNow(event, { requirements: [], liveState: async () => ({ live: true, off: [] }), build: flipWhileBuilding });
            expect(builtIntakeGateway()).toBeNull();
            resetLiveChannelGateway(new ChannelGateway({ desk: fakeDesk }), 'sandbox');
            await forwardNow(event, { requirements: [], liveState: async () => ({ live: false, off: ['spine.commsDesk = \'comms_v2\''] }) });
            const decisions = lines.filter((l) => l.startsWith('[comms-v2 intake] twilio_incoming -> case '));
            expect(decisions).toHaveLength(2);
            expect(decisions[0]).toMatch(/\(live delivery\)$/);
            expect(decisions[1]).toMatch(/\(dry run\)$/);
        } finally {
            spy.mockRestore();
            resetLiveChannelGateway();
        }
    });
});

