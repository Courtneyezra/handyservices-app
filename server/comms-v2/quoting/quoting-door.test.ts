/**
 * The Quoting part of the sandbox door, driven over HTTP the way the pipeline's test step drives
 * it: the ready turn drafts the quote and records Ben's push; the clock chases it; Ben prices and
 * sends in dry run and the customer gets the link as a planned send under human:ben; a question
 * after the quote is answered with a figure that is a cited quote line, to the penny; acceptance
 * flips the stage, records Ben's push and gets one acknowledgement; the refusals; reset.
 *
 * The delivery message is the desk composer's, not the spine's canned draft, and Contract 4 runs
 * over it: the quote is never marked sent unless the text that went is the quote, so a shut window
 * and a guard failure both hold for Ben and leave the quote a draft he can price again.
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
            if (/what it concerns/.test(system)) return { concerns: [{ kind: 'line_amount', label: 'Replace kitchen tap' }], beyondQuoteLine: /cheaper/i.test(user.split('>>').pop() ?? ''), acceptanceInChat: false, notReady: false };
            return { facts: [{ key: 'job_type', value: 'leaking kitchen tap' }, { key: 'location', value: 'NG9 2AB' }], jobUnknowns: [], answeredSubjects: ['job', 'postcode'] };
        },
        composer: ({ user }) => {
            if (/they accepted the quote on the quote page/.test(user)) return { reply: 'Brilliant, thank you Sam.\n\nBen has been told and will be in touch about the day.', factIds: [], kbIds: [] };
            // The composer thanks in its own words, without naming the photo: the ledger's mark
            // comes from the desk's instruction, not from the sentence that went.
            if (/thank for media: yes/.test(user)) return { reply: 'Thanks for sending that over, that is the one.\n\nBen has everything he needs now.', factIds: [], kbIds: [] };
            const m = /^(fact_[^:]+): quote_line:Replace kitchen tap = (£[\d.]+)$/m.exec(user);
            if (m && /answer from the quote only/.test(user)) return { reply: `It covers taking the old tap out and fitting the new one, and you supply the tap.\n\nThat line on your quote is ${m[2]}.`, factIds: [m[1]], kbIds: [] };
            if (/Ben has priced the quote and is sending it now/.test(user)) {
                const link = /(https:\/\/test\.local\/quote\/[a-z0-9]+)/.exec(user)?.[1] ?? '';
                // Second attempt: the first draft carries a figure the guards refuse, so the file
                // shows the retry the desk gives any composed reply.
                if (/failed these checks/.test(user)) return { reply: `Your quote is ready, Sam.\n\nEverything is on the link: ${link}\n\nJust reply here with any questions.`, factIds: [], kbIds: [] };
                return { reply: `Your quote is ready, Sam, £120.00 all in.\n\nEverything is on the link: ${link}`, factIds: [], kbIds: [] };
            }
            if (/beyond a line of the quote/.test(user)) return { reply: 'Ben will come back to you on the price.', factIds: [], kbIds: [] };
            return { reply: 'Hi Sam, a leaking kitchen tap in NG9, got it.\n\nThat is everything needed for now, Ben will put the quote together and send it over.', factIds: [], kbIds: [] };
        },
    });
    mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-quoting-door-'));
    const { router } = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, mediaDir, scoping: { describe: async () => ({ ok: true, description: 'a dripping mixer tap', confidence: 'high', model: 'fake-vision', usage: null, durationMs: 1 }) }, quoting: { store, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local' } });
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

    it('a photo sent while the draft is with Ben is thanked for once and joins the quote, and the same photo again is not thanked for twice', async () => {
        const photo = () => {
            const form = new FormData();
            form.set('text', 'here is the tap');
            form.set('channel', 'whatsapp');
            form.append('media', new Blob([new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex'))], { type: 'image/png' }), 'tap.png');
            return post('/message', undefined, form);
        };
        const r = await photo();
        expect(r.status).toBe(200);
        expect(plannedSendOfResponse(r.json).bubbles.join(' ')).toMatch(/Thanks for sending that over/);
        const thankedAt = r.json.state.caseFile.ledger.find((l: any) => l.subject === 'media')?.thankedAt;
        expect(thankedAt).toBeTruthy();
        expect(store.rows.get(r.json.state.quote.slug)?.customerPhotoUrls).toHaveLength(1);
        // The mark stands, so the next turn carrying the same photo is not thanked for again.
        const again = await photo();
        expect(again.status).toBe(200);
        expect(plannedSendOfResponse(again.json).bubbles.join(' ')).not.toMatch(/thank|cheers/i);
        expect(again.json.state.caseFile.ledger.find((l: any) => l.subject === 'media')?.thankedAt).toBe(thankedAt);
    });

    it('a shut window holds the priced quote for Ben and leaves it a draft, rather than delivering a nudge with no link', async () => {
        await post('/age', { hours: 25 });
        const r = await post('/price', { lines: [{ lineId: 'card_1', finalPence: 12000 }] });
        expect(r.status).toBe(200);
        expect(r.json.sent).toBe(false);
        const ps = plannedSendOfResponse(r.json);
        expect(ps.evidence.decision).toBe('hold');
        expect(ps.bubbles).toHaveLength(0);
        expect(r.json.state.caseFile.hold.reason).toMatch(/window is shut.*no approved template carries a quote link/);
        // Nothing was sent, so nothing about the quote is live: still a draft, no figure on the file.
        const state = await get('/quote');
        expect(state.json.record.status).toBe('draft');
        expect(state.json.facts.some((f: any) => f.key.startsWith('quote_line:'))).toBe(false);
    });

    it('Ben prices and sends: the desk composes the delivery with the link, the guards run over it, the stage moves to quoted', async () => {
        // The customer writes again, which reopens the window and clears the hold for the send.
        await post('/message', { text: 'Any news on the quote?' });
        const r = await post('/price', { lines: [{ lineId: 'card_1', finalPence: 12000 }] });
        expect(r.status).toBe(200);
        const ps = plannedSendOfResponse(r.json);
        expect(ps.approver).toBe('human:ben');
        expect(ps.delivered).toBe(true);
        expect(ps.bubbles.join(' ')).toContain(`https://test.local/quote/${r.json.slug}`);
        // The words are the desk's, so all eight ran and passed. The composer's first draft carried
        // a figure no live quote line backs; the figure guard refused it and the retry dropped it.
        expect(Object.values(ps.guards).every((g) => g.result === 'pass')).toBe(true);
        expect(ps.bubbles.join(' ')).not.toMatch(/£/);
        expect(r.json.run.decision.kind).toBe('send');
        // One reply passes because a person licensed this send, not because the guard was skipped.
        expect(ps.guards.one_reply.note).toMatch(/a person acted on the thread/);
        expect(sendLanded(ps, r.json.state)).toBe(true);
        expect(r.json.state.conversation.stage).toBe('quoted');
        expect(r.json.totals.totalPence).toBe(12000);
        const state = await get('/quote');
        expect(state.json.record.status).toBe('sent');
        expect(state.json.record.lines[0]).toMatchObject({ label: 'Replace kitchen tap', pricePence: 12000, labourPence: 10000, materialsPence: 2000 });
        expect((await post('/price', {})).status).toBe(409);
    });

    it('a question after the quote is answered from it: the figure equals the cited line to the penny and every guard passes', async () => {
        const r = await post('/message', { text: 'What does that include, and how much is that line?', channel: 'whatsapp' });
        expect(r.status).toBe(200);
        const ps = plannedSendOfResponse(r.json);
        expect(ps.delivered).toBe(true);
        expect(ps.hold).toBeNull();
        expect(ps.bubbles.join(' ')).toContain('£120.00');
        expect(ps.guards.figure.result).toBe('pass');
        expect(Object.values(ps.guards).every((g) => g.result === 'pass')).toBe(true);
        const cited = r.json.state.caseFile.facts.find((f: any) => ps.factIds.includes(f.id));
        expect(cited).toMatchObject({ key: 'quote_line:Replace kitchen tap', value: '£120.00', source: { kind: 'quote_line', line: 'Replace kitchen tap' } });
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

describe('the price route and the holds around it', () => {
    /** Its own door, so the thread can be taken somewhere the shared one never goes. */
    async function standUp() {
        const own = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        const client = new FakeModelClient({
            router: ({ user }) => {
                const last = user.split('>>').pop() ?? '';
                const exception = /not happy/i.test(last) ? 'complaint' : /how much/i.test(last) ? 'money' : null;
                return { subjects: ['scoping'], proposedStage: 'scoping', party: 'customer', exception, turnKind: 'question' };
            },
            specialist: ({ system }) => (/lines of a quote/.test(system)
                ? intakeOutput
                : { facts: [{ key: 'job_type', value: 'leaking kitchen tap' }, { key: 'location', value: 'NG9 2AB' }], jobUnknowns: [], answeredSubjects: ['job', 'postcode'] }),
            composer: ({ user }) => {
                if (/Ben has priced the quote and is sending it now/.test(user)) {
                    const link = /(https:\/\/test\.local\/quote\/[a-z0-9]+)/.exec(user)?.[1] ?? '';
                    return { reply: `Your quote is ready, Sam.\n\nEverything is on the link: ${link}`, factIds: [], kbIds: [] };
                }
                return { reply: 'Hi Sam, a leaking kitchen tap in NG9, got it.', factIds: [], kbIds: [] };
            },
        });
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-price-hold-'));
        const { router } = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, mediaDir: dir, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, quoting: { store: own, drafter: new FakeDrafter(own, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local' } });
        const app = express();
        app.use(express.json());
        app.use('/door', router);
        const server: import('node:http').Server = await new Promise((resolve) => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)); });
        const at = `http://127.0.0.1:${(server.address() as { port: number }).port}/door`;
        const call = async (route: string, body: unknown) => {
            const res = await fetch(`${at}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
            return { status: res.status, json: await res.json() as any };
        };
        const close = async () => { await new Promise<void>((r) => server.close(() => r())); fs.rmSync(dir, { recursive: true, force: true }); };
        const started = await call('/start', { door: 'whatsapp', text: 'Hi, my kitchen tap is leaking, NG9 2AB', name: 'Sam' });
        expect(started.json.state.quote.slug).toBeTruthy();
        return { call, close };
    }

    it('leaves a complaint hold standing when Ben prices and sends, because pricing a quote is not the answer to it', async () => {
        const { call, close } = await standUp();
        try {
            const complaint = await call('/message', { text: "I'm not happy with how the last job was left", channel: 'whatsapp' });
            expect(complaint.json.state.caseFile.hold).toMatchObject({ exception: 'complaint' });

            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(true);
            // The thread stays with the person who was meant to answer the complaint.
            expect(priced.json.state.caseFile.hold).toMatchObject({ exception: 'complaint' });
            expect(priced.json.state.caseFile.releases).toHaveLength(0);
        } finally {
            await close();
        }
    });

    it('releases the money hold the quote answers: the customer asked the price before it existed, and Ben has now sent it', async () => {
        const { call, close } = await standUp();
        try {
            const asked = await call('/message', { text: 'How much roughly?', channel: 'whatsapp' });
            expect(asked.json.state.caseFile.hold).toMatchObject({ exception: 'money' });

            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(true);
            // 2.7's promise was that Ben would come back on the price; the quote is him doing it.
            expect(priced.json.state.caseFile.hold).toBeNull();
            expect(priced.json.state.caseFile.releases).toHaveLength(1);
            expect(priced.json.state.caseFile.releases[0].words).toContain('/quote/');
        } finally {
            await close();
        }
    });
});
