/**
 * The Stripe webhook's acceptance on the live desk, driven with a simulated `payment_intent.succeeded`
 * event over memory stores, a recording notifier and a fake deliverer (no payment, no customer, no
 * switch):
 *
 *   the old alerts for every quote while the new desk is not live, and for a quote no live file carries;
 *   live, the acceptance is recorded on the file without writing the row again, Ben is told once, and
 *   the old alerts do not run; the acknowledgement starts only once the webhook's response has closed;
 *   a payment in full says so; a paid quote no longer live is still recorded;
 *   Stripe delivering the event again does nothing on either desk;
 *   a recording that refuses or throws falls back to the old alerts;
 *   through the real desk, one acknowledgement goes through the live sender on an open window, and on
 *   a shut window it holds for Ben and no template is asked for.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { closeFile, open, recordFact, staleClosed, type CaseFile, type Turn } from '../desk/case-file';
import { closeStaleQuotes } from '../file-close';
import { Gateway } from '../desk/gateway';
import { Desk } from '../desk/desk';
import type { DeskResult } from '../desk/desk-types';
import { noFixedLineSource } from '../desk/fixed-lines';
import { FakeModelClient } from '../desk/models';
import { emptyKb } from '../desk/scoping-tools';
import { MemoryCaseFileStore } from '../desk/store';
import type { BenNotice, BenNotifier } from './ben-notifier';
import { FakeDrafter, type DraftIntake } from './draft-quote';
import { announcePaidAcceptance, type LiveAcceptanceDeps, type LiveAcceptanceGateway } from './live-acceptance';
import { QUOTE_FACT } from './quote-record';
import { MemoryQuoteStore } from './quote-store';
import { draftQuote, markQuoteSent, priceQuote } from './quoting-tools';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const now = () => NOW;
const OPEN = '2026-09-15T11:00:00.000Z';
const SHUT = '2026-09-13T08:00:00.000Z';
const LIVE = async () => ({ live: true, off: [] as string[] });

const intake: DraftIntake = { customerName: 'Sam', postcode: 'NG9 2AB', customerType: 'homeowner', missing: [], lines: [{ title: 'Replace kitchen tap', category: 'plumbing', qty: 1, detail: null, assumptions: [], notIncluded: [] }] };

/** A thread on the live store whose quote has been priced and sent, and the webhook's write of the payment on its row. */
async function sentQuote(lastWrote = OPEN) {
    const quotes = new MemoryQuoteStore({ baseUrl: 'https://test.local' });
    const r = open({
        identity: { ok: true, personId: 'p1', customerId: null, role: 'homeowner', isNew: true, canonical: 'phone:07700900942', propertyId: null, landlordId: null, name: 'Sam' },
        channel: 'whatsapp', address: '+447700900942',
        firstTurn: { at: lastWrote, channel: 'whatsapp', kind: 'text', body: 'my kitchen tap is dripping, NG9 2AB', media: [] },
    });
    if (!r.ok) throw new Error(r.reason);
    const file: CaseFile = r.value;
    recordFact(file, { key: 'job_type', value: 'leaking kitchen tap', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
    recordFact(file, { key: 'location', value: 'NG9 2AB', source: { kind: 'thread', turnId: file.turns[0].id }, by: 'scoping' });
    const notices: BenNotice[] = [];
    const notifier: BenNotifier = { async notify(n) { notices.push(n); return { note: `sent to Ben's phone: ${n.title}` }; } };
    const q = { store: quotes, drafter: new FakeDrafter(quotes), notifier, now };
    if (!(await draftQuote(file, file.parties[0], intake, q)).ok) throw new Error('draft');
    if (!(await priceQuote(file, { lines: [{ lineId: 'card_1', finalPence: 12000 }] }, q)).ok) throw new Error('price');
    if (!(await markQuoteSent(file, q)).ok) throw new Error('sent');
    notices.length = 0;
    const slug = file.job.quoteRef!;
    const row = quotes.rows.get(slug)!;
    const cases = new MemoryCaseFileStore();
    cases.put(file);
    return { file, slug, row, quotes, notifier, notices, cases };
}

/** The webhook's own write, then the event it received. */
function paid(row: Record<string, unknown>, amount: number, paymentType: 'deposit' | 'full' = 'deposit') {
    Object.assign(row, { depositPaidAt: NOW.toISOString(), depositAmountPence: amount, paymentType });
    const event = { type: 'payment_intent.succeeded', data: { object: { id: 'pi_test_accept_1', amount, metadata: { quoteId: String(row.id), paymentType } } } };
    return event.data.object;
}

function stubGateway(cases: MemoryCaseFileStore, turns: Turn[] = []): LiveAcceptanceGateway {
    return { store: cases, async handleTurn(_file, turn) { turns.push(turn); return { decision: 'send', note: null } as DeskResult; } };
}

function webhook() {
    const response = new EventEmitter();
    let oldAlerts = 0;
    return { response, oldAlerts: () => { oldAlerts++; }, get oldAlertCount() { return oldAlerts; } };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('the webhook asks the new desk first', () => {
    it('runs the old alerts while the new desk is not live, and for a quote no live case file carries', async () => {
        const t = await sentQuote();
        const intent = paid(t.row, 3000);
        const off = webhook();
        const notLive: LiveAcceptanceDeps = { liveState: async () => ({ live: false, off: ["spine.commsDesk = 'comms_v2'"] }), gateway: async () => { throw new Error('never built while not live'); }, now, log: () => undefined };
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: off.response, oldAlerts: off.oldAlerts }, notLive)).toBe('old');
        expect(off.oldAlertCount).toBe(1);

        const other = webhook();
        const empty = new MemoryCaseFileStore();
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: other.response, oldAlerts: other.oldAlerts }, { liveState: LIVE, gateway: async () => stubGateway(empty), quoting: { store: t.quotes, notifier: t.notifier }, now, log: () => undefined })).toBe('old');
        expect(other.oldAlertCount).toBe(1);
        expect(t.file.stage).toBe('quoted');
        expect(t.notices).toHaveLength(0);
    });

    it('live: records the acceptance on the file without writing the row again, tells Ben once, and acknowledges only after the response closes', async () => {
        const t = await sentQuote();
        const intent = paid(t.row, 3000);
        const before = { ...t.row };
        t.quotes.accept = async () => { throw new Error('the webhook already wrote the payment; the row is never written twice'); };
        const turns: Turn[] = [];
        let puts = 0;
        const put = t.cases.put.bind(t.cases);
        t.cases.put = (f) => { puts++; put(f); };
        const w = webhook();
        const out = await announcePaidAcceptance({ slug: t.slug, intent, response: w.response, oldAlerts: w.oldAlerts }, { liveState: LIVE, gateway: async () => stubGateway(t.cases, turns), quoting: { store: t.quotes, notifier: t.notifier }, now, log: () => undefined });

        expect(out).toBe('comms_v2');
        expect(w.oldAlertCount).toBe(0);
        expect(t.row).toEqual(before);
        expect(t.file.stage).toBe('accepted');
        expect(t.file.facts.filter((f) => f.key === QUOTE_FACT.accepted)).toHaveLength(1);
        expect(t.file.facts.filter((f) => f.key === QUOTE_FACT.status).at(-1)?.value).toMatch(/accepted/);
        expect(t.notices).toHaveLength(1);
        expect(t.notices[0]).toMatchObject({ kind: 'accepted', title: 'Quote accepted' });
        expect(t.notices[0].message).toContain('£30.00 deposit paid');
        expect(puts).toBeGreaterThan(0);

        expect(turns).toHaveLength(0);
        w.response.emit('close');
        await flush();
        expect(turns).toHaveLength(1);
        expect(turns[0]).toMatchObject({ kind: 'portal_action', direction: 'inbound', body: `Accepted quote ${t.slug} on the quote page and paid the £30.00 deposit.` });
        expect(t.file.turns.at(-1)?.id).toBe(turns[0].id);
    });

    it('says a payment in full is one, to Ben and on the turn', async () => {
        const t = await sentQuote();
        const intent = paid(t.row, 12000, 'full');
        const turns: Turn[] = [];
        const w = webhook();
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: w.response, oldAlerts: w.oldAlerts }, { liveState: LIVE, gateway: async () => stubGateway(t.cases, turns), quoting: { store: t.quotes, notifier: t.notifier }, now, log: () => undefined })).toBe('comms_v2');
        expect(t.notices[0].message).toContain('£120.00 paid in full');
        expect(t.notices[0].message).not.toContain('deposit');
        w.response.emit('close');
        await flush();
        expect(turns[0].body).toBe(`Accepted quote ${t.slug} on the quote page and paid £120.00 in full.`);
    });

    it('still records a paid quote that is no longer live: the money is taken', async () => {
        const t = await sentQuote();
        t.row.revokedAt = '2026-09-15T09:00:00.000Z';
        const intent = paid(t.row, 3000);
        const w = webhook();
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: w.response, oldAlerts: w.oldAlerts }, { liveState: LIVE, gateway: async () => stubGateway(t.cases), quoting: { store: t.quotes, notifier: t.notifier }, now, log: () => undefined })).toBe('comms_v2');
        expect(t.file.stage).toBe('accepted');
        expect(t.notices).toHaveLength(1);
        expect(w.oldAlertCount).toBe(0);
    });

    it('a payment after day 31 reopens the file the stale quote rule closed and records the payment on it', async () => {
        const t = await sentQuote();
        const day31 = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
        const gateway = new Gateway({ desk: { handleTurn: async () => { throw new Error('no desk'); }, clockPass: async () => { throw new Error('no desk'); } }, store: t.cases });
        expect((await closeStaleQuotes({ liveState: LIVE, gateway: async () => gateway, now: () => day31, log: () => undefined })).closed).toEqual([{ caseId: t.file.id, to: 'done' }]);
        expect(t.file.stage).toBe('done');

        const later = () => new Date(day31.getTime() + 60_000);
        const intent = paid(t.row, 3000);
        const turns: Turn[] = [];
        const w = webhook();
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: w.response, oldAlerts: w.oldAlerts }, { liveState: LIVE, gateway: async () => stubGateway(t.cases, turns), quoting: { store: t.quotes, notifier: t.notifier }, now: later, log: () => undefined })).toBe('comms_v2');
        expect(w.oldAlertCount).toBe(0);
        expect(t.file.stage).toBe('accepted');
        expect(t.file.stageHistory.slice(-3).map((c) => [c.from, c.to])).toEqual([['quoted', 'done'], ['done', 'quoted'], ['quoted', 'accepted']]);
        expect(t.file.turns.find((x) => x.kind === 'system')?.body).toContain(`Reopened: the stale quote ${t.slug} was taken up (Stripe payment pi_test_accept_1)`);
        expect(t.file.facts.filter((f) => f.key === QUOTE_FACT.accepted)).toHaveLength(1);
        expect(t.notices).toHaveLength(1);
        w.response.emit('close');
        await flush();
        expect(turns).toHaveLength(1);
    });

    it('a payment the desk cannot record on a reopened stale file closes it again as stale, and the old alerts take it', async () => {
        const t = await sentQuote();
        const day31 = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
        const gateway = new Gateway({ desk: { handleTurn: async () => { throw new Error('no desk'); }, clockPass: async () => { throw new Error('no desk'); } }, store: t.cases });
        await closeStaleQuotes({ liveState: LIVE, gateway: async () => gateway, now: () => day31, log: () => undefined });
        const later = () => new Date(day31.getTime() + 60_000);
        const intent = { id: 'pi_test_accept_3', amount: 3000, metadata: { paymentType: 'deposit' } };
        const w = webhook();
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: w.response, oldAlerts: w.oldAlerts }, { liveState: LIVE, gateway: async () => stubGateway(t.cases), quoting: { store: t.quotes, notifier: t.notifier }, now: later, log: () => undefined })).toBe('old');
        expect(w.oldAlertCount).toBe(1);
        expect(t.file.stage).toBe('done');
        expect(staleClosed(t.file)).toBe(true);
        expect(t.file.stageHistory.slice(-3).map((c) => [c.from, c.to])).toEqual([['quoted', 'done'], ['done', 'quoted'], ['quoted', 'done']]);
    });

    it('a payment on a quote whose file was closed by its completion is not reopened: the old alerts take it', async () => {
        const t = await sentQuote();
        closeFile(t.file, 'done', { why: 'the job was signed off as complete' });
        const w = webhook();
        expect(await announcePaidAcceptance({ slug: t.slug, intent: paid(t.row, 3000), response: w.response, oldAlerts: w.oldAlerts }, { liveState: LIVE, gateway: async () => stubGateway(t.cases), quoting: { store: t.quotes, notifier: t.notifier }, now, log: () => undefined })).toBe('old');
        expect(t.file.stage).toBe('done');
    });

    it('does nothing on either desk when Stripe delivers the event again', async () => {
        const t = await sentQuote();
        const intent = paid(t.row, 3000);
        const turns: Turn[] = [];
        const deps: LiveAcceptanceDeps = { liveState: LIVE, gateway: async () => stubGateway(t.cases, turns), quoting: { store: t.quotes, notifier: t.notifier }, now, log: () => undefined };
        const first = webhook();
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: first.response, oldAlerts: first.oldAlerts }, deps)).toBe('comms_v2');
        first.response.emit('close');
        await flush();

        const again = webhook();
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: again.response, oldAlerts: again.oldAlerts }, deps)).toBe('repeat');
        expect(again.oldAlertCount).toBe(0);
        expect(again.response.listenerCount('close')).toBe(0);
        expect(t.notices).toHaveLength(1);
        expect(turns).toHaveLength(1);
        expect(t.file.facts.filter((f) => f.key === QUOTE_FACT.accepted)).toHaveLength(1);
    });

    it('falls back to the old alerts when the recording refuses or throws, so Ben is always told about money', async () => {
        const t = await sentQuote();
        const intent = { id: 'pi_test_accept_2', amount: 3000, metadata: { paymentType: 'deposit' } };
        const refused = webhook();
        // The payment is not on the row: nothing to confirm.
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: refused.response, oldAlerts: refused.oldAlerts }, { liveState: LIVE, gateway: async () => stubGateway(t.cases), quoting: { store: t.quotes, notifier: t.notifier }, now, log: () => undefined })).toBe('old');
        expect(refused.oldAlertCount).toBe(1);
        expect(t.file.stage).toBe('quoted');
        expect(refused.response.listenerCount('close')).toBe(0);

        const threw = webhook();
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: threw.response, oldAlerts: threw.oldAlerts }, { liveState: LIVE, gateway: async () => { throw new Error('the case file store is down'); }, now, log: () => undefined })).toBe('old');
        expect(threw.oldAlertCount).toBe(1);

        const noSlug = webhook();
        expect(await announcePaidAcceptance({ slug: null, intent, response: noSlug.response, oldAlerts: noSlug.oldAlerts }, { liveState: LIVE, gateway: async () => { throw new Error('never asked without a slug'); }, now, log: () => undefined })).toBe('old');
        expect(noSlug.oldAlertCount).toBe(1);
    });
});

