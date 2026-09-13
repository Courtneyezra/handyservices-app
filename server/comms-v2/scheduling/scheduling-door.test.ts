/**
 * The scheduling side of the sandbox door, driven over HTTP the way the pipeline's test step
 * drives it: the fixture seeds completed bookings, a sent quote and a booked job, links the
 * current thread and walks its stage; refuses a thread that is not ready and a bad body; can
 * empty the diary; reports its state; resets. Then the three Goal 5 lines through the door.
 */
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_LINES, noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { plannedSendOfResponse, sendLanded } from '../desk/planned-send';
import { createSandboxDoor } from '../desk/sandbox-door';
import { emptyKb } from '../desk/scoping-tools';
import { noTemplateApproved } from '../desk/sender';
import { recordingNotifier } from '../quoting/ben-notifier';
import { FakeDrafter } from '../quoting/draft-quote';
import { MemoryQuoteStore } from '../quoting/quote-store';
import { memoryScheduling, schedulingDoor, withScheduling } from './scheduling-door';
import { MemoryDiary } from './diary';
import { typicalLeadTime } from './scheduling-tools';

let server: import('node:http').Server;
let base: string;
const quoteStore = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
const scheduling = memoryScheduling(undefined, quoteStore);

beforeAll(async () => {
    const client = new FakeModelClient({
        router: ({ user }) => {
            const last = user.split('>>').pop() ?? '';
            const dates = /when|dates|move it/i.test(last);
            return { subjects: dates ? ['scheduling'] : ['scoping'], proposedStage: 'scoping', party: 'customer', exception: /move it/i.test(last) ? 'date_change' : null, turnKind: dates ? 'question' : 'enquiry' };
        },
        // Quoting's two calls are scripted beside Scheduling's: the job and the postcode together
        // make a draft due on the first turn whatever the turn asks about dates.
        specialist: ({ system, user }) => system.includes('Scheduling specialist')
            ? { asks: [/move it/i.test(user) ? 'date_change' : /dates/i.test(user) ? 'availability' : 'lead_time'], requestedChange: /move it/i.test(user) ? 'the week after' : null }
            : /lines of a quote/.test(system)
                ? { lines: [{ title: 'Repair leaking tap', category: 'plumbing', qty: 1, detail: 'leaking at the base', assumptions: [], notIncluded: [] }], customerType: 'homeowner', missing: [] }
                : /what it concerns/.test(system)
                    ? { concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: false }
                    : { facts: [{ key: 'job_type', value: 'leaking tap' }, { key: 'location', value: 'NG9 2AB' }], jobUnknowns: [], answeredSubjects: ['job', 'postcode'] },
        composer: ({ user }) => {
            const lead = /say exactly "(about [^"]+)" and cite fact (fact_[\w-]+)/.exec(user);
            const booked = /Booked date from the diary: say exactly "([^"]+)" and cite fact (fact_[\w-]+)/.exec(user);
            const picker = /give this link exactly, (\S+) \(fact (fact_[\w-]+)\)/.exec(user);
            const ids = [lead?.[2], booked?.[2], picker?.[2]].filter((x): x is string => !!x);
            if (user.includes(DEFAULT_FIXED_LINES.date_change_to_ben)) return { reply: `Right now you're booked in for ${booked?.[1] ?? 'the date on your quote'}.\n\n${DEFAULT_FIXED_LINES.date_change_to_ben}`, factIds: ids, kbIds: [] };
            if (picker) return { reply: `You pick the day on your quote page: ${picker[1]}${lead ? `\n\nWe're usually booking in ${lead[1]}.` : ''}`, factIds: ids, kbIds: [] };
            if (lead) return { reply: `We're usually booking in ${lead[1]}, and Ben confirms the day with your quote.`, factIds: ids, kbIds: [] };
            if (user.includes(DEFAULT_FIXED_LINES.dates_with_quote)) return { reply: 'Dates come with your quote.', factIds: [], kbIds: [] };
            return { reply: 'Hi Sam, a leaking tap in NG9, got it.\n\nWill someone be in?', factIds: [], kbIds: [] };
        },
    });
    const store = quoteStore;
    const { router } = createSandboxDoor({ client, fixedLines: noFixedLineSource, templates: noTemplateApproved, kb: emptyKb, scoping: { describe: async () => ({ ok: false, reason: 'no vision' }) }, quoting: { store, drafter: new FakeDrafter(store, { materialsPence: 2000 }), notifier: recordingNotifier, baseUrl: 'https://test.local' }, scheduling: { ...scheduling, baseUrl: 'https://example.test' } });
    const app = express();
    app.use(express.json());
    app.use('/api/comms-v2-sandbox', router);
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const addr = server.address() as { port: number };
    base = `http://127.0.0.1:${addr.port}/api/comms-v2-sandbox`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

