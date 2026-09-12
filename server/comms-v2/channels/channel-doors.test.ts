/**
 * The four new doors driven over HTTP the way the pipeline's test step drives them: every response
 * carries a planned send that fits the schema and lands on the thread; a form, an SMS, an email
 * and a call are one thread on the drama customer; the WhatsApp door still takes media.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_LINES, noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { plannedSendOfResponse, sendLanded } from '../desk/planned-send';
import { createSandboxDoor } from '../desk/sandbox-door';
import { emptyKb } from '../desk/scoping-tools';
import { SANDBOX_EMAIL } from './channel-doors';
import { EMAIL_DEFAULT_SUBJECT } from './email-adapter';

let server: import('node:http').Server;
let base: string;
let dir: string;
const TRANSCRIPT = 'Agent: Hi, Ben here about the bathroom fan. Customer: hi. Agent: send me a couple of photos of the fan and the switch and I will price it. Customer: will do this afternoon.';

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-doors-'));
    const client = new FakeModelClient({
        router: () => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: null, turnKind: 'enquiry' }),
        specialist: ({ user }) => /Transcript:/.test(user)
            ? { jobPhrase: 'the bathroom fan', jobType: 'bathroom extractor fan', location: null, benAskedFor: [{ subject: 'media', detail: 'photos of the fan and the switch' }], callbackAgreed: false, customerName: null, prefersText: false }
            : { facts: [{ key: 'job_type', value: 'bathroom extractor fan' }], jobUnknowns: [], answeredSubjects: [] },
        composer: ({ user }) => {
            if (user.includes('goes by SMS')) return { reply: `A dead fan, got it. Whereabouts are you? ${DEFAULT_FIXED_LINES.move_to_whatsapp}`, factIds: [], kbIds: [] };
            if (user.includes('goes by email')) return { reply: 'Thanks for the detail on the fan.\n\nWhereabouts are you?', factIds: [], kbIds: [] };
            if (user.includes('thank for media: yes')) return { reply: 'Thanks for the photo.\n\nIs there parking outside?', factIds: [], kbIds: [] };
            return { reply: 'Hi, a dead bathroom fan, got it.\n\nWhereabouts are you?\n\nHappy to give you a quick call if easier.', factIds: [], kbIds: [] };
        },
    });
    const templates = { async approved(name: string) { return name === 'web_enquiry_ack_context' || name === 'missed_call_ack' ? { contentSid: `HX_${name}` } : null; } };
    // A fixed clock inside Ben's hours: the acknowledgement's third variable is 'shortly' or 'in the morning' by the UK hour at send time, so wall-clock time must not decide it.
    const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
    const now = () => new Date(clock.t += 1000);
    const { router } = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates, kb: emptyKb, mediaDir: dir, now, scoping: { describe: async () => ({ ok: true, description: 'a ceiling fan', confidence: 'high', model: 'fake-vision', usage: null, durationMs: 1 }) } });
    const app = express();
    app.use(express.json());
    app.use('/api/comms-v2-sandbox', router);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/comms-v2-sandbox`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); fs.rmSync(dir, { recursive: true, force: true }); });

async function post(route: string, body?: unknown, form?: FormData) {
    const res = await fetch(`${base}${route}`, { method: 'POST', headers: form ? {} : { 'content-type': 'application/json' }, body: form ?? JSON.stringify(body ?? {}) });
    return { status: res.status, json: await res.json() as any };
}

describe('the channel doors', () => {
    it('sms: the opening SMS is answered on SMS, one message, with the move-to-WhatsApp line (1.4)', async () => {
        const r = await post('/start', { door: 'sms', text: 'my bathroom fan is dead', name: 'Sam', seed: { whatsapp: false } });
        expect(r.status).toBe(200);
        const ps = plannedSendOfResponse(r.json);
        expect(ps).toMatchObject({ channel: 'sms', windowState: 'open', templateId: null, delivered: true, party: { address: '+447700900942', name: 'Sam' } });
        expect(ps.bubbles).toHaveLength(1);
        expect(ps.bubbles[0]).toContain('WhatsApp');
        expect(sendLanded(ps, r.json.state)).toBe(true);
        expect(r.json.state.messages.map((m: any) => m.channel)).toEqual(['sms', 'sms']);
        expect(r.json.door).toBe('sms');
    });
    it('form: the acknowledgement carries the enquiry (1.2): the approved web form template on WhatsApp when the number is on it, else a freeform SMS', async () => {
        const onWa = await post('/start', { door: 'form', text: 'Bathroom extractor fan has died, light works but no fan', name: 'Priya K', postcode: 'NG9 2AB', seed: { whatsapp: true } });
        expect(onWa.status).toBe(200);
        const a = plannedSendOfResponse(onWa.json);
        expect(a).toMatchObject({ channel: 'whatsapp', windowState: 'shut', templateId: 'web_enquiry_ack_context', delivered: true });
        expect(a.bubbles[0]).toBe('Hi Priya, thanks for getting in touch. We got your message: "Bathroom extractor fan has died, light works but no fan". Is it OK if we give you a quick call shortly to run through it? Or just reply here with the details and we will price it up.');
        expect(onWa.json.state.caseFile.job.location).toBe('NG9 2AB');
        expect(onWa.json.state.caseFile.parties[0].channels.map((c: any) => c.kind)).toEqual(['form', 'sms', 'email', 'whatsapp']);
        expect(onWa.json.entry).toMatchObject({ kind: 'form', email: SANDBOX_EMAIL });
        const onSms = await post('/start', { door: 'form', text: 'Bathroom extractor fan has died', name: 'Priya K', seed: { whatsapp: false } });
        const b = plannedSendOfResponse(onSms.json);
        expect(b).toMatchObject({ channel: 'sms', templateId: null, delivered: true });
        expect(b.bubbles[0]).toContain('fan');
        // Then the same person writes on WhatsApp: one file, and the WhatsApp door still takes media.
        const form = new FormData();
        form.set('text', 'here is the fan');
        form.set('channel', 'whatsapp');
        form.append('media', new Blob([new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'))], { type: 'image/png' }), 'fan.png');
        const c = await post('/message', undefined, form);
        expect(c.status).toBe(200);
        expect(c.json.state.messages.map((m: any) => m.channel)).toEqual(['form', 'sms', 'whatsapp', 'whatsapp']);
        expect(plannedSendOfResponse(c.json).bubbles[0]).toMatch(/photo/);
    });
    it('email: one letter back on the same thread, greeting and sign-off, subject Re:', async () => {
        const r = await post('/start', { door: 'email', text: 'Hello,\n\nMy bathroom fan has died.\n\nRegards, Sam', subject: 'Bathroom fan', name: 'Sam Jones' });
        expect(r.status).toBe(200);
        const ps = plannedSendOfResponse(r.json);
        expect(ps).toMatchObject({ channel: 'email', windowState: 'open', templateId: null, delivered: true, party: { address: SANDBOX_EMAIL } });
        expect(ps.bubbles).toHaveLength(1);
        expect(ps.bubbles[0]).toMatch(/^Hi Sam,\n\nThanks for the detail on the fan\.\n\nWhereabouts are you\?\n\nThanks,\nBen\nHandy Services$/);
        expect(r.json.email).toMatchObject({ subject: 'Re: Bathroom fan' });
        expect(r.json.email.inReplyTo).toMatch(/^<door-/);
        const again = await post('/message', { text: 'NG9 2AB', channel: 'email' });
        expect(again.status).toBe(200);
        expect(again.json.state.messages.map((m: any) => m.channel)).toEqual(['email', 'email', 'email', 'email']);
        expect(again.json.email.references).toHaveLength(2);
        // An email with no subject: the evidence reports the subject the reply itself would carry, not a blank one.
        const bare = await post('/start', { door: 'email', text: 'Hello,\n\nMy bathroom fan has died.\n\nRegards, Sam', name: 'Sam Jones' });
        expect(bare.status).toBe(200);
        expect(bare.json.email).toMatchObject({ subject: EMAIL_DEFAULT_SUBJECT, references: [expect.stringMatching(/^<door-/)] });
    });
    it('call: a missed call gets one text back and an answered inbound call none (3.5); Ben ringing them sends the post-call follow-up and the thread carries on (3.2, 3.3)', async () => {
        const missed = await post('/start', { door: 'call', outcome: 'missed', name: 'Sam', seed: { whatsapp: true } });
        expect(missed.status).toBe(200);
        const m = plannedSendOfResponse(missed.json);
        expect(m).toMatchObject({ channel: 'whatsapp', windowState: 'shut', templateId: 'missed_call_ack', delivered: true });
        expect(m.bubbles[0]).toMatch(/^Hi Sam, sorry we missed your call/);
        expect(missed.json.entry).toMatchObject({ kind: 'call', outcome: 'missed' });
        const answered = await post('/start', { door: 'call', outcome: 'answered_inbound', transcript: TRANSCRIPT, name: 'Sam', seed: { whatsapp: true } });
        const a = plannedSendOfResponse(answered.json);
        expect(a.delivered).toBe(false);
        expect(a.bubbles).toEqual([]);
        expect(a.evidence.note).toMatch(/no acknowledgement/);
        expect(answered.json.state.caseFile.facts.some((f: any) => f.key === 'ben_asked_for')).toBe(true);
        // Ben rings them on the thread: no approved post-call template on this rig, so on WhatsApp it holds with the words; on SMS the words go.
        const rang = await post('/call', { transcript: TRANSCRIPT });
        expect(rang.status).toBe(200);
        const b = plannedSendOfResponse(rang.json);
        expect(b).toMatchObject({ channel: 'whatsapp', delivered: false });
        expect(b.hold?.reason).toMatch(/post_call_followup/);
        const onSms = await post('/start', { door: 'call', outcome: 'ben_rang', transcript: TRANSCRIPT, name: 'Sam', seed: { whatsapp: false } });
        const c = plannedSendOfResponse(onSms.json);
        expect(c).toMatchObject({ channel: 'sms', delivered: true, templateId: null });
        expect(c.bubbles[0]).toMatch(/good to speak just now about the bathroom fan/);
        expect(c.evidence.summary).toMatch(/asked for media/);
        expect((await post('/call', { transcript: 'short' })).status).toBe(400);
        expect((await post('/start', { door: 'call', outcome: 'nope' })).status).toBe(400);
        expect((await post('/start', { door: 'call', transcript: TRANSCRIPT })).status).toBe(400);
    });
});