describe('the acknowledgement through the live desk', () => {
    const client = new FakeModelClient({
        router: () => ({ subjects: ['quoting'], proposedStage: 'accepted', party: 'customer', exception: null, turnKind: 'acknowledgement' }),
        specialist: () => ({ concerns: [], beyondQuoteLine: false, acceptanceInChat: false, notReady: false }),
        composer: ({ user }) => {
            if (/they accepted the quote on the quote page/.test(user)) return { reply: 'Brilliant, thank you Sam.\n\nThat has come through to me.', factIds: [], kbIds: [] };
            throw new Error('only the acceptance is composed here');
        },
    });
    const noTemplateForAcceptance = { async approved(name: string): Promise<null> { throw new Error(`an acceptance never asks for a template (${name})`); } };

    async function throughDesk(lastWrote: string) {
        const t = await sentQuote(lastWrote);
        const intent = paid(t.row, 3000);
        const delivered: unknown[] = [];
        const desk = new Desk({ mode: 'live', client, now, fixedLines: noFixedLineSource, templates: noTemplateForAcceptance, kb: emptyKb, quoting: { store: t.quotes, notifier: t.notifier }, sender: { deliverer: { async deliver(input) { delivered.push(input); return { ok: true, sid: 'SM_test_1' }; } } } });
        const results: DeskResult[] = [];
        const gateway: LiveAcceptanceGateway = { store: t.cases, async handleTurn(file, turn) { const r = await desk.handleTurn(file, turn); results.push(r); return r; } };
        const w = webhook();
        expect(await announcePaidAcceptance({ slug: t.slug, intent, response: w.response, oldAlerts: w.oldAlerts }, { liveState: LIVE, gateway: async () => gateway, quoting: { store: t.quotes, notifier: t.notifier }, now, log: () => undefined })).toBe('comms_v2');
        w.response.emit('close');
        for (let i = 0; i < 20 && !results.length; i++) await flush();
        return { ...t, delivered, results };
    }

    it('on an open window, one acknowledgement goes through the live sender under the desk', async () => {
        const t = await throughDesk(OPEN);
        expect(t.results).toHaveLength(1);
        expect(t.results[0]).toMatchObject({ decision: 'send', windowState: 'open', templateId: null, delivered: true });
        expect(t.delivered).toHaveLength(1);
        expect(t.delivered[0]).toMatchObject({ channel: 'whatsapp', to: '+447700900942', template: null });
        expect(t.file.sends.at(-1)).toMatchObject({ mode: 'live' });
        expect(t.file.stage).toBe('accepted');
    });

    it('on a shut window, holds for Ben and never reaches for a template', async () => {
        const t = await throughDesk(SHUT);
        expect(t.results).toHaveLength(1);
        expect(t.results[0]).toMatchObject({ decision: 'hold', windowState: 'shut', templateId: null, delivered: false });
        expect(t.delivered).toHaveLength(0);
        expect(t.file.hold?.reason).toMatch(/accepted the quote/);
        expect(t.notices).toHaveLength(1);
    });
});
