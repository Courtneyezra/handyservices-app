/**
 * The new desk's sandbox door, driven over HTTP the way the pipeline's test step drives it: start,
 * message (with media), run, age, reset, state. Every response carries a planned send that fits
 * the schema in planned-send.ts, and a dry-run reply lands on the thread so the next turn sees it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noFixedLineSource } from './fixed-lines';
import { FakeModelClient } from './models';
import { plannedSendOfResponse, sendLanded } from './planned-send';
import { createSandboxDoor } from './sandbox-door';
import { emptyKb } from './scoping-tools';
import { noTemplateApproved } from './sender';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';
import { emptyPriceBook } from '../quoting/quoting-tools';

let server: import('node:http').Server;
let base: string;
let dir: string;

beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-door-'));
    const client = new FakeModelClient({
        router: ({ user }) => ({ subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception: /how much/i.test(user.split('>>').pop() ?? '') ? 'money' : null, turnKind: 'enquiry' }),
        specialist: () => ({ facts: [{ key: 'job_type', value: 'leaking tap' }], jobUnknowns: [], answeredSubjects: [] }),
        composer: ({ user }) => ({ reply: user.includes('thank for media: yes') ? 'Thanks for the photo, that helps.\n\nWhereabouts are you?' : 'Hi Sam, a leaking tap, got it.\n\nWhereabouts are you?\n\nHappy to give you a quick call if easier.', factIds: [], kbIds: [] }),
    });
    const store = new MemoryQuoteStore();
    const { router } = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, mediaDir: dir, scoping: { describe: async () => ({ ok: true, description: 'a dripping tap', confidence: 'high', model: 'fake-vision', usage: null, durationMs: 1 }) }, quoting: { store, drafter: new FakeDrafter(store), notifier: recordingNotifier, priceBook: emptyPriceBook } });
    const app = express();
    app.use(express.json());
    app.use('/api/comms-v2-sandbox', router);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}/api/comms-v2-sandbox`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); fs.rmSync(dir, { recursive: true, force: true }); });

async function post(route: string, body?: unknown, form?: FormData) {
    const res = await fetch(`${base}${route}`, { method: 'POST', headers: form ? {} : { 'content-type': 'application/json' }, body: form ?? JSON.stringify(body ?? {}) });
    return { status: res.status, json: await res.json() as any };
}

describe('the new desk\'s sandbox door', () => {
    it('start opens the thread, replies, and the response carries a planned send that fits the schema, landed on the thread', async () => {
        const r = await post('/start', { door: 'whatsapp', text: 'Hi, a leaking tap', name: 'Sam', seed: { prefersText: false } });
        expect(r.status).toBe(200);
        const plannedSend = plannedSendOfResponse(r.json);
        expect(plannedSend.delivered).toBe(true);
        expect(plannedSend.bubbles).toHaveLength(3);
        expect(plannedSend.party).toEqual({ role: 'homeowner', address: '+447700900942', name: 'Sam' });
        expect(plannedSend.approver).toBe('agent.comms_v2');
        expect(plannedSend.factIds).toEqual([]);
        expect(Object.keys(plannedSend.guards)).toHaveLength(8);
        expect(sendLanded(plannedSend, r.json.state)).toBe(true);
        expect(r.json.state.conversation.stage).toBe('scoping');
        expect(r.json.state.messages.map((m: any) => m.direction)).toEqual(['inbound', 'outbound']);
        expect(r.json.state.window.canFreeform).toBe(true);
    });
    it('a clock pass sends nothing and still returns a pass; the window state is on the response', async () => {
        const r = await post('/run', { trigger: 'manual' });
        expect(r.status).toBe(200);
        const plannedSend = plannedSendOfResponse(r.json);
        expect(plannedSend.delivered).toBe(false);
        expect(plannedSend.bubbles).toEqual([]);
        expect(plannedSend.evidence.decision).toBe('none');
    });
    it('a money turn holds for ben on the planned send', async () => {
        const r = await post('/message', { text: 'How much roughly?', channel: 'whatsapp' });
        const plannedSend = plannedSendOfResponse(r.json);
        expect(plannedSend.hold).toMatchObject({ approver: 'ben' });
    });
    it('age shuts the window; a later customer turn reopens it', async () => {
        const aged = await post('/age', { hours: 25 });
        expect(aged.json.window.canFreeform).toBe(false);
        const again = await post('/message', { text: 'still there?', channel: 'whatsapp' });
        expect(again.json.state.window.canFreeform).toBe(true);
    });
    it('a first message with a photo after reset opens the thread, describes the photo and thanks for it', async () => {
        await post('/reset');
        const form = new FormData();
        form.set('text', 'this is the tap');
        form.set('channel', 'whatsapp');
        form.append('media', new Blob([new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'))], { type: 'image/png' }), 'tap.png');
        const r = await post('/message', undefined, form);
        expect(r.status).toBe(200);
        const plannedSend = plannedSendOfResponse(r.json);
        expect(plannedSend.bubbles[0]).toMatch(/photo/);
        expect(r.json.state.caseFile.turns[0].media[0].description.description).toBe('a dripping tap');
        expect(r.json.state.caseFile.facts.some((f: any) => f.key === 'media_image')).toBe(true);
        expect(fs.readdirSync(dir).length).toBe(1);
    });
    it('refuses the doors that are not open in Goal 1', async () => {
        expect((await post('/call', { transcript: 'x'.repeat(50) })).status).toBe(409);
        expect((await post('/price', {})).status).toBe(409);
        expect((await post('/start', { door: 'sms', text: 'hi' })).status).toBe(400);
    });
});