async function post(route: string, body?: unknown) {
    const res = await fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { status: res.status, json: await res.json() as any };
}
describe('the scheduling fixture on the door', () => {
    it('refuses a bad body, and a quote with no thread to link it to', async () => {
        expect((await post('/scheduling/fixture', { completed: -1 })).status).toBe(400);
        expect((await post('/scheduling/fixture', { completed: 999 })).status).toBe(400);
        expect((await post('/scheduling/fixture', { diary: 'sometimes' })).status).toBe(400);
        await post('/reset');
        const r = await post('/scheduling/fixture', { quote: true });
        expect(r.status).toBe(409);
        expect(r.json.error).toMatch(/no sandbox thread/);
        // A refusal writes nothing: no orphan quote or booking is left on the branch.
        expect(scheduling.diary.quotes).toHaveLength(0);
        expect(scheduling.diary.bookings).toHaveLength(0);
        await post('/scheduling/fixture/reset');
    });
    it('seeds completed bookings without a thread, and reports the diary mode', async () => {
        const r = await post('/scheduling/fixture', { completed: 6 });
        expect(r.status).toBe(200);
        expect(r.json.seeded).toMatchObject({ completedSeeded: 6, quoteRef: null, bookingRef: null });
        expect(r.json.linked).toBeNull();
        expect(r.json.diaryMode).toBe('diary');
        expect(scheduling.diary.bookings).toHaveLength(6);
    });
    it('a post that only flips the diary mode writes nothing and deletes nothing', async () => {
        const rows = scheduling.diary.bookings.length;
        const flipped = await post('/scheduling/fixture', { diary: 'none' });
        expect(flipped.status).toBe(200);
        expect(flipped.json.seeded).toMatchObject({ completedSeeded: 0 });
        expect(flipped.json.diaryMode).toBe('none');
        expect(scheduling.diary.bookings).toHaveLength(rows);
        const back = await post('/scheduling/fixture', { diary: 'diary' });
        expect(back.json.diaryMode).toBe('diary');
    });
    it('2.6 replaced: a date question during scoping is answered with the lead time from the diary', async () => {
        const start = await post('/start', { door: 'whatsapp', text: 'Hi, my tap is leaking, NG9 2AB', name: 'Sam' });
        expect(start.status).toBe(200);
        const r = await post('/message', { text: 'When can you come?', channel: 'whatsapp' });
        const ps = plannedSendOfResponse(r.json);
        expect(ps.delivered).toBe(true);
        expect(ps.bubbles[0]).toContain('about 3 days');
        expect(ps.guards.date_time_duration.result).toBe('pass');
        expect(ps.factIds).toHaveLength(1);
        expect(ps.evidence.summary).toMatch(/scheduling: Typical lead time from the diary/);
        expect(sendLanded(ps, r.json.state)).toBe(true);
        const fact = r.json.state.caseFile.facts.find((f: any) => f.id === ps.factIds[0]);
        expect(fact).toMatchObject({ key: 'lead_time', value: 'about 3 days', source: { kind: 'diary' } });
    });
    it('2.6 replaced: with the diary emptied the reply says dates come with your quote and no lead time', async () => {
        await post('/start', { door: 'whatsapp', text: 'Hi, my tap is leaking, NG9 2AB', name: 'Sam' });
        const empty = await post('/scheduling/fixture', { diary: 'none' });
        expect(empty.json.diaryMode).toBe('none');
        const r = await post('/message', { text: 'When can you come?', channel: 'whatsapp' });
        const ps = plannedSendOfResponse(r.json);
        expect(ps.bubbles[0]).toBe('Dates come with your quote.');
        expect(ps.factIds).toEqual([]);
        expect(ps.evidence.summary).toMatch(/no typical lead time/);
        await post('/scheduling/fixture', { diary: 'diary' });
    });
    it('a fresh thread starts from the real diary: /reset puts the emptied diary back', async () => {
        const empty = await post('/scheduling/fixture', { diary: 'none' });
        expect(empty.json.diaryMode).toBe('none');
        expect((await post('/reset')).status).toBe(200);
        const start = await post('/start', { door: 'whatsapp', text: 'Hi, my tap is leaking, NG9 2AB', name: 'Sam' });
        expect(start.status).toBe(200);
        const r = await post('/message', { text: 'When can you come?', channel: 'whatsapp' });
        expect(plannedSendOfResponse(r.json).bubbles[0]).toContain('about 3 days');
    });
    it('5.4: after the quote, availability points at the picker; the fixture walked the stage to quoted', async () => {
        await post('/start', { door: 'whatsapp', text: 'Hi, my tap is leaking, NG9 2AB', name: 'Sam' });
        const seeded = await post('/scheduling/fixture', { quote: true });
        expect(seeded.status).toBe(200);
        expect(seeded.json.linked).toMatchObject({ stage: 'quoted', bookingRef: null });
        // One spelling of job.quoteRef across both specialists: the diary resolves either, the
        // quote store reads only the slug, so the file names the slug.
        expect(seeded.json.linked.quoteRef).toBe(seeded.json.seeded.quoteSlug);
        const r = await post('/message', { text: 'What dates do you have?', channel: 'whatsapp' });
        const ps = plannedSendOfResponse(r.json);
        expect(ps.delivered).toBe(true);
        expect(ps.bubbles[0]).toContain(`https://example.test/quote/${seeded.json.seeded.quoteSlug}`);
        expect(ps.hold).toBeNull();
        expect(r.json.state.conversation.stage).toBe('quoted');
        expect(ps.evidence.summary).toMatch(/Dates are picked on the quote page/);
    });
    it('names the fixture quote the way the quote store reads one, so Quoting finds the row the file points at', async () => {
        await post('/start', { door: 'whatsapp', text: 'Hi, my tap is leaking, NG9 2AB', name: 'Sam' });
        const seeded = await post('/scheduling/fixture', { quote: true });
        const { quoteRef, quoteSlug } = seeded.json.seeded;
        // Live there is one quotes table, so the row the fixture wrote is one the quote store reads.
        quoteStore.rows.set(quoteSlug, { id: quoteRef, shortSlug: quoteSlug, isDraft: false, basePrice: 12000, depositAmountPence: 4000, pricingLineItems: [{ lineId: 'card_1', label: 'Repair leaking tap', qty: 1, pricePence: 12000 }] });
        const read = await fetch(`${base}/quote`);
        const body = await read.json() as any;
        expect(body.record).toMatchObject({ slug: quoteSlug, status: 'sent' });
        expect(body.record.lines[0]).toMatchObject({ label: 'Repair leaking tap', pricePence: 12000 });
    });

    it('5.5: changing a booked date holds for Ben, the reply confirms the booked date from the diary and carries the fixed line', async () => {
        await post('/start', { door: 'whatsapp', text: 'Hi, my tap is leaking, NG9 2AB', name: 'Sam' });
        const seeded = await post('/scheduling/fixture', { booked: true });
        expect(seeded.json.linked).toMatchObject({ stage: 'booked' });
        expect(seeded.json.linked.bookingRef).toBe(seeded.json.seeded.bookingRef);
        const r = await post('/message', { text: 'Can we move it to the week after?', channel: 'whatsapp' });
        const ps = plannedSendOfResponse(r.json);
        expect(ps.delivered).toBe(true);
        expect(ps.hold).toMatchObject({ approver: 'ben' });
        expect(ps.hold?.reason).toMatch(/^date_change/);
        expect(ps.bubbles.join(' ')).toContain(DEFAULT_FIXED_LINES.date_change_to_ben);
        expect(ps.bubbles.join(' ')).toMatch(/\d{1,2} \w+ 2026/);
        expect(ps.guards.date_time_duration.result).toBe('pass');
        expect(r.json.state.conversation.stage).toBe('booked');
        const booked = r.json.state.caseFile.facts.find((f: any) => f.key === 'booked_date');
        expect(booked.source).toEqual({ kind: 'diary', rowId: `booking:${seeded.json.seeded.bookingRef}` });
    });
    it('seeding the same fixture body twice does not walk the thread past the stage it seeds', async () => {
        await post('/start', { door: 'whatsapp', text: 'Hi, my tap is leaking, NG9 2AB', name: 'Sam' });
        const first = await post('/scheduling/fixture', { quote: true });
        expect(first.json.linked).toMatchObject({ stage: 'quoted', bookingRef: null });
        const again = await post('/scheduling/fixture', { quote: true });
        expect(again.status).toBe(200);
        expect(again.json.linked).toMatchObject({ stage: 'quoted', bookingRef: null });
        const r = await post('/message', { text: 'What dates do you have?', channel: 'whatsapp' });
        expect(r.json.state.conversation.stage).toBe('quoted');
    });
    it('reset deletes what the fixture wrote and puts the diary back', async () => {
        const r = await post('/scheduling/fixture/reset');
        expect(r.status).toBe(200);
        expect(r.json.deleted.bookings).toBeGreaterThan(0);
        expect(r.json.diaryMode).toBe('diary');
        expect(scheduling.diary.bookings).toHaveLength(0);
    });
    it('link: false seeds the rows and links nothing; a thread holding the quote Quoting drafted still holds a move for Ben, found by the customer\'s phone', async () => {
        expect((await post('/scheduling/fixture', { booked: true, link: 'no' })).status).toBe(400);
        await post('/start', { door: 'whatsapp', text: 'Hi, my tap is leaking, NG9 2AB', name: 'Sam' });
        const seeded = await post('/scheduling/fixture', { booked: true, link: false });
        expect(seeded.status).toBe(200);
        expect(seeded.json.linked).toBeNull();
        expect(seeded.json.seeded.bookingRef).toBeTruthy();
        const r = await post('/message', { text: 'Can we move it to the week after?', channel: 'whatsapp' });
        const ps = plannedSendOfResponse(r.json);
        expect(ps.delivered).toBe(true);
        expect(ps.hold).toMatchObject({ approver: 'ben' });
        expect(ps.hold?.reason).toMatch(/^date_change/);
        expect(ps.bubbles.join(' ')).toContain(DEFAULT_FIXED_LINES.date_change_to_ben);
        // The file carries the quote Quoting drafted, so a booking made from some other quote is not written onto it as this job's.
        expect(r.json.state.caseFile.job.bookingRef).toBeNull();
        await post('/scheduling/fixture/reset');
    });
    it('a request to move something never booked is not held: with nothing under the customer\'s phone the router\'s date change is answered as availability', async () => {
        await post('/start', { door: 'whatsapp', text: 'Hi, my tap is leaking, NG9 2AB', name: 'Sam' });
        const r = await post('/message', { text: 'Can we move it to the week after?', channel: 'whatsapp' });
        const ps = plannedSendOfResponse(r.json);
        expect(ps.delivered).toBe(true);
        expect(ps.hold).toBeNull();
        expect(ps.bubbles.join(' ')).not.toContain(DEFAULT_FIXED_LINES.date_change_to_ben);
        expect(r.json.state.caseFile.job.bookingRef).toBeNull();
    });
});

