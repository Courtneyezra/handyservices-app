/**
 * The Quoting part of the sandbox door, driven over HTTP the way the pipeline's test step drives
 * it: the ready turn drafts the quote and records Ben's push; the clock chases it; Ben prices and
 * sends in dry run and the customer gets the link as a planned send under human:ben; a question
 * after the quote is answered with a figure that is a cited quote line, to the penny; acceptance
 * flips the stage, records Ben's push and gets one acknowledgement; the refusals; reset.
 *
 * The thread carries a photo before Ben prices, on purpose. His message opens "thanks for the
 * photos and the details", the desk thanked for that photo two turns earlier, and the ask-ledger
 * guard refuses a second thanks: a thread with no photo cannot fail on it, so this one has one
 * (behaviour.md answer 43, and Contract 4 no longer runs over a send a person authored).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { plannedSendOfResponse, sendLanded } from '../desk/planned-send';
import { createSandboxDoor } from '../desk/sandbox-door';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import { recordingNotifier } from './ben-notifier';
import { FakeDrafter } from './draft-quote';
import { MemoryQuoteStore } from './quote-store';
import { emptyPriceBook } from './quoting-tools';

let server: import('node:http').Server;
let base: string;
let mediaDir: string;
const store = new MemoryQuoteStore({ baseUrl: 'https://test.local' });

const intakeOutput = { lines: [{ title: 'Replace kitchen tap', category: 'plumbing', qty: 1, detail: 'mixer tap, dripping at the base', assumptions: ['You supply the new tap'], notIncluded: ['A new tap'] }], customerType: 'homeowner', missing: [] };

beforeAll(async () => {
    const client = new FakeModelClient({
        router: ({ user }) => {
            const last = user.split('>>').pop() ?? '';
            const money = /how much|cheaper/i.test(last);
            return { subjects: money ? ['quoting'] : ['scoping'], proposedStage: 'scoping', party: 'customer', exception: money ? 'money' : null, turnKind: /Accepted quote/.test(last) ? 'acknowledgement' : 'question' };
        },
        specialist: ({ system, user }) => {
            if (/lines of a quote/.test(system)) return intakeOutput;
            if (/what it concerns/.test(system)) return { concerns: [{ kind: 'line_amount', label: 'Replace kitchen tap labour' }], beyondQuoteLine: /cheaper/i.test(user.split('>>').pop() ?? ''), acceptanceInChat: false, notReady: false };
            return { facts: [{ key: 'job_type', value: 'leaking kitchen tap' }, { key: 'location', value: 'NG9 2AB' }], jobUnknowns: [], answeredSubjects: ['job', 'postcode'] };
        },
        composer: ({ user }) => {
            if (/they accepted the quote on the quote page/.test(user)) return { reply: 'Brilliant, thank you Sam.\n\nBen has been told and will be in touch about the day.', factIds: [], kbIds: [] };
            if (/thank for media: yes/.test(user)) return { reply: 'Thanks for the photo, that is the one.\n\nBen has everything he needs now.', factIds: [], kbIds: [] };
            const m = /^(fact_[^:]+): quote_line:Replace kitchen tap labour = (£[\d.]+)$/m.exec(user);
            if (m && /answer from the quote only/.test(user)) return { reply: `It covers taking the old tap out and fitting the new one, and you supply the tap.\n\nThe labour on your quote is ${m[2]}.`, factIds: [m[1]], kbIds: [] };
            if (/beyond a line of the quote/.test(user)) return { reply: 'Ben will come back to you on the price.', factIds: [], kbIds: [] };
            return { reply: 'Hi Sam, a leaking kitchen tap in NG9, got it.\n\nThat is everything needed for now, Ben will put the quote together and send it over.', factIds: [], kbIds: [] };
        },
    });
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-quoting-door-'));
    const { router } = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, mediaDir, scoping: { describe: async () => ({ ok: true, description: 'a dripping mixer tap', confidence: 'high', model: 'fake-vision', usage: null, durationMs: 1 }) }, quoting: { store, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, priceBook: emptyPriceBook, baseUrl: 'https://test.local' } });
    const app = express();
    app.use(express.json());
    app.use('/api/comms-v2-sandbox', router);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}/api/comms-v2-sandbox`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); fs.rmSync(mediaDir, { recursive: true, force: true }); });

async function post(route: string, body?: unknown, form?: FormData) {
    const res = await fetch(`${base}${route}`, { method: 'POST', headers: form ? {} : { 'content-type': 'application/json' }, body: form ?? JSON.stringify(body ?? {}) });
    return { status: res.status, json: await res.json() as any };
}
async function get(route: string) { const res = await fetch(`${base}${route}`); return { status: res.status, json: await res.json() as any }; }

describe('the quoting door', () => {
    it('refuses to price or accept before there is a thread or a quote', async () => {
        expect((await post('/price', {})).status).toBe(409);
        expect((await post('/accept', {})).status).toBe(409);
        expect((await get('/quote')).status).toBe(409);
    });

    it('the ready turn drafts the quote without further prompting and records one push to Ben with the price screen link', async () => {
        const r = await post('/start', { door: 'whatsapp', text: 'Hi, my kitchen tap is leaking, NG9 2AB', name: 'Sam' });
        expect(r.status).toBe(200);
        const ps = plannedSendOfResponse(r.json);
        expect(ps.delivered).toBe(true);
        expect(ps.bubbles.join(' ')).not.toMatch(/£/);
        expect(ps.evidence.summary).toMatch(/quoting: drafted/);
        expect(r.json.state.conversation.stage).toBe('ready');
        const q = r.json.state.quote;
        expect(q.slug).toBeTruthy();
        expect(q.notifications).toHaveLength(1);
        expect(q.notifications[0]).toMatchObject({ kind: 'ready_to_price', link: `https://test.local/admin/price/${q.slug}` });
        expect(q.priceScreen).toBe(`https://test.local/admin/price/${q.slug}`);
        const state = await get('/quote');
        expect(state.json.record.status).toBe('draft');
        expect(state.json.record.lines[0].pricePence).toBeNull();
        expect((await post('/accept', {})).status).toBe(409);
    });

    it('a clock pass chases the unpriced draft once it is due, never the customer', async () => {
        const quiet = await post('/run', {});
        expect(plannedSendOfResponse(quiet.json).evidence.note).toMatch(/not due/);
        await post('/age', { hours: 5 });
        const due = await post('/run', {});
        const ps = plannedSendOfResponse(due.json);
        expect(ps.delivered).toBe(false);
        expect(ps.bubbles).toEqual([]);
        expect(ps.evidence.note).toMatch(/chase 1 recorded for Ben/);
        expect(due.json.state.quote.notifications.map((n: any) => n.kind)).toEqual(['ready_to_price', 'chase']);
    });

    it('a photo sent while the draft is with Ben is thanked for once and joins the quote', async () => {
        const form = new FormData();
        form.set('text', 'here is the tap');
        form.set('channel', 'whatsapp');
        form.append('media', new Blob([new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'))], { type: 'image/png' }), 'tap.png');
        const r = await post('/message', undefined, form);
        expect(r.status).toBe(200);
        expect(plannedSendOfResponse(r.json).bubbles.join(' ')).toMatch(/Thanks for the photo/);
        expect(r.json.state.caseFile.ledger.find((l: any) => l.subject === 'media')?.thankedAt).toBeTruthy();
        expect(store.rows.get(r.json.state.quote.slug)?.customerPhotoUrls).toHaveLength(1);
    });

    it('Ben prices and sends: the customer gets the link as a planned send under human:ben, the stage moves to quoted', async () => {
        const r = await post('/price', { lines: [{ lineId: 'card_1', finalPence: 12000 }] });
        expect(r.status).toBe(200);
        const ps = plannedSendOfResponse(r.json);
        expect(ps.approver).toBe('human:ben');
        expect(ps.delivered).toBe(true);
        expect(ps.bubbles.join(' ')).toContain(`https://test.local/quote/${r.json.slug}`);
        // His words thank for the photos the desk has already thanked for, and carry his total.
        // Contract 4 would refuse both; it does not run over a send he authored (answer 43), and
        // the file says so rather than claiming a pass.
        expect(ps.bubbles.join(' ')).toMatch(/thanks for the photos/i);
        expect(Object.values(ps.guards).every((g) => g.result === 'not_applied')).toBe(true);
        expect(ps.guards.ask_ledger.note).toMatch(/a person authored this send/);
        expect(sendLanded(ps, r.json.state)).toBe(true);
        expect(r.json.state.conversation.stage).toBe('quoted');
        expect(r.json.totals.totalPence).toBe(12000);
        const state = await get('/quote');
        expect(state.json.record.status).toBe('sent');
        expect(state.json.record.lines[0]).toMatchObject({ label: 'Replace kitchen tap', pricePence: 12000, labourPence: 10000, materialsPence: 2000 });
        expect((await post('/price', {})).status).toBe(409);
    });

    it('a question after the quote is answered from it: the figure equals the cited line to the penny and every guard passes', async () => {
        const r = await post('/message', { text: 'What does that include, and how much is the labour?', channel: 'whatsapp' });
        expect(r.status).toBe(200);
        const ps = plannedSendOfResponse(r.json);
        expect(ps.delivered).toBe(true);
        expect(ps.hold).toBeNull();
        expect(ps.bubbles.join(' ')).toContain('£100.00');
        expect(ps.guards.figure.result).toBe('pass');
        expect(Object.values(ps.guards).every((g) => g.result === 'pass')).toBe(true);
        const cited = r.json.state.caseFile.facts.find((f: any) => ps.factIds.includes(f.id));
        expect(cited).toMatchObject({ key: 'quote_line:Replace kitchen tap labour', value: '£100.00', source: { kind: 'quote_line', line: 'Replace kitchen tap labour' } });
    });

    it('money beyond a quote line holds for Ben', async () => {
        const r = await post('/message', { text: 'Can you do it any cheaper?', channel: 'whatsapp' });
        const ps = plannedSendOfResponse(r.json);
        expect(ps.hold).toMatchObject({ approver: 'ben' });
        expect(ps.hold?.reason).toMatch(/money beyond a quote line/);
        expect(ps.bubbles.join(' ')).not.toMatch(/£/);
    });

    it('acceptance flips the thread, records Ben\'s push, and the customer gets one acknowledgement', async () => {
        const r = await post('/accept', {});
        expect(r.status).toBe(200);
        expect(r.json.notice.title).toBe('Quote accepted');
        expect(r.json.state.conversation.stage).toBe('accepted');
        const ps = plannedSendOfResponse(r.json);
        expect(ps.delivered).toBe(true);
        expect(ps.bubbles.join(' ')).toMatch(/Ben has been told/);
        expect(Object.values(ps.guards).every((g) => g.result === 'pass')).toBe(true);
        expect(r.json.state.quote.notifications.map((n: any) => n.kind)).toEqual(['ready_to_price', 'chase', 'accepted']);
        const state = await get('/quote');
        expect(state.json.record.status).toBe('accepted');
        expect((await post('/accept', {})).status).toBe(409);
    });

    it('reset clears the sandbox quotes', async () => {
        const r = await post('/reset');
        expect(r.status).toBe(200);
        expect(r.json.quotes.quotes).toBe(1);
        expect(store.rows.size).toBe(0);
    });
});
