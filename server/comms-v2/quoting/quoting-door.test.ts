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
import { SMS_MAX_SEGMENTS, smsSegmentCount } from '../channels/sms-adapter';
import { FIRST_CONTACT_ACK } from './quoting-door';
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
        // The card this route raised when the shut-window attempt did not send is done, and it
        // clears in the desk's own words: nobody read the delivery before it went, so recording the
        // letter as the release would read as Ben answering that card himself.
        expect(r.json.state.caseFile.hold).toBeNull();
        const release = r.json.state.caseFile.releases.at(-1);
        expect(release.words).toContain(`the desk sent quote ${r.json.slug}`);
        expect(release.words).not.toContain('/quote/');
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
    async function standUp(start: { door?: string; seed?: Record<string, unknown>; now?: () => Date; start?: Record<string, unknown>; delivery?: (link: string) => string } = {}) {
        const own = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
        const prompts: string[] = [];
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
                prompts.push(user);
                if (/Ben has priced the quote and is sending it now/.test(user)) {
                    const link = /(https:\/\/test\.local\/quote\/[a-z0-9]+)/.exec(user)?.[1] ?? '';
                    if (start.delivery) return { reply: start.delivery(link), factIds: [], kbIds: [] };
                    // The quote message and nothing else, on every path: this composer never names
                    // an enquiry, so any acknowledgement in what goes out is the door's own words.
                    // Told the channel, it writes to that channel's shape, and on a text it writes
                    // to the budget it is given, the way an obedient composer does: told the whole
                    // channel budget where the door is also putting a line in, what it writes plus
                    // that line is a message the render refuses. Told nothing, it writes the
                    // WhatsApp shape the system prompt asks for.
                    const budget = Number(/under (\d+) characters in total/.exec(user)?.[1] ?? 0);
                    if (budget) {
                        let reply = `Your quote is ready, Sam. Everything is on the link: ${link}`;
                        const more = ' Just reply here.';
                        while (reply.length + more.length <= budget) reply += more;
                        return { reply, factIds: [], kbIds: [] };
                    }
                    return { reply: `Your quote is ready, Sam.\n\nEverything is on the link: ${link}\n\nBen has gone through the job line by line and everything he has allowed for is written out on the quote itself, along with the parts that are not included, so you can read the whole thing over at your own pace and tell us straight away if anything on it does not look right to you.`, factIds: [], kbIds: [] };
                }
                return { reply: 'Hi Sam, a leaking kitchen tap in NG9, got it.', factIds: [], kbIds: [] };
            },
        });
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-price-hold-'));
        const { router } = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, mediaDir: dir, now: start.now, scoping: { describe: async () => ({ ok: false, reason: 'no vision in tests' }) }, quoting: { store: own, drafter: new FakeDrafter(own, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local' } });
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
        const started = await call('/start', { door: start.door ?? 'whatsapp', text: 'Hi, my kitchen tap is leaking, NG9 2AB', name: 'Sam', seed: start.seed, ...start.start });
        const lastPrompt = () => prompts[prompts.length - 1] ?? '';
        expect(started.json.state.quote.slug).toBeTruthy();
        return { call, close, lastPrompt };
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

    it('leaves the money question standing when Ben prices and sends, because the delivery carries the link and answers nothing else', async () => {
        const { call, close } = await standUp();
        try {
            const asked = await call('/message', { text: 'How much do you charge as a call-out fee?', channel: 'whatsapp' });
            expect(asked.json.state.caseFile.hold).toMatchObject({ exception: 'money' });

            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(true);
            // The delivery may say nothing but the link, so nobody has answered the fee question:
            // it stays Ben's card until he does.
            expect(priced.json.state.caseFile.hold).toMatchObject({ exception: 'money' });
            expect(priced.json.state.caseFile.releases).toHaveLength(0);
        } finally {
            await close();
        }
    });

    it('sends the quote on the channel the customer wrote on, not a channel it names: an SMS thread whose number is on WhatsApp but never wrote there', async () => {
        const { call, close } = await standUp({ door: 'sms', seed: { whatsapp: true } });
        try {
            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            // The WhatsApp reach record has no inbound turn, so its window is shut; SMS has none and
            // carried every other reply, so it carries the quote.
            expect(priced.json.sent).toBe(true);
            const ps = plannedSendOfResponse(priced.json);
            expect(ps.channel).toBe('sms');
            expect(ps.delivered).toBe(true);
            expect(ps.bubbles.join(' ')).toContain('/quote/');
            expect(priced.json.status).toBe('sent');

            // The acceptance happens on the quote page, which carries no reply: the one
            // acknowledgement 6.1 owes the person who just paid goes back by text, as every other
            // reply on this thread did, never as a re-open nudge on a WhatsApp they never wrote on.
            const accepted = await call('/accept', {});
            expect(accepted.status).toBe(200);
            expect(accepted.json.accepted).toBe(true);
            const ack = plannedSendOfResponse(accepted.json);
            expect(ack.channel).toBe('sms');
            expect(ack.delivered).toBe(true);
            expect(ack.templateId).toBeNull();
            expect(accepted.json.state.caseFile.turns.some((t: any) => t.kind === 'portal_action' && t.channel === 'form')).toBe(true);
        } finally {
            await close();
        }
    });

    it('delivers the quote by text to a form lead who never wrote back, rather than holding on a WhatsApp window that has never opened', async () => {
        // The form gives us the number, the number is on WhatsApp, and the customer has written on
        // neither: that WhatsApp record's window has never opened and no template carries a quote
        // link, so the delivery takes the channel that can carry it today.
        const { call, close, lastPrompt } = await standUp({ door: 'form', seed: { whatsapp: true }, start: { postcode: 'NG9 2AB' } });
        try {
            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(true);
            expect(priced.json.status).toBe('sent');
            const ps = plannedSendOfResponse(priced.json);
            expect(ps.channel).toBe('sms');
            expect(ps.delivered).toBe(true);
            expect(ps.templateId).toBeNull();
            expect(ps.bubbles.join(' ')).toContain('/quote/');
            // One text, not bubbles: the composer was told the channel the send takes, so what it
            // wrote fits what two segments hold rather than coming back from the render too long.
            expect(ps.bubbles).toHaveLength(1);
            expect(lastPrompt()).toContain('This reply goes by SMS');
            // Their acknowledgement held for Ben and never went, so this send is the first thing
            // they ever hear from us and the door puts the acknowledgement in it: these are the
            // door's words, not the composer's, which writes the quote message only and was never
            // asked to name an enquiry.
            expect(lastPrompt()).not.toContain('this is the first message they receive from us');
            const text = ps.bubbles.join('\n');
            expect(text).toContain(FIRST_CONTACT_ACK);
            expect(text.indexOf(FIRST_CONTACT_ACK)).toBeLessThan(text.indexOf('/quote/'));
            // The composer was told the room that is left, so what it wrote fits beside that line
            // in one text of two segments rather than coming back from the render too long.
            expect(smsSegmentCount(text)).toBeLessThanOrEqual(SMS_MAX_SEGMENTS);
            expect(text).not.toMatch(/£/);
            expect(text).not.toMatch(/\?/);
            // The acknowledgement went in the send, but the card is still Ben's: a hold clears when
            // the person it is for answers it, and this route clears only the card it raised itself.
            expect(priced.json.state.caseFile.hold.reason).toMatch(/web_form_ack/);
            expect(priced.json.state.caseFile.releases).toHaveLength(0);
            // Everything that went was checked: the guards read the acknowledgement too.
            expect(Object.values(ps.guards).every((g) => g.result === 'pass')).toBe(true);
        } finally {
            await close();
        }
    });

    it('does not introduce itself again when the acknowledgement has already gone, and has no card to clear', async () => {
        // The number is not on WhatsApp, so the acknowledgement went by text on the form turn.
        const { call, close, lastPrompt } = await standUp({ door: 'form', seed: { whatsapp: false }, start: { postcode: 'NG9 2AB' } });
        try {
            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(true);
            const ps = plannedSendOfResponse(priced.json);
            expect(ps.channel).toBe('sms');
            expect(ps.bubbles.join(' ')).toContain('/quote/');
            // Something has already gone back to them, so the delivery is a delivery and nothing else.
            expect(lastPrompt()).not.toContain('this is the first message they receive from us');
            expect(ps.bubbles.join('\n')).not.toContain(FIRST_CONTACT_ACK);
            expect(priced.json.state.caseFile.hold).toBeNull();
            expect(priced.json.state.caseFile.releases).toHaveLength(0);
        } finally {
            await close();
        }
    });

    it('leaves the form acknowledgement hold exactly as it was when the delivery itself holds', async () => {
        const { call, close } = await standUp({ door: 'form', seed: { whatsapp: true }, start: { postcode: 'NG9 2AB' } });
        try {
            // They write on WhatsApp, so that channel is theirs by their own choice, and then go
            // quiet for a day: the delivery holds rather than skipping to the text channel.
            expect((await call('/message', { text: 'any news on that quote?', channel: 'whatsapp' })).status).toBe(200);
            await call('/age', { hours: 25 });

            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(false);
            // Nothing went out, so the acknowledgement went with it: the card stands untouched.
            expect(plannedSendOfResponse(priced.json).bubbles).toEqual([]);
            expect(priced.json.state.caseFile.hold.reason).toMatch(/web_form_ack/);
            expect(priced.json.state.caseFile.releases).toHaveLength(0);
        } finally {
            await close();
        }
    });

    it('holds the delivery for Ben on a shut window the customer wrote on, even with a text channel beside it', async () => {
        // They scoped the job by text, moved to WhatsApp, then went quiet for a day. WhatsApp is
        // theirs by their own choice, so a shut window there holds for Ben (5.1); only a WhatsApp
        // record nobody has written on is skipped for another channel.
        const { call, close } = await standUp({ door: 'sms', seed: { whatsapp: true } });
        try {
            expect((await call('/message', { text: 'moving over to WhatsApp, any news?', channel: 'whatsapp' })).status).toBe(200);
            await call('/age', { hours: 25 });

            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(false);
            const ps = plannedSendOfResponse(priced.json);
            expect(ps.evidence.decision).toBe('hold');
            expect(ps.channel).toBe('whatsapp');
            expect(ps.bubbles).toEqual([]);
            expect(priced.json.state.caseFile.hold.reason).toMatch(/window is shut.*no approved template carries a quote link/);
            // The text channel was there to take it and was not taken.
            expect(priced.json.state.caseFile.parties[0].channels.some((c: any) => c.kind === 'sms')).toBe(true);
            expect(priced.json.state.quote.status ?? null).not.toBe('sent');
        } finally {
            await close();
        }
    });

    it('a shut window on the acceptance holds for Ben rather than sending a template of another purpose', async () => {
        const { call, close } = await standUp();
        try {
            expect((await call('/price', {})).json.sent).toBe(true);
            // A day and a night pass before they accept on the quote page, so the window has shut and
            // the portal action does not reopen it.
            await call('/age', { hours: 25 });

            const accepted = await call('/accept', {});
            expect(accepted.status).toBe(200);
            expect(accepted.json.accepted).toBe(true);
            const ack = plannedSendOfResponse(accepted.json);
            expect(ack.delivered).toBe(false);
            expect(ack.templateId).toBeNull();
            expect(ack.bubbles).toEqual([]);
            // Ben hears it twice: his push, and a card that says what the customer is waiting for.
            expect(accepted.json.state.quote.notifications.map((n: any) => n.kind)).toContain('accepted');
            expect(accepted.json.state.caseFile.hold?.reason).toContain('the customer accepted the quote');
            expect(accepted.json.state.caseFile.hold?.reason).toContain('a word from Ben');
            expect(accepted.json.state.caseFile.stage).toBe('accepted');
        } finally {
            await close();
        }
    });

    it('sends the quote after a turn that mentioned gas, because the delivery answers no turn of theirs', async () => {
        const { call, close } = await standUp();
        try {
            // They raise regulated work in passing. The desk answers that turn with the gas line
            // and holds for Ben, which is his to release and not what pricing does.
            const gas = await call('/message', { text: "by the way I don't need anything doing to the gas hob, just the tap", channel: 'whatsapp' });
            expect(gas.status).toBe(200);
            expect(gas.json.state.caseFile.hold).toBeTruthy();

            // Ben prices anyway. The delivery says nothing about the hob, so the regulated check
            // reads its own words and finds nothing regulated in them.
            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(true);
            const ps = plannedSendOfResponse(priced.json);
            expect(ps.delivered).toBe(true);
            expect(ps.guards.regulated.result).toBe('pass');
            expect(ps.bubbles.join(' ')).toContain('/quote/');
            expect(priced.json.status).toBe('sent');
            // The hold that turn raised is still Ben's to answer, and the quote going out is not it.
            expect(priced.json.state.caseFile.hold).toBeTruthy();
        } finally {
            await close();
        }
    });

    it('stops a delivery that raises regulated work in its own words, with no fixed line to carry it', async () => {
        const { call, close } = await standUp({ delivery: (link) => `Your quote is ready, Sam. The gas hob is on there too. Everything is on the link: ${link}` });
        try {
            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(false);
            const ps = plannedSendOfResponse(priced.json);
            expect(ps.delivered).toBe(false);
            expect(ps.bubbles).toEqual([]);
            expect(ps.guards.regulated.result).toBe('fail');
            expect(ps.guards.regulated.note).toContain('regulated work');
            expect(priced.json.state.caseFile.hold.reason).toMatch(/did not pass the guards \(regulated/);
        } finally {
            await close();
        }
    });

    it('reset removes the quote from an email thread, whose row carries the address where a number would be', async () => {
        const { call, close } = await standUp({ door: 'email' });
        try {
            const reset = await call('/reset', {});
            expect(reset.status).toBe(200);
            // The cleanup is keyed on every contact the sandbox customer writes from, so the door
            // it ran on does not decide whether its row survives the reset.
            expect(reset.json.quotes).toMatchObject({ quotes: 1 });
        } finally {
            await close();
        }
    });

    it('greets the customer by name on the letter that carries the quote, as every other reply does', async () => {
        const { call, close } = await standUp({ door: 'email' });
        try {
            const priced = await call('/price', {});
            expect(priced.status).toBe(200);
            expect(priced.json.sent).toBe(true);
            const ps = plannedSendOfResponse(priced.json);
            expect(ps.channel).toBe('email');
            // The name is on the file from the first turn, so the letter opens with it, not "there".
            expect(ps.bubbles.join(' ')).toContain('Hi Sam,');
            expect(ps.bubbles.join(' ')).not.toContain('Hi there,');
            expect(ps.bubbles.join(' ')).toContain('/quote/');
        } finally {
            await close();
        }
    });

    it('tells the composer about the channel the delivery actually goes out on, by the door\'s own clock', async () => {
        // The door's clock sits at the moment the customer wrote on WhatsApp, so that window is open
        // to it and long shut to the wall clock. Only one of the two is this thread's.
        const clock = { t: Date.parse('2026-09-11T10:00:00.000Z') };
        const { call, close, lastPrompt } = await standUp({ now: () => new Date((clock.t += 1000)) });
        try {
            // They then write by text, so the newest turn is SMS and the choice turns on the window.
            expect((await call('/message', { text: 'any news on that?', channel: 'sms' })).status).toBe(200);

            const priced = await call('/price', {});
            expect(priced.json.sent).toBe(true);
            const ps = plannedSendOfResponse(priced.json);
            expect(ps.channel).toBe('whatsapp');
            // The composer was told about that same channel: no SMS shape for a WhatsApp delivery.
            expect(lastPrompt()).toContain('Ben has priced the quote and is sending it now');
            expect(lastPrompt()).not.toContain('This reply goes by SMS');
        } finally {
            await close();
        }
    });
});