describe('the door\'s scheduling deps', () => {
    it('a caller\'s diary is kept even when it comes without a fixture; the live writer beside it is safe, since every write refuses off the branch', async () => {
        const mine = new MemoryDiary();
        mine.quotes.push({ id: 'q9', slug: 'callers', isDraft: false, supersededAt: null, revokedAt: null, expiresAt: null });
        const wired = withScheduling({ scheduling: { diary: mine } });
        expect(wired.scheduling.diary).toBe(mine);
        expect(await wired.scheduling.diary.quote('q9')).toMatchObject({ slug: 'callers' });
        expect(wired.scheduling.diaryMode).toEqual({ completed: 'diary' });
        const both = memoryScheduling();
        expect(withScheduling({ scheduling: both }).scheduling.fixture).toBe(both.fixture);
    });
});

describe('a scheduling fixture seed that fails', () => {
    it('leaves the diary mode as it was, so a later lead-time read is not told the diary was emptied', async () => {
        const deps = memoryScheduling();
        const broken = { ...deps, fixture: { seed: async () => { throw new Error('the branch database is not the one in use'); }, reset: async () => ({ bookings: 0, quotes: 0 }) } };
        const app = express();
        app.use(express.json());
        app.use('/scheduling', schedulingDoor(broken));
        const s = await new Promise<import('node:http').Server>((resolve) => { const x = app.listen(0, '127.0.0.1', () => resolve(x)); });
        const url = `http://127.0.0.1:${(s.address() as { port: number }).port}/scheduling/fixture`;
        const failed = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ diary: 'none', completed: 6 }) });
        expect(failed.status).toBe(500);
        expect(await typicalLeadTime(broken)).toMatchObject({ ok: false, mode: 'diary' });
        await new Promise<void>((done) => s.close(() => done()));
    });
});
